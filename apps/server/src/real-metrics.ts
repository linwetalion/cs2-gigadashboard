import type { MetricValue } from "@giga/shared";
import { db } from "./db.js";
import { formatMetric } from "./demo.js";
import { metric } from "./registry.js";

function put(values: Record<string, MetricValue>, id: string, value: number, n: number): void {
  const def = metric(id);
  values[id] = {
    metricId: id,
    value,
    display: formatMetric(def, value),
    n,
    confidence: n >= 200 ? "high" : n >= 50 ? "medium" : "low",
    source: "computed",
  };
}

export function applyRealMetrics(
  values: Record<string, MetricValue>,
  matchIds: string[]
): void {
  if (!matchIds.length) return;
  const placeholders = matchIds.map(() => "?").join(",");

  const shots = db
    .prepare(
      `SELECT
         COUNT(1) AS shots,
         SUM(hit) AS hits,
         SUM(CASE WHEN first_bullet = 1 THEN 1 ELSE 0 END) AS fb,
         SUM(CASE WHEN first_bullet = 1 AND hit = 1 THEN 1 ELSE 0 END) AS fb_hits,
         SUM(CASE WHEN spray_index >= 3 THEN 1 ELSE 0 END) AS spray,
         SUM(CASE WHEN spray_index >= 3 AND hit = 1 THEN 1 ELSE 0 END) AS spray_hits,
         SUM(CASE WHEN spray_index >= 4 THEN 1 ELSE 0 END) AS recoil,
         SUM(CASE WHEN spray_index >= 4 AND hit = 1 THEN 1 ELSE 0 END) AS recoil_hits
       FROM shots WHERE match_id IN (${placeholders})`
    )
    .get(...matchIds) as Record<string, number | null>;

  const totalShots = Number(shots.shots ?? 0);
  if (totalShots > 0) {
    const hits = Number(shots.hits ?? 0);
    put(values, "ACC-003", (hits / totalShots) * 100, totalShots);
    put(values, "ACC-004", (hits / totalShots) * 100, totalShots);
    if (Number(shots.fb)) {
      put(values, "ACC-005", (Number(shots.fb_hits) / Number(shots.fb)) * 100, Number(shots.fb));
    }
    if (Number(shots.spray)) {
      put(values, "ACC-006", (Number(shots.spray_hits) / Number(shots.spray)) * 100, Number(shots.spray));
    }
    if (Number(shots.recoil)) {
      put(values, "ACC-007", (Number(shots.recoil_hits) / Number(shots.recoil)) * 100, Number(shots.recoil));
    }
  }

  const hitgroups = db
    .prepare(
      `SELECT hitgroup, COUNT(1) AS c, SUM(dmg) AS dmg
       FROM damage WHERE match_id IN (${placeholders}) GROUP BY hitgroup`
    )
    .all(...matchIds) as Array<{ hitgroup: string | null; c: number; dmg: number }>;
  const totalHits = hitgroups.reduce((sum, row) => sum + row.c, 0);
  const headHits = hitgroups.find((row) => row.hitgroup === "head")?.c ?? 0;
  if (totalHits > 0) put(values, "ACC-011", (headHits / totalHits) * 100, totalHits);

  const grenades = db
    .prepare(
      `SELECT type, COUNT(1) AS c FROM grenades WHERE match_id IN (${placeholders}) GROUP BY type`
    )
    .all(...matchIds) as Array<{ type: string; c: number }>;
  const count = (name: string) => grenades.find((row) => row.type === name)?.c ?? 0;
  const flashes = count("flashbang");
  const smokes = count("smoke");
  const hes = count("he");
  const molotovs = count("molotov") + count("incendiary");
  if (flashes) put(values, "UTL-004", flashes, flashes);
  if (smokes) put(values, "UTL-018", smokes, smokes);
  if (hes) put(values, "UTL-023", hes, hes);
  if (molotovs) put(values, "UTL-027", molotovs, molotovs);

  const heDamage = db
    .prepare(
      `SELECT COALESCE(SUM(dmg),0) AS dmg FROM damage
       WHERE match_id IN (${placeholders}) AND weapon LIKE '%hegrenade%'`
    )
    .get(...matchIds) as { dmg: number };
  const fireDamage = db
    .prepare(
      `SELECT COALESCE(SUM(dmg),0) AS dmg FROM damage
       WHERE match_id IN (${placeholders}) AND (weapon LIKE '%molotov%' OR weapon LIKE '%incendiary%' OR weapon LIKE '%inferno%')`
    )
    .get(...matchIds) as { dmg: number };
  if (hes && heDamage.dmg > 0) put(values, "UTL-024", heDamage.dmg / hes, hes);
  if (molotovs && fireDamage.dmg > 0) put(values, "UTL-028", fireDamage.dmg, molotovs);
}
