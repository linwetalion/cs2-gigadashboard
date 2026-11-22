// Run in the browser console on https://leetify.com while logged in.
// It reads your own Leetify access token from localStorage, pages your match
// history backwards, and posts the games to the local Giga server.
(async () => {
  const token = localStorage.getItem("access_token");
  if (!token) throw new Error("Leetify access_token not found");
  const seen = new Map();
  let end = new Date().toISOString();
  for (let page = 0; page < 20; page++) {
    const filters = {
      dataSources: ["matchmaking"],
      currentPeriod: { start: "2022-01-01T00:00:00.000Z", end },
      previousPeriod: {
        start: "2021-01-01T00:00:00.000Z",
        end: "2021-12-31T23:59:59.999Z",
      },
      isPeriodSetManually: true,
    };
    const url =
      "https://api.cs-prod.leetify.com/api/v2/games/history?filters=" +
      encodeURIComponent(JSON.stringify(filters));
    const response = await fetch(url, { headers: { authorization: "Bearer " + token } });
    if (!response.ok) throw new Error("Leetify API " + response.status);
    const games = (await response.json()).games || [];
    if (!games.length) break;
    for (const game of games) seen.set(game.id, game);
    if (games.length < 2) break;
    end = new Date(new Date(games.at(-1).finishedAt).getTime() - 1000).toISOString();
  }
  const games = [...seen.values()];
  let imported = 0;
  let skipped = 0;
  for (let i = 0; i < games.length; i += 100) {
    const response = await fetch("http://127.0.0.1:8787/api/import/leetify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ games: games.slice(i, i + 100) }),
    });
    const result = await response.json();
    imported += result.imported || 0;
    skipped += result.skipped || 0;
  }
  console.log({ total: games.length, imported, skipped });
})();
