import { z } from "zod";

export const sizingInputSchema = z.object({
  motorKw: z.number().positive().max(10_000),
  voltage: z.number().int().positive().max(1_000),
});

export type SizingInput = z.infer<typeof sizingInputSchema>;

export const sizingResultSchema = z.object({
  variantCode: z.string().min(1),
  loadPct: z.number().min(0),
  frame: z.string().min(1).optional(),
});

export type SizingResult = z.infer<typeof sizingResultSchema>;
