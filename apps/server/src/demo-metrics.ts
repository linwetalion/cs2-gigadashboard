import { db } from "./db.js";
import type { MetricValue } from "@giga/shared";
import { formatMetric } from "./demo.js";
import { metric } from "./registry.js";

/**
 * Round-level aggregates that can be derived from demo kill events alone:
 * openings, trades, clutches, multi-kills and survival.
 *
 * Everything is computed from the `kills` + `rounds` + `match_players` tables,
 * so it can be recomputed without the demo file.
 */

const TRADE_WINDOW_TICKS = 256; // 4 s at 64 tick

export interface DemoMetricsResult {
  matchId: string;
  rounds: number;
  players: number;
}

interface KillRow {
  round_no: number;
  tick: number;
  killer: string | null;
  victim: string | null;
  assister: string | null;
}

interface PlayerRow {
  steamid: string;
  team: string | null;
}

interface RoundRow {
  round_no: number;
  winner: string | null;
}

interface Acc {
  steamid: string;
  rounds: number;
  roundsSurvived: number;
  openingKills: number;
  openingDeaths: number;
  tradeKills: number;
  tradedDeaths: number;
  clutchAttempts: number;
  clutchWins: number;
  multi2: number;
  multi3: number;
  multi4: number;
  multi5: number;
}

export function computeDemoMetrics(matchId: string): DemoMetricsResult | null {
  const kills = db
    .prepare(
      "SELECT round_no, tick, killer, victim, assister FROM kills WHERE match_id = ? ORDER BY round_no, tick"
    )
    .all(matchId) as KillRow[];
  if (!kills.length) return null;

  const players = db
    .prepare("SELECT steamid, team FROM match_players WHERE match_id = ?")
    .all(matchId) as PlayerRow[];
  const rounds = db
    .prepare("SELECT round_no, winner FROM rounds WHERE match_id = ? ORDER BY round_no")
    .all(matchId) as RoundRow[];

  const teamOf = new Map(players.map((row) => [row.steamid, row.team ?? "?"]));
  const sides = sidesByRound(matchId);
  // Sides swap at halftime, so every team-relative decision must use the side
  // a player actually had in that round, not the static roster label.
  const sideOf = (round: number, steamid: string): string =>
    sides.get(round)?.get(steamid) ?? teamOf.get(steamid) ?? "?";
  const myRow = db
    .prepare("SELECT steamid FROM match_players WHERE match_id = ? AND is_me = 1 LIMIT 1")
    .get(matchId) as { steamid: string } | undefined;
  const mySteamId = myRow?.steamid ?? "";
  const myTeam = teamOf.get(mySteamId) ?? null;
  const acc = new Map<string, Acc>();
  const get = (steamid: string): Acc => {
    let entry = acc.get(steamid);
    if (!entry) {
      entry = {
        steamid,
        rounds: 0,
        roundsSurvived: 0,
        openingKills: 0,
        openingDeaths: 0,
        tradeKills: 0,
        tradedDeaths: 0,
        clutchAttempts: 0,
        clutchWins: 0,
        multi2: 0,
        multi3: 0,
        multi4: 0,
        multi5: 0,
      };
      acc.set(steamid, entry);
    }
    return entry;
  };

  const winnerByRound = new Map(rounds.map((row) => [row.round_no, row.winner ?? "?"]));
  const roundsSeen = new Set<number>();
  for (const kill of kills) roundsSeen.add(kill.round_no);
  for (const round of rounds) roundsSeen.add(round.round_no);

  const byRound = new Map<number, KillRow[]>();
  for (const kill of kills) {
    const list = byRound.get(kill.round_no) ?? [];
    list.push(kill);
    byRound.set(kill.round_no, list);
  }

  for (const roundNo of roundsSeen) {
    const events = byRound.get(roundNo) ?? [];
    const alive = new Map<string, Set<string>>();
    for (const steamid of teamOf.keys()) {
      const side = sideOf(roundNo, steamid);
      if (!alive.has(side)) alive.set(side, new Set());
      alive.get(side)!.add(steamid);
    }
    for (const roster of alive.values()) {
      for (const steamid of roster) get(steamid).rounds += 1;
    }

    const killsThisRound = new Map<string, number>();
    const lastAlive = new Set<string>();
    let openingDone = false;

    events.forEach((kill, index) => {
      const killer = kill.killer && kill.killer !== kill.victim ? kill.killer : null;
      const victim = kill.victim;
      const victimTeam = victim ? sideOf(roundNo, victim) : "?";

      if (!openingDone && killer && victim) {
        openingDone = true;
        get(killer).openingKills += 1;
        get(victim).openingDeaths += 1;
      }

      if (victim) {
        alive.get(victimTeam)?.delete(victim);
      }

      if (killer) {
        killsThisRound.set(killer, (killsThisRound.get(killer) ?? 0) + 1);
      }

      // Trade: a teammate of the victim kills the killer within the window.
      if (killer && victim) {
        const avenger = events.slice(index + 1).find(
          (next) =>
            next.tick - kill.tick <= TRADE_WINDOW_TICKS &&
            next.victim === killer &&
            Boolean(next.killer) &&
            sideOf(roundNo, next.killer!) === victimTeam
        );
        if (avenger?.killer) {
          get(avenger.killer).tradeKills += 1;
          get(victim).tradedDeaths += 1;
        }
      }

      // Clutch attempt: someone just became the last player alive on their team.
      if (victim) {
        const survivors = alive.get(victimTeam);
        if (survivors && survivors.size === 1) {
          const last = [...survivors][0]!;
          if (!lastAlive.has(last)) {
            lastAlive.add(last);
            get(last).clutchAttempts += 1;
          }
        }
      }
    });

    for (const [steamid, count] of killsThisRound) {
      const entry = get(steamid);
      if (count >= 5) entry.multi5 += 1;
      else if (count === 4) entry.multi4 += 1;
      else if (count === 3) entry.multi3 += 1;
      else if (count === 2) entry.multi2 += 1;
    }

    for (const roster of alive.values()) {
      for (const steamid of roster) get(steamid).roundsSurvived += 1;
    }

    const winner = winnerByRound.get(roundNo) ?? "?";
    for (const steamid of lastAlive) {
      if (sideOf(roundNo, steamid) === winner) get(steamid).clutchWins += 1;
    }
  }

  const update = db.prepare(`
    UPDATE match_players SET
      rounds_played = ?, rounds_survived = ?, opening_kills = ?, opening_deaths = ?,
      trade_kills = ?, traded_deaths = ?, clutches_attempted = ?, clutches_won = ?,
      multi2k = ?, multi3k = ?, multi4k = ?, multi5k = ?
    WHERE match_id = ? AND steamid = ?
  `);

  const tx = db.transaction(() => {
    for (const entry of acc.values()) {
      update.run(
        entry.rounds,
        entry.roundsSurvived,
        entry.openingKills,
        entry.openingDeaths,
        entry.tradeKills,
        entry.tradedDeaths,
        entry.clutchAttempts,
        entry.clutchWins,
        entry.multi2,
        entry.multi3,
        entry.multi4,
        entry.multi5,
        matchId,
        entry.steamid
      );
    }
  });
  tx();

  upsertFunnel(matchId, kills, rounds, sides, mySteamId);

  return { matchId, rounds: roundsSeen.size, players: acc.size };
}

/**
 * Per-round side of every player, taken from the sampled positions. A player
 * switches from CT to T at halftime, so a single static label is not enough.
 */
function sidesByRound(matchId: string): Map<number, Map<string, string>> {
  const rows = db
    .prepare(
      `SELECT round_no, steamid, team, COUNT(*) AS c
       FROM positions WHERE match_id = ? AND steamid IS NOT NULL AND team IS NOT NULL
       GROUP BY round_no, steamid, team`
    )
    .all(matchId) as Array<{ round_no: number; steamid: string; team: string; c: number }>;

  const best = new Map<string, { round: number; steamid: string; team: string; c: number }>();
  for (const row of rows) {
    const key = `${row.round_no}:${row.steamid}`;
    const current = best.get(key);
    if (!current || row.c > current.c) {
      best.set(key, { round: row.round_no, steamid: row.steamid, team: row.team, c: row.c });
    }
  }

  const byRound = new Map<number, Map<string, string>>();
  for (const entry of best.values()) {
    let sides = byRound.get(entry.round);
    if (!sides) {
      sides = new Map();
      byRound.set(entry.round, sides);
    }
    sides.set(entry.steamid, entry.team);
  }
  return byRound;
}

/**
 * Rebuilds `match_funnel` from demo kills: the 5v4 journey used by the Teams
 * tab.
 */
function upsertFunnel(
  matchId: string,
  kills: KillRow[],
  rounds: RoundRow[],
  sides: Map<number, Map<string, string>>,
  mySteamId: string
): void {
  const winnerByRound = new Map(rounds.map((row) => [row.round_no, row.winner ?? "?"]));
  const byRound = new Map<number, KillRow[]>();
  for (const kill of kills) {
    const list = byRound.get(kill.round_no) ?? [];
    list.push(kill);
    byRound.set(kill.round_no, list);
  }
  const sideOf = (round: number, steamid: string): string =>
    sides.get(round)?.get(steamid) ?? "?";

  let openingWon = 0;
  let openingWonWon = 0;
  let untraded = 0;
  let untradedWon = 0;
  let openingLost = 0;
  let openingLostWon = 0;
  let allSurvivedWon = 0;

  for (const [roundNo, events] of byRound) {
    const first = events[0];
    if (!first?.killer || !first.victim || first.killer === first.victim) continue;
    const winner = winnerByRound.get(roundNo) ?? "?";
    const ourSide = sideOf(roundNo, mySteamId);
    if (ourSide === "?") continue;
    const mine = sideOf(roundNo, first.killer) === ourSide;
    const ourWon = winner === ourSide;

    if (mine) {
      openingWon += 1;
      if (ourWon) openingWonWon += 1;
      const traded = events.some(
        (next) =>
          next !== first &&
          next.tick - first.tick <= TRADE_WINDOW_TICKS &&
          next.victim === first.killer &&
          sideOf(roundNo, next.killer ?? "") !== ourSide
      );
      if (!traded) {
        untraded += 1;
        if (ourWon) untradedWon += 1;
      }
      if (ourWon) {
        const ourDeaths = events.filter(
          (kill) => kill.victim && sideOf(roundNo, kill.victim) === ourSide
        ).length;
        if (ourDeaths === 0) allSurvivedWon += 1;
      }
    } else {
      openingLost += 1;
      if (ourWon) openingLostWon += 1;
    }
  }

  db.prepare(
    `INSERT INTO match_funnel (match_id, rounds, opening_won, opening_won_won,
       opening_won_untraded, opening_won_untraded_won, opening_lost, opening_lost_won,
       all_survived_won, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')
     ON CONFLICT(match_id) DO UPDATE SET
       rounds = excluded.rounds, opening_won = excluded.opening_won,
       opening_won_won = excluded.opening_won_won,
       opening_won_untraded = excluded.opening_won_untraded,
       opening_won_untraded_won = excluded.opening_won_untraded_won,
       opening_lost = excluded.opening_lost,
       opening_lost_won = excluded.opening_lost_won,
       all_survived_won = excluded.all_survived_won, source = 'demo'`
  ).run(
    matchId,
    byRound.size,
    openingWon,
    openingWonWon,
    untraded,
    untradedWon,
    openingLost,
    openingLostWon,
    allSurvivedWon
  );
}

/** Matches that already have kill events, newest first. */
export function parsedMatchIds(limit = 1000): string[] {
  return (
    db
      .prepare("SELECT DISTINCT match_id FROM kills ORDER BY match_id LIMIT ?")
      .all(limit) as Array<{ match_id: string }>
  ).map((row) => row.match_id);
}

interface DemoAggregate {
  openingKills: number;
  openingDeaths: number;
  tradeKills: number;
  kills: number;
  clutchAttempts: number;
  clutchWins: number;
  multi2: number;
  multi3: number;
  multi4: number;
  multi5: number;
  rounds: number;
  survived: number;
}

/**
 * Fills the metrics that are computed from demo events for the tracked player
 * inside the current filter slice.
 */
export function applyDemoMetrics(
  values: Record<string, MetricValue>,
  matchIds: string[]
): void {
  if (!matchIds.length) return;
  const placeholders = matchIds.map(() => "?").join(",");
  const row = db
    .prepare(      `SELECT
         COALESCE(SUM(opening_kills), 0) AS openingKills,
         COALESCE(SUM(opening_deaths), 0) AS openingDeaths,
         COALESCE(SUM(trade_kills), 0) AS tradeKills,
         COALESCE(SUM(kills), 0) AS kills,
         COALESCE(SUM(clutches_attempted), 0) AS clutchAttempts,
         COALESCE(SUM(clutches_won), 0) AS clutchWins,
         COALESCE(SUM(multi2k), 0) AS multi2,
         COALESCE(SUM(multi3k), 0) AS multi3,
         COALESCE(SUM(multi4k), 0) AS multi4,
         COALESCE(SUM(multi5k), 0) AS multi5,
         COALESCE(SUM(rounds_played), 0) AS rounds,
         COALESCE(SUM(rounds_survived), 0) AS survived
       FROM match_players
       WHERE is_me = 1 AND rounds_played IS NOT NULL AND match_id IN (${placeholders})`
    )
    .get(...matchIds) as DemoAggregate;

  const rounds = Number(row.rounds);
  if (!rounds) return;

  const put = (id: string, value: number) => {
    const def = metric(id);
    values[id] = {
      metricId: id,
      value,
      display: formatMetric(def, value),
      n: rounds,
      confidence: rounds >= 200 ? "high" : rounds >= 50 ? "medium" : "low",
      source: "computed",
    };
  };

  const openingKills = Number(row.openingKills);
  const openingDeaths = Number(row.openingDeaths);
  const openingDuels = openingKills + openingDeaths;
  if (openingDuels) {
    put("ENT-001", openingDuels);
    put("ENT-002", openingKills);
    put("ENT-003", openingDeaths);
    put("ENT-004", (openingKills / openingDuels) * 100);
  }

  const tradeKills = Number(row.tradeKills);
  if (tradeKills) put("TRD-004", tradeKills);
  if (Number(row.kills)) put("TRD-005", (tradeKills / Number(row.kills)) * 100);

  const clutchAttempts = Number(row.clutchAttempts);
  if (clutchAttempts) {
    put("CLT-001", clutchAttempts);
    put("CLT-002", Number(row.clutchWins));
    put("CLT-003", clutchAttempts - Number(row.clutchWins));
    put("CLT-004", (Number(row.clutchWins) / clutchAttempts) * 100);
  }

  const multi2 = Number(row.multi2);
  const multi3 = Number(row.multi3);
  const multi4 = Number(row.multi4);
  const multi5 = Number(row.multi5);
  if (multi2) put("MLT-001", multi2);
  if (multi3) put("MLT-002", multi3);
  if (multi4) put("MLT-003", multi4);
  if (multi5) put("MLT-004", multi5);
  if (multi2 + multi3 + multi4 + multi5) put("MLT-005", multi2 + multi3 + multi4 + multi5);
}

/* ------------------------------------------------------------------ */
/* Second wave: objective, weapon mix, team play, records, seasons      */
/* ------------------------------------------------------------------ */

const PISTOLS = /^(glock|usp|usp_silencer|p2000|p250|deagle|revolver|elite|tec9|fiveseven|cz75a)/;
const SNIPERS = /^(awp|ssg08|scar20|g3sg1)/;
const SMGS = /^(mp9|mp7|mp5sd|ump45|p90|bizon|mac10|mp5)/;
const HEAVY = /^(nova|xm1014|sawedoff|m249|negev)/;

function weaponClass(weapon: string | null): "pistol" | "sniper" | "smg" | "heavy" | "other" {
  if (!weapon) return "other";
  const name = weapon.replace(/^weapon_/, "").toLowerCase();
  if (PISTOLS.test(name)) return "pistol";
  if (SNIPERS.test(name)) return "sniper";
  if (SMGS.test(name)) return "smg";
  if (HEAVY.test(name)) return "heavy";
  return "other";
}

function putValue(
  values: Record<string, MetricValue>,
  id: string,
  value: number,
  n: number
): void {
  const def = metric(id);
  values[id] = {
    metricId: id,
    value,
    display: formatMetric(def, value),
    n,
    confidence: n >= 200 ? "high" : n >= 50 ? "medium" : "low",
    source: "computed",
  };
}

/**
 * Metrics that do not need a new demo parse: they come from the kill, round and
 * match tables that the parser already fills.
 */
export function applyExtendedMetrics(
  values: Record<string, MetricValue>,
  matchIds: string[]
): void {
  if (!matchIds.length) return;
  const ph = matchIds.map(() => "?").join(",");

  // WPN-017…020: share of kills by weapon class.
  const weaponRows = db
    .prepare(
      `SELECT weapon, COUNT(*) AS c FROM kills
       WHERE match_id IN (${ph}) AND killer IS NOT NULL AND killer != victim
       GROUP BY weapon`
    )
    .all(...matchIds) as Array<{ weapon: string | null; c: number }>;
  const byClass = { pistol: 0, sniper: 0, smg: 0, heavy: 0, other: 0 };
  let allKills = 0;
  for (const item of weaponRows) {
    byClass[weaponClass(item.weapon)] += Number(item.c);
    allKills += Number(item.c);
  }
  if (allKills) {
    putValue(values, "WPN-017", (byClass.pistol / allKills) * 100, allKills);
    putValue(values, "WPN-018", (byClass.sniper / allKills) * 100, allKills);
    putValue(values, "WPN-019", (byClass.smg / allKills) * 100, allKills);
    putValue(values, "WPN-020", (byClass.heavy / allKills) * 100, allKills);
  }

  // OBJ-001 / OBJ-004: plants and defuses made by our side.
  const obj = db
    .prepare(
      `SELECT
         SUM(CASE WHEN plant_player IN (
           SELECT steamid FROM match_players WHERE match_id = rounds.match_id AND team = 'us'
         ) THEN 1 ELSE 0 END) AS plants,
         SUM(CASE WHEN defuse_player IN (
           SELECT steamid FROM match_players WHERE match_id = rounds.match_id AND team = 'us'
         ) THEN 1 ELSE 0 END) AS defuses,
         COUNT(*) AS rounds
       FROM rounds WHERE match_id IN (${ph})`
    )
    .get(...matchIds) as { plants: number | null; defuses: number | null; rounds: number };
  const plants = Number(obj.plants ?? 0);
  const defuses = Number(obj.defuses ?? 0);
  const roundCount = Number(obj.rounds ?? 0);
  if (roundCount) {
    if (plants) {
      putValue(values, "OBJ-001", plants, roundCount);
      putValue(values, "OBJ-012", (plants / roundCount) * 100, roundCount);
    }
    if (defuses) {
      putValue(values, "OBJ-004", defuses, roundCount);
      putValue(values, "OBJ-013", (defuses / roundCount) * 100, roundCount);
    }
  }

  // TEA-005 is intentionally not filled: a static roster label cannot tell a
  // team kill from a normal one across the halftime side swap.

  // REC-003…006: personal records inside the current slice.
  const rec = db
    .prepare(
      `SELECT MAX(kills) AS kills, MIN(deaths) AS deaths, MAX(assists) AS assists, MAX(adr) AS adr
       FROM match_players WHERE is_me = 1 AND match_id IN (${ph})`
    )
    .get(...matchIds) as {
    kills: number | null;
    deaths: number | null;
    assists: number | null;
    adr: number | null;
  };
  if (rec.kills !== null) putValue(values, "REC-003", Number(rec.kills), matchIds.length);
  if (rec.deaths !== null) putValue(values, "REC-004", Number(rec.deaths), matchIds.length);
  if (rec.assists !== null) putValue(values, "REC-005", Number(rec.assists), matchIds.length);
  if (rec.adr !== null) putValue(values, "REC-006", Number(rec.adr), matchIds.length);

  // SEA-001 / SEA-002: matches and win rate of the selected season slice.
  const sea = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins
       FROM matches WHERE match_id IN (${ph})`
    )
    .get(...matchIds) as { n: number; wins: number | null };
  if (Number(sea.n) > 0) {
    putValue(values, "SEA-001", Number(sea.n), Number(sea.n));
    putValue(values, "SEA-002", (Number(sea.wins ?? 0) / Number(sea.n)) * 100, Number(sea.n));
  }

  // FRM-020: hours in game per week across the slice.
  const span = db
    .prepare(
      `SELECT MIN(started_at) AS first, MAX(started_at) AS last,
              SUM(COALESCE(duration_min, 0)) AS minutes
       FROM matches WHERE match_id IN (${ph})`
    )
    .get(...matchIds) as { first: number | null; last: number | null; minutes: number | null };
  if (span.first && span.last) {
    const weeks = Math.max(1, (Number(span.last) - Number(span.first)) / 604_800_000);
    putValue(values, "FRM-020", Number(span.minutes ?? 0) / 60 / weeks, Number(sea.n));
  }
}
