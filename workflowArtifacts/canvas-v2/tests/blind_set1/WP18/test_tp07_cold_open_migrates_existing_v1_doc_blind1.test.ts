// WP18 blind1 — the V1→V2 migration call site, exercised on a doc whose
// geometry is PARTLY unusable.
//
// A real V1 doc that has been through a transient disk read can hold a node
// with `x` but no `y`. WP8's translation refuses to build a register out of
// half a pair, so the correct outcome is asymmetric and worth pinning at the
// call site: the whole-geometry nodes gain their registers, the half-geometry
// node gains none — and loses nothing either. A call site that "repaired" the
// half node into `pos: [x, 0]` would look tidier and would invent a position
// nobody authored.
//
// `ord` is checked on every record, including the half one: order is DATA in
// V2, and a record without an `ord` is a record the serializer cannot place.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
} from "../../../canvas/canvas-schema";
import {
  V2_FIELD,
  type V2RecordMap,
  readPosRegister,
  readSizeRegister,
} from "../../../canvas/canvas-registers";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "legacy.canvas";

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

function v1Record(
  container: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  container.set(id, record);
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
}

describe("WP18 blind1 — cold open migrates a V1 doc without inventing the geometry it lacks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("whole pairs become registers, a half pair becomes nothing, and every record gets an ord", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      v1Record(nodes, "whole-a", {
        id: "whole-a",
        type: "text",
        x: -40,
        y: 900,
        width: 64,
        height: 64,
        text: "a",
      });
      v1Record(nodes, "whole-b", {
        id: "whole-b",
        type: "link",
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        url: "https://example.invalid/x",
      });
      // `y` never arrived. Half a pair is not a position.
      v1Record(nodes, "half", {
        id: "half",
        type: "text",
        x: 77,
        width: 100,
        height: 50,
        text: "partial",
      });
    });

    expect(doc.share.has(META_MAP_NAME), "the fixture is not a V1 doc").toBe(false);

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    const result = await persistence.coldOpen();
    expect(result, "the fixture did not exercise the non-empty branch").toBe("doc-wins");

    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "cold open left an existing V1 doc unstamped",
    ).toBe(SUPPORTED_SCHEMA_MAJOR);

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const wholeA = nodes.get("whole-a") as Y.Map<unknown>;
    const wholeB = nodes.get("whole-b") as Y.Map<unknown>;
    const half = nodes.get("half") as Y.Map<unknown>;

    expect(readPosRegister(asRecordMap(wholeA))).toEqual([-40, 900]);
    expect(readSizeRegister(asRecordMap(wholeA))).toEqual([64, 64]);
    expect(readPosRegister(asRecordMap(wholeB))).toEqual([0, 0]);

    expect(
      readPosRegister(asRecordMap(half)),
      "a position was invented for a node that only ever had an x",
    ).toBeUndefined();
    expect(
      readSizeRegister(asRecordMap(half)),
      "the whole size pair of the half node was not translated",
    ).toEqual([100, 50]);
    expect(half.get("x"), "the half node's only real coordinate was dropped").toBe(77);
    expect(half.get("text"), "the half node lost its payload").toBe("partial");

    for (const [id, record] of nodes) {
      expect(typeof record.get(V2_FIELD.ord), `node ${id} was migrated without an ord`).toBe(
        "string",
      );
    }

    persistence.destroy();
    doc.destroy();
  });
});
