// WP4 / AC1 — the intent plan is the write basis (edge-centric angle).
//
// Same property as the node case, attacked through the edge id space and through
// the two states the node case never reaches: a record the shadow has never seen
// (`unknown`) and a record the shadow knows is gone (`absent`).
//
//   ├── T1 an edge re-routed by a peer is not un-routed by a stale save, even
//   │      though `lastWrittenContent` says the local file changed it.
//   ├── T2 a record unknown to the shadow is upserted field by field — the
//   │      mechanism must not mistake "never observed" for "already agreed".
//   ├── T3 a shrinking save deletes nothing while the view is closed, for edges
//   │      as well as nodes.
//   └── T4 an edge handed to an open view and then missing IS deleted.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type SurfaceState, getField, getRecordState } from "../../../canvas/canvas-shadow";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "Teams/Q3 Planning/roadmap.canvas";

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

function applyRemoteDelta(
  doc: Y.Doc,
  build: (nodes: Y.Map<Y.Map<unknown>>, edges: Y.Map<Y.Map<unknown>>) => void,
): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"), remote.getMap<Y.Map<unknown>>("edges"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "peer");
  remote.destroy();
}

function rec(doc: Y.Doc, which: "nodes" | "edges", id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>(which).get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const A = { id: "task-a", type: "text", x: 0, y: 0, width: 180, height: 60, text: "spec" };
const B = { id: "task-b", type: "text", x: 400, y: 0, width: 180, height: 60, text: "ship" };
const LINK = { id: "lnk", fromNode: "task-a", toNode: "task-b", fromSide: "right", toSide: "left" };

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
  cs.noteExternalDiskWrite(PATH, diskJson);
  await settle();
  return { vault, cs, doc, surface };
}

describe("WP4 AC1 (edge angle) — the shadow decides, the baseline does not", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 a peer's edge re-route survives a save the baseline calls a change", async () => {
    const p = await makePeer(canvasJson([A, B], [LINK]));
    p.surface.viewOpen = true;
    p.surface.handedToView.edge.add("lnk");
    p.surface.handedToView.node.add("task-a");
    p.surface.handedToView.node.add("task-b");

    applyRemoteDelta(p.doc, (_nodes, edges) => {
      edges.get("lnk")?.set("fromSide", "bottom");
      edges.get("lnk")?.set("toSide", "top");
    });
    const persisted = serializeCanvas(
      p.doc.getMap<Y.Map<unknown>>("nodes"),
      p.doc.getMap<Y.Map<unknown>>("edges"),
    );
    p.vault.files.set(PATH, persisted);
    p.cs.noteExternalDiskWrite(PATH, persisted); // view OPEN → baseline only
    await settle();

    expect(getField(p.cs.getSurfaceShadow(), PATH, "edge", "lnk", "fromSide")).toBe("right");

    // The stale open view saves the original routing.
    p.vault.files.set(PATH, canvasJson([A, B], [LINK]));
    await p.cs.handleLocalModify(PATH);

    expect(rec(p.doc, "edges", "lnk", "fromSide")).toBe("bottom");
    expect(rec(p.doc, "edges", "lnk", "toSide")).toBe("top");
  });

  it("T2 a record unknown to the shadow is upserted field by field", async () => {
    const p = await makePeer(canvasJson([A, B], [LINK]));

    const NEW_NODE = { id: "task-c", type: "text", x: 0, y: 300, width: 180, height: 60, text: "qa" };
    const NEW_EDGE = {
      id: "lnk2",
      fromNode: "task-b",
      toNode: "task-c",
      fromSide: "bottom",
      toSide: "top",
    };
    p.vault.files.set(PATH, canvasJson([A, B, NEW_NODE], [LINK, NEW_EDGE]));
    await p.cs.handleLocalModify(PATH);

    expect(rec(p.doc, "nodes", "task-c", "text")).toBe("qa");
    expect(rec(p.doc, "nodes", "task-c", "y")).toBe(300);
    expect(rec(p.doc, "edges", "lnk2", "fromNode")).toBe("task-b");
    expect(rec(p.doc, "edges", "lnk2", "toSide")).toBe("top");
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "node", "task-c")).toBe("present");
    expect(getField(p.cs.getSurfaceShadow(), PATH, "edge", "lnk2", "fromSide")).toBe("bottom");
  });

  it("T3 a shrinking save deletes neither the node nor the edge while the view is closed", async () => {
    const p = await makePeer(canvasJson([A, B], [LINK]));

    p.vault.files.set(PATH, canvasJson([A], []));
    await p.cs.handleLocalModify(PATH);

    expect(p.doc.getMap<Y.Map<unknown>>("nodes").has("task-b")).toBe(true);
    expect(p.doc.getMap<Y.Map<unknown>>("edges").has("lnk")).toBe(true);
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "edge", "lnk")).toBe("present");
  });

  it("T4 an edge handed to an open view and then missing is deleted", async () => {
    const p = await makePeer(canvasJson([A, B], [LINK]));
    p.surface.viewOpen = true;
    p.surface.handedToView.edge.add("lnk");
    p.surface.handedToView.node.add("task-a");
    p.surface.handedToView.node.add("task-b");

    p.vault.files.set(PATH, canvasJson([A, B], []));
    await p.cs.handleLocalModify(PATH);

    expect(p.doc.getMap<Y.Map<unknown>>("edges").has("lnk")).toBe(false);
    expect(p.doc.getMap<Y.Map<unknown>>("nodes").has("task-b")).toBe(true);
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "edge", "lnk")).toBe("absent");
  });
});
