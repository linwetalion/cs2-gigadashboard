import Database from "better-sqlite3";
const db = new Database("data/giga.db");
console.log(db.prepare("select source, is_demo, count(1) as c from matches group by source, is_demo").all());
console.log(
  db
    .prepare("select match_id, map, score_us, score_them, result, datetime(started_at/1000,'unixepoch') as started from matches where source = 'gc' order by started_at desc limit 5")
    .all()
);
console.log(
  db
    .prepare("select count(1) as c from match_players where match_id in (select match_id from matches where source = 'gc')")
    .get()
);
