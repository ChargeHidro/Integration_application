import { beforeEach, describe, expect, it } from "vitest";
import type { PriceQuery } from "../../src/adapters/pricing/schema";
import { BomService } from "../../src/modules/projects/service";
import { createMemoryRepositories } from "../../src/repositories/memory/memoryRepositories";
import { administrator, channelPartner, fakeAdapters, ok, priceQuote, salesEngineer, type FakeAdapters } from "../support/fakes";

describe("BomService", () => {
  let adapters: FakeAdapters;
  let service: BomService;

  beforeEach(() => {
    adapters = fakeAdapters();
    service = new BomService({ bom: createMemoryRepositories().bom, adapters, settings: { priceTimeoutMs: 200 } });
  });

  it("prices every line for a sales engineer in their country", async () => {
    const bom = await service.getBom(salesEngineer, "PRJ-1");

    expect(bom.pricing).toBe("ok");
    expect(bom.lines).toHaveLength(5);
    expect(bom.lines.find((line) => line.itemId === "CAB-01")).toMatchObject({
      quantity: 2,
      pricing: "ok",
      unitPrice: 1000,
      lineTotal: 2000,
      currency: "INR",
    });
    expect(bom).toMatchObject({ totals: [{ currency: "INR", amount: 6000 }] });
    for (const [query] of adapters.pricing.fetch.mock.calls) {
      expect(query).toMatchObject({ country: "IN", customerGroup: "OEM" });
    }
  });

  it("asks pricing once per distinct variant", async () => {
    await service.getBom(salesEngineer, "PRJ-1");

    const variants = adapters.pricing.fetch.mock.calls.map(([query]) => query.variantCode).sort();
    expect(variants).toEqual(["ACS-R6-400", "ACS-R7-400", "CAB-STD-800", "PNL-SAFETY-1"]);
  });

  it("uses the administrator's own country", async () => {
    const bom = await service.getBom(administrator, "PRJ-1");

    expect(bom).toMatchObject({ totals: [{ currency: "EUR" }] });
  });

  it("returns no price fields at all for a channel partner", async () => {
    const bom = await service.getBom(channelPartner, "PRJ-1");

    expect(bom.pricing).toBe("not_permitted");
    expect(bom.lines[0]).toEqual({ itemId: "CAB-01", variantCode: "CAB-STD-800", quantity: 2 });
    expect(JSON.stringify(bom)).not.toMatch(/price|total|currency|leadTime|validUntil/i);
    expect(adapters.pricing.fetch).not.toHaveBeenCalled();
  });

  it("marks the BOM partial when some prices are unavailable", async () => {
    adapters.pricing.fetch.mockImplementation(async (query: PriceQuery) =>
      query.variantCode === "CAB-STD-800"
        ? { status: "unavailable", data: null, reason: "rate_limited" }
        : ok(priceQuote(query)),
    );

    const bom = await service.getBom(salesEngineer, "PRJ-1");

    expect(bom.pricing).toBe("partial");
    expect(bom.lines.find((line) => line.itemId === "CAB-01")).toEqual({
      itemId: "CAB-01",
      variantCode: "CAB-STD-800",
      quantity: 2,
      pricing: "unavailable",
    });
    expect(bom).toMatchObject({ totals: [{ currency: "INR", amount: 4000 }] });
  });

  it("returns 404 for an unknown project", async () => {
    await expect(service.getBom(salesEngineer, "NOPE")).rejects.toMatchObject({ status: 404 });
  });
});
