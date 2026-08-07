// WP18 — the migration call site must be IDEMPOTENT at the call site, not only
// inside `migrateV1ToV2`.
//
// A canvas is cold-opened on every join, so this runs constantly. Yjs emits a
// real update for a same-value LWW `set`, and that update echoes to every peer
// forever — so "the values are the same afterwards" is not the property being
// claimed. The oracle is the CRDT delta: snapshot the state vector after the
// first cold open, run a second one, and assert the encoded update against that
// snapshot is the empty update. Zero `update` events is the same guarantee seen
// from the other side, since `update` (unlike `afterTransaction`) fires only
// when a transaction actually produced content.
//
// The empty update is not a zero-length buffer, so it is compared against a
// genuinely unchanged reference doc rather than against a hard-coded byte
// sequence.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { META_MAP_NAME, SCHEMA_VERSION_KEY } from "../../../canvas/canvas-schema";
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

function v1Record(
  container: Y.Map<Y.Map<unknown>>,
  id: string,
  fields: Record<string, unknown>,
): void {
  const record = new Y.Map<unknown>();
  container.set(id, record);
  for (const [key, value] of Object.entries(fields)) record.set(key, value);
}

/** The "nothing further happened" update, as Yjs actually encodes it. */
function emptyUpdateBytes(): number[] {
  const reference = new Y.Doc();
  const bytes = Array.from(Y.encodeStateAsUpdate(reference, Y.encodeStateVector(reference)));
  reference.destroy();
  return bytes;
}

describe("WP18 — a second cold open of an already-migrated doc produces no further delta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cold open #2 emits zero update events and an empty delta against the post-#1 state vector", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      v1Record(nodes, "n1", {
        id: "n1",
        type: "text",
        x: 1,
        y: 2,
        width: 10,
        height: 20,
        text: "a",
      });
      v1Record(nodes, "n2", {
        id: "n2",
        type: "text",
        x: 300,
        y: 2,
        width: 10,
        height: 20,
        text: "b",
      });
      v1Record(edges, "e1", {
        id: "e1",
        fromNode: "n1",
        fromSide: "right",
        toNode: "n2",
        toSide: "left",
      });
    });

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const persistence = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });

    await persistence.coldOpen();
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
    await persistence.coldOpen();
    doc.off("update", onUpdate);

    const delta = Y.encodeStateAsUpdate(doc, stateVectorAfterFirstOpen);

    expect(
      Array.from(delta),
      "a second cold open produced a CRDT delta — the migration is being re-run and echoed to every peer",
    ).toEqual(emptyUpdateBytes());
    expect(updateEvents, "a second cold open fired update events").toBe(0);

    persistence.destroy();
    doc.destroy();
  });
});
