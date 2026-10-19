import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisTokenBucket } from "../../src/core/resilience/rateLimiter";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:56379", {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
});
const redisAvailable = await redis.connect().then(
  () => true,
  () => false,
);

describe.runIf(redisAvailable)("RedisTokenBucket (needs docker compose redis)", () => {
  afterAll(async () => {
    await redis.quit();
  });

  it("allows the rate, then refuses with a wait time", async () => {
    const bucket = new RedisTokenBucket(redis, `test:ratelimit:${randomUUID()}`, { ratePerSecond: 5 });

    const decisions = await Promise.all(Array.from({ length: 7 }, () => bucket.tryAcquire()));

    expect(decisions.filter((d) => d.allowed)).toHaveLength(5);
    const refused = decisions.filter((d) => !d.allowed);
    expect(refused).toHaveLength(2);
    for (const decision of refused) expect(decision.retryAfterMs).toBeGreaterThan(0);
  });

  it("shares one budget between instances with the same key", async () => {
    const key = `test:ratelimit:${randomUUID()}`;
    const first = new RedisTokenBucket(redis, key, { ratePerSecond: 2 });
    const second = new RedisTokenBucket(redis, key, { ratePerSecond: 2 });

    const decisions = [await first.tryAcquire(), await second.tryAcquire(), await first.tryAcquire()];

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, false]);
  });

  it("refills after waiting", async () => {
    const bucket = new RedisTokenBucket(redis, `test:ratelimit:${randomUUID()}`, { ratePerSecond: 10 });
    for (let i = 0; i < 10; i++) await bucket.tryAcquire();

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect((await bucket.tryAcquire()).allowed).toBe(true);
  });
});
