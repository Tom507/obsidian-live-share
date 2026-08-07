// WP94 / C94 — the shared fixture for the delete-licence suite.
//
// ONE rule governs every helper here, and it is the vacuity risk the charter
// names as "the killer, and it is the class that hid this for the whole run":
//
//   THE HAND-OVER SET IS NEVER INJECTED BY HAND.
//
// Every WP19, WP2 and WP15 delete test passes `handedToView: {node: new
// Set([...])}` as a literal at `setSurfaceStateProvider`, which manufactures a
// precondition production cannot reach for a locally-created record. That is
// exactly why S78 survived a whole run behind green tests. Here the store is the
// REAL `createSurfaceStateStore`, wired as `main.ts` wires it, so the only way a
// P1 hand-over can appear is `advanceFromReceipt` -> `noteHandover`.
//
// The precedent is `wp5v2/test_tp05`'s `makePeer`, reused rather than reinvented.

import { TFile } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import {
  type ApplyOutcome,
  type ReceiptSurface,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceStateStore,
} from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

export const PATH = "wiki/board.canvas";

/** A `text` node that the ingest boundary ADMITS — `text` is required by type. */
export function node(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, type: "text", text: "", x: 0, y: 0, width: 200, height: 100, ...over };
}

/** An edge the ingest boundary admits: both endpoints named. */
export function edge(id: string, from: string, to: string): Record<string, unknown> {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

export function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  /**
   * AC3 conjunct 2 — THE I/O SEAM. `read` is a real function of `files`, so "the
   * bytes did not change" is never true for free: a test that wants an UNSTABLE
   * read installs a queue here and gets genuinely different bytes on the two
   * reads of one pass, which is what a mid-write observation looks like.
   */
  const nextReads: string[] = [];
  return {
    files,
    nextReads,
    read: vi.fn(async (file: { path: string }) => {
      if (nextReads.length > 0) return nextReads.shift() as string;
      return files.get(file.path) ?? "";
    }),
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

export function createSyncManager() {
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

export interface Peer {
  vault: ReturnType<typeof createVault>;
  cs: CanvasSync;
  doc: Y.Doc;
  store: ReturnType<typeof createSurfaceStateStore>;
  openPaths: Set<string>;
  logs: string[];
}

/**
 * A subscribed client wired exactly as `main.ts` wires one.
 *
 * `viewOpen` defaults to OPEN because that is the shape B50 measured; AC7 closes
 * it. `subscribe(PATH, role)` runs the real host seed when `role === "host"`.
 */
export async function makePeer(
  diskJson: string,
  opts: { viewOpen?: boolean; role?: "host" | "guest" } = {},
): Promise<Peer> {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const logs: string[] = [];
  cs.setLogger({
    debug: (_area: string, message: string) => logs.push(message),
    warn: (_area: string, message: string) => logs.push(`WARN ${message}`),
  });

  const openPaths = new Set<string>(opts.viewOpen === false ? [] : [PATH]);
  const store = createSurfaceStateStore((path: string) => openPaths.has(path));
  cs.setSurfaceStateProvider((path: string) => store.stateFor(path));

  await cs.subscribe(PATH, opts.role ?? "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, store, openPaths, logs };
}

/** Write the file and drive the REAL vault-modify entry point. */
export async function save(peer: Peer, json: string): Promise<void> {
  peer.vault.files.set(PATH, json);
  await peer.cs.handleLocalModify(PATH);
}

/**
 * THE ORACLE. Never `nodesMap.has(id)` — WP19 never removes a key, so that reads
 * `true` in both arms and cannot fail. Never the projection alone for an edge —
 * WP19 AC3's `visibleNodeIds` cascade suppresses an edge whose node went, so an
 * UNCAPTURED edge delete looks identical to a captured one.
 */
export function isDeleted(doc: Y.Doc, id: string): boolean {
  return isTombstoneSuppressed(readTombstoneEntry(doc.getMap<unknown>("deleted"), id));
}

/** What the user would see: the one doc→file/view projection. */
export function projection(doc: Y.Doc): { nodes: string[]; edges: string[] } {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
  return {
    nodes: data.nodes.map((n) => String(n.id)),
    edges: data.edges.map((e) => String(e.id)),
  };
}

/** Is the id's container in the doc at all? (create/receipt oracle, not a delete oracle) */
export function inDoc(doc: Y.Doc, kind: "node" | "edge", id: string): boolean {
  return doc.getMap<Y.Map<unknown>>(kind === "node" ? "nodes" : "edges").get(id) !== undefined;
}

/** Records currently projected from the doc, in the shape a receipt wants. */
export function docRecords(doc: Y.Doc): {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} {
  const deleted = doc.getMap<unknown>("deleted");
  const read = (name: string): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const [id, record] of doc.getMap<Y.Map<unknown>>(name)) {
      if (isTombstoneSuppressed(readTombstoneEntry(deleted, id))) continue;
      out.push(Object.fromEntries(record.entries()));
    }
    return out;
  };
  return { nodes: read("nodes"), edges: read("edges") };
}

/**
 * P1, THROUGH THE PRODUCTION SEAM. One landed structural reload reported through
 * `buildApplyReceipt` -> `advanceFromReceipt` -> `noteHandover`, which is the
 * only production producer of `handedToView`.
 */
export function confirmReload(peer: Peer, reloaded = true) {
  const summary = advanceFromReceipt(
    peer.cs.getSurfaceShadow(),
    buildApplyReceipt({ path: PATH, desired: docRecords(peer.doc), plan: "structural", reloaded }),
  );
  peer.store.noteHandover(PATH, summary.handed);
  return summary;
}

/** A GEOMETRY pass — the branch where S82's node/edge asymmetry lives. */
export function confirmGeometry(peer: Peer, nodeOutcomes: Map<string, ApplyOutcome>, reloaded = false) {
  const summary = advanceFromReceipt(
    peer.cs.getSurfaceShadow(),
    buildApplyReceipt({
      path: PATH,
      desired: docRecords(peer.doc),
      plan: "geometry",
      reloaded,
      nodeOutcomes,
    }),
  );
  peer.store.noteHandover(PATH, summary.handed);
  return summary;
}

/** The receipt surface the store reports for one record, or `null`. */
export function receiptFor(peer: Peer, kind: "node" | "edge", id: string): ReceiptSurface | null {
  const state = peer.cs.surfaceEvidenceFor(PATH);
  if (state.handedToView[kind].has(id)) return "view";
  return state.receipts?.[kind].get(id) ?? null;
}

export const ALL_DECLINE_REASONS = [
  "echo",
  "not-subscribed",
  "read-only",
  "schema-major",
  "no-doc",
  "no-file",
] as const;
