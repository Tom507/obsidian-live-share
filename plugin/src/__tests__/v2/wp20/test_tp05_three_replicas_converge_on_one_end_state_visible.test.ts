// WP20 / AC3 (second half) — "several clients auditing concurrently reach the
// same end state."
//
// THREE replicas, never two. With two, an agreed-but-wrong outcome and a
// genuinely converged one are the same picture, and the interleaving classes
// that only appear from three peers upward are exactly where a repair pass goes
// wrong: replica 1 quarantines, replica 2 quarantines, replica 3 receives both
// and has to not treat either as news.
//
// All three see the same broken doc and audit BEFORE any of them has seen
// another's verdict — that is what "concurrently" means here. Only afterwards
// are the updates exchanged in a full mesh.
//
// THE ASSERTION IS DELIBERATELY NOT "REPLICA 1 WON". Three replicas writing
// `deleted["…"]` concurrently produce three same-key CRDT writes, and Yjs
// tie-breaks those on a `random.uint32()` clientID — so `by` is a coin flip and
// asserting a particular one passes about a third of the time. What is NOT a
// coin flip is that every candidate value carries the same VERDICT, so the two
// legitimate oracles are:
//
//   ├── AGREEMENT — all three replicas hold the byte-identical tombstone entry
//   │      and project the byte-identical file, and
//   └── FIXED POINT — auditing again after the exchange emits nothing further,
//          i.e. no replica reads another's quarantine as work to do.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "mesh.canvas";

function createVault() {
  const files = new Map<string, string>();
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

async function auditingClient(path: string) {
  const vault = createVault();
  const syncManager = createSyncManager();
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
}

function record(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

/** Every replica's audit timer fires with no replica having seen another's. */
function auditAllConcurrently(): void {
  vi.runOnlyPendingTimers();
}

function project(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
}

describe("WP20 AC3 — three replicas auditing concurrently reach one end state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("all three agree on the quarantine and on the projected file, and the state is a fixed point", async () => {
    // The broken doc every replica starts from, authored by a fourth party.
    const origin = new Y.Doc();
    origin.transact(() => {
      const nodes = origin.getMap<Y.Map<unknown>>("nodes");
      nodes.set(
        "hub",
        record({
          id: "hub",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(240, 120),
          text: "hub",
        }),
      );
      nodes.set(
        "leaf",
        record({
          id: "leaf",
          type: "text",
          pos: encodePos(500, 0),
          size: encodeSize(240, 120),
          text: "leaf",
        }),
      );
      // Fault A — a `file` node with no `file` (MISSING_TYPE_SPECIFIC).
      nodes.set(
        "orphan",
        record({
          id: "orphan",
          type: "file",
          pos: encodePos(0, 500),
          size: encodeSize(300, 300),
        }),
      );
      // Fault B — an edge with only one endpoint (MISSING_TO).
      origin
        .getMap<Y.Map<unknown>>("edges")
        .set("halfarrow", record({ id: "halfarrow", from: encodeEndpoint("hub", "right") }));
      // The control arrow, whole in every respect.
      origin.getMap<Y.Map<unknown>>("edges").set(
        "whole",
        record({
          id: "whole",
          from: encodeEndpoint("hub", "right"),
          to: encodeEndpoint("leaf", "left"),
        }),
      );
    });
    const seed = Y.encodeStateAsUpdate(origin);

    const replicas = [
      await auditingClient(PATH),
      await auditingClient(PATH),
      await auditingClient(PATH),
    ];
    for (const replica of replicas) Y.applyUpdate(replica.doc, seed, "remote");

    // Concurrent: all three audit before any of them has seen another's write.
    auditAllConcurrently();

    for (const [index, replica] of replicas.entries()) {
      expect(
        isTombstoneQuarantined(readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), "orphan")),
        `replica ${index + 1} did not quarantine the invalid node on its own audit`,
      ).toBe(true);
    }

    // FULL MESH exchange — every replica receives every other replica's verdict.
    const deltas = replicas.map((replica) => Y.encodeStateAsUpdate(replica.doc));
    for (const replica of replicas) {
      for (const delta of deltas) Y.applyUpdate(replica.doc, delta, "remote");
    }
    auditAllConcurrently();

    // AGREEMENT — never "replica 1's value won"; `by` is a Yjs coin flip.
    const entries = replicas.map((replica) => ({
      orphan: readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), "orphan"),
      halfarrow: readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), "halfarrow"),
      whole: readTombstoneEntry(replica.doc.getMap<unknown>("deleted"), "whole"),
    }));
    expect(entries[1], "replica 2's tombstone state differs from replica 1's").toEqual(entries[0]);
    expect(entries[2], "replica 3's tombstone state differs from replica 1's").toEqual(entries[0]);
    expect(
      isTombstoneQuarantined(entries[0].orphan),
      "the converged state does not hold the invalid node quarantined",
    ).toBe(true);
    expect(
      isTombstoneQuarantined(entries[0].halfarrow),
      "the converged state does not hold the endpoint-less edge quarantined",
    ).toBe(true);
    expect(
      entries[0].whole,
      "the converged state quarantined the whole, valid arrow",
    ).toBeUndefined();

    const files = replicas.map((replica) => project(replica.doc));
    expect(files[1], "replica 2 projects a different file from replica 1").toBe(files[0]);
    expect(files[2], "replica 3 projects a different file from replica 1").toBe(files[0]);
    const parsed = JSON.parse(files[0]) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(parsed.nodes.map((node) => String(node.id)).sort()).toEqual(["hub", "leaf"]);
    expect(parsed.edges.map((edge) => String(edge.id))).toEqual(["whole"]);

    // FIXED POINT — nobody reads anybody else's quarantine as work to do.
    let updates = 0;
    for (const replica of replicas) {
      replica.doc.on("update", () => {
        updates += 1;
      });
    }
    auditAllConcurrently();
    auditAllConcurrently();
    expect(
      updates,
      "an audit after convergence still emitted deltas: the replicas re-quarantine each other forever",
    ).toBe(0);

    for (const replica of replicas) replica.cs.destroy();
  });
});
