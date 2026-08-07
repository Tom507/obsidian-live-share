// WP18 blind2 — the cold-open post-condition, closed into a ROUND TRIP.
//
// "Nothing is left unmigrated" is only half a guarantee. A doc can be fully V2
// and still be useless if the `.canvas` file it produces has changed shape:
// the FILE format is explicitly unchanged by this initiative, and `ord` is
// doc-only and must never reach disk.
//
// So this probe asserts both ends of the loop after a single `coldOpen`:
//   ├── the DOC satisfies the V2 ingest schema, every record carrying an `ord`;
//   └── the file the serializer emits from that doc is the flat `.canvas`
//       vocabulary again, with the same values, and with `ord` nowhere in it.
//
// The intermediate vocabulary the seed writes is not asserted — only what the
// doc holds once cold open has resolved, and what comes back out of it.

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
import { buildCanvasData } from "../../../files/canvas-sync";

const DISK = "roundtrip.canvas";

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
    { id: "top", type: "text", x: -120, y: 75, width: 333, height: 111, text: "top" },
    { id: "bottom", type: "text", x: 480, y: 75, width: 333, height: 111, text: "bottom" },
  ],
  edges: [{ id: "join", fromNode: "top", fromSide: "right", toNode: "bottom", toSide: "left" }],
});

describe("WP18 blind2 — cold open leaves a fully V2 doc that still emits a flat .canvas file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every record is V2 and carries an ord, while the emitted file record is flat and ord-free", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: FILE_CONTENT });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    expect(await persistence.coldOpen()).toBe("seeded-from-file");

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    // ── the DOC end of the loop ───────────────────────────────────────────
    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "cold open returned with the doc still unstamped",
    ).toBe(SUPPORTED_SCHEMA_MAJOR);
    expect([...nodes.keys()].sort()).toEqual(["bottom", "top"]);

    for (const [id, record] of nodes) {
      expect(
        validateNodeIngest(asRecordMap(record), "local").valid,
        `node ${id} is still unmigrated after cold open returned`,
      ).toBe(true);
      expect(typeof record.get(V2_FIELD.ord), `node ${id} has no ord`).toBe("string");
    }
    const join = edges.get("join") as Y.Map<unknown>;
    expect(join, "the edge was not seeded").toBeDefined();
    expect(
      validateEdgeIngest(asRecordMap(join), "local").valid,
      "the edge is still unmigrated after cold open returned",
    ).toBe(true);
    expect(typeof join.get(V2_FIELD.ord), "the edge has no ord").toBe("string");

    // ── the FILE end of the loop ──────────────────────────────────────────
    const emitted = buildCanvasData(nodes, edges);
    const emittedTop = emitted.nodes.find(
      (record) => (record as Record<string, unknown>).id === "top",
    ) as Record<string, unknown> | undefined;
    expect(emittedTop, "the serializer emitted no record for the seeded node").toBeDefined();
    expect(emittedTop?.x, "the emitted file record lost its flat x").toBe(-120);
    expect(emittedTop?.y).toBe(75);
    expect(emittedTop?.width).toBe(333);
    expect(emittedTop?.height).toBe(111);
    expect(emittedTop?.text).toBe("top");
    expect(
      emittedTop?.[V2_FIELD.pos],
      "a doc register leaked into the `.canvas` file shape",
    ).toBeUndefined();
    expect(
      emittedTop?.[V2_FIELD.ord],
      "`ord` is doc-only and must never be serialised to the file",
    ).toBeUndefined();

    const emittedEdge = emitted.edges.find(
      (record) => (record as Record<string, unknown>).id === "join",
    ) as Record<string, unknown> | undefined;
    expect(emittedEdge?.fromNode, "the emitted edge lost its flat endpoint").toBe("top");
    expect(emittedEdge?.toSide).toBe("left");
    expect(emittedEdge?.[V2_FIELD.ord], "`ord` reached the file through an edge").toBeUndefined();

    persistence.destroy();
    doc.destroy();
  });
});
