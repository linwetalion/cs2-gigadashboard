import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config.js";

mkdirSync(dirname(dbPath), { recursive: true });

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

CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY,
  last_code TEXT,
  cursor TEXT,
  last_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_map ON matches(map);
CREATE INDEX IF NOT EXISTS idx_metric_scope ON metric_values(scope);
`;

db.exec(schema);

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
