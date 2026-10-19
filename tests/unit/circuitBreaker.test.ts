import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitOpenError, UpstreamError } from "../../src/core/errors/errors";
import { CircuitBreaker } from "../../src/core/resilience/circuitBreaker";

const fail = () => Promise.reject(new UpstreamError("sizing", 503, "down"));
const succeed = () => Promise.resolve("ok");

describe("CircuitBreaker", () => {
  let now: number;
  let breaker: CircuitBreaker;

  beforeEach(() => {
    now = 0;
    breaker = new CircuitBreaker({
      name: "sizing",
      failureRate: 0.5,
      minRequests: 4,
      windowMs: 10_000,
      cooldownMs: 5_000,
      now: () => now,
    });
  });

  async function failTimes(times: number) {
    for (let i = 0; i < times; i++) await breaker.execute(fail).catch(() => {});
  }

  it("stays closed below the minimum number of requests", async () => {
    await failTimes(3);

    expect(breaker.state).toBe("closed");
  });

  it("opens after repeated failures and stops calling the system", async () => {
    await failTimes(4);
    const work = vi.fn(succeed);

    await expect(breaker.execute(work)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(breaker.state).toBe("open");
    expect(work).not.toHaveBeenCalled();
  });

  it("ignores failures outside the rolling window", async () => {
    await failTimes(3);
    now = 11_000;
    await breaker.execute(succeed);
    await failTimes(1);

    expect(breaker.state).toBe("closed");
  });

  it("does not count non-transient errors as failures", async () => {
    for (let i = 0; i < 5; i++) {
      await breaker.execute(() => Promise.reject(new UpstreamError("sizing", 400, "bad"))).catch(() => {});
    }

    expect(breaker.state).toBe("closed");
  });

  it("half-opens after the cool-down and closes after a successful probe", async () => {
    await failTimes(4);
    now = 5_000;

    expect(breaker.state).toBe("half_open");
    await expect(breaker.execute(succeed)).resolves.toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  it("re-opens when the probe fails", async () => {
    await failTimes(4);
    now = 5_000;
    await breaker.execute(fail).catch(() => {});

    expect(breaker.state).toBe("open");
    now = 9_000;
    expect(breaker.state).toBe("open");
  });

  it("allows only one probe at a time", async () => {
    await failTimes(4);
    now = 5_000;
    let release: (value: string) => void = () => {};
    const probe = breaker.execute(() => new Promise<string>((resolve) => (release = resolve)));

    await expect(breaker.execute(succeed)).rejects.toBeInstanceOf(CircuitOpenError);
    release("ok");
    await expect(probe).resolves.toBe("ok");
  });

  it("reports state changes", async () => {
    const changes: string[] = [];
    breaker = new CircuitBreaker({
      name: "sizing",
      failureRate: 0.5,
      minRequests: 2,
      windowMs: 10_000,
      cooldownMs: 5_000,
      now: () => now,
      onStateChange: (from, to) => changes.push(`${from}->${to}`),
    });

    await failTimes(2);
    now = 5_000;
    await breaker.execute(succeed);

    expect(changes).toEqual(["closed->open", "open->half_open", "half_open->closed"]);
  });
});
