// WP24 / AC2 blind1 — reconstruction, attacked through a Y.Text and a Y.Array
// rather than through flat Y.Map records.
//
// Different angle and different data: nested Yjs types have an internal item
// structure that a "replay the updates in some order" store gets wrong in a way
// flat map sets never expose — concurrent character insertions only land in the
// right sequence if the causal order of the updates survives the round trip.
// The doc here is also built by two writers whose edits INTERLEAVE, so the
// history is not a straight line.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-reconstruct";

function makeIO() {
  const disk = new Map<string, Uint8Array>();
  return {
    disk,
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (p: string, d: Uint8Array): Promise<void> => {
      disk.set(p, Uint8Array.from(d));
    },
    append: async (p: string, d: Uint8Array): Promise<void> => {
      const prev = disk.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      disk.set(p, out);
    },
    truncate: async (p: string): Promise<void> => {
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      disk.delete(p);
    },
  };
}

/** Two writers editing one Y.Text and one Y.Array, interleaved. */
function interleavedDoc(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));

  const other = new Y.Doc();
  const sync = (from: Y.Doc, to: Y.Doc): void => {
    Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
  };

  doc.getText("body").insert(0, "hello");
  sync(doc, other);
  other.getText("body").insert(5, " world");
  other.getArray("order").push(["b"]);
  sync(other, doc);
  doc.getArray("order").insert(0, ["a"]);
  doc.getText("body").insert(0, ">> ");
  sync(doc, other);
  other.getArray("order").push(["c"]);
  sync(other, doc);

  return { doc, updates };
}

describe("WP24 AC2 blind1 — nested types survive the round trip in order", () => {
  it("text content, array order and the state vector all come back identical", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = interleavedDoc();
    expect(updates.length).toBeGreaterThanOrEqual(4);
    for (const update of updates) await store.append(GUID, update);

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(revived.getText("body").toString()).toBe(doc.getText("body").toString());
    expect(revived.getArray("order").toArray()).toEqual(doc.getArray("order").toArray());
    expect(Y.encodeStateVector(revived)).toEqual(Y.encodeStateVector(doc));
  });

  it("the fixture is non-trivial: interleaved text and a three-element array", () => {
    const { doc } = interleavedDoc();
    expect(doc.getText("body").toString()).toBe(">> hello world");
    expect(doc.getArray("order").toArray()).toEqual(["a", "b", "c"]);
  });

  it("a checkpoint taken mid-life does not disturb the nested reconstruction", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = interleavedDoc();

    const half = Math.ceil(updates.length / 2);
    for (const update of updates.slice(0, half)) await store.append(GUID, update);

    const midpoint = new Y.Doc();
    for (const update of updates.slice(0, half)) Y.applyUpdate(midpoint, update);
    await store.checkpoint(GUID, midpoint);

    for (const update of updates.slice(half)) await store.append(GUID, update);

    const revived = new Y.Doc();
    await store.load(GUID, revived);

    expect(revived.getText("body").toString()).toBe(doc.getText("body").toString());
    expect(revived.getArray("order").toArray()).toEqual(doc.getArray("order").toArray());
  });

  it("a reloaded replica accepts further peer edits without duplicating history", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = interleavedDoc();
    for (const update of updates) await store.append(GUID, update);

    const revived = new Y.Doc();
    await store.load(GUID, revived);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getText("body").insert(peer.getText("body").length, "!");
    Y.applyUpdate(revived, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(revived)));

    expect(revived.getText("body").toString()).toBe(`${doc.getText("body").toString()}!`);
  });
});
