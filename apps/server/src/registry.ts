import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Metric } from "@giga/shared";
import { metricsPath } from "./config.js";

interface RegistryFile {
  version: number;
  generatedAt: string;
  count: number;
  metrics: Metric[];
}

const raw = parse(readFileSync(metricsPath, "utf8")) as RegistryFile;

const seen = new Set<string>();
const errors: string[] = [];

for (const metric of raw.metrics) {
  if (!/^[A-Z]{3}-\d{3}$/.test(metric.id)) errors.push(`bad id: ${metric.id}`);
  if (seen.has(metric.id)) errors.push(`duplicate id: ${metric.id}`);
  seen.add(metric.id);
  if (!metric.formula) errors.push(`${metric.id}: formula missing`);
  if (!metric.tooltip) errors.push(`${metric.id}: tooltip missing`);
  if (!metric.unit) errors.push(`${metric.id}: unit missing`);
  if (!metric.sources?.length) errors.push(`${metric.id}: sources missing`);
}

if (errors.length) {
  console.error(`Metric registry invalid (${errors.length} errors)`);
  for (const error of errors.slice(0, 20)) console.error(" -", error);
  process.exit(1);
}

export const metrics: Metric[] = raw.metrics;
export const metricById = new Map(metrics.map((metric) => [metric.id, metric]));
export const registryVersion = `${raw.version}.${raw.count}.${raw.generatedAt.slice(0, 10)}`;

export const domainOrder = [
  "Контекст",
  "Результат",
  "Объём боя",
  "Точность",
  "Механика прицеливания",
  "Оружие",
  "Ютилити",
  "Экономика",
  "Опенинг-дуэли",
  "Трейды",
  "Клатчи",
  "Мультикиллы",
  "Позиционирование",
  "Движение",
  "Объектив",
  "Командная игра",
  "Рейтинги",
  "Форма",
  "Репутация",
  "Рекорды",
  "Срезы",
  "Сессии",
  "Ошибки",
  "Скаутинг",
  "Хайлайты",
  "Лидерборды",
  "Тренировки",
];

export function metric(id: string): Metric {
  const found = metricById.get(id);
  if (!found) throw new Error(`Unknown metric: ${id}`);
  return found;
}
// metrics.yaml is read at startup; touch this file to reload after a sync.
// touch
// touch
