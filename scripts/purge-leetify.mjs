import Database from "better-sqlite3";
import { copyFileSync, existsSync } from "node:fs";

// Removes every row that came from the third-party Leetify import, so that the
// database contains Steam/demo data only.
//
//   npm run purge:leetify
//
// A timestamped backup is written next to the database before anything is
// deleted.

const DB = process.argv[2] ?? "data/giga.db";
const backup = `${DB}.before-leetify-purge`;

if (!existsSync(backup)) {
  copyFileSync(DB, backup);
  console.log(`backup: ${backup}`);
}

const db = new Database(DB);
db.pragma("foreign_keys = OFF");

const count = (sql) => db.prepare(sql).get().c;

const before = {
  matches: count("SELECT COUNT(*) c FROM matches"),
  leetify: count("SELECT COUNT(*) c FROM matches WHERE source = 'leetify'"),
};

const ids = db
  .prepare("SELECT match_id FROM matches WHERE source = 'leetify'")
  .all()
  .map((row) => row.match_id);

const tx = db.transaction(() => {
  for (const table of ["match_players", "shots", "damage", "grenades", "kills", "positions", "rounds", "economy", "match_funnel"]) {
    const exists = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!exists) continue;
    db.prepare(`DELETE FROM ${table} WHERE match_id IN (SELECT match_id FROM matches WHERE source = 'leetify')`).run();
  }
  db.prepare("DELETE FROM matches WHERE source = 'leetify'").run();
  db.prepare("DELETE FROM match_funnel WHERE source = 'leetify'").run();
  db.prepare("DELETE FROM metric_values").run();

  // Columns that only Leetify provided; they are null until computed from demos.
  db.prepare(
    "UPDATE match_players SET aim = NULL, utility = NULL, positioning = NULL, leetify_rating = NULL, preaim = NULL, reaction_time = NULL"
  ).run();
});

tx();
db.exec("VACUUM");

const after = {
  matches: count("SELECT COUNT(*) c FROM matches"),
  withDemo: count("SELECT COUNT(*) c FROM matches WHERE demo_url IS NOT NULL"),
  parsed: count("SELECT COUNT(*) c FROM matches WHERE demo_status = 'parsed'"),
  playerRows: count("SELECT COUNT(*) c FROM match_players"),
  funnels: count("SELECT COUNT(*) c FROM match_funnel WHERE source = 'demo'"),
};

console.log({ removedMatches: ids.length, before, after });
db.close();
