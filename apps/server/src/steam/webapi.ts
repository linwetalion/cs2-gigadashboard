export interface ShareCodeWalkOptions {
  apiKey: string;
  steamId: string;
  authCode: string;
  knownCode: string;
  maxPages?: number;
  delayMs?: number;
  signal?: AbortSignal;
}

export class SteamWebApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message);
  }
}

const BASE = "https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getNextMatchSharingCode(params: {
  apiKey: string;
  steamId: string;
  authCode: string;
  knownCode: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const url = new URL(BASE);
  url.searchParams.set("key", params.apiKey);
  url.searchParams.set("steamid", params.steamId);
  url.searchParams.set("steamidkey", params.authCode);
  url.searchParams.set("knowncode", params.knownCode);

  const response = await fetch(url, { signal: params.signal });
  if (response.status === 202) return null; // no new matches yet
  if (response.status === 403) {
    throw new SteamWebApiError("Steam returned 403: check API key, auth code and profile", 403, false);
  }
  if (response.status === 429) {
    throw new SteamWebApiError("Steam rate limit", 429, true);
  }
  if (!response.ok) {
    throw new SteamWebApiError(`Steam Web API ${response.status}`, response.status, response.status >= 500);
  }

  const payload = (await response.json()) as { result?: { nextcode?: string } };
  const next = payload.result?.nextcode?.trim();
  if (!next || next === "n/a") return null;
  return next;
}

export async function walkShareCodes(options: ShareCodeWalkOptions): Promise<string[]> {
  const {
    apiKey,
    steamId,
    authCode,
    knownCode,
    maxPages = 500,
    delayMs = 350,
    signal,
  } = options;

  const found: string[] = [];
  let cursor = knownCode;

  for (let page = 0; page < maxPages; page++) {
    let next: string | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        next = await getNextMatchSharingCode({ apiKey, steamId, authCode, knownCode: cursor, signal });
        break;
      } catch (error) {
        if (error instanceof SteamWebApiError && error.retryable && attempt < 3) {
          await sleep(delayMs * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
    if (!next) break;
    found.push(next);
    cursor = next;
    if (delayMs > 0) await sleep(delayMs);
  }

  return found;
}
