import { withTransaction, type Pool } from "./pool";
import type { SampleProject } from "./sampleProject";

export async function seedProject(pool: Pool, project: SampleProject): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO projects (project_id, name) VALUES ($1, $2)
       ON CONFLICT (project_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [project.projectId, project.name],
    );

    for (const item of project.items) {
      await client.query(
        `INSERT INTO items (item_id, project_id, kind, variant_code, model_ref, position, motor_input, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
         ON CONFLICT (item_id) DO UPDATE SET
           project_id = EXCLUDED.project_id,
           kind = EXCLUDED.kind,
           variant_code = EXCLUDED.variant_code,
           model_ref = EXCLUDED.model_ref,
           position = EXCLUDED.position,
           motor_input = EXCLUDED.motor_input,
           version = 1,
           updated_at = now()`,
        [
          item.itemId,
          project.projectId,
          item.kind,
          item.variantCode,
          item.modelRef,
          JSON.stringify(item.position),
          item.motorInput === null ? null : JSON.stringify(item.motorInput),
        ],
      );

      await client.query(
        `INSERT INTO bom_lines (project_id, item_id, variant_code, quantity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id) DO UPDATE SET
           project_id = EXCLUDED.project_id,
           variant_code = EXCLUDED.variant_code,
           quantity = EXCLUDED.quantity`,
        [project.projectId, item.itemId, item.variantCode, item.quantity],
      );
    }
  });
}
