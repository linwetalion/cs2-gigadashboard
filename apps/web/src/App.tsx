import { useEffect, useMemo, useState } from "react";
import type { DashboardPayload, Metric } from "@giga/shared";
import { fetchDashboard, fetchMetrics } from "./api";
import { FilterBar } from "./components/FilterBar";
import { SteamModal } from "./components/SteamModal";
import { TooltipDrawer } from "./components/TooltipPanel";
import { Widget } from "./components/Widget";
import { steamApi, type SteamStatus } from "./api";

function initialFilters(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(params.entries());
}

export default function App() {
  const [metrics, setMetrics] = useState<Record<string, Metric> | null>(null);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const [steamOpen, setSteamOpen] = useState(false);
  const [steamStatus, setSteamStatus] = useState<SteamStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetchMetrics()
      .then(setMetrics)
      .catch((reason: unknown) => setError(String(reason)));
  }, []);

  useEffect(() => {
    const load = () => {
      steamApi
        .status()
        .then(setSteamStatus)
        .catch(() => setSteamStatus(null));
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams(filters);
    history.replaceState(null, "", params.size ? `?${params.toString()}` : location.pathname);
    fetchDashboard(filters)
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters]);

  const activeFilters = useMemo(() => {
    if (!data) return [];
    return data.meta.filters.filter((filter) => (filters[filter.id] ?? filter.defaultValue) !== filter.defaultValue);
  }, [data, filters]);

  if (error) {
    return (
      <div className="fatal">
        <h1>Не удалось загрузить данные</h1>
        <p>{error}</p>
        <p className="muted">Проверьте, что сервер запущен на 127.0.0.1:8787.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <div>
            <strong>GigaDashboard</strong>
            <span>CS2 analytics</span>
          </div>
        </div>

        <div className="topbar-meta">
          {data && (
            <>
              <span className="player">
                <i className="avatar" />
                {data.meta.player.name}
                <em>#{data.meta.player.steamId.slice(-4)}</em>
              </span>
              <span className={`badge ${data.demo ? "demo" : "live"}`}>{data.demo ? "DEMO" : "REAL DATA"}</span>
              <span className="badge">registry {data.meta.registryVersion}</span>
              <span className="badge">{data.meta.sampleMatches} matches</span>
            </>
          )}
          <button className={`primary steam-btn ${steamStatus?.worker?.loggedOn ? "connected" : ""}`} onClick={() => setSteamOpen(true)}>
            <span className={`dot ${steamStatus?.worker?.loggedOn ? "high" : "none"}`} />
            {steamStatus?.worker?.loggedOn ? "Steam online" : "Подключить Steam"}
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">Один срез — все метрики</span>
          <h1>Гигадашборд</h1>
          <p>
            538 метрик, 27 доменов, формулы и тултипы у каждой цифры. Фильтры применяются ко всем
            виджетам одновременно.
          </p>
        </div>
        <div className="hero-stats">
          <div>
            <b>{data?.meta.sampleRounds ?? "—"}</b>
            <span>раундов</span>
          </div>
          <div>
            <b>{Object.keys(data?.values ?? {}).length}</b>
            <span>метрик</span>
          </div>
          <div>
            <b>{data?.meta.sampleMatches ?? "—"}</b>
            <span>матчей</span>
          </div>
        </div>
      </section>

      {data && (
        <FilterBar
          filters={data.meta.filters}
          state={filters}
          matches={data.meta.sampleMatches}
          rounds={data.meta.sampleRounds}
          onChange={(id, value) => setFilters((current) => ({ ...current, [id]: value }))}
          onReset={() => setFilters({})}
          onExport={() => window.open(`/api/export.csv?${new URLSearchParams(filters).toString()}`, "_blank")}
        />
      )}

      {activeFilters.length > 0 && (
        <div className="chips">
          {activeFilters.map((filter) => (
            <button
              key={filter.id}
              className="chip"
              onClick={() => {
                setFilters((current) => {
                  const next = { ...current };
                  delete next[filter.id];
                  return next;
                });
              }}
            >
              {filter.label}: {filter.options.find((option) => option.value === (filters[filter.id] ?? filter.defaultValue))?.label}
              <span>✕</span>
            </button>
          ))}
        </div>
      )}

      <nav className="section-nav">
        {data?.sections.map((section, index) => (
          <a key={section.id} href={`#${section.id}`}>
            <i>{String(index + 1).padStart(2, "0")}</i>
            {section.title}
          </a>
        ))}
      </nav>

      <main className={loading ? "dashboard is-loading" : "dashboard"}>
        {!data && <div className="skeleton-grid">{[...Array(8)].map((_, index) => <div key={index} className="skeleton" />)}</div>}

        {data?.sections.map((section) => (
          <section key={section.id} id={section.id} className="dash-section">
            <header className="section-head">
              <div>
                <h2>{section.title}</h2>
                <p>{section.description}</p>
              </div>
              <span className="section-count">{section.widgets.length} виджетов</span>
            </header>
            <div className="widget-grid">
              {section.widgets.map((widget) => (
                <Widget
                  key={widget.id}
                  widget={widget}
                  data={data}
                  metrics={metrics ?? {}}
                  onOpen={setOpenMetric}
                />
              ))}
            </div>
          </section>
        ))}

        {data && (
          <section className="dash-section">
            <header className="section-head">
              <div>
                <h2>Последние матчи</h2>
                <p>Срез, который сейчас выбран во фильтрах</p>
              </div>
              <span className="section-count">{data.matches.length} матчей</span>
            </header>
            <div className="match-table">
              <div className="match-row head">
                <span>Карта</span>
                <span>Счёт</span>
                <span>K / D / A</span>
                <span>ADR</span>
                <span>HS</span>
                <span>Rating</span>
                <span>Дата</span>
              </div>
              {data.matches.slice(0, 20).map((match) => (
                <div key={match.matchId} className={`match-row ${match.result}`}>
                  <span className="map-name">{match.map.replace("de_", "")}</span>
                  <span className="score">
                    {match.scoreUs}:{match.scoreThem}
                  </span>
                  <span>
                    {match.kills} / {match.deaths} / {match.assists}
                  </span>
                  <span>{match.adr.toFixed(1)}</span>
                  <span>{match.hs}</span>
                  <span>{match.rating.toFixed(2)}</span>
                  <span className="muted">
                    {new Date(match.startedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>
          Локальный сервер · SQLite · {data?.demo ? "демо-данные" : "GC + Leetify-история + демки"}
        </span>
        <span>Giga Score не является официальным рейтингом Valve</span>
      </footer>

      {openMetric && metrics?.[openMetric] && (
        <TooltipDrawer
          metric={metrics[openMetric]}
          value={data?.values[openMetric]}
          onClose={() => setOpenMetric(null)}
        />
      )}

      <SteamModal open={steamOpen} onClose={() => setSteamOpen(false)} onChanged={setSteamStatus} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
