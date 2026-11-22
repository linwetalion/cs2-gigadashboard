import type { MatchSummary, Metric, MetricValue, Widget } from "@giga/shared";
import { mapName } from "../format";

interface TableProps {
  widget: Widget;
  metrics: Record<string, Metric>;
  values: Record<string, MetricValue>;
  series: Record<string, { label: string; value: number | null }[]>;
  onOpen: (id: string) => void;
}

export function TableWidget({ widget, metrics, values, series, onOpen }: TableProps) {
  const rows = widget.metricIds.map((id) => ({
    id,
    metric: metrics[id],
    value: values[id],
    series: series[widget.id] ?? [],
  }));

  return (
    <div className="table-widget">
      {rows.map((row) => {
        const max = Math.max(...row.series.map((point) => Math.abs(point.value ?? 0)), 1);
        return (
          <button key={row.id} className="table-row" onClick={() => onOpen(row.id)}>
            <span className="table-name">{row.metric?.name ?? row.id}</span>
            <span className="table-bar">
              <i style={{ width: `${Math.min(100, ((row.value?.value ?? 0) / max) * 100)}%` }} />
            </span>
            <b>{row.value?.display ?? "N/A"}</b>
          </button>
        );
      })}
    </div>
  );
}

interface MapProps {
  widget: Widget;
  matches: MatchSummary[];
  onOpen: (id: string) => void;
}

export function MapWidget({ widget, matches, onOpen }: MapProps) {
  const byMap = new Map<string, { wins: number; total: number; kd: number; kills: number; deaths: number }>();
  for (const match of matches) {
    const entry = byMap.get(match.map) ?? { wins: 0, total: 0, kd: 0, kills: 0, deaths: 0 };
    entry.total += 1;
    if (match.result === "win") entry.wins += 1;
    entry.kills += match.kills;
    entry.deaths += match.deaths;
    entry.kd = entry.kills / Math.max(entry.deaths, 1);
    byMap.set(match.map, entry);
  }
  const rows = [...byMap.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="map-grid">
      {rows.map(([map, stat]) => {
        const wr = stat.total ? (stat.wins / stat.total) * 100 : 0;
        return (
          <button key={map} className="map-card" onClick={() => onOpen(widget.metricIds[0])}>
            <div className="map-name">{mapName(map)}</div>
            <div className="map-wr">{wr.toFixed(0)}%</div>
            <div className="map-meta">
              {stat.wins}–{stat.total - stat.wins} · K/D {stat.kd.toFixed(2)}
            </div>
            <div className="map-bar">
              <i style={{ width: `${wr}%` }} />
            </div>
          </button>
        );
      })}
      {rows.length === 0 && <div className="empty">Нет матчей в выбранном срезе</div>}
    </div>
  );
}
