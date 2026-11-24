import "dotenv/config";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import {
  PORT,
  HOST,
  IS_DEMO,
  STEAM_SYNC,
  STEAM_REFRESH_TOKEN,
  STEAM_ID,
  webDist,
} from "./config.js";
import { db } from "./db.js";
import { buildDashboard } from "./dashboard.js";
import { seedDemo } from "./demo.js";
import { filters } from "./filters.js";
import { metric, metrics, registryVersion } from "./registry.js";
import { decodeShareCode, isShareCode } from "./steam/sharecode.js";
import { requestRecentMatches, startSteamWorker, stopSteamWorker, workerStatus } from "./steam/worker.js";
import { processDemo } from "./steam/demo-parse.js";
import { canWalkHistory, historyStatus, startHistory } from "./steam/history.js";
import { buildTeams, buildTeamDetail, buildTeamCompare } from "./teams.js";
import { importSteamReplays, type SteamReplayItem } from "./steam/replay-import.js";
import {
  autoIngestStatus,
  requestSync,
  runAutoIngestOnce,
  startAutoIngest,
} from "./steam/match-history.js";
import {
  cancelLogin,
  configureLogin,
  loginState,
  logoutSteam,
  markRestored,
  startCredentials,
  startQr,
  storedSession,
  submitGuard,
} from "./steam/login.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 64 * 1024 * 1024,
});
await app.register(cors, { origin: true });

// Optional HTTP Basic Auth. Required whenever the app is exposed outside loopback.
const APP_USER = process.env.APP_USER;
const APP_PASSWORD = process.env.APP_PASSWORD;
if (APP_USER && APP_PASSWORD) {
  const expected = Buffer.from(`${APP_USER}:${APP_PASSWORD}`);
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/api/health") return;
    const header = request.headers.authorization ?? "";
    const actual = Buffer.from(header.replace(/^Basic\s+/i, ""), "base64");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      reply.header("www-authenticate", 'Basic realm="GigaDashboard"');
      return reply.code(401).send({ code: "UNAUTHORIZED", message: "Basic auth required" });
    }
  });
}

configureLogin({
  onAuthenticated: (session) => {
    startSteamWorker({
      refreshToken: session.refreshToken,
      steamId: session.steamId,
      accountName: session.accountName,
    });
  },
  onLogout: () => {
    stopSteamWorker();
    workerStatus.lastError = "Disconnected";
  },
});

const restored = storedSession();
if (restored && process.env.STEAM_AUTOSTART !== "0") {
  markRestored(restored);
  startSteamWorker({
    refreshToken: restored.refreshToken,
    steamId: restored.steamId,
    accountName: restored.accountName,
  });
} else if (STEAM_SYNC && STEAM_REFRESH_TOKEN) {
  startSteamWorker({ refreshToken: STEAM_REFRESH_TOKEN, steamId: STEAM_ID });
}

if (process.env.AUTO_INGEST !== "0" && (restored || (STEAM_SYNC && STEAM_REFRESH_TOKEN))) {
  startAutoIngest(Number(process.env.AUTO_INGEST_MINUTES ?? 5));

  // The GC pushes a fresh match list right after a game. Watching the worker
  // timestamp gives us an instant trigger without coupling the two modules.
  let lastMatchAt = "";
  setInterval(() => {
    if (workerStatus.lastMatchAt && workerStatus.lastMatchAt !== lastMatchAt) {
      lastMatchAt = workerStatus.lastMatchAt;
      requestSync(3000);
    }
  }, 30_000).unref();
}

const matchCount = (
  db.prepare("SELECT COUNT(*) AS count FROM matches WHERE status = 'published'").get() as {
    count: number;
  }
).count;

if (IS_DEMO && matchCount === 0) {
  const seeded = seedDemo();
  app.log.info({ seeded }, "seeded demo dataset");
}

app.get("/api/health", async () => ({
  ok: true,
  demo: IS_DEMO,
  metrics: metrics.length,
  registryVersion,
}));

app.get("/api/bootstrap", async () => ({
  player: { steamId: "76561198075131708", name: "ULTIMATE" },
  filters,
  metrics: metrics.length,
  registryVersion,
  demo: IS_DEMO,
}));

app.get("/api/metrics", async () => ({
  version: registryVersion,
  count: metrics.length,
  metrics,
}));

app.get<{ Params: { id: string } }>("/api/metrics/:id", async (request, reply) => {
  try {
    return { metric: metric(request.params.id) };
  } catch {
    return reply.code(404).send({ code: "METRIC_NOT_FOUND", message: request.params.id });
  }
});

app.get<{ Querystring: Record<string, string> }>("/api/dashboard", async (request) => {
  return buildDashboard(request.query);
});

app.get<{ Querystring: Record<string, string> }>("/api/matches", async (request) => {
  const payload = buildDashboard(request.query);
  return {
    total: payload.matches.length,
    matches: payload.matches,
  };
});

app.get<{ Params: { id: string } }>("/api/matches/:id", async (request, reply) => {
  const row = db
    .prepare(
      `SELECT m.*, p.kills, p.deaths, p.assists, p.adr, p.hs_kills, p.rating
       FROM matches m
       LEFT JOIN match_players p ON p.match_id = m.match_id AND p.is_me = 1
       WHERE m.match_id = ?`
    )
    .get(request.params.id) as Record<string, unknown> | undefined;
  if (!row) return reply.code(404).send({ code: "MATCH_NOT_FOUND", message: request.params.id });
  const rounds = db
    .prepare("SELECT * FROM rounds WHERE match_id = ? ORDER BY round_no")
    .all(request.params.id);
  return { match: row, rounds };
});

app.get<{ Querystring: Record<string, string> }>("/api/export.csv", async (request, reply) => {
  const payload = buildDashboard(request.query);
  const rows = [["metric_id", "name", "value", "unit", "n", "confidence"]];
  for (const [id, value] of Object.entries(payload.values)) {
    const def = metric(id);
    rows.push([
      id,
      def.name,
      value.value === null ? "" : String(value.value),
      def.unit,
      String(value.n),
      value.confidence,
    ]);
  }
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", 'attachment; filename="giga-metrics.csv"');
  return csv;
});

app.get<{ Querystring: { code?: string } }>("/api/sharecode", async (request, reply) => {
  const code = request.query.code ?? "";
  if (!isShareCode(code)) {
    return reply.code(400).send({ code: "INVALID_SHARE_CODE", message: code });
  }
  return decodeShareCode(code);
});

app.get("/api/steam/status", async () => ({
  login: loginState(),
  worker: workerStatus,
  syncEnabled: STEAM_SYNC,
  hasToken: Boolean(storedSession()),
  hasApiKey: canWalkHistory(),
}));

app.post<{
  Body: {
    accountName?: string;
    password?: string;
    sharedSecret?: string;
    machineToken?: string;
  };
}>("/api/steam/login", async (request, reply) => {
  const { accountName, password, sharedSecret, machineToken } = request.body ?? {};
  if (!accountName || !password) {
    return reply.code(400).send({ code: "CREDENTIALS_REQUIRED", message: "accountName and password are required" });
  }
  return startCredentials({ accountName, password, sharedSecret, machineToken });
});

app.post<{ Body: { code?: string } }>("/api/steam/guard", async (request, reply) => {
  if (!request.body?.code) {
    return reply.code(400).send({ code: "CODE_REQUIRED", message: "Steam Guard code is required" });
  }
  return submitGuard(request.body.code);
});

app.post("/api/steam/qr", async () => startQr());

app.post("/api/steam/recent", async (_request, reply) => {
  const queued = requestRecentMatches();
  if (!queued) {
    return reply.code(409).send({ code: "GC_NOT_READY", message: "Steam GC is not connected yet" });
  }
  return { ok: true, queued: true };
});


app.get("/api/steam/auto", async () => autoIngestStatus);

app.post("/api/steam/auto/run", async () => {
  void runAutoIngestOnce();
  return { ok: true, queued: true };
});

app.post<{ Body: { items?: SteamReplayItem[] } }>(
  "/api/import/steam-replays",
  async (request, reply) => {
    const items = request.body?.items;
    if (!Array.isArray(items)) {
      return reply.code(400).send({ code: "ITEMS_REQUIRED", message: "items array is required" });
    }
    return { ok: true, ...importSteamReplays(items) };
  }
);

app.get<{ Querystring: Record<string, string> }>("/api/teams", async (request) => {
  return buildTeams(request.query);
});

app.get<{ Querystring: { a?: string; b?: string } }>("/api/teams/compare", async (request, reply) => {
  const { a, b } = request.query;
  if (!a || !b) {
    return reply.code(400).send({ code: "TEAMS_REQUIRED", message: "a and b are required" });
  }
  try {
    return buildTeamCompare(a, b);
  } catch {
    return reply.code(404).send({ code: "TEAM_NOT_FOUND", message: `${a} / ${b}` });
  }
});

app.get<{ Params: { key: string }; Querystring: Record<string, string> }>(
  "/api/teams/:key",
  async (request, reply) => {
    const detail = buildTeamDetail(request.params.key, request.query);
    if (!detail) {
      return reply.code(404).send({ code: "TEAM_NOT_FOUND", message: request.params.key });
    }
    return detail;
  }
);

app.get("/api/steam/history", async () => ({
  status: historyStatus,
  canWalk: canWalkHistory(),
  hasKey: canWalkHistory(),
}));

app.post<{ Body: { authCode?: string; knownCode?: string } }>(
  "/api/steam/history",
  async (request, reply) => {
    const { authCode, knownCode } = request.body ?? {};
    if (!authCode || !knownCode) {
      return reply
        .code(400)
        .send({ code: "HISTORY_CODES_REQUIRED", message: "authCode and knownCode are required" });
    }
    if (!isShareCode(knownCode)) {
      return reply.code(400).send({ code: "INVALID_SHARE_CODE", message: knownCode });
    }
    if (!canWalkHistory()) {
      return reply.code(409).send({
        code: "STEAM_API_KEY_MISSING",
        message: "Set STEAM_API_KEY in .env and restart the server",
      });
    }
    try {
      return await startHistory(authCode, knownCode);
    } catch (error) {
      return reply.code(409).send({
        code: "HISTORY_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

app.post<{ Params: { id: string } }>("/api/steam/demo/:id", async (request, reply) => {
  const row = db
    .prepare("SELECT demo_url FROM matches WHERE match_id = ?")
    .get(request.params.id) as { demo_url?: string } | undefined;
  if (!row?.demo_url) {
    return reply.code(404).send({ code: "DEMO_NOT_AVAILABLE", message: "No demo URL for this match" });
  }
  const session = storedSession();
  if (!session) {
    return reply.code(409).send({ code: "STEAM_NOT_CONNECTED", message: "Connect Steam first" });
  }
  try {
    const result = await processDemo(request.params.id, row.demo_url, session.steamId);
    return { ok: true, result };
  } catch (error) {
    return reply.code(500).send({
      code: "DEMO_PARSE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/steam/cancel", async () => cancelLogin());

app.post("/api/steam/logout", async () => logoutSteam());

app.post("/api/sync", async (_request, reply) => {
  if (!STEAM_SYNC || !STEAM_REFRESH_TOKEN) {
    return reply.code(409).send({
      code: "STEAM_SYNC_DISABLED",
      message:
        "Set STEAM_SYNC=1 and STEAM_REFRESH_TOKEN, then restart. The demo dataset is served from data/giga.db.",
    });
  }
  return {
    ok: true,
    queue: workerStatus,
    message: "Worker is running. Match normalization is the next milestone.",
  };
});

if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ code: "NOT_FOUND", message: request.url });
    }
    return reply.sendFile("index.html");
  });
} else {
  app.get("/", async () => ({
    service: "giga-server",
    message: "Web build not found. Run npm run dev (Vite on 5173) or npm run build.",
    api: "/api/bootstrap",
  }));
}

app
  .listen({ port: PORT, host: HOST })
  .then(() => {
    app.log.info(`Giga server on http://${HOST}:${PORT} (metrics: ${metrics.length})`);
    if (!workerStatus.enabled) {
      workerStatus.lastError = "Steam not connected";
    }
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
