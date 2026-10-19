import { Redis } from "ioredis";
import { createAdapters } from "./adapters/createAdapters";
import { createApp } from "./app";
import { loadConfig } from "./config/env";
import { createLogger } from "./core/logger";
import { createRepositories } from "./repositories/createRepositories";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
redis.on("error", (error: Error) => logger.warn({ error: error.message }, "redis error"));
await redis.connect().catch((error: Error) => logger.warn({ error: error.message }, "redis not reachable at startup"));

const repositoryHandle = createRepositories(config);
const app = createApp({
  config,
  logger,
  repositories: repositoryHandle.repositories,
  adapters: createAdapters(config, { redis, logger }),
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, repository: config.repository }, "Integration API listening");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([repositoryHandle.close(), redis.quit()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
