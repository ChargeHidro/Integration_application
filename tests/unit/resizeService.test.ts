import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResizeService } from "../../src/modules/items/service";
import { createMemoryRepositories } from "../../src/repositories/memory/memoryRepositories";
import type { Repositories } from "../../src/repositories/types";
import { fakeAdapters, type FakeAdapters } from "../support/fakes";

describe("ResizeService", () => {
  let adapters: FakeAdapters;
  let repos: Repositories;
  let service: ResizeService;

  beforeEach(() => {
    adapters = fakeAdapters();
    repos = createMemoryRepositories();
    service = new ResizeService({
      items: repos.items,
      adapters,
      settings: { sizingTimeoutMs: 5000, catalogueTimeoutMs: 800 },
    });
  });

  it("changes the variant, model and BOM line when sizing recommends a new variant", async () => {
    const response = await service.resize("DRV-03", { motorKw: 70, voltage: 400 });

    expect(response).toEqual({
      itemId: "DRV-03",
      changed: true,
      previous: { variantCode: "ACS-R6-400", modelRef: "models/acs-r6" },
      current: { variantCode: "ACS-R7-400", modelRef: "models/acs-r7" },
      bomChange: {
        removed: { bomLineId: expect.any(String), variantCode: "ACS-R6-400", quantity: 1 },
        added: { bomLineId: expect.any(String), variantCode: "ACS-R7-400", quantity: 1 },
      },
    });
    await expect(repos.items.findById("DRV-03")).resolves.toMatchObject({
      itemId: "DRV-03",
      variantCode: "ACS-R7-400",
      motorInput: { motorKw: 70, voltage: 400 },
      version: 2,
    });
  });

  it("does not write when the variant is unchanged", async () => {
    const applyResize = vi.spyOn(repos.items, "applyResize");

    const response = await service.resize("DRV-03", { motorKw: 40, voltage: 400 });

    expect(response).toMatchObject({ changed: false, bomChange: null, current: { variantCode: "ACS-R6-400" } });
    expect(applyResize).not.toHaveBeenCalled();
    expect(adapters.catalogue.fetch).not.toHaveBeenCalled();
  });

  it("returns 503 and changes nothing when sizing is down", async () => {
    adapters.sizing.fetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "circuit_open" });

    await expect(service.resize("DRV-03", { motorKw: 70, voltage: 400 })).rejects.toMatchObject({ status: 503 });
    await expect(repos.items.findById("DRV-03")).resolves.toMatchObject({ variantCode: "ACS-R6-400", version: 1 });
  });

  it("returns 503 and changes nothing when the catalogue has no data for the new variant", async () => {
    adapters.catalogue.fetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "timeout" });

    await expect(service.resize("DRV-03", { motorKw: 70, voltage: 400 })).rejects.toMatchObject({ status: 503 });
    await expect(repos.items.findById("DRV-03")).resolves.toMatchObject({ variantCode: "ACS-R6-400", version: 1 });
  });

  it("uses the long re-size timeout for sizing", async () => {
    await service.resize("DRV-03", { motorKw: 70, voltage: 400 });

    expect(adapters.sizing.fetch).toHaveBeenCalledWith({ motorKw: 70, voltage: 400 }, { timeoutMs: 5000 });
  });

  it("rejects items that cannot be re-sized", async () => {
    await expect(service.resize("CAB-01", { motorKw: 70, voltage: 400 })).rejects.toMatchObject({ status: 400 });
    expect(adapters.sizing.fetch).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown item", async () => {
    await expect(service.resize("NOPE", { motorKw: 70, voltage: 400 })).rejects.toMatchObject({ status: 404 });
  });

  it("keeps the item id stable across re-sizes", async () => {
    await service.resize("DRV-03", { motorKw: 70, voltage: 400 });
    const second = await service.resize("DRV-03", { motorKw: 40, voltage: 400 });

    expect(second).toMatchObject({ itemId: "DRV-03", changed: true, current: { variantCode: "ACS-R6-400" } });
    await expect(repos.items.findById("DRV-03")).resolves.toMatchObject({ version: 3 });
  });
});
