// WP8 AC4 (local half) — same harness, "downgrade" angle: the doc's stamped
// major is LOWER than this client's supported major (an old peer's doc this
// client somehow still considers foreign), not just higher. Mismatch
// detection must be a genuine inequality check, not merely "is the doc
// ahead of me". Different geometry values from the visible test.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH_MISMATCH = "old-major.canvas";
const PATH_OK = "current.canvas";
const BELOW_SUPPORTED_MAJOR = 1;

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

const CARD = { id: "card", type: "file", x: 10, y: 10, width: 200, height: 100, file: "a.md" };

describe("WP8 AC4 (local half) — a BELOW-supported major also disables capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a doc stamped with a major below this client's supported major refuses local capture, while a normal path stays alive", async () => {
    const initial = canvasJson([CARD]);
    const vault = createVault({ [PATH_MISMATCH]: initial, [PATH_OK]: initial });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };

    const mismatchHandle = syncManager.getDoc(`__canvas__:${PATH_MISMATCH}`);
    mismatchHandle.doc.getMap<unknown>("meta").set("schemaVersion", BELOW_SUPPORTED_MAJOR);

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

    vault.files.set(PATH_MISMATCH, canvasJson([{ ...CARD, x: -500 }]));
    vault.files.set(PATH_OK, canvasJson([{ ...CARD, x: -500 }]));

    await cs.handleLocalModify(PATH_MISMATCH);
    await cs.handleLocalModify(PATH_OK);

    expect(
      mismatchDoc.getMap<Y.Map<unknown>>("nodes").get("card")?.get("x"),
      "a below-supported major must also disable capture, not only an above-supported one",
    ).toBe(10);
    expect(okDoc.getMap<Y.Map<unknown>>("nodes").get("card")?.get("x")).toBe(-500);

    cs.destroy();
  });
});
