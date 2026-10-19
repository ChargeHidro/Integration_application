import { z } from "zod";
import { ValidationError } from "../errors/errors";

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      message,
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return parsed.data;
}
