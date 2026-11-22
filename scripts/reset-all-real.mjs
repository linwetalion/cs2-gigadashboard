import Database from "better-sqlite3";
const db = new Database("data/giga.db");
const ids = db
  .prepare("SELECT match_id FROM matches WHERE source = 'gc'")
  .all()
  .map((row) => row.match_id);
for (const id of ids) {
  for (const table of ["kills", "damage", "shots", "grenades", "positions", "rounds", "match_players"]) {
    db.prepare(`DELETE FROM ${table} WHERE match_id = ?`).run(id);
  }
  db.prepare("UPDATE matches SET demo_status = NULL, parsed_at = NULL WHERE match_id = ?").run(id);
}
console.log(`reset ${ids.length} GC matches`);
