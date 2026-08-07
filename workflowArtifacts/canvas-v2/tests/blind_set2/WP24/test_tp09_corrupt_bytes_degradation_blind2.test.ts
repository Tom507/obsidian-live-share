// WP24 / AC3 (corrupt) blind2 — realistic corruption, not synthetic noise.
//
// Different angle and different data: the payloads here are the things that
// actually end up in a sidecar file by accident — a `.canvas` JSON document
// (someone's sync tool wrote the wrong file to the wrong path), a UTF-16 BOM'd
// text file, a run of NUL bytes from a sparse-file recovery, and a
// double-written history (the same frame concatenated onto itself at a
// half-frame offset). Each one is checked against Yjs first, so the corpus
// cannot silently degrade into "bytes Yjs happens to accept".
//
// The corruption also sits in the MIDDLE of a twenty-frame log rather than at
// the end, which is where "stop at the first bad frame and keep what you had"
// looks most reasonable and is most damaging.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-corrupt";

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

const CANVAS_JSON = new TextEncoder().encode(
  JSON.stringify({
    nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 40, text: "hi" }],
    edges: [],
  }),
);
const BOM_TEXT = new Uint8Array([
  0xff, 0xfe, 0x68, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00,
]);
const NULS = new Uint8Array(64).fill(0xff);

function twentyUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  for (let i = 0; i < 20; i++) doc.getMap("nodes").set(`m${i}`, { i, note: `n${i}` });
  return out;
}

function storeOver(files: Record<string, Uint8Array>) {
  const disk = new Map(Object.entries(files).map(([p, b]) => [p, Uint8Array.from(b)]));
  const mutations: string[] = [];
  const store = createSidecarStore({
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (p: string): Promise<void> => {
      mutations.push(`write ${p}`);
    },
    append: async (p: string): Promise<void> => {
      mutations.push(`append ${p}`);
    },
    truncate: async (p: string): Promise<void> => {
      mutations.push(`truncate ${p}`);
    },
    remove: async (p: string): Promise<void> => {
      mutations.push(`remove ${p}`);
    },
  });
  return { store, disk, mutations };
}

describe("WP24 AC3 blind2 — realistic garbage in the middle of a long log", () => {
  const POISONS: Array<[string, Uint8Array]> = [
    ["a .canvas JSON document", CANVAS_JSON],
    ["a UTF-16 BOM'd text file", BOM_TEXT],
    ["a run of 0xff bytes", NULS],
  ];

  it("PREMISE: every poison really is rejected by Yjs", () => {
    for (const [label, bytes] of POISONS) {
      expect(() => Y.applyUpdate(new Y.Doc(), bytes), label).toThrow();
    }
  });

  it.each(POISONS)("%s at position 10 of 20 yields CORRUPT and an empty doc", async (_l, poison) => {
    const updates = twentyUpdates();
    const frames = updates.map((u, i) => frame(i === 10 ? poison : u));
    const { store, mutations } = storeOver({ [sidecarHistoryPath(GUID)]: join(frames) });

    const doc = new Y.Doc();
    const events: unknown[] = [];
    doc.on("update", (u: Uint8Array) => events.push(u));

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.historyEntriesApplied).toBe(0);
    expect(events).toHaveLength(0);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
    expect(mutations).toEqual([]);
  });

  it("the clean twenty-frame log loads all twenty — the poison is what breaks it", async () => {
    const updates = twentyUpdates();
    const { store } = storeOver({ [sidecarHistoryPath(GUID)]: join(updates.map(frame)) });

    const doc = new Y.Doc();
    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBe(20);
    expect(Object.keys(doc.getMap("nodes").toJSON())).toHaveLength(20);
  });

  it("a `.canvas` document written over the CHECKPOINT is CORRUPT too", async () => {
    const { store } = storeOver({
      [sidecarCheckpointPath(GUID)]: CANVAS_JSON,
      [sidecarHistoryPath(GUID)]: join(twentyUpdates().map(frame)),
    });

    const doc = new Y.Doc();
    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.CORRUPT);
    expect(result.checkpointApplied).toBe(false);
    expect(result.historyEntriesApplied).toBe(0);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
  });

  it("a frame duplicated at a half-frame offset is degraded, never silently accepted", async () => {
    const updates = twentyUpdates();
    const clean = join(updates.slice(0, 5).map(frame));
    const smeared = join([clean, clean.slice(7)]);

    const { store } = storeOver({ [sidecarHistoryPath(GUID)]: smeared });
    const doc = new Y.Doc();
    const result = await store.load(GUID, doc);

    expect(result.degradation).not.toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBe(0);
    expect(doc.getMap("nodes").toJSON()).toEqual({});
  });
});
