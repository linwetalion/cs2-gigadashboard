import type { FilterDefinition } from "@giga/shared";

/**
 * CS2 Premier seasons. Valve never exposes a season id through the Game
 * Coordinator, so boundaries are hardcoded from the official announcements:
 *   S1 27.09.2023 – 28.01.2025
 *   S2 28.01.2025 – 14.07.2025
 *   S3 14.07.2025 – 21.01.2026
 *   S4 21.01.2026 – 06.07.2026
 *   S5 06.07.2026 – …
 */
export interface SeasonRange {
  id: string;
  label: string;
  start: string;
  end: string | null;
}

export const SEASONS: SeasonRange[] = [
  { id: "1", label: "Season 1 · 2023–2025", start: "2023-09-27", end: "2025-01-28" },
  { id: "2", label: "Season 2 · 2025 H1", start: "2025-01-28", end: "2025-07-14" },
  { id: "3", label: "Season 3 · 2025 H2", start: "2025-07-14", end: "2026-01-21" },
  { id: "4", label: "Season 4 · 2026 H1", start: "2026-01-21", end: "2026-07-06" },
  { id: "5", label: "Season 5 · 2026 H2", start: "2026-07-06", end: null },
];

const ranges = SEASONS.map((season) => ({
  id: season.id,
  start: Date.parse(`${season.start}T00:00:00Z`),
  end: season.end ? Date.parse(`${season.end}T00:00:00Z`) : Number.POSITIVE_INFINITY,
}));

/** Season id for a match timestamp, or null when it falls before Season 1. */
export function seasonIdFor(startedAt: number): string | null {
  for (const range of ranges) {
    if (startedAt >= range.start && startedAt < range.end) return range.id;
  }
  return null;
}

export const filters: FilterDefinition[] = [
  {
    id: "dateFrom",
    label: "От",
    kind: "date",
    defaultValue: "",
    options: [],
  },
  {
    id: "dateTo",
    label: "До",
    kind: "date",
    defaultValue: "",
    options: [],
  },
  {
    id: "season",
    label: "Сезон",
    defaultValue: "all",
    options: [
      { value: "all", label: "Все сезоны" },
      ...SEASONS.map((season) => ({ value: season.id, label: season.label })),
    ],
  },
  {
    id: "mode",
    label: "Режим",
    defaultValue: "premier",
    options: [
      { value: "premier", label: "Premier" },
      { value: "competitive", label: "Competitive" },
      { value: "wingman", label: "Wingman" },
    ],
  },
  {
    id: "map",
    label: "Карта",
    defaultValue: "all",
    options: [
      { value: "all", label: "Все карты" },
      { value: "de_mirage", label: "Mirage" },
      { value: "de_dust2", label: "Dust2" },
      { value: "de_inferno", label: "Inferno" },
      { value: "de_ancient", label: "Ancient" },
      { value: "de_nuke", label: "Nuke" },
      { value: "de_anubis", label: "Anubis" },
      { value: "de_cache", label: "Cache" },
      { value: "de_overpass", label: "Overpass" },
    ],
  },
  {
    id: "side",
    label: "Сторона",
    defaultValue: "all",
    options: [
      { value: "all", label: "Обе" },
      { value: "T", label: "T" },
      { value: "CT", label: "CT" },
    ],
  },
  {
    id: "eco",
    label: "Закуп",
    defaultValue: "all",
    options: [
      { value: "all", label: "Любой" },
      { value: "pistol", label: "Пистолетный" },
      { value: "eco", label: "Эко" },
      { value: "semi", label: "Полу-эко" },
      { value: "force", label: "Форс" },
      { value: "full", label: "Фулл-бай" },
    ],
  },
  {
    id: "phase",
    label: "Фаза",
    defaultValue: "all",
    options: [
      { value: "all", label: "Все" },
      { value: "early", label: "Ранняя" },
      { value: "mid", label: "Средняя" },
      { value: "late", label: "Поздняя" },
      { value: "post_plant", label: "Пост-плант" },
    ],
  },
  {
    id: "weapon",
    label: "Оружие",
    defaultValue: "all",
    options: [
      { value: "all", label: "Все" },
      { value: "ak47", label: "AK-47" },
      { value: "m4a1-s", label: "M4A1-S" },
      { value: "awp", label: "AWP" },
      { value: "deagle", label: "Desert Eagle" },
      { value: "usp-s", label: "USP-S" },
      { value: "glock-18", label: "Glock-18" },
    ],
  },
  {
    id: "result",
    label: "Результат",
    defaultValue: "all",
    options: [
      { value: "all", label: "Любой" },
      { value: "win", label: "Победы" },
      { value: "loss", label: "Поражения" },
    ],
  },
];

export function defaultFilters(): Record<string, string> {
  return Object.fromEntries(filters.map((filter) => [filter.id, filter.defaultValue]));
}
