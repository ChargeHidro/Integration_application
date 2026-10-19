import { requestJson } from "../http";
import type { PriceQuery } from "./schema";

export interface PricingClient {
  getPrice(query: PriceQuery, signal: AbortSignal): Promise<unknown>;
}

export class HttpPricingClient implements PricingClient {
  constructor(private readonly baseUrl: string) {}

  getPrice(query: PriceQuery, signal: AbortSignal): Promise<unknown> {
    const params = new URLSearchParams({ country: query.country, group: query.customerGroup });
    return requestJson("pricing", `${this.baseUrl}/prices/${encodeURIComponent(query.variantCode)}?${params}`, { signal });
  }
}
