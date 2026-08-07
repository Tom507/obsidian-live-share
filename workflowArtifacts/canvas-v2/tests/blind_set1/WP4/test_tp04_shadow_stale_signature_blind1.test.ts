// WP4 / AC4 — zero writes for a stale field, `SHADOW STALE:` for the human
// (multi-field / logging-channel angle).
//
// Attacks the signature where a single-field case cannot: several divergent
// fields spread over both id spaces in ONE save, and the channel the line goes
// to. A discarded staleness is normal operation, not an anomaly — it belongs in
// the debug stream, next to the other capture narration, and never in the warn
// stream that the corruption signatures own.
//
//   ├── T1 four divergent fields across two records → the CRDT keeps all four
//   │      peer values and one line names all four.
//   ├── T2 the line is a debug line, never a warning.
//   └── T3 two consecutive saves produce two independent lines, and the second
//          one only mentions what is still divergent.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "Ops/incident map.canvas";
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

const HOST = { id: "svc", type: "text", x: 0, y: 0, width: 200, height: 90, text: "api", color: "3" };
const DB = { id: "db", type: "text", x: 320, y: 0, width: 200, height: 90, text: "postgres" };
const CALL = { id: "call", fromNode: "svc", toNode: "db", fromSide: "right", toSide: "left" };

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugs: string[] = [];
  const warns: string[] = [];
  cs.setLogger({
    debug: (_c: string, m: string) => debugs.push(m),
    warn: (_c: string, m: string) => warns.push(m),
  });
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
  return { vault, cs, doc, debugs, warns };
}

const hits = (lines: string[]): string[] => lines.filter((m) => m.includes(SIGNATURE));

describe("WP4 AC4 (multi-field) — every suppressed revert is named once", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 four divergent fields survive and are all named in one line", async () => {
    const p = await makePeer(canvasJson([HOST, DB], [CALL]));

    applyRemoteDelta(p.doc, (nodes, edges) => {
      nodes.get("svc")?.set("x", 111);
      nodes.get("svc")?.set("color", "6");
      nodes.get("db")?.set("text", "clickhouse");
      edges.get("call")?.set("fromSide", "bottom");
    });

    p.debugs.length = 0;
    p.vault.files.set(PATH, canvasJson([HOST, { ...DB, y: 12 }], [CALL]));
    await p.cs.handleLocalModify(PATH);

    expect(rec(p.doc, "nodes", "svc", "x")).toBe(111);
    expect(rec(p.doc, "nodes", "svc", "color")).toBe("6");
    expect(rec(p.doc, "nodes", "db", "text")).toBe("clickhouse");
    expect(rec(p.doc, "edges", "call", "fromSide")).toBe("bottom");
    expect(rec(p.doc, "nodes", "db", "y"), "the one genuine change was dropped").toBe(12);

    const lines = hits(p.debugs);
    expect(lines).toHaveLength(1);
    for (const entry of ["node/svc.x", "node/svc.color", "node/db.text", "edge/call.fromSide"]) {
      expect(lines[0], `${entry} missing from the signature`).toContain(entry);
    }
  });

  it("T2 the signature is a debug line, never a warning", async () => {
    const p = await makePeer(canvasJson([HOST, DB], [CALL]));

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("svc")?.set("x", 111);
    });

    p.debugs.length = 0;
    p.warns.length = 0;
    p.vault.files.set(PATH, canvasJson([{ ...HOST, text: "api v2" }, DB], [CALL]));
    await p.cs.handleLocalModify(PATH);

    expect(hits(p.debugs)).toHaveLength(1);
    expect(hits(p.warns), "staleness is routine, not a corruption warning").toHaveLength(0);
  });

  it("T3 a second save only names what is still divergent", async () => {
    const p = await makePeer(canvasJson([HOST, DB], [CALL]));

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("svc")?.set("x", 111);
      nodes.get("db")?.set("text", "clickhouse");
    });

    p.debugs.length = 0;
    p.vault.files.set(PATH, canvasJson([HOST, { ...DB, y: 12 }], [CALL]));
    await p.cs.handleLocalModify(PATH);
    expect(hits(p.debugs)).toHaveLength(1);

    // The reconciler pulls the view up for `db` only: the file now carries the
    // peer's text, so that field is no longer stale. `svc.x` still is.
    p.debugs.length = 0;
    p.vault.files.set(
      PATH,
      canvasJson([HOST, { ...DB, y: 13, text: "clickhouse" }], [CALL]),
    );
    await p.cs.handleLocalModify(PATH);

    const lines = hits(p.debugs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("node/svc.x");
    expect(lines[0]).not.toContain("node/db.text");
    expect(rec(p.doc, "nodes", "svc", "x")).toBe(111);
    expect(rec(p.doc, "nodes", "db", "y")).toBe(13);
  });
});
