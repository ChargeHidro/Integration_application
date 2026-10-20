import { z } from "zod";

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().positive();
const positiveNumber = z.coerce.number().positive();
const nonNegativeInt = z.coerce.number().int().min(0);
const ratio = z.coerce.number().min(0).max(1);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: port.default(3000),
  REPOSITORY: z.enum(["postgres", "memory"]).default("postgres"),
  DATABASE_URL: z.string().url().default("postgres://cloudworx:cloudworx@localhost:55432/cloudworx"),
  REDIS_URL: z.string().url().default("redis://localhost:56379"),

  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default("cloudworx-mock-idp"),
  JWT_AUDIENCE: z.string().min(1).default("cloudworx-integration-api"),

  SIZING_URL: z.string().url().default("http://localhost:4001"),
  CATALOGUE_URL: z.string().url().default("http://localhost:4002"),
  PRICING_URL: z.string().url().default("http://localhost:4003"),
  SIZING_API_VERSION: z.string().min(1).max(32).default("v1"),

  SIDEBAR_BUDGET_MS: positiveInt.default(1000),
  SECTION_TIMEOUT_MS: positiveInt.default(800),
  RESIZE_TIMEOUT_MS: positiveInt.default(5000),

  CATALOGUE_TTL_SECONDS: positiveInt.default(3600),
  SIZING_TTL_SECONDS: positiveInt.default(604800),
  PRICING_TTL_SECONDS: positiveInt.default(86400),
  STALE_RETENTION_SECONDS: positiveInt.default(1209600),

  SIZING_RATE_LIMIT_PER_SECOND: positiveNumber.default(18),
  PRICING_RATE_LIMIT_PER_SECOND: positiveNumber.default(4.5),

  RETRY_MAX_RETRIES: nonNegativeInt.max(5).default(2),
  RETRY_BASE_DELAY_MS: positiveInt.default(100),
  RETRY_MAX_DELAY_MS: positiveInt.default(1000),

  BREAKER_FAILURE_RATE: ratio.default(0.5),
  BREAKER_MIN_REQUESTS: positiveInt.default(5),
  BREAKER_WINDOW_MS: positiveInt.default(10000),
  BREAKER_COOLDOWN_MS: positiveInt.default(5000),

  MOCK_SIZING_PORT: port.default(4001),
  MOCK_CATALOGUE_PORT: port.default(4002),
  MOCK_PRICING_PORT: port.default(4003),
  MOCK_SIZING_MIN_DELAY_MS: nonNegativeInt.default(500),
  MOCK_SIZING_MAX_DELAY_MS: nonNegativeInt.default(3000),
  MOCK_SIZING_FAILURE_RATE: ratio.default(0.2),
  MOCK_PRICING_RATE_LIMIT_PER_SECOND: positiveInt.default(5),
});

export type SystemName = "sizing" | "catalogue" | "pricing";

export interface SystemConfig {
  url: string;
  ttlSeconds: number;
  rateLimitPerSecond?: number;
  apiVersion?: string;
}

export interface Config {
  env: "development" | "test" | "production";
  logLevel: string;
  port: number;
  repository: "postgres" | "memory";
  databaseUrl: string;
  redisUrl: string;
  auth: { secret: string; issuer: string; audience: string };
  systems: Record<SystemName, SystemConfig>;
  timeouts: { sidebarBudgetMs: number; sectionMs: number; resizeMs: number };
  staleRetentionSeconds: number;
  retry: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
  breaker: { failureRate: number; minRequests: number; windowMs: number; cooldownMs: number };
  mocks: {
    ports: Record<SystemName, number>;
    sizing: { minDelayMs: number; maxDelayMs: number; failureRate: number };
    pricing: { rateLimitPerSecond: number };
  };
}

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.join("\n")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const e = parsed.data;

  const issues: string[] = [];
  if (e.SECTION_TIMEOUT_MS >= e.SIDEBAR_BUDGET_MS) {
    issues.push("SECTION_TIMEOUT_MS: must be lower than SIDEBAR_BUDGET_MS");
  }
  if (e.MOCK_SIZING_MIN_DELAY_MS > e.MOCK_SIZING_MAX_DELAY_MS) {
    issues.push("MOCK_SIZING_MIN_DELAY_MS: must not exceed MOCK_SIZING_MAX_DELAY_MS");
  }
  if (e.STALE_RETENTION_SECONDS < Math.max(e.CATALOGUE_TTL_SECONDS, e.SIZING_TTL_SECONDS, e.PRICING_TTL_SECONDS)) {
    issues.push("STALE_RETENTION_SECONDS: must be at least the longest system TTL");
  }
  if (issues.length > 0) throw new ConfigError(issues);

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.PORT,
    repository: e.REPOSITORY,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    auth: { secret: e.JWT_SECRET, issuer: e.JWT_ISSUER, audience: e.JWT_AUDIENCE },
    systems: {
      sizing: {
        url: e.SIZING_URL,
        ttlSeconds: e.SIZING_TTL_SECONDS,
        rateLimitPerSecond: e.SIZING_RATE_LIMIT_PER_SECOND,
        apiVersion: e.SIZING_API_VERSION,
      },
      catalogue: { url: e.CATALOGUE_URL, ttlSeconds: e.CATALOGUE_TTL_SECONDS },
      pricing: { url: e.PRICING_URL, ttlSeconds: e.PRICING_TTL_SECONDS, rateLimitPerSecond: e.PRICING_RATE_LIMIT_PER_SECOND },
    },
    timeouts: { sidebarBudgetMs: e.SIDEBAR_BUDGET_MS, sectionMs: e.SECTION_TIMEOUT_MS, resizeMs: e.RESIZE_TIMEOUT_MS },
    staleRetentionSeconds: e.STALE_RETENTION_SECONDS,
    retry: { maxRetries: e.RETRY_MAX_RETRIES, baseDelayMs: e.RETRY_BASE_DELAY_MS, maxDelayMs: e.RETRY_MAX_DELAY_MS },
    breaker: {
      failureRate: e.BREAKER_FAILURE_RATE,
      minRequests: e.BREAKER_MIN_REQUESTS,
      windowMs: e.BREAKER_WINDOW_MS,
      cooldownMs: e.BREAKER_COOLDOWN_MS,
    },
    mocks: {
      ports: { sizing: e.MOCK_SIZING_PORT, catalogue: e.MOCK_CATALOGUE_PORT, pricing: e.MOCK_PRICING_PORT },
      sizing: {
        minDelayMs: e.MOCK_SIZING_MIN_DELAY_MS,
        maxDelayMs: e.MOCK_SIZING_MAX_DELAY_MS,
        failureRate: e.MOCK_SIZING_FAILURE_RATE,
      },
      pricing: { rateLimitPerSecond: e.MOCK_PRICING_RATE_LIMIT_PER_SECOND },
    },
  };
}
