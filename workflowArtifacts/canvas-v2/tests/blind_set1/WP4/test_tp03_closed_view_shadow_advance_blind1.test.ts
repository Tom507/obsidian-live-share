// WP4 / AC3 — the closed-view persistence write is the surface receipt
// (removal and re-appearance angle).
//
// The visible-field case is only half of "the content of the last persistence
// write advances the shadow". The other half is what the content does NOT
// contain: with the view closed, the file IS the surface, so a record the writer
// left out is known-absent, not merely unobserved. And a record that comes back
// starts from the fields the new write actually carried — the fields it had in a
// previous life are knowledge about a different incarnation.
//
//   ├── T1 a record dropped by the writer becomes `absent`, and the surviving
//   │      records keep their advanced fields.
//   ├── T2 a record that returns is `present` again with the newly written
//   │      values, and a save of them yields no intent.
//   ├── T3 an edge's fields advance in their own id space.
//   └── T4 with the view open none of this happens — not the advance, not the
//          absence.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField, getRecordState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "Design/flows.canvas";

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const P = { id: "step-1", type: "text", x: 0, y: 0, width: 160, height: 80, text: "draft" };
const Q = { id: "step-2", type: "text", x: 240, y: 0, width: 160, height: 80, text: "review" };
const WIRE = {
  id: "w1",
  fromNode: "step-1",
  toNode: "step-2",
  fromSide: "right",
  toSide: "left",
  color: "4",
};

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, surface };
}

describe("WP4 AC3 (absence angle) — a closed-view write says what is NOT there", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a record the writer left out becomes absent", async () => {
    const p = await makePeer(canvasJson([P, Q], [WIRE]));

    const shrunk = canvasJson([{ ...P, x: 30 }], []);
    p.vault.files.set(PATH, shrunk);
    p.cs.noteExternalDiskWrite(PATH, shrunk);
    await settle();

    const shadow = p.cs.getSurfaceShadow();
    expect(getRecordState(shadow, PATH, "node", "step-2")).toBe("absent");
    expect(getRecordState(shadow, PATH, "edge", "w1")).toBe("absent");
    expect(getRecordState(shadow, PATH, "node", "step-1")).toBe("present");
    expect(getField(shadow, PATH, "node", "step-1", "x")).toBe(30);
  });

  it("T2 a returning record is present again with the newly written values", async () => {
    const p = await makePeer(canvasJson([P, Q], [WIRE]));

    const without = canvasJson([P], []);
    p.vault.files.set(PATH, without);
    p.cs.noteExternalDiskWrite(PATH, without);
    await settle();
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "node", "step-2")).toBe("absent");

    const back = canvasJson([P, { ...Q, x: 999, text: "review v2" }], []);
    p.vault.files.set(PATH, back);
    p.cs.noteExternalDiskWrite(PATH, back);
    await settle();

    const shadow = p.cs.getSurfaceShadow();
    expect(getRecordState(shadow, PATH, "node", "step-2")).toBe("present");
    expect(getField(shadow, PATH, "node", "step-2", "x")).toBe(999);
    expect(getField(shadow, PATH, "node", "step-2", "text")).toBe("review v2");

    // Obsidian saves what it found — in its own byte shape.
    const before = fingerprint(p.doc);
    p.vault.files.set(
      PATH,
      canvasJson([
        { text: "draft", height: 80, width: 160, y: 0, x: 0, type: "text", id: "step-1" },
        { text: "review v2", height: 80, width: 160, y: 0, x: 999, type: "text", id: "step-2" },
      ]),
    );
    await p.cs.handleLocalModify(PATH);
    expect(fingerprint(p.doc)).toBe(before);
  });

  it("T3 edge fields advance in the edge id space", async () => {
    const p = await makePeer(canvasJson([P, Q], [WIRE]));

    const rerouted = canvasJson([P, Q], [{ ...WIRE, toSide: "top", color: "1" }]);
    p.vault.files.set(PATH, rerouted);
    p.cs.noteExternalDiskWrite(PATH, rerouted);
    await settle();

    const shadow = p.cs.getSurfaceShadow();
    expect(getField(shadow, PATH, "edge", "w1", "toSide")).toBe("top");
    expect(getField(shadow, PATH, "edge", "w1", "color")).toBe("1");
    expect(getRecordState(shadow, PATH, "node", "w1")).toBe("unknown");
  });

  it("T4 with the view open, neither the advance nor the absence happens", async () => {
    const p = await makePeer(canvasJson([P, Q], [WIRE]));
    p.cs.noteExternalDiskWrite(PATH, canvasJson([P, Q], [WIRE]));
    await settle();
    p.surface.viewOpen = true;
    p.surface.handedToView.node.add("step-1");
    p.surface.handedToView.node.add("step-2");
    p.surface.handedToView.edge.add("w1");

    const shrunk = canvasJson([{ ...P, x: 30 }], []);
    p.vault.files.set(PATH, shrunk);
    p.cs.noteExternalDiskWrite(PATH, shrunk);
    await settle();

    const shadow = p.cs.getSurfaceShadow();
    expect(getRecordState(shadow, PATH, "node", "step-2")).toBe("present");
    expect(getField(shadow, PATH, "node", "step-1", "x")).toBe(0);
  });
});
