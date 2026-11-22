import SteamUser from "steam-user";
import NodeCS2 from "node-cs2";
import { SerialQueue } from "./queue.js";

export interface SteamWorkerStatus {
  enabled: boolean;
  loggedOn: boolean;
  gcConnected: boolean;
  requests: number;
  lastError: string | null;
  lastMatchAt: string | null;
}

export const workerStatus: SteamWorkerStatus = {
  enabled: false,
  loggedOn: false,
  gcConnected: false,
  requests: 0,
  lastError: null,
  lastMatchAt: null,
};

const queue = new SerialQueue({ delayMs: 1500 });

/**
 * Starts the optional Steam/GC worker. It is intentionally opt-in:
 * without STEAM_SYNC=1 and a refresh token nothing connects to Valve.
 */
export function startSteamWorker(options: { refreshToken?: string; steamId?: string }): void {
  if (!options.refreshToken) {
    workerStatus.lastError = "STEAM_REFRESH_TOKEN is not set";
    return;
  }
  workerStatus.enabled = true;

  const user = new SteamUser();
  const cs2 = new NodeCS2(user as never);

  user.on("loggedOn", () => {
    workerStatus.loggedOn = true;
    workerStatus.lastError = null;
    user.gamesPlayed([730]);
  });

  user.on("error", (error: Error) => {
    workerStatus.lastError = error.message;
  });

  user.on("disconnected", () => {
    workerStatus.loggedOn = false;
    workerStatus.gcConnected = false;
  });

  user.on("appLaunched", (appid: number) => {
    if (appid === 730) cs2.helloGC();
  });

  cs2.on("connectedToGC", () => {
    workerStatus.gcConnected = true;
    if (options.steamId) {
      queue.add({
        id: `recent:${options.steamId}`,
        run: async () => {
          cs2.requestRecentGames(options.steamId!);
          workerStatus.requests += 1;
        },
      });
    }
  });

  cs2.on("disconnectedFromGC", () => {
    workerStatus.gcConnected = false;
  });

  cs2.on("matchList", (matches: unknown[]) => {
    workerStatus.lastMatchAt = new Date().toISOString();
    console.info(`[gc] matchList: ${matches.length} match(es)`);
    // Normalization is the next milestone; for now we only prove the pipe works.
  });

  cs2.on("error", (error: Error) => {
    workerStatus.lastError = error.message;
  });

  user.logOn({ refreshToken: options.refreshToken });
}
