import express from "express";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler, notFoundHandler } from "../../src/core/errors/errorHandler";
import { ConflictError, ValidationError } from "../../src/core/errors/errors";
import { requestContext } from "../../src/core/http/requestContext";
import { requestLogger } from "../../src/core/http/requestLogger";

const silent = pino({ level: "silent" });

function buildApp() {
  const app = express();
  app.use(requestContext(silent));
  app.use(requestLogger());
  app.use(express.json());
  app.get("/ok", (req, res) => {
    res.json({ requestId: req.requestId });
  });
  app.get("/invalid", () => {
    throw new ValidationError("motorKw is required", [{ path: "motorKw" }]);
  });
  app.get("/conflict", () => {
    throw new ConflictError("Item was changed by someone else");
  });
  app.get("/crash", () => {
    throw new Error("secret internals");
  });
  app.post("/echo", (req, res) => {
    res.json(req.body);
  });
  app.use(notFoundHandler());
  app.use(errorHandler(silent));
  return app;
}

describe("http core", () => {
  const app = buildApp();

  it("generates a request id and returns it in a header", async () => {
    const response = await request(app).get("/ok");

    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });

  it("reuses a valid incoming request id", async () => {
    const response = await request(app).get("/ok").set("x-request-id", "abc-123");

    expect(response.headers["x-request-id"]).toBe("abc-123");
  });

  it("replaces an unsafe incoming request id", async () => {
    const response = await request(app).get("/ok").set("x-request-id", "bad id <script>");

    expect(response.headers["x-request-id"]).not.toContain("bad");
  });

  it("maps typed errors to their status and code", async () => {
    const invalid = await request(app).get("/invalid");
    const conflict = await request(app).get("/conflict");

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: "validation_failed", details: [{ path: "motorKw" }] });
    expect(invalid.body.error.requestId).toBe(invalid.headers["x-request-id"]);
    expect(conflict.status).toBe(409);
  });

  it("hides internals of unexpected errors", async () => {
    const response = await request(app).get("/crash");

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("secret internals");
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await request(app).post("/echo").set("content-type", "application/json").send("{bad");

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Malformed JSON body");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await request(app).get("/nope");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });
});
