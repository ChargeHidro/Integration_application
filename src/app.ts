import express, { type Express } from "express";
import type { SystemAdapters } from "./adapters/types";
import type { Config } from "./config/env";
import { authenticate } from "./core/auth/middleware";
import { errorHandler, notFoundHandler } from "./core/errors/errorHandler";
import { requestContext } from "./core/http/requestContext";
import { requestLogger } from "./core/http/requestLogger";
import type { Logger } from "./core/logger";
import { itemsRouter } from "./modules/items/routes";
import { ResizeService } from "./modules/items/service";
import { projectsRouter } from "./modules/projects/routes";
import { BomService } from "./modules/projects/service";
import { sidebarRouter } from "./modules/sidebar/routes";
import { SidebarService } from "./modules/sidebar/service";
import type { Repositories } from "./repositories/types";

export interface AppDeps {
  config: Pick<Config, "auth" | "timeouts">;
  logger: Logger;
  repositories: Repositories;
  sources: SystemAdapters;
}

export function createApp({ config, logger, repositories, sources }: AppDeps): Express {
  const { timeouts } = config;
  const app = express();

  app.disable("x-powered-by");
  app.use(requestContext(logger));
  app.use(requestLogger());
  app.use(express.json({ limit: "16kb" }));
  app.use(authenticate(config.auth));

  app.use(
    sidebarRouter(
      new SidebarService({
        items: repositories.items,
        adapters: sources,
        settings: { budgetMs: timeouts.sidebarBudgetMs, sectionTimeoutMs: timeouts.sectionMs },
      }),
    ),
  );
  app.use(
    itemsRouter(
      new ResizeService({
        items: repositories.items,
        adapters: sources,
        settings: { sizingTimeoutMs: timeouts.resizeMs, catalogueTimeoutMs: timeouts.sectionMs },
      }),
    ),
  );
  app.use(
    projectsRouter(
      new BomService({ bom: repositories.bom, adapters: sources, settings: { priceTimeoutMs: timeouts.sectionMs } }),
    ),
  );

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
