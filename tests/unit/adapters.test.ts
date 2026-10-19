import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { CatalogueAdapter } from "../../src/adapters/catalogue/adapter";
import type { CatalogueVariant } from "../../src/adapters/catalogue/schema";
import { PricingAdapter } from "../../src/adapters/pricing/adapter";
import type { PriceQuote } from "../../src/adapters/pricing/schema";
import { SizingAdapter } from "../../src/adapters/sizing/adapter";
import type { SizingResult } from "../../src/adapters/sizing/schema";
import { MemoryCacheStore, TtlCache } from "../../src/core/resilience/cache";

const logger = pino({ level: "silent" });
const retry = { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 };
const options = { timeoutMs: 200 };

function cacheFor<T>(namespace: string, store = new MemoryCacheStore()) {
  return new TtlCache<T>(store, { namespace, ttlSeconds: 60, retentionSeconds: 3600 });
}

const variant: CatalogueVariant = {
  code: "ACS-R6-400",
  model: "ACS Drive",
  description: "Drive, frame R6",
  frame: "R6",
  ratedKw: 60,
  voltage: 400,
  ipRating: "IP21",
  options: ["EMC filter"],
  dimensionsMm: { w: 252, h: 571, d: 330 },
  model3d: { lod0: "a.glb", lod1: "b.glb", lod2: "c.glb" },
};

const quote = (validUntil: string): PriceQuote => ({
  variantCode: "ACS-R6-400",
  country: "IN",
  currency: "INR",
  price: 570400,
  leadTimeDays: 21,
  validUntil,
});

describe("SizingAdapter", () => {
  it("returns a validated sizing result", async () => {
    const client = { size: vi.fn(async () => ({ variantCode: "ACS-R7-400", loadPct: 88, frame: "R7" })) };
    const adapter = new SizingAdapter({ client, cache: cacheFor<SizingResult>("size"), retry, logger });

    const result = await adapter.fetch({ motorKw: 75, voltage: 400 }, options);

    expect(result).toMatchObject({ status: "ok", data: { variantCode: "ACS-R7-400", loadPct: 88 } });
  });

  it("caches by input hash regardless of key order", async () => {
    const client = { size: vi.fn(async () => ({ variantCode: "ACS-R7-400", loadPct: 88 })) };
    const adapter = new SizingAdapter({ client, cache: cacheFor<SizingResult>("size"), retry, logger });

    await adapter.fetch({ motorKw: 75, voltage: 400 }, options);
    await adapter.fetch({ voltage: 400, motorKw: 75 }, options);
    await adapter.fetch({ motorKw: 50, voltage: 400 }, options);

    expect(client.size).toHaveBeenCalledTimes(2);
  });

  it("rejects a vendor response with a changed shape", async () => {
    const client = { size: vi.fn(async () => ({ recommendedVariant: "ACS-R7-400" })) };
    const adapter = new SizingAdapter({ client, cache: cacheFor<SizingResult>("size"), retry, logger });

    const result = await adapter.fetch({ motorKw: 75, voltage: 400 }, options);

    expect(result).toEqual({ status: "unavailable", data: null, reason: "invalid_response" });
  });
});

describe("CatalogueAdapter", () => {
  it("returns a validated variant and caches it by code", async () => {
    const store = new MemoryCacheStore();
    const client = { getVariant: vi.fn(async () => variant) };
    const adapter = new CatalogueAdapter({ client, cache: cacheFor<CatalogueVariant>("cat", store), retry, logger });

    const first = await adapter.fetch({ variantCode: "ACS-R6-400" }, options);
    await adapter.fetch({ variantCode: "ACS-R6-400" }, options);

    expect(first).toMatchObject({ status: "ok", data: variant });
    expect(client.getVariant).toHaveBeenCalledTimes(1);
    await expect(store.get("cat:ACS-R6-400")).resolves.not.toBeNull();
  });
});

describe("PricingAdapter", () => {
  const future = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  it("returns a quote and caches it per variant, country and group", async () => {
    const store = new MemoryCacheStore();
    const client = { getPrice: vi.fn(async () => quote(future())) };
    const adapter = new PricingAdapter({ client, cache: cacheFor<PriceQuote>("price", store), retry, logger });

    const result = await adapter.fetch({ variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" }, options);
    await adapter.fetch({ variantCode: "ACS-R6-400", country: "IN", customerGroup: "DISTRIBUTOR" }, options);

    expect(result).toMatchObject({ status: "ok", data: { price: 570400, currency: "INR" } });
    expect(client.getPrice).toHaveBeenCalledTimes(2);
    await expect(store.get("price:ACS-R6-400:IN:OEM")).resolves.not.toBeNull();
  });

  it("never serves a quote past validUntil", async () => {
    const client = { getPrice: vi.fn(async () => quote(new Date(Date.now() - 1000).toISOString())) };
    const adapter = new PricingAdapter({ client, cache: cacheFor<PriceQuote>("price"), retry, logger });

    const result = await adapter.fetch({ variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" }, options);

    expect(result).toEqual({ status: "unavailable", data: null, reason: "invalid_response" });
  });

  it("drops a cached quote once it expires", async () => {
    let now = Date.now();
    const store = new MemoryCacheStore(() => now);
    const cache = new TtlCache<PriceQuote>(store, { namespace: "price", ttlSeconds: 60, retentionSeconds: 7200, now: () => now });
    const validUntil = new Date(now + 120_000).toISOString();
    const client = { getPrice: vi.fn(async () => quote(validUntil)) };
    const adapter = new PricingAdapter({ client, cache, retry, logger, now: () => now });
    await adapter.fetch({ variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" }, options);

    now += 121_000;
    client.getPrice.mockRejectedValueOnce(new Error("ERP down"));
    const result = await adapter.fetch({ variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" }, options);

    expect(result.status).toBe("unavailable");
  });
});
