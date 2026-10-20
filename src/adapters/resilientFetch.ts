import {
  CircuitOpenError,
  RateLimitedError,
  SchemaError,
  TimeoutError,
  UpstreamError,
} from "../core/errors/errors";
import type { Logger } from "../core/logger";
import type { CircuitBreaker } from "../core/resilience/circuitBreaker";
import type { RateLimiter } from "../core/resilience/rateLimiter";
import { retry } from "../core/resilience/retry";
import { withTimeout } from "../core/resilience/withTimeout";
import type { SectionResult, UnavailableReason } from "./types";

export interface RetrySettings {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface ResilienceDeps {
  system: string;
  retry: RetrySettings;
  logger: Logger;
  rateLimiter?: RateLimiter;
  breaker?: CircuitBreaker;
}

export interface FetchRequest<T> {
  timeoutMs: number;
  call: (signal: AbortSignal) => Promise<T>;
}

export async function resilientFetch<T>(deps: ResilienceDeps, request: FetchRequest<T>): Promise<SectionResult<T>> {
  const deadline = Date.now() + request.timeoutMs;
  try {
    const data = await withTimeout(
      (signal) =>
        retry(() => attempt(deps, request, signal), {
          ...deps.retry,
          deadline,
          sleep: (ms) => abortableSleep(ms, signal),
          onRetry: (error, retryNumber, delayMs) =>
            deps.logger.warn({ system: deps.system, retryNumber, delayMs, reason: reasonOf(error) }, "retrying upstream call"),
        }),
      request.timeoutMs,
      `${deps.system} call`,
    );
    return { status: "ok", data, fetchedAt: new Date().toISOString() };
  } catch (error) {
    const reason = reasonOf(error);
    if (error instanceof SchemaError) {
      deps.logger.error({ system: deps.system, issues: error.issues }, "vendor response failed schema validation");
    } else {
      deps.logger.warn(
        { system: deps.system, reason, error: error instanceof Error ? error.message : String(error) },
        "upstream call failed",
      );
    }
    return { status: "unavailable", data: null, reason };
  }
}

async function attempt<T>(deps: ResilienceDeps, request: FetchRequest<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  if (deps.rateLimiter) {
    const decision = await deps.rateLimiter.tryAcquire();
    if (!decision.allowed) throw new RateLimitedError(deps.system, decision.retryAfterMs);
  }
  const run = () => request.call(signal);
  return deps.breaker ? deps.breaker.execute(run) : run();
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function reasonOf(error: unknown): UnavailableReason {
  if (error instanceof TimeoutError) return "timeout";
  if (error instanceof CircuitOpenError) return "circuit_open";
  if (error instanceof RateLimitedError) return "rate_limited";
  if (error instanceof SchemaError) return "invalid_response";
  if (error instanceof UpstreamError) {
    if (error.status === 429) return "rate_limited";
    if (error.status === 404) return "not_found";
    return "upstream_error";
  }
  return "internal_error";
}
