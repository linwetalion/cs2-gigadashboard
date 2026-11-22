import Database from "better-sqlite3";
const db = new Database("data/giga.db");
const result = db
  .prepare("UPDATE match_players SET leetify_rating = leetify_rating * 100 WHERE match_id LIKE 'leetify:%'")
  .run();
console.log(result.changes);
