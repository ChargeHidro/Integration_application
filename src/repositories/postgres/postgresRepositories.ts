import type { CatalogueQuery, CatalogueVariant } from "../../adapters/catalogue/schema";
import type { PriceQuery, PriceQuote } from "../../adapters/pricing/schema";
import type { SizingResult } from "../../adapters/sizing/schema";
import { ConflictError, NotFoundError } from "../../core/errors/errors";
import { withTransaction, type Pool } from "../../db/pool";
import type {
  BomLine,
  BomRepository,
  CatalogueVariantRepository,
  Item,
  ItemRepository,
  MotorInput,
  Position,
  PriceSnapshotRepository,
  Project,
  Repositories,
  ResizeChange,
  ResizeOutcome,
  SizingKey,
  SizingResultRepository,
  Stored,
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
  return {
    items: new PostgresItemRepository(pool),
    bom: new PostgresBomRepository(pool),
    catalogueVariants: new PostgresCatalogueVariantRepository(pool),
    sizingResults: new PostgresSizingResultRepository(pool),
    priceSnapshots: new PostgresPriceSnapshotRepository(pool),
  };
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

interface JsonSnapshotRow<T> {
  data: T;
  fetched_at: Date;
}

class PostgresCatalogueVariantRepository implements CatalogueVariantRepository {
  constructor(private readonly pool: Pool) {}

  async get(query: CatalogueQuery): Promise<Stored<CatalogueVariant> | null> {
    const { rows } = await this.pool.query<JsonSnapshotRow<CatalogueVariant>>(
      "SELECT data, fetched_at FROM catalogue_variants WHERE variant_code = $1",
      [query.variantCode],
    );
    return rows[0] ? { value: rows[0].data, fetchedAt: rows[0].fetched_at.toISOString() } : null;
  }

  async put(query: CatalogueQuery, value: CatalogueVariant, fetchedAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO catalogue_variants (variant_code, data, fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT (variant_code) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
       WHERE catalogue_variants.fetched_at <= EXCLUDED.fetched_at`,
      [query.variantCode, JSON.stringify(value), fetchedAt],
    );
  }
}

class PostgresSizingResultRepository implements SizingResultRepository {
  constructor(private readonly pool: Pool) {}

  async get(key: SizingKey): Promise<Stored<SizingResult> | null> {
    const { rows } = await this.pool.query<JsonSnapshotRow<SizingResult>>(
      "SELECT data, fetched_at FROM sizing_results WHERE input_hash = $1 AND api_version = $2",
      [key.inputHash, key.apiVersion],
    );
    return rows[0] ? { value: rows[0].data, fetchedAt: rows[0].fetched_at.toISOString() } : null;
  }

  async put(key: SizingKey, value: SizingResult, fetchedAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sizing_results (input_hash, api_version, variant_code, load_pct, data, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (input_hash, api_version) DO UPDATE SET
         variant_code = EXCLUDED.variant_code,
         load_pct = EXCLUDED.load_pct,
         data = EXCLUDED.data,
         fetched_at = EXCLUDED.fetched_at
       WHERE sizing_results.fetched_at <= EXCLUDED.fetched_at`,
      [key.inputHash, key.apiVersion, value.variantCode, value.loadPct, JSON.stringify(value), fetchedAt],
    );
  }
}

interface PriceSnapshotRow {
  variant_code: string;
  country: string;
  currency: string;
  amount: string;
  lead_time_days: number;
  valid_until: Date;
  fetched_at: Date;
}

class PostgresPriceSnapshotRepository implements PriceSnapshotRepository {
  constructor(private readonly pool: Pool) {}

  async get(query: PriceQuery): Promise<Stored<PriceQuote> | null> {
    const { rows } = await this.pool.query<PriceSnapshotRow>(
      `SELECT variant_code, country, currency, amount, lead_time_days, valid_until, fetched_at
       FROM price_snapshots WHERE variant_code = $1 AND country = $2 AND customer_group = $3`,
      [query.variantCode, query.country, query.customerGroup],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      value: {
        variantCode: row.variant_code,
        country: row.country,
        currency: row.currency,
        price: Number(row.amount),
        leadTimeDays: row.lead_time_days,
        validUntil: row.valid_until.toISOString(),
      },
      fetchedAt: row.fetched_at.toISOString(),
    };
  }

  async put(query: PriceQuery, value: PriceQuote, fetchedAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO price_snapshots
         (variant_code, country, customer_group, amount, currency, lead_time_days, valid_until, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (variant_code, country, customer_group) DO UPDATE SET
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         lead_time_days = EXCLUDED.lead_time_days,
         valid_until = EXCLUDED.valid_until,
         fetched_at = EXCLUDED.fetched_at
       WHERE price_snapshots.fetched_at <= EXCLUDED.fetched_at`,
      [
        query.variantCode,
        query.country,
        query.customerGroup,
        value.price,
        value.currency,
        value.leadTimeDays,
        value.validUntil,
        fetchedAt,
      ],
    );
  }
}
