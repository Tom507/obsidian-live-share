// WP24 / AC1 blind2 — the copy-before-await rule attacked through a SHARED
// ArrayBuffer with two overlapping views.
//
// Different angle: the visible test recycles one array, blind1 cycles a ring of
// three. Here there is one 4 KiB `ArrayBuffer` and the updates are handed to the
// store as `Uint8Array` VIEWS into it at different byte offsets — which is
// exactly what a `ws` frame looks like after `lib0` slices it. Two further
// traps ride along:
//
//   - `Uint8Array.from(view)` copies correctly but `new Uint8Array(view.buffer)`
//     does not: it aliases the whole 4 KiB buffer, so a store that "copies" that
//     way writes 4 KiB per frame and still tracks the caller's mutations.
//   - the checkpoint path has the same requirement, so `checkpoint` is checked
//     against a doc that is mutated between the call and the await.
//
// The oracle is always the persisted bytes against the payload as it was at
// call time; frame count and file length are deliberately not the subject,
// because the broken store gets both of those right.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-snapshot";

function makeIO() {
  const disk = new Map<string, Uint8Array>();
  const readAtEffect = async (p: string, d: Uint8Array, mode: "write" | "append"): Promise<void> => {
    // The bytes are consumed HERE, one microtask after the call — the moment a
    // real adapter would hand them to the vault.
    await Promise.resolve();
    const incoming = Uint8Array.from(d);
    if (mode === "write") {
      disk.set(p, incoming);
      return;
    }
    const prev = disk.get(p) ?? new Uint8Array(0);
    const out = new Uint8Array(prev.length + incoming.length);
    out.set(prev, 0);
    out.set(incoming, prev.length);
    disk.set(p, out);
  };
  return {
    disk,
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: (p: string, d: Uint8Array): Promise<void> => readAtEffect(p, d, "write"),
    append: (p: string, d: Uint8Array): Promise<void> => readAtEffect(p, d, "append"),
    truncate: async (p: string): Promise<void> => {
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      disk.delete(p);
    },
  };
}

function decodeFrames(history: Uint8Array): Uint8Array[] {
  const view = new DataView(history.buffer, history.byteOffset, history.byteLength);
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < history.length) {
    const n = view.getUint32(at, false);
    out.push(history.slice(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}

function fourUpdates(): Uint8Array[] {
  const doc = new Y.Doc();
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => out.push(Uint8Array.from(u)));
  doc.getMap("nodes").set("v1", { text: "alpha" });
  doc.getMap("nodes").set("v2", { text: "bravo bravo" });
  doc.getMap("nodes").set("v3", { text: "charlie charlie charlie" });
  doc.getMap("nodes").set("v4", { text: "delta" });
  return out;
}

describe("WP24 AC1 blind2 — views into one shared ArrayBuffer", () => {
  it("four appends over one 4 KiB buffer keep their own bytes after the buffer is wiped", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const updates = fourUpdates();

    const pooled = new ArrayBuffer(4096);
    const bytes = new Uint8Array(pooled);
    const pending: Promise<void>[] = [];
    let offset = 0;
    for (const update of updates) {
      bytes.set(update, offset);
      pending.push(store.append(GUID, new Uint8Array(pooled, offset, update.length)));
      offset += update.length;
    }
    bytes.fill(0x7e); // the socket reuses the whole pool for the next message
    await Promise.all(pending);

    const frames = decodeFrames(io.disk.get(sidecarHistoryPath(GUID)) as Uint8Array);
    expect(frames).toHaveLength(4);
    for (const [index, expected] of updates.entries()) {
      expect(frames[index], `frame ${index}`).toEqual(expected);
    }
  });

  it("no frame is 4096 bytes long — the copy is of the VIEW, not of its buffer", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const updates = fourUpdates();

    const pooled = new ArrayBuffer(4096);
    new Uint8Array(pooled).set(updates[0], 100);
    await store.append(GUID, new Uint8Array(pooled, 100, updates[0].length));

    const frames = decodeFrames(io.disk.get(sidecarHistoryPath(GUID)) as Uint8Array);
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(updates[0].length);
    expect(frames[0]).toEqual(updates[0]);
  });

  it("the wipe value really is absent from the payloads", () => {
    for (const update of fourUpdates()) expect(update.every((b) => b === 0x7e)).toBe(false);
  });

  it("checkpoint captures the doc as of the call, not as of the await", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const doc = new Y.Doc();
    doc.getMap("nodes").set("at-call", { v: 1 });

    const pending = store.checkpoint(GUID, doc);
    doc.getMap("nodes").set("after-call", { v: 2 });
    await pending;

    const probe = new Y.Doc();
    Y.applyUpdate(probe, io.disk.get(sidecarCheckpointPath(GUID)) as Uint8Array);
    expect(probe.getMap("nodes").has("at-call")).toBe(true);
    expect(probe.getMap("nodes").has("after-call")).toBe(false);
  });

  it("the reconstructed doc from the pooled appends is the original", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const updates = fourUpdates();

    const pooled = new ArrayBuffer(4096);
    const bytes = new Uint8Array(pooled);
    const pending: Promise<void>[] = [];
    let offset = 0;
    for (const update of updates) {
      bytes.set(update, offset);
      pending.push(store.append(GUID, new Uint8Array(pooled, offset, update.length)));
      offset += update.length;
    }
    bytes.fill(0);
    await Promise.all(pending);

    const revived = new Y.Doc();
    await store.load(GUID, revived);
    expect(Object.keys(revived.getMap("nodes").toJSON()).sort()).toEqual(["v1", "v2", "v3", "v4"]);
  });
});
