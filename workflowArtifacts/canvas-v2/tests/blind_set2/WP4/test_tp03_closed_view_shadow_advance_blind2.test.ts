// WP4 / AC3 — the closed-view persistence write advances the shadow
// (multi-surface and empty-write angle).
//
// Two surfaces are subscribed at once and each has its own shadow entry keyed by
// its canonical path. The receipt for one must never be read as a receipt for the
// other — that confusion is exactly what a single flat "last content" map cannot
// express and what the path level of the shadow exists for.
//
// The second half is the empty write: a writer that flushes `{nodes:[],edges:[]}`
// is stating that the closed-view surface now holds nothing. Every record it
// previously knew is known-absent, and a later save that re-introduces one is a
// creation, not a revert.
//
//   ├── T1 two subscribed paths advance independently.
//   ├── T2 an empty write makes every record of that path absent.
//   ├── T3 after the empty write, a save carrying a record again creates it.
//   └── T4 the second path is untouched by all of it.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SurfaceState,
  getField,
  getRecordState,
  listPaths,
} from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const LEFT = "vault/one.canvas";
const RIGHT = "vault/two.canvas";

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

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const ONE = { id: "a1", type: "text", x: 5, y: 5, width: 100, height: 50, text: "one" };
const TWO = { id: "b2", type: "text", x: 15, y: 15, width: 100, height: 50, text: "two" };

async function makeSync() {
  const vault = createVault({
    [LEFT]: canvasJson([ONE]),
    [RIGHT]: canvasJson([TWO]),
  });
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
  await cs.subscribe(LEFT, "host");
  await cs.subscribe(RIGHT, "host");
  return {
    vault,
    cs,
    left: syncManager.getDoc(`__canvas__:${LEFT}`).doc,
    right: syncManager.getDoc(`__canvas__:${RIGHT}`).doc,
  };
}

describe("WP4 AC3 (multi-surface) — one receipt per path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 two subscribed paths advance independently", async () => {
    const t = await makeSync();

    t.cs.noteExternalDiskWrite(LEFT, canvasJson([{ ...ONE, x: 900 }]));
    await settle();

    const shadow = t.cs.getSurfaceShadow();
    expect(getField(shadow, LEFT, "node", "a1", "x")).toBe(900);
    expect(getField(shadow, RIGHT, "node", "b2", "x")).toBe(15);
    expect(getRecordState(shadow, RIGHT, "node", "a1")).toBe("unknown");
    expect(listPaths(shadow).sort()).toEqual([LEFT, RIGHT].sort());
  });

  it("T2 an empty write makes every record of that path absent", async () => {
    const t = await makeSync();

    t.cs.noteExternalDiskWrite(LEFT, canvasJson([], []));
    await settle();

    const shadow = t.cs.getSurfaceShadow();
    expect(getRecordState(shadow, LEFT, "node", "a1")).toBe("absent");
    expect(getField(shadow, LEFT, "node", "a1", "x")).toBeUndefined();
    expect(getRecordState(shadow, RIGHT, "node", "b2")).toBe("present");
  });

  it("T3 after the empty write, a save carrying the record again creates it", async () => {
    const t = await makeSync();

    t.cs.noteExternalDiskWrite(LEFT, canvasJson([], []));
    await settle();

    t.vault.files.set(LEFT, canvasJson([{ ...ONE, x: 42 }]));
    await t.cs.handleLocalModify(LEFT);

    expect(nodeField(t.left, "a1", "x")).toBe(42);
    expect(nodeField(t.left, "a1", "text")).toBe("one");
    expect(getField(t.cs.getSurfaceShadow(), LEFT, "node", "a1", "x")).toBe(42);
  });

  it("T4 a save on one path leaves the other path's shadow alone", async () => {
    const t = await makeSync();

    t.vault.files.set(LEFT, canvasJson([{ ...ONE, text: "one edited" }]));
    await t.cs.handleLocalModify(LEFT);

    const shadow = t.cs.getSurfaceShadow();
    expect(getField(shadow, LEFT, "node", "a1", "text")).toBe("one edited");
    expect(getField(shadow, RIGHT, "node", "b2", "text")).toBe("two");
    expect(nodeField(t.right, "b2", "text")).toBe("two");
  });
});
