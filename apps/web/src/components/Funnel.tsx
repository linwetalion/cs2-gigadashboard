import type { FunnelStage } from "@giga/shared";

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return Math.round(value).toString();
  if (Math.abs(value) >= 10) return (Math.round(value * 10) / 10).toString();
  return (Math.round(value * 100) / 100).toString();
}

function conversionTone(value: number | null): string {
  if (value === null) return "neutral";
  if (value >= 60) return "good";
  if (value >= 40) return "mid";
  return "bad";
}

export function Funnel({
  stages,
  title,
  subtitle,
}: {
  stages: FunnelStage[];
  title?: string;
  subtitle?: string;
}) {
  const top = stages.find((stage) => stage.available && stage.rounds > 0)?.rounds ?? 0;
  return (
    <div className="funnel">
      {(title || subtitle) && (
        <header className="funnel-head">
          {title && <h3>{title}</h3>}
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      <div className="funnel-track">
        {stages.map((stage, index) => {
          const width = top > 0 ? Math.max(6, (stage.rounds / top) * 100) : 0;
          return (
            <div className="funnel-col" key={stage.id}>
              {index > 0 && (
                <div className={`funnel-link ${conversionTone(stage.conversion)}`}>
                  <span>{stage.conversion === null ? "—" : `${fmt(stage.conversion)}%`}</span>
                  <i>→</i>
                </div>
              )}
              <div className={`funnel-card ${stage.available ? "" : "muted"}`}>
                <div className="funnel-label" title={stage.hint}>
                  {stage.label}
                </div>
                <div className="funnel-value">{stage.available ? fmt(stage.rounds) : "—"}</div>
                <div className="funnel-sub">
                  {stage.available
                    ? `${fmt(stage.perGame)} / игру`
                    : "нет данных"}
                </div>
                <div className="funnel-bar">
                  <span style={{ width: `${stage.available ? width : 0}%` }} />
                </div>
                <div className="funnel-formula">{stage.formula}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FunnelCompare({
  a,
  b,
  labelA,
  labelB,
}: {
  a: FunnelStage[];
  b: FunnelStage[];
  labelA: string;
  labelB: string;
}) {
  const ids = a.map((stage) => stage.id);
  return (
    <div className="funnel-compare">
      <div className="funnel-compare-head">
        <span />
        <span>{labelA}</span>
        <span>{labelB}</span>
        <span>Δ</span>
      </div>
      {ids.map((id) => {
        const left = a.find((stage) => stage.id === id);
        const right = b.find((stage) => stage.id === id);
        if (!left || !right) return null;
        const delta = (right.conversion ?? 0) - (left.conversion ?? 0);
        return (
          <div className="funnel-compare-row" key={id}>
            <span className="funnel-compare-label">{left.label}</span>
            <span>
              {left.available ? `${fmt(left.rounds)} / ${fmt(left.conversion ?? 0)}%` : "—"}
            </span>
            <span>
              {right.available ? `${fmt(right.rounds)} / ${fmt(right.conversion ?? 0)}%` : "—"}
            </span>
            <span className={`delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
              {left.conversion === null || right.conversion === null
                ? "—"
                : `${delta > 0 ? "+" : ""}${fmt(delta)} п.п.`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
