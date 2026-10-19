import { beforeEach, describe, expect, it } from "vitest";
import { MemoryCacheStore, stableHash, TtlCache, type CacheStore } from "../../src/core/resilience/cache";

describe("TtlCache", () => {
  let now: number;
  let store: MemoryCacheStore;
  let cache: TtlCache<{ price: number }>;

  beforeEach(() => {
    now = Date.UTC(2026, 0, 1);
    store = new MemoryCacheStore(() => now);
    cache = new TtlCache(store, { namespace: "price", ttlSeconds: 600, retentionSeconds: 3600, now: () => now });
  });

  it("returns null on a miss", async () => {
    await expect(cache.get("ACS-R6-400:IN:OEM")).resolves.toBeNull();
  });

  it("returns a fresh entry within the TTL", async () => {
    await cache.set("k", { price: 10 });
    now += 599_000;

    await expect(cache.get("k")).resolves.toEqual({
      value: { price: 10 },
      fetchedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      fresh: true,
    });
  });

  it("keeps an entry past its TTL as stale until retention ends", async () => {
    await cache.set("k", { price: 10 });
    now += 600_000;

    expect((await cache.get("k"))?.fresh).toBe(false);
    now += 3_000_000;
    await expect(cache.get("k")).resolves.toBeNull();
  });

  it("never serves an entry past notAfter", async () => {
    await cache.set("k", { price: 10 }, { notAfter: new Date(now + 120_000) });
    now += 120_000;

    await expect(cache.get("k")).resolves.toBeNull();
  });

  it("does not store an entry that is already past notAfter", async () => {
    await cache.set("k", { price: 10 }, { notAfter: new Date(now - 1) });

    await expect(store.get("price:k")).resolves.toBeNull();
  });

  it("namespaces keys", async () => {
    await cache.set("k", { price: 10 });

    await expect(store.get("price:k")).resolves.not.toBeNull();
  });

  it("treats a failing store as a miss and reports the error", async () => {
    const errors: unknown[] = [];
    const broken: CacheStore = {
      get: () => Promise.reject(new Error("redis down")),
      set: () => Promise.reject(new Error("redis down")),
    };
    const brokenCache = new TtlCache(broken, {
      namespace: "x",
      ttlSeconds: 1,
      retentionSeconds: 2,
      onError: (error) => errors.push(error),
    });

    await expect(brokenCache.set("k", 1)).resolves.toBeUndefined();
    await expect(brokenCache.get("k")).resolves.toBeNull();
    expect(errors).toHaveLength(2);
  });

  it("treats a corrupt entry as a miss", async () => {
    await store.set("price:k", "{not json", 60);

    await expect(cache.get("k")).resolves.toBeNull();
  });
});

describe("stableHash", () => {
  it("ignores key order", () => {
    expect(stableHash({ motorKw: 45, voltage: 400 })).toBe(stableHash({ voltage: 400, motorKw: 45 }));
  });

  it("changes when a value changes", () => {
    expect(stableHash({ motorKw: 45 })).not.toBe(stableHash({ motorKw: 46 }));
  });

  it("ignores undefined fields", () => {
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
  });
});
