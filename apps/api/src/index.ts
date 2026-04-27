import dotenv from "dotenv";
import { join } from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FileExporter } from "./services/exportService.js";
import { PlaywrightExtractor } from "./services/extractService.js";
import { HostRateLimiter } from "./services/rateLimiter.js";
import { FileRewriteLocalStateStore } from "./services/rewriteLocalStateStore.js";
import { OpenAIRewriter } from "./services/rewriteService.js";
import { JobRepository } from "./store/jobRepository.js";

dotenv.config();

const config = loadConfig();
const repository = new JobRepository(config.databasePath, config.storageDir);
const extractor = new PlaywrightExtractor(
  config.robotsUserAgent,
  new HostRateLimiter(config.minFetchIntervalMs)
);
const rewriter = new OpenAIRewriter(config.defaultProvider);
const exporter = new FileExporter(config.storageDir);
const rewriteLocalStateStore = new FileRewriteLocalStateStore(
  join(config.storageDir, "rewrite-local.json"),
  config.defaultProvider
);

const app = createApp({
  repository,
  extractor,
  rewriter,
  exporter,
  rewriteLocalStateStore
});

app.listen(config.port, config.host, () => {
  console.log(`[api] listening on http://${config.host}:${config.port}`);
});
