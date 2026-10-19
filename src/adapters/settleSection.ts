import { TimeoutError } from "../core/errors/errors";
import { withTimeout } from "../core/resilience/withTimeout";
import type { SectionResult } from "./types";

export async function settleSection<T>(
  load: () => Promise<SectionResult<T>>,
  timeoutMs: number,
): Promise<SectionResult<T>> {
  try {
    return await withTimeout(() => load(), Math.max(0, timeoutMs), "section");
  } catch (error) {
    return { status: "unavailable", data: null, reason: error instanceof TimeoutError ? "timeout" : "internal_error" };
  }
}
