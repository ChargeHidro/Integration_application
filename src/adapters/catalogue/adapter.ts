import { parseVendorResponse } from "../http";
import { resilientFetch, type ResilienceDeps } from "../resilientFetch";
import type { Adapter, FetchOptions, SectionResult } from "../types";
import type { CatalogueClient } from "./client";
import { catalogueVariantSchema, type CatalogueQuery, type CatalogueVariant } from "./schema";

export type CatalogueAdapterDeps = Omit<ResilienceDeps, "system"> & { client: CatalogueClient };

export class CatalogueAdapter implements Adapter<CatalogueQuery, CatalogueVariant> {
  readonly system = "catalogue";

  constructor(private readonly deps: CatalogueAdapterDeps) {}

  fetch(query: CatalogueQuery, options: FetchOptions): Promise<SectionResult<CatalogueVariant>> {
    return resilientFetch(
      { ...this.deps, system: this.system },
      {
        timeoutMs: options.timeoutMs,
        call: async (signal) =>
          parseVendorResponse(
            this.system,
            catalogueVariantSchema,
            await this.deps.client.getVariant(query.variantCode, signal),
          ),
      },
    );
  }
}
