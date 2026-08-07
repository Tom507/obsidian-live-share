// WP20 AC2 blind1 — the lift on an EDGE, judged on the file bytes.
//
// The visible test lifts a node's quarantine. An edge is the harder case and
// the one the A.2/16 class is actually made of: the missing conjunct is a
// composite REGISTER (`to`), not a scalar, so the repair delta writes a whole
// `{node, side}` value into a slot that was empty — and the auditor has to
// notice that a register APPEARED, not that a field changed.
//
// The oracle is the serialised file rather than the tombstone flags, because
// what the user gets back is an arrow in their `.canvas`, and the arrow is only
// back if `fromNode`, `fromSide`, `toNode`, `toSide` and the label all survived
// the round trip through the quarantine. A tombstone that reads `on:false` over
// a record whose fields were quietly rebuilt is not a lift, it is a
// re-creation, and the file is where that shows.
//
// The still-broken second arrow is the control: it must stay off the file after
// the repair, so "the file has an arrow again" cannot be satisfied by an
// auditor that simply stopped quarantining anything.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  isTombstoneQuarantined,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "flow/pipeline.canvas";

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

function makePeer(target: Y.Doc) {
  const peer = new Y.Doc();
  return (mutate: (doc: Y.Doc) => void) => {
    peer.transact(() => mutate(peer));
    Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "remote");
  };
}

function audit(): void {
  vi.runOnlyPendingTimers();
}

function fileOf(doc: Y.Doc): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  return JSON.parse(
    serializeCanvas(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    ),
  );
}

describe("WP20 AC2 blind1 — a repair delta that supplies a whole endpoint register lifts the edge's quarantine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the arrow comes back into the file with every decoration intact, while the still-broken one does not", async () => {
    const client = await auditingClient(PATH);
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const nodes = peer.getMap<Y.Map<unknown>>("nodes");
      for (const [id, x] of [
        ["ingest", 0],
        ["transform", 400],
        ["sink", 800],
      ] as const) {
        nodes.set(
          id,
          record({
            id,
            type: "text",
            pos: encodePos(x, 0),
            size: encodeSize(300, 150),
            text: `stage ${id}`,
          }),
        );
      }
      const space = peer.getMap<Y.Map<unknown>>("edges");
      // The arrow that will be repaired: `to` never arrived.
      space.set(
        "step1",
        record({
          id: "step1",
          from: encodeEndpoint("ingest", "right", "none"),
          label: "raw rows",
          color: "5",
        }),
      );
      // The arrow that stays broken.
      space.set("step2", record({ id: "step2", from: encodeEndpoint("transform", "right") }));
    });

    const containerBefore = edges.get("step1");
    expect(containerBefore, "the fault injection never reached the doc").toBeDefined();

    audit();
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "step1")),
      "the endpoint-less arrow was never quarantined, so there is no quarantine to lift",
    ).toBe(true);
    expect(
      fileOf(client.doc).edges.map((edge) => String(edge.id)),
      "a quarantined arrow is still on the file",
    ).toEqual([]);

    // The repair: a peer writes the whole `to` register.
    push((peer) => {
      peer
        .getMap<Y.Map<unknown>>("edges")
        .get("step1")
        ?.set("to", encodeEndpoint("transform", "left", "arrow"));
    });
    audit();

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "step1")),
      "the auditor did not release the repaired arrow",
    ).toBe(false);
    expect(
      edges.get("step1"),
      "the arrow's container was replaced rather than released in place",
    ).toBe(containerBefore);

    const file = fileOf(client.doc);
    expect(
      file.edges.map((edge) => String(edge.id)),
      "the repaired arrow did not come back to the file, or the broken one came with it",
    ).toEqual(["step1"]);
    expect(file.edges[0], "the arrow came back with its decorations lost or invented").toEqual({
      id: "step1",
      fromNode: "ingest",
      fromSide: "right",
      fromEnd: "none",
      toNode: "transform",
      toSide: "left",
      toEnd: "arrow",
      color: "5",
      label: "raw rows",
    });
    expect(
      file.nodes.map((node) => String(node.id)).sort(),
      "the nodes were disturbed by the lift",
    ).toEqual(["ingest", "sink", "transform"]);

    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "step2")),
      "the still-broken arrow was released as collateral of the repair",
    ).toBe(true);

    client.cs.destroy();
  });
});
