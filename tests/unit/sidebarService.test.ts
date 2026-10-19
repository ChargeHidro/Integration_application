import { beforeEach, describe, expect, it } from "vitest";
import { SidebarService } from "../../src/modules/sidebar/service";
import { createMemoryRepositories } from "../../src/repositories/memory/memoryRepositories";
import { channelPartner, fakeAdapters, salesEngineer, type FakeAdapters } from "../support/fakes";

describe("SidebarService", () => {
  let adapters: FakeAdapters;
  let service: SidebarService;

  beforeEach(() => {
    adapters = fakeAdapters();
    service = new SidebarService({
      items: createMemoryRepositories().items,
      adapters,
      settings: { budgetMs: 300, sectionTimeoutMs: 200 },
    });
  });

  it("returns all sections for a sales engineer", async () => {
    const sidebar = await service.getSidebar(salesEngineer, "DRV-03");

    expect(sidebar.itemId).toBe("DRV-03");
    expect(sidebar.variantCode).toBe("ACS-R6-400");
    expect(sidebar.sections.catalogue.status).toBe("ok");
    expect(sidebar.sections.sizing.status).toBe("ok");
    expect(sidebar.sections.pricing.status).toBe("ok");
    expect(adapters.pricing.fetch).toHaveBeenCalledWith(
      { variantCode: "ACS-R6-400", country: "IN", customerGroup: "OEM" },
      { timeoutMs: 200 },
    );
    expect(adapters.sizing.fetch).toHaveBeenCalledWith({ motorKw: 45, voltage: 400 }, { timeoutMs: 200 });
  });

  it("never calls pricing for a channel partner", async () => {
    const sidebar = await service.getSidebar(channelPartner, "DRV-03");

    expect(sidebar.sections.pricing).toEqual({ status: "not_permitted", data: null });
    expect(adapters.pricing.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(sidebar)).not.toMatch(/price|currency|leadTime|validUntil/i);
  });

  it("marks sizing not applicable for items without motor data", async () => {
    const sidebar = await service.getSidebar(salesEngineer, "CAB-01");

    expect(sidebar.sections.sizing).toEqual({ status: "unavailable", data: null, reason: "not_applicable" });
    expect(adapters.sizing.fetch).not.toHaveBeenCalled();
  });

  it("keeps other sections when one system fails", async () => {
    adapters.sizing.fetch.mockResolvedValueOnce({ status: "unavailable", data: null, reason: "upstream_error" });

    const sidebar = await service.getSidebar(salesEngineer, "DRV-03");

    expect(sidebar.sections.catalogue.status).toBe("ok");
    expect(sidebar.sections.sizing.status).toBe("unavailable");
    expect(sidebar.sections.pricing.status).toBe("ok");
  });

  it("answers within the budget even if an adapter hangs", async () => {
    adapters.sizing.fetch.mockReturnValueOnce(new Promise(() => {}));
    const started = Date.now();

    const sidebar = await service.getSidebar(salesEngineer, "DRV-03");

    expect(Date.now() - started).toBeLessThan(300);
    expect(sidebar.sections.sizing).toEqual({ status: "unavailable", data: null, reason: "timeout" });
    expect(sidebar.sections.catalogue.status).toBe("ok");
  });

  it("turns an adapter crash into an unavailable section", async () => {
    adapters.catalogue.fetch.mockRejectedValueOnce(new Error("bug"));

    const sidebar = await service.getSidebar(salesEngineer, "DRV-03");

    expect(sidebar.sections.catalogue).toEqual({ status: "unavailable", data: null, reason: "internal_error" });
  });

  it("returns 404 for an unknown item", async () => {
    await expect(service.getSidebar(salesEngineer, "NOPE")).rejects.toMatchObject({ status: 404 });
  });
});
