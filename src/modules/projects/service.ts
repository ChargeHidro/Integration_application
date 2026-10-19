import type { PriceQuote } from "../../adapters/pricing/schema";
import { settleSection } from "../../adapters/settleSection";
import type { SectionResult, SectionStatus, SystemAdapters } from "../../adapters/types";
import type { Caller } from "../../core/auth/caller";
import { canSeePrice } from "../../core/entitlements/entitlements";
import { NotFoundError } from "../../core/errors/errors";
import type { BomLine, BomRepository } from "../../repositories/types";

export interface BomSettings {
  priceTimeoutMs: number;
}

export interface BomLineView {
  itemId: string;
  variantCode: string;
  quantity: number;
}

export interface PricedBomLineView extends BomLineView {
  pricing: SectionStatus;
  unitPrice?: number;
  lineTotal?: number;
  currency?: string;
  leadTimeDays?: number;
  validUntil?: string;
}

export type BomResponse =
  | { projectId: string; name: string; pricing: "not_permitted"; lines: BomLineView[] }
  | {
      projectId: string;
      name: string;
      pricing: "ok" | "partial";
      lines: PricedBomLineView[];
      totals: { currency: string; amount: number }[];
    };

export interface BomDeps {
  bom: BomRepository;
  adapters: Pick<SystemAdapters, "pricing">;
  settings: BomSettings;
}

export class BomService {
  constructor(private readonly deps: BomDeps) {}

  async getBom(caller: Caller, projectId: string): Promise<BomResponse> {
    const project = await this.deps.bom.findProject(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const lines = await this.deps.bom.listLines(projectId);

    if (!canSeePrice(caller)) {
      return { ...project, pricing: "not_permitted", lines: lines.map(toLineView) };
    }

    const prices = await this.fetchPrices(caller, lines);
    const priced = lines.map((line) => toPricedLine(line, prices.get(line.variantCode)));

    return {
      ...project,
      pricing: priced.every((line) => line.pricing === "ok") ? "ok" : "partial",
      lines: priced,
      totals: totalsOf(priced),
    };
  }

  private async fetchPrices(caller: Caller, lines: BomLine[]): Promise<Map<string, SectionResult<PriceQuote>>> {
    const variantCodes = [...new Set(lines.map((line) => line.variantCode))];
    const timeoutMs = this.deps.settings.priceTimeoutMs;
    const results = await Promise.all(
      variantCodes.map((variantCode) =>
        settleSection(
          () =>
            this.deps.adapters.pricing.fetch(
              { variantCode, country: caller.country, customerGroup: caller.customerGroup },
              { timeoutMs },
            ),
          timeoutMs + 100,
        ),
      ),
    );
    return new Map(variantCodes.map((variantCode, index) => [variantCode, results[index]!]));
  }
}

function toLineView(line: BomLine): BomLineView {
  return { itemId: line.itemId, variantCode: line.variantCode, quantity: line.quantity };
}

function toPricedLine(line: BomLine, price: SectionResult<PriceQuote> | undefined): PricedBomLineView {
  if (!price || price.data === null) return { ...toLineView(line), pricing: price?.status ?? "unavailable" };
  const quote = price.data;
  return {
    ...toLineView(line),
    pricing: price.status,
    unitPrice: quote.price,
    lineTotal: roundMoney(quote.price * line.quantity),
    currency: quote.currency,
    leadTimeDays: quote.leadTimeDays,
    validUntil: quote.validUntil,
  };
}

function totalsOf(lines: PricedBomLineView[]): { currency: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.currency === undefined || line.lineTotal === undefined) continue;
    totals.set(line.currency, (totals.get(line.currency) ?? 0) + line.lineTotal);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
