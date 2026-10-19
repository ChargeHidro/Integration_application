import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogueAdapter } from "../../src/adapters/catalogue/adapter";
import { HttpCatalogueClient } from "../../src/adapters/catalogue/client";
import type { CatalogueVariant } from "../../src/adapters/catalogue/schema";
import { PricingAdapter } from "../../src/adapters/pricing/adapter";
import { HttpPricingClient } from "../../src/adapters/pricing/client";
import type { PriceQuote } from "../../src/adapters/pricing/schema";
import { SizingAdapter } from "../../src/adapters/sizing/adapter";
import { HttpSizingClient } from "../../src/adapters/sizing/client";
import type { SizingResult } from "../../src/adapters/sizing/schema";
import { MemoryCacheStore, TtlCache } from "../../src/core/resilience/cache";
import { startMocks, type Mocks } from "../../src/mocks/mockServers";

const logger = pino({ level: "silent" });
const retry = { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 };
const cache = <T>(namespace: string) =>
  new TtlCache<T>(new MemoryCacheStore(), { namespace, ttlSeconds: 60, retentionSeconds: 3600 });

let mocks: Mocks;

beforeAll(async () => {
  mocks = await startMocks({ sizing: { minDelayMs: 0, maxDelayMs: 0, failRate: 0 } });
});

afterAll(async () => {
  await mocks.close();
});

describe("mocks speak the adapter contract", () => {
  it("sizing", async () => {
    const adapter = new SizingAdapter({ client: new HttpSizingClient(mocks.urls.sizing), cache: cache<SizingResult>("size"), retry, logger });

    const result = await adapter.fetch({ motorKw: 70, voltage: 400 }, { timeoutMs: 1000 });

    expect(result).toMatchObject({ status: "ok", data: { variantCode: "ACS-R7-400", frame: "R7", loadPct: 82 } });
  });

  it("sizing failure is a retryable 503", async () => {
    mocks.sizing.failRate = 1;
    const adapter = new SizingAdapter({ client: new HttpSizingClient(mocks.urls.sizing), cache: cache<SizingResult>("size"), retry, logger });

    const result = await adapter.fetch({ motorKw: 70, voltage: 400 }, { timeoutMs: 1000 });

    expect(result).toEqual({ status: "unavailable", data: null, reason: "upstream_error" });
    mocks.sizing.failRate = 0;
  });

  it("catalogue", async () => {
    const adapter = new CatalogueAdapter({ client: new HttpCatalogueClient(mocks.urls.catalogue), cache: cache<CatalogueVariant>("cat"), retry, logger });

    const result = await adapter.fetch({ variantCode: "ACS-R7-400" }, { timeoutMs: 1000 });

    expect(result).toMatchObject({ status: "ok", data: { code: "ACS-R7-400", model3d: { lod0: "models/acs-r7/lod0.glb" } } });
  });

  it("pricing", async () => {
    const adapter = new PricingAdapter({ client: new HttpPricingClient(mocks.urls.pricing), cache: cache<PriceQuote>("price"), retry, logger });

    const result = await adapter.fetch({ variantCode: "ACS-R6-400", country: "DE", customerGroup: "OEM" }, { timeoutMs: 1000 });

    expect(result).toMatchObject({ status: "ok", data: { variantCode: "ACS-R6-400", currency: "EUR", price: 5580, leadTimeDays: 21 } });
  });

  it("pricing rate limit surfaces as rate_limited", async () => {
    const adapter = new PricingAdapter({ client: new HttpPricingClient(mocks.urls.pricing), cache: cache<PriceQuote>("price"), retry, logger });
    const countries = ["IN", "DE", "US", "GB"];

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        adapter.fetch({ variantCode: "ACS-R8-400", country: countries[i % 4]!, customerGroup: `G${i}` }, { timeoutMs: 1000 }),
      ),
    );

    expect(results.some((r) => r.status === "unavailable" && r.reason === "rate_limited")).toBe(true);
  });
});
