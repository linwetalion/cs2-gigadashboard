import "dotenv/config";
import { db } from "../apps/server/src/db.js";
import { computeDemoMetrics, parsedMatchIds } from "../apps/server/src/demo-metrics.js";
import { computePositionMetrics } from "../apps/server/src/position-metrics.js";

/**
 * Recomputes round-level player aggregates (openings, trades, clutches,
 * multi-kills, survival) for every match that already has demo kill events.
 *
 *   npm run metrics:demo
 *
 * No demo file is needed: everything comes from the `kills` and `rounds` tables.
 */

const ids = parsedMatchIds();
console.log(`matches with kill events: ${ids.length}`);

// Older rows stored raw sides (T/CT); normalise them to us/them so every
// consumer sees the same convention.
const normalise = db.prepare(
  `UPDATE match_players
   SET team = CASE WHEN team = (SELECT team FROM match_players WHERE match_id = ? AND is_me = 1 LIMIT 1)
                   THEN 'us' ELSE 'them' END
   WHERE match_id = ?`
);

let ok = 0;
let skipped = 0;

for (const id of ids) {
  if (db.prepare("SELECT 1 AS ok FROM match_players WHERE match_id = ? AND is_me = 1").get(id)) {
    normalise.run(id, id);
  }
  const result = computeDemoMetrics(id);
  computePositionMetrics(id);
  if (result) {
    ok += 1;
    if (ids.length <= 20) {
      console.log(`${id}: ${result.rounds} rounds, ${result.players} players`);
    }
  } else {
    skipped += 1;
  }
}

console.log(`done: ${ok} recomputed, ${skipped} skipped`);
