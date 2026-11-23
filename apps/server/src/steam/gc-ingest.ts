import { db } from "../db.js";

const STEAM64_BASE = 76561197960265728n;

export function accountIdToSteamId(accountId: number): string {
  return (STEAM64_BASE + BigInt(accountId)).toString();
}

export function steamIdToAccountId(steamId: string): number {
  return Number(BigInt(steamId) - STEAM64_BASE);
}

interface RoundStats {
  reservation?: { account_ids?: number[] };
  kills?: number[];
  deaths?: number[];
  assists?: number[];
  enemy_headshots?: number[];
  mvps?: number[];
  team_scores?: number[];
  match_duration?: number;
  match_result?: number;
  map?: string | null;
}

interface GcMatch {
  matchid?: string;
  matchtime?: number;
  watchablematchinfo?: {
    game_map?: string | null;
    server_ip?: number | null;
    tv_port?: number | null;
  };
  roundstatsall?: RoundStats[];
}

export interface IngestResult {
  imported: number;
  skipped: number;
  matches: Array<{ matchId: string; score: [number, number]; players: number; map: string }>;
}

/**
 * Converts the GC `matchList` payload into matches/match_players/rounds.
 * GC gives cumulative per-round stats, no ADR and (usually) no map name.
 * Demo parsing fills the gaps later; the dashboard marks missing metrics as N/A.
 */
export function ingestMatchList(payload: GcMatch[], myAccountId: number): IngestResult {
  const matchStmt = db.prepare(`
    INSERT INTO matches (match_id, season_id, mode, map, format, started_at, ended_at,
      score_us, score_them, result, duration_min, status, source, is_demo, demo_url,
      demo_status, demo_outcome, demo_cluster)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'gc', 0, NULL, ?, ?, ?)
    ON CONFLICT(match_id) DO UPDATE SET
      started_at = excluded.started_at,
      score_us = excluded.score_us,
      score_them = excluded.score_them,
      result = excluded.result,
      duration_min = excluded.duration_min,
      source = 'gc',
      is_demo = 0,
      demo_outcome = COALESCE(excluded.demo_outcome, matches.demo_outcome),
      demo_cluster = COALESCE(excluded.demo_cluster, matches.demo_cluster)
  `);
  const playerStmt = db.prepare(`
    INSERT INTO match_players (match_id, steamid, name, team, kills, deaths, assists,
      damage, adr, hs_kills, rating, is_me)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)
    ON CONFLICT(match_id, steamid) DO UPDATE SET
      kills = excluded.kills, deaths = excluded.deaths, assists = excluded.assists,
      hs_kills = excluded.hs_kills, is_me = excluded.is_me
  `);
  const roundStmt = db.prepare(`
    INSERT OR IGNORE INTO rounds (match_id, round_no, side, eco_band, winner, reason,
      start_tick, end_tick, ct_alive_start, t_alive_start)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
  `);

  let imported = 0;
  let skipped = 0;
  const matches: IngestResult["matches"] = [];

  const tx = db.transaction(() => {
    for (const match of payload) {
      const rounds = match.roundstatsall ?? [];
      const last = rounds[rounds.length - 1];
      if (!match.matchid || !last?.team_scores || !last.reservation?.account_ids) {
        skipped += 1;
        continue;
      }
      const accountIds = last.reservation.account_ids;
      const scores = last.team_scores;
      const us = scores[0] ?? 0;
      const them = scores[1] ?? 0;
      const myIndex = accountIds.indexOf(myAccountId);
      const myTeam = myIndex >= 0 && myIndex < 5 ? 0 : 1;
      const myScore = myTeam === 0 ? us : them;
      const theirScore = myTeam === 0 ? them : us;
      const result = myScore > theirScore ? "win" : myScore < theirScore ? "loss" : "tie";
      const durationMin = last.match_duration ? Math.round(last.match_duration / 60) : null;
      const map = "unknown";
      const startedAt = (match.matchtime ?? 0) * 1000;
      const outcome = match.watchablematchinfo?.tv_port;
      const cluster = match.watchablematchinfo?.server_ip;

      matchStmt.run(
        match.matchid,
        3,
        "premier",
        map,
        "MR12",
        startedAt,
        startedAt + (durationMin ?? 0) * 60000,
        myScore,
        theirScore,
        result,
        durationMin,
        last.map ? "available" : "missing",
        outcome ? String(outcome) : null,
        cluster ?? null
      );

      for (let i = 0; i < accountIds.length; i++) {
        const accountId = accountIds[i]!;
        playerStmt.run(
          match.matchid,
          accountIdToSteamId(accountId),
          accountId === myAccountId ? "you" : `player_${accountId}`,
          i < 5 ? "A" : "B",
          last.kills?.[i] ?? 0,
          last.deaths?.[i] ?? 0,
          last.assists?.[i] ?? 0,
          last.enemy_headshots?.[i] ?? 0,
          accountId === myAccountId ? 1 : 0
        );
      }

      let prevA = 0;
      let prevB = 0;
      rounds.forEach((round, index) => {
        const a = round.team_scores?.[0] ?? prevA;
        const b = round.team_scores?.[1] ?? prevB;
        let winner = "unknown";
        if (a > prevA) winner = myTeam === 0 ? "us" : "them";
        else if (b > prevB) winner = myTeam === 1 ? "us" : "them";
        prevA = a;
        prevB = b;
        roundStmt.run(match.matchid, index + 1, "unknown", "unknown", winner, "unknown");
      });

      imported += 1;
      matches.push({
        matchId: match.matchid,
        score: [myScore, theirScore],
        players: accountIds.length,
        map,
      });
    }
  });
  tx();

  return { imported, skipped, matches };
}
