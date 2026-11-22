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

export interface SteamLoginState {
  stage: "idle" | "awaiting_guard" | "awaiting_qr" | "authenticating" | "connected" | "error";
  accountName?: string;
  steamId?: string;
  guards: Array<{ kind: "email" | "totp" | "device" | "machine"; detail?: string }>;
  qrDataUrl?: string;
  error?: string;
}

export interface HistoryStatus {
  running: boolean;
  phase: "idle" | "walking" | "fetching" | "done" | "error";
  total: number;
  processed: number;
  failed: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SteamStatus {
  login: SteamLoginState;
  worker: {
    enabled: boolean;
    loggedOn: boolean;
    gcConnected: boolean;
    requests: number;
    lastError: string | null;
    lastMatchAt: string | null;
    accountName?: string;
    steamId?: string;
  };
  syncEnabled: boolean;
  hasToken: boolean;
  hasApiKey?: boolean;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message ?? `Request failed: ${response.status}`);
  return payload as T;
}

export const steamApi = {
  status: async (): Promise<SteamStatus> => {
    const response = await fetch("/api/steam/status");
    if (!response.ok) throw new Error(`Steam status failed: ${response.status}`);
    return response.json() as Promise<SteamStatus>;
  },
  login: (input: { accountName: string; password: string; sharedSecret?: string }) =>
    postJson<SteamLoginState>("/api/steam/login", input),
  guard: (code: string) => postJson<SteamLoginState>("/api/steam/guard", { code }),
  qr: () => postJson<SteamLoginState>("/api/steam/qr"),
  cancel: () => postJson<SteamLoginState>("/api/steam/cancel"),
  logout: () => postJson<SteamLoginState>("/api/steam/logout"),
  sync: () => postJson<{ ok: boolean; message: string }>("/api/sync"),
  history: async (): Promise<{ status: HistoryStatus; canWalk: boolean }> => {
    const response = await fetch("/api/steam/history");
    if (!response.ok) throw new Error(`History status failed: ${response.status}`);
    return response.json() as Promise<{ status: HistoryStatus; canWalk: boolean }>;
  },
  startHistory: (authCode: string, knownCode: string) =>
    postJson<HistoryStatus>("/api/steam/history", { authCode, knownCode }),
};
