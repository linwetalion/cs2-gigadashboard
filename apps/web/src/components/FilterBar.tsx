import { useEffect, useRef, useState } from "react";
import type { FilterDefinition } from "@giga/shared";

interface Props {
  filters: FilterDefinition[];
  state: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onReset: () => void;
  onExport: () => void;
  matches: number;
  rounds: number;
}

function toDisplay(iso: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

function toIso(text: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `.${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `.${digits.slice(4, 8)}`;
  return out;
}

function DateFilter({
  filter,
  value,
  active,
  onChange,
}: {
  filter: FilterDefinition;
  value: string;
  active: boolean;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(toDisplay(value));
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(toDisplay(value));
  }, [value]);

  const commit = (next: string) => {
    if (!next.trim()) {
      onChange("");
      return;
    }
    const iso = toIso(next);
    if (iso) onChange(iso);
    else setText(toDisplay(value));
  };

  const openPicker = () => {
    const input = picker.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    try {
      if (input.showPicker) input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  };

  return (
    <label className={`filter date-filter ${active ? "active" : ""}`}>
      <span>{filter.label}</span>
      <div className="date-input">
        <input
          value={text}
          placeholder="ДД.ММ.ГГГГ"
          inputMode="numeric"
          onChange={(event) => setText(maskDate(event.target.value))}
          onBlur={() => commit(text)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(text);
          }}
        />
        <button type="button" className="date-pick" onClick={openPicker} aria-label="Открыть календарь">
          ▦
        </button>
        <input
          ref={picker}
          className="date-native"
          type="date"
          value={value}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            onChange(event.target.value);
            setText(toDisplay(event.target.value));
          }}
        />
      </div>
    </label>
  );
}

export function FilterBar({ filters, state, onChange, onReset, onExport, matches, rounds }: Props) {
  return (
    <div className="filterbar">
      <div className="filter-row">
        {filters.map((filter) => {
          const value = state[filter.id] ?? filter.defaultValue;
          const active = value !== filter.defaultValue;
          if (filter.kind === "date") {
            return (
              <DateFilter
                key={filter.id}
                filter={filter}
                value={value}
                active={active}
                onChange={(next) => onChange(filter.id, next)}
              />
            );
          }
          return (
            <label key={filter.id} className={`filter ${active ? "active" : ""}`}>
              <span>{filter.label}</span>
              <select value={value} onChange={(event) => onChange(filter.id, event.target.value)}>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <div className="filter-actions">
          <button className="ghost" onClick={onReset}>
            Сбросить
          </button>
          <button className="ghost" onClick={onExport}>
            Export CSV
          </button>
        </div>
      </div>
      <div className="filter-summary">
        <span>
          <b>{matches}</b> матчей
        </span>
        <span>
          <b>{rounds}</b> раундов
        </span>
        <span className="muted">Все виджеты используют один и тот же срез</span>
      </div>
    </div>
  );
}
