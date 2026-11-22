import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import unbzip2 from "unbzip2-stream";
import { parseEvent, parseHeader, parsePlayerInfo } from "@laihoe/demoparser2";
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

export interface DemoResult {
  matchId: string;
  map: string;
  rounds: number;
  players: number;
  kills: number;
  durationSec: number;
}

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Demo download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
  const expected = Number(response.headers.get("content-length") ?? 0);
  const actual = statSync(target).size;
  if (expected && actual !== expected) {
    rmSync(target, { force: true });
    throw new Error(`Demo download incomplete: ${actual}/${expected} bytes`);
  }
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

  if (!existsSync(dem)) {
    if (!existsSync(bz2)) {
      console.info(`[demo] downloading ${matchId}`);
      await download(url, bz2);
    }
    console.info(`[demo] decompressing ${matchId} (${Math.round(statSync(bz2).size / 1e6)} MB)`);
    await decompress(bz2, dem);
  }

  const header = parseHeader(dem) as { map_name?: string };
  const players = parsePlayerInfo(dem) as DemoPlayer[];
  const deaths = parseEvent(dem, "player_death", null, ["total_rounds_played"]) as DeathEvent[];
  const hurts = parseEvent(dem, "player_hurt", null, ["total_rounds_played"]) as HurtEvent[];
  const roundEnds = parseEvent(dem, "round_end") as RoundEndEvent[];
  const plants = parseEvent(dem, "bomb_planted", null, ["total_rounds_played"]) as BombEvent[];
  const defuses = parseEvent(dem, "bomb_defused", null, ["total_rounds_played"]) as BombEvent[];

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
    }
  >();

  const ensure = (steamid: string, name: string, team: string) => {
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
      };
      perPlayer.set(steamid, entry);
    }
    if (name && name !== steamid) entry.name = name;
    return entry;
  };

  for (const player of players) {
    ensure(player.steamid, player.name, player.team_number === 2 ? "T" : "CT");
  }

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

  const insertKill = db.prepare(`
    INSERT INTO kills (match_id, round_no, tick, killer, victim, assister, weapon,
      headshot, wallbang, noscope, airborne, flashed, trade, opening,
      killer_x, killer_y, victim_x, victim_y)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, NULL)
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
      start_tick, end_tick, plant_tick, defuse_tick, ct_alive_start, t_alive_start)
    VALUES (?, ?, ?, 'unknown', ?, ?, NULL, ?, ?, ?, NULL, NULL)
  `);

  const plantByRound = new Map(plants.map((plant) => [roundOf(plant), plant.tick]));
  const defuseByRound = new Map(defuses.map((defuse) => [roundOf(defuse), defuse.tick]));

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM kills WHERE match_id = ?").run(matchId);
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

    for (const round of roundEnds) {
      insertRound.run(
        matchId,
        round.round,
        round.winner,
        round.winner,
        round.reason,
        round.tick,
        plantByRound.get(round.round) ?? null,
        defuseByRound.get(round.round) ?? null
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
        entry.team || "?",
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
  rmSync(bz2, { force: true });

  return { matchId, map, rounds, players: perPlayer.size, kills: deaths.length, durationSec };
}
