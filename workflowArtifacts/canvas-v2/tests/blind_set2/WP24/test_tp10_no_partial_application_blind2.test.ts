// WP24 / AC3 blind2 — the partial-application prohibition observed from INSIDE
// the doc, through Yjs observers and the struct store, rather than from its
// JSON projection.
//
// Different angle: `toJSON()` is a lens. A doc can hold integrated structs,
// pending deletes and root types that `toJSON()` renders as `{}` — so "the JSON
// is empty" is a weaker claim than "nothing was integrated". Here the oracle is
// `Y.encodeStateAsUpdate(doc)` byte-compared against a doc that never met the
// store, plus deep observers on three root types that must never fire, plus the
// transaction count. Nothing may have happened at all.
//
// The poison is placed LAST, which is the position a "keep the good prefix"
// implementation profits from most: it has already applied everything except
// one frame, and discarding that work feels wasteful. AC3 says discard it.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-partial";
const POISON = new Uint8Array(48).fill(0xff);

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function richUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  doc.getMap("nodes").set("n1", { v: 1 });
  doc.getArray("ord").push(["first", "second"]);
  doc.getText("body").insert(0, "content that would be visible");
  doc.getMap("nodes").set("n2", { v: 2 });
  doc.getMap("nodes").delete("n1");
  return out;
}

function storeOver(history: Uint8Array, checkpoint?: Uint8Array) {
  const disk = new Map<string, Uint8Array>([[sidecarHistoryPath(GUID), history]]);
  if (checkpoint) disk.set(sidecarCheckpointPath(GUID), checkpoint);
  return createSidecarStore({
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (): Promise<void> => undefined,
    append: async (): Promise<void> => undefined,
    truncate: async (): Promise<void> => undefined,
    remove: async (): Promise<void> => undefined,
  });
}

/** A doc wired with observers on every root type it will ever have. */
function watchedDoc(): { doc: Y.Doc; fired: string[]; transactions: number } {
  const doc = new Y.Doc();
  const fired: string[] = [];
  const state = { transactions: 0 };
  doc.getMap("nodes").observeDeep(() => fired.push("nodes"));
  doc.getArray("ord").observeDeep(() => fired.push("ord"));
  doc.getText("body").observeDeep(() => fired.push("body"));
  doc.on("afterTransaction", () => {
    state.transactions += 1;
  });
  return {
    doc,
    fired,
    get transactions(): number {
      return state.transactions;
    },
  };
}

describe("WP24 AC3 blind2 — nothing at all happens inside the doc", () => {
  it("PREMISE: the good frames are visible and the poison is refused", () => {
    const updates = richUpdates();
    expect(updates).toHaveLength(5);
    expect(() => Y.applyUpdate(new Y.Doc(), POISON)).toThrow();

    const control = new Y.Doc();
    for (const update of updates) Y.applyUpdate(control, update);
    expect(control.getText("body").toString()).toBe("content that would be visible");
    expect(control.getArray("ord").toArray()).toEqual(["first", "second"]);
  });

  it("poison in the LAST frame: no observer fires, no transaction runs", async () => {
    const updates = richUpdates();
    const store = storeOver(join([...updates.map(frame), frame(POISON)]));
    const watched = watchedDoc();

    const result = await store.load(GUID, watched.doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.historyEntriesApplied).toBe(0);
    expect(watched.fired).toEqual([]);
    expect(watched.transactions).toBe(0);
  });

  it("the doc's encoded state is byte-identical to one that never saw the store", async () => {
    const updates = richUpdates();
    const store = storeOver(join([...updates.map(frame), frame(POISON)]));

    const target = new Y.Doc();
    const untouched = new Y.Doc();
    for (const doc of [target, untouched]) {
      doc.getMap("nodes");
      doc.getArray("ord");
      doc.getText("body");
    }

    await store.load(GUID, target);

    expect(Y.encodeStateAsUpdate(target)).toEqual(Y.encodeStateAsUpdate(untouched));
    expect(Y.encodeStateVector(target)).toEqual(Y.encodeStateVector(untouched));
  });

  it("the same load WITHOUT the poison does fire the observers — the watch works", async () => {
    const updates = richUpdates();
    const store = storeOver(join(updates.map(frame)));
    const watched = watchedDoc();

    const result = await store.load(GUID, watched.doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBe(5);
    expect(new Set(watched.fired)).toEqual(new Set(["nodes", "ord", "body"]));
    expect(watched.transactions).toBeGreaterThan(0);
  });

  it("a healthy checkpoint plus one poisoned frame still yields nothing", async () => {
    const updates = richUpdates();
    const checkpointDoc = new Y.Doc();
    for (const update of updates) Y.applyUpdate(checkpointDoc, update);

    const store = storeOver(frame(POISON), Y.encodeStateAsUpdate(checkpointDoc));
    const watched = watchedDoc();

    const result = await store.load(GUID, watched.doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.checkpointApplied).toBe(false);
    expect(watched.fired).toEqual([]);
    expect(watched.doc.getText("body").toString()).toBe("");
  });
});
