import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  storageDir: string;
  robotsUserAgent: string;
  minFetchIntervalMs: number;
  defaultProvider: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
}

const ensureAbsolute = (inputPath: string) => {
  if (inputPath.startsWith(".") || inputPath.startsWith("..")) {
    return resolve(process.cwd(), inputPath);
  }
  return inputPath;
};

export const loadConfig = (): AppConfig => {
  const storageDir = ensureAbsolute(process.env.STORAGE_DIR ?? "./storage");
  mkdirSync(storageDir, { recursive: true });

  const databasePath = ensureAbsolute(process.env.DATABASE_PATH ?? `${storageDir}/autoextraction.db`);
  const robotsUserAgent = process.env.ROBOTS_USER_AGENT ?? "AutoExtractionBot/1.0";

  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 8787),
    storageDir,
    databasePath,
    robotsUserAgent,
    minFetchIntervalMs: Number(process.env.MIN_FETCH_INTERVAL_MS ?? 2000),
    defaultProvider: {
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini"
    }
  };
};
