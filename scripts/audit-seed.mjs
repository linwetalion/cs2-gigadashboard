import Database from "better-sqlite3";

// Verifies that the public snapshot keeps what the UI needs and leaks nothing
// that identifies other players.

const db = new Database("data/seed/giga.db", { readonly: true });
const one = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();

const report = {
  matches: one("SELECT COUNT(*) c FROM matches").c,
  demoMatches: one("SELECT COUNT(*) c FROM matches WHERE is_demo = 1").c,
  withShareCode: one("SELECT COUNT(*) c FROM matches WHERE share_code IS NOT NULL").c,
  withDemoUrl: one("SELECT COUNT(*) c FROM matches WHERE demo_url IS NOT NULL").c,
  players: one("SELECT COUNT(*) c FROM match_players").c,
  distinctPlayers: one("SELECT COUNT(DISTINCT steamid) c FROM match_players").c,
  fullRosterMatches: one(
    `SELECT COUNT(*) c FROM (
       SELECT match_id FROM match_players WHERE team = 'us' GROUP BY match_id HAVING COUNT(*) = 5
     )`
  ).c,
  funnels: one("SELECT COUNT(*) c FROM match_funnel").c,
  realSteamIds: one(
    "SELECT COUNT(*) c FROM match_players WHERE steamid GLOB '7656119*'"
  ).c,
  realMatchIds: one(
    "SELECT COUNT(*) c FROM matches WHERE match_id LIKE 'leetify:%' OR match_id LIKE 'csgo_%'"
  ).c,
  shotSteamids: one("SELECT COUNT(*) c FROM shots WHERE steamid IS NOT NULL").c,
  damageSteamids: one(
    "SELECT COUNT(*) c FROM damage WHERE attacker IS NOT NULL OR victim IS NOT NULL"
  ).c,
  grenadeThrowers: one("SELECT COUNT(*) c FROM grenades WHERE thrower IS NOT NULL").c,
  positions: one("SELECT COUNT(*) c FROM positions").c,
  kills: one("SELECT COUNT(*) c FROM kills").c,
  rounds: one("SELECT COUNT(*) c FROM rounds").c,
  economy: one("SELECT COUNT(*) c FROM economy").c,
  samplePlayers: all("SELECT DISTINCT name FROM match_players ORDER BY name LIMIT 8").map(
    (row) => row.name
  ),
};

const leaks = [];
if (report.realSteamIds > 0) leaks.push(`${report.realSteamIds} real steamids`);
if (report.realMatchIds > 0) leaks.push(`${report.realMatchIds} real match ids`);
if (report.shotSteamids > 0) leaks.push(`${report.shotSteamids} shot steamids`);
if (report.damageSteamids > 0) leaks.push(`${report.damageSteamids} damage steamids`);
if (report.grenadeThrowers > 0) leaks.push(`${report.grenadeThrowers} grenade throwers`);
if (report.withShareCode > 0) leaks.push(`${report.withShareCode} share codes`);
if (report.withDemoUrl > 0) leaks.push(`${report.withDemoUrl} demo urls`);
if (report.positions + report.kills + report.rounds + report.economy > 0) {
  leaks.push("round-level tables present");
}
if (report.fullRosterMatches === 0) leaks.push("no full rosters — Teams tab will be empty");

console.log(report);
console.log(leaks.length ? `FAIL: ${leaks.join(", ")}` : "OK: snapshot is clean and usable");
db.close();
if (leaks.length) process.exitCode = 1;
