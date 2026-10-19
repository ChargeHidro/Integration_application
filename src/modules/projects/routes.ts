import { Router } from "express";
import { callerOf } from "../../core/auth/middleware";
import { asyncHandler } from "../../core/http/asyncHandler";
import { idSchema, parseWith } from "../../core/http/validate";
import type { BomService } from "./service";

export function projectsRouter(service: BomService): Router {
  const router = Router();

  router.get(
    "/projects/:projectId/bom",
    asyncHandler(async (req, res) => {
      const projectId = parseWith(idSchema, req.params.projectId, "Invalid project id");
      res.json(await service.getBom(callerOf(req), projectId));
    }),
  );

  return router;
}
