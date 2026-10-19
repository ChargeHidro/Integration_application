import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../../src/core/errors/errors";
import type { Repositories } from "../../src/repositories/types";

export function describeRepositoryContract(name: string, fresh: () => Promise<Repositories>): void {
  describe(`${name} repositories`, () => {
    let repos: Repositories;

    beforeEach(async () => {
      repos = await fresh();
    });

    it("finds a seeded item", async () => {
      const item = await repos.items.findById("DRV-03");

      expect(item).toMatchObject({
        itemId: "DRV-03",
        projectId: "PRJ-1",
        kind: "drive",
        variantCode: "ACS-R6-400",
        modelRef: "models/acs-r6",
        motorInput: { motorKw: 45, voltage: 400 },
        version: 1,
      });
      expect(Number.isNaN(Date.parse(item?.updatedAt ?? ""))).toBe(false);
    });

    it("returns null for an unknown item", async () => {
      await expect(repos.items.findById("NOPE")).resolves.toBeNull();
    });

    it("finds the project and its BOM lines", async () => {
      await expect(repos.bom.findProject("PRJ-1")).resolves.toEqual({
        projectId: "PRJ-1",
        name: "Pump station A - electrical room",
      });
      const lines = await repos.bom.listLines("PRJ-1");

      expect(lines.map((line) => line.itemId)).toEqual(["CAB-01", "DRV-01", "DRV-02", "DRV-03", "PNL-01"]);
      expect(lines.find((line) => line.itemId === "CAB-01")?.quantity).toBe(2);
      await expect(repos.bom.findProject("NOPE")).resolves.toBeNull();
    });

    it("applies a resize to the item and its BOM line together", async () => {
      const outcome = await repos.items.applyResize({
        itemId: "DRV-03",
        expectedVersion: 1,
        variantCode: "ACS-R7-400",
        modelRef: "models/acs-r7",
        motorInput: { motorKw: 70, voltage: 400 },
      });

      expect(outcome.item).toMatchObject({
        itemId: "DRV-03",
        variantCode: "ACS-R7-400",
        modelRef: "models/acs-r7",
        motorInput: { motorKw: 70, voltage: 400 },
        version: 2,
      });
      expect(outcome.previousLine).toMatchObject({ itemId: "DRV-03", variantCode: "ACS-R6-400", quantity: 1 });
      expect(outcome.currentLine).toMatchObject({ itemId: "DRV-03", variantCode: "ACS-R7-400", quantity: 1 });
      expect(outcome.currentLine.bomLineId).toBe(outcome.previousLine.bomLineId);
      await expect(repos.items.findById("DRV-03")).resolves.toMatchObject({ variantCode: "ACS-R7-400", version: 2 });
      const line = (await repos.bom.listLines("PRJ-1")).find((l) => l.itemId === "DRV-03");
      expect(line?.variantCode).toBe("ACS-R7-400");
    });

    it("rejects a resize based on an old version and changes nothing", async () => {
      const change = {
        itemId: "DRV-03",
        expectedVersion: 1,
        variantCode: "ACS-R7-400",
        modelRef: "models/acs-r7",
        motorInput: { motorKw: 70, voltage: 400 },
      };
      await repos.items.applyResize(change);

      await expect(repos.items.applyResize({ ...change, variantCode: "ACS-R8-400" })).rejects.toBeInstanceOf(ConflictError);
      await expect(repos.items.findById("DRV-03")).resolves.toMatchObject({ variantCode: "ACS-R7-400", version: 2 });
    });

    it("rejects a resize of an unknown item", async () => {
      await expect(
        repos.items.applyResize({
          itemId: "NOPE",
          expectedVersion: 1,
          variantCode: "ACS-R7-400",
          modelRef: "models/acs-r7",
          motorInput: { motorKw: 70, voltage: 400 },
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
}
