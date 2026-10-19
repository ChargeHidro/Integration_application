import { vi, type Mock } from "vitest";
import type { CatalogueQuery, CatalogueVariant } from "../../src/adapters/catalogue/schema";
import type { PriceQuery, PriceQuote } from "../../src/adapters/pricing/schema";
import type { SizingInput, SizingResult } from "../../src/adapters/sizing/schema";
import type { Adapter, FetchOptions, SectionResult, SystemAdapters } from "../../src/adapters/types";
import type { Caller } from "../../src/core/auth/caller";

export const salesEngineer: Caller = { sub: "se-1", role: "sales_engineer", country: "IN", customerGroup: "OEM" };
export const channelPartner: Caller = { sub: "cp-1", role: "channel_partner", country: "IN", customerGroup: "DISTRIBUTOR" };
export const administrator: Caller = { sub: "ad-1", role: "administrator", country: "DE", customerGroup: "END_USER" };

const fetchedAt = "2026-10-20T00:00:00.000Z";

export function ok<T>(data: T): SectionResult<T> {
  return { status: "ok", data, fetchedAt };
}

export function catalogueVariant(code: string): CatalogueVariant {
  const slug = code.toLowerCase().replace(/-400$/, "");
  return {
    code,
    model: "ACS Drive",
    description: code,
    frame: null,
    ratedKw: null,
    voltage: null,
    ipRating: "IP21",
    options: [],
    dimensionsMm: { w: 1, h: 1, d: 1 },
    model3d: { lod0: `models/${slug}/lod0.glb`, lod1: `models/${slug}/lod1.glb`, lod2: `models/${slug}/lod2.glb` },
  };
}

export function priceQuote(query: PriceQuery, price = 1000): PriceQuote {
  return {
    variantCode: query.variantCode,
    country: query.country,
    currency: query.country === "IN" ? "INR" : "EUR",
    price,
    leadTimeDays: 21,
    validUntil: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  };
}

type FetchOf<Q, T> = (query: Q, options: FetchOptions) => Promise<SectionResult<T>>;

export interface FakeAdapters extends SystemAdapters {
  catalogue: Adapter<CatalogueQuery, CatalogueVariant> & { fetch: Mock<FetchOf<CatalogueQuery, CatalogueVariant>> };
  sizing: Adapter<SizingInput, SizingResult> & { fetch: Mock<FetchOf<SizingInput, SizingResult>> };
  pricing: Adapter<PriceQuery, PriceQuote> & { fetch: Mock<FetchOf<PriceQuery, PriceQuote>> };
}

export function fakeAdapters(): FakeAdapters {
  return {
    catalogue: {
      system: "catalogue",
      fetch: vi.fn<FetchOf<CatalogueQuery, CatalogueVariant>>(async (query) => ok(catalogueVariant(query.variantCode))),
    },
    sizing: {
      system: "sizing",
      fetch: vi.fn<FetchOf<SizingInput, SizingResult>>(async (input) =>
        ok({ variantCode: input.motorKw > 54 ? "ACS-R7-400" : "ACS-R6-400", loadPct: 80 }),
      ),
    },
    pricing: {
      system: "pricing",
      fetch: vi.fn<FetchOf<PriceQuery, PriceQuote>>(async (query) => ok(priceQuote(query))),
    },
  };
}
