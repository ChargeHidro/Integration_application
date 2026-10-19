import { ConflictError, NotFoundError } from "../../core/errors/errors";
import { withTransaction, type Pool } from "../../db/pool";
import type {
  BomLine,
  BomRepository,
  Item,
  ItemRepository,
  MotorInput,
  Position,
  Project,
  Repositories,
  ResizeChange,
  ResizeOutcome,
} from "../types";

interface ItemRow {
  item_id: string;
  project_id: string;
  kind: string;
  variant_code: string;
  model_ref: string;
  position: Position;
  motor_input: MotorInput | null;
  version: number;
  updated_at: Date;
}

interface BomLineRow {
  bom_line_id: string;
  project_id: string;
  item_id: string;
  variant_code: string;
  quantity: number;
}

const itemColumns = "item_id, project_id, kind, variant_code, model_ref, position, motor_input, version, updated_at";
const lineColumns = "bom_line_id, project_id, item_id, variant_code, quantity";

function toItem(row: ItemRow): Item {
  return {
    itemId: row.item_id,
    projectId: row.project_id,
    kind: row.kind,
    variantCode: row.variant_code,
    modelRef: row.model_ref,
    position: row.position,
    motorInput: row.motor_input,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toBomLine(row: BomLineRow): BomLine {
  return {
    bomLineId: String(row.bom_line_id),
    projectId: row.project_id,
    itemId: row.item_id,
    variantCode: row.variant_code,
    quantity: row.quantity,
  };
}

export function createPostgresRepositories(pool: Pool): Repositories {
  return { items: new PostgresItemRepository(pool), bom: new PostgresBomRepository(pool) };
}

class PostgresItemRepository implements ItemRepository {
  constructor(private readonly pool: Pool) {}

  async findById(itemId: string): Promise<Item | null> {
    const { rows } = await this.pool.query<ItemRow>(`SELECT ${itemColumns} FROM items WHERE item_id = $1`, [itemId]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  applyResize(change: ResizeChange): Promise<ResizeOutcome> {
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query<ItemRow>(
        `UPDATE items
         SET variant_code = $2, model_ref = $3, motor_input = $4, version = version + 1, updated_at = now()
         WHERE item_id = $1 AND version = $5
         RETURNING ${itemColumns}`,
        [change.itemId, change.variantCode, change.modelRef, JSON.stringify(change.motorInput), change.expectedVersion],
      );
      const itemRow = updated.rows[0];
      if (!itemRow) {
        const exists = await client.query("SELECT 1 FROM items WHERE item_id = $1", [change.itemId]);
        if (exists.rowCount === 0) throw new NotFoundError(`Item ${change.itemId} not found`);
        throw new ConflictError(`Item ${change.itemId} was changed by another request`);
      }

      const previous = await client.query<BomLineRow>(
        `SELECT ${lineColumns} FROM bom_lines WHERE item_id = $1 FOR UPDATE`,
        [change.itemId],
      );
      const previousRow = previous.rows[0];
      if (!previousRow) throw new NotFoundError(`Item ${change.itemId} has no BOM line`);

      const current = await client.query<BomLineRow>(
        `UPDATE bom_lines SET variant_code = $2 WHERE item_id = $1 RETURNING ${lineColumns}`,
        [change.itemId, change.variantCode],
      );
      const currentRow = current.rows[0];
      if (!currentRow) throw new NotFoundError(`Item ${change.itemId} has no BOM line`);

      return { item: toItem(itemRow), previousLine: toBomLine(previousRow), currentLine: toBomLine(currentRow) };
    });
  }
}

class PostgresBomRepository implements BomRepository {
  constructor(private readonly pool: Pool) {}

  async findProject(projectId: string): Promise<Project | null> {
    const { rows } = await this.pool.query<{ project_id: string; name: string }>(
      "SELECT project_id, name FROM projects WHERE project_id = $1",
      [projectId],
    );
    return rows[0] ? { projectId: rows[0].project_id, name: rows[0].name } : null;
  }

  async listLines(projectId: string): Promise<BomLine[]> {
    const { rows } = await this.pool.query<BomLineRow>(
      `SELECT ${lineColumns} FROM bom_lines WHERE project_id = $1 ORDER BY item_id`,
      [projectId],
    );
    return rows.map(toBomLine);
  }
}
