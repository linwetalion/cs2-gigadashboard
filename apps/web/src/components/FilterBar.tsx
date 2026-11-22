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

export function FilterBar({ filters, state, onChange, onReset, onExport, matches, rounds }: Props) {
  return (
    <div className="filterbar">
      <div className="filter-row">
        {filters.map((filter) => (
          <label key={filter.id} className={`filter ${state[filter.id] !== filter.defaultValue ? "active" : ""}`}>
            <span>{filter.label}</span>
            <select
              value={state[filter.id] ?? filter.defaultValue}
              onChange={(event) => onChange(filter.id, event.target.value)}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
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
