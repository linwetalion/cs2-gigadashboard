/**
 * CS2/CS:GO match share code codec.
 *
 * Share code: CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx
 * 25 chars from a 57-symbol alphabet encode a little-endian integer:
 *   low 32 bits  -> match id
 *   next 32 bits -> outcome id
 *   next 16 bits -> TV port (token)
 */
const ALPHABET = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";

export interface ShareCodeDetails {
  matchId: string;
  outcomeId: string;
  token: number;
}

export class ShareCodeError extends Error {}

export function isShareCode(value: string): boolean {
  return /^CSGO(-[A-Za-z0-9]{5}){5}$/.test(value.trim());
}

export function decodeShareCode(shareCode: string): ShareCodeDetails {
  const normalized = shareCode.trim();
  if (!isShareCode(normalized)) {
    throw new ShareCodeError(`Invalid share code: ${shareCode}`);
  }
  const body = normalized.slice(5).replaceAll("-", "");
  let value = 0n;
  for (const char of body) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new ShareCodeError(`Invalid share code symbol: ${char}`);
    value = value * 57n + BigInt(index);
  }
  if (value >= 1n << 144n) throw new ShareCodeError("Share code does not fit 144 bits");
  return {
    matchId: (value & 0xffffffffffffffffn).toString(),
    outcomeId: ((value >> 64n) & 0xffffffffffffffffn).toString(),
    token: Number((value >> 128n) & 0xffffn),
  };
}

export function encodeShareCode(details: ShareCodeDetails): string {
  const { matchId, outcomeId, token } = details;
  let value = BigInt(matchId) | (BigInt(outcomeId) << 64n) | (BigInt(token) << 128n);
  let body = "";
  for (let i = 0; i < 25; i++) {
    body = ALPHABET[Number(value % 57n)] + body;
    value /= 57n;
  }
  return `CSGO-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}-${body.slice(20)}`;
}

export function normalizeShareCode(shareCode: string): string {
  const body = shareCode.trim().replace(/^CSGO-?/i, "").replaceAll("-", "");
  if (body.length !== 25) throw new ShareCodeError("Share code body must be 25 characters");
  return `CSGO-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}-${body.slice(20)}`;
}
