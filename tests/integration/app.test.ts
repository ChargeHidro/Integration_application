import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { pino } from "pino";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAdapters } from "../../src/adapters/createAdapters";
import { createApp } from "../../src/app";
import { loadConfig, type Config } from "../../src/config/env";
import type { Caller } from "../../src/core/auth/caller";
import { signToken } from "../../src/core/auth/tokens";
import { startMocks, type Mocks } from "../../src/mocks/mockServers";
import { createMemoryRepositories } from "../../src/repositories/memory/memoryRepositories";
import { channelPartner, salesEngineer } from "../support/fakes";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:56379";
const probe = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false });
const redisAvailable = await probe.connect().then(
  () => true,
  () => false,
);
await probe.quit().catch(() => {});

describe.runIf(redisAvailable)("Integration API end to end (mocks + redis)", () => {
  let mocks: Mocks;
  let redis: Redis;
  let config: Config;
  let app: ReturnType<typeof createApp>;

  const bearer = async (caller: Caller) => `Bearer ${await signToken(caller, config.auth)}`;

  beforeAll(async () => {
    mocks = await startMocks({ sizing: { minDelayMs: 0, maxDelayMs: 0, failRate: 0 }, pricing: { perSecond: 50 } });
  });

  beforeEach(() => {
    mocks.sizing.minDelayMs = 0;
    mocks.sizing.maxDelayMs = 0;
    mocks.sizing.failRate = 0;
    redis = new Redis(redisUrl, { keyPrefix: `test:${randomUUID()}:`, maxRetriesPerRequest: 1 });
    config = loadConfig({
      JWT_SECRET: "e".repeat(32),
      REPOSITORY: "memory",
      SIZING_URL: mocks.urls.sizing,
      CATALOGUE_URL: mocks.urls.catalogue,
      PRICING_URL: mocks.urls.pricing,
      RETRY_BASE_DELAY_MS: "10",
      RETRY_MAX_DELAY_MS: "20",
      BREAKER_MIN_REQUESTS: "3",
      BREAKER_COOLDOWN_MS: "60000",
    });
    const logger = pino({ level: "silent" });
    app = createApp({
      config,
      logger,
      repositories: createMemoryRepositories(),
      adapters: createAdapters(config, { redis, logger }),
    });
  });

  afterAll(async () => {
    await redis?.quit();
    await mocks.close();
  });

  it("serves a full sidebar to a sales engineer", async () => {
    const response = await request(app).get("/items/DRV-03/sidebar").set("Authorization", await bearer(salesEngineer));

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.body.sections.catalogue).toMatchObject({ status: "ok", data: { code: "ACS-R6-400" } });
    expect(response.body.sections.sizing).toMatchObject({ status: "ok", data: { variantCode: "ACS-R6-400" } });
    expect(response.body.sections.pricing).toMatchObject({ status: "ok", data: { currency: "INR" } });
  });

  it("returns within 1 s with partial results when sizing is slow", async () => {
    mocks.sizing.minDelayMs = 3000;
    mocks.sizing.maxDelayMs = 3000;
    const started = Date.now();

    const response = await request(app).get("/items/DRV-03/sidebar").set("Authorization", await bearer(salesEngineer));

    expect(Date.now() - started).toBeLessThan(1000);
    expect(response.body.sections.catalogue.status).toBe("ok");
    expect(response.body.sections.sizing).toEqual({ status: "unavailable", data: null, reason: "timeout" });
  });

  it("serves cached sizing as stale when sizing fails later", async () => {
    const auth = await bearer(salesEngineer);
    await request(app).get("/items/DRV-03/sidebar").set("Authorization", auth);
    const [key] = await redis.keys(`${redis.options.keyPrefix}size:*`);
    const stored = JSON.parse((await redis.get(key!.slice(redis.options.keyPrefix!.length)))!);
    await redis.set(
      key!.slice(redis.options.keyPrefix!.length),
      JSON.stringify({ ...stored, fetchedAt: stored.fetchedAt - 16 * 60 * 1000 }),
    );
    mocks.sizing.failRate = 1;

    const response = await request(app).get("/items/DRV-03/sidebar").set("Authorization", auth);

    expect(response.body.sections.sizing).toMatchObject({ status: "stale", data: { variantCode: "ACS-R6-400" } });
  });

  it("opens the sizing circuit after repeated failures and stops calling the mock", async () => {
    mocks.sizing.failRate = 1;
    const auth = await bearer(salesEngineer);
    for (const motorKw of [10, 11]) {
      await request(app).post("/items/DRV-03/resize").set("Authorization", auth).send({ motorKw, voltage: 400 });
    }
    const callsWhenOpen = mocks.sizing.requests;

    const response = await request(app).post("/items/DRV-03/resize").set("Authorization", auth).send({ motorKw: 12, voltage: 400 });

    expect(response.status).toBe(503);
    expect(mocks.sizing.requests).toBe(callsWhenOpen);
  });

  it("re-sizes an item end to end", async () => {
    const response = await request(app)
      .post("/items/DRV-03/resize")
      .set("Authorization", await bearer(salesEngineer))
      .send({ motorKw: 70, voltage: 400 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      itemId: "DRV-03",
      changed: true,
      previous: { variantCode: "ACS-R6-400", modelRef: "models/acs-r6" },
      current: { variantCode: "ACS-R7-400", modelRef: "models/acs-r7" },
      bomChange: { removed: { variantCode: "ACS-R6-400" }, added: { variantCode: "ACS-R7-400" } },
    });
  });

  it("returns a priced BOM to a sales engineer and no price fields to a channel partner", async () => {
    const engineer = await request(app).get("/projects/PRJ-1/bom").set("Authorization", await bearer(salesEngineer));
    const partner = await request(app).get("/projects/PRJ-1/bom").set("Authorization", await bearer(channelPartner));

    expect(engineer.body.pricing).toBe("ok");
    expect(engineer.body.totals[0].currency).toBe("INR");
    expect(partner.body.pricing).toBe("not_permitted");
    expect(partner.text).not.toMatch(/price|total|currency|leadTime|validUntil/i);
  });

  it("rejects requests without a valid token", async () => {
    const missing = await request(app).get("/items/DRV-03/sidebar");
    const forged = await request(app)
      .get("/items/DRV-03/sidebar")
      .set("Authorization", `Bearer ${await signToken(salesEngineer, { ...config.auth, secret: "x".repeat(32) })}`);

    expect(missing.status).toBe(401);
    expect(forged.status).toBe(401);
  });
});
