import { db } from "../db.js";
import { computeDemoMetrics } from "../demo-metrics.js";
import { processDemo } from "./demo-parse.js";
import { importSteamReplays, type SteamReplayItem } from "./replay-import.js";
import { storedSession } from "./login.js";
import { webCookies } from "./worker.js";

/**
 * Automatic ingestion of new matches.
 *
 * Steam exposes the personal match history as an ajax endpoint that contains
 * direct replay links. The Steam/GC worker obtains web session cookies through
 * `webLogOn()`, so the poller needs no browser and no third-party API.
 *
 * Every poll: read the newest history pages → import new replay URLs → download
 * and parse the ones we have not parsed yet.
 */

const HISTORY_URL = (steamId: string, page = 0, token?: string) =>
  `https://steamcommunity.com/profiles/${steamId}/gcpd/730/?tab=matchhistorypremier&ajax=1` +
  (page > 0 && token ? `&continue_token=${encodeURIComponent(token)}` : "");

const DEMO_LINK = /(https?:\/\/replay\d+\.valve\.net\/730\/\d+_\d+\.dem\.bz2)/g;
const DATE = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) GMT/;
const MAP = /(Premier|Competitive|Wingman)\s+([A-Za-z0-9 ]{2,24})/;

export interface AutoIngestStatus {
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastFound: number;
  lastImported: number;
  lastParsed: number;
  parsedTotal: number;
  pending: number;
}

export const autoIngestStatus: AutoIngestStatus = {
  enabled: false,
  running: false,
  lastRunAt: null,
  lastError: null,
  lastFound: 0,
  lastImported: 0,
  lastParsed: 0,
  parsedTotal: 0,
  pending: 0,
};

function extractItems(html: string): SteamReplayItem[] {
  const items: SteamReplayItem[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  DEMO_LINK.lastIndex = 0;
  while ((match = DEMO_LINK.exec(html))) {
    const url = match[1]!;
    if (seen.has(url)) continue;
    seen.add(url);
    const before = html.slice(Math.max(0, match.index - 4000), match.index);
    const date = [...before.matchAll(new RegExp(DATE, "g"))].pop();
    const map = [...before.matchAll(new RegExp(MAP, "g"))].pop();
    items.push({
      url,
      playedAt: date?.[1],
      map: map ? `${map[1]} ${map[2]}` : undefined,
    });
  }
  return items;
}

async function fetchHistoryPage(steamId: string, token?: string): Promise<{
  html: string;
  next: string | null;
}> {
  const cookies = webCookies();
  if (!cookies) throw new Error("No Steam web session yet");
  const response = await fetch(HISTORY_URL(steamId, token ? 1 : 0, token), {
    headers: {
      Cookie: cookies,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "User-Agent": "Mozilla/5.0 (compatible; GigaDashboard/1.0)",
    },
  });
  if (!response.ok) throw new Error(`Steam history ${response.status}`);
  const payload = (await response.json()) as { html?: string; continue_token?: string };
  return { html: payload.html ?? "", next: payload.continue_token ?? null };
}

function pendingMatches(): Array<{ match_id: string; demo_url: string }> {
  return db
    .prepare(
      `SELECT match_id, demo_url FROM matches
       WHERE demo_url IS NOT NULL
         AND (demo_status IS NULL OR demo_status NOT IN ('parsed', 'expired'))
       ORDER BY started_at DESC`
    )
    .all() as Array<{ match_id: string; demo_url: string }>;
}

export async function runAutoIngestOnce(pages = 2): Promise<AutoIngestStatus> {
  if (autoIngestStatus.running) return autoIngestStatus;
  const session = storedSession();
  if (!session) {
    autoIngestStatus.lastError = "Steam session not found";
    return autoIngestStatus;
  }

  autoIngestStatus.running = true;
  autoIngestStatus.lastError = null;
  autoIngestStatus.lastFound = 0;
  autoIngestStatus.lastImported = 0;
  autoIngestStatus.lastParsed = 0;

  try {
    const items: SteamReplayItem[] = [];
    let token: string | null = null;
    for (let page = 0; page < pages; page++) {
      const result = await fetchHistoryPage(session.steamId, token ?? undefined);
      items.push(...extractItems(result.html));
      if (!result.next || result.next === token) break;
      token = result.next;
    }
    autoIngestStatus.lastFound = items.length;

    if (items.length) {
      const imported = importSteamReplays(items);
      autoIngestStatus.lastImported = imported.inserted + imported.attached;
    }

    // Parse what is new, newest first.
    for (const row of pendingMatches()) {
      try {
        const parsed = await processDemo(row.match_id, row.demo_url, session.steamId);
        computeDemoMetrics(row.match_id);
        db.prepare(
          "UPDATE matches SET demo_status = 'parsed', source = 'steam' WHERE match_id = ?"
        ).run(row.match_id);
        autoIngestStatus.lastParsed += 1;
        autoIngestStatus.parsedTotal += 1;
        console.info(
          `[auto] parsed ${row.match_id}: ${parsed.rounds} rounds, ${parsed.kills} kills`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/404|not found/i.test(message)) {
          db.prepare("UPDATE matches SET demo_status = 'expired' WHERE match_id = ?").run(row.match_id);
        }
        autoIngestStatus.lastError = `${row.match_id}: ${message}`;
      }
    }
  } catch (error) {
    autoIngestStatus.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    autoIngestStatus.running = false;
    autoIngestStatus.lastRunAt = new Date().toISOString();
    autoIngestStatus.pending = pendingMatches().length;
    try {
      autoIngestStatus.parsedTotal = (
        db.prepare("SELECT COUNT(*) c FROM matches WHERE demo_status = 'parsed'").get() as {
          c: number;
        }
      ).c;
    } catch {
      // ignore
    }
  }

  return autoIngestStatus;
}

let timer: NodeJS.Timeout | null = null;

export function startAutoIngest(intervalMinutes: number): void {
  autoIngestStatus.enabled = true;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void runAutoIngestOnce();
  }, Math.max(2, intervalMinutes) * 60_000);
  timer.unref?.();
  // First pass shortly after boot, once the GC/web session has settled.
  setTimeout(() => void runAutoIngestOnce(), 20_000).unref?.();
}

export function stopAutoIngest(): void {
  if (timer) clearInterval(timer);
  timer = null;
  autoIngestStatus.enabled = false;
}
