// WP18 blind2 — idempotence with a REMOTE delta interleaved between the two
// cold opens.
//
// The doc is not frozen between joins. A peer adds a record, and that record is
// V1-shaped because the peer is on an older build. The second cold open must
// still contribute NOTHING: `meta` is present, so the doc is already migrated,
// and re-running the translation over the peer's new record would produce a
// delta on a join — the echo-forever failure the pre-transaction guard exists
// to prevent.
//
// The state vector is snapshotted AFTER the peer's delta, so the peer's own
// content is not mistaken for the cold open's.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { META_MAP_NAME, SCHEMA_VERSION_KEY } from "../../../canvas/canvas-schema";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "interleaved.canvas";

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

describe("WP18 blind2 — a peer's V1-shaped delta between two opens does not re-trigger migration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the second cold open adds nothing beyond what the peer sent", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nodes = doc.getMap<Y.Map<unknown>>("nodes");
      const record = new Y.Map<unknown>();
      nodes.set("origin", record);
      record.set("id", "origin");
      record.set("type", "text");
      record.set("x", 1);
      record.set("y", 1);
      record.set("width", 50);
      record.set("height", 50);
      record.set("text", "origin");
    });

    const io = createIO({ [DISK]: JSON.stringify({ nodes: [], edges: [] }) });
    const first = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });
    await first.coldOpen();
    first.destroy();

    expect(
      doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY),
      "the first cold open did not migrate — idempotence would be vacuous",
    ).toBe(2);

    // An older peer adds a V1-shaped record while we are connected.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const late = new Y.Map<unknown>();
    peer.getMap<Y.Map<unknown>>("nodes").set("late", late);
    late.set("id", "late");
    late.set("type", "text");
    late.set("x", 700);
    late.set("y", 700);
    late.set("width", 50);
    late.set("height", 50);
    late.set("text", "late arrival");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
    peer.destroy();

    const stateVectorAfterPeer = Y.encodeStateVector(doc);

    let updateEvents = 0;
    const onUpdate = () => {
      updateEvents++;
    };
    doc.on("update", onUpdate);
    const second = new CanvasPersistence(doc, io, DISK, {
      logger: { debug: () => {}, warn: () => {} },
    });
    await second.coldOpen();
    second.destroy();
    doc.off("update", onUpdate);

    expect(
      Array.from(Y.encodeStateAsUpdate(doc, stateVectorAfterPeer)),
      "the second cold open produced a delta — the migration guard is not reading the doc's `meta`",
    ).toEqual(emptyUpdateBytes());
    expect(updateEvents, "the second cold open fired update events").toBe(0);

    // The peer's record is untouched — not migrated, not repaired, not dropped.
    const late2 = doc.getMap<Y.Map<unknown>>("nodes").get("late");
    expect(late2?.get("x"), "the peer's late record was altered by the second open").toBe(700);
    expect(late2?.get("text")).toBe("late arrival");

    doc.destroy();
  });
});
