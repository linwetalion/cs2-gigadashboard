import type { Metric, MetricValue, SeriesPoint } from "@giga/shared";
import { db } from "./db.js";
import { metrics } from "./registry.js";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unitHash(input: string, salt = 0): number {
  return (hash(input + ":" + salt) % 100000) / 100000;
}

const MAPS = [
  "de_mirage",
  "de_dust2",
  "de_inferno",
  "de_ancient",
  "de_nuke",
  "de_anubis",
  "de_cache",
  "de_overpass",
];

const MODES = ["premier", "premier", "premier", "competitive"];

export function formatMetric(metric: Metric, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  const unit = metric.unit;
  const one = (v: number) => Math.round(v * 10) / 10;
  if (unit === "%" || unit === "% тиков" || unit === "% раундов") return `${one(value)}%`;
  if (unit.includes("мс")) return `${Math.round(value)} мс`;
  if (unit.startsWith("сек")) return `${value.toFixed(2)} с`;
  if (unit.startsWith("$")) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (unit === "градусы") return `${value.toFixed(2)}°`;
  if (unit === "коэффициент") return value.toFixed(2);
  if (unit === "HP" || unit === "HP/раунд" || unit === "HP/попадание" || unit === "HP/$1000")
    return `${one(value)} ${unit === "HP" ? "HP" : unit}`;
  if (unit === "0–100" || unit === "0-100" || unit === "±" || unit === "± очки")
    return `${Math.round(value)}`;
  if (unit.startsWith("шт.") || unit === "раунды" || unit === "попаданий/убийство")
    return `${Math.round(value)} ${unit}`;
  if (unit === "рейтинг") return value.toFixed(2);
  if (unit === "пункты" || unit === "пункты G") return `${Math.round(value)}`;
  if (unit === "чел./флешка" || unit === "выстрелов/энгейджмент" || unit === "выстрелов/убийство")
    return `${value.toFixed(2)} ${unit}`;
  return `${one(value)} ${unit}`.trim();
}

const OVERRIDES: Record<string, number> = {
  "CTX-001": 24,
  "CTX-002": 54.2,
  "IMP-010": 64.2,
  "KIL-011": 86.4,
  "KIL-004": 1.12,
  "IMP-011": 58.3,
  "UTL-038": 46.8,
  "KIL-009": 72.4,
  "IMP-016": 41.8,
  "ACC-004": 34.6,
  "ACC-005": 41.2,
  "ACC-006": 38.3,
  "ACC-007": 31.5,
  "AIM-001": 9.4,
  "AIM-002": 11.2,
  "AIM-004": 243,
  "AIM-005": 486,
  "AIM-006": 812,
  "AIM-012": 78.4,
  "ACC-016": 7.8,
  "AIM-027": 8.1,
  "UTL-036": 51.2,
  "UTL-037": 42.9,
  "UTL-006": 0.62,
  "UTL-012": 2.4,
  "UTL-020": 63,
  "UTL-024": 9.8,
  "UTL-033": 287,
  "POS-016": 62,
  "POS-017": 58,
  "POS-018": 71,
  "POS-019": 52,
  "POS-001": 18.4,
  "POS-002": 1.21,
  "ECO-008": 82,
  "ECO-010": 61,
  "ECO-013": 18.2,
  "ECO-014": 28,
  "ECO-019": 0.42,
  "ENT-001": 27,
  "ENT-004": 55,
  "ENT-005": 1.8,
  "TRD-003": 61,
  "TRD-008": 44,
  "CLT-004": 38,
  "MLT-005": 32,
  "TEA-001": 3.4,
  "TEA-003": 2.1,
  "FRM-003": 64,
  "FRM-005": 2.4,
  "SES-004": 58,
  "SES-008": -1.2,
  "REP-010": 88,
  "REC-003": 27,
  "REC-004": 11,
  "REC-006": 132,
  "REC-012": 2,
  "HIG-001": 34,
  "HIG-002": 1.4,
  "IMP-002": 1.12,
  "IMP-003": 1.09,
  "IMP-006": 2.4,
  "IMP-007": 8.1,
  "IMP-008": 0.72,
  "IMP-009": 91,
};

function unitValue(metric: Metric): number {
  const unit = metric.unit;
  const r = unitHash(metric.id, 7);
  if (unit === "%" || unit.startsWith("%")) return 25 + r * 55;
  if (unit.includes("мс")) return 360 + r * 380;
  if (unit.startsWith("сек")) return 1 + r * 22;
  if (unit.startsWith("$")) return 100 + r * 7000;
  if (unit === "градусы") return 3 + r * 15;
  if (unit === "коэффициент") return 0.7 + r * 0.9;
  if (unit === "HP" || unit.startsWith("HP/")) return 55 + r * 65;
  if (unit === "раунды") return 40 + r * 260;
  if (unit === "рейтинг") return 0.85 + r * 0.55;
  if (unit.includes("0–100") || unit.includes("0-100") || unit === "±")
    return 25 + r * 65;
  if (unit.startsWith("шт.")) return 4 + r * 190;
  if (unit === "чел./флешка") return 0.2 + r * 1.4;
  if (unit === "выстрелов/энгейджмент") return 4 + r * 8;
  if (unit === "выстрелов/убийство") return 3 + r * 9;
  if (unit === "попаданий/убийство") return 1.1 + r * 3;
  return 5 + r * 95;
}

export function demoValue(metric: Metric, scope: string): MetricValue {
  const gap = hash(metric.id + scope) % 23 === 0;
  if (gap) {
    return {
      metricId: metric.id,
      value: null,
      display: "N/A",
      n: 0,
      confidence: "none",
      reason: "DEMO_GAP",
      source: "unavailable",
    };
  }
  const base =
    OVERRIDES[metric.id] ??
    unitValue(metric);
  const jitter = metric.id in OVERRIDES ? 0 : (unitHash(metric.id, 11) - 0.5) * 0.16;
  const scopeShift = scope === "global" ? 0 : (hash(scope + metric.id) % 1000) / 1000 - 0.6;
  const value = Math.max(0, base * (1 + jitter + scopeShift * 0.04));
  const n = Math.min(
    2400,
    Math.max(
      metric.minSample,
      Math.round(metric.minSample * (2 + unitHash(metric.id, 13) * 6))
    )
  );
  const confidence = n >= metric.minSample * 3 ? "high" : n >= metric.minSample ? "medium" : "low";
  const delta = value * ((unitHash(metric.id, 17) - 0.42) * 0.16);
  const benchmark = base * (0.86 + unitHash(metric.id, 19) * 0.28);
  const percentile = Math.round(18 + unitHash(metric.id, 23) * 79);

  return {
    metricId: metric.id,
    value,
    display: formatMetric(metric, value),
    n,
    confidence,
    delta,
    previous: value - delta,
    benchmark,
    percentile,
    source: "demo",
  };
}

export function demoSeries(metric: Metric, points = 20): SeriesPoint[] {
  const base = demoValue(metric, "global").value ?? 1;
  return Array.from({ length: points }, (_, i) => {
    const noise = (unitHash(metric.id, i + 31) - 0.5) * 0.24;
    const trend = (i / points - 0.5) * 0.1;
    const value = Math.max(0, base * (1 + noise + trend));
    return { label: `M${i + 1}`, value: Math.round(value * 100) / 100 };
  });
}

export function demoBreakdown(metric: Metric, points = 6): SeriesPoint[] {
  const labels =
    metric.unit.includes("мс")
      ? ["AK-47", "M4A1-S", "AWP", "Deagle", "USP-S", "Glock-18"]
      : ["Head", "Chest", "Stomach", "Arms", "Legs", "Gear"];
  const base = demoValue(metric, "global").value ?? 1;
  return labels.map((label, i) => ({
    label,
    value: Math.round(base * (0.45 + unitHash(metric.id + label, i) * 0.9) * 100) / 100,
  }));
}

interface DemoMatch {
  matchId: string;
  map: string;
  mode: string;
  startedAt: number;
  scoreUs: number;
  scoreThem: number;
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  hs: number;
  rating: number;
  delta: number;
}

function generateMatches(count = 24): DemoMatch[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const r = unitHash("match", i);
    const map = MAPS[(i + Math.floor(r * 3)) % MAPS.length];
    const win = unitHash("win", i) > 0.44;
    const close = unitHash("close", i) > 0.72;
    const ot = unitHash("ot", i) > 0.93;
    const winnerScore = ot ? 19 : 13;
    const loserScore = ot ? 17 : close ? 11 : 3 + Math.floor(r * 7);
    const scoreUs = win ? winnerScore : loserScore;
    const scoreThem = win ? loserScore : winnerScore;
    const kills = 10 + Math.floor(unitHash("k", i) * 18);
    const deaths = 10 + Math.floor(unitHash("d", i) * 14);
    return {
      matchId: `demo-${String(i + 1).padStart(3, "0")}`,
      map,
      mode: MODES[i % MODES.length],
      startedAt: now - i * 32 * 3600 * 1000 - Math.floor(r * 3600 * 1000),
      scoreUs,
      scoreThem,
      kills,
      deaths,
      assists: 2 + Math.floor(unitHash("a", i) * 8),
      adr: 55 + unitHash("adr", i) * 72,
      hs: 30 + unitHash("hs", i) * 35,
      rating: 0.72 + unitHash("rating", i) * 0.95,
      delta: Math.round((unitHash("delta", i) - 0.45) * 900),
    };
  });
}

export function seedDemo(): { matches: number; metrics: number } {
  const matches = generateMatches();
  const insertMatch = db.prepare(`
    INSERT INTO matches (match_id, season_id, mode, map, format, started_at, ended_at,
      score_us, score_them, result, duration_min, status, source, is_demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'demo', 1)
    ON CONFLICT(match_id) DO UPDATE SET
      score_us = excluded.score_us, score_them = excluded.score_them,
      result = excluded.result, started_at = excluded.started_at
  `);
  const insertPlayer = db.prepare(`
    INSERT INTO match_players (match_id, steamid, name, team, kills, deaths, assists,
      damage, adr, hs_kills, rating, is_me)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(match_id, steamid) DO UPDATE SET
      kills = excluded.kills, deaths = excluded.deaths, assists = excluded.assists,
      adr = excluded.adr, hs_kills = excluded.hs_kills, rating = excluded.rating
  `);
  const insertRound = db.prepare(`
    INSERT OR REPLACE INTO rounds (match_id, round_no, side, eco_band, winner, reason,
      start_tick, end_tick, ct_alive_start, t_alive_start)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMetric = db.prepare(`
    INSERT INTO metric_values (metric_id, scope, value, display, n, confidence, delta,
      previous, benchmark, percentile, reason, is_demo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(metric_id, scope) DO UPDATE SET
      value = excluded.value, display = excluded.display, n = excluded.n,
      confidence = excluded.confidence, delta = excluded.delta,
      previous = excluded.previous, benchmark = excluded.benchmark,
      percentile = excluded.percentile, reason = excluded.reason,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM matches WHERE is_demo = 1").run();
    db.prepare("DELETE FROM metric_values WHERE is_demo = 1").run();
    for (const m of matches) {
      insertMatch.run(
        m.matchId,
        3,
        m.mode,
        m.map,
        "MR12",
        m.startedAt,
        m.startedAt + 45 * 60 * 1000,
        m.scoreUs,
        m.scoreThem,
        m.scoreUs > m.scoreThem ? "win" : "loss",
        45,
      );
      insertPlayer.run(
        m.matchId,
        "76561198075131708",
        "ULTIMATE",
        "CT",
        m.kills,
        m.deaths,
        m.assists,
        Math.round(m.adr * 24),
        m.adr,
        Math.round((m.kills * m.hs) / 100),
        m.rating,
      );
      const rounds = m.scoreUs + m.scoreThem;
      for (let round = 1; round <= rounds; round++) {
        insertRound.run(
          m.matchId,
          round,
          round <= 12 ? "T" : "CT",
          round === 1 || round === 13 ? "pistol" : ["eco", "semi", "force", "full"][round % 4],
          round === 1 ? (m.scoreUs > m.scoreThem ? "us" : "them") : "unknown",
          "elimination",
          (round - 1) * 115 * 64,
          round * 115 * 64,
          5,
          5,
        );
      }
    }
    const now = new Date().toISOString();
    for (const metric of metrics) {
      const value = demoValue(metric, "global");
      insertMetric.run(
        metric.id,
        "global",
        value.value,
        value.display,
        value.n,
        value.confidence,
        value.delta ?? null,
        value.previous ?? null,
        value.benchmark ?? null,
        value.percentile ?? null,
        value.reason ?? null,
        now,
      );
    }
  });
  tx();
  return { matches: matches.length, metrics: metrics.length };
}

export function readMatches(limit = 24) {
  return db
    .prepare(
      `SELECT m.*, p.kills, p.deaths, p.assists, p.adr, p.hs_kills, p.kast, p.rating, p.damage
       FROM matches m
       LEFT JOIN match_players p ON p.match_id = m.match_id AND p.is_me = 1
       WHERE m.status = 'published'
         AND (
           m.is_demo = 0
           OR NOT EXISTS (SELECT 1 FROM matches real WHERE real.is_demo = 0 AND real.status = 'published')
         )
       ORDER BY m.started_at DESC LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
}

export function readMetricValue(metricId: string, scope = "global"): MetricValue | null {
  const row = db
    .prepare("SELECT * FROM metric_values WHERE metric_id = ? AND scope = ?")
    .get(metricId, scope) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    metricId,
    value: row.value as number | null,
    display: (row.display as string) ?? "N/A",
    n: (row.n as number) ?? 0,
    confidence: (row.confidence as MetricValue["confidence"]) ?? "none",
    delta: row.delta as number | null,
    previous: row.previous as number | null,
    benchmark: row.benchmark as number | null,
    percentile: row.percentile as number | null,
    reason: row.reason as string | undefined,
    source: "demo",
  };
}
