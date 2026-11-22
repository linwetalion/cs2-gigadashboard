import type { DashboardPayload, Metric, MetricValue } from "@giga/shared";

export async function fetchDashboard(filters: Record<string, string>): Promise<DashboardPayload> {
  const params = new URLSearchParams(filters);
  const response = await fetch(`/api/dashboard?${params.toString()}`);
  if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
  return response.json() as Promise<DashboardPayload>;
}

export async function fetchMetrics(): Promise<Record<string, Metric>> {
  const response = await fetch("/api/metrics");
  if (!response.ok) throw new Error(`Metrics request failed: ${response.status}`);
  const payload = (await response.json()) as { metrics: Metric[] };
  return Object.fromEntries(payload.metrics.map((metric) => [metric.id, metric]));
}

export function confidenceLabel(value: MetricValue["confidence"]): string {
  if (value === "high") return "высокая";
  if (value === "medium") return "средняя";
  if (value === "low") return "низкая";
  return "нет данных";
}
