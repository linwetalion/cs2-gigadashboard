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
  accountName?: string;
  steamId?: string;
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
let activeUser: SteamUser | null = null;
let activeCs2: NodeCS2 | null = null;

export function stopSteamWorker(): void {
  try {
    activeUser?.logOff();
  } catch {
    // ignore
  }
  try {
    (activeCs2 as unknown as { dispose?: () => void })?.dispose?.();
  } catch {
    // ignore
  }
  activeUser = null;
  activeCs2 = null;
  workerStatus.loggedOn = false;
  workerStatus.gcConnected = false;
  workerStatus.enabled = false;
}

/**
 * Starts the optional Steam/GC worker. It is intentionally opt-in:
 * without a refresh token nothing connects to Valve.
 */
export function startSteamWorker(options: {
  refreshToken?: string;
  steamId?: string;
  accountName?: string;
}): void {
  if (!options.refreshToken) {
    workerStatus.lastError = "No Steam refresh token";
    return;
  }
  stopSteamWorker();
  workerStatus.enabled = true;
  workerStatus.steamId = options.steamId;
  workerStatus.accountName = options.accountName;
  workerStatus.lastError = null;

  const user = new SteamUser();
  const cs2 = new NodeCS2(user as never);
  activeUser = user;
  activeCs2 = cs2;

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
