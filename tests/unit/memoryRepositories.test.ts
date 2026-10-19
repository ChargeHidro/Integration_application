import { createMemoryRepositories } from "../../src/repositories/memory/memoryRepositories";
import { describeRepositoryContract } from "../support/repositoryContract";

describeRepositoryContract("memory", async () => createMemoryRepositories());
