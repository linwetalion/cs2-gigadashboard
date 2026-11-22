import "dotenv/config";
import { db } from "./db.js";
import { processDemo } from "./steam/demo-parse.js";
import { storedSession } from "./steam/login.js";

const session = storedSession();
if (!session) {
  console.error("Steam session not found");
  process.exit(1);
}

const rows = db
  .prepare(
    "SELECT match_id, demo_url FROM matches WHERE source = 'gc' AND demo_url IS NOT NULL AND (demo_status IS NULL OR demo_status != 'parsed') ORDER BY started_at DESC"
  )
  .all() as Array<{ match_id: string; demo_url: string }>;

console.log(`demos to parse: ${rows.length}`);
for (const row of rows) {
  try {
    const result = await processDemo(row.match_id, row.demo_url, session.steamId);
    console.log("OK", JSON.stringify(result));
  } catch (error) {
    console.error("FAIL", row.match_id, error instanceof Error ? error.message : error);
  }
}
console.log("done");
