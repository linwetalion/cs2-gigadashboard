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
  extraSteamIds: one(
    "SELECT COUNT(*) c FROM match_player_extra WHERE steamid GLOB '7656119*'"
  ).c,
  realMatchIds: one(
    "SELECT COUNT(*) c FROM matches WHERE match_id LIKE 'leetify:%' OR match_id LIKE 'csgo_%'"
  ).c,
  shotSteamids: one("SELECT COUNT(*) c FROM shots WHERE steamid GLOB '7656119*'").c,
  damageSteamids: one(
    "SELECT COUNT(*) c FROM damage WHERE attacker GLOB '7656119*' OR victim GLOB '7656119*'"
  ).c,
  grenadeThrowers: one("SELECT COUNT(*) c FROM grenades WHERE thrower GLOB '7656119*'").c,
  realKillIds: one(
    "SELECT COUNT(*) c FROM kills WHERE killer GLOB '7656119*' OR victim GLOB '7656119*'"
  ).c,
  realRoundIds: one(
    "SELECT COUNT(*) c FROM rounds WHERE plant_player GLOB '7656119*' OR defuse_player GLOB '7656119*'"
  ).c,
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
if (report.extraSteamIds > 0) leaks.push(`${report.extraSteamIds} real steamids in extras`);
if (report.realMatchIds > 0) leaks.push(`${report.realMatchIds} real match ids`);
if (report.shotSteamids > 0) leaks.push(`${report.shotSteamids} shot steamids`);
if (report.damageSteamids > 0) leaks.push(`${report.damageSteamids} damage steamids`);
if (report.grenadeThrowers > 0) leaks.push(`${report.grenadeThrowers} grenade throwers`);
if (report.withShareCode > 0) leaks.push(`${report.withShareCode} share codes`);
if (report.withDemoUrl > 0) leaks.push(`${report.withDemoUrl} demo urls`);
if (report.positions + report.economy > 0) {
  leaks.push("heavy raw tables present");
}
if (report.realKillIds > 0) leaks.push(`${report.realKillIds} real ids in kills`);
if (report.realRoundIds > 0) leaks.push(`${report.realRoundIds} real ids in rounds`);
if (report.fullRosterMatches === 0) leaks.push("no full rosters — Teams tab will be empty");

console.log(report);
console.log(leaks.length ? `FAIL: ${leaks.join(", ")}` : "OK: snapshot is clean and usable");
db.close();
if (leaks.length) process.exitCode = 1;
