import { loadConfig } from "../config/env";
import { createPool } from "./pool";
import { sampleProject } from "./sampleProject";
import { seedProject } from "./seeder";

const pool = createPool(loadConfig().databaseUrl);

try {
  await seedProject(pool, sampleProject);
  console.log(`Seeded project ${sampleProject.projectId} with ${sampleProject.items.length} items`);
} finally {
  await pool.end();
}
