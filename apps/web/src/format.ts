import type { Metric, MetricValue } from "@giga/shared";

export function deltaLabel(value: MetricValue, metric: Metric): string | null {
  if (value.delta === null || value.delta === undefined || !Number.isFinite(value.delta)) return null;
  if (Math.abs(value.delta) < 0.01) return "0";
  const sign = value.delta > 0 ? "+" : "";
  const unit = metric.unit === "%" ? " пп" : "";
  return `${sign}${value.delta.toFixed(1)}${unit}`;
}

export function goodDirection(value: number | null, metric: Metric, benchmark?: number | null): "good" | "bad" | "neutral" {
  if (value === null || benchmark === null || benchmark === undefined) return "neutral";
  if (Math.abs(value - benchmark) / Math.max(Math.abs(benchmark), 0.0001) < 0.05) return "neutral";
  const better = metric.direction === "up" ? value > benchmark : value < benchmark;
  return better ? "good" : "bad";
}

export function mapName(map: string): string {
  return map.replace(/^de_/, "").replace(/^cs_/, "").replace(/^\w/, (c) => c.toUpperCase());
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}
