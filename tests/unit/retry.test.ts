import { describe, expect, it, vi } from "vitest";
import { TimeoutError, UpstreamError } from "../../src/core/errors/errors";
import { backoffDelay, retry, type RetryOptions } from "../../src/core/resilience/retry";

function options(overrides: Partial<RetryOptions> = {}): RetryOptions & { sleep: ReturnType<typeof vi.fn> } {
  const sleep = vi.fn(async () => {});
  return { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000, random: () => 1, now: () => 0, sleep, ...overrides } as RetryOptions & {
    sleep: ReturnType<typeof vi.fn>;
  };
}

function failingTimes(times: number, error: Error) {
  let calls = 0;
  return vi.fn(async () => {
    calls++;
    if (calls <= times) throw error;
    return "ok";
  });
}

describe("retry", () => {
  it("retries transient failures with exponential backoff", async () => {
    const opts = options();
    const work = failingTimes(2, new UpstreamError("sizing", 503, "down"));

    await expect(retry(work, opts)).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(3);
    expect(opts.sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("gives up after maxRetries", async () => {
    const work = failingTimes(5, new TimeoutError("sizing", 800));

    await expect(retry(work, options())).rejects.toBeInstanceOf(TimeoutError);
    expect(work).toHaveBeenCalledTimes(3);
  });

  it("never retries 4xx validation errors", async () => {
    const work = failingTimes(1, new UpstreamError("sizing", 400, "bad input"));

    await expect(retry(work, options())).rejects.toThrow("bad input");
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and respects Retry-After", async () => {
    const opts = options();
    const work = failingTimes(1, new UpstreamError("pricing", 429, "slow down", 1000));

    await expect(retry(work, opts)).resolves.toBe("ok");
    expect(opts.sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry when the delay would pass the deadline", async () => {
    const opts = options({ deadline: 150, now: () => 100 });
    const work = failingTimes(1, new UpstreamError("pricing", 503, "down"));

    await expect(retry(work, opts)).rejects.toThrow("down");
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it("applies jitter and caps the delay", () => {
    expect(backoffDelay(0, 100, 1000, () => 0.5)).toBe(50);
    expect(backoffDelay(10, 100, 1000, () => 1)).toBe(1000);
  });
});
