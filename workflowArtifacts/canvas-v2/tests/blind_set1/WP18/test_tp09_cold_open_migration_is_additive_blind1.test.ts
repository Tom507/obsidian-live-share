// WP18 blind1 — the migration is additive, checked on the ENDPOINT half of the
// translation rather than the geometry half.
//
// An edge carries SIX flat V1 keys, and three of them (`fromNode`, `fromSide`,
// `fromEnd`) collapse into a single composite register value. That collapse is
// where a "tidy" migration is most tempting: the three sources look redundant
// the moment `from` exists. They are not redundant, they are the shape every
// unmigrated peer still reads — and deleting them would put a delete-set entry
// in the doc that makes every later update non-empty for everyone, forever.
//
// So: all six flat keys still present with their original values, both
// registers added with their components intact, and the edge's own payload
// (`label`, `color`) untouched.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  ENDPOINT_FILE_KEYS,
  FROM_KEY,
  TO_KEY,
  type V2RecordMap,
  readFrom,
  readTo,
} from "../../../canvas/canvas-registers";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "arrows.canvas";

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

const V1_EDGE_FIELDS: Record<string, unknown> = {
  id: "arrow",
  fromNode: "src",
  fromSide: "bottom",
  fromEnd: "none",
  toNode: "dst",
  toSide: "top",
  toEnd: "arrow",
  label: "triggers",
  color: "4",
};

describe("WP18 blind1 — the cold-open migration keeps all six flat endpoint keys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the flat endpoint vocabulary survives, and the composite registers are added beside it", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      const record = new Y.Map<unknown>();
      edges.set("arrow", record);
      for (const [key, value] of Object.entries(V1_EDGE_FIELDS)) record.set(key, value);
    });

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    await persistence.coldOpen();

    const arrow = doc.getMap<Y.Map<unknown>>("edges").get("arrow");
    expect(arrow, "the edge did not survive the cold open").toBeDefined();
    const record = arrow as Y.Map<unknown>;

    for (const [key, value] of Object.entries(V1_EDGE_FIELDS)) {
      expect(record.get(key), `the migration lost or changed the field \`${key}\``).toEqual(value);
    }

    // Every one of the six file key names, asked of WP10 rather than re-spelt.
    for (const slot of [FROM_KEY, TO_KEY]) {
      const keys = ENDPOINT_FILE_KEYS[slot];
      for (const flatKey of [keys.node, keys.side, keys.end]) {
        expect(
          record.get(flatKey),
          `the migration deleted the flat endpoint key \`${flatKey}\` — a delete set is forever`,
        ).toBeDefined();
      }
    }

    expect(readFrom(asRecordMap(record)), "the `from` register was not added").toEqual({
      node: "src",
      side: "bottom",
      end: "none",
    });
    expect(readTo(asRecordMap(record)), "the `to` register was not added").toEqual({
      node: "dst",
      side: "top",
      end: "arrow",
    });

    persistence.destroy();
    doc.destroy();
  });
});
