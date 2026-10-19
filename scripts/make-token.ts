import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadConfig } from "../src/config/env";
import { callerSchema, roles, type Caller } from "../src/core/auth/caller";
import { signToken } from "../src/core/auth/tokens";

export const usage = `Usage: npm run token -- <role> <country> [customerGroup] [expiresIn]
  role           ${roles.join(" | ")}
  country        two-letter code, e.g. IN, DE, US, GB
  customerGroup  default OEM (e.g. OEM, DISTRIBUTOR, END_USER)
  expiresIn      default 8h (e.g. 15m, 1h, 1d)`;

export interface TokenRequest {
  caller: Caller;
  expiresIn: string;
}

const expiresInSchema = z.string().regex(/^\d+(s|m|h|d)$/);

export function parseTokenArgs(args: string[]): TokenRequest {
  const [role, country, customerGroup = "OEM", expiresIn = "8h"] = args;
  const caller = callerSchema.safeParse({
    sub: `${role}-local`,
    role,
    country: country?.toUpperCase(),
    customerGroup: customerGroup.toUpperCase(),
  });
  if (!caller.success || !expiresInSchema.safeParse(expiresIn).success) throw new Error(usage);
  return { caller: caller.data, expiresIn };
}

async function main(): Promise<void> {
  const { caller, expiresIn } = parseTokenArgs(process.argv.slice(2));
  console.log(await signToken(caller, loadConfig().auth, expiresIn));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
