/**
 * Demo file location without third-party APIs.
 *
 * Valve serves CS2 replays from a cluster of hosts:
 *   http://replay<cluster>.valve.net/730/<matchId>_<outcomeId>.dem.bz2
 *
 * `matchId` and `outcomeId` come from the Game Coordinator (the `tv_port`
 * field of `watchablematchinfo` is the outcome id), but the cluster is not
 * reported reliably: the same file is replicated across several hosts and the
 * `server_ip` value from the GC payload does not always match one of them.
 * So we probe a short list of known cluster hosts and cache the first hit.
 */

const KNOWN_CLUSTERS = [
  181, 182, 183, 184, 185, 180, 186, 187, 188, 189, 190, 191, 192,
  151, 152, 153, 154, 155, 160, 161, 162, 170, 171, 172, 173, 174, 175,
  101, 102, 103, 104, 105, 110, 120, 130, 140, 150,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
];

let preferredCluster: number | null = null;

export function demoUrl(cluster: number | string, matchId: string, outcomeId: string): string {
  return `http://replay${cluster}.valve.net/730/${matchId}_${outcomeId}.dem.bz2`;
}

async function remoteSize(url: string): Promise<number> {
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
    await response.body?.cancel();
    // The CDN answers 206 even for a missing file, serving a tiny XML error
    // body, so the status code alone is not a reliable signal.
    const stored = Number(response.headers.get("x-goog-stored-content-length") ?? 0);
    const range = response.headers.get("content-range") ?? "";
    const total = Number(range.split("/")[1] ?? 0);
    return Math.max(stored, total);
  } catch {
    return 0;
  }
}

async function exists(url: string): Promise<boolean> {
  return (await remoteSize(url)) > 1_000_000;
}

export interface ResolvedDemo {
  url: string;
  cluster: number;
}

/**
 * Finds a live replica for a match. `matchId` may be padded or not: Valve
 * accepts both spellings of the same number.
 */
export async function resolveDemoUrl(
  matchId: string,
  outcomeId: string,
  hintedCluster?: number | null
): Promise<ResolvedDemo | null> {
  const ids = [...new Set([matchId, matchId.replace(/^0+(?=\d)/, "")])];
  const order = [
    ...(preferredCluster ? [preferredCluster] : []),
    ...(hintedCluster ? [hintedCluster] : []),
    ...KNOWN_CLUSTERS,
  ].filter((cluster, index, all) => all.indexOf(cluster) === index);

  for (const id of ids) {
    // Probe in small waves so a match is not stuck behind a dead host.
    for (let index = 0; index < order.length; index += 8) {
      const wave = order.slice(index, index + 8);
      const results = await Promise.all(
        wave.map(async (cluster) => {
          const url = demoUrl(cluster, id, outcomeId);
          return { cluster, url, ok: await exists(url) };
        })
      );
      const hit = results.find((result) => result.ok);
      if (hit) {
        preferredCluster = hit.cluster;
        return { url: hit.url, cluster: hit.cluster };
      }
    }
  }
  return null;
}
