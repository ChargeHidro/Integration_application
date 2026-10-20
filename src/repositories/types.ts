import type { CatalogueQuery, CatalogueVariant } from "../adapters/catalogue/schema";
import type { PriceQuery, PriceQuote } from "../adapters/pricing/schema";
import type { SizingResult } from "../adapters/sizing/schema";

export interface Position {
  x: number;
  y: number;
  rotation: number;
}

export interface MotorInput {
  motorKw: number;
  voltage: number;
}

export interface Item {
  itemId: string;
  projectId: string;
  kind: string;
  variantCode: string;
  modelRef: string;
  position: Position;
  motorInput: MotorInput | null;
  version: number;
  updatedAt: string;
}

export interface Project {
  projectId: string;
  name: string;
}

export interface BomLine {
  bomLineId: string;
  projectId: string;
  itemId: string;
  variantCode: string;
  quantity: number;
}

export interface ResizeChange {
  itemId: string;
  expectedVersion: number;
  variantCode: string;
  modelRef: string;
  motorInput: MotorInput;
}

export interface ResizeOutcome {
  item: Item;
  previousLine: BomLine;
  currentLine: BomLine;
}

export interface ItemRepository {
  findById(itemId: string): Promise<Item | null>;
  applyResize(change: ResizeChange): Promise<ResizeOutcome>;
}

export interface BomRepository {
  findProject(projectId: string): Promise<Project | null>;
  listLines(projectId: string): Promise<BomLine[]>;
}

export interface Stored<T> {
  value: T;
  fetchedAt: string;
}

export interface SnapshotRepository<K, T> {
  get(key: K): Promise<Stored<T> | null>;
  put(key: K, value: T, fetchedAt: string): Promise<void>;
}

export interface SizingKey {
  inputHash: string;
  apiVersion: string;
}

export type CatalogueVariantRepository = SnapshotRepository<CatalogueQuery, CatalogueVariant>;
export type SizingResultRepository = SnapshotRepository<SizingKey, SizingResult>;
export type PriceSnapshotRepository = SnapshotRepository<PriceQuery, PriceQuote>;

export interface SnapshotRepositories {
  catalogueVariants: CatalogueVariantRepository;
  sizingResults: SizingResultRepository;
  priceSnapshots: PriceSnapshotRepository;
}

export interface Repositories extends SnapshotRepositories {
  items: ItemRepository;
  bom: BomRepository;
}
