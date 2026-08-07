// WP5 / AC1 — one structure for reconcile classification and capture basis.
//
// Different angle from the geometry-first case: everything here happens in the
// EDGE id space, on a GUEST peer, with `null` and `0` as real field values. If the
// receipt were wired to a node-only or a truthy-only advance, the whole file dies.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type SurfaceState,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  getRecordState,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "flows/pipeline.canvas";

const A = { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "in" };
const B = { id: "b", type: "text", x: 400, y: 0, width: 100, height: 50, text: "out" };
const E = {
  id: "e-ab",
  fromNode: "a",
  toNode: "b",
  fromSide: "right",
  toSide: "left",
  label: null as string | null,
  weight: 0,
};

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges });
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

function docRecords(doc: Y.Doc) {
  const read = (name: string): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const [, record] of doc.getMap<Y.Map<unknown>>(name)) {
      out.push(Object.fromEntries(record.entries()));
    }
    return out;
  };
  return { nodes: read("nodes"), edges: read("edges") };
}

function edgeField(doc: Y.Doc, id: string, field: string): unknown {
  return doc.getMap<Y.Map<unknown>>("edges").get(id)?.get(field);
}

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

/** A GUEST peer: the doc is seeded by the remote side, never by this client. */
async function makeGuest() {
  const vault = createVault({ [PATH]: canvasJson([A, B], [E]) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  // The shared state arrives from a peer before this client subscribes.
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    for (const record of [A, B]) {
      const map = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(record)) map.set(k, v);
      nodes.set(record.id, map);
    }
    const edge = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(E)) edge.set(k, v);
    edges.set(E.id, edge);
  });

  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const surface = {
    viewOpen: true,
    handedToView: { node: new Set<string>(), edge: new Set<string>(["e-ab"]) },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "guest");
  return { vault, cs, doc, surface };
}

describe("WP5 AC1 (blind1) — the edge id space proves the same single structure", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a guest that never observed the surface starts unknown", async () => {
    const p = await makeGuest();
    expect(shadowToCanvasRecords(p.cs.getSurfaceShadow(), PATH)).toBeNull();
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "edge", "e-ab")).toBe("unknown");
    // The live instance is stable — two reads are the same object, not a copy.
    expect(p.cs.getSurfaceShadow()).toBe(p.cs.getSurfaceShadow());
  });

  it("a confirmed apply of an edge silences that edge's later save", async () => {
    const p = await makeGuest();
    advanceFromReceipt(
      p.cs.getSurfaceShadow(),
      buildApplyReceipt({
        path: PATH,
        desired: docRecords(p.doc),
        plan: "structural",
        reloaded: true,
      }),
    );

    // `null` and `0` must be stored as OBSERVED values, not as "never observed".
    expect(getField(p.cs.getSurfaceShadow(), PATH, "edge", "e-ab", "label")).toBeNull();
    expect(getField(p.cs.getSurfaceShadow(), PATH, "edge", "e-ab", "weight")).toBe(0);

    const before = fingerprint(p.doc);
    p.vault.files.set(
      PATH,
      canvasJson(
        [B, A],
        [{ weight: 0, label: null, toSide: "left", fromSide: "right", toNode: "b", fromNode: "a", id: "e-ab" }],
      ),
    );
    await p.cs.handleLocalModify(PATH);

    expect(fingerprint(p.doc), "the edge receipt never reached the capture basis").toBe(before);
  });

  it("a real edge re-route after the receipt is still intent", async () => {
    const p = await makeGuest();
    advanceFromReceipt(
      p.cs.getSurfaceShadow(),
      buildApplyReceipt({
        path: PATH,
        desired: docRecords(p.doc),
        plan: "structural",
        reloaded: true,
      }),
    );

    p.vault.files.set(PATH, canvasJson([A, B], [{ ...E, toSide: "top", label: "ok" }]));
    await p.cs.handleLocalModify(PATH);

    expect(edgeField(p.doc, "e-ab", "toSide")).toBe("top");
    expect(edgeField(p.doc, "e-ab", "label")).toBe("ok");
  });

  it("replacing the instance moves both roles, including the edge space", async () => {
    const p = await makeGuest();
    advanceFromReceipt(
      p.cs.getSurfaceShadow(),
      buildApplyReceipt({
        path: PATH,
        desired: docRecords(p.doc),
        plan: "structural",
        reloaded: true,
      }),
    );

    const replacement = createSurfaceShadow();
    p.cs.setSurfaceShadow(replacement);
    expect(p.cs.getSurfaceShadow()).toBe(replacement);
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "edge", "e-ab")).toBe("unknown");

    // With an empty basis every observed field is intent again.
    p.vault.files.set(PATH, canvasJson([A, B], [{ ...E, weight: 3 }]));
    await p.cs.handleLocalModify(PATH);
    expect(edgeField(p.doc, "e-ab", "weight")).toBe(3);
    expect(getField(replacement, PATH, "edge", "e-ab", "weight")).toBe(3);
  });
});
