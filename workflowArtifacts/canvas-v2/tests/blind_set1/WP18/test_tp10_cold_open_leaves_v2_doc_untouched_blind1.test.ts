// WP18 blind1 — "already V2" is decided by the MAJOR, not by an exact match.
//
// A doc stamped `"2.4"` — a string, with a minor — is a doc this build speaks.
// A call site that compared the stored value to the number `2` would read it as
// foreign and either re-stamp it (a delta on every join, and a downgrade of the
// peer's minor) or refuse it. Neither is acceptable, and the difference is
// invisible to a probe that only ever stamps `2` itself.
//
// Oracle: zero delta across the whole cold open, zero update events, and the
// stored version string still exactly as the peer wrote it.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { META_MAP_NAME, SCHEMA_VERSION_KEY } from "../../../canvas/canvas-schema";
import { V2_FIELD, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "minor.canvas";

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

describe("WP18 blind1 — a doc stamped with a MINOR-bumped V2 version is left alone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cold open neither re-stamps nor rewrites a `2.4` doc", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap<unknown>(META_MAP_NAME).set(SCHEMA_VERSION_KEY, "2.4");
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const record = new Y.Map<unknown>();
      nodes.set("future", record);
      record.set(V2_FIELD.id, "future");
      record.set(V2_FIELD.type, "text");
      record.set(V2_FIELD.pos, encodePos(-5, -5));
      record.set(V2_FIELD.size, encodeSize(42, 42));
      record.set(V2_FIELD.ord, "a1");
      record.set(V2_FIELD.text, "written by a newer peer");
      record.set("unknownToThisBuild", ["x", "y"]);
    });

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
      "cold open produced a delta on a doc that was already at schema major 2",
    ).toEqual(emptyUpdateBytes());
    expect(updateEvents, "cold open fired an update event on an already-V2 doc").toBe(0);

    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "the peer's version string was overwritten",
    ).toBe("2.4");
    expect(doc.getMap<Y.Map<unknown>>("nodes").get("future")?.get("unknownToThisBuild")).toEqual([
      "x",
      "y",
    ]);

    persistence.destroy();
    doc.destroy();
  });
});
