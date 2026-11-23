import { useEffect, useMemo, useState } from "react";
import type {
  FunnelStage,
  TeamDetailPayload,
  TeamListItem,
  TeamMemberStat,
  TeamsPayload,
} from "@giga/shared";
import { fetchTeam, fetchTeams } from "../api";
import { Funnel } from "./Funnel";

const MAX_COMPARE = 3;

function initials(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim();
  if (!clean) return "??";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || clean.slice(0, 2).toUpperCase();
}

function fmt(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function mapName(map: string): string {
  return map.replace(/^de_/, "").replace(/^./, (char) => char.toUpperCase());
}

function dateLabel(value: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function rosterLabel(team: TeamListItem): string {
  return team.players.map((player) => (player.isMe ? "ты" : player.name)).join(" · ");
}

function PlayerChips({
  players,
  size = "m",
}: {
  players: TeamListItem["players"];
  size?: "s" | "m";
}) {
  return (
    <div className={`team-players ${size}`}>
      {players.map((player) => (
        <span key={player.steamId} className={`team-player ${player.isMe ? "me" : ""}`}>
          <i>{initials(player.name)}</i>
          <em>{player.isMe ? "ты" : player.name}</em>
        </span>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className={`team-tile ${tone ?? ""}`} title={hint}>
      <span>{label}</span>
      <b>{value}</b>
      <i className="tile-hint">?</i>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Team row: full-width horizontal block, expands downwards            */
/* ------------------------------------------------------------------ */

function TeamRowStats({ team }: { team: TeamListItem }) {
  const items: Array<{ label: string; value: string; hint: string }> = [
    { label: "Игры", value: String(team.games), hint: "Число матчей, где эти пять игроков играли в одной команде" },
    { label: "Win rate", value: pct(team.winRate), hint: "Победы / игры × 100" },
    { label: "K/D", value: fmt(team.kd, 2), hint: "Σ убийств / Σ смертей по всем пяти игрокам" },
    { label: "ADR", value: fmt(team.adr), hint: "Σ урона / (Σ раундов × 5) по всем пяти игрокам" },
    { label: "Aim", value: fmt(team.aim), hint: "Средний aim-рейтинг Leetify по всем участникам" },
    { label: "Utility", value: fmt(team.utility), hint: "Средний utility-рейтинг Leetify" },
    { label: "5v4", value: pct(team.openingWonRate), hint: "Раунды с первым киллом команды / все раунды × 100" },
  ];
  return (
    <div className="team-row-stats">
      {items.map((item) => (
        <span key={item.label} title={item.hint}>
          <em>{item.label}</em>
          <b>{item.value}</b>
        </span>
      ))}
    </div>
  );
}

function TeamRow({
  team,
  index,
  filters,
  open,
  selected,
  compareDisabled,
  onToggle,
  onSelect,
}: {
  team: TeamListItem;
  index: number;
  filters: Record<string, string>;
  open: boolean;
  selected: boolean;
  compareDisabled: boolean;
  onToggle: () => void;
  onSelect: (next: boolean) => void;
}) {
  return (
    <article className={`team-row ${open ? "open" : ""} ${selected ? "picked" : ""}`}>
      <header className="team-row-head">
        <label
          className={`team-pick ${compareDisabled && !selected ? "disabled" : ""}`}
          title={
            compareDisabled && !selected
              ? `Можно сравнить не больше ${MAX_COMPARE} составов`
              : "Добавить состав в сравнение"
          }
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            disabled={compareDisabled && !selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
          <span />
        </label>

        <button className="team-row-main" onClick={onToggle} aria-expanded={open}>
          <div className="team-row-ident">
            <span className="team-rank">
              #{index + 1} · 5-stack · {team.maps.map(mapName).join(" · ")}
            </span>
            <PlayerChips players={team.players} />
          </div>
          <TeamRowStats team={team} />
          <span className={`team-row-chevron ${open ? "up" : ""}`} aria-hidden="true">
            ▾
          </span>
        </button>
      </header>

      {open && <TeamDetailBody teamKey={team.key} filters={filters} />}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Detail body                                                        */
/* ------------------------------------------------------------------ */

function MemberTable({ members }: { members: TeamMemberStat[] }) {
  return (
    <div className="team-table">
      <div className="team-table-row head">
        <span>Игрок</span>
        <span>Игр</span>
        <span>K / D / A</span>
        <span>K/D</span>
        <span>ADR</span>
        <span>KAST</span>
        <span>HS%</span>
        <span>Aim</span>
        <span>Utility</span>
        <span>Rating</span>
        <span>Опенинги</span>
        <span>Выжил</span>
      </div>
      {members.map((member) => (
        <div className={`team-table-row ${member.isMe ? "me" : ""}`} key={member.steamId}>
          <span className="member-name">
            <i>{initials(member.name)}</i>
            {member.isMe ? "ты" : member.name}
          </span>
          <span>{member.games}</span>
          <span>
            {member.kills} / {member.deaths} / {member.assists}
          </span>
          <span>{fmt(member.kd, 2)}</span>
          <span>{fmt(member.adr)}</span>
          <span>{pct(member.kast * 100, 0)}</span>
          <span>{pct(member.hsPct, 0)}</span>
          <span>{fmt(member.aim)}</span>
          <span>{fmt(member.utility)}</span>
          <span>{fmt(member.rating, 2)}</span>
          <span title="Первый килл раунда / смерть от первого килла">
            {member.openingKills} / {member.openingDeaths}
          </span>
          <span>{pct(member.survivalPct, 0)}</span>
        </div>
      ))}
    </div>
  );
}

function MapTable({ detail }: { detail: TeamDetailPayload }) {
  return (
    <div className="team-table maps">
      <div className="team-table-row head">
        <span>Карта</span>
        <span>Игр</span>
        <span>W / L</span>
        <span>Win rate</span>
        <span>Раунды</span>
        <span>Aim</span>
        <span>Utility</span>
        <span>ADR</span>
        <span>KAST</span>
        <span>Последняя</span>
      </div>
      {detail.maps.map((map) => (
        <div className="team-table-row" key={map.map}>
          <span className="map-name">{mapName(map.map)}</span>
          <span>{map.games}</span>
          <span>
            {map.wins} / {map.losses}
          </span>
          <span>{pct(map.winRate, 0)}</span>
          <span>{map.rounds}</span>
          <span>{fmt(map.aim)}</span>
          <span>{fmt(map.utility)}</span>
          <span>{fmt(map.adr)}</span>
          <span>{pct(map.kast * 100, 0)}</span>
          <span className="muted">{dateLabel(map.lastPlayedAt)}</span>
        </div>
      ))}
    </div>
  );
}

function AimSpotlight({ detail }: { detail: TeamDetailPayload }) {
  const { lastDust2, previousMap, previousMapName } = detail.mapAim;
  if (!lastDust2) {
    return (
      <div className="aim-spotlight empty">
        <h3>Aim на последнем Dust2</h3>
        <p className="muted">У состава ещё не было матча на Dust2 в выбранном периоде.</p>
      </div>
    );
  }
  const diff =
    lastDust2.aim !== null && previousMap?.aim !== null && previousMap?.aim !== undefined
      ? lastDust2.aim - previousMap.aim
      : null;
  return (
    <div className="aim-spotlight">
      <div className="aim-card">
        <span className="eyebrow">последний Dust2</span>
        <h3>{dateLabel(lastDust2.lastPlayedAt)}</h3>
        <div className="aim-big">{fmt(lastDust2.aim)}</div>
        <div className="aim-meta">
          <span>{lastDust2.wins ? "победа" : "поражение"}</span>
          <span>{lastDust2.rounds} раундов</span>
          <span>utility {fmt(lastDust2.utility)}</span>
        </div>
      </div>
      <div className="aim-card ghost">
        <span className="eyebrow">карта до неё</span>
        <h3>
          {previousMapName ? mapName(previousMapName) : "—"} ·{" "}
          {previousMap ? dateLabel(previousMap.lastPlayedAt) : "—"}
        </h3>
        <div className="aim-big">{fmt(previousMap?.aim)}</div>
        <div className="aim-meta">
          <span>{previousMap?.wins ? "победа" : "поражение"}</span>
          <span>{previousMap?.rounds ?? 0} раундов</span>
          <span>utility {fmt(previousMap?.utility)}</span>
        </div>
      </div>
      <div className={`aim-diff ${diff !== null && diff >= 0 ? "up" : "down"}`}>
        <span>Δ aim</span>
        <b>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`}</b>
        <em>Dust2 минус предыдущая карта</em>
      </div>
    </div>
  );
}

function TeamDetailBody({
  teamKey,
  filters,
}: {
  teamKey: string;
  filters: Record<string, string>;
}) {
  const [detail, setDetail] = useState<TeamDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    fetchTeam(teamKey, filters)
      .then((payload) => {
        if (alive) setDetail(payload);
      })
      .catch((reason: unknown) => {
        if (alive) setError(String(reason));
      });
    return () => {
      alive = false;
    };
  }, [teamKey, filters]);

  if (error) return <div className="panel-error">{error}</div>;
  if (!detail) return <div className="team-row-loading skeleton" />;

  const { team, members, funnel, recent } = detail;
  return (
    <div className="team-row-body">
      <div className="team-tiles">
        <Tile label="K/D" value={fmt(team.kd, 2)} hint="Σ убийств / Σ смертей по всем участникам состава" />
        <Tile label="ADR" value={fmt(team.adr)} hint="Σ урона / (Σ раундов × 5) по всем участникам" />
        <Tile label="KAST" value={pct(team.kast * 100, 0)} hint="Средний KAST участников, взвешенный по раундам" />
        <Tile label="HS%" value={pct(team.hsPct, 0)} hint="Σ хедшотов / Σ убийств × 100" />
        <Tile label="Aim" value={fmt(team.aim)} hint="Средний aim-рейтинг Leetify по всем участникам и матчам" />
        <Tile label="Utility" value={fmt(team.utility)} hint="Средний utility-рейтинг Leetify" />
        <Tile label="Positioning" value={fmt(team.positioning)} hint="Средний positioning-рейтинг Leetify" />
        <Tile label="Leetify Rating" value={fmt(team.leetifyRating, 2)} hint="Средний Leetify Rating участников" />
        <Tile
          label="5v4 / раунд"
          value={pct(team.openingWonRate)}
          hint="Раунды, где команда забирала первый килл / все раунды × 100"
        />
        <Tile
          label="Win из 5v4"
          value={pct(team.winRateFromOpening)}
          hint="Победы в раундах с преимуществом 5v4 / раунды с 5v4 × 100"
          tone={
            (team.winRateFromOpening ?? 0) >= 60
              ? "good"
              : (team.winRateFromOpening ?? 0) < 45
                ? "bad"
                : "neutral"
          }
        />
      </div>

      <section className="detail-section">
        <header className="section-head">
          <div>
            <h3>State journey: от опенинга к победе</h3>
            <p>Поток раундов слева направо. Каждый шаг тоньше предыдущего, конверсия — между стадиями.</p>
          </div>
        </header>
        <Funnel
          stages={funnel}
          subtitle={`${team.games} игр · ${team.rounds} раундов · в среднем ${fmt(team.roundsPerGame)} раундов за игру`}
        />
      </section>

      <section className="detail-section">
        <header className="section-head">
          <div>
            <h3>Aim: последний Dust2 и карта до него</h3>
            <p>Средний aim состава в конкретном матче — чтобы видеть форму на ключевой карте.</p>
          </div>
        </header>
        <AimSpotlight detail={detail} />
      </section>

      <section className="detail-section">
        <header className="section-head">
          <div>
            <h3>Участники</h3>
            <p>Индивидуальные метрики внутри этого состава.</p>
          </div>
        </header>
        <MemberTable members={members} />
      </section>

      <section className="detail-section">
        <header className="section-head">
          <div>
            <h3>По картам</h3>
            <p>Метрики состава в разрезе карт.</p>
          </div>
        </header>
        <MapTable detail={detail} />
      </section>

      <section className="detail-section">
        <header className="section-head">
          <div>
            <h3>Последние матчи состава</h3>
            <p>Только игры, где все пять игроков были в одной команде.</p>
          </div>
          <span className="section-count">{recent.length} матчей</span>
        </header>
        <div className="match-table">
          <div className="match-row head">
            <span>Карта</span>
            <span>Счёт</span>
            <span>K / D / A</span>
            <span>ADR</span>
            <span>Aim</span>
            <span>Rating</span>
            <span>Дата</span>
          </div>
          {recent.map((match) => (
            <div key={match.matchId} className={`match-row ${match.result}`}>
              <span className="map-name">{mapName(match.map)}</span>
              <span className="score">
                {match.scoreUs}:{match.scoreThem}
              </span>
              <span>
                {match.kills} / {match.deaths} / {match.assists}
              </span>
              <span>{fmt(match.adr)}</span>
              <span>{fmt(match.aim)}</span>
              <span>{fmt(match.rating, 2)}</span>
              <span className="muted">{dateLabel(match.startedAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comparison: 2-3 lineups as columns                                 */
/* ------------------------------------------------------------------ */

type CompareRow = {
  id: string;
  label: string;
  hint?: string;
  values: Array<string | null>;
  numeric: Array<number | null>;
  highlight?: "max" | "min";
  group: string;
  playerId?: string;
};

function teamMetricRows(teams: TeamDetailPayload[]): CompareRow[] {
  const defs: Array<{
    id: string;
    label: string;
    hint: string;
    get: (team: TeamDetailPayload) => number | null;
    format: (value: number | null) => string;
    highlight?: "max" | "min";
  }> = [
    { id: "games", label: "Игры", hint: "Совместные матчи этих пяти игроков", get: (t) => t.team.games, format: (v) => (v === null ? "—" : String(v)) },
    { id: "winrate", label: "Win rate", hint: "Победы / игры × 100", get: (t) => t.team.winRate, format: (v) => pct(v), highlight: "max" },
    { id: "rounds", label: "Раунды", hint: "Σ (score_us + score_them)", get: (t) => t.team.rounds, format: (v) => (v === null ? "—" : String(v)) },
    { id: "rpg", label: "Раундов / игру", hint: "Раунды / игры", get: (t) => t.team.roundsPerGame, format: (v) => fmt(v) },
    { id: "kd", label: "K/D", hint: "Σ убийств / Σ смертей", get: (t) => t.team.kd, format: (v) => fmt(v, 2), highlight: "max" },
    { id: "adr", label: "ADR", hint: "Σ урона / (Σ раундов × 5)", get: (t) => t.team.adr, format: (v) => fmt(v), highlight: "max" },
    { id: "kast", label: "KAST", hint: "Средний KAST участников", get: (t) => t.team.kast * 100, format: (v) => pct(v, 0), highlight: "max" },
    { id: "hs", label: "HS%", hint: "Σ хедшотов / Σ убийств × 100", get: (t) => t.team.hsPct, format: (v) => pct(v, 0) },
    { id: "aim", label: "Aim", hint: "Средний aim-рейтинг Leetify", get: (t) => t.team.aim, format: (v) => fmt(v), highlight: "max" },
    { id: "utility", label: "Utility", hint: "Средний utility-рейтинг Leetify", get: (t) => t.team.utility, format: (v) => fmt(v), highlight: "max" },
    { id: "positioning", label: "Positioning", hint: "Средний positioning-рейтинг Leetify", get: (t) => t.team.positioning, format: (v) => fmt(v), highlight: "max" },
    { id: "rating", label: "Leetify Rating", hint: "Средний Leetify Rating", get: (t) => t.team.leetifyRating, format: (v) => fmt(v, 2), highlight: "max" },
    { id: "fivevfour", label: "5v4 / раунд", hint: "Раунды с первым киллом / все раунды × 100", get: (t) => t.team.openingWonRate, format: (v) => pct(v), highlight: "max" },
    { id: "win5v4", label: "Win из 5v4", hint: "Победы в раундах с 5v4 / раунды с 5v4 × 100", get: (t) => t.team.winRateFromOpening, format: (v) => pct(v), highlight: "max" },
  ];
  return defs.map((def) => {
    const numeric = teams.map((team) => {
      const value = def.get(team);
      return value === null || !Number.isFinite(value) ? null : value;
    });
    return {
      id: def.id,
      label: def.label,
      hint: def.hint,
      numeric,
      values: numeric.map((value) => (value === null ? "—" : def.format(value))),
      highlight: def.highlight,
      group: "team",
    };
  });
}

function funnelRows(teams: TeamDetailPayload[]): CompareRow[] {
  const ids = new Set<string>();
  for (const team of teams) for (const stage of team.funnel) ids.add(stage.id);
  return [...ids].map((id) => {
    const stages = teams.map((team) => team.funnel.find((stage) => stage.id === id) ?? null);
    const label = stages.find((stage): stage is FunnelStage => Boolean(stage))?.label ?? id;
    const hint = stages.find((stage): stage is FunnelStage => Boolean(stage))?.formula;
    const numeric = stages.map((stage) =>
      stage && stage.available ? (stage.conversion ?? 0) : null
    );
    return {
      id: `funnel-${id}`,
      label,
      hint,
      numeric,
      values: stages.map((stage) =>
        stage && stage.available
          ? stage.conversion === null
            ? String(stage.rounds)
            : `${stage.rounds} · ${pct(stage.conversion)}`
          : "—"
      ),
      highlight: "max" as const,
      group: "funnel",
    };
  });
}

function playerRows(teams: TeamDetailPayload[]): CompareRow[] {
  const players = new Map<string, { name: string; isMe: boolean }>();
  for (const team of teams) {
    for (const member of team.members) {
      players.set(member.steamId, { name: member.name, isMe: member.isMe });
    }
  }
  const defs: Array<{
    id: string;
    label: string;
    hint: string;
    get: (member: TeamMemberStat) => number | null;
    format: (value: number | null) => string;
    highlight?: "max" | "min";
  }> = [
    { id: "aim", label: "Aim", hint: "Средний aim-рейтинг Leetify в этом составе", get: (m) => m.aim, format: (v) => fmt(v), highlight: "max" },
    { id: "adr", label: "ADR", hint: "Σ урона / Σ раундов игрока", get: (m) => m.adr, format: (v) => fmt(v), highlight: "max" },
    { id: "kd", label: "K/D", hint: "Убийства / смерти игрока", get: (m) => m.kd, format: (v) => fmt(v, 2), highlight: "max" },
    { id: "rating", label: "Rating", hint: "Leetify Rating игрока", get: (m) => m.rating, format: (v) => fmt(v, 2), highlight: "max" },
  ];

  const rows: CompareRow[] = [];
  for (const [steamId, player] of players) {
    for (const def of defs) {
      const numeric = teams.map((team) => {
        const member = team.members.find((entry) => entry.steamId === steamId);
        if (!member) return null;
        const value = def.get(member);
        return value === null || !Number.isFinite(value) ? null : value;
      });
      rows.push({
        id: `${steamId}-${def.id}`,
        label: `${player.isMe ? "ты" : player.name} · ${def.label}`,
        hint: def.hint,
        numeric,
        values: numeric.map((value) => (value === null ? "—" : def.format(value))),
        highlight: def.highlight,
        group: "players",
        playerId: steamId,
      });
    }
  }
  return rows;
}

function funnelDeltaRows(rows: CompareRow[]): CompareRow[] {
  return rows.map((row) => {
    const base = row.numeric[0];
    const numeric = row.numeric.map((value, index) =>
      index === 0 || value === null || base === null ? null : value - base
    );
    return {
      id: `delta-${row.id}`,
      label: row.label,
      hint: "Разница конверсии в процентных пунктах относительно первого состава",
      numeric,
      values: numeric.map((value) =>
        value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)} п.п.`
      ),
      highlight: "max",
      group: "delta",
    };
  });
}

function isBest(row: CompareRow, index: number): boolean {
  if (!row.highlight) return false;
  const values = row.numeric.filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length < 2) return false;
  const target = row.highlight === "max" ? Math.max(...values) : Math.min(...values);
  return row.numeric[index] === target && values.filter((value) => value === target).length === 1;
}

function CompareTable({
  details,
  labels,
}: {
  details: TeamDetailPayload[];
  labels: string[];
}) {
  const rows = useMemo(
    () => [...teamMetricRows(details), ...funnelRows(details), ...playerRows(details)],
    [details]
  );
  const funnel = rows.filter((row) => row.group === "funnel");
  const groups: Array<{ id: string; title: string; rows: CompareRow[] }> = [
    { id: "team", title: "Команда", rows: rows.filter((row) => row.group === "team") },
    { id: "funnel", title: "Воронка 5v4 · раунды · конверсия", rows: funnel },
    ...(details.length >= 2
      ? [{ id: "delta", title: "Δ конверсии к составу 1, п.п.", rows: funnelDeltaRows(funnel) }]
      : []),
    {
      id: "players",
      title: "Игроки (одна и та же строка — один и тот же игрок)",
      rows: rows.filter((row) => row.group === "players"),
    },
  ];

  return (
    <div className="compare-table" style={{ ["--cols" as string]: String(details.length) }}>
      <div className="compare-row head">
        <span className="compare-metric">Метрика</span>
        {details.map((detail, index) => (
          <span key={detail.team.key} className="compare-team">
            <b>Состав {index + 1}</b>
            <em className="compare-roster">{labels[index]}</em>
            <i>
              {detail.team.games} игр · {pct(detail.team.winRate, 0)}
            </i>
          </span>
        ))}
      </div>

      {groups.map((group) => (
        <div key={group.id} className="compare-group">
          <div className="compare-row group-title">
            <span className="compare-metric">{group.title}</span>
            {details.map((detail) => (
              <span key={`${group.id}-${detail.team.key}`} />
            ))}
          </div>
          {group.rows.map((row) => (
            <div className={`compare-row ${row.group === "players" ? "player" : ""}`} key={row.id}>
              <span className="compare-metric" title={row.hint}>
                {row.label}
              </span>
              {row.values.map((value, index) => (
                <span
                  key={`${row.id}-${index}`}
                  className={`compare-value ${value === "—" ? "is-empty" : ""} ${
                    isBest(row, index) ? "best" : ""
                  }`}
                >
                  {value}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                            */
/* ------------------------------------------------------------------ */

export function TeamsView({ filters }: { filters: Record<string, string> }) {
  const [data, setData] = useState<TeamsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareDetails, setCompareDetails] = useState<TeamDetailPayload[] | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchTeams(filters)
      .then((payload) => {
        if (!alive) return;
        setData(payload);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (alive) setError(String(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    if (!comparing || selected.length < 2) {
      setCompareDetails(null);
      return;
    }
    let alive = true;
    setCompareError(null);
    setCompareDetails(null);
    Promise.all(selected.map((key) => fetchTeam(key, filters)))
      .then((details) => {
        if (alive) setCompareDetails(details);
      })
      .catch((reason: unknown) => {
        if (alive) setCompareError(String(reason));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparing, selected.join("|"), filterKey]);

  const toggleRow = (key: string) =>
    setExpanded((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    );

  const toggleSelect = (key: string, next: boolean) =>
    setSelected((current) => {
      if (next) return current.includes(key) ? current : [...current, key].slice(-MAX_COMPARE);
      return current.filter((entry) => entry !== key);
    });

  const teams = data?.teams ?? [];
  const selectedTeams = selected
    .map((key) => teams.find((team) => team.key === key))
    .filter((team): team is TeamListItem => Boolean(team));

  return (
    <div className="teams-view">
      <header className="teams-hero">
        <div>
          <span className="eyebrow">Teams · топ-10 составов</span>
          <h2>Пятёрки, с которыми ты играешь чаще всего</h2>
          <p>
            Состав — это точный набор из пяти игроков в одной команде. Список отсортирован по числу
            совместных игр за выбранный период. Нажми на строку, чтобы раскрыть метрики состава; отметь
            два или три состава галочками, чтобы сравнить их таблицей.
          </p>
        </div>
        <div className="teams-hero-stats">
          <div>
            <b>{data?.teams.length ?? "—"}</b>
            <span>составов</span>
          </div>
          <div>
            <b>{data?.meta.matchesWithRoster ?? "—"}</b>
            <span>матчей с ростером</span>
          </div>
          <div>
            <b>{data?.meta.distinctTeams ?? "—"}</b>
            <span>уникальных пятёрок</span>
          </div>
        </div>
      </header>

      {error && <div className="panel-error">{error}</div>}

      {loading && !data && (
        <div className="teams-list">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="skeleton team-row-skeleton" />
          ))}
        </div>
      )}

      {data && teams.length === 0 && (
        <div className="empty-state">
          <h3>Пока нет полных ростеров</h3>
          <p>
            Для топ-10 нужны матчи, где известны все пять игроков твоей команды. Сейчас таких матчей
            нет в выбранном периоде — попробуй «Всё время» или подтяни ростеры из Leetify.
          </p>
        </div>
      )}

      {data && teams.length > 0 && (
        <>
          <div className="teams-toolbar">
            <span>
              {data.meta.matches} матчей в фильтре · {data.meta.matchesWithRoster} с полным ростером
            </span>
            <div className="teams-toolbar-actions">
              {selected.length > 0 && (
                <button className="ghost small" onClick={() => { setSelected([]); setComparing(false); }}>
                  Сбросить выбор ({selected.length})
                </button>
              )}
              <button
                className="primary small"
                disabled={selected.length < 2}
                onClick={() => {
                  setComparing(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Сравнить {selected.length >= 2 ? `(${selected.length})` : ""}
              </button>
            </div>
          </div>

          {comparing && selected.length >= 2 && (
            <section className="compare-panel">
              <header className="section-head">
                <div>
                  <h2>Сравнение составов</h2>
                  <p>
                    Столбец = состав. Одна и та же строка игрока — один и тот же игрок, поэтому видно,
                    как он играет в разных составах. Лучшее значение в строке подсвечено.
                  </p>
                </div>
                <button className="ghost small" onClick={() => setComparing(false)}>
                  Свернуть
                </button>
              </header>
              {compareError && <div className="panel-error">{compareError}</div>}
              {!compareDetails && !compareError && (
                <div className="skeleton" style={{ height: 320 }} />
              )}
              {compareDetails && (
                <CompareTable
                  details={compareDetails}
                  labels={selectedTeams.map((team) => rosterLabel(team))}
                />
              )}
            </section>
          )}

          <div className="teams-list">
            {teams.map((team, index) => (
              <TeamRow
                key={team.key}
                team={team}
                index={index}
                filters={filters}
                open={expanded.includes(team.key)}
                selected={selected.includes(team.key)}
                compareDisabled={selected.length >= MAX_COMPARE}
                onToggle={() => toggleRow(team.key)}
                onSelect={(next) => toggleSelect(team.key, next)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
