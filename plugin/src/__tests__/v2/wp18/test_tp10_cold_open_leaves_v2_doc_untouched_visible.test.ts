// WP18 — a doc that is ALREADY at `schemaVersion 2` is not touched by the new
// cold-open call site.
//
// The migration call site runs on every cold open, and the overwhelmingly
// common case is a doc that is already V2. If the call site re-stamped `meta`,
// re-wrote registers "to be sure", or normalised anything, every join of every
// board would emit a delta to every peer — the exact failure `migrateV1ToV2`'s
// pre-transaction guard exists to prevent, reintroduced one layer up at the
// call site.
//
// Oracle: the CRDT delta across the whole cold open is empty, and no `update`
// event fires. The `meta` container also keeps its IDENTITY — it is reached,
// never re-assigned — because a replaced container silently stops merging with
// the peers still holding the old one.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
} from "../../../canvas/canvas-schema";
import { V2_FIELD, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "board.canvas";

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

function emptyUpdateBytes(): number[] {
  const reference = new Y.Doc();
  const bytes = Array.from(Y.encodeStateAsUpdate(reference, Y.encodeStateVector(reference)));
  reference.destroy();
  return bytes;
}

describe("WP18 — cold open leaves an already-V2 doc byte-identical", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no delta, no update event, `meta` keeps its value and its identity", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap<unknown>(META_MAP_NAME).set(SCHEMA_VERSION_KEY, SUPPORTED_SCHEMA_MAJOR);
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const record = new Y.Map<unknown>();
      nodes.set("n1", record);
      record.set(V2_FIELD.id, "n1");
      record.set(V2_FIELD.type, "text");
      record.set(V2_FIELD.pos, encodePos(10, 20));
      record.set(V2_FIELD.size, encodeSize(200, 100));
      record.set(V2_FIELD.ord, "a0");
      record.set(V2_FIELD.text, "already migrated");
    });

    const metaBefore = doc.getMap<unknown>(META_MAP_NAME);
    const stateVectorBefore = Y.encodeStateVector(doc);

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    let updateEvents = 0;
    const onUpdate = () => {
      updateEvents++;
    };
    doc.on("update", onUpdate);
    const result = await persistence.coldOpen();
    doc.off("update", onUpdate);

    expect(result).toBe("doc-wins");
    expect(
      Array.from(Y.encodeStateAsUpdate(doc, stateVectorBefore)),
      "cold open produced a delta on an already-V2 doc — every join would echo to every peer",
    ).toEqual(emptyUpdateBytes());
    expect(updateEvents, "cold open fired an update event on an already-V2 doc").toBe(0);

    expect(doc.getMap<unknown>(META_MAP_NAME)).toBe(metaBefore);
    expect(doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);

    // The record is untouched, registers and all.
    const n1 = doc.getMap<Y.Map<unknown>>("nodes").get("n1");
    expect(n1?.get(V2_FIELD.pos)).toEqual([10, 20]);
    expect(n1?.get(V2_FIELD.ord)).toBe("a0");

    persistence.destroy();
    doc.destroy();
  });
});
