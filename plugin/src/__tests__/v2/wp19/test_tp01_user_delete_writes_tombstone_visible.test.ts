// WP19 / AC1 — "A user delete writes a tombstone; no record's field container is
// destroyed by any delete path."
//
// The whole point of V2 tombstones is that a delete stops being an ABSENCE and
// becomes a VALUE. So this test asserts both halves of that sentence, and the
// second half is the one that actually costs something:
//
//   ├── a `deleted[id]` entry exists and suppresses, read through WP12's ONE
//   │      predicate (`readTombstoneEntry` + `isTombstoneSuppressed`) rather than
//   │      through an inline `entry?.on`, and
//   └── the record's `Y.Map` is STILL THERE, is the SAME OBJECT, and still holds
//          every field value it held before the delete.
//
// Container IDENTITY is the oracle for the second half. A `delete(id)` followed
// by a re-`set(id, ...)` would restore presence and even the values, but it
// cannot restore the object — and it is exactly that detach which throws away a
// peer's concurrent edit and makes undo lossy. A key-set comparison alone would
// not see it.
//
// The `observe` tripwire is the generalisation of "by ANY delete path": it
// watches the top-level nodes map for the whole scenario and fails on the first
// `action === "delete"` it sees, whichever branch of the capture path emitted it.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "deck.canvas";

const N_KEEP = { id: "keep", type: "text", x: 0, y: 0, width: 200, height: 100, text: "stays" };
const N_GONE = {
  id: "gone",
  type: "text",
  x: 320,
  y: 40,
  width: 260,
  height: 140,
  text: "delete me",
  color: "5",
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

/** A subscribed host whose canvas view is OPEN and has been handed `handed`. */
async function makeRoom(diskJson: string, handedNodes: string[], handedEdges: string[] = []) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: true,
      handedToView: { node: new Set(handedNodes), edge: new Set(handedEdges) },
    }),
  );
  await cs.subscribe(PATH, "host");
  return { vault, cs, doc: syncManager.getDoc(`__canvas__:${PATH}`).doc };
}

describe("WP19 AC1 — a user delete writes a tombstone and destroys no field container", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the delete lands as `on:true` in `deleted` while the record's Y.Map keeps its identity and every field", async () => {
    const room = await makeRoom(canvasJson([N_KEEP, N_GONE]), ["keep", "gone"]);
    const nodes = room.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = room.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = room.doc.getMap<unknown>("deleted");

    const containerBefore = nodes.get("gone");
    expect(containerBefore, "the host seed never created the record under test").toBeDefined();
    const fieldsBefore = containerBefore?.toJSON();

    // The user removes the card; Obsidian saves the canvas without it.
    room.vault.files.set(PATH, canvasJson([N_KEEP]));
    await room.cs.handleLocalModify(PATH);

    const entry = readTombstoneEntry(deleted, "gone");
    expect(entry, "the delete wrote no well-formed tombstone entry for the id").toBeDefined();
    expect(entry?.on, "the tombstone was written but does not suppress").toBe(true);
    expect(
      isTombstoneSuppressed(entry),
      "WP12's shared predicate does not read this entry as suppressed",
    ).toBe(true);

    expect(nodes.has("gone"), "the delete removed the record key from `nodes`").toBe(true);
    expect(
      nodes.get("gone"),
      "the record container was replaced rather than left alone — a detach loses concurrent peer edits",
    ).toBe(containerBefore);
    expect(
      nodes.get("gone")?.toJSON(),
      "field values were lost by the delete path",
    ).toEqual(fieldsBefore);

    // ... and the user still does not see it.
    const data = buildCanvasData(nodes, edges, deleted);
    expect(data.nodes.map((node) => node.id)).toEqual(["keep"]);

    room.cs.destroy();
  });

  it("no delete path emits a key removal on the record map at all", async () => {
    const room = await makeRoom(canvasJson([N_KEEP, N_GONE]), ["keep", "gone"]);
    const nodes = room.doc.getMap<Y.Map<unknown>>("nodes");

    const removals: string[] = [];
    nodes.observe((event: Y.YMapEvent<Y.Map<unknown>>) => {
      for (const [key, change] of event.changes.keys) {
        if (change.action === "delete") removals.push(key);
      }
    });

    room.vault.files.set(PATH, canvasJson([N_KEEP]));
    await room.cs.handleLocalModify(PATH);

    expect(
      removals,
      "a delete path called `nodesMap.delete(...)`: deletion is still an absence, not a value",
    ).toEqual([]);
    expect(
      readTombstoneEntry(room.doc.getMap<unknown>("deleted"), "gone")?.on,
      "nothing was removed, but nothing was tombstoned either — the delete vanished",
    ).toBe(true);

    room.cs.destroy();
  });
});
