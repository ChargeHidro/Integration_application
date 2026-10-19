import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpPricingClient } from "../../src/adapters/pricing/client";
import { HttpSizingClient } from "../../src/adapters/sizing/client";
import { parseRetryAfter, requestJson } from "../../src/adapters/http";
import { SchemaError, TimeoutError, UpstreamError } from "../../src/core/errors/errors";
import { withTimeout } from "../../src/core/resilience/withTimeout";

let server: Server;
let baseUrl: string;
const seen: { method?: string; url?: string; body: string }[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, body });
    if (req.url === "/limited") {
      res.writeHead(429, { "retry-after": "2" });
      return res.end();
    }
    if (req.url === "/broken") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{not json");
    }
    if (req.url === "/slow") return setTimeout(() => res.end("{}"), 500);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const signal = () => new AbortController().signal;

describe("requestJson", () => {
  it("returns parsed JSON", async () => {
    await expect(requestJson("test", `${baseUrl}/ok`, { signal: signal() })).resolves.toEqual({ ok: true });
  });

  it("maps an error status to UpstreamError with Retry-After", async () => {
    const error = await requestJson("pricing", `${baseUrl}/limited`, { signal: signal() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 2000, system: "pricing" });
  });

  it("maps invalid JSON to SchemaError", async () => {
    await expect(requestJson("test", `${baseUrl}/broken`, { signal: signal() })).rejects.toBeInstanceOf(SchemaError);
  });

  it("maps a connection failure to UpstreamError with status 0", async () => {
    await expect(requestJson("test", "http://127.0.0.1:1/x", { signal: signal() })).rejects.toMatchObject({ status: 0 });
  });

  it("surfaces the timeout when the request is aborted", async () => {
    await expect(
      withTimeout((s) => requestJson("test", `${baseUrl}/slow`, { signal: s }), 50, "test call"),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("HTTP clients", () => {
  it("sizing posts the motor data to /size", async () => {
    await new HttpSizingClient(baseUrl).size({ motorKw: 75, voltage: 400 }, signal());

    expect(seen.at(-1)).toEqual({ method: "POST", url: "/size", body: JSON.stringify({ motorKw: 75, voltage: 400 }) });
  });

  it("pricing sends country and customer group", async () => {
    await new HttpPricingClient(baseUrl).getPrice({ variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" }, signal());

    expect(seen.at(-1)?.url).toBe("/prices/ACS-R6-400?country=IN&group=OEM");
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("1")).toBe(1000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
