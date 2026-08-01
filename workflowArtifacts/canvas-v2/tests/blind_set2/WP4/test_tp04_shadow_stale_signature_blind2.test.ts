// WP4 / AC4 — zero writes for the stale field, one `SHADOW STALE:` line
// (awkward-identifier and null-value angle).
//
// The signature has to survive the data it describes: an id containing a dot, an
// id that is a bare number, a field whose stale value is `null`. None of those
// may change WHETHER the field is suppressed, and none may make the line lie
// about which record it refers to.
//
// The state assertions come first in every case; the line is checked afterwards.
//
//   ├── T1 a `null` stale value suppresses the write and is still reported.
//   ├── T2 an id with a dot and a numeric id are reported verbatim.
//   ├── T3 a save with no divergent field emits nothing at all.
//   └── T4 two paths saved in turn each get their own line naming their own path.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const MAIN = "notes/main.canvas";
const SIDE = "notes/side.canvas";
const SIGNATURE = "SHADOW STALE:";

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

const DOTTED = {
  id: "sec.1",
  type: "text",
  x: 0,
  y: 0,
  width: 180,
  height: 80,
  text: "intro",
  color: null,
};
const NUMERIC = { id: "42", type: "text", x: 220, y: 0, width: 180, height: 80, text: "answer" };
const SIDE_NODE = { id: "s", type: "text", x: 0, y: 0, width: 100, height: 40, text: "side" };

async function makeSync() {
  const vault = createVault({
    [MAIN]: canvasJson([DOTTED, NUMERIC]),
    [SIDE]: canvasJson([SIDE_NODE]),
  });
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
  await cs.subscribe(MAIN, "host");
  await cs.subscribe(SIDE, "host");
  await settle();
  return {
    vault,
    cs,
    debugs,
    main: syncManager.getDoc(`__canvas__:${MAIN}`).doc,
    side: syncManager.getDoc(`__canvas__:${SIDE}`).doc,
  };
}

const hits = (lines: string[]): string[] => lines.filter((m) => m.includes(SIGNATURE));

describe("WP4 AC4 (awkward ids) — the suppressed field is named correctly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a null stale value suppresses the write and is reported", async () => {
    const t = await makeSync();

    applyRemoteDelta(t.main, (nodes) => {
      nodes.get("sec.1")?.set("color", "4");
    });

    t.debugs.length = 0;
    t.vault.files.set(MAIN, canvasJson([{ ...DOTTED, y: 9 }, NUMERIC]));
    await t.cs.handleLocalModify(MAIN);

    expect(nodeField(t.main, "sec.1", "color"), "a stale null wiped the colour").toBe("4");
    expect(nodeField(t.main, "sec.1", "y")).toBe(9);

    const lines = hits(t.debugs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("node/sec.1.color");
  });

  it("T2 a numeric id is reported verbatim next to a dotted one", async () => {
    const t = await makeSync();

    applyRemoteDelta(t.main, (nodes) => {
      nodes.get("42")?.set("text", "peer answer");
      nodes.get("sec.1")?.set("x", 77);
    });

    t.debugs.length = 0;
    t.vault.files.set(MAIN, canvasJson([DOTTED, { ...NUMERIC, height: 81 }]));
    await t.cs.handleLocalModify(MAIN);

    expect(nodeField(t.main, "42", "text")).toBe("peer answer");
    expect(nodeField(t.main, "sec.1", "x")).toBe(77);
    expect(nodeField(t.main, "42", "height")).toBe(81);

    const lines = hits(t.debugs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("node/42.text");
    expect(lines[0]).toContain("node/sec.1.x");
  });

  it("T3 nothing divergent, nothing logged", async () => {
    const t = await makeSync();

    t.debugs.length = 0;
    t.vault.files.set(MAIN, canvasJson([{ ...DOTTED, x: 1 }, NUMERIC]));
    await t.cs.handleLocalModify(MAIN);

    expect(nodeField(t.main, "sec.1", "x")).toBe(1);
    expect(hits(t.debugs)).toHaveLength(0);
  });

  it("T4 each path gets its own line naming its own path", async () => {
    const t = await makeSync();

    applyRemoteDelta(t.main, (nodes) => {
      nodes.get("sec.1")?.set("text", "peer intro");
    });
    applyRemoteDelta(t.side, (nodes) => {
      nodes.get("s")?.set("text", "peer side");
    });

    t.debugs.length = 0;
    t.vault.files.set(MAIN, canvasJson([{ ...DOTTED, x: 2 }, NUMERIC]));
    await t.cs.handleLocalModify(MAIN);
    t.vault.files.set(SIDE, canvasJson([{ ...SIDE_NODE, x: 3 }]));
    await t.cs.handleLocalModify(SIDE);

    const lines = hits(t.debugs);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(MAIN);
    expect(lines[1]).toContain(SIDE);
    expect(nodeField(t.main, "sec.1", "text")).toBe("peer intro");
    expect(nodeField(t.side, "s", "text")).toBe("peer side");
  });
});
