import { describe, expect, it } from "vitest";
import { InMemoryTokenBucket } from "../../src/core/resilience/rateLimiter";

describe("InMemoryTokenBucket", () => {
  it("allows a burst up to the rate, then refuses with a wait time", async () => {
    let now = 0;
    const bucket = new InMemoryTokenBucket({ ratePerSecond: 5 }, () => now);

    for (let i = 0; i < 5; i++) expect((await bucket.tryAcquire()).allowed).toBe(true);

    await expect(bucket.tryAcquire()).resolves.toEqual({ allowed: false, retryAfterMs: 200 });
  });

  it("refills over time", async () => {
    let now = 0;
    const bucket = new InMemoryTokenBucket({ ratePerSecond: 5 }, () => now);
    for (let i = 0; i < 5; i++) await bucket.tryAcquire();

    now = 200;

    await expect(bucket.tryAcquire()).resolves.toEqual({ allowed: true, retryAfterMs: 0 });
    expect((await bucket.tryAcquire()).allowed).toBe(false);
  });

  it("never exceeds capacity", async () => {
    let now = 0;
    const bucket = new InMemoryTokenBucket({ ratePerSecond: 2 }, () => now);
    now = 60_000;

    expect((await bucket.tryAcquire()).allowed).toBe(true);
    expect((await bucket.tryAcquire()).allowed).toBe(true);
    expect((await bucket.tryAcquire()).allowed).toBe(false);
  });
});
