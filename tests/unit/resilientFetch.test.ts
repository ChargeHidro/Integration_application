import { pino } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resilientFetch, type ResilienceDeps } from "../../src/adapters/resilientFetch";
import { SchemaError, UpstreamError } from "../../src/core/errors/errors";
import { MemoryCacheStore, TtlCache } from "../../src/core/resilience/cache";
import { CircuitBreaker } from "../../src/core/resilience/circuitBreaker";
import { InMemoryTokenBucket } from "../../src/core/resilience/rateLimiter";

const logger = pino({ level: "silent" });

describe("resilientFetch", () => {
  let now: number;
  let cache: TtlCache<string>;
  let deps: ResilienceDeps<string>;

  beforeEach(() => {
    now = Date.now();
    cache = new TtlCache(new MemoryCacheStore(() => now), {
      namespace: "test",
      ttlSeconds: 60,
      retentionSeconds: 3600,
      now: () => now,
    });
    deps = { system: "test", cache, logger, retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 } };
  });

  it("calls the system on a miss, caches and returns ok", async () => {
    const call = vi.fn(async () => "fresh");

    const result = await resilientFetch(deps, { cacheKey: "k", timeoutMs: 100, call });

    expect(result).toMatchObject({ status: "ok", data: "fresh" });
    expect((await cache.get("k"))?.value).toBe("fresh");
  });

  it("serves a fresh cache hit without calling the system", async () => {
    await cache.set("k", "cached");
    const call = vi.fn(async () => "fresh");

    const result = await resilientFetch(deps, { cacheKey: "k", timeoutMs: 100, call });

    expect(result).toMatchObject({ status: "ok", data: "cached" });
    expect(call).not.toHaveBeenCalled();
  });

  it("refreshes an expired entry", async () => {
    await cache.set("k", "old");
    now += 61_000;

    const result = await resilientFetch(deps, { cacheKey: "k", timeoutMs: 100, call: async () => "new" });

    expect(result).toMatchObject({ status: "ok", data: "new" });
  });

  it("serves stale data when the system fails", async () => {
    await cache.set("k", "old");
    now += 61_000;

    const result = await resilientFetch(deps, {
      cacheKey: "k",
      timeoutMs: 100,
      call: () => Promise.reject(new UpstreamError("test", 503, "down")),
    });

    expect(result).toMatchObject({ status: "stale", data: "old", reason: "upstream_error" });
  });

  it("returns unavailable when the system fails and nothing is cached", async () => {
    const result = await resilientFetch(deps, {
      cacheKey: "k",
      timeoutMs: 100,
      call: () => Promise.reject(new UpstreamError("test", 503, "down")),
    });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "upstream_error" });
  });

  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const call = vi.fn(async () => {
      if (++calls < 3) throw new UpstreamError("test", 503, "down");
      return "ok";
    });

    const result = await resilientFetch(deps, { cacheKey: "k", timeoutMs: 500, call });

    expect(result.status).toBe("ok");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404", async () => {
    const call = vi.fn(() => Promise.reject(new UpstreamError("test", 404, "missing")));

    const result = await resilientFetch(deps, { cacheKey: "k", timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "not_found" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns within the time budget when the system hangs", async () => {
    const started = Date.now();

    const result = await resilientFetch(deps, {
      cacheKey: "k",
      timeoutMs: 50,
      call: (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("does not call again after the budget has passed", async () => {
    const call = vi.fn(() => Promise.reject(new UpstreamError("test", 503, "down")));

    await resilientFetch(
      { ...deps, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 1000 } },
      { cacheKey: "k", timeoutMs: 30, call },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not call the system while the circuit is open", async () => {
    const breaker = new CircuitBreaker({ name: "test", failureRate: 0.5, minRequests: 1, windowMs: 1000, cooldownMs: 60_000 });
    const failing = () => Promise.reject(new UpstreamError("test", 503, "down"));
    await resilientFetch({ ...deps, breaker, retry: { ...deps.retry, maxRetries: 0 } }, { cacheKey: "a", timeoutMs: 100, call: failing });
    const call = vi.fn(async () => "fresh");

    const result = await resilientFetch({ ...deps, breaker }, { cacheKey: "b", timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "circuit_open" });
    expect(call).not.toHaveBeenCalled();
  });

  it("does not call the system when the rate limit is exhausted", async () => {
    const rateLimiter = new InMemoryTokenBucket({ ratePerSecond: 1 }, () => 0);
    await rateLimiter.tryAcquire();
    const call = vi.fn(async () => "fresh");

    const result = await resilientFetch({ ...deps, rateLimiter }, { cacheKey: "k", timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "rate_limited" });
    expect(call).not.toHaveBeenCalled();
  });

  it("treats a schema failure as unavailable without retrying", async () => {
    await cache.set("k", "old");
    now += 61_000;
    const error = vi.spyOn(logger, "error");
    const call = vi.fn(() => Promise.reject(new SchemaError("test", ["price: Required"])));

    const result = await resilientFetch(deps, { cacheKey: "k", timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "invalid_response" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });
});
