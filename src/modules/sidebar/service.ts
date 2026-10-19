import type { CatalogueVariant } from "../../adapters/catalogue/schema";
import type { PriceQuote } from "../../adapters/pricing/schema";
import { settleSection } from "../../adapters/settleSection";
import type { SizingResult } from "../../adapters/sizing/schema";
import type { SectionResult, SystemAdapters } from "../../adapters/types";
import type { Caller } from "../../core/auth/caller";
import { canSeePrice } from "../../core/entitlements/entitlements";
import { NotFoundError } from "../../core/errors/errors";
import type { ItemRepository } from "../../repositories/types";

export interface SidebarSettings {
  budgetMs: number;
  sectionTimeoutMs: number;
}

export interface SidebarResponse {
  itemId: string;
  variantCode: string;
  sections: {
    catalogue: SectionResult<CatalogueVariant>;
    sizing: SectionResult<SizingResult>;
    pricing: SectionResult<PriceQuote>;
  };
}

export interface SidebarDeps {
  items: ItemRepository;
  adapters: SystemAdapters;
  settings: SidebarSettings;
  now?: () => number;
}

const budgetMarginMs = 50;

export class SidebarService {
  private readonly now: () => number;

  constructor(private readonly deps: SidebarDeps) {
    this.now = deps.now ?? Date.now;
  }

  async getSidebar(caller: Caller, itemId: string): Promise<SidebarResponse> {
    const deadline = this.now() + this.deps.settings.budgetMs - budgetMarginMs;
    const item = await this.deps.items.findById(itemId);
    if (!item) throw new NotFoundError(`Item ${itemId} not found`);

    const { adapters } = this.deps;
    const options = { timeoutMs: this.deps.settings.sectionTimeoutMs };
    const remaining = () => deadline - this.now();
    const motorInput = item.motorInput;

    const [catalogue, sizing, pricing] = await Promise.all([
      settleSection(() => adapters.catalogue.fetch({ variantCode: item.variantCode }, options), remaining()),
      motorInput
        ? settleSection(() => adapters.sizing.fetch(motorInput, options), remaining())
        : Promise.resolve<SectionResult<SizingResult>>({ status: "unavailable", data: null, reason: "not_applicable" }),
      canSeePrice(caller)
        ? settleSection(
            () =>
              adapters.pricing.fetch(
                { variantCode: item.variantCode, country: caller.country, customerGroup: caller.customerGroup },
                options,
              ),
            remaining(),
          )
        : Promise.resolve<SectionResult<PriceQuote>>({ status: "not_permitted", data: null }),
    ]);

    return { itemId: item.itemId, variantCode: item.variantCode, sections: { catalogue, sizing, pricing } };
  }
}
