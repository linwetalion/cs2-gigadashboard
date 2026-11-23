import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "../apps/server/src/config.js";
import { db } from "../apps/server/src/db.js";
import { processDemo } from "../apps/server/src/steam/demo-parse.js";
import { resolveDemoUrl } from "../apps/server/src/steam/demo-source.js";
import { storedSession } from "../apps/server/src/steam/login.js";

/**
 * Downloads CS2 demos straight from Valve and parses them.
 *
 *   npm run demos:fetch                 # every GC match that is not parsed yet
 *   npm run demos:fetch -- --limit 1    # one match, useful as a smoke test
 *   npm run demos:fetch -- 3855... 3854 # explicit match ids
 *
 * No third-party APIs are involved: the outcome id comes from the Game
 * Coordinator, the host cluster is discovered by probing Valve replay hosts.
 */

interface MatchRow {
  match_id: string;
  map: string;
  demo_url: string | null;
  demo_outcome: string | null;
  demo_cluster: number | null;
  demo_status: string | null;
}

function gcOutcomes(): Map<string, number> {
  const path = resolve(dataDir, "gc-last.json");
  const map = new Map<string, number>();
  try {
    const list = JSON.parse(readFileSync(path, "utf8")) as Array<{
      matchid?: string;
      watchablematchinfo?: { tv_port?: number };
    }>;
    for (const match of list) {
      const outcome = match.watchablematchinfo?.tv_port;
      if (match.matchid && outcome) map.set(match.matchid, outcome);
    }
  } catch {
    // The dump is optional: rows usually already carry demo_outcome.
  }
  return map;
}

function fmtMb(bytes: number): string {
  return `${Math.round((bytes / 1048576) * 10) / 10} MB`;
}

const args = process.argv.slice(2);
const limitIndex = args.findIndex((arg) => arg === "--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Number.POSITIVE_INFINITY;
const explicit = args.filter((arg) => /^\d{6,}$/.test(arg));
const reparse = args.includes("--reparse");

const session = storedSession();
if (!session) {
  console.error("Steam session not found: connect Steam first.");
  process.exit(1);
}

const rows = db
  .prepare(
    reparse
      ? `SELECT match_id, map, demo_url, demo_outcome, demo_cluster, demo_status
         FROM matches
         WHERE demo_url IS NOT NULL AND demo_status = 'parsed'
         ORDER BY started_at DESC`
      : `SELECT match_id, map, demo_url, demo_outcome, demo_cluster, demo_status
         FROM matches
         WHERE source IN ('gc', 'steam')
           AND (demo_status IS NULL OR demo_status NOT IN ('parsed', 'expired'))
         ORDER BY started_at DESC`
  )
  .all() as MatchRow[];

const outcomes = gcOutcomes();
const pending = rows
  .filter((row) => (explicit.length ? explicit.includes(row.match_id) : true))
  .slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(`matches to fetch: ${pending.length} of ${rows.length} pending`);

let ok = 0;
let failed = 0;

for (const [index, row] of pending.entries()) {
  const label = `[${index + 1}/${pending.length}] ${row.match_id}`;
  const outcome = row.demo_outcome ?? outcomes.get(row.match_id)?.toString() ?? null;

  try {
    let resolved: { url: string; cluster: number | null } | null = row.demo_url
      ? { url: row.demo_url, cluster: row.demo_cluster }
      : null;

    if (!resolved) {
      if (!outcome) {
        console.error(`${label}: no replay url or outcome id`);
        failed += 1;
        continue;
      }
      console.log(`${label}: resolving replay host…`);
      const found = await resolveDemoUrl(row.match_id, outcome, row.demo_cluster);
      if (found) resolved = { url: found.url, cluster: found.cluster };
    }

    if (!resolved) {
      console.error(`${label}: replay not found on any known host (expired?)`);
      failed += 1;
      db.prepare("UPDATE matches SET demo_status = 'expired' WHERE match_id = ?").run(row.match_id);
      continue;
    }

    console.log(`${label}: ${resolved.url}`);
    const result = await processDemo(row.match_id, resolved.url, session.steamId);
    db.prepare(
      "UPDATE matches SET demo_url = ?, demo_cluster = ?, demo_status = 'parsed' WHERE match_id = ?"
    ).run(resolved.url, resolved.cluster, row.match_id);
    db.prepare("UPDATE matches SET source = 'steam' WHERE match_id = ? AND source = 'gc'").run(
      row.match_id
    );

    console.log(
      `${label}: parsed ${result.rounds} rounds, ${result.players} players, ${result.kills} kills`
    );
    ok += 1;
  } catch (error) {
    failed += 1;
    console.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`done: ${ok} parsed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
