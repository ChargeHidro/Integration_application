import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env";
import { MemoryCacheStore } from "../../src/core/resilience/cache";
import { createMemoryRepositories } from "../../src/repositories/memory/memoryRepositories";
import type { Repositories } from "../../src/repositories/types";
import { createSources, priceCacheKey, sizingCacheKey, sizingKey } from "../../src/sources/createSources";
import { fakeAdapters, ok, priceQuote, type FakeAdapters } from "../support/fakes";

const logger = pino({ level: "silent" });
const options = { timeoutMs: 500 };
const day = 24 * 3600 * 1000;

describe("createSources", () => {
  let now: number;
  let adapters: FakeAdapters;
  let repositories: Repositories;
  let cacheStore: MemoryCacheStore;

  const build = (env: Record<string, string> = {}) =>
    createSources(loadConfig({ JWT_SECRET: "s".repeat(32), ...env }), {
      cacheStore,
      repositories,
      adapters,
      logger,
      now: () => now,
    });

  beforeEach(() => {
    now = Date.parse("2026-10-20T00:00:00.000Z");
    adapters = fakeAdapters();
    repositories = createMemoryRepositories();
    cacheStore = new MemoryCacheStore(() => now);
  });

  it("keeps a sizing result fresh for 7 days", async () => {
    const sources = build();
    const input = { motorKw: 75, voltage: 400 };
    await sources.sizing.fetch(input, options);

    now += 6 * day;
    await sources.sizing.fetch(input, options);
    expect(adapters.sizing.fetch).toHaveBeenCalledTimes(1);

    now += 2 * day;
    await sources.sizing.fetch(input, options);
    expect(adapters.sizing.fetch).toHaveBeenCalledTimes(2);
  });

  it("keys sizing by input hash and API version, regardless of key order", async () => {
    const v1 = build();
    await v1.sizing.fetch({ motorKw: 75, voltage: 400 }, options);
    await v1.sizing.fetch({ voltage: 400, motorKw: 75 }, options);
    expect(adapters.sizing.fetch).toHaveBeenCalledTimes(1);

    const v2 = build({ SIZING_API_VERSION: "v2" });
    await v2.sizing.fetch({ motorKw: 75, voltage: 400 }, options);
    expect(adapters.sizing.fetch).toHaveBeenCalledTimes(2);
    expect(sizingCacheKey({ motorKw: 75, voltage: 400 }, "v1")).not.toBe(sizingCacheKey({ motorKw: 75, voltage: 400 }, "v2"));
    expect(await repositories.sizingResults.get(sizingKey({ motorKw: 75, voltage: 400 }, "v2"))).not.toBeNull();
  });

  it("stores prices under variant, country and customer group", async () => {
    const sources = build();
    const oem = { variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" };
    await sources.pricing.fetch(oem, options);
    await sources.pricing.fetch({ ...oem, customerGroup: "DISTRIBUTOR" }, options);

    expect(adapters.pricing.fetch).toHaveBeenCalledTimes(2);
    expect(priceCacheKey(oem)).toBe("ACS-R6-400:IN:OEM");
    await expect(cacheStore.get("price:ACS-R6-400:IN:OEM")).resolves.not.toBeNull();
    expect(await repositories.priceSnapshots.get(oem)).toMatchObject({ value: { variantCode: "ACS-R6-400" } });
  });

  it("serves a price while its quote is valid and never after", async () => {
    const sources = build();
    const query = { variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" };
    adapters.pricing.fetch.mockResolvedValueOnce(
      ok({ ...priceQuote(query), validUntil: new Date(now + 2 * 3600 * 1000).toISOString() }),
    );
    await sources.pricing.fetch(query, options);

    now += 3600 * 1000;
    await expect(sources.pricing.fetch(query, options)).resolves.toMatchObject({ status: "ok" });
    expect(adapters.pricing.fetch).toHaveBeenCalledTimes(1);

    now += 2 * 3600 * 1000;
    adapters.pricing.fetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "upstream_error" });
    await expect(sources.pricing.fetch(query, options)).resolves.toEqual({
      status: "unavailable",
      data: null,
      reason: "upstream_error",
    });
  });

  it("reads the catalogue from PostgreSQL when Redis is empty", async () => {
    const sources = build();
    await sources.catalogue.fetch({ variantCode: "ACS-R7-400" }, options);
    const emptyRedis = new MemoryCacheStore(() => now);
    const fresh = createSources(loadConfig({ JWT_SECRET: "s".repeat(32) }), {
      cacheStore: emptyRedis,
      repositories,
      adapters,
      logger,
      now: () => now,
    });

    const result = await fresh.catalogue.fetch({ variantCode: "ACS-R7-400" }, options);

    expect(result).toMatchObject({ status: "ok", data: { code: "ACS-R7-400" } });
    expect(adapters.catalogue.fetch).toHaveBeenCalledTimes(1);
    await expect(emptyRedis.get("cat:ACS-R7-400")).resolves.not.toBeNull();
  });
});
