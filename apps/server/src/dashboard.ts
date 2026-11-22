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
  demoValue,
  formatMetric,
  readMatches,
  readMetricValue,
} from "./demo.js";
import { metric, metrics, registryVersion } from "./registry.js";
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
  if (scope === "global") {
    const stored = readMetricValue(metricDef.id);
    if (stored) return stored;
  }
  return demoValue(metricDef, scope);
}

function normalizeForRadar(value: number | null): number {
  if (value === null) return 0;
  if (Math.abs(value) <= 10) return Math.max(0, Math.min(100, 50 + value * 5));
  if (Math.abs(value) <= 1.5) return Math.max(0, Math.min(100, value * 100));
  return Math.max(0, Math.min(100, value));
}

function seriesFor(widgetId: string, kind: string, metricIds: string[], values: Record<string, MetricValue>): SeriesPoint[] {
  const first = metric(metricIds[0]);
  if (kind === "line") return demoSeries(first, 20);
  if (kind === "bar" || kind === "stacked") {
    if (metricIds.length > 1) {
      return metricIds.map((id) => ({
        label: metric(id).name,
        value: values[id]?.value ?? null,
      }));
    }
    return demoBreakdown(first, 6);
  }
  if (kind === "radar") {
    return metricIds.map((id) => ({
      label: metric(id).name,
      value: normalizeForRadar(values[id]?.value ?? null),
    }));
  }
  if (kind === "scatter") {
    return Array.from({ length: 18 }, (_, i) => {
      const a = demoSeries(first, 18)[i];
      const b = demoSeries(metric(metricIds[1]), 18)[i];
      return { label: `E${i + 1}`, value: a?.value ?? null, secondary: b?.value ?? null };
    });
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
  applyMatchAggregates(values, matches);

  const series: Record<string, SeriesPoint[]> = {};
  for (const section of sections) {
    for (const widget of section.widgets) {
      for (const id of widget.metricIds) metric(id);
      series[widget.id] = seriesFor(widget.id, widget.kind, widget.metricIds, values);
    }
  }

  const sampleRounds = matches.reduce((sum, match) => sum + match.scoreUs + match.scoreThem, 0);

  return {
    generatedAt: new Date().toISOString(),
    demo: true,
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
  const adr = rounds ? matches.reduce((sum, match) => sum + match.adr * (match.scoreUs + match.scoreThem), 0) / rounds : 0;
  const hsKills = matches.reduce((sum, match) => sum + match.hs, 0);
  const roundDiff = matches.reduce((sum, match) => sum + match.scoreUs - match.scoreThem, 0);

  const put = (id: string, value: number) => {
    const def = metric(id);
    values[id] = {
      metricId: id,
      value,
      display: formatMetric(def, value),
      n: matches.length,
      confidence: matches.length >= 20 ? "high" : matches.length >= 10 ? "medium" : "low",
    };
  };

  put("CTX-001", matches.length);
  put("RES-002", roundDiff);
  put("RES-003", roundDiff / matches.length);
  put("KIL-001", kills);
  put("KIL-002", deaths);
  put("KIL-003", assists);
  put("KIL-004", kills / Math.max(deaths, 1));
  put("KIL-011", adr);
  put("KIL-015", kills ? (hsKills / kills) * 100 : 0);

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
  };
}

function filteredMatches(filters: Record<string, string>): MatchSummary[] {
  const rows = readMatches(200);
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
        rating: Number(row.rating ?? 0),
        delta: 0,
      } satisfies MatchSummary;
    });
}
