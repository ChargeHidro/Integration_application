import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// Three mock enterprise systems. Each runs as its own HTTP server, so the service talks to
// them over the network exactly as it would to the real ones. Behaviour is configurable
// (and changeable at runtime) so tests can make them slow, flaky or down.

export interface SizingMockOptions { minDelayMs: number; maxDelayMs: number; failRate: number; random: () => number }
export interface PricingMockOptions { perSecond: number; down: boolean; delayMs: number }
export interface CatalogueMockOptions { down: boolean; delayMs: number }

export interface Mocks {
  urls: { catalogue: string; sizing: string; pricing: string };
  catalogue: CatalogueMockOptions & { requests: number };
  sizing: SizingMockOptions & { requests: number };
  pricing: PricingMockOptions & { requests: number };
  close(): Promise<void>;
}

const variants: any[] = JSON.parse(readFileSync(new URL("../../data/catalogue.json", import.meta.url), "utf8"));

// --- sizing rules: smallest frame that runs the motor at <= 90 % load -----------------
const FRAMES = [
  { frame: "R6", ratedKw: 60 },
  { frame: "R7", ratedKw: 85 },
  { frame: "R8", ratedKw: 120 },
  { frame: "R9", ratedKw: 170 },
];

// --- prices: base price per variant x country factor ----------------------------------
const BASE_EUR: Record<string, number> = {
  "ACS-R6-400": 6200, "ACS-R7-400": 8400, "ACS-R8-400": 11900, "ACS-R9-400": 16800,
  "CAB-STD-800": 2400, "PNL-SAFETY-1": 950,
};
const LEAD_TIME_DAYS: Record<string, number> = {
  "ACS-R6-400": 21, "ACS-R7-400": 28, "ACS-R8-400": 98, "ACS-R9-400": 70, "CAB-STD-800": 14, "PNL-SAFETY-1": 7,
};
const COUNTRIES: Record<string, { currency: string; factor: number }> = {
  IN: { currency: "INR", factor: 92 }, DE: { currency: "EUR", factor: 1 }, US: { currency: "USD", factor: 1.08 },
  GB: { currency: "GBP", factor: 0.86 },
};
const GROUP_DISCOUNT: Record<string, number> = { OEM: 0.9, DISTRIBUTOR: 0.85, END_USER: 1 };

export async function startMocks(opts: {
  sizing?: Partial<SizingMockOptions>;
  pricing?: Partial<PricingMockOptions>;
  catalogue?: Partial<CatalogueMockOptions>;
  ports?: { catalogue?: number; sizing?: number; pricing?: number };
} = {}): Promise<Mocks> {
  const catalogue = { down: false, delayMs: 0, requests: 0, ...opts.catalogue };
  const sizing = { minDelayMs: 500, maxDelayMs: 3000, failRate: 0.2, random: Math.random, requests: 0, ...opts.sizing };
  const pricing = { perSecond: 5, down: false, delayMs: 0, requests: 0, ...opts.pricing };

  const catalogueServer = serve(async (req, res) => {
    catalogue.requests++;
    await wait(catalogue.delayMs);
    if (catalogue.down) return send(res, 503, { error: "unavailable" });
    const m = /^\/variants\/([^/?]+)$/.exec(req.url ?? "");
    const v = m && variants.find((x) => x.code === decodeURIComponent(m[1]!));
    return v ? send(res, 200, v) : send(res, 404, { error: "unknown variant" });
  });

  const sizingServer = serve(async (req, res) => {
    sizing.requests++;
    if (req.method !== "POST" || req.url !== "/v1/size") return send(res, 404, { error: "not found" });
    const body = JSON.parse(await readBody(req) || "{}");
    await wait(sizing.minDelayMs + sizing.random() * (sizing.maxDelayMs - sizing.minDelayMs));
    if (sizing.random() < sizing.failRate) return send(res, 500, { error: "sizing engine error" });
    if (typeof body.motorKw !== "number" || body.motorKw <= 0) return send(res, 400, { error: "motorKw required" });
    const pick = FRAMES.find((f) => body.motorKw <= f.ratedKw * 0.9);
    if (!pick) return send(res, 422, { error: "no frame large enough" });
    return send(res, 200, {
      recommendedVariant: `ACS-${pick.frame}-${body.voltage ?? 400}`,
      frame: pick.frame,
      loadPct: Math.round((body.motorKw / pick.ratedKw) * 100),
    });
  });

  let tokens = pricing.perSecond;
  let last = Date.now();
  const pricingServer = serve(async (req, res) => {
    pricing.requests++;
    const now = Date.now();
    tokens = Math.min(pricing.perSecond, tokens + ((now - last) / 1000) * pricing.perSecond);
    last = now;
    if (tokens < 1) {
      res.setHeader("retry-after", "1");
      return send(res, 429, { error: "rate limit exceeded" });
    }
    tokens -= 1;
    await wait(pricing.delayMs);
    if (pricing.down) return send(res, 503, { error: "ERP unavailable" });
    const url = new URL(req.url ?? "/", "http://x");
    const m = /^\/prices\/([^/]+)$/.exec(url.pathname);
    const code = m ? decodeURIComponent(m[1]!) : "";
    const country = COUNTRIES[url.searchParams.get("country") ?? ""];
    if (!(code in BASE_EUR) || !country) return send(res, 404, { error: "no price for this variant/country" });
    const discount = GROUP_DISCOUNT[url.searchParams.get("group") ?? ""] ?? 1;
    const quotedAt = new Date();
    return send(res, 200, {
      variantCode: code,
      country: url.searchParams.get("country"),
      currency: country.currency,
      unitPrice: Math.round(BASE_EUR[code]! * country.factor * discount * 100) / 100,
      leadTimeDays: LEAD_TIME_DAYS[code],
      quotedAt: quotedAt.toISOString(),
      validUntil: new Date(quotedAt.getTime() + 24 * 3600 * 1000).toISOString(),
    });
  });

  const ports = opts.ports ?? {};
  const [c, s, p] = await Promise.all([
    listen(catalogueServer, ports.catalogue ?? 0),
    listen(sizingServer, ports.sizing ?? 0),
    listen(pricingServer, ports.pricing ?? 0),
  ]);

  return {
    urls: { catalogue: `http://127.0.0.1:${c}`, sizing: `http://127.0.0.1:${s}`, pricing: `http://127.0.0.1:${p}` },
    catalogue, sizing, pricing,
    close: async () => {
      for (const srv of [catalogueServer, sizingServer, pricingServer]) srv.closeAllConnections();
      await Promise.all([catalogueServer, sizingServer, pricingServer].map((srv) => new Promise((r) => srv.close(r))));
    },
  };
}

function serve(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): Server {
  return createServer((req, res) => {
    handler(req, res).catch(() => send(res, 500, { error: "mock failure" }));
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}
