// WP24 / AC1 blind2 — append-only, attacked with TWO store instances over one
// disk and with concurrently-issued appends.
//
// Different angle: a read-modify-write store is not merely slow, it is lossy
// under concurrency — two instances that each read the file, concatenate and
// write back lose one another's records entirely. Two `SidecarStore`s sharing
// one `SidecarIO` is exactly the shape WP25 will produce when a second doc
// subscribes while the first is mid-flush, and no single-instance test can see
// it.
//
// The second leg issues ten appends WITHOUT awaiting in between. Under a real
// append-only primitive the file ends up with ten frames whatever the
// scheduling; under read-modify-write the interleaving eats most of them.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-append";

/** One disk, handed to as many stores as a test wants. */
function sharedDisk() {
  const disk = new Map<string, Uint8Array>();
  const io = {
    ensureDir: async (): Promise<void> => {
      await Promise.resolve();
    },
    exists: async (p: string): Promise<boolean> => {
      await Promise.resolve();
      return disk.has(p);
    },
    read: async (p: string): Promise<Uint8Array> => {
      await Promise.resolve();
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (p: string, d: Uint8Array): Promise<void> => {
      await Promise.resolve();
      disk.set(p, Uint8Array.from(d));
    },
    append: async (p: string, d: Uint8Array): Promise<void> => {
      await Promise.resolve();
      const prev = disk.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      disk.set(p, out);
    },
    truncate: async (p: string): Promise<void> => {
      await Promise.resolve();
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      await Promise.resolve();
      disk.delete(p);
    },
  };
  return { disk, io };
}

function countFrames(history: Uint8Array): number {
  const view = new DataView(history.buffer, history.byteOffset, history.byteLength);
  let at = 0;
  let count = 0;
  while (at + 4 <= history.length) {
    const n = view.getUint32(at, false);
    if (at + 4 + n > history.length) throw new Error("torn frame — the file lost bytes");
    at += 4 + n;
    count += 1;
  }
  if (at !== history.length) throw new Error("trailing bytes — the file lost bytes");
  return count;
}

function updatesFrom(count: number): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  for (let i = 0; i < count; i++) doc.getMap("nodes").set(`c${i}`, { i, pad: "-".repeat(i) });
  return out;
}

describe("WP24 AC1 blind2 — concurrency cannot lose a record", () => {
  it("two stores over one disk both land all of their appends", async () => {
    const { disk, io } = sharedDisk();
    const storeA = createSidecarStore(io);
    const storeB = createSidecarStore(io);
    const updates = updatesFrom(8);

    await Promise.all([
      ...updates.slice(0, 4).map((u) => storeA.append(GUID, u)),
      ...updates.slice(4).map((u) => storeB.append(GUID, u)),
    ]);

    const history = disk.get(sidecarHistoryPath(GUID)) as Uint8Array;
    expect(countFrames(history)).toBe(8);
    const total = updates.reduce((sum, u) => sum + u.length + 4, 0);
    expect(history.length).toBe(total);
  });

  it("ten appends issued without awaiting in between all survive", async () => {
    const { disk, io } = sharedDisk();
    const store = createSidecarStore(io);
    const updates = updatesFrom(10);

    const pending = updates.map((u) => store.append(GUID, u));
    await Promise.all(pending);

    expect(countFrames(disk.get(sidecarHistoryPath(GUID)) as Uint8Array)).toBe(10);
  });

  it("the whole set is recoverable afterwards, by any of the stores", async () => {
    const { io } = sharedDisk();
    const writer = createSidecarStore(io);
    const reader = createSidecarStore(io);
    const updates = updatesFrom(6);

    for (const update of updates) await writer.append(GUID, update);

    const doc = new Y.Doc();
    const result = await reader.load(GUID, doc);

    expect(result.historyEntriesApplied).toBe(6);
    expect(Object.keys(doc.getMap("nodes").toJSON())).toHaveLength(6);
  });

  it("the fixture's updates are all distinct — no accidental dedup", () => {
    const seen = new Set(updatesFrom(10).map((u) => u.join(",")));
    expect(seen.size).toBe(10);
  });
});
