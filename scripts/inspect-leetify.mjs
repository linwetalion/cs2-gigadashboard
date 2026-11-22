import Database from "better-sqlite3";
const db = new Database("data/giga.db");
console.log(
  db
    .prepare(
      "select match_id, steamid, leetify_rating, aim, utility from match_players where match_id like 'leetify:%' and is_me = 1 limit 5"
    )
    .all()
);
