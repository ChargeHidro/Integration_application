import type { PriceQuery } from "../adapters/pricing/schema";
import type { SizingInput } from "../adapters/sizing/schema";
import type { SystemAdapters } from "../adapters/types";
import type { Config, SystemName } from "../config/env";
import type { Logger } from "../core/logger";
import { stableHash, TtlCache, type CacheStore } from "../core/resilience/cache";
import { readThrough } from "../core/resilience/readThrough";
import type { SizingKey, SnapshotRepositories } from "../repositories/types";

export interface SourceDeps {
  cacheStore: CacheStore;
  repositories: SnapshotRepositories;
  adapters: SystemAdapters;
  logger: Logger;
  now?: () => number;
}

export type SourceConfig = Pick<Config, "systems" | "staleRetentionSeconds">;

const defaultSizingApiVersion = "v1";

export function sizingKey(input: SizingInput, apiVersion: string): SizingKey {
  return { inputHash: stableHash(input), apiVersion };
}

export function sizingCacheKey(input: SizingInput, apiVersion: string): string {
  return stableHash({ input, apiVersion });
}

export function priceCacheKey(query: PriceQuery): string {
  return `${query.variantCode}:${query.country}:${query.customerGroup}`;
}

export function createSources(config: SourceConfig, deps: SourceDeps): SystemAdapters {
  const { cacheStore, repositories, adapters, logger, now } = deps;
  const apiVersion = config.systems.sizing.apiVersion ?? defaultSizingApiVersion;

  const cacheFor = <T>(system: SystemName, namespace: string) =>
    new TtlCache<T>(cacheStore, {
      namespace,
      ttlSeconds: config.systems[system].ttlSeconds,
      retentionSeconds: config.staleRetentionSeconds,
      now,
      onError: (error) =>
        logger.warn({ system, error: error instanceof Error ? error.message : String(error) }, "cache unavailable"),
    });

  const freshForMs = (system: SystemName) => config.systems[system].ttlSeconds * 1000;

  return {
    catalogue: readThrough(adapters.catalogue, {
      cache: cacheFor("catalogue", "cat"),
      store: repositories.catalogueVariants,
      cacheKeyOf: (query) => query.variantCode,
      storeKeyOf: (query) => query,
      freshForMs: freshForMs("catalogue"),
      logger,
      now,
    }),
    sizing: readThrough(adapters.sizing, {
      cache: cacheFor("sizing", "size"),
      store: repositories.sizingResults,
      cacheKeyOf: (input) => sizingCacheKey(input, apiVersion),
      storeKeyOf: (input) => sizingKey(input, apiVersion),
      freshForMs: freshForMs("sizing"),
      logger,
      now,
    }),
    pricing: readThrough(adapters.pricing, {
      cache: cacheFor("pricing", "price"),
      store: repositories.priceSnapshots,
      cacheKeyOf: priceCacheKey,
      storeKeyOf: (query) => query,
      freshForMs: freshForMs("pricing"),
      notAfter: (quote) => new Date(quote.validUntil),
      logger,
      now,
    }),
  };
}
