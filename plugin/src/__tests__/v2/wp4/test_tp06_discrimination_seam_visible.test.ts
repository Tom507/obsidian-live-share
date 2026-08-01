// WP4 — DISCRIMINATION (BUILD_SPEC §8: "every new mechanism ships at least one
// test that fails when the mechanism is disabled through its injected seam").
//
// The mechanism under test is the shadow rebase of the capture path. Its seam is
// `CanvasSync.setShadowRebaseEnabled(boolean)` (default `true`). With it OFF the
// capture path stops classifying the save against the shadow and treats every
// observed field as intent — the pre-V2 behaviour whose defect class this whole
// initiative exists to remove.
//
// One scenario, two runs, one difference. If the assertions in T1 could pass
// without the mechanism doing the work, T2 would not be able to reproduce the
// cascade from the very same fixture.
//
//   ├── T1 seam ON  → the stale field never leaves this client.
//   ├── T2 seam OFF → the stale field reaches both peers: the cascade starts,
//   │      which proves T1 is not vacuous.
//   └── T3 the two runs are compared directly, so a future change that quietly
//          neutralises the seam breaks a test instead of passing silently.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "board.canvas";

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

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "card" };
const N2 = { id: "n2", type: "text", x: 600, y: 0, width: 200, height: 100, text: "other" };

/**
 * The identical stale-save scenario, parameterised ONLY by the seam.
 *
 * Peer 2 moves n1; peers 1 and 3 receive it; peer 1's offscreen surface then
 * saves the pre-move file with one genuine change of its own.
 */
async function runScenario(shadowRebase: boolean) {
  const initial = canvasJson([N1, N2]);
  const vault = createVault({ [PATH]: initial });
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
  cs.setShadowRebaseEnabled(shadowRebase);
  await cs.subscribe(PATH, "host");
  const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, initial);
  await settle();

  const doc2 = new Y.Doc();
  const doc3 = new Y.Doc();
  push(doc1, doc2);
  push(doc1, doc3);

  doc2.transact(() => {
    doc2.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("x", 500);
  });
  push(doc2, doc1);
  push(doc2, doc3);

  vault.files.set(PATH, canvasJson([{ ...N1, y: 40 }, N2]));
  await cs.handleLocalModify(PATH);

  push(doc1, doc2);
  push(doc1, doc3);

  const result = {
    local: nodeField(doc1, "n1", "x"),
    peer2: nodeField(doc2, "n1", "x"),
    peer3: nodeField(doc3, "n1", "x"),
    genuine: nodeField(doc2, "n1", "y"),
  };
  cs.destroy();
  return result;
}

describe("WP4 — discrimination through the shadow-rebase seam", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 seam ON: the stale value never leaves this client", async () => {
    const on = await runScenario(true);
    expect(on.local).toBe(500);
    expect(on.peer2).toBe(500);
    expect(on.peer3).toBe(500);
    expect(on.genuine, "the genuine change must still propagate").toBe(40);
  });

  it("T2 seam OFF: the same fixture reproduces the cascade", async () => {
    const off = await runScenario(false);
    expect(
      off.local,
      "with the rebase disabled the capture path must fall back to observation-as-intent",
    ).toBe(0);
    expect(off.peer2, "the stale value must reach the peers when the mechanism is off").toBe(0);
    expect(off.peer3).toBe(0);
  });

  it("T3 the seam is the only difference between the two outcomes", async () => {
    const on = await runScenario(true);
    const off = await runScenario(false);
    expect(on.peer2).not.toBe(off.peer2);
    expect(on.peer3).not.toBe(off.peer3);
  });
});
