// WP4 — DISCRIMINATION through `setShadowRebaseEnabled` (mechanism-and-evidence
// angle).
//
// A disabled mechanism must be silent as well as inert: with the rebase off there
// is no classification, so there is nothing to discard and nothing to report. The
// run therefore differs in BOTH observable channels — the CRDT state and the
// `SHADOW STALE:` evidence — which is what makes it impossible to fake the
// enabled outcome with a mute.
//
//   ├── T1 seam ON  → the peer's value survives AND the discard is evidenced.
//   ├── T2 seam OFF → the peer's value is overwritten AND no evidence exists.
//   ├── T3 the seam is re-armable inside one instance: off, then on, and the
//   │      second save is silent again.
//   └── T4 the seam does not touch the byte echo breaker.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "lab/seam.canvas";
const SIGNATURE = "SHADOW STALE:";
const ECHO_LINE = "no-op (disk == shared state)";

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

const CARD = { id: "s1", type: "text", x: 20, y: 20, width: 200, height: 100, text: "base" };
const BASE = canvasJson([CARD]);

async function makePeer(rebase: boolean) {
  const vault = createVault({ [PATH]: BASE });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugs: string[] = [];
  cs.setLogger({ debug: (_c: string, m: string) => debugs.push(m), warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  cs.setShadowRebaseEnabled(rebase);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, BASE);
  await settle();
  return { vault, cs, doc, debugs };
}

/** A peer moves the card; the offscreen client then saves its old picture. */
async function staleRound(
  p: { vault: ReturnType<typeof createVault>; cs: CanvasSync; doc: Y.Doc },
  peerX: number,
  localY: number,
): Promise<void> {
  applyRemoteDelta(p.doc, (nodes) => {
    nodes.get("s1")?.set("x", peerX);
  });
  p.vault.files.set(PATH, canvasJson([{ ...CARD, y: localY }]));
  await p.cs.handleLocalModify(PATH);
}

describe("WP4 — the seam changes state AND evidence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 seam ON: the peer's value survives and the discard is evidenced", async () => {
    const p = await makePeer(true);
    p.debugs.length = 0;
    await staleRound(p, 800, 21);

    expect(nodeField(p.doc, "s1", "x")).toBe(800);
    expect(nodeField(p.doc, "s1", "y")).toBe(21);
    expect(p.debugs.filter((m) => m.includes(SIGNATURE))).toHaveLength(1);
  });

  it("T2 seam OFF: the peer's value is overwritten and nothing is evidenced", async () => {
    const p = await makePeer(false);
    p.debugs.length = 0;
    await staleRound(p, 800, 21);

    expect(nodeField(p.doc, "s1", "x"), "the disabled path must write the observation").toBe(20);
    expect(p.debugs.filter((m) => m.includes(SIGNATURE))).toHaveLength(0);
  });

  it("T3 the seam is re-armable inside one instance", async () => {
    const p = await makePeer(false);
    await staleRound(p, 800, 21);
    expect(nodeField(p.doc, "s1", "x")).toBe(20);

    p.cs.setShadowRebaseEnabled(true);
    p.debugs.length = 0;
    await staleRound(p, 900, 22);

    expect(nodeField(p.doc, "s1", "x")).toBe(900);
    expect(nodeField(p.doc, "s1", "y")).toBe(22);
    expect(p.debugs.filter((m) => m.includes(SIGNATURE))).toHaveLength(1);
  });

  it("T4 the seam does not touch the byte echo breaker", async () => {
    const p = await makePeer(false);
    p.debugs.length = 0;
    await p.cs.handleLocalModify(PATH); // the file still equals the last write

    expect(p.debugs.some((m) => m.includes(ECHO_LINE))).toBe(true);
    expect(nodeField(p.doc, "s1", "x")).toBe(20);
  });
});
