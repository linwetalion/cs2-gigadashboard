import { db } from "../db.js";

export interface LeetifyPlayerStats {
  steam64Id: string;
  totalKills?: number;
  totalDeaths?: number;
  totalAssists?: number;
  totalDamage?: number;
  hltvRating?: number;
  hsp?: number;
  dpr?: number;
  leetifyRating?: number;
  aim?: number;
  utility?: number;
  positioning?: number;
  ctRoundsWon?: number;
  ctRoundsLost?: number;
  tRoundsWon?: number;
  tRoundsLost?: number;
  matchResult?: "win" | "loss" | "tie";
}

export interface LeetifyGame {
  id: string;
  finishedAt: string;
  mapName?: string;
  score?: number[];
  playerStats?: LeetifyPlayerStats[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export function importLeetifyGames(games: LeetifyGame[], mySteamId: string): ImportResult {
  const exists = db.prepare(
    "SELECT match_id FROM matches WHERE ABS(started_at - ?) < 180000 AND map = ? LIMIT 1"
  );
  const insertMatch = db.prepare(`
    INSERT INTO matches (match_id, season_id, mode, map, format, started_at, ended_at,
      score_us, score_them, result, duration_min, status, source, is_demo, demo_status)
    VALUES (?, 3, 'premier', ?, 'MR12', ?, NULL, ?, ?, ?, NULL, 'published', 'leetify', 0, 'none')
    ON CONFLICT(match_id) DO UPDATE SET
      score_us = excluded.score_us, score_them = excluded.score_them,
      result = excluded.result, map = excluded.map, started_at = excluded.started_at
  `);
  const insertPlayer = db.prepare(`
    INSERT INTO match_players (match_id, steamid, name, team, kills, deaths, assists,
      damage, adr, hs_kills, kast, rating, leetify_rating, aim, utility, positioning, is_me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, steamid) DO UPDATE SET
      kills = excluded.kills, deaths = excluded.deaths, assists = excluded.assists,
      damage = excluded.damage, adr = excluded.adr, hs_kills = excluded.hs_kills,
      rating = excluded.rating, leetify_rating = excluded.leetify_rating,
      aim = excluded.aim, utility = excluded.utility, positioning = excluded.positioning,
      is_me = excluded.is_me
  `);

  let imported = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const game of games) {
      const me = game.playerStats?.find((player) => player.steam64Id === mySteamId);
      if (!game.finishedAt || !game.playerStats?.length || !me) {
        skipped += 1;
        continue;
      }
      const map = game.mapName ?? "unknown";
      const startedAt = new Date(game.finishedAt).getTime();
      if (exists.get(startedAt, map)) {
        skipped += 1;
        continue;
      }

      const rounds =
        (me.ctRoundsWon ?? 0) +
          (me.ctRoundsLost ?? 0) +
          (me.tRoundsWon ?? 0) +
          (me.tRoundsLost ?? 0) || 0;
      const scoreUs = (me.ctRoundsWon ?? 0) + (me.tRoundsWon ?? 0);
      const scoreThem = (me.ctRoundsLost ?? 0) + (me.tRoundsLost ?? 0);
      const fallbackUs = game.score?.[0] ?? 0;
      const fallbackThem = game.score?.[1] ?? 0;
      const us = rounds ? scoreUs : me.matchResult === "win" ? Math.max(fallbackUs, fallbackThem) : Math.min(fallbackUs, fallbackThem);
      const them = rounds ? scoreThem : me.matchResult === "win" ? Math.min(fallbackUs, fallbackThem) : Math.max(fallbackUs, fallbackThem);
      const result = me.matchResult ?? (us > them ? "win" : us < them ? "loss" : "tie");
      const matchId = `leetify:${game.id}`;

      insertMatch.run(matchId, map, startedAt, us, them, result);

      for (const player of game.playerStats) {
        const playerRounds = rounds || 1;
        const isMe = player.steam64Id === mySteamId;
        insertPlayer.run(
          matchId,
          player.steam64Id,
          isMe ? "you" : `player_${player.steam64Id.slice(-6)}`,
          isMe ? "us" : "them",
          player.totalKills ?? 0,
          player.totalDeaths ?? 0,
          player.totalAssists ?? 0,
          player.totalDamage ?? 0,
          (player.totalDamage ?? 0) / playerRounds,
          Math.round((player.totalKills ?? 0) * (player.hsp ?? 0)),
          player.hltvRating ?? 0,
          (player.leetifyRating ?? 0) * 100,
          player.aim ?? 0,
          player.utility ?? 0,
          player.positioning ?? 0,
          isMe ? 1 : 0
        );
      }
      imported += 1;
    }
  });
  tx();

  return { imported, skipped };
}
