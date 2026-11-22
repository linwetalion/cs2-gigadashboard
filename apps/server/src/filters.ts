import type { FilterDefinition } from "@giga/shared";

export const filters: FilterDefinition[] = [
  {
    id: "range",
    label: "Период",
    defaultValue: "all",
    options: [
      { value: "7d", label: "7 дней" },
      { value: "30d", label: "30 дней" },
      { value: "90d", label: "90 дней" },
      { value: "season", label: "Сезон" },
      { value: "all", label: "Всё время" },
    ],
  },
  {
    id: "season",
    label: "Сезон",
    defaultValue: "3",
    options: [
      { value: "3", label: "Season 3" },
      { value: "2", label: "Season 2" },
      { value: "1", label: "Season 1" },
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
