import { Router } from "express";
import { sizingInputSchema } from "../../adapters/sizing/schema";
import { asyncHandler } from "../../core/http/asyncHandler";
import { idSchema, parseWith } from "../../core/http/validate";
import type { ResizeService } from "./service";

export function itemsRouter(service: ResizeService): Router {
  const router = Router();

  router.post(
    "/items/:itemId/resize",
    asyncHandler(async (req, res) => {
      const itemId = parseWith(idSchema, req.params.itemId, "Invalid item id");
      const input = parseWith(sizingInputSchema.strict(), req.body, "Invalid motor data");
      res.json(await service.resize(itemId, input));
    }),
  );

  return router;
}
