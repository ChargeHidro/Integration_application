import { describe, expect, it } from "vitest";
import { TimeoutError } from "../../src/core/errors/errors";
import { withTimeout } from "../../src/core/resilience/withTimeout";

describe("withTimeout", () => {
  it("returns the result when work finishes in time", async () => {
    await expect(withTimeout(async () => "done", 50)).resolves.toBe("done");
  });

  it("rejects with TimeoutError and aborts the signal when work is too slow", async () => {
    let signal: AbortSignal | undefined;

    const result = withTimeout(
      (s) => {
        signal = s;
        return new Promise((resolve) => setTimeout(resolve, 200));
      },
      20,
      "sizing",
    );

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    await expect(result).rejects.toThrow("sizing timed out after 20 ms");
    expect(signal?.aborted).toBe(true);
  });

  it("passes through errors from the work", async () => {
    await expect(withTimeout(async () => Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
  });
});
