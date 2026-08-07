// WP20 / AC2 — "When a later delta restores the missing fields, the auditor
// releases the quarantine automatically and the record reappears."
//
// This is the half that makes quarantine legitimate at all. A quarantine that
// never lifts is a delete with extra steps: the record stops reaching the file,
// `CanvasPersistence` writes `serialize(doc)` over it, and the user's card is
// gone for good. AC1 preserves the field containers precisely so THIS can
// happen, so the lift has to be tested at least as hard as the raise.
//
// The record is broken in TWO independent conjuncts (`size` and `text`) and the
// repair arrives in TWO deltas, which is what separates a real re-validation
// from "something changed, drop the tombstone":
//
//   ├── after the FIRST delta the record is still invalid → it must STAY
//   │      quarantined. An auditor that releases on any incoming change passes
//   │      a single-fault test and fails here, and its failure mode is a
//   │      half-built record reaching the user's file.
//   └── after the SECOND delta the record is whole → released, `on:false`,
//          rendered and serialised again, with the fields from BOTH deltas.
//
// The release is asserted on DOC STATE (`entry.on === false`,
// `isTombstoneSuppressed` false, the record back in `buildCanvasData` and in the
// serialised bytes), never on a log line.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  isTombstoneQuarantined,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "roadmap.canvas";

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

/** A peer that keeps its state, so a repair can be a genuine LATER delta. */
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

describe("WP20 AC2 — a later delta that completes the record lifts the quarantine automatically", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays quarantined while a conjunct is still missing, and is released — with both deltas' fields — once the record is whole", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    // A `text` node with neither `size` nor `text`: two independent conjuncts.
    push((peer) => {
      const space = peer.getMap<Y.Map<unknown>>("nodes");
      space.set("anchor", record({
        id: "anchor",
        type: "text",
        pos: encodePos(-200, -100),
        size: encodeSize(220, 110),
        text: "anchor",
      }));
      space.set("halfborn", record({
        id: "halfborn",
        type: "text",
        pos: encodePos(80, 60),
        color: "3",
      }));
    });

    const container = nodes.get("halfborn");
    expect(container, "the fault injection never reached the doc").toBeDefined();

    audit();

    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "halfborn")),
      "the invalid record was never quarantined, so there is no quarantine to lift",
    ).toBe(true);

    // DELTA 1 — repairs `size` only. The record is still schema-invalid.
    push((peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").get("halfborn")?.set("size", encodeSize(320, 200));
    });
    audit();

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "halfborn")),
      "the quarantine was lifted while the record was still invalid — a half-built record can now reach the file",
    ).toBe(true);
    expect(
      buildCanvasData(nodes, edges, deleted).nodes.map((node) => node.id),
      "the still-invalid record is rendered again",
    ).toEqual(["anchor"]);

    // DELTA 2 — repairs `text`. The record is now whole.
    push((peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").get("halfborn")?.set("text", "born at last");
    });
    audit();

    const released = readTombstoneEntry(deleted, "halfborn");
    expect(released, "the tombstone entry vanished instead of being released").toBeDefined();
    expect(released?.on, "the auditor did not release the quarantine on the repaired record").toBe(
      false,
    );
    expect(
      isTombstoneSuppressed(released),
      "WP12's shared predicate still reads the repaired record as suppressed",
    ).toBe(false);
    expect(
      isTombstoneQuarantined(released),
      "the released entry still reports as quarantined",
    ).toBe(false);

    // …and the record REAPPEARS, carrying the fields from both repair deltas
    // plus everything it was quarantined with.
    expect(
      nodes.get("halfborn"),
      "the record container was replaced somewhere along the way",
    ).toBe(container);
    expect(nodes.get("halfborn")?.toJSON(), "the reappeared record lost fields").toEqual({
      id: "halfborn",
      type: "text",
      pos: [80, 60],
      color: "3",
      size: [320, 200],
      text: "born at last",
    });

    const rendered = buildCanvasData(nodes, edges, deleted).nodes;
    expect(
      rendered.map((node) => node.id).sort(),
      "the repaired record did not come back into the view",
    ).toEqual(["anchor", "halfborn"]);
    const onDisk = JSON.parse(serializeCanvas(nodes, edges, deleted)) as {
      nodes: Record<string, unknown>[];
    };
    expect(
      onDisk.nodes.map((node) => String(node.id)).sort(),
      "the repaired record did not come back into the file",
    ).toEqual(["anchor", "halfborn"]);
    expect(
      onDisk.nodes.find((node) => node.id === "halfborn"),
      "the reappeared record reached the file with the wrong shape",
    ).toMatchObject({ x: 80, y: 60, width: 320, height: 200, text: "born at last" });

    client.cs.destroy();
  });
});
