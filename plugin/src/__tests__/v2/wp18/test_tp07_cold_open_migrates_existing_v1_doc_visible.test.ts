// WP18 — THE V1→V2 MIGRATION CALL SITE (WP8's open HIGH risk, closed here).
//
// `migrateV1ToV2` is landed, unit-proven, idempotent and lossless — and it has
// no production caller. "An existing V1 canvas doc opens as a valid V2 doc" is
// therefore not achieved end to end, and the decisive case is precisely the one
// that cannot be reached today: a real V1 doc arriving from the relay is
// NON-EMPTY, holds flat V1 records and no `meta`, so `coldOpen` takes the
// `flush()` branch and the doc is never migrated.
//
// The call site this pins is inside `CanvasPersistence.coldOpen()` and runs on
// BOTH branches — before the empty/non-empty split — so a joined V1 board is
// brought over on open regardless of which branch the doc state selects.
//
// Every name is imported from WP8, never re-spelt: `META_MAP_NAME`,
// `SCHEMA_VERSION_KEY`, `SUPPORTED_SCHEMA_MAJOR`. The registers are read
// through WP9/WP10's own readers for the same reason.

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
  readFrom,
  readPosRegister,
  readSizeRegister,
  readTo,
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

/** A pre-V2 record: flat geometry, flat endpoints, no register, no `ord`. */
function v1Record(
  container: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  container.set(id, record);
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
}

describe("WP18 — an existing, non-empty V1 doc is migrated to V2 on cold open", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the doc-wins branch stamps `meta` and translates flat V1 records into V2 registers", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      v1Record(nodes, "n1", {
        id: "n1",
        type: "text",
        x: 12,
        y: 34,
        width: 200,
        height: 100,
        text: "joined board",
      });
      v1Record(nodes, "n2", {
        id: "n2",
        type: "text",
        x: 500,
        y: 34,
        width: 180,
        height: 90,
        text: "peer card",
      });
      v1Record(edges, "e1", {
        id: "e1",
        fromNode: "n1",
        fromSide: "right",
        toNode: "n2",
        toSide: "left",
      });
    });

    // A V1 doc has no `meta` at all — that absence IS the unmigrated state.
    expect(doc.share.has(META_MAP_NAME), "the fixture is not a V1 doc").toBe(false);

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    const result = await persistence.coldOpen();

    expect(
      result,
      "the fixture did not exercise the non-empty branch — this probe would be vacuous",
    ).toBe("doc-wins");

    // ── the doc now says what it is ───────────────────────────────────────
    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "cold open left an existing V1 doc unstamped — the migration has no production caller",
    ).toBe(SUPPORTED_SCHEMA_MAJOR);

    // ── and its records are in the V2 shape ───────────────────────────────
    const n1 = doc.getMap<Y.Map<unknown>>("nodes").get("n1");
    const n2 = doc.getMap<Y.Map<unknown>>("nodes").get("n2");
    const e1 = doc.getMap<Y.Map<unknown>>("edges").get("e1");
    expect(n1, "a record vanished during cold open").toBeDefined();
    expect(n2, "a record vanished during cold open").toBeDefined();
    expect(e1, "a record vanished during cold open").toBeDefined();

    // WP64 — post-WP19 "vanished" has a second spelling: a migration that
    // tombstoned a record leaves the container (and every register asserted
    // below) perfectly intact while the record is gone from the canvas.
    const deletedMap = doc.getMap<unknown>("deleted");
    for (const id of ["n1", "n2", "e1"]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(deletedMap, id)),
        `the cold-open migration TOMBSTONED ${id}`,
      ).toBe(false);
    }
    const projected = buildCanvasData(
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      deletedMap,
    );
    expect(
      projected.nodes.map((n) => n.id),
      "the cold-open migration removed a node from the canvas",
    ).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(
      projected.edges.map((e) => e.id),
      "the cold-open migration removed the edge from the canvas",
    ).toContain("e1");

    expect(readPosRegister(asRecordMap(n1 as Y.Map<unknown>))).toEqual([12, 34]);
    expect(readSizeRegister(asRecordMap(n1 as Y.Map<unknown>))).toEqual([200, 100]);
    expect(readPosRegister(asRecordMap(n2 as Y.Map<unknown>))).toEqual([500, 34]);
    expect(readSizeRegister(asRecordMap(n2 as Y.Map<unknown>))).toEqual([180, 90]);

    expect(readFrom(asRecordMap(e1 as Y.Map<unknown>))).toEqual({ node: "n1", side: "right" });
    expect(readTo(asRecordMap(e1 as Y.Map<unknown>))).toEqual({ node: "n2", side: "left" });

    // Order became DATA, as V2 requires — every record carries an `ord`.
    for (const [id, record] of doc.getMap<Y.Map<unknown>>("nodes")) {
      expect(typeof record.get(V2_FIELD.ord), `node ${id} was migrated without an ord`).toBe(
        "string",
      );
    }
    expect(typeof (e1 as Y.Map<unknown>).get(V2_FIELD.ord)).toBe("string");

    persistence.destroy();
    doc.destroy();
  });
});
