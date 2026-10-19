import type { Redis } from "ioredis";
import type { Config, SystemName } from "../config/env";
import type { Logger } from "../core/logger";
import { RedisCacheStore, TtlCache } from "../core/resilience/cache";
import { CircuitBreaker } from "../core/resilience/circuitBreaker";
import { RedisTokenBucket, type RateLimiter } from "../core/resilience/rateLimiter";
import { CatalogueAdapter } from "./catalogue/adapter";
import { HttpCatalogueClient } from "./catalogue/client";
import { PricingAdapter } from "./pricing/adapter";
import { HttpPricingClient } from "./pricing/client";
import { SizingAdapter } from "./sizing/adapter";
import { HttpSizingClient } from "./sizing/client";
import type { SystemAdapters } from "./types";

export interface AdapterInfrastructure {
  redis: Redis;
  logger: Logger;
}

export function createAdapters(config: Config, { redis, logger }: AdapterInfrastructure): SystemAdapters {
  const store = new RedisCacheStore(redis);

  const cacheFor = <T>(system: SystemName, namespace: string) =>
    new TtlCache<T>(store, {
      namespace,
      ttlSeconds: config.systems[system].ttlSeconds,
      retentionSeconds: config.staleRetentionSeconds,
      onError: (error) =>
        logger.warn({ system, error: error instanceof Error ? error.message : String(error) }, "cache unavailable"),
    });

  const rateLimiterFor = (system: SystemName): RateLimiter | undefined => {
    const ratePerSecond = config.systems[system].rateLimitPerSecond;
    return ratePerSecond === undefined ? undefined : new RedisTokenBucket(redis, `ratelimit:${system}`, { ratePerSecond });
  };

  const sizingBreaker = new CircuitBreaker({
    name: "sizing",
    ...config.breaker,
    onStateChange: (from, to) => logger.warn({ system: "sizing", from, to }, "circuit breaker state changed"),
  });

  return {
    sizing: new SizingAdapter({
      client: new HttpSizingClient(config.systems.sizing.url),
      cache: cacheFor("sizing", "size"),
      retry: config.retry,
      logger,
      rateLimiter: rateLimiterFor("sizing"),
      breaker: sizingBreaker,
    }),
    catalogue: new CatalogueAdapter({
      client: new HttpCatalogueClient(config.systems.catalogue.url),
      cache: cacheFor("catalogue", "cat"),
      retry: config.retry,
      logger,
      rateLimiter: rateLimiterFor("catalogue"),
    }),
    pricing: new PricingAdapter({
      client: new HttpPricingClient(config.systems.pricing.url),
      cache: cacheFor("pricing", "price"),
      retry: config.retry,
      logger,
      rateLimiter: rateLimiterFor("pricing"),
    }),
  };
}
