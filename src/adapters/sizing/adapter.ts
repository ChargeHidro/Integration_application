import { parseVendorResponse } from "../http";
import { resilientFetch, type ResilienceDeps } from "../resilientFetch";
import type { Adapter, FetchOptions, SectionResult } from "../types";
import type { SizingClient } from "./client";
import { sizingResultSchema, type SizingInput, type SizingResult } from "./schema";

export type SizingAdapterDeps = Omit<ResilienceDeps, "system"> & { client: SizingClient };

export class SizingAdapter implements Adapter<SizingInput, SizingResult> {
  readonly system = "sizing";

  constructor(private readonly deps: SizingAdapterDeps) {}

  fetch(input: SizingInput, options: FetchOptions): Promise<SectionResult<SizingResult>> {
    return resilientFetch(
      { ...this.deps, system: this.system },
      {
        timeoutMs: options.timeoutMs,
        call: async (signal) =>
          parseVendorResponse(this.system, sizingResultSchema, await this.deps.client.size(input, signal)),
      },
    );
  }
}
