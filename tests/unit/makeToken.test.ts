import { describe, expect, it } from "vitest";
import { parseTokenArgs, usage } from "../../scripts/make-token";
import { signToken, verifyToken } from "../../src/core/auth/tokens";

describe("make-token args", () => {
  it("builds a caller from role and country with defaults", () => {
    expect(parseTokenArgs(["sales_engineer", "in"])).toEqual({
      caller: { sub: "sales_engineer-local", role: "sales_engineer", country: "IN", customerGroup: "OEM" },
      expiresIn: "8h",
    });
  });

  it("accepts customer group and expiry", () => {
    expect(parseTokenArgs(["channel_partner", "DE", "distributor", "15m"])).toMatchObject({
      caller: { role: "channel_partner", country: "DE", customerGroup: "DISTRIBUTOR" },
      expiresIn: "15m",
    });
  });

  it.each([[[]], [["guest", "IN"]], [["administrator"]], [["administrator", "IND"]], [["administrator", "IN", "OEM", "soon"]]])(
    "rejects %j with the usage text",
    (args) => {
      expect(() => parseTokenArgs(args)).toThrow(usage);
    },
  );

  it("produces a token the API accepts", async () => {
    const settings = { secret: "k".repeat(32), issuer: "iss", audience: "aud" };
    const { caller, expiresIn } = parseTokenArgs(["administrator", "GB"]);

    await expect(verifyToken(await signToken(caller, settings, expiresIn), settings)).resolves.toEqual(caller);
  });
});
