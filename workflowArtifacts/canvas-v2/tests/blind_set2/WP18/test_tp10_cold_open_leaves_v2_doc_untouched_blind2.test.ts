// WP18 blind2 — an already-V2 doc that still carries the flat V1 leftovers is
// not "cleaned up" on cold open.
//
// This is what a migrated doc actually looks like: registers AND the flat keys
// the additive migration deliberately left behind. The leftovers look like
// debris, and a cold-open call site is exactly where someone would be tempted
// to sweep them once `meta` says the doc is V2.
//
// Sweeping them is not a tidy-up, it is a delete set. `encodeStateAsUpdate`
// carries the doc's whole delete set forever, so one such sweep makes every
// later update non-empty for every peer and permanently ends the doc's ability
// to demonstrate "no delta" — and it strands every peer still reading the flat
// vocabulary.
//
// Oracle: zero delta across the cold open, zero update events, leftovers intact.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  META_MAP_NAME,
  SCHEMA_VERSION_KEY,
  SUPPORTED_SCHEMA_MAJOR,
} from "../../../canvas/canvas-schema";
import {
  ENDPOINT_FILE_KEYS,
  FROM_KEY,
  TO_KEY,
  V2_FIELD,
  encodeEndpoint,
  encodePos,
  encodeSize,
} from "../../../canvas/canvas-registers";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "leftovers.canvas";

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

describe("WP18 blind2 — cold open does not sweep the flat leftovers of a migrated doc", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers, leftovers and `meta` are all exactly as they were, with no delta at all", async () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap<unknown>(META_MAP_NAME).set(SCHEMA_VERSION_KEY, SUPPORTED_SCHEMA_MAJOR);

      const node = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("nodes").set("n", node);
      node.set(V2_FIELD.id, "n");
      node.set(V2_FIELD.type, "text");
      node.set(V2_FIELD.pos, encodePos(3, 4));
      node.set(V2_FIELD.size, encodeSize(60, 30));
      node.set(V2_FIELD.ord, "a0");
      node.set("x", 3);
      node.set("y", 4);
      node.set("width", 60);
      node.set("height", 30);

      const edge = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>("edges").set("e", edge);
      edge.set(V2_FIELD.id, "e");
      edge.set(FROM_KEY, encodeEndpoint("n", "right"));
      edge.set(TO_KEY, encodeEndpoint("n", "left"));
      edge.set(V2_FIELD.ord, "a1");
      edge.set(ENDPOINT_FILE_KEYS[FROM_KEY].node, "n");
      edge.set(ENDPOINT_FILE_KEYS[FROM_KEY].side, "right");
      edge.set(ENDPOINT_FILE_KEYS[TO_KEY].node, "n");
      edge.set(ENDPOINT_FILE_KEYS[TO_KEY].side, "left");
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
    expect(await persistence.coldOpen()).toBe("doc-wins");
    doc.off("update", onUpdate);

    expect(
      Array.from(Y.encodeStateAsUpdate(doc, stateVectorBefore)),
      "cold open produced a delta on an already-V2 doc — a sweep or a re-stamp happened",
    ).toEqual(emptyUpdateBytes());
    expect(updateEvents, "cold open fired an update event on an already-V2 doc").toBe(0);

    const node = doc.getMap<Y.Map<unknown>>("nodes").get("n");
    const edge = doc.getMap<Y.Map<unknown>>("edges").get("e");
    for (const flatKey of ["x", "y", "width", "height"]) {
      expect(node?.get(flatKey), `the leftover flat key \`${flatKey}\` was swept`).toBeDefined();
    }
    expect(edge?.get(ENDPOINT_FILE_KEYS[FROM_KEY].node), "a leftover endpoint key was swept").toBe(
      "n",
    );
    expect(node?.get(V2_FIELD.ord)).toBe("a0");
    expect(doc.getMap<unknown>(META_MAP_NAME).get(SCHEMA_VERSION_KEY)).toBe(SUPPORTED_SCHEMA_MAJOR);

    persistence.destroy();
    doc.destroy();
  });
});
