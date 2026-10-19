import { isTransientError, RateLimitedError, UpstreamError } from "../errors/errors";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  deadline?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  random?: () => number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  return Math.round(random() * Math.min(maxDelayMs, baseDelayMs * 2 ** attempt));
}

function retryAfterOf(error: unknown): number {
  if (error instanceof UpstreamError || error instanceof RateLimitedError) return error.retryAfterMs ?? 0;
  return 0;
}

export async function retry<T>(work: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const shouldRetry = options.shouldRetry ?? isTransientError;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await work(attempt);
    } catch (error) {
      if (attempt >= options.maxRetries || !shouldRetry(error)) throw error;

      const delayMs = Math.max(
        retryAfterOf(error),
        backoffDelay(attempt, options.baseDelayMs, options.maxDelayMs, random),
      );
      if (options.deadline !== undefined && now() + delayMs >= options.deadline) throw error;

      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }
}
