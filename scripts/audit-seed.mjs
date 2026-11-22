import Database from "better-sqlite3";

const db = new Database("data/seed/giga.db", { readonly: true });
const q = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();

console.log({
  matches: q("SELECT COUNT(*) c FROM matches").c,
  demoMatches: q("SELECT COUNT(*) c FROM matches WHERE is_demo = 1").c,
  withShareCode: q("SELECT COUNT(*) c FROM matches WHERE share_code IS NOT NULL").c,
  withDemoUrl: q("SELECT COUNT(*) c FROM matches WHERE demo_url IS NOT NULL").c,
  players: q("SELECT COUNT(*) c FROM match_players").c,
  distinctPlayers: q("SELECT COUNT(DISTINCT steamid) c FROM match_players").c,
  playerNames: all("SELECT DISTINCT name FROM match_players"),
  shotSteamids: q("SELECT COUNT(*) c FROM shots WHERE steamid IS NOT NULL").c,
  damageSteamids: q("SELECT COUNT(*) c FROM damage WHERE attacker IS NOT NULL OR victim IS NOT NULL").c,
  grenadeThrowers: q("SELECT COUNT(*) c FROM grenades WHERE thrower IS NOT NULL").c,
  positions: q("SELECT COUNT(*) c FROM positions").c,
  kills: q("SELECT COUNT(*) c FROM kills").c,
});
db.close();
