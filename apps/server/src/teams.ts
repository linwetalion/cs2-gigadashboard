import type {
  FunnelStage,
  MatchSummary,
  TeamDetailPayload,
  TeamListItem,
  TeamMapStat,
  TeamMemberStat,
  TeamPlayerRef,
  TeamsPayload,
} from "@giga/shared";
import { defaultFilters, filters as filterDefs } from "./filters.js";
import { filteredMatches } from "./dashboard.js";
import { db } from "./db.js";

const PLAYER = { steamId: "76561198075131708", name: "ULTIMATE" };
const TEAM_SIZE = 5;

interface PlayerRow {
  match_id: string;
  steamid: string;
  name: string | null;
  team: string | null;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  adr: number;
  hs_kills: number;
  kast: number | null;
  rating: number | null;
  leetify_rating: number | null;
  aim: number | null;
  utility: number | null;
  positioning: number | null;
  preaim: number | null;
  reaction_time: number | null;
  rounds_survived: number | null;
  opening_kills: number | null;
  opening_deaths: number | null;
  is_me: number;
}

interface FunnelRow {
  match_id: string;
  rounds: number;
  opening_won: number;
  opening_won_won: number;
  opening_won_untraded: number;
  opening_won_untraded_won: number;
  opening_lost: number;
  opening_lost_won: number;
  all_survived_won: number | null;
}

interface MatchMeta {
  matchId: string;
  map: string;
  startedAt: number;
  scoreUs: number;
  scoreThem: number;
  result: string;
  source: string;
  isDemo: boolean;
}

interface TeamAggregate {
  key: string;
  players: TeamPlayerRef[];
  matches: MatchMeta[];
  rows: PlayerRow[];
  funnel: FunnelRow[];
}

function normalizeFilters(raw: Record<string, string | undefined>): Record<string, string> {
  const filters = { ...defaultFilters() };
  for (const filter of filterDefs) {
    const value = raw[filter.id];
    if (!value) continue;
    const valid =
      filter.kind === "date"
        ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        : filter.options.some((option) => option.value === value);
    if (valid) filters[filter.id] = value;
  }
  return filters;
}

function teamKey(steamIds: string[]): string {
  return [...steamIds].sort().join("-");
}

function avg(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) {
      sum += value;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

function weighted(
  rows: Array<{ value: number | null | undefined; weight: number }>
): number | null {
  let sum = 0;
  let total = 0;
  for (const row of rows) {
    if (typeof row.value !== "number" || !Number.isFinite(row.value) || row.value === 0) continue;
    sum += row.value * row.weight;
    total += row.weight;
  }
  return total ? sum / total : null;
}

/**
 * Mean of the non-empty values, but only when they cover at least `minShare`
 * of the rows. Prevents a team average that silently reflects one player.
 */
function avgCovered<T>(
  rows: T[],
  pick: (row: T) => number | null,
  minShare = 0.5
): number | null {
  const values: number[] = [];
  for (const row of rows) {
    const value = pick(row);
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) values.push(value);
  }
  if (!values.length || values.length / rows.length < minShare) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function collectTeams(filters: Record<string, string>): {
  matches: MatchSummary[];
  teams: Map<string, TeamAggregate>;
  matchesWithRoster: number;
} {
  const matches = filteredMatches(filters);
  const matchIds = new Set(matches.map((match) => match.matchId));
  const metaById = new Map<string, MatchMeta>(
    matches.map((match) => [
      match.matchId,
      {
        matchId: match.matchId,
        map: match.map,
        startedAt: new Date(match.startedAt).getTime(),
        scoreUs: match.scoreUs,
        scoreThem: match.scoreThem,
        result: match.result,
        source: match.source,
        isDemo: match.isDemo,
      } satisfies MatchMeta,
    ])
  );

  const players = db
    .prepare(
      `SELECT p.* FROM match_players p
       JOIN matches m ON m.match_id = p.match_id
       WHERE m.status = 'published' AND m.is_demo = 0`
    )
    .all() as PlayerRow[];

  const byMatch = new Map<string, PlayerRow[]>();
  for (const row of players) {
    if (!matchIds.has(row.match_id)) continue;
    const list = byMatch.get(row.match_id) ?? [];
    list.push(row);
    byMatch.set(row.match_id, list);
  }

  const funnelRows = db
    .prepare("SELECT * FROM match_funnel")
    .all() as FunnelRow[];
  const funnelByMatch = new Map(funnelRows.map((row) => [row.match_id, row]));

  const teams = new Map<string, TeamAggregate>();
  let matchesWithRoster = 0;

  for (const [matchId, roster] of byMatch) {
    const meta = metaById.get(matchId);
    if (!meta) continue;
    const mine = roster.filter((row) => row.team === "us" || row.is_me === 1);
    const unique = new Map(mine.map((row) => [row.steamid, row]));
    if (unique.size !== 5) continue;
    matchesWithRoster += 1;
    const ids = [...unique.keys()];
    const key = teamKey(ids);
    const entry =
      teams.get(key) ??
      ({
        key,
        players: [...unique.values()]
          .map((row) => ({
            steamId: row.steamid,
            name: row.name ?? row.steamid.slice(-6),
            isMe: row.is_me === 1,
          }))
          .sort((a, b) => Number(b.isMe) - Number(a.isMe)),
        matches: [],
        rows: [],
        funnel: [],
      } satisfies TeamAggregate);
    entry.matches.push(meta);
    entry.rows.push(...unique.values());
    const funnel = funnelByMatch.get(matchId);
    if (funnel) entry.funnel.push(funnel);
    teams.set(key, entry);
  }

  return { matches, teams, matchesWithRoster };
}

function funnelFor(aggregate: TeamAggregate): FunnelStage[] {
  const games = aggregate.matches.length;
  const rounds = aggregate.matches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);
  const funnel = aggregate.funnel;
  const openingWon = funnel.reduce((sum, row) => sum + row.opening_won, 0);
  const openingWonWon = funnel.reduce((sum, row) => sum + row.opening_won_won, 0);
  const untraded = funnel.reduce((sum, row) => sum + row.opening_won_untraded, 0);
  const untradedWon = funnel.reduce((sum, row) => sum + row.opening_won_untraded_won, 0);
  const survived = funnel.reduce(
    (sum, row) => sum + (row.all_survived_won ?? 0),
    0
  );
  const hasSurvival = funnel.some((row) => row.all_survived_won !== null && row.all_survived_won !== undefined);
  const perGame = (value: number) => (games ? value / games : 0);

  const stages: FunnelStage[] = [
    {
      id: "rounds",
      label: "Раунды",
      hint: "Все раунды команды за выбранный период",
      rounds,
      perGame: perGame(rounds),
      conversion: null,
      formula: "Сумма (score_us + score_them) по матчам команды",
      available: rounds > 0,
    },
    {
      id: "five_v_four",
      label: "5v4 — выигран опенинг",
      hint: "Раунды, где команда забрала первый килл и получила численное преимущество 5 на 4",
      rounds: openingWon,
      perGame: perGame(openingWon),
      conversion: pct(openingWon, rounds),
      formula: "Раунды с первым киллом в пользу команды / все раунды × 100",
      available: funnel.length > 0,
    },
    {
      id: "win_from_five_v_four",
      label: "Победа из 5v4",
      hint: "Из раундов с преимуществом 5 на 4 — сколько выиграно",
      rounds: openingWonWon,
      perGame: perGame(openingWonWon),
      conversion: pct(openingWonWon, openingWon),
      formula: "Победы в раундах с 5v4 / раунды с 5v4 × 100",
      available: openingWon > 0,
    },
    {
      id: "clean_five_v_four",
      label: "Чистый 5v4",
      hint: "Победа из 5v4, где первый килл не был разменян соперником",
      rounds: untradedWon,
      perGame: perGame(untradedWon),
      conversion: pct(untradedWon, openingWonWon),
      formula: "Победы из 5v4 с неразменянным опенингом / победы из 5v4 × 100",
      available: openingWon > 0,
    },
  ];

  if (hasSurvival) {
    stages.push({
      id: "all_survived",
      label: "Выжила вся команда",
      hint: "Победы из 5v4, в которых все пять игроков команды остались живы",
      rounds: survived,
      perGame: perGame(survived),
      conversion: pct(survived, openingWonWon),
      formula: "Победы из 5v4 без потерь / победы из 5v4 × 100 (нужны раунды из демки)",
      available: true,
    });
  }

  return stages;
}

function listItem(aggregate: TeamAggregate): TeamListItem {
  const games = aggregate.matches.length;
  const wins = aggregate.matches.filter((match) => match.result === "win").length;
  const losses = aggregate.matches.filter((match) => match.result === "loss").length;
  const ties = games - wins - losses;
  const rounds = aggregate.matches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);
  const kills = aggregate.rows.reduce((sum, row) => sum + row.kills, 0);
  const deaths = aggregate.rows.reduce((sum, row) => sum + row.deaths, 0);
  const damage = aggregate.rows.reduce((sum, row) => sum + row.damage, 0);
  const hsKills = aggregate.rows.reduce((sum, row) => sum + row.hs_kills, 0);
  const openingWon = aggregate.funnel.reduce((sum, row) => sum + row.opening_won, 0);
  const openingWonWon = aggregate.funnel.reduce((sum, row) => sum + row.opening_won_won, 0);
  const lastPlayedAt = aggregate.matches.reduce(
    (max, match) => (match.startedAt > max ? match.startedAt : max),
    0
  );

  return {
    key: aggregate.key,
    players: aggregate.players,
    games,
    wins,
    losses,
    ties,
    winRate: pct(wins, games),
    rounds,
    roundsPerGame: games ? rounds / games : 0,
    kills,
    deaths,
    kd: deaths ? kills / deaths : kills,
    adr: rounds ? damage / (rounds * TEAM_SIZE) : 0,
    kast: weighted(
      aggregate.rows.map((row) => ({ value: row.kast, weight: 1 }))
    ) ?? 0,
    hsPct: pct(hsKills, kills),
    aim: avgCovered(aggregate.rows, (row) => row.aim),
    utility: avgCovered(aggregate.rows, (row) => row.utility),
    positioning: avgCovered(aggregate.rows, (row) => row.positioning),
    leetifyRating: avg(aggregate.rows.map((row) => row.leetify_rating)),
    openingWon,
    openingWonRate: pct(openingWon, rounds),
    winRateFromOpening: openingWon ? pct(openingWonWon, openingWon) : null,
    lastPlayedAt: lastPlayedAt ? new Date(lastPlayedAt).toISOString() : "",
    maps: [...new Set(aggregate.matches.map((match) => match.map))].sort(),
  };
}

function memberStats(aggregate: TeamAggregate): TeamMemberStat[] {
  const byPlayer = new Map<string, PlayerRow[]>();
  for (const row of aggregate.rows) {
    const list = byPlayer.get(row.steamid) ?? [];
    list.push(row);
    byPlayer.set(row.steamid, list);
  }
  const roundsByMatch = new Map(
    aggregate.matches.map((match) => [match.matchId, match.scoreUs + match.scoreThem])
  );

  return [...byPlayer.entries()]
    .map(([steamId, rows]) => {
      const games = rows.length;
      const kills = rows.reduce((sum, row) => sum + row.kills, 0);
      const deaths = rows.reduce((sum, row) => sum + row.deaths, 0);
      const assists = rows.reduce((sum, row) => sum + row.assists, 0);
      const damage = rows.reduce((sum, row) => sum + row.damage, 0);
      const rounds = rows.reduce((sum, row) => sum + (roundsByMatch.get(row.match_id) ?? 0), 0);
      const hsKills = rows.reduce((sum, row) => sum + row.hs_kills, 0);
      const survived = rows.reduce((sum, row) => sum + (row.rounds_survived ?? 0), 0);
      const survivalRounds = rows.reduce(
        (sum, row) => sum + (row.rounds_survived === null ? 0 : roundsByMatch.get(row.match_id) ?? 0),
        0
      );
      return {
        steamId,
        name: rows[0]?.name ?? steamId.slice(-6),
        isMe: rows.some((row) => row.is_me === 1),
        games,
        kills,
        deaths,
        assists,
        kd: deaths ? kills / deaths : kills,
        adr: rounds ? damage / rounds : 0,
        kast:
          weighted(rows.map((row) => ({ value: row.kast, weight: roundsByMatch.get(row.match_id) ?? 0 }))) ?? 0,
        hsPct: pct(hsKills, kills),
        rating: weighted(
          rows.map((row) => ({ value: row.rating, weight: roundsByMatch.get(row.match_id) ?? 0 }))
        ) ?? 0,
        aim: avgCovered(rows, (row) => row.aim),
        utility: avgCovered(rows, (row) => row.utility),
        positioning: avgCovered(rows, (row) => row.positioning),
        leetifyRating: avg(rows.map((row) => row.leetify_rating)),
        openingKills: rows.reduce((sum, row) => sum + (row.opening_kills ?? 0), 0),
        openingDeaths: rows.reduce((sum, row) => sum + (row.opening_deaths ?? 0), 0),
        survivalPct: survivalRounds ? pct(survived, survivalRounds) : null,
      } satisfies TeamMemberStat;
    })
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || b.rating - a.rating);
}

function mapStats(aggregate: TeamAggregate): TeamMapStat[] {
  const byMap = new Map<string, { matches: MatchMeta[]; rows: PlayerRow[] }>();
  const matchById = new Map(aggregate.matches.map((match) => [match.matchId, match]));
  for (const match of aggregate.matches) {
    const entry = byMap.get(match.map) ?? { matches: [], rows: [] };
    entry.matches.push(match);
    byMap.set(match.map, entry);
  }
  for (const row of aggregate.rows) {
    const match = matchById.get(row.match_id);
    if (!match) continue;
    byMap.get(match.map)?.rows.push(row);
  }

  return [...byMap.entries()]
    .map(([map, entry]) => {
      const games = entry.matches.length;
      const wins = entry.matches.filter((match) => match.result === "win").length;
      const losses = entry.matches.filter((match) => match.result === "loss").length;
      const rounds = entry.matches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);
      const damage = entry.rows.reduce((sum, row) => sum + row.damage, 0);
      const last = entry.matches.reduce(
        (max, match) => (match.startedAt > max ? match.startedAt : max),
        0
      );
      return {
        map,
        games,
        wins,
        losses,
        winRate: pct(wins, games),
        rounds,
        aim: avgCovered(entry.rows, (row) => row.aim),
        utility: avgCovered(entry.rows, (row) => row.utility),
        adr: rounds ? damage / (rounds * TEAM_SIZE) : 0,
        kast: weighted(entry.rows.map((row) => ({ value: row.kast, weight: 1 }))) ?? 0,
        lastPlayedAt: last ? new Date(last).toISOString() : "",
      } satisfies TeamMapStat;
    })
    .sort((a, b) => b.games - a.games);
}

function teamAimForMatch(aggregate: TeamAggregate, match: MatchMeta): TeamMapStat {
  const rows = aggregate.rows.filter((row) => row.match_id === match.matchId);
  const rounds = match.scoreUs + match.scoreThem;
  return {
    map: match.map,
    games: 1,
    wins: match.result === "win" ? 1 : 0,
    losses: match.result === "loss" ? 1 : 0,
    winRate: match.result === "win" ? 100 : 0,
    rounds,
    aim: avgCovered(rows, (row) => row.aim),
    utility: avgCovered(rows, (row) => row.utility),
    adr: rounds ? rows.reduce((sum, row) => sum + row.damage, 0) / (rounds * TEAM_SIZE) : 0,
    kast: weighted(rows.map((row) => ({ value: row.kast, weight: 1 }))) ?? 0,
    lastPlayedAt: new Date(match.startedAt).toISOString(),
  };
}

function mapAim(aggregate: TeamAggregate): TeamDetailPayload["mapAim"] {
  const ordered = [...aggregate.matches].sort((a, b) => b.startedAt - a.startedAt);
  const dust2 = ordered.find((match) => match.map === "de_dust2");
  const anchor = dust2 ?? ordered[0] ?? null;
  if (!anchor) return { lastDust2: null, previousMap: null, previousMapName: null };
  const index = ordered.findIndex((match) => match.matchId === anchor.matchId);
  const previous = index >= 0 ? ordered[index + 1] ?? null : null;
  return {
    lastDust2: dust2 ? teamAimForMatch(aggregate, dust2) : null,
    previousMap: previous ? teamAimForMatch(aggregate, previous) : null,
    previousMapName: previous?.map ?? null,
  };
}

function recentMatches(aggregate: TeamAggregate, limit = 12): MatchSummary[] {
  return [...aggregate.matches]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
    .map((match) => {
      const rows = aggregate.rows.filter((row) => row.match_id === match.matchId);
      const rounds = match.scoreUs + match.scoreThem;
      const kills = rows.reduce((sum, row) => sum + row.kills, 0);
      const deaths = rows.reduce((sum, row) => sum + row.deaths, 0);
      return {
        matchId: match.matchId,
        map: match.map,
        mode: "premier",
        season: 3,
        startedAt: new Date(match.startedAt).toISOString(),
        scoreUs: match.scoreUs,
        scoreThem: match.scoreThem,
        result: match.result === "win" ? "win" : match.result === "loss" ? "loss" : "tie",
        kills,
        deaths,
        assists: rows.reduce((sum, row) => sum + row.assists, 0),
        adr: rounds ? rows.reduce((sum, row) => sum + row.damage, 0) / (rounds * TEAM_SIZE) : 0,
        hs: rows.reduce((sum, row) => sum + row.hs_kills, 0),
        kast: weighted(rows.map((row) => ({ value: row.kast, weight: 1 }))) ?? 0,
        rating: weighted(rows.map((row) => ({ value: row.rating, weight: 1 }))) ?? 0,
        aim: avg(rows.map((row) => row.aim)) ?? undefined,
        utility: avg(rows.map((row) => row.utility)) ?? undefined,
        positioning: avg(rows.map((row) => row.positioning)) ?? undefined,
        leetifyRating: avg(rows.map((row) => row.leetify_rating)) ?? undefined,
        delta: 0,
        source:
          match.source === "gc"
            ? "gc"
            : match.source === "steam"
              ? "steam"
              : match.source === "leetify"
                ? "leetify"
                : "demo",
        isDemo: match.isDemo,
      } satisfies MatchSummary;
    });
}

function detail(aggregate: TeamAggregate): TeamDetailPayload {
  const team = listItem(aggregate);
  return {
    team,
    members: memberStats(aggregate),
    maps: mapStats(aggregate),
    funnel: funnelFor(aggregate),
    mapAim: mapAim(aggregate),
    recent: recentMatches(aggregate),
    meta: {
      matches: team.games,
      rounds: team.rounds,
      hasFunnel: aggregate.funnel.length > 0,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function buildTeams(rawFilters: Record<string, string | undefined>): TeamsPayload {
  const filters = normalizeFilters(rawFilters);
  const { matches, teams, matchesWithRoster } = collectTeams(filters);
  const list = [...teams.values()]
    .map(listItem)
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate);

  return {
    generatedAt: new Date().toISOString(),
    filters,
    teams: list.slice(0, 10),
    meta: {
      matches: matches.length,
      matchesWithRoster,
      distinctTeams: list.length,
      minGames: 1,
      player: PLAYER,
    },
  };
}

export function buildTeamDetail(
  key: string,
  rawFilters: Record<string, string | undefined> = {}
): TeamDetailPayload | null {
  const filters = normalizeFilters(rawFilters);
  const { teams } = collectTeams(filters);
  const aggregate = teams.get(key);
  return aggregate ? detail(aggregate) : null;
}

export function buildTeamCompare(a: string, b: string): {
  a: TeamDetailPayload;
  b: TeamDetailPayload;
} {
  const first = buildTeamDetail(a);
  const second = buildTeamDetail(b);
  if (!first || !second) throw new Error("team not found");
  return { a: first, b: second };
}
