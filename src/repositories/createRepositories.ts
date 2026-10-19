import type { Config } from "../config/env";
import { createPool } from "../db/pool";
import { createMemoryRepositories } from "./memory/memoryRepositories";
import { createPostgresRepositories } from "./postgres/postgresRepositories";
import type { Repositories } from "./types";

export interface RepositoryHandle {
  repositories: Repositories;
  close(): Promise<void>;
}

export function createRepositories(config: Pick<Config, "repository" | "databaseUrl">): RepositoryHandle {
  if (config.repository === "memory") {
    return { repositories: createMemoryRepositories(), close: async () => {} };
  }
  const pool = createPool(config.databaseUrl);
  return { repositories: createPostgresRepositories(pool), close: () => pool.end() };
}
