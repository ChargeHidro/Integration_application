import express from "express";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Caller } from "../../src/core/auth/caller";
import { authenticate, callerOf } from "../../src/core/auth/middleware";
import { signToken, verifyToken, type TokenSettings } from "../../src/core/auth/tokens";
import { errorHandler } from "../../src/core/errors/errorHandler";
import { requestContext } from "../../src/core/http/requestContext";

const settings: TokenSettings = { secret: "s".repeat(32), issuer: "test-issuer", audience: "test-audience" };
const caller: Caller = { sub: "user-1", role: "sales_engineer", country: "IN", customerGroup: "OEM" };
const pastSeconds = () => Math.floor(Date.now() / 1000) - 60;

describe("verifyToken", () => {
  it("returns the caller for a valid token", async () => {
    const token = await signToken(caller, settings);

    await expect(verifyToken(token, settings)).resolves.toEqual(caller);
  });

  it.each([
    ["expired", () => signToken(caller, settings, pastSeconds())],
    ["wrong issuer", () => signToken(caller, { ...settings, issuer: "other" })],
    ["wrong audience", () => signToken(caller, { ...settings, audience: "other" })],
    ["bad signature", () => signToken(caller, { ...settings, secret: "o".repeat(32) })],
  ])("rejects a token with %s", async (_case, makeToken) => {
    const token = await makeToken();

    await expect(verifyToken(token, settings)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token with an unknown role", async () => {
    const token = await signToken({ ...caller, role: "guest" as Caller["role"] }, settings);

    await expect(verifyToken(token, settings)).rejects.toMatchObject({ status: 401, message: "Token claims are invalid" });
  });

  it("rejects garbage", async () => {
    await expect(verifyToken("not-a-jwt", settings)).rejects.toMatchObject({ status: 401 });
  });
});

describe("authenticate middleware", () => {
  const app = express();
  app.use(requestContext(pino({ level: "silent" })));
  app.use(authenticate(settings));
  app.get("/me", (req, res) => {
    res.json(callerOf(req));
  });
  app.use(errorHandler(pino({ level: "silent" })));

  it("attaches the caller for a valid bearer token", async () => {
    const token = await signToken(caller, settings);

    const response = await request(app).get("/me").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(caller);
  });

  it("returns 401 without a bearer token", async () => {
    const response = await request(app).get("/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
  });

  it("returns 401 for an expired token", async () => {
    const token = await signToken(caller, settings, pastSeconds());

    const response = await request(app).get("/me").set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
  });
});
