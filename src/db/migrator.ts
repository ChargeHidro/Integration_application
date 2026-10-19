import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTransaction, type Pool } from "./pool";

export interface Migration {
  id: string;
  sql: string;
}

const fileNamePattern = /^(\d{3})_[a-z0-9_]+\.sql$/;

export const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));

export async function readMigrations(dir: string = migrationsDir): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();

  const invalid = files.filter((file) => !fileNamePattern.test(file));
  if (invalid.length > 0) throw new Error(`Invalid migration file names: ${invalid.join(", ")}`);

  const prefixes = files.map((file) => file.slice(0, 3));
  const duplicates = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index);
  if (duplicates.length > 0) throw new Error(`Duplicate migration numbers: ${[...new Set(duplicates)].join(", ")}`);

  return Promise.all(
    files.map(async (file) => ({
      id: file.replace(/\.sql$/, ""),
      sql: await readFile(path.join(dir, file), "utf8"),
    })),
  );
}

export async function runMigrations(pool: Pool, migrations: Migration[]): Promise<string[]> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.id));

  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await withTransaction(pool, async (client) => {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    });
    ran.push(migration.id);
  }
  return ran;
}
