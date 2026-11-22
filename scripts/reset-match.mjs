import Database from "better-sqlite3";
const db = new Database("data/giga.db");
const id = process.argv[2];
if (!id) throw new Error("match id required");
for (const table of ["kills", "damage", "shots", "grenades", "positions", "rounds", "match_players"]) {
  db.prepare(`DELETE FROM ${table} WHERE match_id = ?`).run(id);
}
db.prepare("UPDATE matches SET demo_status = NULL, map = 'unknown', parsed_at = NULL WHERE match_id = ?").run(id);
console.log("reset", id);
