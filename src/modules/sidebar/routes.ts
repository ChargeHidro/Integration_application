import { Router } from "express";
import { callerOf } from "../../core/auth/middleware";
import { asyncHandler } from "../../core/http/asyncHandler";
import { idSchema, parseWith } from "../../core/http/validate";
import type { SidebarService } from "./service";

export function sidebarRouter(service: SidebarService): Router {
  const router = Router();

  router.get(
    "/items/:itemId/sidebar",
    asyncHandler(async (req, res) => {
      const itemId = parseWith(idSchema, req.params.itemId, "Invalid item id");
      res.json(await service.getSidebar(callerOf(req), itemId));
    }),
  );

  return router;
}
