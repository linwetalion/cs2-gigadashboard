import type { DashboardPayload, Metric, Widget as WidgetModel } from "@giga/shared";
import { WidgetChart } from "./Charts";
import { MapWidget, TableWidget } from "./DataWidgets";
import { MetricHint } from "./TooltipPanel";
import { deltaLabel, goodDirection } from "../format";

interface Props {
  widget: WidgetModel;
  data: DashboardPayload;
  metrics: Record<string, Metric>;
  onOpen: (id: string) => void;
}

export function Widget({ widget, data, metrics, onOpen }: Props) {
  const firstId = widget.metricIds[0];
  const metric = metrics[firstId];
  const value = data.values[firstId];
  const series = data.series[widget.id] ?? [];
  const delta = value && metric ? deltaLabel(value, metric) : null;
  const tone = value && metric ? goodDirection(value.value, metric, value.benchmark) : "neutral";

  if (!metric) {
    return (
      <article className={`widget size-${widget.size}`}>
        <div className="widget-head">
          <h3>{widget.title}</h3>
        </div>
        <div className="empty">Метрика {firstId} не найдена</div>
      </article>
    );
  }

  const isChart = ["line", "bar", "stacked", "radar", "scatter"].includes(widget.kind);

  return (
    <article className={`widget size-${widget.size} kind-${widget.kind}`}>
      <div className="widget-head">
        <div className="widget-title">
          <h3>{widget.title}</h3>
          <span className="widget-id">{firstId}</span>
        </div>
        <span className="tip-wrap">
          <button className="tip-btn" aria-label={`Пояснение: ${metric.name}`}>
            ?
          </button>
          <MetricHint metric={metric} value={value} />
        </span>
      </div>

      {widget.kind === "kpi" && (
        <button className="kpi" onClick={() => onOpen(firstId)}>
          <span className={`kpi-value tone-${tone}`}>{value?.display ?? "N/A"}</span>
          <span className="kpi-meta">
            {delta && <span className={`delta ${delta.startsWith("-") ? "down" : "up"}`}>{delta}</span>}
            {value?.benchmark !== null && value?.benchmark !== undefined && (
              <span className="bench">бенч {value.benchmark.toFixed(1)}</span>
            )}
            <span className={`dot ${value?.confidence ?? "none"}`} title={value?.confidence} />
          </span>
        </button>
      )}

      {isChart && (
        <button className="chart-btn" onClick={() => onOpen(firstId)}>
          <WidgetChart kind={widget.kind} series={series} metric={metric} />
        </button>
      )}

      {widget.kind === "table" && (
        <TableWidget widget={widget} metrics={metrics} values={data.values} series={data.series} onOpen={onOpen} />
      )}

      {widget.kind === "map" && <MapWidget widget={widget} matches={data.matches} onOpen={onOpen} />}

      {widget.subtitle && <div className="widget-sub">{widget.subtitle}</div>}
    </article>
  );
}
