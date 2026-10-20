import type { Redis } from "ioredis";
import type { Config, SystemName } from "../config/env";
import type { Logger } from "../core/logger";
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
      retry: config.retry,
      logger,
      rateLimiter: rateLimiterFor("sizing"),
      breaker: sizingBreaker,
    }),
    catalogue: new CatalogueAdapter({
      client: new HttpCatalogueClient(config.systems.catalogue.url),
      retry: config.retry,
      logger,
      rateLimiter: rateLimiterFor("catalogue"),
    }),
    pricing: new PricingAdapter({
      client: new HttpPricingClient(config.systems.pricing.url),
      retry: config.retry,
      logger,
      rateLimiter: rateLimiterFor("pricing"),
    }),
  };
}
