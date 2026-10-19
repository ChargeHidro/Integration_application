import { z } from "zod";

export const catalogueQuerySchema = z.object({
  variantCode: z.string().min(1).max(64),
});

export type CatalogueQuery = z.infer<typeof catalogueQuerySchema>;

export const catalogueVariantSchema = z.object({
  code: z.string().min(1),
  model: z.string().min(1),
  description: z.string(),
  frame: z.string().nullable(),
  ratedKw: z.number().positive().nullable(),
  voltage: z.number().int().positive().nullable(),
  ipRating: z.string().min(1),
  options: z.array(z.string()),
  dimensionsMm: z.object({ w: z.number().positive(), h: z.number().positive(), d: z.number().positive() }),
  model3d: z.object({ lod0: z.string().min(1), lod1: z.string().min(1), lod2: z.string().min(1) }),
});

export type CatalogueVariant = z.infer<typeof catalogueVariantSchema>;
