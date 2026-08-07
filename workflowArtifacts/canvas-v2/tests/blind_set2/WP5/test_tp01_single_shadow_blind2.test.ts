// WP5 / AC1 — one structure, proven by SELECTIVITY rather than by a whole pass.
//
// Angle: three records, and a receipt that confirms exactly ONE of them. If the
// reconcile side and the capture side were two structures — or if the advance were
// still whole-snapshot — the capture path could not possibly distinguish the one
// confirmed record from the two unconfirmed ones on the very next save.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type ApplyOutcome,
  type SurfaceState,
  advanceFromReceipt,
  buildApplyReceipt,
  getField,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "kanban.canvas";

const CARDS = [
  { id: "c1", type: "text", x: 0, y: 0, width: 180, height: 90, text: "one", color: "1" },
  { id: "c2", type: "text", x: 200, y: 0, width: 180, height: 90, text: "two", color: "2" },
  { id: "c3", type: "text", x: 400, y: 0, width: 180, height: 90, text: "three", color: "3" },
];

function canvasJson(nodes: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges: [] });
}

function createVault(initial: Record<string, string>) {
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
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

function docRecords(doc: Y.Doc) {
  const out: Record<string, unknown>[] = [];
  for (const [, record] of doc.getMap<Y.Map<unknown>>("nodes")) {
    out.push(Object.fromEntries(record.entries()));
  }
  return { nodes: out, edges: [] as Record<string, unknown>[] };
}

function nodeField(doc: Y.Doc, id: string, field: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(field);
}

async function makePeer() {
  const vault = createVault({ [PATH]: canvasJson(CARDS) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: true,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(PATH, "host");
  return { vault, cs, doc: syncManager.getDoc(`__canvas__:${PATH}`).doc };
}

describe("WP5 AC1 (blind2) — one confirmed record out of three", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the capture path distinguishes the confirmed record from the other two", async () => {
    const p = await makePeer();

    // Three peers each recolour one card.
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("c1")?.set("color", "9");
      nodes.get("c2")?.set("color", "8");
      nodes.get("c3")?.set("color", "7");
    });

    // The single writer flushes those recolours to disk, which moves
    // `lastWrittenContent` off the seed content. Without this the save below would
    // be BYTE-IDENTICAL to the file the host seed stored and WP4's echo breaker
    // would return before the shadow is ever consulted. The view is open, so this
    // write advances no field — only the receipt below may do that.
    const persisted = serializeCanvas(
      p.doc.getMap<Y.Map<unknown>>("nodes"),
      p.doc.getMap<Y.Map<unknown>>("edges"),
    );
    p.vault.files.set(PATH, persisted);
    p.cs.noteExternalDiskWrite(PATH, persisted);
    await vi.runOnlyPendingTimersAsync();

    // Only c2 reached the surface this pass.
    advanceFromReceipt(
      p.cs.getSurfaceShadow(),
      buildApplyReceipt({
        path: PATH,
        desired: docRecords(p.doc),
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>([
          ["c1", "interacting"],
          ["c2", "applied"],
          ["c3", "missing"],
        ]),
      }),
    );

    const shadow = p.cs.getSurfaceShadow();
    expect(getField(shadow, PATH, "node", "c1", "color")).toBe("1");
    expect(getField(shadow, PATH, "node", "c2", "color")).toBe("8");
    expect(getField(shadow, PATH, "node", "c3", "color")).toBe("3");

    // Obsidian saves the view, which still shows the ORIGINAL colours everywhere:
    // c2 is the only card whose value the shadow proves the surface received, so it
    // is the only one whose stale re-statement is real intent.
    p.vault.files.set(PATH, canvasJson(CARDS));
    await p.cs.handleLocalModify(PATH);

    expect(nodeField(p.doc, "c1", "color"), "an unconfirmed card reverted a peer").toBe("9");
    expect(nodeField(p.doc, "c3", "color"), "an unconfirmed card reverted a peer").toBe("7");
    expect(nodeField(p.doc, "c2", "color"), "a confirmed card's genuine edit was swallowed").toBe(
      "2",
    );
  });

  it("the projection shows exactly the same selectivity to the classifier", async () => {
    const p = await makePeer();
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("c1")?.set("x", 11);
      nodes.get("c2")?.set("x", 222);
    });

    advanceFromReceipt(
      p.cs.getSurfaceShadow(),
      buildApplyReceipt({
        path: PATH,
        desired: docRecords(p.doc),
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>([
          ["c1", "unsupported"],
          ["c2", "unchanged"],
          ["c3", "applied"],
        ]),
      }),
    );

    const projected = shadowToCanvasRecords(p.cs.getSurfaceShadow(), PATH);
    const byId = new Map<string, Record<string, unknown>>();
    for (const record of (projected?.nodes ?? []) as Record<string, unknown>[]) {
      byId.set(record.id as string, record);
    }
    expect(byId.get("c1")?.x, "an unsupported apply leaked into the classifier basis").toBe(0);
    expect(byId.get("c2")?.x, "`unchanged` is a confirmed apply").toBe(222);
    expect(byId.get("c3")?.x).toBe(400);
  });
});
