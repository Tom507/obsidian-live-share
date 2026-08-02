// WP8 / AC4 (LOCAL half only — see TaskCharter §7b for the INTEGRATION_SCOPE
// "persistence continues" half) — "A doc whose schemaVersion major differs
// from this client's supported major is detected, and the client disables
// local capture for that path ... it never writes a guess into the shared
// state."
//
// A test that only checks "capture stopped for the mismatched path" would
// also pass a client that had simply crashed or a CanvasSync instance that
// never captures anything at all. The oracle here proves the client is
// ALIVE: a SECOND, matching-major path on the SAME CanvasSync instance
// captures a local edit normally, in the very same test run, while the
// mismatched path's local edit never reaches its doc.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH_MISMATCH = "mismatch.canvas";
const PATH_OK = "ok.canvas";
const UNSUPPORTED_MAJOR = 99;

function canvasJson(nodes: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges: [] });
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

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "start" };

describe("WP8 AC4 (local half) — a schema-major mismatch disables capture for that path only", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the mismatched path's local edit never reaches its doc, while a matching-major path on the same client captures normally", async () => {
    const initialMismatch = canvasJson([N1]);
    const initialOk = canvasJson([N1]);
    const vault = createVault({ [PATH_MISMATCH]: initialMismatch, [PATH_OK]: initialOk });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };

    // Pre-seed the mismatch doc's meta BEFORE subscribing, simulating a doc a
    // newer peer already stamped with a future major this client cannot read.
    const mismatchHandle = syncManager.getDoc(`__canvas__:${PATH_MISMATCH}`);
    mismatchHandle.doc.getMap<unknown>("meta").set("schemaVersion", UNSUPPORTED_MAJOR);

    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: false,
        handedToView: { node: new Set<string>(), edge: new Set<string>() },
      }),
    );

    await cs.subscribe(PATH_MISMATCH, "host");
    await cs.subscribe(PATH_OK, "host");

    const mismatchDoc = syncManager.getDoc(`__canvas__:${PATH_MISMATCH}`).doc;
    const okDoc = syncManager.getDoc(`__canvas__:${PATH_OK}`).doc;

    // Both paths get a genuine local edit.
    vault.files.set(PATH_MISMATCH, canvasJson([{ ...N1, x: 777 }]));
    vault.files.set(PATH_OK, canvasJson([{ ...N1, x: 777 }]));

    await cs.handleLocalModify(PATH_MISMATCH);
    await cs.handleLocalModify(PATH_OK);

    expect(
      mismatchDoc.getMap<Y.Map<unknown>>("nodes").get("n1")?.get("x"),
      "capture must be disabled for the schema-mismatched path — no guess written into shared state",
    ).toBe(0);

    expect(
      okDoc.getMap<Y.Map<unknown>>("nodes").get("n1")?.get("x"),
      "a matching-major path on the very same client must still capture normally (the client is alive)",
    ).toBe(777);

    cs.destroy();
  });
});
