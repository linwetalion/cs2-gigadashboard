import type {
  DashboardPayload,
  MatchSummary,
  Metric,
  MetricValue,
  SeriesPoint,
} from "@giga/shared";
import { defaultFilters, filters as filterDefs } from "./filters.js";
import {
  demoBreakdown,
  demoSeries,
  formatMetric,
  readMatches,
  readMetricValue,
  unavailableValue,
} from "./demo.js";
import { metric, metrics, registryVersion } from "./registry.js";
import { applyRealMetrics } from "./real-metrics.js";
import {
  applyDemoMetrics,
  applyExtendedMetrics,
  applyHighlightMetrics,
  applyPositionMetrics,
  applySessionMetrics,
} from "./demo-metrics.js";
import { sections } from "./widgets.js";

const PLAYER = {
  steamId: "76561198075131708",
  name: "ULTIMATE",
};

function scopeFrom(filters: Record<string, string>): string {
  const defaults = defaultFilters();
  const changed = Object.entries(filters).filter(([key, value]) => defaults[key] !== value);
  if (changed.length === 0) return "global";
  return changed
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

function valueFor(metricDef: Metric, scope: string): MetricValue {
  const stored = readMetricValue(metricDef.id);
  if (stored) return stored;
  // Nothing is invented: a metric without a real source is reported as N/A.
  return unavailableValue(metricDef, "NO_SOURCE");
}

function normalizeForRadar(value: number | null): number {
  if (value === null) return 0;
  if (Math.abs(value) <= 10) return Math.max(0, Math.min(100, 50 + value * 5));
  if (Math.abs(value) <= 1.5) return Math.max(0, Math.min(100, value * 100));
  return Math.max(0, Math.min(100, value));
}

function matchSeries(metricIds: string[], matches: MatchSummary[]): SeriesPoint[] {
  const id = metricIds[0];
  const pick = (match: MatchSummary): number | null => {
    switch (id) {
      case "KIL-001":
        return match.kills;
      case "KIL-002":
        return match.deaths;
      case "KIL-003":
        return match.assists;
      case "KIL-004":
        return match.deaths ? match.kills / match.deaths : null;
      case "KIL-011":
        return match.adr || null;
      case "KIL-015":
        return match.kills ? (match.hs / match.kills) * 100 : null;
      case "KIL-009":
        return match.kast && match.kast > 0 ? match.kast : null;
      case "IMP-002":
        return match.rating || null;
      case "RES-003":
        return match.scoreUs - match.scoreThem;
      case "CTX-002":
        return match.result === "win" ? 100 : match.result === "loss" ? 0 : 50;
      default:
        return null;
    }
  };

  return [...matches]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-20)
    .map((match) => ({
      label: new Date(match.startedAt).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
      }),
      value: pick(match),
    }));
}

function seriesFor(
  widgetId: string,
  kind: string,
  metricIds: string[],
  values: Record<string, MetricValue>,
  matches: MatchSummary[]
): SeriesPoint[] {
  if (kind === "line") return matchSeries(metricIds, matches);
  if (kind === "bar" || kind === "stacked") {
    if (metricIds.length > 1) {
      return metricIds.map((id) => ({
        label: metric(id).name,
        value: values[id]?.value ?? null,
      }));
    }
    return matchSeries(metricIds, matches);
  }
  if (kind === "radar") {
    return metricIds.map((id) => ({
      label: metric(id).name,
      value: normalizeForRadar(values[id]?.value ?? null),
    }));
  }
  return [];
}

export function buildDashboard(rawFilters: Record<string, string | undefined>): DashboardPayload {
  const filters = { ...defaultFilters() };
  for (const filter of filterDefs) {
    const value = rawFilters[filter.id];
    if (value && filter.options.some((option) => option.value === value)) {
      filters[filter.id] = value;
    }
  }

  const scope = scopeFrom(filters);
  const values: Record<string, MetricValue> = {};
  for (const metricDef of metrics) {
    values[metricDef.id] = valueFor(metricDef, scope);
  }

  const matches = filteredMatches(filters);
  const realIds = matches.filter((match) => !match.isDemo).map((match) => match.matchId);
  applyMatchAggregates(values, matches);
  applyRealMetrics(values, realIds);
  applyDemoMetrics(values, realIds);
  applyExtendedMetrics(values, realIds);
  applyPositionMetrics(values, realIds);
  applyHighlightMetrics(values, realIds);
  applySessionMetrics(values, matches);

  const series: Record<string, SeriesPoint[]> = {};
  for (const section of sections) {
    for (const widget of section.widgets) {
      for (const id of widget.metricIds) metric(id);
      series[widget.id] = seriesFor(widget.id, widget.kind, widget.metricIds, values, matches);
    }
  }

  const sampleRounds = matches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);
  const demo = matches.every((match) => match.isDemo);

  return {
    generatedAt: new Date().toISOString(),
    demo,
    filters,
    sections,
    values,
    series,
    matches,
    meta: {
      player: PLAYER,
      sampleMatches: matches.length,
      sampleRounds,
      registryVersion,
      filters: filterDefs,
    },
  };
}

function applyMatchAggregates(values: Record<string, MetricValue>, matches: MatchSummary[]): void {
  if (!matches.length) return;
  const kills = matches.reduce((sum, match) => sum + match.kills, 0);
  const deaths = matches.reduce((sum, match) => sum + match.deaths, 0);
  const assists = matches.reduce((sum, match) => sum + match.assists, 0);
  const wins = matches.filter((match) => match.result === "win").length;
  const rounds = matches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);
  const adrMatches = matches.filter((match) => match.adr > 0);
  const adrRounds = adrMatches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);
  const adr = adrRounds
    ? adrMatches.reduce((sum, match) => sum + match.adr * (match.scoreUs + match.scoreThem), 0) / adrRounds
    : 0;
  const hsKills = matches.reduce((sum, match) => sum + match.hs, 0);
  const roundDiff = matches.reduce((sum, match) => sum + match.scoreUs - match.scoreThem, 0);
  const parsedMatches = matches.filter((match) => match.kast && match.kast > 0);
  const parsedRounds = parsedMatches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);
  const kast = parsedRounds
    ? parsedMatches.reduce((sum, match) => sum + (match.kast ?? 0) * (match.scoreUs + match.scoreThem), 0) / parsedRounds
    : 0;

  const weighted = (
    selector: (match: MatchSummary) => number | undefined,
    allowNegative = false
  ) => {
    let sum = 0;
    let weight = 0;
    for (const match of matches) {
      const value = selector(match);
      if (value === undefined || value === null || Number.isNaN(value)) continue;
      if (allowNegative ? value === 0 : value <= 0) continue;
      const rounds = match.scoreUs + match.scoreThem;
      sum += value * rounds;
      weight += rounds;
    }
    return weight ? sum / weight : null;
  };

  const hltv = weighted((match) => match.rating);
  const aimRating = weighted((match) => match.aim);
  const utilityRating = weighted((match) => match.utility);
  const positioningRating = weighted((match) => match.positioning);
  const leetifyRating = weighted((match) => match.leetifyRating, true);

  const put = (id: string, value: number) => {
    const def = metric(id);
    values[id] = {
      metricId: id,
      value,
      display: formatMetric(def, value),
      n: matches.length,
      confidence: matches.length >= 20 ? "high" : matches.length >= 10 ? "medium" : "low",
      source: "computed",
    };
  };

  put("CTX-001", matches.length);
  put("RES-002", roundDiff);
  put("RES-003", roundDiff / matches.length);
  put("KIL-001", kills);
  put("KIL-002", deaths);
  put("KIL-003", assists);
  put("KIL-004", kills / Math.max(deaths, 1));
  if (adrRounds > 0) put("KIL-011", adr);
  if (hsKills > 0) put("KIL-015", kills ? (hsKills / kills) * 100 : 0);
  if (parsedRounds > 0) put("KIL-009", kast);
  if (hltv !== null) put("IMP-002", hltv);
  if (aimRating !== null) put("IMP-011", aimRating);
  if (utilityRating !== null) {
    put("UTL-038", utilityRating);
    put("IMP-012", utilityRating);
  }
  if (positioningRating !== null) put("IMP-013", positioningRating);
  if (leetifyRating !== null) put("IMP-006", leetifyRating);

  const winRate = (wins / matches.length) * 100;
  values["CTX-002"] = {
    metricId: "CTX-002",
    value: winRate,
    display: formatMetric(metric("CTX-002"), winRate),
    n: matches.length,
    confidence: matches.length >= 20 ? "high" : matches.length >= 10 ? "medium" : "low",
    delta: winRate - 50,
    benchmark: 50,
    percentile: Math.round(winRate),
    source: "computed",
  };
}

export function filteredMatches(filters: Record<string, string>): MatchSummary[] {
  const rows = readMatches(1000);
  const now = Date.now();
  const rangeMs =
    filters.range === "7d"
      ? 7 * 864e5
      : filters.range === "30d"
        ? 30 * 864e5
        : filters.range === "90d"
          ? 90 * 864e5
          : Number.POSITIVE_INFINITY;

  return rows
    .filter((row) => {
      const startedAt = Number(row.started_at);
      if (filters.range !== "all" && filters.range !== "season" && now - startedAt > rangeMs) {
        return false;
      }
      if (filters.season && String(row.season_id) !== filters.season) return false;
      if (filters.mode && row.mode !== filters.mode) return false;
      if (filters.map !== "all" && row.map !== filters.map) return false;
      if (filters.result !== "all" && row.result !== filters.result) return false;
      return true;
    })
    .map((row) => {
      const scoreUs = Number(row.score_us);
      const scoreThem = Number(row.score_them);
      return {
        matchId: String(row.match_id),
        map: String(row.map),
        mode: String(row.mode),
        season: Number(row.season_id ?? 0),
        startedAt: new Date(Number(row.started_at)).toISOString(),
        scoreUs,
        scoreThem,
        result: scoreUs > scoreThem ? "win" : scoreUs < scoreThem ? "loss" : "tie",
        kills: Number(row.kills ?? 0),
        deaths: Number(row.deaths ?? 0),
        assists: Number(row.assists ?? 0),
        adr: Number(row.adr ?? 0),
        hs: Number(row.hs_kills ?? 0),
        kast: Number(row.kast ?? 0),
        rating: Number(row.rating ?? 0),
        aim: Number(row.aim ?? 0),
        utility: Number(row.utility ?? 0),
        positioning: Number(row.positioning ?? 0),
        leetifyRating: Number(row.leetify_rating ?? 0),
        delta: 0,
        source:
          row.source === "gc"
            ? "gc"
            : row.source === "steam"
              ? "steam"
              : row.source === "leetify"
                ? "leetify"
                : "demo",
        isDemo: Number(row.is_demo ?? 0) === 1,
      } satisfies MatchSummary;
    });
}
