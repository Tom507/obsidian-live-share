// WP18 — THE POST-CONDITION OF `coldOpen`: no record is left unmigrated,
// whichever branch ran.
//
// The migration call site is placed AFTER the seed, not before it, and that
// ordering is what this test exists to pin:
//
//   ├── doc EMPTY + file present → the file is seeded first, in whatever
//   │   vocabulary the seed writes, and the migration then translates what was
//   │   just written. Nothing can slip in behind the one-shot `meta` guard,
//   │   because the guard is not armed until after the seed.
//   └── doc NON-EMPTY (the V1 board arriving from the relay — the case that is
//       broken today) → there is nothing to seed, and the doc is migrated
//       directly.
//
// Both branches therefore share ONE observable post-condition, and it is
// asserted here rather than the intermediate shape either branch passes
// through: when `coldOpen` resolves, every record in the doc satisfies the V2
// ingest schema and the doc says `schemaVersion 2`.
//
// Deliberately NOT asserted: which vocabulary the seed itself writes. WP16's
// `decodeCanvasDataToFlat` bridge is a P1 scaffold, not a WP18 acceptance
// criterion — the charter's §2 and §4 never mention it — and pinning the
// intermediate shape would constrain the implementation for no AC gain.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { validateEdgeIngest, validateNodeIngest } from "../../../canvas/canvas-ingest-schema";
import { V2_FIELD, type V2RecordMap } from "../../../canvas/canvas-registers";
import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
} from "../../../canvas/canvas-schema";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "board.canvas";

function asRecordMap(map: Y.Map<unknown>): V2RecordMap {
  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: unknown) => map.set(key, value),
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

const FILE_CONTENT = JSON.stringify({
  nodes: [
    { id: "n1", type: "text", x: 12, y: 34, width: 200, height: 100, text: "card" },
    { id: "n2", type: "text", x: 500, y: 34, width: 180, height: 90, text: "other" },
  ],
  edges: [{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" }],
});

/**
 * The shared post-condition, asked of the doc and of nothing else: every
 * surviving record is a V2 record, and the doc says so.
 */
function expectFullyMigrated(doc: Y.Doc): void {
  expect(
    doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
    "cold open returned with the doc still unstamped",
  ).toBe(SUPPORTED_SCHEMA_MAJOR);

  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  expect(nodes.size + edges.size, "the doc is empty — this probe would be vacuous").toBeGreaterThan(
    0,
  );

  for (const [id, record] of nodes) {
    expect(
      validateNodeIngest(asRecordMap(record), "local").valid,
      `node ${id} is still unmigrated after cold open returned`,
    ).toBe(true);
    expect(typeof record.get(V2_FIELD.ord), `node ${id} came out of cold open without an ord`).toBe(
      "string",
    );
  }
  for (const [id, record] of edges) {
    expect(
      validateEdgeIngest(asRecordMap(record), "local").valid,
      `edge ${id} is still unmigrated after cold open returned`,
    ).toBe(true);
    expect(typeof record.get(V2_FIELD.ord), `edge ${id} came out of cold open without an ord`).toBe(
      "string",
    );
  }
}

describe("WP18 — when cold open resolves, no record is left unmigrated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seed branch: a doc seeded from the file comes out fully V2", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: FILE_CONTENT });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    const result = await persistence.coldOpen();

    expect(result, "the empty-doc branch was not exercised").toBe("seeded-from-file");
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(["n1", "n2"]);
    expectFullyMigrated(doc);

    persistence.destroy();
    doc.destroy();
  });

  it("doc-wins branch: an existing V1 doc comes out fully V2 without reading the file", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      const n1 = new Y.Map<unknown>();
      nodes.set("n1", n1);
      for (const [k, v] of Object.entries({
        id: "n1",
        type: "text",
        x: 12,
        y: 34,
        width: 200,
        height: 100,
        text: "from the relay",
      })) {
        n1.set(k, v);
      }
      const e1 = new Y.Map<unknown>();
      edges.set("e1", e1);
      for (const [k, v] of Object.entries({
        id: "e1",
        fromNode: "n1",
        fromSide: "right",
        toNode: "n1",
        toSide: "left",
      })) {
        e1.set(k, v);
      }
    });

    const io = createIO({ [DISK]: FILE_CONTENT });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    const result = await persistence.coldOpen();

    expect(result, "the non-empty branch was not exercised").toBe("doc-wins");
    // The file was never read into the doc: the two records the doc already had
    // are the two it still has.
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual(["n1"]);
    expectFullyMigrated(doc);

    persistence.destroy();
    doc.destroy();
  });
});
