// WP19 / AC4 — "A delete followed by an undo restores the record with every
// field value it had before the delete."
//
// This is the data-loss discriminant of the whole work package, and "the record
// is back" is NOT what it says. An implementation that removes the record's
// `Y.Map` on delete and re-creates it from the last local file on undo would
// also make the record reappear — with the fields that happened to be in that
// file, and without whatever a peer had written into the record meanwhile. So
// the assertion is FIELD-BY-FIELD equality of the complete pre-delete record,
// plus the container's own identity, plus byte equality of the serialised file
// either side of the cycle.
//
// The undo itself is deliberately not a UI action: WP38 owns real undo, and this
// WP only has to guarantee that the data is restorable. So the undo here is what
// the spec says an undo IS — one more `applyTombstoneOp` with `on:false` — and
// its `t` is derived from the delete's own stamp, so the two ops form a causal
// chain rather than a concurrent pair whose winner Yjs would pick at random.
//
// The record deliberately carries fields no geometry-aware code path knows
// about (`label`, `color`, a future-schema key): those are precisely the ones a
// re-create-from-file undo silently drops.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "notes.canvas";

const NEIGHBOUR = {
  id: "neighbour",
  type: "text",
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  text: "neighbour",
};
const RICH = {
  id: "rich",
  type: "text",
  x: 640,
  y: 220,
  width: 320,
  height: 180,
  text: "every one of these has to come back",
  color: "6",
  label: "annotated",
  styleAttributes: "future-schema-key",
};

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
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

describe("WP19 AC4 — undo restores the record with EVERY field value it had", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the whole record comes back field for field, in the doc and in the serialised file", async () => {
    const vault = createVault({ [PATH]: canvasJson([NEIGHBOUR, RICH]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["neighbour", "rich"]), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const deleted = doc.getMap<unknown>("deleted");

    const containerBefore = nodes.get("rich");
    expect(containerBefore, "the host seed never created the record under test").toBeDefined();
    const recordBefore = containerBefore?.toJSON() ?? {};
    expect(
      Object.keys(recordBefore).length,
      "the record under test is too thin to prove anything about field loss",
    ).toBeGreaterThan(5);
    const fileBefore = serializeCanvas(nodes, edges, deleted);

    // Delete.
    vault.files.set(PATH, canvasJson([NEIGHBOUR]));
    await cs.handleLocalModify(PATH);

    const afterDelete = readTombstoneEntry(deleted, "rich");
    expect(afterDelete, "the delete wrote no tombstone, so there is nothing to undo").toBeDefined();
    expect(isTombstoneSuppressed(afterDelete)).toBe(true);
    expect(
      buildCanvasData(nodes, edges, deleted).nodes.map((node) => node.id),
      "the record was not actually suppressed by the delete",
    ).toEqual(["neighbour"]);

    // Undo — the same op with `on:false`, one Lamport tick later, same author.
    // Causal, never concurrent: nothing here depends on a Yjs tie-break.
    applyTombstoneOp(deleted, "rich", {
      t: (afterDelete?.t ?? 0) + 1,
      by: afterDelete?.by ?? "local",
      on: false,
    });

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "rich")),
      "the undo did not lift the suppression",
    ).toBe(false);

    // 1 — the container is the same object it always was.
    expect(
      nodes.get("rich"),
      "the record was re-created rather than un-suppressed — a peer's concurrent edit is gone with it",
    ).toBe(containerBefore);

    // 2 — every single field, named individually so a failure says WHICH one.
    const recordAfter = nodes.get("rich")?.toJSON() ?? {};
    for (const [field, value] of Object.entries(recordBefore)) {
      expect(recordAfter[field], `field \`${field}\` did not survive the delete/undo cycle`).toEqual(
        value,
      );
    }
    expect(
      Object.keys(recordAfter).sort(),
      "the restored record gained or lost keys",
    ).toEqual(Object.keys(recordBefore).sort());

    // 3 — and the file the user ends up with is the file they started with.
    expect(
      serializeCanvas(nodes, edges, deleted),
      "the file after delete+undo is not the file before the delete",
    ).toBe(fileBefore);

    cs.destroy();
  });
});
