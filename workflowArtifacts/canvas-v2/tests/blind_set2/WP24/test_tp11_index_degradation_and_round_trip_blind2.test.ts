// WP24 / AC3 blind2 — index.json at scale, and the write path's own
// degradation surface.
//
// Different angle: 250 entries rather than two or five, so a store that builds
// JSON by concatenation or that truncates on a size heuristic shows up; the
// index is then rewritten SHRINKING (250 → 3 entries) which is the case a store
// using `append` or a partial overwrite gets wrong — the tail of the old,
// larger document survives and the file stops parsing, turning a healthy
// mapping into a corrupt one on the very next read.
//
// The last leg checks that the write path also goes through the injected seam:
// with an io whose `write` refuses, `writeIndex` must surface the failure
// rather than swallow it. AC3's "never throws" is a claim about LOADING a
// damaged sidecar, not a licence to hide a failed write.

import { describe, expect, it } from "vitest";

import {
  createSidecarStore,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function makeIO(initial?: Uint8Array) {
  const disk = new Map<string, Uint8Array>();
  if (initial) disk.set(sidecarIndexPath(), Uint8Array.from(initial));
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

function bigMapping(count: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    out[`guid-${String(i).padStart(4, "0")}-${"abcdef".repeat(2)}`] =
      `Vault/Section ${i % 17}/Board ${i}.canvas`;
  }
  return out;
}

describe("WP24 blind2 — index.json at 250 entries", () => {
  it("round-trips all 250 entries without loss or reordering of values", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const mapping = bigMapping(250);

    await store.writeIndex(mapping);
    const read = await store.readIndex();

    expect(Object.keys(read)).toHaveLength(250);
    expect(read).toEqual(mapping);
  });

  it("shrinking the index leaves no tail of the previous document behind", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);

    await store.writeIndex(bigMapping(250));
    const largeBytes = (io.disk.get(sidecarIndexPath()) as Uint8Array).length;

    const small = { "guid-a": "A.canvas", "guid-b": "B.canvas", "guid-c": "C.canvas" };
    await store.writeIndex(small);

    const bytes = io.disk.get(sidecarIndexPath()) as Uint8Array;
    expect(bytes.length).toBeLessThan(largeBytes / 10);
    expect(() => JSON.parse(dec(bytes))).not.toThrow();
    expect(await store.readIndex()).toEqual(small);
  });

  it("a mapping written then read by a SECOND store instance is identical", async () => {
    const io = makeIO();
    const writer = createSidecarStore(io);
    const reader = createSidecarStore(io);
    const mapping = bigMapping(40);

    await writer.writeIndex(mapping);

    expect(await reader.readIndex()).toEqual(mapping);
  });
});

describe("WP24 AC3 blind2 — a damaged index degrades; a failed write does not", () => {
  it("truncating the file mid-document degrades to an empty mapping", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    await store.writeIndex(bigMapping(250));

    const bytes = io.disk.get(sidecarIndexPath()) as Uint8Array;
    io.disk.set(sidecarIndexPath(), bytes.slice(0, Math.floor(bytes.length / 3)));

    expect(await store.readIndex()).toEqual({});
  });

  it("a UTF-8 BOM in front of valid JSON does not take the plugin down", async () => {
    const withBom = enc(`﻿${JSON.stringify({ "guid-x": "X.canvas" })}`);
    const store = createSidecarStore(makeIO(withBom));

    const index = await store.readIndex();

    expect(typeof index).toBe("object");
    expect(index).not.toBeNull();
  });

  it("a refused write surfaces as a rejection rather than a silent no-op", async () => {
    const store = createSidecarStore({
      ensureDir: async (): Promise<void> => undefined,
      exists: async (): Promise<boolean> => false,
      read: async (): Promise<Uint8Array> => new Uint8Array(0),
      write: async (): Promise<void> => {
        throw new Error("read-only vault");
      },
      append: async (): Promise<void> => undefined,
      truncate: async (): Promise<void> => undefined,
      remove: async (): Promise<void> => undefined,
    });

    await expect(store.writeIndex({ "guid-y": "Y.canvas" })).rejects.toThrow("read-only vault");
  });
});
