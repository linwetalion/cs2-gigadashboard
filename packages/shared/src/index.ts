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
  rating: number;
  delta: number;
}

export interface PlayerSummary {
  steamId: string;
  name: string;
  avatar?: string;
  rank?: number;
  faceitElo?: number;
}
