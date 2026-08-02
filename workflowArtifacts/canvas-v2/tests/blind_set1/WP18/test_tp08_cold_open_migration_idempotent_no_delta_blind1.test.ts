// WP18 blind1 — idempotence of the cold-open migration across SEPARATE
// `CanvasPersistence` instances and THREE opens.
//
// The visible probe re-opens through the same instance, so an implementation
// that remembered "I already migrated this" in instance state would satisfy it
// and still re-migrate on the next join. Every join constructs a new
// persistence object over the same doc, so the guard has to live in the DOC
// (`meta` is the marker), not in the object.
//
// The fixture is edges-only, which also pins that the non-empty branch is not
// decided by the nodes map alone.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { META_MAP_NAME, SCHEMA_VERSION_KEY } from "../../../canvas/canvas-schema";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "wires.canvas";

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

describe("WP18 blind1 — a fresh persistence instance does not re-migrate an already-migrated doc", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens two and three, each through a NEW instance, produce zero delta and zero update events", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      for (const [id, from, to] of [
        ["w1", "a", "b"],
        ["w2", "b", "c"],
      ] as const) {
        const record = new Y.Map<unknown>();
        edges.set(id, record);
        record.set("id", id);
        record.set("fromNode", from);
        record.set("fromSide", "right");
        record.set("fromEnd", "none");
        record.set("toNode", to);
        record.set("toSide", "left");
      }
    });

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const open = async () => {
      const persistence = new CanvasPersistence(doc, io, DISK, {
        logger: { debug: () => {}, warn: () => {} },
      });
      const result = await persistence.coldOpen();
      persistence.destroy();
      return result;
    };

    expect(await open(), "the fixture did not exercise the non-empty branch").toBe("doc-wins");
    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "the first cold open did not migrate — idempotence would be vacuous",
    ).toBe(2);

    const stateVectorAfterFirstOpen = Y.encodeStateVector(doc);
    let updateEvents = 0;
    const onUpdate = () => {
      updateEvents++;
    };
    doc.on("update", onUpdate);

    await open();
    await open();

    doc.off("update", onUpdate);

    expect(
      Array.from(Y.encodeStateAsUpdate(doc, stateVectorAfterFirstOpen)),
      "a later cold open produced a delta — the migration guard lives in the instance, not the doc",
    ).toEqual(emptyUpdateBytes());
    expect(updateEvents, "a later cold open fired update events").toBe(0);

    doc.destroy();
  });
});
