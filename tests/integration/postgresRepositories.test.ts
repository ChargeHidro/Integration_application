import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe } from "vitest";
import { readMigrations, runMigrations } from "../../src/db/migrator";
import { createPool, type Pool } from "../../src/db/pool";
import { sampleProject } from "../../src/db/sampleProject";
import { seedProject } from "../../src/db/seeder";
import { createPostgresRepositories } from "../../src/repositories/postgres/postgresRepositories";
import { describeRepositoryContract } from "../support/repositoryContract";

const adminUrl = process.env.DATABASE_URL ?? "postgres://cloudworx:cloudworx@localhost:55432/cloudworx";
const testDatabase = `cloudworx_test_${randomUUID().replaceAll("-", "")}`;

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 2000 });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const postgresAvailable = await admin(async () => true).catch(() => false);

let pool: Pool | undefined;

if (postgresAvailable) {
  await admin((client) => client.query(`CREATE DATABASE ${testDatabase}`));
  const url = new URL(adminUrl);
  url.pathname = `/${testDatabase}`;
  pool = createPool(url.toString());
  await runMigrations(pool, await readMigrations());
}

describe.runIf(postgresAvailable)("postgres (needs docker compose postgres)", () => {
  afterAll(async () => {
    await pool?.end();
    await admin((client) => client.query(`DROP DATABASE IF EXISTS ${testDatabase}`));
  });

  describeRepositoryContract("postgres", async () => {
    if (!pool) throw new Error("pool not initialised");
    await seedProject(pool, sampleProject);
    return createPostgresRepositories(pool);
  });
});
