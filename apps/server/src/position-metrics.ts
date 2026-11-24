import { db } from "./db.js";

/**
 * Aggregates that need the sampled position stream: movement, positioning,
 * crosshair placement and round-start economy.
 *
 * The sample rate is 1 Hz, which is enough for movement/positioning averages
 * but only gives an approximation for aim placement. Metrics that need
 * event-rate aim data are reported as N/A instead of being invented.
 */

const TICK_RATE = 64;
const GRID = 512; // map cells for coverage
const NEAR_TEAMMATE = 1000;
const ISOLATION_DISTANCE = 1200;
const CROSSHAIR_RANGE = 1500;

// Buy bands in equipment dollars.
const FULL_BUY = 3800;
const ECO_MAX = 1500;

interface Sample {
  round: number;
  tick: number;
  x: number;
  y: number;
  speed: number;
  team: string;
  walking: number;
  ducking: number;
  yaw: number | null;
  pitch: number | null;
  equip: number | null;
  cash: number | null;
}

export interface PositionMetricsResult {
  matchId: string;
  players: number;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function angleBetween(yaw: number, pitch: number, dx: number, dy: number, dz: number): number {
  const deg = Math.PI / 180;
  const fx = Math.cos(pitch * deg) * Math.cos(yaw * deg);
  const fy = Math.cos(pitch * deg) * Math.sin(yaw * deg);
  const fz = Math.sin(pitch * deg);
  const length = Math.hypot(dx, dy, dz);
  if (!length) return 180;
  const dot = (fx * dx + fy * dy + fz * dz) / length;
  return Math.acos(Math.min(1, Math.max(-1, dot))) / deg;
}

export function computePositionMetrics(matchId: string): PositionMetricsResult | null {
  const rows = db
    .prepare(
      `SELECT steamid, round_no AS round, tick, x, y, speed, team, walking, ducking,
              yaw, pitch, equip_value AS equip, cash
       FROM positions
       WHERE match_id = ? AND x IS NOT NULL AND y IS NOT NULL
       ORDER BY steamid, tick`
    )
    .all(matchId) as Array<{
    steamid: string;
    round: number;
    tick: number;
    x: number;
    y: number;
    speed: number | null;
    team: string | null;
    walking: number | null;
    ducking: number | null;
    yaw: number | null;
    pitch: number | null;
    equip: number | null;
    cash: number | null;
  }>;
  if (!rows.length) return null;

  const byPlayer = new Map<string, Sample[]>();
  for (const row of rows) {
    const list = byPlayer.get(row.steamid) ?? [];
    list.push({
      round: row.round,
      tick: row.tick,
      x: row.x,
      y: row.y,
      speed: Number(row.speed ?? 0),
      team: row.team ?? "?",
      walking: Number(row.walking ?? 0),
      ducking: Number(row.ducking ?? 0),
      yaw: row.yaw,
      pitch: row.pitch,
      equip: row.equip,
      cash: row.cash,
    });
    byPlayer.set(row.steamid, list);
  }

  const winners = new Map(
    (
      db
        .prepare("SELECT round_no, winner FROM rounds WHERE match_id = ?")
        .all(matchId) as Array<{ round_no: number; winner: string }>
    ).map((row) => [row.round_no, row.winner])
  );

const insert = db.prepare(`
    INSERT INTO match_player_extra (match_id, steamid, samples, distance, moving_samples,
      walk_samples, duck_samples, zones, nearest_median, isolation_samples, crosshair_median,
      equip_median, cash_median, rounds_started, full_buys, eco_rounds, force_rounds,
      pistol_rounds, full_buy_wins, eco_wins, force_wins, pistol_wins)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, steamid) DO UPDATE SET
      samples = excluded.samples, distance = excluded.distance,
      moving_samples = excluded.moving_samples, walk_samples = excluded.walk_samples,
      duck_samples = excluded.duck_samples, zones = excluded.zones,
      nearest_median = excluded.nearest_median, isolation_samples = excluded.isolation_samples,
      crosshair_median = excluded.crosshair_median, equip_median = excluded.equip_median,
      cash_median = excluded.cash_median, rounds_started = excluded.rounds_started,
      full_buys = excluded.full_buys, eco_rounds = excluded.eco_rounds,
      force_rounds = excluded.force_rounds, pistol_rounds = excluded.pistol_rounds,
      full_buy_wins = excluded.full_buy_wins, eco_wins = excluded.eco_wins,
      force_wins = excluded.force_wins, pistol_wins = excluded.pistol_wins
  `);

  const byTick = new Map<number, Array<{ steamid: string; x: number; y: number; team: string }>>();
  for (const [steamid, samples] of byPlayer) {
    for (const sample of samples) {
      const list = byTick.get(sample.tick) ?? [];
      list.push({ steamid, x: sample.x, y: sample.y, team: sample.team });
      byTick.set(sample.tick, list);
    }
  }

  const tx = db.transaction(() => {
    for (const [steamid, samples] of byPlayer) {
      let distance = 0;
      let moving = 0;
      let walking = 0;
      let ducking = 0;
      let isolation = 0;
      const nearest: number[] = [];
      const crosshair: number[] = [];
      const zones = new Set<string>();

      // Round-start snapshot: the earliest sample of each round.
      const startByRound = new Map<number, Sample>();
      for (const sample of samples) {
        if (!startByRound.has(sample.round)) startByRound.set(sample.round, sample);
      }

      for (let index = 0; index < samples.length; index++) {
        const sample = samples[index]!;
        const previous = samples[index - 1];
        if (previous && previous.round === sample.round) {
          distance += Math.hypot(sample.x - previous.x, sample.y - previous.y);
        }
        if (sample.speed > 5) moving += 1;
        if (sample.walking) walking += 1;
        if (sample.ducking) ducking += 1;
        zones.add(`${Math.floor(sample.x / GRID)}:${Math.floor(sample.y / GRID)}`);

        // Nearest teammate and crosshair placement at this tick.
        let bestMate = Infinity;
        let bestEnemy = Infinity;
        let enemyAngle = 180;
        for (const other of byTick.get(sample.tick) ?? []) {
          if (other.steamid === steamid) continue;
          const dx = other.x - sample.x;
          const dy = other.y - sample.y;
          const dist = Math.hypot(dx, dy);
          if (other.team === sample.team) {
            if (dist < bestMate) bestMate = dist;
          } else if (dist < bestEnemy && dist < CROSSHAIR_RANGE) {
            bestEnemy = dist;
            if (sample.yaw !== null && sample.pitch !== null) {
              enemyAngle = angleBetween(sample.yaw, sample.pitch, dx, dy, 0);
            }
          }
        }
        if (Number.isFinite(bestMate)) nearest.push(bestMate);
        if (bestEnemy < CROSSHAIR_RANGE) crosshair.push(enemyAngle);
        if (Number.isFinite(bestMate) && bestMate > ISOLATION_DISTANCE) isolation += 1;
      }

      const equips: number[] = [];
      const cash: number[] = [];
      let fullBuys = 0;
      let ecos = 0;
      let force = 0;
      let pistols = 0;
      let fullWins = 0;
      let ecoWins = 0;
      let forceWins = 0;
      let pistolWins = 0;

      for (const [round, sample] of startByRound) {
        if (sample.equip !== null) equips.push(sample.equip);
        if (sample.cash !== null) cash.push(sample.cash);
        const isPistol = round === 1 || round === 13;
        const isFull = !isPistol && (sample.equip ?? 0) >= FULL_BUY;
        const isEco = !isPistol && (sample.equip ?? 0) <= ECO_MAX;
        const isForce = !isPistol && !isFull && !isEco;
        const won = winners.get(round) === sample.team;
        if (isPistol) {
          pistols += 1;
          if (won) pistolWins += 1;
        } else if (isFull) {
          fullBuys += 1;
          if (won) fullWins += 1;
        } else if (isEco) {
          ecos += 1;
          if (won) ecoWins += 1;
        } else if (isForce) {
          force += 1;
          if (won) forceWins += 1;
        }
      }

      insert.run(
        matchId,
        steamid,
        samples.length,
        distance,
        moving,
        walking,
        ducking,
        zones.size,
        median(nearest),
        isolation,
        median(crosshair),
        median(equips),
        median(cash),
        startByRound.size,
        fullBuys,
        ecos,
        force,
        pistols,
        fullWins,
        ecoWins,
        forceWins,
        pistolWins
      );
    }

    // The economics are team-level, so the personal snapshot is enough: every
    // player of the same side starts the round with a similar buy.
  });
  tx();

  return { matchId, players: byPlayer.size };
}

export function parsedMatchIds(): string[] {
  return (
    db.prepare("SELECT DISTINCT match_id FROM positions").all() as Array<{ match_id: string }>
  ).map((row) => row.match_id);
}

export const positionTicksPerSecond = TICK_RATE;
