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
  /** `GET /api/games/<id>` uses the `*Rating` names for the same scores. */
  aimRating?: number;
  utilityRating?: number;
  positioningRating?: number;
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

/** Full player row from `GET /api/games/<id>`. */
export interface LeetifyRosterPlayer extends LeetifyPlayerStats {
  name?: string;
  initialTeamNumber?: number;
  kast?: number;
  preaim?: number;
  reactionTime?: number;
  roundsSurvived?: number;
}

export interface LeetifyRosterGame {
  id: string;
  finishedAt: string;
  mapName?: string;
  teamScores?: number[];
  playerStats?: LeetifyRosterPlayer[];
}

/** One opening duel (first kill) from `GET /api/games/<id>/opening-duels`. */
export interface LeetifyOpeningDuel {
  round?: number;
  attackerSteam64Id?: string;
  attackerTeamNumber?: number;
  attackerRoundWon?: boolean;
  traded?: boolean;
  victimSteam64Id?: string;
  victimTeamNumber?: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

const MY_FALLBACK = "76561198075131708";

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

interface FunnelRow {
  rounds: number;
  openingWon: number;
  openingWonWon: number;
  openingWonUntraded: number;
  openingWonUntradedWon: number;
  openingLost: number;
  openingLostWon: number;
}

export function funnelFromDuels(
  duels: LeetifyOpeningDuel[],
  myTeam: number | null,
  rounds: number
): FunnelRow {
  const row: FunnelRow = {
    rounds,
    openingWon: 0,
    openingWonWon: 0,
    openingWonUntraded: 0,
    openingWonUntradedWon: 0,
    openingLost: 0,
    openingLostWon: 0,
  };
  if (myTeam === null) return row;
  for (const duel of duels) {
    if (duel.attackerTeamNumber === undefined || duel.attackerTeamNumber === null) continue;
    const mine = duel.attackerTeamNumber === myTeam;
    const wonRound = duel.attackerRoundWon === true;
    if (mine) {
      row.openingWon += 1;
      if (wonRound) row.openingWonWon += 1;
      if (duel.traded === false) {
        row.openingWonUntraded += 1;
        if (wonRound) row.openingWonUntradedWon += 1;
      }
    } else {
      row.openingLost += 1;
      if (!wonRound) row.openingLostWon += 1;
    }
  }
  return row;
}

/**
 * Enrich an already-imported match with the full 10-player roster and the
 * round-level advantage funnel. Used by the roster backfill endpoint.
 */
export function importLeetifyRoster(
  items: Array<{ game: LeetifyRosterGame; duels?: LeetifyOpeningDuel[] }>,
  mySteamId: string
): ImportResult {
  const findMatch = db.prepare(
    `SELECT match_id, started_at, map FROM matches
     WHERE match_id = ? OR (ABS(started_at - ?) < 180000 AND map = ?)
     LIMIT 1`
  );
  const upsertMatch = db.prepare(`
    INSERT INTO matches (match_id, season_id, mode, map, format, started_at, ended_at,
      score_us, score_them, result, duration_min, status, source, is_demo, demo_status)
    VALUES (?, 3, 'premier', ?, 'MR12', ?, NULL, ?, ?, ?, NULL, 'published', 'leetify', 0, 'none')
    ON CONFLICT(match_id) DO UPDATE SET
      score_us = excluded.score_us, score_them = excluded.score_them,
      result = excluded.result, map = excluded.map, started_at = excluded.started_at
  `);
  const upsertPlayer = db.prepare(`
    INSERT INTO match_players (match_id, steamid, name, team, kills, deaths, assists,
      damage, adr, hs_kills, kast, rating, leetify_rating, aim, utility, positioning,
      preaim, reaction_time, rounds_survived, opening_kills, opening_deaths, is_me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, steamid) DO UPDATE SET
      name = excluded.name, team = excluded.team,
      kills = excluded.kills, deaths = excluded.deaths, assists = excluded.assists,
      damage = excluded.damage, adr = excluded.adr, hs_kills = excluded.hs_kills,
      kast = excluded.kast, rating = excluded.rating,
      leetify_rating = excluded.leetify_rating,
      aim = COALESCE(excluded.aim, match_players.aim),
      utility = COALESCE(excluded.utility, match_players.utility),
      positioning = COALESCE(excluded.positioning, match_players.positioning),
      preaim = excluded.preaim, reaction_time = excluded.reaction_time,
      rounds_survived = excluded.rounds_survived,
      opening_kills = excluded.opening_kills, opening_deaths = excluded.opening_deaths,
      is_me = excluded.is_me
  `);
  const upsertFunnel = db.prepare(`
    INSERT INTO match_funnel (match_id, rounds, opening_won, opening_won_won,
      opening_won_untraded, opening_won_untraded_won, opening_lost, opening_lost_won, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'leetify')
    ON CONFLICT(match_id) DO UPDATE SET
      rounds = excluded.rounds, opening_won = excluded.opening_won,
      opening_won_won = excluded.opening_won_won,
      opening_won_untraded = excluded.opening_won_untraded,
      opening_won_untraded_won = excluded.opening_won_untraded_won,
      opening_lost = excluded.opening_lost, opening_lost_won = excluded.opening_lost_won
  `);

  let imported = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const item of items) {
      const game = item.game;
      const players = game.playerStats ?? [];
      const me = players.find((player) => player.steam64Id === mySteamId);
      if (!game.id || !game.finishedAt || !me) {
        skipped += 1;
        continue;
      }
      const map = game.mapName ?? "unknown";
      const startedAt = new Date(game.finishedAt).getTime();
      const existing = findMatch.get(`leetify:${game.id}`, startedAt, map) as
        | { match_id: string; started_at: number; map: string }
        | undefined;
      const matchId = existing?.match_id ?? `leetify:${game.id}`;

      const rounds =
        (me.ctRoundsWon ?? 0) +
          (me.ctRoundsLost ?? 0) +
          (me.tRoundsWon ?? 0) +
          (me.tRoundsLost ?? 0) || 0;
      const scoreUs = (me.ctRoundsWon ?? 0) + (me.tRoundsWon ?? 0);
      const scoreThem = (me.ctRoundsLost ?? 0) + (me.tRoundsLost ?? 0);
      const us = rounds ? scoreUs : 0;
      const them = rounds ? scoreThem : 0;
      const result = us > them ? "win" : us < them ? "loss" : "tie";
      const myTeam = me.initialTeamNumber ?? null;
      const playerRounds = rounds || 1;

      const openingKills = new Map<string, number>();
      const openingDeaths = new Map<string, number>();
      for (const duel of item.duels ?? []) {
        if (duel.attackerSteam64Id) {
          openingKills.set(duel.attackerSteam64Id, (openingKills.get(duel.attackerSteam64Id) ?? 0) + 1);
        }
        if (duel.victimSteam64Id) {
          openingDeaths.set(duel.victimSteam64Id, (openingDeaths.get(duel.victimSteam64Id) ?? 0) + 1);
        }
      }

      upsertMatch.run(matchId, map, startedAt, us, them, result);

      for (const player of players) {
        if (!player.steam64Id) continue;
        const isMe = player.steam64Id === mySteamId;
        const sameTeam =
          myTeam !== null && player.initialTeamNumber !== undefined
            ? player.initialTeamNumber === myTeam
            : isMe;
        // `/api/games/<id>` names the same scores `aimRating` /
        // `utilityRating` / `positioningRating`; history uses `aim` etc.
        const aim = player.aim ?? player.aimRating ?? null;
        const utility = player.utility ?? player.utilityRating ?? null;
        const positioning = player.positioning ?? player.positioningRating ?? null;
        upsertPlayer.run(
          matchId,
          player.steam64Id,
          player.name ?? (isMe ? "you" : `player_${player.steam64Id.slice(-6)}`),
          sameTeam ? "us" : "them",
          player.totalKills ?? 0,
          player.totalDeaths ?? 0,
          player.totalAssists ?? 0,
          player.totalDamage ?? 0,
          (player.totalDamage ?? 0) / playerRounds,
          Math.round((player.totalKills ?? 0) * (player.hsp ?? 0)),
          player.kast ?? 0,
          player.hltvRating ?? 0,
          player.leetifyRating ?? 0,
          aim,
          utility,
          positioning,
          player.preaim ?? null,
          player.reactionTime ?? null,
          player.roundsSurvived ?? null,
          openingKills.get(player.steam64Id) ?? 0,
          openingDeaths.get(player.steam64Id) ?? 0,
          isMe ? 1 : 0
        );
      }

      const funnel = funnelFromDuels(item.duels ?? [], myTeam, rounds);
      upsertFunnel.run(
        matchId,
        funnel.rounds,
        funnel.openingWon,
        funnel.openingWonWon,
        funnel.openingWonUntraded,
        funnel.openingWonUntradedWon,
        funnel.openingLost,
        funnel.openingLostWon
      );
      imported += 1;
    }
  });
  tx();

  return { imported, skipped };
}

/** Matches that still have fewer than 10 player rows, i.e. need a roster pull. */
export function pendingRosterIds(limit = 500): string[] {
  const rows = db
    .prepare(
      `SELECT m.match_id AS id
       FROM matches m
       WHERE m.source = 'leetify' AND m.status = 'published'
         AND (SELECT COUNT(*) FROM match_players p WHERE p.match_id = m.match_id) < 10
       ORDER BY m.started_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ id: string }>;
  return rows.map((row) => row.id.replace(/^leetify:/, ""));
}

export { MY_FALLBACK };
