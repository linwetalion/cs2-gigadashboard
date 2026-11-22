import "dotenv/config";
import { db } from "./db.js";

const matches = db
  .prepare("SELECT match_id FROM matches WHERE source = 'gc'")
  .all() as Array<{ match_id: string }>;

const update = db.prepare(
  "UPDATE match_players SET kast = ?, rating = ? WHERE match_id = ? AND steamid = ?"
);

for (const { match_id } of matches) {
  const roundsRow = db
    .prepare("SELECT MAX(round_no) AS rounds FROM rounds WHERE match_id = ?")
    .get(match_id) as { rounds: number | null };
  const rounds = roundsRow.rounds ?? 0;
  if (!rounds) continue;

  const players = db
    .prepare("SELECT steamid, kills, deaths, assists, adr FROM match_players WHERE match_id = ?")
    .all(match_id) as Array<{
    steamid: string;
    kills: number;
    deaths: number;
    assists: number;
    adr: number;
  }>;

  const events = db
    .prepare("SELECT round_no, killer, victim, assister FROM kills WHERE match_id = ?")
    .all(match_id) as Array<{
    round_no: number;
    killer: string | null;
    victim: string | null;
    assister: string | null;
  }>;

  const perPlayer = new Map<string, { kast: Set<number>; deaths: Set<number> }>();
  const ensure = (steamid: string) => {
    if (!perPlayer.has(steamid)) perPlayer.set(steamid, { kast: new Set(), deaths: new Set() });
    return perPlayer.get(steamid)!;
  };

  for (const event of events) {
    if (event.killer) ensure(event.killer).kast.add(event.round_no);
    if (event.assister) ensure(event.assister).kast.add(event.round_no);
    if (event.victim) ensure(event.victim).deaths.add(event.round_no);
  }

  for (const player of players) {
    const entry = ensure(player.steamid);
    for (let round = 1; round <= rounds; round++) {
      if (!entry.deaths.has(round)) entry.kast.add(round);
    }
    const kast = (entry.kast.size / rounds) * 100;
    const kpr = player.kills / rounds;
    const dpr = player.deaths / rounds;
    const apr = player.assists / rounds;
    const impact = 2.13 * kpr + 0.42 * apr - 0.41;
    const rating =
      0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * player.adr + 0.1587;
    update.run(kast, rating, match_id, player.steamid);
  }
}

console.log(`recomputed KAST for ${matches.length} matches`);
