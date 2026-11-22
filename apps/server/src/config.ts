import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const dataDir = resolve(rootDir, "data");
export const dbPath = process.env.GIGA_DB ?? resolve(dataDir, "giga.db");
export const metricsPath = resolve(dataDir, "metrics.yaml");
export const webDist = resolve(rootDir, "apps/web/dist");

export const PORT = Number(process.env.PORT ?? 8787);
export const HOST = process.env.HOST ?? "127.0.0.1";
export const IS_DEMO = (process.env.GIGA_DEMO ?? "1") === "1";
export const STEAM_SYNC = (process.env.STEAM_SYNC ?? "0") === "1";
export const STEAM_REFRESH_TOKEN = process.env.STEAM_REFRESH_TOKEN;
export const STEAM_ID = process.env.STEAM_ID;
