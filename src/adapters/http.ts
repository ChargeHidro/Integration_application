import type { z } from "zod";
import { SchemaError, UpstreamError } from "../core/errors/errors";

export interface JsonRequest {
  method?: "GET" | "POST";
  body?: unknown;
  signal: AbortSignal;
}

export async function requestJson(system: string, url: string, request: JsonRequest): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason;
    throw new UpstreamError(system, 0, `${system} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError(
      system,
      response.status,
      `${system} responded with ${response.status}`,
      parseRetryAfter(response.headers.get("retry-after")),
    );
  }

  try {
    return await response.json();
  } catch {
    if (request.signal.aborted) throw request.signal.reason;
    throw new SchemaError(system, ["response body is not valid JSON"]);
  }
}

export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function parseVendorResponse<T>(system: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new SchemaError(
      system,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}
