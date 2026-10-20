import { pino } from "pino";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Adapter, FetchOptions, SectionResult } from "../../src/adapters/types";
import { MemoryCacheStore, TtlCache } from "../../src/core/resilience/cache";
import { readThrough } from "../../src/core/resilience/readThrough";
import type { SnapshotRepository, Stored } from "../../src/repositories/types";

const logger = pino({ level: "silent" });
const minute = 60_000;

interface Quote {
  amount: number;
  validUntil: string;
}

type Fetch = (query: string, options: FetchOptions) => Promise<SectionResult<Quote>>;

class SpyStore implements SnapshotRepository<string, Quote> {
  readonly rows = new Map<string, Stored<Quote>>();
  readonly get = vi.fn(async (key: string) => this.rows.get(key) ?? null);
  readonly put = vi.fn(async (key: string, value: Quote, fetchedAt: string) => {
    this.rows.set(key, { value, fetchedAt });
  });
}

describe("readThrough: Redis → PostgreSQL → adapter", () => {
  let now: number;
  let cacheStore: MemoryCacheStore;
  let cache: TtlCache<Quote>;
  let store: SpyStore;
  let upstreamFetch: Mock<Fetch>;
  let source: Adapter<string, Quote>;

  const quote = (amount: number, validForMs = 24 * 60 * minute): Quote => ({
    amount,
    validUntil: new Date(now + validForMs).toISOString(),
  });
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const options = { timeoutMs: 500 };

  beforeEach(() => {
    now = Date.parse("2026-10-21T08:00:00.000Z");
    cacheStore = new MemoryCacheStore(() => now);
    cache = new TtlCache<Quote>(cacheStore, { namespace: "q", ttlSeconds: 600, retentionSeconds: 7 * 24 * 3600, now: () => now });
    store = new SpyStore();
    upstreamFetch = vi.fn<Fetch>(async () => ({ status: "ok", data: quote(100), fetchedAt: iso(0) }));
    source = readThrough<string, string, Quote>(
      { system: "test", fetch: upstreamFetch },
      {
        cache,
        store,
        cacheKeyOf: (query) => query,
        storeKeyOf: (query) => query,
        freshForMs: 10 * minute,
        notAfter: (value) => new Date(value.validUntil),
        logger,
        now: () => now,
      },
    );
  });

  it("1. a fresh Redis hit calls neither PostgreSQL nor the adapter", async () => {
    await cache.set("k", quote(50));

    const result = await source.fetch("k", options);

    expect(result).toMatchObject({ status: "ok", data: { amount: 50 } });
    expect(store.get).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("2. a Redis miss with a fresh PostgreSQL row skips the adapter and refills Redis with the original fetch time", async () => {
    store.rows.set("k", { value: quote(60), fetchedAt: iso(-2 * minute) });

    const result = await source.fetch("k", options);

    expect(result).toEqual({ status: "ok", data: quote(60), fetchedAt: iso(-2 * minute) });
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(await cache.get("k")).toMatchObject({ value: { amount: 60 }, fetchedAt: iso(-2 * minute), fresh: true });
  });

  it("3. when both miss, it calls the adapter and writes the result to PostgreSQL and Redis", async () => {
    const result = await source.fetch("k", options);

    expect(result).toMatchObject({ status: "ok", data: { amount: 100 } });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith("k", quote(100), iso(0));
    expect((await cache.get("k"))?.value.amount).toBe(100);
  });

  it("3b. an old PostgreSQL row is refreshed from the adapter", async () => {
    store.rows.set("k", { value: quote(60), fetchedAt: iso(-11 * minute) });

    const result = await source.fetch("k", options);

    expect(result).toMatchObject({ status: "ok", data: { amount: 100 } });
    expect(store.rows.get("k")?.value.amount).toBe(100);
  });

  it("4. when the adapter fails, the newest stored value is returned as stale", async () => {
    const cachedQuote = quote(70);
    const storedQuote = quote(80);
    const storedAt = iso(30_000);
    await cache.set("k", cachedQuote);
    store.rows.set("k", { value: storedQuote, fetchedAt: storedAt });
    now += 11 * minute;
    upstreamFetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "upstream_error" });

    const result = await source.fetch("k", options);

    expect(result).toEqual({ status: "stale", data: storedQuote, fetchedAt: storedAt, reason: "upstream_error" });
  });

  it("4a. prefers the Redis value when it is newer than the PostgreSQL row", async () => {
    const cachedQuote = quote(70);
    const cachedAt = iso(0);
    store.rows.set("k", { value: quote(80), fetchedAt: iso(-1 * minute) });
    await cache.set("k", cachedQuote);
    now += 11 * minute;
    upstreamFetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "upstream_error" });

    const result = await source.fetch("k", options);

    expect(result).toEqual({ status: "stale", data: cachedQuote, fetchedAt: cachedAt, reason: "upstream_error" });
  });

  it("4b. falls back to an old PostgreSQL row when Redis has nothing", async () => {
    store.rows.set("k", { value: quote(80), fetchedAt: iso(-3 * 24 * 60 * minute) });
    upstreamFetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "circuit_open" });

    const result = await source.fetch("k", options);

    expect(result).toMatchObject({ status: "stale", data: { amount: 80 }, reason: "circuit_open" });
  });

  it("4c. returns unavailable when the adapter fails and nothing is stored", async () => {
    upstreamFetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "timeout" });

    await expect(source.fetch("k", options)).resolves.toEqual({ status: "unavailable", data: null, reason: "timeout" });
  });

  it("5. never returns an expired quote, from Redis or PostgreSQL, not even as stale", async () => {
    await cache.set("k", quote(70, 5 * minute), { notAfter: new Date(now + 5 * minute) });
    store.rows.set("k", { value: quote(80, 5 * minute), fetchedAt: iso(0) });
    now += 6 * minute;
    upstreamFetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "upstream_error" });

    const result = await source.fetch("k", options);

    expect(result).toEqual({ status: "unavailable", data: null, reason: "upstream_error" });
  });

  it("does not serve stale data after a vendor schema change", async () => {
    store.rows.set("k", { value: quote(80), fetchedAt: iso(-11 * minute) });
    upstreamFetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "invalid_response" });

    await expect(source.fetch("k", options)).resolves.toEqual({ status: "unavailable", data: null, reason: "invalid_response" });
  });

  it("keeps working when PostgreSQL fails to read or write", async () => {
    store.get.mockRejectedValueOnce(new Error("db down"));
    store.put.mockRejectedValueOnce(new Error("db down"));

    const result = await source.fetch("k", options);

    expect(result).toMatchObject({ status: "ok", data: { amount: 100 } });
    expect((await cache.get("k"))?.value.amount).toBe(100);
  });

  it("does not wait long for a PostgreSQL read that hangs", async () => {
    store.get.mockReturnValueOnce(new Promise(() => {}));
    const started = Date.now();

    const result = await source.fetch("k", options);

    expect(result.status).toBe("ok");
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("gives the adapter only the time that is left", async () => {
    store.get.mockImplementationOnce(async () => {
      now += 120;
      return null;
    });

    await source.fetch("k", options);

    expect(upstreamFetch).toHaveBeenCalledWith("k", { timeoutMs: 380 });
  });
});
