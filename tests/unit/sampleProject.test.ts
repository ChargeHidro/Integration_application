import { describe, expect, it } from "vitest";
import { sampleProject } from "../../src/db/sampleProject";

describe("sampleProject", () => {
  it("has unique item ids", () => {
    const ids = sampleProject.items.map((item) => item.itemId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every drive motor input for sizing", () => {
    const drives = sampleProject.items.filter((item) => item.kind === "drive");

    expect(drives.length).toBeGreaterThan(0);
    for (const drive of drives) expect(drive.motorInput?.motorKw).toBeGreaterThan(0);
  });

  it("contains the item used in the README examples", () => {
    expect(sampleProject.projectId).toBe("PRJ-1");
    expect(sampleProject.items.some((item) => item.itemId === "DRV-03")).toBe(true);
  });
});
