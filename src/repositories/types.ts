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

export interface Repositories {
  items: ItemRepository;
  bom: BomRepository;
}
