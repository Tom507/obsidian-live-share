// WP4 — capture-side geometry rounding (magnitude and key-name angle).
//
// Two failure modes a "move the card by half a pixel" case cannot reach:
//
//   ├── the four geometry key names are matched EXACTLY. `X`, `x2`, `maxWidth`,
//   │   `heights` are not geometry, and a helper that matched them would silently
//   │   round unrelated future fields into oblivion.
//   └── a value that is already whole must come out identical — including large
//       magnitudes, where a float detour (`toFixed`, `parseFloat`, a `* 100 / 100`
//       trick) starts changing the number.
//
//   ├── T1 whole pixels at large magnitude are untouched, byte-stable.
//   ├── T2 look-alike key names are never rounded.
//   ├── T3 an edge record's numeric fields are not geometry.
//   └── T4 a sub-pixel jitter loop converges instead of ping-ponging.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "wide/board.canvas";

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

function rec(doc: Y.Doc, which: "nodes" | "edges", id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>(which).get(id)?.get(key);
}

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const BIG = {
  id: "big",
  type: "text",
  x: 1234567,
  y: -987654,
  width: 4096,
  height: 2048,
  text: "far away",
};
const LOOKALIKE = {
  id: "look",
  type: "text",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  X: 3.7,
  x2: 9.4,
  maxWidth: 12.5,
  heights: 0.6,
};
const LINK = {
  id: "l",
  fromNode: "big",
  toNode: "look",
  fromSide: "left",
  toSide: "right",
  weight: 0.75,
};

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

describe("WP4 — rounding touches the four geometry keys and nothing else", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 whole pixels at large magnitude are untouched", async () => {
    const p = await makePeer(canvasJson([BIG], [LINK]));
    const before = fingerprint(p.doc);

    p.vault.files.set(
      PATH,
      canvasJson([{ text: "far away", height: 2048, width: 4096, y: -987654, x: 1234567, type: "text", id: "big" }], [LINK]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(fingerprint(p.doc)).toBe(before);
    expect(rec(p.doc, "nodes", "big", "x")).toBe(1234567);
    expect(rec(p.doc, "nodes", "big", "y")).toBe(-987654);
  });

  it("T2 look-alike key names are never rounded", async () => {
    const p = await makePeer(canvasJson([LOOKALIKE]));

    p.vault.files.set(PATH, canvasJson([{ ...LOOKALIKE, x: 5.5, X: 4.7, x2: 10.4, maxWidth: 13.5, heights: 1.6 }]));
    await p.cs.handleLocalModify(PATH);

    expect(rec(p.doc, "nodes", "look", "x"), "the real geometry key is rounded").toBe(6);
    expect(rec(p.doc, "nodes", "look", "X")).toBe(4.7);
    expect(rec(p.doc, "nodes", "look", "x2")).toBe(10.4);
    expect(rec(p.doc, "nodes", "look", "maxWidth")).toBe(13.5);
    expect(rec(p.doc, "nodes", "look", "heights")).toBe(1.6);
  });

  it("T3 an edge's own numeric fields are not geometry", async () => {
    const p = await makePeer(canvasJson([BIG], [LINK]));

    p.vault.files.set(PATH, canvasJson([BIG], [{ ...LINK, weight: 0.25 }]));
    await p.cs.handleLocalModify(PATH);

    expect(rec(p.doc, "edges", "l", "weight")).toBe(0.25);
  });

  it("T4 a jitter loop converges instead of ping-ponging", async () => {
    const p = await makePeer(canvasJson([BIG], [LINK]));

    // Three saves of the "same" position, each with different sub-pixel noise.
    const seen: unknown[] = [];
    for (const noise of [0.2, -0.3, 0.49]) {
      p.vault.files.set(PATH, canvasJson([{ ...BIG, x: 1234567 + noise, text: `far away ${noise}` }], [LINK]));
      await p.cs.handleLocalModify(PATH);
      seen.push(rec(p.doc, "nodes", "big", "x"));
    }

    expect(seen).toEqual([1234567, 1234567, 1234567]);
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "big", "x")).toBe(1234567);
  });
});
