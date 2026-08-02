// WP24 / AC1 blind1 — append-only, attacked from the "many small appends"
// direction instead of three-and-check.
//
// Different angle: 40 appends of deliberately UNEQUAL sizes (so no fixed-stride
// parser can pass by accident), and the oracle is a running prefix invariant —
// after every single append the file must still start with the exact bytes it
// had before. A read-modify-write store satisfies the final-state check but is
// caught here by counting how many times the history path is opened for
// anything other than `append`.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-append";

function makeIO() {
  const disk = new Map<string, number[]>();
  const log: string[] = [];
  const step = async <T>(op: string, path: string, fn: () => T): Promise<T> => {
    log.push(`${op}|${path}`);
    await Promise.resolve();
    return fn();
  };
  return {
    disk,
    log,
    bytes: (p: string) => Uint8Array.from(disk.get(p) ?? []),
    ensureDir: (d: string) => step("ensureDir", d, () => undefined),
    exists: (p: string) => step("exists", p, () => disk.has(p)),
    read: (p: string) =>
      step("read", p, () => {
        const found = disk.get(p);
        if (found === undefined) throw new Error(`ENOENT ${p}`);
        return Uint8Array.from(found);
      }),
    write: (p: string, d: Uint8Array) =>
      step("write", p, () => {
        disk.set(p, [...d]);
      }),
    append: (p: string, d: Uint8Array) =>
      step("append", p, () => {
        disk.set(p, [...(disk.get(p) ?? []), ...d]);
      }),
    truncate: (p: string) =>
      step("truncate", p, () => {
        disk.set(p, []);
      }),
    remove: (p: string) =>
      step("remove", p, () => {
        disk.delete(p);
      }),
  };
}

/** 40 updates whose encodings differ in length (short keys vs long values). */
function manyUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  const nodes = doc.getMap("nodes");
  for (let i = 0; i < 40; i++) {
    nodes.set(`k${i}`, { text: "x".repeat((i * 7) % 23), i });
  }
  return out;
}

describe("WP24 AC1 blind1 — the history only ever grows at its tail", () => {
  it("the file after append N always starts with the file after append N-1", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const updates = manyUpdates();
    expect(updates).toHaveLength(40);

    let previous = new Uint8Array(0);
    for (const update of updates) {
      await store.append(GUID, update);
      const current = io.bytes(sidecarHistoryPath(GUID));
      expect(current.length).toBeGreaterThan(previous.length);
      expect(current.slice(0, previous.length)).toEqual(previous);
      previous = current;
    }
  });

  it("the encodings really were of differing lengths — no fixed stride to exploit", () => {
    const lengths = new Set(manyUpdates().map((u) => u.length));
    expect(lengths.size).toBeGreaterThan(3);
  });

  it("the history path is opened by `append` and by nothing else", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    for (const update of manyUpdates()) await store.append(GUID, update);

    const path = sidecarHistoryPath(GUID);
    const ops = io.log.filter((line) => line.endsWith(`|${path}`)).map((l) => l.split("|")[0]);
    expect(ops).toHaveLength(40);
    expect(new Set(ops)).toEqual(new Set(["append"]));
  });

  it("interleaving two guids never mixes their bytes", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const updates = manyUpdates();

    for (let i = 0; i < 10; i++) {
      await store.append(i % 2 === 0 ? "even" : "odd", updates[i]);
    }

    const even = io.bytes(sidecarHistoryPath("even"));
    const odd = io.bytes(sidecarHistoryPath("odd"));
    expect(even.length).toBeGreaterThan(0);
    expect(odd.length).toBeGreaterThan(0);
    const total = updates.slice(0, 10).reduce((sum, u) => sum + u.length + 4, 0);
    expect(even.length + odd.length).toBe(total);
  });
});
