// WP24 / AC3 (corrupt) blind1 — bit-flip fuzzing of a REAL update instead of
// hand-written garbage constants.
//
// Different angle and different data: take a genuine Yjs update, flip one byte
// at a time, and keep only those mutants that Yjs actually rejects (verified
// per mutant, in the test, so the corpus can never quietly become empty). Every
// surviving mutant must produce CORRUPT — never a throw out of `load`, never
// TRUNCATED (the frame is complete and its declared length is honest), and
// never a doc with content.
//
// This is the case a store passes by accident if it only checks lengths: the
// framing is perfect, so length-based validation sees nothing wrong.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-corrupt";

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function realUpdate(): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap("nodes").set("mutant-source", { label: "content", x: 5, y: 6 });
  doc.getText("body").insert(0, "some text so the encoding is not tiny");
  return Y.encodeStateAsUpdate(doc);
}

function rejectedMutants(base: Uint8Array, limit: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < base.length && out.length < limit; i++) {
    const mutant = Uint8Array.from(base);
    mutant[i] = (mutant[i] ^ 0x5a) & 0xff;
    try {
      Y.applyUpdate(new Y.Doc(), mutant);
    } catch {
      out.push(mutant);
    }
  }
  return out;
}

function makeIO(files: Record<string, Uint8Array>) {
  const disk = new Map(Object.entries(files).map(([p, b]) => [p, Uint8Array.from(b)]));
  const mutations: string[] = [];
  return {
    disk,
    mutations,
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (p: string, d: Uint8Array): Promise<void> => {
      mutations.push(`write ${p}`);
      disk.set(p, Uint8Array.from(d));
    },
    append: async (p: string): Promise<void> => {
      mutations.push(`append ${p}`);
    },
    truncate: async (p: string): Promise<void> => {
      mutations.push(`truncate ${p}`);
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      mutations.push(`remove ${p}`);
      disk.delete(p);
    },
  };
}

describe("WP24 AC3 blind1 — bit-flipped updates are CORRUPT, never fatal", () => {
  const base = realUpdate();
  const mutants = rejectedMutants(base, 12);

  it("the corpus is non-empty and every member really is rejected by Yjs", () => {
    expect(mutants.length).toBeGreaterThanOrEqual(4);
    for (const mutant of mutants) {
      expect(() => Y.applyUpdate(new Y.Doc(), mutant)).toThrow();
    }
    expect(() => Y.applyUpdate(new Y.Doc(), base)).not.toThrow();
  });

  it("each mutant, framed correctly, yields CORRUPT and an untouched doc", async () => {
    for (const [index, mutant] of mutants.entries()) {
      const io = makeIO({ [sidecarHistoryPath(GUID)]: frame(mutant) });
      const store = createSidecarStore(io);
      const doc = new Y.Doc();
      const events: unknown[] = [];
      doc.on("update", (u: Uint8Array) => events.push(u));

      const result = await store.load(GUID, doc);

      expect(result.degradation, `mutant ${index}`).toBe(SIDECAR_DEGRADATION.CORRUPT);
      expect(result.historyEntriesApplied, `mutant ${index}`).toBe(0);
      expect(events, `mutant ${index}`).toHaveLength(0);
      expect(io.mutations, `mutant ${index}`).toEqual([]);
    }
  });

  it("each mutant as a CHECKPOINT yields CORRUPT too", async () => {
    for (const [index, mutant] of mutants.entries()) {
      const io = makeIO({ [sidecarCheckpointPath(GUID)]: mutant });
      const store = createSidecarStore(io);
      const result = await store.load(GUID, new Y.Doc());
      expect(result.degradation, `mutant ${index}`).toBe(SIDECAR_DEGRADATION.CORRUPT);
      expect(result.checkpointApplied, `mutant ${index}`).toBe(false);
    }
  });

  it("the unmutated original loads cleanly through the same path", async () => {
    const io = makeIO({ [sidecarHistoryPath(GUID)]: frame(base) });
    const store = createSidecarStore(io);
    const doc = new Y.Doc();

    const result = await store.load(GUID, doc);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.historyEntriesApplied).toBe(1);
    expect(doc.getMap("nodes").toJSON()).toEqual({
      "mutant-source": { label: "content", x: 5, y: 6 },
    });
  });
});
