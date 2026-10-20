import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { CatalogueAdapter } from "../../src/adapters/catalogue/adapter";
import type { CatalogueVariant } from "../../src/adapters/catalogue/schema";
import { PricingAdapter } from "../../src/adapters/pricing/adapter";
import type { PriceQuote } from "../../src/adapters/pricing/schema";
import { SizingAdapter } from "../../src/adapters/sizing/adapter";

const logger = pino({ level: "silent" });
const retry = { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 };
const options = { timeoutMs: 200 };

const variant: CatalogueVariant = {
  code: "ACS-R6-400",
  model: "ACS Drive",
  description: "Drive, frame R6",
  frame: "R6",
  ratedKw: 60,
  voltage: 400,
  ipRating: "IP21",
  options: ["EMC filter"],
  dimensionsMm: { w: 252, h: 571, d: 330 },
  model3d: { lod0: "a.glb", lod1: "b.glb", lod2: "c.glb" },
};

const quote = (validUntil: string): PriceQuote => ({
  variantCode: "ACS-R6-400",
  country: "IN",
  currency: "INR",
  price: 570400,
  leadTimeDays: 21,
  validUntil,
});

describe("SizingAdapter", () => {
  it("returns a validated sizing result", async () => {
    const client = { size: vi.fn(async () => ({ variantCode: "ACS-R7-400", loadPct: 88, frame: "R7" })) };
    const adapter = new SizingAdapter({ client, retry, logger });

    const result = await adapter.fetch({ motorKw: 75, voltage: 400 }, options);

    expect(result).toMatchObject({ status: "ok", data: { variantCode: "ACS-R7-400", loadPct: 88 } });
  });

  it("calls the sizing system on every fetch, because caching is not its job", async () => {
    const client = { size: vi.fn(async () => ({ variantCode: "ACS-R7-400", loadPct: 88 })) };
    const adapter = new SizingAdapter({ client, retry, logger });

    await adapter.fetch({ motorKw: 75, voltage: 400 }, options);
    await adapter.fetch({ motorKw: 75, voltage: 400 }, options);

    expect(client.size).toHaveBeenCalledTimes(2);
  });

  it("rejects a vendor response with a changed shape", async () => {
    const client = { size: vi.fn(async () => ({ recommendedVariant: "ACS-R7-400" })) };
    const adapter = new SizingAdapter({ client, retry, logger });

    const result = await adapter.fetch({ motorKw: 75, voltage: 400 }, options);

    expect(result).toEqual({ status: "unavailable", data: null, reason: "invalid_response" });
  });
});

describe("CatalogueAdapter", () => {
  it("returns a validated variant", async () => {
    const client = { getVariant: vi.fn(async () => variant) };
    const adapter = new CatalogueAdapter({ client, retry, logger });

    const result = await adapter.fetch({ variantCode: "ACS-R6-400" }, options);

    expect(result).toMatchObject({ status: "ok", data: variant });
    expect(client.getVariant).toHaveBeenCalledWith("ACS-R6-400", expect.anything());
  });
});

describe("PricingAdapter", () => {
  const future = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  it("returns a quote for the requested variant, country and group", async () => {
    const client = { getPrice: vi.fn(async () => quote(future())) };
    const adapter = new PricingAdapter({ client, retry, logger });
    const query = { variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" };

    const result = await adapter.fetch(query, options);

    expect(result).toMatchObject({ status: "ok", data: { price: 570400, currency: "INR" } });
    expect(client.getPrice).toHaveBeenCalledWith(query, expect.anything());
  });

  it("never returns a quote that is already past validUntil", async () => {
    const client = { getPrice: vi.fn(async () => quote(new Date(Date.now() - 1000).toISOString())) };
    const adapter = new PricingAdapter({ client, retry, logger });

    const result = await adapter.fetch({ variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" }, options);

    expect(result).toEqual({ status: "unavailable", data: null, reason: "invalid_response" });
  });
});
