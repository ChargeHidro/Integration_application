import { ConflictError, NotFoundError } from "../../core/errors/errors";
import { sampleProject, type SampleProject } from "../../db/sampleProject";
import type {
  BomLine,
  BomRepository,
  Item,
  ItemRepository,
  Project,
  Repositories,
  ResizeChange,
  ResizeOutcome,
} from "../types";

interface MemoryState {
  projects: Map<string, Project>;
  items: Map<string, Item>;
  lines: Map<string, BomLine>;
}

export function createMemoryRepositories(projects: SampleProject[] = [sampleProject]): Repositories {
  const state: MemoryState = { projects: new Map(), items: new Map(), lines: new Map() };
  let nextLineId = 1;
  const seededAt = new Date().toISOString();

  for (const project of projects) {
    state.projects.set(project.projectId, { projectId: project.projectId, name: project.name });
    for (const item of project.items) {
      state.items.set(item.itemId, {
        itemId: item.itemId,
        projectId: project.projectId,
        kind: item.kind,
        variantCode: item.variantCode,
        modelRef: item.modelRef,
        position: { ...item.position },
        motorInput: item.motorInput ? { ...item.motorInput } : null,
        version: 1,
        updatedAt: seededAt,
      });
      state.lines.set(item.itemId, {
        bomLineId: String(nextLineId++),
        projectId: project.projectId,
        itemId: item.itemId,
        variantCode: item.variantCode,
        quantity: item.quantity,
      });
    }
  }

  return { items: new MemoryItemRepository(state), bom: new MemoryBomRepository(state) };
}

class MemoryItemRepository implements ItemRepository {
  constructor(private readonly state: MemoryState) {}

  async findById(itemId: string): Promise<Item | null> {
    const item = this.state.items.get(itemId);
    return item ? structuredClone(item) : null;
  }

  async applyResize(change: ResizeChange): Promise<ResizeOutcome> {
    const item = this.state.items.get(change.itemId);
    if (!item) throw new NotFoundError(`Item ${change.itemId} not found`);
    if (item.version !== change.expectedVersion) throw new ConflictError(`Item ${change.itemId} was changed by another request`);
    const line = this.state.lines.get(change.itemId);
    if (!line) throw new NotFoundError(`Item ${change.itemId} has no BOM line`);

    const updatedItem: Item = {
      ...item,
      variantCode: change.variantCode,
      modelRef: change.modelRef,
      motorInput: { ...change.motorInput },
      version: item.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const updatedLine: BomLine = { ...line, variantCode: change.variantCode };
    this.state.items.set(change.itemId, updatedItem);
    this.state.lines.set(change.itemId, updatedLine);

    return { item: structuredClone(updatedItem), previousLine: { ...line }, currentLine: { ...updatedLine } };
  }
}

class MemoryBomRepository implements BomRepository {
  constructor(private readonly state: MemoryState) {}

  async findProject(projectId: string): Promise<Project | null> {
    const project = this.state.projects.get(projectId);
    return project ? { ...project } : null;
  }

  async listLines(projectId: string): Promise<BomLine[]> {
    return [...this.state.lines.values()]
      .filter((line) => line.projectId === projectId)
      .sort((a, b) => a.itemId.localeCompare(b.itemId))
      .map((line) => ({ ...line }));
  }
}
