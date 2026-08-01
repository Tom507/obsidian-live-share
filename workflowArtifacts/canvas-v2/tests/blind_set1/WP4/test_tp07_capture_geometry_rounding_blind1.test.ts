// WP4 — capture-side geometry rounding (negative space, halves, group nodes).
//
// The rule is "rounded to whole pixels BEFORE the register write, so rounding can
// never appear as intent" (BUILD_SPEC §4.4). This variant works in negative
// coordinate space and on exact `.5` boundaries, where a naive `parseInt`, a
// `toFixed` or a truncation would produce a different answer from `Math.round`
// and a peer would see a one-pixel revert.
//
//   ├── T1 negative fractional geometry reaches the CRDT as whole pixels.
//   ├── T2 exact halves round consistently in both directions of the axis.
//   ├── T3 a non-finite or non-numeric geometry value is passed through, never
//   │      coerced into a number.
//   └── T4 sub-pixel noise on a group node cannot revert a peer's resize.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "Sketches/negative space.canvas";

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

function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "peer");
  remote.destroy();
}

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const GROUP = { id: "grp", type: "group", x: -400, y: -250, width: 600, height: 400, label: "wip" };

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, diskJson);
  await settle();
  return { vault, cs, doc };
}

describe("WP4 — rounding at the capture boundary, in negative space", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 negative fractional geometry becomes whole pixels", async () => {
    const p = await makePeer(canvasJson([GROUP]));

    p.vault.files.set(
      PATH,
      canvasJson([{ ...GROUP, x: -399.6, y: -249.2, width: 600.8, height: 399.4 }]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "grp", "x")).toBe(-400);
    expect(nodeField(p.doc, "grp", "y")).toBe(-249);
    expect(nodeField(p.doc, "grp", "width")).toBe(601);
    expect(nodeField(p.doc, "grp", "height")).toBe(399);
  });

  it("T2 exact halves round the same way on both sides of zero", async () => {
    const p = await makePeer(canvasJson([GROUP]));

    p.vault.files.set(PATH, canvasJson([{ ...GROUP, x: -0.5, y: 0.5, width: 2.5, height: 3.5 }]));
    await p.cs.handleLocalModify(PATH);

    // Math.round is half-up on the number line: -0.5 → -0 → normalised to 0.
    expect(Object.is(nodeField(p.doc, "grp", "x"), 0)).toBe(true);
    expect(nodeField(p.doc, "grp", "y")).toBe(1);
    expect(nodeField(p.doc, "grp", "width")).toBe(3);
    expect(nodeField(p.doc, "grp", "height")).toBe(4);
  });

  it("T3 a non-numeric geometry value is passed through, never coerced", async () => {
    const p = await makePeer(canvasJson([GROUP]));

    p.vault.files.set(PATH, canvasJson([{ ...GROUP, x: "120", height: null }]));
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "grp", "x"), "a string coordinate must not become a number").toBe("120");
    expect(nodeField(p.doc, "grp", "height")).toBe(null);
  });

  it("T4 sub-pixel noise cannot revert a peer's resize", async () => {
    const p = await makePeer(canvasJson([GROUP]));

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("grp")?.set("width", 1200);
    });

    p.vault.files.set(PATH, canvasJson([{ ...GROUP, width: 599.7, label: "wip 2" }]));
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "grp", "width"), "600.0 vs 599.7 is not user intent").toBe(1200);
    expect(nodeField(p.doc, "grp", "label")).toBe("wip 2");
  });
});
