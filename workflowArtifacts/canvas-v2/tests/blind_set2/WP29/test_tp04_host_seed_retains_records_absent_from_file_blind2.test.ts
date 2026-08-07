// WP29 / AC2 blind2 — the retention claim as ARITHMETIC on a large board, with
// the canonical `.canvas` BYTES as the secondary oracle.
//
// The two other angles on this AC compare against a sibling seed boundary and
// diff an id set. This one does neither. It builds a board of forty records,
// hands the host a file that mentions exactly ONE of them, and asserts the
// board's record COUNT is unchanged by the rejoin. A count is a blunt oracle and
// that is the point: it is impossible to satisfy by naming the right ids, and it
// scales with the fixture instead of with the assertion.
//
// The byte oracle is the second half. `serializeCanvas` is the exact projection
// `CanvasPersistence` writes to disk, so comparing it before and after the seed
// answers the question the user actually asks — "did my file change?" — rather
// than a question about container membership. The one record the file DOES
// mention is expected to differ, and the assertion is written as "the bytes
// differ in exactly that record and nowhere else", so a seed that did nothing at
// all is red on the same oracle that catches a seed that deleted everything.

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CanvasSync,
  canvasDocId,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

const PATH = "library/catalogue.canvas";
const SHELF_COUNT = 30;
const LINK_COUNT = 10;

function shelf(index: number) {
  return {
    id: `shelf-${String(index).padStart(2, "0")}`,
    type: "text",
    x: index * 120,
    y: 0,
    width: 110,
    height: 60,
    text: `shelf ${index}`,
  };
}

function link(index: number) {
  return {
    id: `link-${String(index).padStart(2, "0")}`,
    fromNode: shelf(index).id,
    fromSide: "right",
    toNode: shelf(index + 1).id,
    toSide: "left",
  };
}

/** The host's file: one shelf, with a body only the host has. */
const HOST_FILE = JSON.stringify({
  nodes: [{ ...shelf(0), text: "shelf 0 (host's label)" }],
  edges: [],
});

function vaultDouble(content: string) {
  const files = new Map<string, string>([[PATH, content]]);
  return {
    files,
    read: vi.fn(async (f: { path: string }) => files.get(f.path) ?? ""),
    adapter: {
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
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

function syncDouble() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      let handle = docs.get(docId);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(docId, handle);
      }
      return handle;
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

function fillBoard(doc: Y.Doc): void {
  doc.transact(() => {
    for (let i = 0; i < SHELF_COUNT; i++) {
      const source = shelf(i);
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set(source.id, record);
      for (const [k, v] of Object.entries(source)) record.set(k, v);
    }
    for (let i = 0; i < LINK_COUNT; i++) {
      const source = link(i);
      const record = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("edges").set(source.id, record);
      for (const [k, v] of Object.entries(source)) record.set(k, v);
    }
  });
}

function projection(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
}

function counts(doc: Y.Doc): { nodes: number; edges: number } {
  const parsed = JSON.parse(projection(doc)) as {
    nodes: unknown[];
    edges: unknown[];
  };
  return { nodes: parsed.nodes.length, edges: parsed.edges.length };
}

async function rejoinWith(fileContent: string) {
  const vault = vaultDouble(fileContent);
  const sync = syncDouble();
  const doc = sync.getDoc(canvasDocId(PATH)).doc;
  fillBoard(doc);
  const before = { counts: counts(doc), bytes: projection(doc) };

  const canvasSync = new CanvasSync(
    vault as never,
    sync as never,
    {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
    } as never,
  );
  canvasSync.setLogger({ debug: () => {}, warn: () => {} });
  await canvasSync.subscribe(PATH, "host");

  return {
    doc,
    before,
    after: { counts: counts(doc), bytes: projection(doc) },
    close: () => canvasSync.destroy(),
  };
}

describe("WP29 AC2 blind2 — forty records, one mentioned, none lost", () => {
  it("the fixture really is forty records against a one-record file", async () => {
    const { before, close } = await rejoinWith(HOST_FILE);
    expect(before.counts).toEqual({ nodes: SHELF_COUNT, edges: LINK_COUNT });
    expect(JSON.parse(HOST_FILE).nodes).toHaveLength(1);
    close();
  });

  it("the record count is identical after the rejoin", async () => {
    const { before, after, close } = await rejoinWith(HOST_FILE);
    expect(after.counts, "the rejoin changed how many records the board has").toEqual(
      before.counts,
    );
    close();
  });

  it("the projection differs in exactly one record", async () => {
    const { before, after, close } = await rejoinWith(HOST_FILE);
    const was = JSON.parse(before.bytes) as { nodes: { id: string }[]; edges: { id: string }[] };
    const now = JSON.parse(after.bytes) as { nodes: { id: string }[]; edges: { id: string }[] };

    const changed: string[] = [];
    for (const record of now.nodes) {
      const previous = was.nodes.find((n) => n.id === record.id);
      if (JSON.stringify(previous) !== JSON.stringify(record)) changed.push(record.id);
    }
    for (const record of now.edges) {
      const previous = was.edges.find((e) => e.id === record.id);
      if (JSON.stringify(previous) !== JSON.stringify(record)) changed.push(record.id);
    }

    expect(
      changed,
      "the rejoin touched records the host's file never mentioned (or touched none at all)",
    ).toEqual([shelf(0).id]);
    close();
  });

  it("an EMPTY file leaves the whole projection byte-identical", async () => {
    const { before, after, close } = await rejoinWith(JSON.stringify({ nodes: [], edges: [] }));
    expect(after.bytes, "an empty host file rewrote the shared board").toBe(before.bytes);
    close();
  });

  it("a file holding a SINGLE edge and no nodes removes no node", async () => {
    // The asymmetric case: the node space is entirely absent from the file, so a
    // per-space deletion loop wipes thirty records while the edge space looks
    // healthy.
    const { before, after, close } = await rejoinWith(
      JSON.stringify({ nodes: [], edges: [link(0)] }),
    );
    expect(after.counts.nodes, "the node space was wiped by an edges-only file").toBe(
      before.counts.nodes,
    );
    expect(after.counts.edges).toBe(before.counts.edges);
    close();
  });

  it("no tombstones were created for the thirty-nine unmentioned records", async () => {
    const { doc, close } = await rejoinWith(HOST_FILE);
    expect(doc.getMap<unknown>("deleted").size).toBe(0);
    close();
  });
});
