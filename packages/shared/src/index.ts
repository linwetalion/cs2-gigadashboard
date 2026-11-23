export type Direction = "up" | "down" | "neutral";

export type Confidence = "low" | "medium" | "high" | "none";

export interface Metric {
  id: string;
  name: string;
  domain: string;
  unit: string;
  direction: Direction;
  minSample: number;
  formula: string;
  tooltip: string;
  include?: string;
  exclude?: string;
  aggregation?: string;
  canon?: string;
  alias?: string;
  derived?: string;
  sources: string[];
  version: number;
}

export interface MetricValue {
  metricId: string;
  value: number | null;
  display: string;
  n: number;
  confidence: Confidence;
  delta?: number | null;
  benchmark?: number | null;
  percentile?: number | null;
  previous?: number | null;
  reason?: string;
  source?: "computed" | "demo" | "unavailable";
}

export type WidgetKind =
  | "kpi"
  | "line"
  | "bar"
  | "stacked"
  | "heatmap"
  | "radar"
  | "scatter"
  | "table"
  | "map"
  | "timeline";

export type WidgetSize = "S" | "M" | "L" | "XL";

export interface Widget {
  id: string;
  section: string;
  metricIds: string[];
  title: string;
  kind: WidgetKind;
  size: WidgetSize;
  subtitle?: string;
}

export interface Section {
  id: string;
  title: string;
  description: string;
  widgets: Widget[];
}

export interface SeriesPoint {
  label: string;
  value: number | null;
  secondary?: number | null;
}

export interface DashboardPayload {
  generatedAt: string;
  demo: boolean;
  filters: Record<string, string | string[]>;
  sections: Section[];
  values: Record<string, MetricValue>;
  series: Record<string, SeriesPoint[]>;
  matches: MatchSummary[];
  meta: {
    player: { steamId: string; name: string; avatar?: string };
    sampleMatches: number;
    sampleRounds: number;
    registryVersion: string;
    filters: FilterDefinition[];
  };
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDefinition {
  id: string;
  label: string;
  options: FilterOption[];
  multiple?: boolean;
  defaultValue: string;
}

export interface MatchSummary {
  matchId: string;
  map: string;
  mode: string;
  season: number;
  startedAt: string;
  scoreUs: number;
  scoreThem: number;
  result: "win" | "loss" | "tie";
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  hs: number;
  kast?: number;
  rating: number;
  aim?: number;
  utility?: number;
  positioning?: number;
  leetifyRating?: number;
  delta: number;
  source: "demo" | "gc" | "leetify";
  isDemo: boolean;
}

export interface PlayerSummary {
  steamId: string;
  name: string;
  avatar?: string;
  rank?: number;
  faceitElo?: number;
}

export interface TeamPlayerRef {
  steamId: string;
  name: string;
  isMe: boolean;
}

export interface TeamListItem {
  key: string;
  players: TeamPlayerRef[];
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  rounds: number;
  roundsPerGame: number;
  kills: number;
  deaths: number;
  kd: number;
  adr: number;
  kast: number;
  hsPct: number;
  aim: number | null;
  utility: number | null;
  positioning: number | null;
  leetifyRating: number | null;
  openingWon: number;
  openingWonRate: number;
  winRateFromOpening: number | null;
  lastPlayedAt: string;
  maps: string[];
}

export interface TeamMemberStat {
  steamId: string;
  name: string;
  isMe: boolean;
  games: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  adr: number;
  kast: number;
  hsPct: number;
  rating: number;
  aim: number | null;
  utility: number | null;
  positioning: number | null;
  leetifyRating: number | null;
  openingKills: number;
  openingDeaths: number;
  survivalPct: number | null;
}

export interface TeamMapStat {
  map: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  rounds: number;
  aim: number | null;
  utility: number | null;
  adr: number;
  kast: number;
  lastPlayedAt: string;
}

export interface FunnelStage {
  id: string;
  label: string;
  hint: string;
  rounds: number;
  perGame: number;
  conversion: number | null;
  formula: string;
  available: boolean;
}

export interface TeamDetailPayload {
  team: TeamListItem;
  members: TeamMemberStat[];
  maps: TeamMapStat[];
  funnel: FunnelStage[];
  mapAim: {
    lastDust2: TeamMapStat | null;
    previousMap: TeamMapStat | null;
    previousMapName: string | null;
  };
  recent: MatchSummary[];
  meta: {
    matches: number;
    rounds: number;
    hasFunnel: boolean;
    generatedAt: string;
  };
}

export interface TeamsPayload {
  generatedAt: string;
  filters: Record<string, string | string[]>;
  teams: TeamListItem[];
  meta: {
    matches: number;
    matchesWithRoster: number;
    distinctTeams: number;
    minGames: number;
    player: { steamId: string; name: string };
  };
}

export interface TeamComparePayload {
  a: TeamDetailPayload;
  b: TeamDetailPayload;
}

