import { requestJson } from "../http";
import type { SizingInput } from "./schema";

export interface SizingClient {
  size(input: SizingInput, signal: AbortSignal): Promise<unknown>;
}

export class HttpSizingClient implements SizingClient {
  constructor(private readonly baseUrl: string) {}

  size(input: SizingInput, signal: AbortSignal): Promise<unknown> {
    return requestJson("sizing", `${this.baseUrl}/size`, { method: "POST", body: input, signal });
  }
}
