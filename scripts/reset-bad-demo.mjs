import Database from "better-sqlite3";
const db = new Database("data/giga.db");
const id = "3855176229871157809";
db.prepare("DELETE FROM kills WHERE match_id = ?").run(id);
db.prepare("DELETE FROM rounds WHERE match_id = ?").run(id);
db.prepare("DELETE FROM match_players WHERE match_id = ?").run(id);
db.prepare("UPDATE matches SET demo_status = NULL, map = 'unknown', parsed_at = NULL WHERE match_id = ?").run(id);
console.log("reset", id);
