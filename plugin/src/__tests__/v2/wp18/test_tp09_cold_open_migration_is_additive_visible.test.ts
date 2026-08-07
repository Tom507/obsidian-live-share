// WP18 — the migration wired at cold open must stay ADDITIVE.
//
// This is the assertion it would be most tempting to write backwards. A
// "tidy" migration that deleted the flat V1 keys once it had built the
// registers would look cleaner and would permanently break WP8 AC3: a
// deletion is not undone by a state vector, because `encodeStateAsUpdate`
// always carries the doc's WHOLE delete set, so one `delete()` makes every
// later update non-empty for every peer and the doc can never again be shown
// to produce "no delta". It would also strand any peer still reading the flat
// vocabulary.
//
// So: the translated flat keys must STILL BE THERE afterwards, every other
// field must be untouched — including unknown / forward-compat keys the
// migration has no table entry for — and the registers are ADDED alongside.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type V2RecordMap,
  readPosRegister,
  readSizeRegister,
} from "../../../canvas/canvas-registers";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { buildCanvasData } from "../../../files/canvas-sync";

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

/** Every field of the V1 node, including one no V2 table knows about. */
const V1_NODE_FIELDS: Record<string, unknown> = {
  id: "n1",
  type: "text",
  x: 12,
  y: 34,
  width: 200,
  height: 100,
  text: "carry me through",
  color: "3",
  background: "assets/card.png",
  // A key a newer peer wrote and this build has never heard of.
  futureDecoration: { style: "dashed", weight: 2 },
};

describe("WP18 — the cold-open migration adds registers without losing a single value", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the translated flat keys are still present, every other field is untouched, and the registers are added", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const record = new Y.Map<unknown>();
      nodes.set("n1", record);
      for (const [key, value] of Object.entries(V1_NODE_FIELDS)) record.set(key, value);
    });

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    await persistence.coldOpen();

    const n1 = doc.getMap<Y.Map<unknown>>("nodes").get("n1");
    expect(n1, "the record did not survive the cold open at all").toBeDefined();

    // WP64 — an ADDITIVE migration must also not subtract the record itself,
    // and post-WP19 that subtraction keeps every field below intact.
    const deletedMap = doc.getMap<unknown>("deleted");
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deletedMap, "n1")),
      "the cold-open migration TOMBSTONED the record it was supposed to migrate",
    ).toBe(false);
    expect(
      buildCanvasData(
        doc.getMap<Y.Map<unknown>>("nodes"),
        doc.getMap<Y.Map<unknown>>("edges"),
        deletedMap,
      ).nodes.map((n) => n.id),
      "the migrated record is no longer on the canvas",
    ).toContain("n1");

    const record = n1 as Y.Map<unknown>;

    // Nothing lost — INCLUDING the flat geometry keys that were translated.
    for (const [key, value] of Object.entries(V1_NODE_FIELDS)) {
      expect(record.get(key), `the migration lost or changed the field \`${key}\``).toEqual(value);
    }

    // ... and the registers were ADDED on top.
    expect(
      readPosRegister(asRecordMap(record)),
      "the migration did not add the atomic pos register",
    ).toEqual([12, 34]);
    expect(
      readSizeRegister(asRecordMap(record)),
      "the migration did not add the atomic size register",
    ).toEqual([200, 100]);

    persistence.destroy();
    doc.destroy();
  });
});
