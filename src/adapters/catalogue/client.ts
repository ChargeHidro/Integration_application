import { requestJson } from "../http";

export interface CatalogueClient {
  getVariant(variantCode: string, signal: AbortSignal): Promise<unknown>;
}

export class HttpCatalogueClient implements CatalogueClient {
  constructor(private readonly baseUrl: string) {}

  getVariant(variantCode: string, signal: AbortSignal): Promise<unknown> {
    return requestJson("catalogue", `${this.baseUrl}/variants/${encodeURIComponent(variantCode)}`, { signal });
  }
}
