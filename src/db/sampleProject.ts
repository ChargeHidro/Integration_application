export interface SampleItem {
  itemId: string;
  kind: "drive" | "cabinet" | "panel";
  variantCode: string;
  modelRef: string;
  position: { x: number; y: number; rotation: number };
  motorInput: { motorKw: number; voltage: number } | null;
  quantity: number;
}

export interface SampleProject {
  projectId: string;
  name: string;
  items: SampleItem[];
}

export const sampleProject: SampleProject = {
  projectId: "PRJ-1",
  name: "Pump station A - electrical room",
  items: [
    {
      itemId: "DRV-01",
      kind: "drive",
      variantCode: "ACS-R6-400",
      modelRef: "models/acs-r6",
      position: { x: 1, y: 1, rotation: 0 },
      motorInput: { motorKw: 37, voltage: 400 },
      quantity: 1,
    },
    {
      itemId: "DRV-02",
      kind: "drive",
      variantCode: "ACS-R7-400",
      modelRef: "models/acs-r7",
      position: { x: 2, y: 1, rotation: 0 },
      motorInput: { motorKw: 75, voltage: 400 },
      quantity: 1,
    },
    {
      itemId: "DRV-03",
      kind: "drive",
      variantCode: "ACS-R6-400",
      modelRef: "models/acs-r6",
      position: { x: 3, y: 1, rotation: 0 },
      motorInput: { motorKw: 45, voltage: 400 },
      quantity: 1,
    },
    {
      itemId: "CAB-01",
      kind: "cabinet",
      variantCode: "CAB-STD-800",
      modelRef: "models/cab-800",
      position: { x: 1, y: 3, rotation: 90 },
      motorInput: null,
      quantity: 2,
    },
    {
      itemId: "PNL-01",
      kind: "panel",
      variantCode: "PNL-SAFETY-1",
      modelRef: "models/pnl-s1",
      position: { x: 4, y: 3, rotation: 0 },
      motorInput: null,
      quantity: 1,
    },
  ],
};
