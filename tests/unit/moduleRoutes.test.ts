import express from "express";
import { pino } from "pino";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { Caller } from "../../src/core/auth/caller";
import { authenticate } from "../../src/core/auth/middleware";
import { signToken, type TokenSettings } from "../../src/core/auth/tokens";
import { errorHandler, notFoundHandler } from "../../src/core/errors/errorHandler";
import { requestContext } from "../../src/core/http/requestContext";
import { itemsRouter } from "../../src/modules/items/routes";
import { ResizeService } from "../../src/modules/items/service";
import { projectsRouter } from "../../src/modules/projects/routes";
import { BomService } from "../../src/modules/projects/service";
import { sidebarRouter } from "../../src/modules/sidebar/routes";
import { SidebarService } from "../../src/modules/sidebar/service";
import { createMemoryRepositories } from "../../src/repositories/memory/memoryRepositories";
import { channelPartner, fakeAdapters, salesEngineer } from "../support/fakes";

const tokens: TokenSettings = { secret: "t".repeat(32), issuer: "test", audience: "test-api" };
const silent = pino({ level: "silent" });
const bearer = async (caller: Caller) => `Bearer ${await signToken(caller, tokens)}`;

function buildApp() {
  const repos = createMemoryRepositories();
  const adapters = fakeAdapters();
  const app = express();
  app.use(requestContext(silent));
  app.use(express.json());
  app.use(authenticate(tokens));
  app.use(sidebarRouter(new SidebarService({ items: repos.items, adapters, settings: { budgetMs: 1000, sectionTimeoutMs: 800 } })));
  app.use(itemsRouter(new ResizeService({ items: repos.items, adapters, settings: { sizingTimeoutMs: 5000, catalogueTimeoutMs: 800 } })));
  app.use(projectsRouter(new BomService({ bom: repos.bom, adapters, settings: { priceTimeoutMs: 800 } })));
  app.use(notFoundHandler());
  app.use(errorHandler(silent));
  return app;
}

describe("module routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  it("requires a token on every endpoint", async () => {
    const responses = await Promise.all([
      request(app).get("/items/DRV-03/sidebar"),
      request(app).post("/items/DRV-03/resize").send({ motorKw: 70, voltage: 400 }),
      request(app).get("/projects/PRJ-1/bom"),
    ]);

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
  });

  it("GET /items/:itemId/sidebar returns sections", async () => {
    const response = await request(app).get("/items/DRV-03/sidebar").set("Authorization", await bearer(salesEngineer));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      itemId: "DRV-03",
      sections: { catalogue: { status: "ok" }, sizing: { status: "ok" }, pricing: { status: "ok" } },
    });
  });

  it("GET /items/:itemId/sidebar hides prices from a channel partner", async () => {
    const response = await request(app).get("/items/DRV-03/sidebar").set("Authorization", await bearer(channelPartner));

    expect(response.body.sections.pricing).toEqual({ status: "not_permitted", data: null });
    expect(response.text).not.toMatch(/"price"|currency|leadTimeDays/);
  });

  it("POST /items/:itemId/resize returns the BOM change", async () => {
    const response = await request(app)
      .post("/items/DRV-03/resize")
      .set("Authorization", await bearer(salesEngineer))
      .send({ motorKw: 70, voltage: 400 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ changed: true, current: { variantCode: "ACS-R7-400", modelRef: "models/acs-r7" } });
  });

  it("POST /items/:itemId/resize validates the body", async () => {
    const response = await request(app)
      .post("/items/DRV-03/resize")
      .set("Authorization", await bearer(salesEngineer))
      .send({ motorKw: -1, voltage: 400, extra: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_failed");
  });

  it("GET /projects/:projectId/bom filters prices by role", async () => {
    const engineer = await request(app).get("/projects/PRJ-1/bom").set("Authorization", await bearer(salesEngineer));
    const partner = await request(app).get("/projects/PRJ-1/bom").set("Authorization", await bearer(channelPartner));

    expect(engineer.body.pricing).toBe("ok");
    expect(engineer.body.lines[0].unitPrice).toBeDefined();
    expect(partner.body.pricing).toBe("not_permitted");
    expect(partner.text).not.toMatch(/price|total|currency/i);
  });

  it("rejects malformed ids and unknown resources", async () => {
    const auth = await bearer(salesEngineer);
    const badId = await request(app).get("/items/bad%20id/sidebar").set("Authorization", auth);
    const unknown = await request(app).get("/projects/NOPE/bom").set("Authorization", auth);

    expect(badId.status).toBe(400);
    expect(unknown.status).toBe(404);
  });
});
