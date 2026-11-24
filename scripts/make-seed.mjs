import Database from "better-sqlite3";
import { mkdirSync, rmSync, statSync } from "node:fs";

// Builds a sanitized, read-only snapshot of the real dataset for the public
// stand. It keeps what the dashboard and the Teams tab read:
//   matches, match_players (full 5-stacks), shots, damage, grenades, match_funnel.
//
// Privacy: real match ids, steamids and nicknames of other players are replaced
// with stable pseudonyms. The local database keeps the real values, so the local
// UI still shows real names.

const SOURCE = process.argv[2] ?? "data/giga.db";
const TARGET = process.argv[3] ?? "data/seed/giga.db";

const CALLSIGNS = [
  "Falcon", "Viper", "Nomad", "Echo", "Onyx", "Cobalt", "Raven", "Kestrel",
  "Lynx", "Orion", "Saber", "Tundra", "Quartz", "Ember", "Drift", "Vandal",
  "Nova", "Cipher", "Atlas", "Rogue", "Zenith", "Comet", "Granite", "Havoc",
  "Iris", "Jade", "Kilo", "Lumen", "Mirage", "Nimbus", "Opal", "Pilot",
  "Quill", "Rift", "Sable", "Talon", "Umbra", "Vertex", "Warden", "Xenon",
  "Yarrow", "Zephyr", "Apex", "Bolt", "Cinder", "Delta", "Eclipse", "Flint",
  "Ghost", "Halo", "Indigo", "Jolt", "Karma", "Lark", "Meteor", "Nero",
  "Osprey", "Pulse", "Quest", "Rune", "Storm", "Trace", "Unity", "Vortex",
];

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

// Position samples are the only heavy table; aggregates live in
// match_player_extra, so the raw stream can be dropped from the snapshot.
seed.prepare("DELETE FROM positions").run();
seed.prepare("DELETE FROM economy").run();

// Orphan rows from removed demo/unpublished matches.
for (const table of ["match_players", "shots", "damage", "grenades", "match_funnel"]) {
  const exists = seed
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) continue;
  seed
    .prepare(`DELETE FROM ${table} WHERE match_id NOT IN (SELECT match_id FROM matches)`)
    .run();
}

// --- match ids -> m0001.. -------------------------------------------------
seed.exec("CREATE TEMP TABLE idmap(old_id TEXT PRIMARY KEY, new_id TEXT)");
seed.exec(`
  INSERT INTO idmap
  SELECT match_id, 'm' || printf('%04d', row_number() OVER (ORDER BY started_at))
  FROM matches
`);
for (const table of ["matches", "match_players", "shots", "damage", "grenades", "match_funnel", "match_player_extra", "kills", "rounds"]) {
  const exists = seed
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) continue;
  seed
    .prepare(
      `UPDATE ${table} SET match_id = (SELECT new_id FROM idmap WHERE old_id = ${table}.match_id)`
    )
    .run();
}
seed.exec("DROP TABLE idmap");

// --- steamids / nicknames -> pseudonyms -----------------------------------
const me = seed
  .prepare("SELECT steamid FROM match_players WHERE is_me = 1 LIMIT 1")
  .get()?.steamid;

const players = seed
  .prepare(
    `SELECT p.steamid, MIN(m.started_at) AS first
     FROM match_players p JOIN matches m ON m.match_id = p.match_id
     GROUP BY p.steamid
     ORDER BY first ASC, p.steamid ASC`
  )
  .all();

const updatePlayer = seed.prepare(
  "UPDATE match_players SET steamid = ?, name = ? WHERE steamid = ?"
);

const alias = new Map();
let index = 0;
for (const row of players) {
  if (row.steamid === me) {
    updatePlayer.run("me", "you", row.steamid);
    alias.set(row.steamid, "me");
    continue;
  }
  const callsign = CALLSIGNS[index % CALLSIGNS.length];
  const cycle = Math.floor(index / CALLSIGNS.length);
  const name = cycle === 0 ? callsign : `${callsign} ${cycle + 1}`;
  const newId = `p${String(index + 1).padStart(4, "0")}`;
  updatePlayer.run(newId, name, row.steamid);
  alias.set(row.steamid, newId);
  index += 1;
}

// Pseudonymise every other table that carries player ids. Event rows keep the
// same aliases, so per-player metrics stay computable on the public stand.
const hasTable = (name) =>
  Boolean(
    seed.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );

const rename = (table, column) => {
  if (!hasTable(table)) return;
  const stmt = seed.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`);
  for (const [oldId, newId] of alias) stmt.run(newId, oldId);
};

for (const [table, columns] of [
  ["match_player_extra", ["steamid"]],
  ["shots", ["steamid"]],
  ["damage", ["attacker", "victim"]],
  ["grenades", ["thrower"]],
  ["kills", ["killer", "victim", "assister"]],
  ["rounds", ["plant_player", "defuse_player"]],
]) {
  for (const column of columns) rename(table, column);
}

// Event rows keep their pseudonymous ids: shot-based metrics stay computable.

// Match-level identifiers that are not needed for rendering.
seed
  .prepare(
    "UPDATE matches SET share_code = NULL, demo_hash = NULL, demo_url = NULL, parsed_at = NULL, demo_status = NULL, demo_outcome = NULL, demo_cluster = NULL"
  )
  .run();

seed.exec("VACUUM");
seed.pragma("foreign_keys = ON");

const count = (table) => seed.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

console.log({
  target: TARGET,
  sizeMb: Math.round((statSync(TARGET).size / 1048576) * 100) / 100,
  matches: count("matches"),
  players: count("match_players"),
  distinctPlayers: seed.prepare("SELECT COUNT(DISTINCT steamid) AS c FROM match_players").get().c,
  fullRosterMatches: seed
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT match_id FROM match_players WHERE team = 'us' GROUP BY match_id HAVING COUNT(*) = 5
       )`
    )
    .get().c,
  funnels: count("match_funnel"),
  shots: count("shots"),
  damage: count("damage"),
  grenades: count("grenades"),
});
seed.close();
