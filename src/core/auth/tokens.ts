import { jwtVerify, SignJWT } from "jose";
import { UnauthorizedError } from "../errors/errors";
import { callerSchema, type Caller } from "./caller";

export interface TokenSettings {
  secret: string;
  issuer: string;
  audience: string;
}

const algorithm = "HS256";

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken(
  caller: Caller,
  settings: TokenSettings,
  expiresIn: string | number | Date = "1h",
): Promise<string> {
  return new SignJWT({ role: caller.role, country: caller.country, customerGroup: caller.customerGroup })
    .setProtectedHeader({ alg: algorithm, typ: "JWT" })
    .setSubject(caller.sub)
    .setIssuer(settings.issuer)
    .setAudience(settings.audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(keyOf(settings.secret));
}

export async function verifyToken(token: string, settings: TokenSettings): Promise<Caller> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, keyOf(settings.secret), {
      issuer: settings.issuer,
      audience: settings.audience,
      algorithms: [algorithm],
      requiredClaims: ["sub", "exp"],
    }));
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }

  const parsed = callerSchema.safeParse(payload);
  if (!parsed.success) throw new UnauthorizedError("Token claims are invalid");
  return parsed.data;
}
