import Database from "better-sqlite3";
const db = new Database("data/giga.db");
const rows = db
  .prepare(
    "select match_id, map, demo_status from matches where source = 'gc' and demo_url is not null order by started_at desc"
  )
  .all();
for (const row of rows) console.log(`${row.match_id}\t${row.map}\t${row.demo_status}`);
