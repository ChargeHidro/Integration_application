import type { Adapter, FetchOptions, SectionResult } from "../../adapters/types";
import type { SnapshotRepository, Stored } from "../../repositories/types";
import type { Logger } from "../logger";
import type { TtlCache } from "./cache";
import { withTimeout } from "./withTimeout";

export interface ReadThroughOptions<Q, K, T> {
  cache: TtlCache<T>;
  store: SnapshotRepository<K, T>;
  cacheKeyOf: (query: Q) => string;
  storeKeyOf: (query: Q) => K;
  freshForMs: number;
  notAfter?: (value: T) => Date;
  storeTimeoutMs?: number;
  logger: Logger;
  now?: () => number;
}

const defaultStoreTimeoutMs = 200;

export function readThrough<Q, K, T>(upstream: Adapter<Q, T>, options: ReadThroughOptions<Q, K, T>): Adapter<Q, T> {
  const now = options.now ?? Date.now;
  const system = upstream.system;
  const storeTimeoutMs = options.storeTimeoutMs ?? defaultStoreTimeoutMs;

  const notAfterOf = (value: T): Date | undefined => options.notAfter?.(value);
  const usable = (stored: Stored<T> | null): Stored<T> | null => {
    if (!stored) return null;
    const notAfter = notAfterOf(stored.value);
    return notAfter !== undefined && now() >= notAfter.getTime() ? null : stored;
  };
  const isFresh = (stored: Stored<T>): boolean => now() - Date.parse(stored.fetchedAt) < options.freshForMs;

  const readStore = async (key: K): Promise<Stored<T> | null> => {
    try {
      return await withTimeout(() => options.store.get(key), storeTimeoutMs, `${system} store read`);
    } catch (error) {
      options.logger.warn({ system, error: messageOf(error) }, "snapshot store read failed");
      return null;
    }
  };

  const writeStore = async (key: K, value: T, fetchedAt: string): Promise<void> => {
    try {
      await withTimeout(() => options.store.put(key, value, fetchedAt), storeTimeoutMs, `${system} store write`);
    } catch (error) {
      options.logger.warn({ system, error: messageOf(error) }, "snapshot store write failed");
    }
  };

  const fill = (cacheKey: string, value: T, fetchedAt: string): Promise<void> =>
    options.cache.set(cacheKey, value, { notAfter: notAfterOf(value), fetchedAt: new Date(fetchedAt) });

  return {
    system,
    async fetch(query: Q, fetchOptions: FetchOptions): Promise<SectionResult<T>> {
      const startedAt = now();
      const cacheKey = options.cacheKeyOf(query);
      const cached = await options.cache.get(cacheKey);
      if (cached?.fresh) return { status: "ok", data: cached.value, fetchedAt: cached.fetchedAt };

      const storeKey = options.storeKeyOf(query);
      const stored = usable(await readStore(storeKey));
      if (stored && isFresh(stored)) {
        await fill(cacheKey, stored.value, stored.fetchedAt);
        return { status: "ok", data: stored.value, fetchedAt: stored.fetchedAt };
      }

      const remainingMs = Math.max(1, fetchOptions.timeoutMs - (now() - startedAt));
      const result = await upstream.fetch(query, { ...fetchOptions, timeoutMs: remainingMs });
      if (result.status === "ok") {
        await Promise.all([fill(cacheKey, result.data, result.fetchedAt), writeStore(storeKey, result.data, result.fetchedAt)]);
        return result;
      }
      if (result.status !== "unavailable" || result.reason === "invalid_response") return result;

      const fallback = newest(cached ? { value: cached.value, fetchedAt: cached.fetchedAt } : null, stored);
      if (!fallback) return result;
      return { status: "stale", data: fallback.value, fetchedAt: fallback.fetchedAt, reason: result.reason };
    },
  };
}

function newest<T>(a: Stored<T> | null, b: Stored<T> | null): Stored<T> | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.fetchedAt) >= Date.parse(b.fetchedAt) ? a : b;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
