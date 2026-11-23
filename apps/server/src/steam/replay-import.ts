import { db } from "../db.js";

/**
 * Steam exposes its own match history with direct replay links on the personal
 * game data page. That page is the only source we need: it carries the map,
 * the finish time and the replay URL, so no third-party API is involved.
 *
 * The replay file name holds the "demo match id", which is *not* the same
 * number the Game Coordinator reports. When a GC row for the same game is
 * already in the database we attach the URL to it; otherwise the demo id
 * becomes the match key.
 */
export interface SteamReplayItem {
  /** `http://replayNNN.valve.net/730/<matchId>_<outcomeId>.dem.bz2` */
  url: string;
  /** `2026-11-23 20:48:51` in UTC, as printed by Steam. */
  playedAt?: string;
  /** `Mirage`, `Dust2`, … as printed by Steam. */
  map?: string;
}

export interface ReplayImportResult {
  received: number;
  attached: number;
  inserted: number;
  skipped: number;
}

function parsePlayedAt(value?: string): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function mapFromLabel(label?: string): string {
  if (!label) return "unknown";
  const name = label.replace(/^(Premier|Competitive|Wingman)\s+/i, "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    dust2: "de_dust2",
    dust: "de_dust2",
    mirage: "de_mirage",
    inferno: "de_inferno",
    nuke: "de_nuke",
    ancient: "de_ancient",
    anubis: "de_anubis",
    overpass: "de_overpass",
    vertigo: "de_vertigo",
    train: "de_train",
    cache: "de_cache",
    office: "cs_office",
    italy: "cs_italy",
  };
  return aliases[name] ?? (name.startsWith("de_") || name.startsWith("cs_") ? name : "unknown");
}

function demoMatchId(url: string): string | null {
  const file = url.split("/").pop() ?? "";
  const match = /^(\d+)_/.exec(file);
  return match ? match[1]! : null;
}

export function importSteamReplays(items: SteamReplayItem[]): ReplayImportResult {
  const findByTime = db.prepare(
    `SELECT match_id FROM matches
     WHERE ABS(started_at - ?) < 180000
     ORDER BY ABS(started_at - ?) ASC
     LIMIT 1`
  );
  const attach = db.prepare(
    "UPDATE matches SET demo_url = ?, demo_status = 'available' WHERE match_id = ?"
  );
  const insert = db.prepare(`
    INSERT INTO matches (match_id, season_id, mode, map, format, started_at, ended_at,
      score_us, score_them, result, duration_min, status, source, is_demo, demo_url, demo_status)
    VALUES (?, 3, 'premier', ?, 'MR12', ?, NULL, 0, 0, 'tie', NULL, 'published', 'steam', 0, ?, 'available')
    ON CONFLICT(match_id) DO UPDATE SET
      demo_url = excluded.demo_url,
      demo_status = 'available',
      map = CASE WHEN matches.map = 'unknown' THEN excluded.map ELSE matches.map END
  `);

  const result: ReplayImportResult = {
    received: items.length,
    attached: 0,
    inserted: 0,
    skipped: 0,
  };

  const tx = db.transaction(() => {
    for (const item of items) {
      if (!item.url || !item.url.includes(".dem.bz2")) {
        result.skipped += 1;
        continue;
      }
      const startedAt = parsePlayedAt(item.playedAt);
      const id = demoMatchId(item.url);
      if (!startedAt || !id) {
        result.skipped += 1;
        continue;
      }
      const map = mapFromLabel(item.map);
      const existing = findByTime.get(startedAt, startedAt) as { match_id: string } | undefined;
      if (existing) {
        attach.run(item.url, existing.match_id);
        result.attached += 1;
      } else {
        insert.run(id, map, startedAt, item.url);
        result.inserted += 1;
      }
    }
  });
  tx();

  return result;
}
