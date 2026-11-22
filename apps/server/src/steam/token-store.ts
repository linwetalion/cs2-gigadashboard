import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "../config.js";

const authDir = resolve(dataDir, "auth");
const keyPath = resolve(authDir, "key.bin");
const tokenPath = resolve(authDir, "steam.json");

export interface StoredSteamSession {
  refreshToken: string;
  steamId: string;
  accountName: string;
  savedAt: string;
}

function ensureDir(): void {
  mkdirSync(authDir, { recursive: true });
}

function key(): Buffer {
  ensureDir();
  if (existsSync(keyPath)) return readFileSync(keyPath);
  const generated = randomBytes(32);
  writeFileSync(keyPath, generated, { mode: 0o600 });
  return generated;
}

export function saveSteamSession(session: StoredSteamSession): void {
  ensureDir();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const payload = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
  const tmp = `${tokenPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
  renameSync(tmp, tokenPath);
}

export function loadSteamSession(): StoredSteamSession | null {
  if (!existsSync(tokenPath)) return null;
  try {
    const payload = JSON.parse(readFileSync(tokenPath, "utf8")) as {
      version: number;
      iv: string;
      tag: string;
      data: string;
    };
    if (payload.version !== 1) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plain) as StoredSteamSession;
  } catch (error) {
    console.error("[auth] failed to decrypt Steam session", error);
    return null;
  }
}

export function clearSteamSession(): void {
  if (existsSync(tokenPath)) writeFileSync(tokenPath, "", { mode: 0o600 });
}
