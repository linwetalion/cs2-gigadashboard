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
    for (const [steamid, team] of teamOf) {
      if (!alive.has(team)) alive.set(team, new Set());
      alive.get(team)!.add(steamid);
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
      const victimTeam = victim ? (teamOf.get(victim) ?? "?") : "?";

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
            teamOf.get(next.killer!) === victimTeam
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
      if (teamOf.get(steamid) === winner) get(steamid).clutchWins += 1;
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

  return { matchId, rounds: roundsSeen.size, players: acc.size };
}

/** Matches that already have kill events, newest first. */
export function parsedMatchIds(limit = 1000): string[] {
  return (
    db
      .prepare(
        "SELECT DISTINCT match_id FROM kills ORDER BY match_id LIMIT ?"
      )
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
    .prepare(
      `SELECT
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
