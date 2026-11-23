import "dotenv/config";
import { computeDemoMetrics, parsedMatchIds } from "../apps/server/src/demo-metrics.js";

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

let ok = 0;
let skipped = 0;

for (const id of ids) {
  const result = computeDemoMetrics(id);
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
