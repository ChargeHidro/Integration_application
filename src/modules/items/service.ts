import path from "node:path";
import type { SizingInput } from "../../adapters/sizing/schema";
import type { SystemAdapters } from "../../adapters/types";
import { NotFoundError, ServiceUnavailableError, ValidationError } from "../../core/errors/errors";
import type { BomLine, ItemRepository } from "../../repositories/types";

export interface ResizeSettings {
  sizingTimeoutMs: number;
  catalogueTimeoutMs: number;
}

export interface VariantRef {
  variantCode: string;
  modelRef: string;
}

export interface BomLineRef {
  bomLineId: string;
  variantCode: string;
  quantity: number;
}

export interface ResizeResponse {
  itemId: string;
  changed: boolean;
  previous: VariantRef;
  current: VariantRef;
  bomChange: { removed: BomLineRef; added: BomLineRef } | null;
}

export interface ResizeDeps {
  items: ItemRepository;
  adapters: Pick<SystemAdapters, "sizing" | "catalogue">;
  settings: ResizeSettings;
}

const resizableKinds = new Set(["drive"]);

export class ResizeService {
  constructor(private readonly deps: ResizeDeps) {}

  async resize(itemId: string, input: SizingInput): Promise<ResizeResponse> {
    const item = await this.deps.items.findById(itemId);
    if (!item) throw new NotFoundError(`Item ${itemId} not found`);
    if (!resizableKinds.has(item.kind)) throw new ValidationError(`Item ${itemId} is a ${item.kind} and cannot be re-sized`);

    const sizing = await this.deps.adapters.sizing.fetch(input, { timeoutMs: this.deps.settings.sizingTimeoutMs });
    if (sizing.data === null) {
      throw new ServiceUnavailableError("Sizing is unavailable right now; the item was not changed");
    }

    const previous: VariantRef = { variantCode: item.variantCode, modelRef: item.modelRef };
    const variantCode = sizing.data.variantCode;
    if (variantCode === item.variantCode) {
      return { itemId, changed: false, previous, current: previous, bomChange: null };
    }

    const variant = await this.deps.adapters.catalogue.fetch(
      { variantCode },
      { timeoutMs: this.deps.settings.catalogueTimeoutMs },
    );
    if (variant.data === null) {
      throw new ServiceUnavailableError(`Catalogue data for ${variantCode} is unavailable; the item was not changed`);
    }

    const outcome = await this.deps.items.applyResize({
      itemId,
      expectedVersion: item.version,
      variantCode,
      modelRef: path.posix.dirname(variant.data.model3d.lod0),
      motorInput: input,
    });

    return {
      itemId,
      changed: true,
      previous,
      current: { variantCode: outcome.item.variantCode, modelRef: outcome.item.modelRef },
      bomChange: { removed: toLineRef(outcome.previousLine), added: toLineRef(outcome.currentLine) },
    };
  }
}

function toLineRef(line: BomLine): BomLineRef {
  return { bomLineId: line.bomLineId, variantCode: line.variantCode, quantity: line.quantity };
}
