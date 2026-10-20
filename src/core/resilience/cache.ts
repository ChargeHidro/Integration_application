import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export class RedisCacheStore implements CacheStore {
  constructor(private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }
}

export interface CacheEntry<T> {
  value: T;
  fetchedAt: string;
  fresh: boolean;
}

export interface TtlCacheOptions {
  namespace: string;
  ttlSeconds: number;
  retentionSeconds: number;
  onError?: (error: unknown) => void;
  now?: () => number;
}

interface Envelope<T> {
  value: T;
  fetchedAt: number;
  notAfter?: number;
}

export class TtlCache<T> {
  private readonly now: () => number;

  constructor(
    private readonly store: CacheStore,
    private readonly options: TtlCacheOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async get(key: string): Promise<CacheEntry<T> | null> {
    let raw: string | null;
    try {
      raw = await this.store.get(this.keyOf(key));
    } catch (error) {
      this.options.onError?.(error);
      return null;
    }
    if (raw === null) return null;

    const envelope = parseEnvelope<T>(raw);
    if (!envelope) return null;

    const now = this.now();
    if (envelope.notAfter !== undefined && now >= envelope.notAfter) return null;

    return {
      value: envelope.value,
      fetchedAt: new Date(envelope.fetchedAt).toISOString(),
      fresh: now - envelope.fetchedAt < this.options.ttlSeconds * 1000,
    };
  }

  async set(key: string, value: T, options: { notAfter?: Date; fetchedAt?: Date } = {}): Promise<void> {
    const now = this.now();
    const notAfter = options.notAfter?.getTime();
    const fetchedAt = options.fetchedAt?.getTime() ?? now;

    let ttlSeconds = this.options.retentionSeconds;
    if (notAfter !== undefined) {
      const remainingSeconds = Math.floor((notAfter - now) / 1000);
      if (remainingSeconds <= 0) return;
      ttlSeconds = Math.min(ttlSeconds, remainingSeconds);
    }

    const envelope: Envelope<T> = { value, fetchedAt, ...(notAfter === undefined ? {} : { notAfter }) };
    try {
      await this.store.set(this.keyOf(key), JSON.stringify(envelope), ttlSeconds);
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  private keyOf(key: string): string {
    return `${this.options.namespace}:${key}`;
  }
}

function parseEnvelope<T>(raw: string): Envelope<T> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("value" in parsed) || !("fetchedAt" in parsed)) return null;
    if (typeof parsed.fetchedAt !== "number") return null;
    return parsed as Envelope<T>;
  } catch {
    return null;
  }
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const fields = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, field]) => `${JSON.stringify(key)}:${stableStringify(field)}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
