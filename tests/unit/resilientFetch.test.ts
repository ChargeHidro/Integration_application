import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { resilientFetch, type ResilienceDeps } from "../../src/adapters/resilientFetch";
import { SchemaError, UpstreamError } from "../../src/core/errors/errors";
import { CircuitBreaker } from "../../src/core/resilience/circuitBreaker";
import { InMemoryTokenBucket } from "../../src/core/resilience/rateLimiter";

const logger = pino({ level: "silent" });
const deps: ResilienceDeps = { system: "test", logger, retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 } };

describe("resilientFetch", () => {
  it("calls the system and returns ok with a fetch time", async () => {
    const call = vi.fn(async () => "fresh");

    const result = await resilientFetch(deps, { timeoutMs: 100, call });

    expect(result).toMatchObject({ status: "ok", data: "fresh" });
    expect(Number.isNaN(Date.parse(result.status === "ok" ? result.fetchedAt : ""))).toBe(false);
  });

  it("returns unavailable when the system fails", async () => {
    const result = await resilientFetch(deps, {
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

    const result = await resilientFetch(deps, { timeoutMs: 500, call });

    expect(result.status).toBe("ok");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 404", async () => {
    const call = vi.fn(() => Promise.reject(new UpstreamError("test", 404, "missing")));

    const result = await resilientFetch(deps, { timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "not_found" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("returns within the time budget when the system hangs", async () => {
    const started = Date.now();

    const result = await resilientFetch(deps, {
      timeoutMs: 50,
      call: (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("does not call again after the budget has passed", async () => {
    const call = vi.fn(() => Promise.reject(new UpstreamError("test", 503, "down")));

    await resilientFetch({ ...deps, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 1000 } }, { timeoutMs: 30, call });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not call the system while the circuit is open", async () => {
    const breaker = new CircuitBreaker({ name: "test", failureRate: 0.5, minRequests: 1, windowMs: 1000, cooldownMs: 60_000 });
    const failing = () => Promise.reject(new UpstreamError("test", 503, "down"));
    await resilientFetch({ ...deps, breaker, retry: { ...deps.retry, maxRetries: 0 } }, { timeoutMs: 100, call: failing });
    const call = vi.fn(async () => "fresh");

    const result = await resilientFetch({ ...deps, breaker }, { timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "circuit_open" });
    expect(call).not.toHaveBeenCalled();
  });

  it("does not call the system when the rate limit is exhausted", async () => {
    const rateLimiter = new InMemoryTokenBucket({ ratePerSecond: 1 }, () => 0);
    await rateLimiter.tryAcquire();
    const call = vi.fn(async () => "fresh");

    const result = await resilientFetch({ ...deps, rateLimiter }, { timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "rate_limited" });
    expect(call).not.toHaveBeenCalled();
  });

  it("treats a schema failure as unavailable without retrying and logs it loudly", async () => {
    const error = vi.spyOn(logger, "error");
    const call = vi.fn(() => Promise.reject(new SchemaError("test", ["price: Required"])));

    const result = await resilientFetch(deps, { timeoutMs: 100, call });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "invalid_response" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });
});
