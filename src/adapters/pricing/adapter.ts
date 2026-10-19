import { parseVendorResponse } from "../http";
import { resilientFetch, type ResilienceDeps } from "../resilientFetch";
import type { Adapter, FetchOptions, SectionResult } from "../types";
import type { PricingClient } from "./client";
import { priceQuoteSchema, type PriceQuery, type PriceQuote } from "./schema";

export type PricingAdapterDeps = Omit<ResilienceDeps<PriceQuote>, "system"> & {
  client: PricingClient;
  now?: () => number;
};

export class PricingAdapter implements Adapter<PriceQuery, PriceQuote> {
  readonly system = "pricing";

  constructor(private readonly deps: PricingAdapterDeps) {}

  async fetch(query: PriceQuery, options: FetchOptions): Promise<SectionResult<PriceQuote>> {
    const result = await resilientFetch(
      { ...this.deps, system: this.system },
      {
        cacheKey: `${query.variantCode}:${query.country}:${query.customerGroup}`,
        timeoutMs: options.timeoutMs,
        call: async (signal) =>
          parseVendorResponse(this.system, priceQuoteSchema, await this.deps.client.getPrice(query, signal)),
        notAfter: (quote) => new Date(quote.validUntil),
      },
    );

    const now = (this.deps.now ?? Date.now)();
    if (result.data !== null && Date.parse(result.data.validUntil) <= now) {
      this.deps.logger.warn({ system: this.system, variantCode: query.variantCode }, "price quote already expired");
      return { status: "unavailable", data: null, reason: "invalid_response" };
    }
    return result;
  }
}
