import { loadConfig } from "../config/env";
import { startMocks } from "./mockServers";

const { mocks } = loadConfig();

const running = await startMocks({
  ports: mocks.ports,
  sizing: {
    minDelayMs: mocks.sizing.minDelayMs,
    maxDelayMs: mocks.sizing.maxDelayMs,
    failRate: mocks.sizing.failureRate,
  },
  pricing: { perSecond: mocks.pricing.rateLimitPerSecond },
});

console.log(`Sizing mock    ${running.urls.sizing}  (delay ${mocks.sizing.minDelayMs}-${mocks.sizing.maxDelayMs} ms, ${mocks.sizing.failureRate * 100}% failures)`);
console.log(`Catalogue mock ${running.urls.catalogue}`);
console.log(`Pricing mock   ${running.urls.pricing}  (${mocks.pricing.rateLimitPerSecond} req/s)`);

const shutdown = async () => {
  await running.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
