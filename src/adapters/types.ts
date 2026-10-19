import type { CatalogueQuery, CatalogueVariant } from "./catalogue/schema";
import type { PriceQuery, PriceQuote } from "./pricing/schema";
import type { SizingInput, SizingResult } from "./sizing/schema";

export type UnavailableReason =
  | "timeout"
  | "circuit_open"
  | "rate_limited"
  | "invalid_response"
  | "not_found"
  | "upstream_error"
  | "internal_error"
  | "not_applicable";

export type SectionStatus = "ok" | "stale" | "unavailable" | "not_permitted";

export type SectionResult<T> =
  | { status: "ok"; data: T; fetchedAt: string }
  | { status: "stale"; data: T; fetchedAt: string; reason: UnavailableReason }
  | { status: "unavailable"; data: null; reason: UnavailableReason }
  | { status: "not_permitted"; data: null };

export interface FetchOptions {
  timeoutMs: number;
}

export interface Adapter<TQuery, TData> {
  readonly system: string;
  fetch(query: TQuery, options: FetchOptions): Promise<SectionResult<TData>>;
}

export interface SystemAdapters {
  catalogue: Adapter<CatalogueQuery, CatalogueVariant>;
  sizing: Adapter<SizingInput, SizingResult>;
  pricing: Adapter<PriceQuery, PriceQuote>;
}
