// WP24 / AC1+AC2 blind2 — the "replica restart" property the BUILD_SPEC names
// as WP24's fuzzer link, expressed as a seeded random walk.
//
// Different angle and different data: 60 pseudo-random operations (set, update,
// delete, text insert) driven by a deterministic mulberry32 generator — no
// Math.random, reproducible from the seed per the BUILD_SPEC's determinism
// rule. At a randomly chosen point the replica "restarts": it compacts, drops
// its in-memory doc, and reloads from the sidecar. It must end up in exactly
// the state of a twin replica that stayed online for the whole run.
//
// A delta-shaped checkpoint, an off-by-one in the frame walker, or a store that
// silently drops the frames written after the compaction all show up as a
// divergence at some seed, which is why the walk runs over eight seeds rather
// than one.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-restart";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function applyOp(doc: Y.Doc, rng: () => number, step: number): void {
  const nodes = doc.getMap("nodes");
  const keys = [...nodes.keys()];
  const roll = rng();
  if (roll < 0.45 || keys.length === 0) {
    nodes.set(`n${step}`, { x: Math.floor(rng() * 1000), label: `s${step}` });
  } else if (roll < 0.7) {
    const key = keys[Math.floor(rng() * keys.length)];
    nodes.set(key, { x: Math.floor(rng() * 1000), label: `edited-${step}` });
  } else if (roll < 0.85) {
    nodes.delete(keys[Math.floor(rng() * keys.length)]);
  } else {
    doc.getText("body").insert(Math.floor(rng() * (doc.getText("body").length + 1)), `${step % 10}`);
  }
}

/** Key order in `toJSON()` is not part of the contract, so it is normalised away. */
function signature(doc: Y.Doc): string {
  const nodes = doc.getMap("nodes").toJSON() as Record<string, unknown>;
  const ordered = Object.keys(nodes)
    .sort()
    .map((key) => [key, nodes[key]]);
  return JSON.stringify([
    [...Y.encodeStateVector(doc)],
    ordered,
    doc.getText("body").toString(),
  ]);
}

describe("WP24 blind2 — a restarted replica equals one that stayed online", () => {
  const SEEDS = [1, 7, 19, 42, 101, 777, 2024, 31337];

  it.each(SEEDS)("seed %i: restart mid-run converges on the same state", async (seed) => {
    const io = makeIO();
    const store = createSidecarStore(io);

    const online = new Y.Doc();
    const captured: Uint8Array[] = [];
    online.on("update", (u: Uint8Array) => captured.push(Uint8Array.from(u)));

    const rng = mulberry32(seed);
    const restartAt = 10 + Math.floor(rng() * 40);

    let restarted: Y.Doc | undefined;
    for (let step = 0; step < 60; step++) {
      applyOp(online, rng, step);
      for (const update of captured.splice(0)) await store.append(GUID, update);

      if (step === restartAt) {
        // The replica compacts and "dies".
        await store.checkpoint(GUID, online);
        restarted = new Y.Doc();
        const result = await store.load(GUID, restarted);
        expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
        expect(signature(restarted)).toBe(signature(online));
      }
    }

    expect(restarted).toBeDefined();

    const final = new Y.Doc();
    const result = await store.load(GUID, final);
    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(signature(final)).toBe(signature(online));
  });

  it("the walk actually does something — 60 steps leave a non-trivial doc", () => {
    const doc = new Y.Doc();
    const rng = mulberry32(42);
    for (let step = 0; step < 60; step++) applyOp(doc, rng, step);
    expect(Object.keys(doc.getMap("nodes").toJSON()).length).toBeGreaterThan(5);
    expect(doc.getText("body").length).toBeGreaterThan(0);
  });

  it("the same seed produces the same walk twice — the run is reproducible", () => {
    const build = (): string => {
      const doc = new Y.Doc();
      const rng = mulberry32(19);
      for (let step = 0; step < 60; step++) applyOp(doc, rng, step);
      return JSON.stringify([doc.getMap("nodes").toJSON(), doc.getText("body").toString()]);
    };
    expect(build()).toBe(build());
  });
});
