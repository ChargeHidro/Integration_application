import { z } from "zod";

export const roles = ["sales_engineer", "channel_partner", "administrator"] as const;

export type Role = (typeof roles)[number];

export const callerSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(roles),
  country: z.string().regex(/^[A-Z]{2}$/),
  customerGroup: z.string().min(1).max(64),
});

export type Caller = z.infer<typeof callerSchema>;
