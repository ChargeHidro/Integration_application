import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config/env";

const secret = "x".repeat(32);

describe("loadConfig", () => {
  it("applies defaults from CLAUDE.md", () => {
    const config = loadConfig({ JWT_SECRET: secret });

    expect(config.port).toBe(3000);
    expect(config.repository).toBe("postgres");
    expect(config.timeouts).toEqual({ sidebarBudgetMs: 1000, sectionMs: 800, resizeMs: 5000 });
    expect(config.systems.catalogue.ttlSeconds).toBe(3600);
    expect(config.systems.sizing.ttlSeconds).toBe(7 * 24 * 3600);
    expect(config.systems.pricing.ttlSeconds).toBe(24 * 3600);
    expect(config.systems.sizing.rateLimitPerSecond).toBe(18);
    expect(config.systems.pricing.rateLimitPerSecond).toBe(4.5);
    expect(config.systems.sizing.apiVersion).toBe("v1");
    expect(config.retry.maxRetries).toBe(2);
    expect(config.mocks.sizing).toEqual({ minDelayMs: 500, maxDelayMs: 3000, failureRate: 0.2 });
  });

  it("coerces numeric strings from the environment", () => {
    const config = loadConfig({ JWT_SECRET: secret, PRICING_RATE_LIMIT_PER_SECOND: "1", REPOSITORY: "memory" });

    expect(config.systems.pricing.rateLimitPerSecond).toBe(1);
    expect(config.repository).toBe("memory");
    expect(loadConfig({ JWT_SECRET: secret, PRICING_RATE_LIMIT_PER_SECOND: "0.5" }).systems.pricing.rateLimitPerSecond).toBe(0.5);
    expect(() => loadConfig({ JWT_SECRET: secret, SIZING_RATE_LIMIT_PER_SECOND: "0" })).toThrow(/SIZING_RATE_LIMIT_PER_SECOND/);
  });

  it("rejects a missing or short JWT secret", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  it("rejects invalid values", () => {
    expect(() => loadConfig({ JWT_SECRET: secret, REPOSITORY: "mongo" })).toThrow(/REPOSITORY/);
    expect(() => loadConfig({ JWT_SECRET: secret, MOCK_SIZING_FAILURE_RATE: "1.5" })).toThrow(/MOCK_SIZING_FAILURE_RATE/);
    expect(() => loadConfig({ JWT_SECRET: secret, PORT: "abc" })).toThrow(/PORT/);
  });

  it("rejects a section timeout that does not fit the sidebar budget", () => {
    expect(() => loadConfig({ JWT_SECRET: secret, SECTION_TIMEOUT_MS: "1000" })).toThrow(/SECTION_TIMEOUT_MS/);
  });

  it("rejects stale retention shorter than a system TTL", () => {
    expect(() => loadConfig({ JWT_SECRET: secret, STALE_RETENTION_SECONDS: "60" })).toThrow(/STALE_RETENTION_SECONDS/);
  });
});
