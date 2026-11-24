import type { Metric, MetricValue } from "@giga/shared";
import { confidenceLabel } from "../api";

interface Props {
  metric: Metric;
  value?: MetricValue;
  onClose: () => void;
}

export function TooltipDrawer({ metric, value, onClose }: Props) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div>
            <div className="eyebrow">
              {metric.id} · {metric.domain}
            </div>
            <h2>{metric.name}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </header>

        <p className="drawer-lead">{metric.tooltip}</p>

        {metric.scope && (
          <section className="drawer-block">
            <h3>Что именно считается</h3>
            <p>{metric.scope}</p>
          </section>
        )}

        <section className="drawer-block">
          <h3>Формула</h3>
          <pre className="formula">{metric.formula}</pre>
        </section>

        {metric.example && (
          <section className="drawer-block">
            <h3>Пример</h3>
            <p>{metric.example}</p>
          </section>
        )}

        <section className="drawer-grid">
          <Field label="Единица" value={metric.unit} />
          <Field label="Направление" value={metric.direction === "up" ? "больше — лучше" : metric.direction === "down" ? "меньше — лучше" : "нейтрально"} />
          <Field label="Мин. выборка" value={String(metric.minSample)} />
          <Field label="Версия" value={`v${metric.version}`} />
          {value && <Field label="N" value={String(value.n)} />}
          {value && <Field label="Уверенность" value={confidenceLabel(value.confidence)} />}
        </section>

        {(metric.include || metric.exclude || metric.aggregation) && (
          <section className="drawer-block">
            {metric.include && <p><b>Включено:</b> {metric.include}</p>}
            {metric.exclude && <p><b>Исключено:</b> {metric.exclude}</p>}
            {metric.aggregation && <p><b>Агрегация:</b> {metric.aggregation}</p>}
          </section>
        )}

        {value && (
          <section className="drawer-block">
            <h3>Текущее значение</h3>
            <div className="drawer-value">{value.display}</div>
            <p className="muted">Источник значения: {value.source ?? "demo"}</p>
            {value.benchmark !== null && value.benchmark !== undefined && (
              <p className="muted">
                Бенчмарк ранга: {value.benchmark.toFixed(2)} · перцентиль {value.percentile ?? "—"}
              </p>
            )}
            {value.reason && <p className="warn">Причина: {value.reason}</p>}
          </section>
        )}

        {(metric.canon || metric.alias || metric.derived) && (
          <section className="drawer-block">
            {metric.canon && <p><b>Канон:</b> {metric.canon}</p>}
            {metric.alias && <p><b>Алиас:</b> {metric.alias}</p>}
            {metric.derived && <p><b>Производная:</b> {metric.derived}</p>}
          </section>
        )}

        <footer className="drawer-foot">
          <span className="muted">Референсы формул: {metric.sources.join(", ")}</span>
        </footer>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawer-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricHint({ metric, value }: { metric: Metric; value?: MetricValue }) {
  return (
    <div className="hint" role="tooltip">
      <div className="hint-head">
        <b>{metric.name}</b>
        <span>{metric.id}</span>
      </div>
      <p>{metric.tooltip}</p>
      {metric.scope && <p className="hint-scope">{metric.scope}</p>}
      <code>{metric.formula}</code>
      <div className="hint-foot">
        <span>{metric.unit}</span>
        {value && <span>N={value.n} · {confidenceLabel(value.confidence)}</span>}
      </div>
    </div>
  );
}
