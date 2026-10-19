import { z } from "zod";

export const priceQuerySchema = z.object({
  variantCode: z.string().min(1).max(64),
  country: z.string().regex(/^[A-Z]{2}$/),
  customerGroup: z.string().min(1).max(64),
});

export type PriceQuery = z.infer<typeof priceQuerySchema>;

export const priceQuoteSchema = z.object({
  variantCode: z.string().min(1),
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  price: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  validUntil: z.string().datetime({ offset: true }),
});

export type PriceQuote = z.infer<typeof priceQuoteSchema>;
