import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config.js";

mkdirSync(dirname(dbPath), { recursive: true });

// On hosts without a persistent disk (Render free) the database starts empty
// on every boot. GIGA_SEED points at a read-only snapshot of the real dataset;
// it is copied in only when there are no real matches yet, so local data is
// never overwritten.
const seedPath = process.env.GIGA_SEED;

function hasRealMatches(file: string): boolean {
  try {
    const probe = new Database(file, { readonly: true });
    const row = probe
      .prepare("SELECT COUNT(*) AS c FROM matches WHERE is_demo = 0")
      .get() as { c: number } | undefined;
    probe.close();
    return Number(row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

if (seedPath && existsSync(seedPath) && !hasRealMatches(dbPath)) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  copyFileSync(seedPath, dbPath);
}

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

const schema = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  share_code TEXT UNIQUE,
  season_id INTEGER,
  mode TEXT NOT NULL,
  map TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'MR12',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  score_us INTEGER NOT NULL,
  score_them INTEGER NOT NULL,
  result TEXT NOT NULL,
  duration_min INTEGER,
  demo_hash TEXT,
  parser_version TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  source TEXT NOT NULL DEFAULT 'demo',
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  steamid TEXT NOT NULL,
  name TEXT,
  team TEXT,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  damage INTEGER NOT NULL DEFAULT 0,
  adr REAL NOT NULL DEFAULT 0,
  hs_kills INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 0,
  is_me INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, steamid)
);

CREATE TABLE IF NOT EXISTS rounds (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL,
  side TEXT,
  eco_band TEXT,
  winner TEXT,
  reason TEXT,
  start_tick INTEGER,
  end_tick INTEGER,
  plant_tick INTEGER,
  defuse_tick INTEGER,
  ct_alive_start INTEGER,
  t_alive_start INTEGER,
  PRIMARY KEY (match_id, round_no)
);

CREATE TABLE IF NOT EXISTS metric_values (
  metric_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  value REAL,
  display TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'none',
  delta REAL,
  previous REAL,
  benchmark REAL,
  percentile REAL,
  reason TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (metric_id, scope)
);

CREATE TABLE IF NOT EXISTS kills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  killer TEXT,
  victim TEXT,
  assister TEXT,
  weapon TEXT,
  headshot INTEGER NOT NULL DEFAULT 0,
  wallbang INTEGER NOT NULL DEFAULT 0,
  noscope INTEGER NOT NULL DEFAULT 0,
  airborne INTEGER NOT NULL DEFAULT 0,
  flashed INTEGER NOT NULL DEFAULT 0,
  trade INTEGER NOT NULL DEFAULT 0,
  opening INTEGER NOT NULL DEFAULT 0,
  killer_x REAL,
  killer_y REAL,
  victim_x REAL,
  victim_y REAL
);

CREATE TABLE IF NOT EXISTS damage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  attacker TEXT,
  victim TEXT,
  weapon TEXT,
  hitgroup TEXT,
  dmg INTEGER NOT NULL DEFAULT 0,
  friendly INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  steamid TEXT,
  weapon TEXT,
  hitgroup TEXT,
  distance REAL,
  speed REAL,
  scoped INTEGER NOT NULL DEFAULT 0,
  spotted_enemy INTEGER NOT NULL DEFAULT 1,
  first_bullet INTEGER NOT NULL DEFAULT 0,
  spray_index INTEGER NOT NULL DEFAULT 0,
  hit INTEGER NOT NULL DEFAULT 0,
  dmg INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grenades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  thrower TEXT,
  type TEXT,
  x REAL,
  y REAL,
  x2 REAL,
  y2 REAL,
  blind_ms INTEGER NOT NULL DEFAULT 0,
  full_blind INTEGER NOT NULL DEFAULT 0,
  effective INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS economy (
  match_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  steamid TEXT NOT NULL,
  cash_start INTEGER,
  equip_start INTEGER,
  cash_spent INTEGER,
  cash_earned INTEGER,
  loss_bonus INTEGER,
  PRIMARY KEY (match_id, round_no, steamid)
);

CREATE TABLE IF NOT EXISTS positions (
  match_id TEXT NOT NULL,
  round_no INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  steamid TEXT NOT NULL,
  x REAL,
  y REAL,
  z REAL,
  speed REAL,
  health INTEGER,
  team TEXT,
  zone TEXT,
  PRIMARY KEY (match_id, round_no, tick, steamid)
);

CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY,
  last_code TEXT,
  cursor TEXT,
  last_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_map ON matches(map);
CREATE INDEX IF NOT EXISTS idx_metric_scope ON metric_values(scope);
CREATE INDEX IF NOT EXISTS idx_kills_match ON kills(match_id, round_no, tick);
CREATE INDEX IF NOT EXISTS idx_damage_match ON damage(match_id, round_no, tick);
CREATE INDEX IF NOT EXISTS idx_shots_match ON shots(match_id, round_no, tick);
CREATE INDEX IF NOT EXISTS idx_positions_match ON positions(match_id, round_no, tick);
`;

db.exec(schema);

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("matches", "demo_url", "TEXT");
ensureColumn("matches", "parsed_at", "INTEGER");
ensureColumn("matches", "demo_status", "TEXT");
ensureColumn("match_players", "kast", "REAL");
ensureColumn("match_players", "leetify_rating", "REAL");
ensureColumn("match_players", "aim", "REAL");
ensureColumn("match_players", "utility", "REAL");
ensureColumn("match_players", "positioning", "REAL");
ensureColumn("match_players", "preaim", "REAL");
ensureColumn("match_players", "reaction_time", "REAL");
ensureColumn("match_players", "rounds_survived", "INTEGER");
ensureColumn("match_players", "opening_kills", "INTEGER");
ensureColumn("match_players", "opening_deaths", "INTEGER");

// Round-level advantage funnel per match. Populated from Leetify opening
// duels (one opening duel per round) and from demo round data when present.
// "opening_won" = our team got the first kill, i.e. the round reached 5v4.
db.exec(`
CREATE TABLE IF NOT EXISTS match_funnel (
  match_id TEXT PRIMARY KEY REFERENCES matches(match_id) ON DELETE CASCADE,
  rounds INTEGER NOT NULL DEFAULT 0,
  opening_won INTEGER NOT NULL DEFAULT 0,
  opening_won_won INTEGER NOT NULL DEFAULT 0,
  opening_won_untraded INTEGER NOT NULL DEFAULT 0,
  opening_won_untraded_won INTEGER NOT NULL DEFAULT 0,
  opening_lost INTEGER NOT NULL DEFAULT 0,
  opening_lost_won INTEGER NOT NULL DEFAULT 0,
  all_survived_won INTEGER,
  source TEXT NOT NULL DEFAULT 'leetify'
)`);

export function setMeta(key: string, value: string) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function getMeta(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}
