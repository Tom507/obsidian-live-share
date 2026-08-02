// WP24 / AC3 (truncated) blind1 — an exhaustive tear sweep instead of three
// hand-picked tears.
//
// Different angle: build a history of six frames, then cut it at EVERY byte
// offset and demand that the store answer correctly at each one — NONE exactly
// at the frame boundaries, TRUNCATED everywhere else, and never a throw, never
// a CORRUPT, never a partially populated doc. The boundary offsets are computed
// independently from the pinned framing (`4 + payload.length` per frame), so
// the sweep also pins the format without ever asking the store what it thinks
// the format is.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-torn";

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function sixUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  const nodes = doc.getMap("nodes");
  nodes.set("s1", { label: "a" });
  nodes.set("s2", { label: "bb" });
  nodes.set("s3", { label: "ccc" });
  nodes.set("s4", { label: "dddd" });
  nodes.delete("s2");
  nodes.set("s5", { label: "eeeee" });
  return out;
}

function makeIO(history: Uint8Array) {
  const disk = new Map<string, Uint8Array>([[sidecarHistoryPath(GUID), history]]);
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
    append: async (): Promise<void> => undefined,
    truncate: async (p: string): Promise<void> => {
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      disk.delete(p);
    },
  };
}

describe("WP24 AC3 blind1 — every possible tear of a six-frame history", () => {
  const updates = sixUpdates();
  const frames = updates.map(frame);
  const whole = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
  {
    let at = 0;
    for (const f of frames) {
      whole.set(f, at);
      at += f.length;
    }
  }
  const boundaries = new Set<number>();
  {
    let at = 0;
    boundaries.add(0);
    for (const f of frames) {
      at += f.length;
      boundaries.add(at);
    }
  }

  it("the fixture has six frames and a non-trivial length", () => {
    expect(frames).toHaveLength(6);
    expect(whole.length).toBeGreaterThan(60);
  });

  it("answers NONE at a frame boundary and TRUNCATED everywhere else", async () => {
    for (let cut = 0; cut <= whole.length; cut++) {
      const store = createSidecarStore(makeIO(whole.slice(0, cut)));
      const doc = new Y.Doc();
      const result = await store.load(GUID, doc);
      const expected = boundaries.has(cut)
        ? SIDECAR_DEGRADATION.NONE
        : SIDECAR_DEGRADATION.TRUNCATED;
      expect(result.degradation, `cut at ${cut}`).toBe(expected);
      if (expected === SIDECAR_DEGRADATION.TRUNCATED) {
        expect(result.historyEntriesApplied, `cut at ${cut}`).toBe(0);
        expect(doc.getMap("nodes").toJSON(), `cut at ${cut}`).toEqual({});
      }
    }
  });

  it("reports the exact frame count at each boundary", async () => {
    const ordered = [...boundaries].sort((a, b) => a - b);
    for (const [index, cut] of ordered.entries()) {
      const store = createSidecarStore(makeIO(whole.slice(0, cut)));
      const result = await store.load(GUID, new Y.Doc());
      expect(result.historyEntriesApplied, `boundary ${cut}`).toBe(index);
    }
  });

  it("a tear leaves the file untouched — no self-repair", async () => {
    const torn = whole.slice(0, whole.length - 2);
    const io = makeIO(torn);
    const store = createSidecarStore(io);

    await store.load(GUID, new Y.Doc());

    expect(io.disk.get(sidecarHistoryPath(GUID))).toEqual(torn);
  });
});
