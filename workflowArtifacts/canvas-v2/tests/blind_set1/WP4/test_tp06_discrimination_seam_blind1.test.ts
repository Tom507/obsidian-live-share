// WP4 — DISCRIMINATION through `setShadowRebaseEnabled` (edge angle, outbound
// delta as the oracle).
//
// Same seam, different measurement. Instead of reading the peers' docs after a
// full exchange, this variant weighs what the offscreen client actually PUTS ON
// THE WIRE: `Y.encodeStateAsUpdate(doc, svBefore)` replayed onto a replica that
// already holds the peer's routing. That distinguishes "the field was not
// written" from "the field was written with a value that happened to lose".
//
//   ├── T1 seam ON  → the replay leaves the peer's routing intact.
//   ├── T2 seam OFF → the same replay un-routes the edge, so the measurement is
//   │      able to see a push at all.
//   └── T3 the seam does not silence genuine intent in either mode — only the
//          stale field differs between the two runs.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "Notes/wiring.canvas";

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

function rec(doc: Y.Doc, which: "nodes" | "edges", id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>(which).get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const L = { id: "l", type: "text", x: 0, y: 0, width: 150, height: 60, text: "left" };
const R = { id: "r", type: "text", x: 400, y: 0, width: 150, height: 60, text: "right" };
const ARROW = { id: "a", fromNode: "l", toNode: "r", fromSide: "right", toSide: "left" };
const BASE = canvasJson([L, R], [ARROW]);

/** One scenario, parameterised only by the seam. Returns the WIRE result. */
async function wireResult(shadowRebase: boolean) {
  const vault = createVault({ [PATH]: BASE });
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
  const local = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, BASE);
  await settle();

  const peer = new Y.Doc();
  push(local, peer);
  peer.transact(() => {
    peer.getMap<Y.Map<unknown>>("edges").get("a")?.set("toSide", "bottom");
  });
  push(peer, local);

  const before = Y.encodeStateVector(local);
  const witness = new Y.Doc();
  Y.applyUpdate(witness, Y.encodeStateAsUpdate(local), "peer");

  // The offscreen surface saves the old routing plus a real rename.
  vault.files.set(PATH, canvasJson([L, { ...R, text: "right side" }], [ARROW]));
  await cs.handleLocalModify(PATH);
  Y.applyUpdate(witness, Y.encodeStateAsUpdate(local, before), "peer");

  const result = {
    routing: rec(witness, "edges", "a", "toSide"),
    rename: rec(witness, "nodes", "r", "text"),
  };
  cs.destroy();
  return result;
}

describe("WP4 — the shadow-rebase seam discriminates on the wire", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 seam ON: the replay leaves the peer's routing intact", async () => {
    const on = await wireResult(true);
    expect(on.routing).toBe("bottom");
    expect(on.rename).toBe("right side");
  });

  it("T2 seam OFF: the same replay un-routes the edge", async () => {
    const off = await wireResult(false);
    expect(off.routing, "with the rebase off, observation is intent again").toBe("left");
  });

  it("T3 only the stale field differs between the two runs", async () => {
    const on = await wireResult(true);
    const off = await wireResult(false);
    expect(on.routing).not.toBe(off.routing);
    expect(on.rename).toBe(off.rename);
  });
});
