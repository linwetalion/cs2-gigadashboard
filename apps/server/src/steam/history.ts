import { STEAM_API_KEY } from "../config.js";
import { db } from "../db.js";
import { walkShareCodes } from "./webapi.js";
import { requestGameByCode } from "./worker.js";
import { storedSession } from "./login.js";

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

export const historyStatus: HistoryStatus = {
  running: false,
  phase: "idle",
  total: 0,
  processed: 0,
  failed: 0,
  lastError: null,
  startedAt: null,
  finishedAt: null,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function canWalkHistory(): boolean {
  return Boolean(STEAM_API_KEY);
}

export async function startHistory(authCode: string, knownCode: string): Promise<HistoryStatus> {
  if (historyStatus.running) return historyStatus;
  if (!STEAM_API_KEY) throw new Error("STEAM_API_KEY is not configured");
  const session = storedSession();
  if (!session) throw new Error("Connect Steam first");

  historyStatus.running = true;
  historyStatus.phase = "walking";
  historyStatus.total = 0;
  historyStatus.processed = 0;
  historyStatus.failed = 0;
  historyStatus.lastError = null;
  historyStatus.startedAt = new Date().toISOString();
  historyStatus.finishedAt = null;

  void (async () => {
    try {
      const codes = await walkShareCodes({
        apiKey: STEAM_API_KEY!,
        steamId: session.steamId,
        authCode,
        knownCode,
        maxPages: 2000,
        delayMs: 250,
      });
      historyStatus.total = codes.length;
      historyStatus.phase = "fetching";

      db.prepare(
        "INSERT INTO sync_state(source, last_code, last_at) VALUES ('history', ?, ?) ON CONFLICT(source) DO UPDATE SET last_code=excluded.last_code, last_at=excluded.last_at"
      ).run(codes.at(-1) ?? knownCode, Date.now());

      for (const code of codes) {
        try {
          const ok = requestGameByCode(code);
          if (!ok) throw new Error("GC not connected");
          await sleep(2600);
          historyStatus.processed += 1;
        } catch (error) {
          historyStatus.failed += 1;
          historyStatus.lastError = error instanceof Error ? error.message : String(error);
        }
      }
      historyStatus.phase = "done";
    } catch (error) {
      historyStatus.phase = "error";
      historyStatus.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      historyStatus.running = false;
      historyStatus.finishedAt = new Date().toISOString();
    }
  })();

  return historyStatus;
}
