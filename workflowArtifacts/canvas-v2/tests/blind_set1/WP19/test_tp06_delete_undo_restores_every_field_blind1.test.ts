// WP19 AC4 blind1 — lossless undo of an ARROW, measured in FILE BYTES.
//
// "Every field value it had before the delete" is a claim about the user's data,
// and the user's data is the `.canvas` file. So the oracle here is byte
// equality: write the file, delete the arrow, write again, undo, write again —
// and the third file must be the first file, character for character. That
// catches losses the doc-side field compare can miss (a key that survives with a
// changed type, a value that round-trips through the serializer differently, an
// optional key that comes back as `null` instead of being omitted).
//
// The arrow is deliberately SIDE-LESS on one end. JSON Canvas makes `fromSide` /
// `toSide` optional, and an omitted optional key is the classic thing a
// restore-from-scratch path re-materialises as `null` or `""` — which would
// change the bytes without changing any "field value" a naive compare looks at.
//
// The undo is the same op with `on:false`, one Lamport tick after the delete's
// own stamp and by the same author: a causal chain, never a concurrent pair.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "archive/threads.canvas";

const HEAD = { id: "head", type: "text", x: 0, y: 0, width: 220, height: 120, text: "head" };
const TAIL = { id: "tail", type: "text", x: 520, y: 60, width: 220, height: 120, text: "tail" };
// `toSide` deliberately omitted — a legal, optional-key JSON Canvas edge.
const THREAD = {
  id: "thread",
  fromNode: "head",
  fromSide: "right",
  toNode: "tail",
  label: "annotated thread",
  color: "#a01f7c",
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

function createIO(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const io = {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
  return io satisfies PersistenceIO & { files: Map<string, string> };
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

describe("WP19 AC4 blind1 — delete+undo of an arrow leaves the file byte-identical", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the file written after the undo equals the file written before the delete, character for character", async () => {
    const seedJson = canvasJson([HEAD, TAIL], [THREAD]);
    const vault = createVault({ [PATH]: seedJson });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["head", "tail"]), edge: new Set(["thread"]) },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const deleted = doc.getMap<unknown>("deleted");
    const arrowBefore = edges.get("thread")?.toJSON();
    expect(arrowBefore, "the host seed never created the arrow under test").toBeDefined();

    const io = createIO();
    const persistence = new CanvasPersistence(doc, io, PATH, {
      logger: { debug: () => {}, warn: () => {} },
    });

    await persistence.flush();
    const fileBefore = io.files.get(PATH);
    expect(fileBefore, "nothing was written before the delete").toBeDefined();
    expect(fileBefore).toContain("thread");

    // Delete the arrow through the ordinary capture path.
    vault.files.set(PATH, canvasJson([HEAD, TAIL], []));
    await cs.handleLocalModify(PATH);
    await persistence.flush();

    const fileDeleted = io.files.get(PATH);
    expect(
      fileDeleted,
      "the delete produced no new file — the arrow is still on disk",
    ).not.toBe(fileBefore);
    expect(fileDeleted, "the deleted arrow is still in the file").not.toContain("thread");

    // Undo — the same op, `on:false`, one tick later, same author.
    const stamp = readTombstoneEntry(deleted, "thread");
    expect(stamp, "the delete wrote no tombstone, so there is nothing to undo").toBeDefined();
    doc.transact(() => {
      applyTombstoneOp(deleted, "thread", {
        t: (stamp?.t ?? 0) + 1,
        by: stamp?.by ?? "local",
        on: false,
      });
    });
    expect(isTombstoneSuppressed(readTombstoneEntry(deleted, "thread"))).toBe(false);
    await persistence.flush();

    expect(
      io.files.get(PATH),
      "the file after the undo is not the file before the delete — data was lost in the cycle",
    ).toBe(fileBefore);
    expect(
      edges.get("thread")?.toJSON(),
      "the arrow's stored fields changed across the delete/undo cycle",
    ).toEqual(arrowBefore);

    persistence.destroy();
    cs.destroy();
  });
});
