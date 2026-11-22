import Database from "better-sqlite3";
import { mkdirSync, rmSync, statSync } from "node:fs";

// Builds a sanitized, read-only snapshot of the real dataset for the public
// stand. It keeps only what the dashboard reads:
//   matches, match_players (me only), shots, damage, grenades.
// Other players' identities, killfeed, rounds, economy, positions, demo URLs
// and share codes are removed.

const SOURCE = process.argv[2] ?? "data/giga.db";
const TARGET = process.argv[3] ?? "data/seed/giga.db";

mkdirSync("data/seed", { recursive: true });
rmSync(TARGET, { force: true });

const source = new Database(SOURCE);
source.exec(`VACUUM INTO '${TARGET.replaceAll("'", "''")}'`);
source.close();

const seed = new Database(TARGET);
seed.pragma("foreign_keys = OFF");

seed.prepare("DELETE FROM matches WHERE is_demo = 1 OR status != 'published'").run();
seed.prepare("DELETE FROM metric_values").run();
seed.prepare("DELETE FROM sync_state").run();

// Tables the dashboard does not read.
seed.prepare("DELETE FROM positions").run();
seed.prepare("DELETE FROM kills").run();
seed.prepare("DELETE FROM rounds").run();
seed.prepare("DELETE FROM economy").run();

// Only my own player row survives; drop names of everyone else entirely.
seed.prepare("DELETE FROM match_players WHERE is_me = 0").run();
seed.prepare("UPDATE match_players SET name = 'me', steamid = 'me'").run();

// Event rows are kept as aggregates only.
seed.prepare("UPDATE shots SET steamid = NULL").run();
seed.prepare("UPDATE damage SET attacker = NULL, victim = NULL").run();
seed.prepare("UPDATE grenades SET thrower = NULL").run();

// Match-level identifiers that are not needed for rendering.
seed
  .prepare(
    "UPDATE matches SET share_code = NULL, demo_hash = NULL, demo_url = NULL, parsed_at = NULL, demo_status = NULL"
  )
  .run();

seed
  .prepare("DELETE FROM shots WHERE match_id NOT IN (SELECT match_id FROM matches)")
  .run();
seed
  .prepare("DELETE FROM damage WHERE match_id NOT IN (SELECT match_id FROM matches)")
  .run();
seed
  .prepare("DELETE FROM grenades WHERE match_id NOT IN (SELECT match_id FROM matches)")
  .run();

seed.exec("VACUUM");
seed.pragma("foreign_keys = ON");

const count = (table) =>
  seed.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

console.log({
  target: TARGET,
  sizeMb: Math.round((statSync(TARGET).size / 1048576) * 100) / 100,
  matches: count("matches"),
  players: count("match_players"),
  shots: count("shots"),
  damage: count("damage"),
  grenades: count("grenades"),
});
seed.close();
