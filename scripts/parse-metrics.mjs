#!/usr/bin/env node
/**
 * Extracts the metric registry from the specification (docs/TZ-gigadashboard.md)
 * into data/metrics.yaml. The spec stays the human source of truth; this script
 * makes it machine readable.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = resolve(root, "docs/TZ-gigadashboard.md");
const outDir = resolve(root, "data");
const md = readFileSync(specPath, "utf8");

const DOMAINS = {
  CTX: "Контекст",
  RES: "Результат",
  KIL: "Объём боя",
  ACC: "Точность",
  AIM: "Механика прицеливания",
  WPN: "Оружие",
  UTL: "Ютилити",
  ECO: "Экономика",
  ENT: "Опенинг-дуэли",
  TRD: "Трейды",
  CLT: "Клатчи",
  MLT: "Мультикиллы",
  POS: "Позиционирование",
  MOV: "Движение",
  OBJ: "Объектив",
  TEA: "Командная игра",
  IMP: "Рейтинги",
  FRM: "Форма",
  REP: "Репутация",
  REC: "Рекорды",
  SEA: "Срезы",
  SES: "Сессии",
  MIS: "Ошибки",
  SCO: "Скаутинг",
  HIG: "Хайлайты",
  LDR: "Лидерборды",
  TRN: "Тренировки",
};

const DOMAIN_SOURCES = {
  CTX: ["Leetify", "Scope", "CSStats"],
  RES: ["Leetify", "Scope", "CSStats"],
  KIL: ["Leetify", "Scope", "CSStats", "Tracker", "SteamAnalyst"],
  ACC: ["Leetify", "CSStats", "Refrag", "CSRep", "Scope"],
  AIM: ["Leetify", "CSStats", "Refrag", "CSRep", "Scope"],
  WPN: ["CSStats", "Scope"],
  UTL: ["Leetify", "Scope", "CSStats", "Refrag"],
  ECO: ["Scope", "CSStats"],
  ENT: ["Leetify", "CSStats", "Scope", "Refrag"],
  TRD: ["Leetify", "CSStats", "Scope", "Refrag"],
  CLT: ["Leetify", "CSStats", "Scope", "Refrag"],
  MLT: ["Leetify", "CSStats", "Scope", "Tracker"],
  POS: ["Leetify", "Scope", "CSStats"],
  MOV: ["Refrag", "CSStats"],
  OBJ: ["Scope", "CSStats"],
  TEA: ["Leetify", "Scope", "CSStats"],
  IMP: ["Leetify", "HLTV", "CSDB", "Refrag", "CSRep", "Tracker"],
  FRM: ["Leetify", "CSDB", "Scope"],
  REP: ["CSRep", "Scope", "CSDB"],
  REC: ["Leetify", "Scope", "CSDB", "Tracker"],
  SEA: ["Leetify", "Scope", "CSStats"],
  SES: ["Leetify", "Scope"],
  MIS: ["Scope", "Leetify"],
  SCO: ["Scope", "Leetify", "CSRep", "CSDB"],
  HIG: ["Leetify", "Scope"],
  LDR: ["Leetify", "Tracker"],
  TRN: ["Leetify", "Refrag"],
};

const dirMap = { "↑": "up", "↓": "down", "↕": "neutral", "=": "neutral" };

const blocks = md.split(/^#### /m).slice(1);
const metrics = [];

for (const block of blocks) {
  const head = block.split("\n", 1)[0].trim();
  const headMatch = head.match(/^([A-Z]{3}-\d{3})\s*·\s*(.+)$/);
  if (!headMatch) continue;
  const [, id, name] = headMatch;
  if (id.startsWith("FTR-")) continue;

  const body = block.slice(head.length);

  const unitLine = body.match(/\*\*Ед\.?:\*\*\s*([^·\n]+?)\s*·\s*\*\*Направление:\*\*\s*([↑↓↕=])/);
  const unit = unitLine?.[1]?.trim() ?? "";
  const direction = dirMap[unitLine?.[2]?.trim() ?? "="] ?? "neutral";

  const minSampleRaw = body.match(/\*\*Мин\. выборка:\*\*\s*([0-9][0-9\s]*)/)?.[1] ?? "1";
  const minSample = Number(minSampleRaw.replace(/\s/g, "")) || 1;

  const formula =
    body.match(/\*\*Формула:\*\*\s*([\s\S]*?)(?=\n- \*\*|\n\n|$)/)?.[1]?.trim() ?? "";
  const tooltip =
    body.match(/\*\*Тултип:\*\*\s*«([\s\S]*?)»/)?.[1]?.trim() ?? "";
  const include = body.match(/\*\*Включено:\*\*\s*([^\n]+)/)?.[1]?.trim();
  const exclude = body.match(/\*\*Исключено:\*\*\s*([^\n]+)/)?.[1]?.trim();
  const aggregation = body.match(/\*\*Агрегация:\*\*\s*([^\n]+)/)?.[1]?.trim();
  const canon = body.match(/\*\*Канон:\*\*\s*([^\n]+)/)?.[1]?.trim();
  const alias = body.match(/\*\*Алиас:\*\*\s*([^\n]+)/)?.[1]?.trim();
  const derived = body.match(/\*\*Производная:\*\*\s*([^\n]+)/)?.[1]?.trim();

  if (!unit || !formula || !tooltip) {
    console.warn(`skip ${id}: missing unit/formula/tooltip`);
    continue;
  }

  const domain = DOMAINS[id.slice(0, 3)] ?? id.slice(0, 3);

  metrics.push({
    id,
    name,
    domain,
    unit,
    direction,
    minSample,
    formula,
    tooltip,
    include,
    exclude,
    aggregation,
    canon,
    alias,
    derived,
    sources: DOMAIN_SOURCES[id.slice(0, 3)] ?? [],
    version: 1,
  });
}

const q = (v) => JSON.stringify(v);
const lines = [
  "# AUTO-GENERATED from docs/TZ-gigadashboard.md by scripts/parse-metrics.mjs",
  "# Do not edit by hand. Edit the spec, then run: npm run metrics:sync",
  "version: 1",
  `generatedAt: ${q(new Date().toISOString())}`,
  `count: ${metrics.length}`,
  "metrics:",
];

for (const m of metrics) {
  lines.push(`  - id: ${q(m.id)}`);
  lines.push(`    name: ${q(m.name)}`);
  lines.push(`    domain: ${q(m.domain)}`);
  lines.push(`    unit: ${q(m.unit)}`);
  lines.push(`    direction: ${q(m.direction)}`);
  lines.push(`    minSample: ${m.minSample}`);
  lines.push(`    formula: ${q(m.formula)}`);
  lines.push(`    tooltip: ${q(m.tooltip)}`);
  for (const key of ["include", "exclude", "aggregation", "canon", "alias", "derived"]) {
    if (m[key]) lines.push(`    ${key}: ${q(m[key])}`);
  }
  lines.push(`    sources: [${m.sources.map(q).join(", ")}]`);
  lines.push(`    version: ${m.version}`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "metrics.yaml"), lines.join("\n") + "\n", "utf8");
writeFileSync(resolve(outDir, "metrics.json"), JSON.stringify(metrics, null, 2), "utf8");

console.log(`metrics: ${metrics.length} -> data/metrics.yaml`);
