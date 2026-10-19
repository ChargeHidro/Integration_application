import { describe, expect, it } from "vitest";
import type { Caller } from "../../src/core/auth/caller";
import { canSeePrice } from "../../src/core/entitlements/entitlements";

const callerWith = (role: Caller["role"]): Caller => ({ sub: "u", role, country: "DE", customerGroup: "OEM" });

describe("canSeePrice", () => {
  it.each([
    ["sales_engineer", true],
    ["administrator", true],
    ["channel_partner", false],
  ] as const)("%s -> %s", (role, expected) => {
    expect(canSeePrice(callerWith(role))).toBe(expected);
  });
});
