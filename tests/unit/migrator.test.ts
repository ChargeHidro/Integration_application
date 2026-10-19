import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMigrations } from "../../src/db/migrator";

describe("readMigrations", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "migrations-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the project migrations in order", async () => {
    const migrations = await readMigrations();

    expect(migrations[0]?.id).toBe("001_init");
    expect(migrations[0]?.sql).toContain("CREATE TABLE items");
  });

  it("sorts migrations by number", async () => {
    await writeFile(path.join(dir, "002_second.sql"), "SELECT 2;");
    await writeFile(path.join(dir, "001_first.sql"), "SELECT 1;");

    const migrations = await readMigrations(dir);

    expect(migrations.map((m) => m.id)).toEqual(["001_first", "002_second"]);
  });

  it("rejects badly named files", async () => {
    await writeFile(path.join(dir, "init.sql"), "SELECT 1;");

    await expect(readMigrations(dir)).rejects.toThrow(/Invalid migration file names: init.sql/);
  });

  it("rejects duplicate numbers", async () => {
    await writeFile(path.join(dir, "001_a.sql"), "SELECT 1;");
    await writeFile(path.join(dir, "001_b.sql"), "SELECT 1;");

    await expect(readMigrations(dir)).rejects.toThrow(/Duplicate migration numbers: 001/);
  });
});
