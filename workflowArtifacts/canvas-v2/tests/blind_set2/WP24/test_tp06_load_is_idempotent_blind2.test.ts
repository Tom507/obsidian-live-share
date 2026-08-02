// WP24 / AC2 blind2 — idempotence measured as "the second load is a NO-OP at
// the doc's own update channel".
//
// Different angle: the visible test compares snapshots and blind1 counts disk
// bytes. Here the oracle is Yjs itself. Applying an update that contains
// nothing new emits no `update` event at all, so a correct second load is
// observably silent. That is a much sharper instrument than snapshot equality:
// a store that re-applies the whole reconstruction as a fresh transaction
// produces an identical snapshot and a second event, and every downstream
// observer (the persistence writer, the binding, the relay broadcaster) sees a
// spurious change that then travels to every peer.
//
// The third leg loads in the OPPOSITE order — a doc that is already ahead of
// its sidecar must not be dragged backwards.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-idempotent";

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

async function seeded() {
  const io = makeIO();
  const store = createSidecarStore(io);
  const source = new Y.Doc();
  const pending: Uint8Array[] = [];
  source.on("update", (u: Uint8Array) => pending.push(Uint8Array.from(u)));
  source.getMap("nodes").set("p", { v: "one" });
  source.getText("body").insert(0, "abc");
  source.getMap("nodes").set("q", { v: "two" });
  for (const update of pending.splice(0)) await store.append(GUID, update);
  return { io, store, source, pending };
}

describe("WP24 AC2 blind2 — the second load is silent", () => {
  it("emits an update on the first load and none on the second or third", async () => {
    const { store } = await seeded();
    const doc = new Y.Doc();
    const events: unknown[] = [];
    doc.on("update", (u: Uint8Array) => events.push(u));

    await store.load(GUID, doc);
    expect(events).toHaveLength(1);

    await store.load(GUID, doc);
    await store.load(GUID, doc);
    expect(events).toHaveLength(1);
  });

  it("PREMISE: Yjs really is silent for a redundant update", () => {
    // Without this, "no second event" could just mean the store never applied
    // anything on the first load either.
    const a = new Y.Doc();
    a.getMap("nodes").set("x", 1);
    const b = new Y.Doc();
    const seen: unknown[] = [];
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    b.on("update", (u: Uint8Array) => seen.push(u));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(seen).toHaveLength(0);
  });

  it("a doc AHEAD of its sidecar is never dragged backwards by a load", async () => {
    const { store } = await seeded();
    const doc = new Y.Doc();
    await store.load(GUID, doc);

    doc.getMap("nodes").set("r", { v: "three" });
    doc.getMap("nodes").delete("p");
    const ahead = {
      nodes: doc.getMap("nodes").toJSON(),
      sv: [...Y.encodeStateVector(doc)],
      body: doc.getText("body").toString(),
    };

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(doc.getMap("nodes").toJSON()).toEqual(ahead.nodes);
    expect([...Y.encodeStateVector(doc)]).toEqual(ahead.sv);
    expect(doc.getText("body").toString()).toBe(ahead.body);
    expect(doc.getMap("nodes").has("p")).toBe(false);
  });

  it("appending more history between loads is picked up, and only once", async () => {
    const { store, source, pending } = await seeded();
    const doc = new Y.Doc();
    const events: unknown[] = [];
    doc.on("update", (u: Uint8Array) => events.push(u));

    await store.load(GUID, doc);
    expect(events).toHaveLength(1);

    source.getMap("nodes").set("late", { v: "four" });
    for (const update of pending.splice(0)) await store.append(GUID, update);

    await store.load(GUID, doc);
    expect(events).toHaveLength(2);
    await store.load(GUID, doc);
    expect(events).toHaveLength(2);
    expect(doc.getMap("nodes").toJSON()).toEqual(source.getMap("nodes").toJSON());
  });
});
