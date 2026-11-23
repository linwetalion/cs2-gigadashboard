import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import unbzip2 from "unbzip2-stream";
import { parseEvent, parseGrenades, parseHeader, parsePlayerInfo, parseTicks } from "@laihoe/demoparser2";
import { dataDir } from "../config.js";
import { db } from "../db.js";

const demoDir = resolve(dataDir, "demos");
const TICK_RATE = 64;

interface DemoPlayer {
  name: string;
  steamid: string;
  team_number: number;
}

interface DeathEvent {
  attacker_steamid?: string | null;
  user_steamid?: string | null;
  assister_steamid?: string | null;
  weapon?: string;
  headshot?: boolean;
  penetrated?: number;
  noscope?: boolean;
  attackerinair?: boolean;
  attackerblind?: boolean;
  tick: number;
  total_rounds_played?: number;
}

interface HurtEvent {
  attacker_steamid?: string | null;
  user_steamid?: string | null;
  dmg_health?: number;
  weapon?: string;
  hitgroup?: string;
  tick: number;
  total_rounds_played?: number;
}

interface RoundEndEvent {
  round: number;
  winner: "T" | "CT";
  reason: string;
  tick: number;
}

interface BombEvent {
  user_steamid?: string;
  tick: number;
  total_rounds_played?: number;
}

interface FireEvent {
  user_steamid?: string;
  weapon?: string;
  tick: number;
  total_rounds_played?: number;
}

interface GrenadeRow {
  grenade_entity_id: number;
  grenade_type: string;
  steamid?: string;
  tick: number;
  x: number | null;
  y: number | null;
  z: number | null;
}

interface TickRow {
  X?: number;
  Y?: number;
  Z?: number;
  health?: number;
  steamid?: string;
  team_num?: number;
  tick: number;
}

export interface DemoResult {
  matchId: string;
  map: string;
  rounds: number;
  players: number;
  kills: number;
  durationSec: number;
}

async function download(url: string, target: string): Promise<void> {
  const part = `${target}.part`;
  rmSync(part, { force: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Demo download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(part));
  const expected = Number(response.headers.get("content-length") ?? 0);
  const actual = statSync(part).size;
  if (expected && actual !== expected) {
    rmSync(part, { force: true });
    throw new Error(`Demo download incomplete: ${actual}/${expected} bytes`);
  }
  if (actual < 1024) {
    rmSync(part, { force: true });
    throw new Error(`Demo download too small: ${actual} bytes`);
  }
  renameSync(part, target);
}

async function decompress(input: string, output: string): Promise<void> {
  await pipeline(createReadStream(input), unbzip2(), createWriteStream(output));
}

function roundOf(event: { total_rounds_played?: number }): number {
  return Math.max(1, (event.total_rounds_played ?? 0) + 1);
}

export async function processDemo(matchId: string, url: string, mySteamId: string): Promise<DemoResult> {
  mkdirSync(demoDir, { recursive: true });
  const bz2 = resolve(demoDir, `${matchId}.dem.bz2`);
  const dem = resolve(demoDir, `${matchId}.dem`);

  if (!existsSync(dem) || statSync(dem).size < 1024) {
    if (!existsSync(bz2) || statSync(bz2).size < 1024) {
      console.info(`[demo] downloading ${matchId}`);
      await download(url, bz2);
    }
    console.info(`[demo] decompressing ${matchId} (${Math.round(statSync(bz2).size / 1e6)} MB)`);
    await decompress(bz2, dem);
  }

  const header = parseHeader(dem) as { map_name?: string };
  const players = parsePlayerInfo(dem) as DemoPlayer[];
  const demSize = statSync(dem).size;
  if (players.length < 2 || demSize < 1_000_000) {
    rmSync(dem, { force: true });
    rmSync(bz2, { force: true });
    throw new Error(`Demo looks corrupt: players=${players.length}, size=${demSize} bytes`);
  }
  const deaths = parseEvent(dem, "player_death", null, ["total_rounds_played"]) as DeathEvent[];
  const hurts = parseEvent(dem, "player_hurt", null, ["total_rounds_played"]) as HurtEvent[];
  const roundEnds = parseEvent(dem, "round_end") as RoundEndEvent[];
  const plants = parseEvent(dem, "bomb_planted", null, ["total_rounds_played"]) as BombEvent[];
  const defuses = parseEvent(dem, "bomb_defused", null, ["total_rounds_played"]) as BombEvent[];
  const fires = parseEvent(dem, "weapon_fire", null, ["total_rounds_played"]) as FireEvent[];
  const grenadeRows = parseGrenades(dem, null, true) as GrenadeRow[];

  if (players.length < 2 || roundEnds.length < 1) {
    rmSync(dem, { force: true });
    rmSync(bz2, { force: true });
    throw new Error(
      `Demo looks incomplete: players=${players.length}, rounds=${roundEnds.length}, kills=${deaths.length}`
    );
  }

  const map = header.map_name ?? "unknown";
  const rounds = roundEnds.length;
  const durationSec = Math.round(roundEnds[roundEnds.length - 1]!.tick / TICK_RATE);

  const perPlayer = new Map<
    string,
    {
      kills: number;
      deaths: number;
      assists: number;
      hs: number;
      damage: number;
      roundsWithKast: Set<number>;
      name: string;
      team: string;
      teamNumber: number | null;
    }
  >();

  const ensure = (steamid: string, name: string, team: string, teamNumber: number | null = null) => {
    let entry = perPlayer.get(steamid);
    if (!entry) {
      entry = {
        kills: 0,
        deaths: 0,
        assists: 0,
        hs: 0,
        damage: 0,
        roundsWithKast: new Set(),
        name,
        team,
        teamNumber,
      };
      perPlayer.set(steamid, entry);
    }
    if (name && name !== steamid) entry.name = name;
    if (teamNumber !== null) entry.teamNumber = teamNumber;
    return entry;
  };

  for (const player of players) {
    ensure(
      player.steamid,
      player.name,
      player.team_number === 2 ? "T" : "CT",
      player.team_number ?? null
    );
  }
  const mySide = players.find((player) => player.steamid === mySteamId)?.team_number ?? null;

  for (const death of deaths) {
    const round = roundOf(death);
    const killer = death.attacker_steamid;
    const victim = death.user_steamid;
    if (killer && killer !== victim) {
      const entry = ensure(killer, "", "");
      entry.kills += 1;
      if (death.headshot) entry.hs += 1;
      entry.roundsWithKast.add(round);
    }
    if (victim) {
      ensure(victim, "", "").deaths += 1;
    }
    if (death.assister_steamid) {
      const entry = ensure(death.assister_steamid, "", "");
      entry.assists += 1;
      entry.roundsWithKast.add(round);
    }
  }

  for (const hurt of hurts) {
    if (!hurt.attacker_steamid || hurt.attacker_steamid === hurt.user_steamid) continue;
    const entry = ensure(hurt.attacker_steamid, "", "");
    entry.damage += hurt.dmg_health ?? 0;
  }

  // Survival and KAST
  const deathsByRound = new Map<string, Set<number>>();
  for (const death of deaths) {
    if (!death.user_steamid) continue;
    const key = `${death.user_steamid}:${roundOf(death)}`;
    if (!deathsByRound.has(key)) deathsByRound.set(key, new Set());
    deathsByRound.get(key)!.add(death.tick);
  }
  for (const [steamid, entry] of perPlayer) {
    for (let round = 1; round <= rounds; round++) {
      if (!deathsByRound.has(`${steamid}:${round}`)) entry.roundsWithKast.add(round);
    }
  }

  const maxTick = roundEnds[roundEnds.length - 1]!.tick;
  const sampleTicks: number[] = [];
  for (let tick = 64; tick <= maxTick; tick += 64) sampleTicks.push(tick);
  const tickRows = parseTicks(
    dem,
    ["X", "Y", "Z", "health", "team_num"],
    sampleTicks
  ) as TickRow[];

  const roundAtTick = (tick: number): number => {
    let round = 1;
    for (const end of roundEnds) {
      if (tick <= end.tick) return end.round;
      round = end.round + 1;
    }
    return round;
  };

  const insertKill = db.prepare(`
    INSERT INTO kills (match_id, round_no, tick, killer, victim, assister, weapon,
      headshot, wallbang, noscope, airborne, flashed, trade, opening,
      killer_x, killer_y, victim_x, victim_y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, NULL)
  `);
  const insertDamage = db.prepare(`
    INSERT INTO damage (match_id, round_no, tick, attacker, victim, weapon, hitgroup, dmg, friendly)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const insertShot = db.prepare(`
    INSERT INTO shots (match_id, round_no, tick, steamid, weapon, hitgroup, distance, speed,
      scoped, spotted_enemy, first_bullet, spray_index, hit, dmg)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 1, ?, ?, 0, 0)
  `);
  const markShotHit = db.prepare("UPDATE shots SET hit = 1, dmg = ? WHERE id = ?");
  const insertGrenade = db.prepare(`
    INSERT INTO grenades (match_id, round_no, tick, thrower, type, x, y, x2, y2,
      blind_ms, full_blind, effective)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
  `);
  const insertPosition = db.prepare(`
    INSERT OR REPLACE INTO positions (match_id, round_no, tick, steamid, x, y, z, speed, health, team, zone)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
  `);
  const updateMatch = db.prepare(`
    UPDATE matches SET map = ?, parsed_at = ?, demo_status = 'parsed',
      duration_min = COALESCE(?, duration_min)
    WHERE match_id = ?
  `);
  const updatePlayer = db.prepare(`
    INSERT INTO match_players (match_id, steamid, name, team, kills, deaths, assists,
      damage, adr, hs_kills, kast, rating, is_me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, steamid) DO UPDATE SET
      name = excluded.name, team = excluded.team, kills = excluded.kills,
      deaths = excluded.deaths, assists = excluded.assists, damage = excluded.damage,
      adr = excluded.adr, hs_kills = excluded.hs_kills, kast = excluded.kast,
      rating = excluded.rating
  `);
  const insertRound = db.prepare(`
    INSERT OR REPLACE INTO rounds (match_id, round_no, side, eco_band, winner, reason,
      start_tick, end_tick, plant_tick, defuse_tick, plant_player, defuse_player,
      ct_alive_start, t_alive_start)
    VALUES (?, ?, ?, 'unknown', ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL)
  `);

  const plantByRound = new Map(plants.map((plant) => [roundOf(plant), plant.tick]));
  const defuseByRound = new Map(defuses.map((defuse) => [roundOf(defuse), defuse.tick]));
  const plantPlayerByRound = new Map(
    plants.map((plant) => [roundOf(plant), plant.user_steamid ?? null])
  );
  const defusePlayerByRound = new Map(
    defuses.map((defuse) => [roundOf(defuse), defuse.user_steamid ?? null])
  );

  const tx = db.transaction(() => {
    // Re-parsing must not stack duplicates on top of the previous run.
    for (const table of ["kills", "shots", "damage", "grenades", "positions"]) {
      db.prepare(`DELETE FROM ${table} WHERE match_id = ?`).run(matchId);
    }
    for (const death of deaths) {
      insertKill.run(
        matchId,
        roundOf(death),
        death.tick,
        death.attacker_steamid ?? null,
        death.user_steamid ?? null,
        death.assister_steamid ?? null,
        death.weapon ?? null,
        death.headshot ? 1 : 0,
        death.penetrated ? 1 : 0,
        death.noscope ? 1 : 0,
        death.attackerinair ? 1 : 0,
        death.attackerblind ? 1 : 0
      );
    }

    for (const hurt of hurts) {
      if (!hurt.attacker_steamid) continue;
      insertDamage.run(
        matchId,
        roundOf(hurt),
        hurt.tick,
        hurt.attacker_steamid,
        hurt.user_steamid ?? null,
        hurt.weapon ?? null,
        hurt.hitgroup ?? null,
        hurt.dmg_health ?? 0
      );
    }

    const shotsByPlayer = new Map<string, Array<{ id: number; tick: number; hit: boolean }>>();
    let lastFirePlayer = "";
    let lastFireTick = -100;
    let sprayIndex = 0;
    const firstBulletRounds = new Set<string>();
    for (const fire of [...fires].sort((a, b) => a.tick - b.tick)) {
      if (!fire.user_steamid) continue;
      const weaponName = (fire.weapon ?? "").replace(/^weapon_/, "");
      if (
        /^(knife|bayonet|c4|hegrenade|flashbang|smokegrenade|molotov|incgrenade|decoy|taser|world)/i.test(
          weaponName
        )
      ) {
        continue;
      }
      const round = roundOf(fire);
      if (fire.user_steamid === lastFirePlayer && fire.tick - lastFireTick <= 8) {
        sprayIndex += 1;
      } else {
        sprayIndex = 1;
      }
      lastFirePlayer = fire.user_steamid;
      lastFireTick = fire.tick;
      const key = `${fire.user_steamid}:${round}`;
      const firstBullet = firstBulletRounds.has(key) ? 0 : 1;
      if (firstBullet) firstBulletRounds.add(key);
      const info = insertShot.run(
        matchId,
        round,
        fire.tick,
        fire.user_steamid,
        weaponName,
        firstBullet,
        sprayIndex
      );
      const list = shotsByPlayer.get(fire.user_steamid) ?? [];
      list.push({ id: Number(info.lastInsertRowid), tick: fire.tick, hit: false });
      shotsByPlayer.set(fire.user_steamid, list);
    }

    for (const hurt of [...hurts].sort((a, b) => a.tick - b.tick)) {
      if (!hurt.attacker_steamid) continue;
      const list = shotsByPlayer.get(hurt.attacker_steamid);
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const shot = list[i]!;
        if (!shot.hit && shot.tick <= hurt.tick && hurt.tick - shot.tick <= 64) {
          markShotHit.run(hurt.dmg_health ?? 0, shot.id);
          shot.hit = true;
          break;
        }
      }
    }

    const grenadeGroups = new Map<
      number,
      { type: string; thrower?: string; first: GrenadeRow; last: GrenadeRow }
    >();
    for (const row of grenadeRows) {
      if (row.x == null || row.y == null) continue;
      if (!/Smoke|Flash|HE|Molotov|Incendiary|Decoy/.test(row.grenade_type)) continue;
      const group = grenadeGroups.get(row.grenade_entity_id);
      if (!group) {
        grenadeGroups.set(row.grenade_entity_id, {
          type: row.grenade_type,
          thrower: row.steamid,
          first: row,
          last: row,
        });
      } else {
        group.last = row;
      }
    }
    for (const group of grenadeGroups.values()) {
      const type = group.type
        .replace(/^C/, "")
        .replace(/Grenade/g, "")
        .replace(/Projectile/g, "")
        .toLowerCase();
      insertGrenade.run(
        matchId,
        roundAtTick(group.first.tick),
        group.first.tick,
        group.thrower ?? null,
        type,
        group.first.x,
        group.first.y,
        group.last.x,
        group.last.y
      );
    }

    for (const row of tickRows) {
      if (!row.steamid || row.X == null || row.Y == null) continue;
      insertPosition.run(
        matchId,
        roundAtTick(row.tick),
        row.tick,
        row.steamid,
        row.X,
        row.Y,
        row.Z ?? null,
        row.health ?? null,
        row.team_num === 2 ? "T" : "CT"
      );
    }

    for (const round of roundEnds) {
      insertRound.run(
        matchId,
        round.round,
        round.winner,
        round.winner,
        round.reason,
        round.tick,
        plantByRound.get(round.round) ?? null,
        defuseByRound.get(round.round) ?? null,
        plantPlayerByRound.get(round.round) ?? null,
        defusePlayerByRound.get(round.round) ?? null
      );
    }

    for (const [steamid, entry] of perPlayer) {
      const kpr = entry.kills / rounds;
      const dpr = entry.deaths / rounds;
      const apr = entry.assists / rounds;
      const adr = entry.damage / rounds;
      const kast = (entry.roundsWithKast.size / rounds) * 100;
      const impact = 2.13 * kpr + 0.42 * apr - 0.41;
      const rating =
        0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587;
      updatePlayer.run(
        matchId,
        steamid,
        entry.name || steamid,
        mySide !== null && entry.teamNumber !== null
          ? entry.teamNumber === mySide
            ? "us"
            : "them"
          : entry.team || "?",
        entry.kills,
        entry.deaths,
        entry.assists,
        entry.damage,
        adr,
        entry.hs,
        kast,
        rating,
        steamid === mySteamId ? 1 : 0
      );
    }

    updateMatch.run(map, Date.now(), Math.round(durationSec / 60), matchId);
  });
  tx();

  rmSync(dem, { force: true });
  // The compressed demo is kept on disk: replays expire on Valve's side after
  // a few weeks, and keeping them lets us recompute metrics without re-download.
  const kept = existsSync(bz2) ? statSync(bz2).size : 0;
  db.prepare("UPDATE matches SET demo_size = ? WHERE match_id = ?").run(kept, matchId);

  return { matchId, map, rounds, players: perPlayer.size, kills: deaths.length, durationSec };
}
