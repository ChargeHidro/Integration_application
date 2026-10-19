import { loadConfig } from "../config/env";
import { readMigrations, runMigrations } from "./migrator";
import { createPool } from "./pool";

const pool = createPool(loadConfig().databaseUrl);

try {
  const ran = await runMigrations(pool, await readMigrations());
  console.log(ran.length > 0 ? `Applied migrations: ${ran.join(", ")}` : "Database is up to date");
} finally {
  await pool.end();
}
