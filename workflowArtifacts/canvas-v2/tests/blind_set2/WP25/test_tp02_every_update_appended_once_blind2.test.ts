// WP25 / AC2 blind2 — "exactly once", attacked from the DUPLICATION side only,
// and through the paths that produce duplication in practice.
//
// The visible test counts frames against literals; blind1 compares multisets
// against the doc's own emissions. This one goes after the four ways a second
// handler actually gets installed in a real session:
//
//   ├── `attach` called twice for the same guid (a re-subscribe that did not
//   │   unsubscribe first — `CanvasSync.subscribe` returns early on an already
//   │   subscribed path, but the lifecycle has no such memory unless it is
//   │   given one),
//   ├── `attach` called with a NEW doc for the same guid (a reconnect that
//   │   replaced the `Y.Doc` — the old handler must go with the old doc),
//   ├── `detach` then `attach` (the handler must be re-installed exactly once,
//   │   not accumulated), and
//   └── a compaction, whose own removal transaction is an update like any other
//       and must be counted once, not zero times and not twice.
//
// EVERY ONE OF THESE IS INVISIBLE IN THE RECONSTRUCTED DOCUMENT. Yjs applies are
// idempotent, so a doubled history rebuilds byte-identically. The frame count is
// the only oracle that can fail.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import { DELETED_MAP_NAME } from "../../../../../plugin/src/files/canvas-sync";

const GUID = "4c8f13d6ae2b47509d3ea1c760bf8524";

function memoryIO(): SidecarIO & { files: Map<string, Uint8Array>; appends: number } {
  const files = new Map<string, Uint8Array>();
  const state = { appends: 0 };
  return {
    files,
    get appends() {
      return state.appends;
    },
    async ensureDir() {},
    async exists(p: string) {
      return files.has(p);
    },
    async read(p: string) {
      const f = files.get(p);
      if (!f) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(f);
    },
    async write(p: string, d: Uint8Array) {
      files.set(p, Uint8Array.from(d));
    },
    async append(p: string, d: Uint8Array) {
      state.appends += 1;
      const prev = files.get(p) ?? new Uint8Array(0);
      const out = new Uint8Array(prev.length + d.length);
      out.set(prev, 0);
      out.set(d, prev.length);
      files.set(p, out);
    },
    async truncate(p: string) {
      files.set(p, new Uint8Array(0));
    },
    async remove(p: string) {
      files.delete(p);
    },
  };
}

function frameCount(bytes: Uint8Array | undefined): number {
  if (!bytes) return 0;
  let at = 0;
  let n = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) throw new Error("torn header");
    const len =
      ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
    if (at + 4 + len > bytes.length) throw new Error("torn payload");
    at += 4 + len;
    n += 1;
  }
  return n;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function card(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    record.set("id", id);
    record.set("type", "text");
    record.set("text", `body of ${id}`);
  });
}

describe("WP25 AC2 blind2 — an update never lands in the history twice", () => {
  it("attaching the same guid and doc twice does not double the channel", async () => {
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();

    lifecycle.attach(GUID, doc);
    lifecycle.attach(GUID, doc);
    lifecycle.attach(GUID, doc);

    card(doc, "n-1");
    card(doc, "n-2");
    await settle();

    expect(
      frameCount(io.files.get(sidecarHistoryPath(GUID))),
      "the update handler was installed more than once",
    ).toBe(2);

    await lifecycle.destroy();
  });

  it("re-attaching with a REPLACEMENT doc retires the old one's handler", async () => {
    // A reconnect hands back a different `Y.Doc` under the same id. If the old
    // handler survives, the retired replica keeps writing into the live board's
    // history, and its frames still apply cleanly — so the doc looks fine and
    // carries state from a session that ended.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const first = new Y.Doc();
    lifecycle.attach(GUID, first);
    card(first, "n-old");
    await settle();
    expect(frameCount(io.files.get(sidecarHistoryPath(GUID)))).toBe(1);

    const second = new Y.Doc();
    lifecycle.attach(GUID, second);
    card(second, "n-new");
    await settle();
    expect(frameCount(io.files.get(sidecarHistoryPath(GUID)))).toBe(2);

    // The retired doc is still alive and still mutable.
    card(first, "n-ghost");
    await settle();
    expect(
      frameCount(io.files.get(sidecarHistoryPath(GUID))),
      "the replaced doc is still writing into the live history",
    ).toBe(2);

    await lifecycle.destroy();
  });

  it("detach → attach re-installs exactly one handler", async () => {
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();

    for (let cycle = 0; cycle < 3; cycle++) {
      lifecycle.attach(GUID, doc);
      await settle();
      await lifecycle.detach(GUID);
      await settle();
    }

    lifecycle.attach(GUID, doc);
    // The detach may have checkpointed; the frame count from here is what
    // matters, so measure the delta rather than the absolute.
    await settle();
    const before = frameCount(io.files.get(sidecarHistoryPath(GUID)));
    card(doc, "n-after-cycles");
    await settle();

    expect(
      frameCount(io.files.get(sidecarHistoryPath(GUID))) - before,
      "the handler accumulated across detach/attach cycles",
    ).toBe(1);

    await lifecycle.destroy();
  });

  it("a compaction's own removal transaction is not double-counted", async () => {
    // The compaction writes to the doc, so it emits an update. That update is
    // truncated away moments later by the checkpoint — which is fine — but it
    // must reach the channel exactly once on the way, or the accounting the rest
    // of this AC rests on is wrong precisely when the board is busiest.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: 5 });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);

    card(doc, "n-doomed");
    card(doc, "n-kept");
    doc.transact(() => {
      const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
      deleted.set("n-doomed", { t: 1, by: "peer-a", on: true });
      deleted.set("n-kept", { t: 90, by: "peer-b", on: false });
    });
    await settle();
    const beforeAppends = io.appends;

    const result = await lifecycle.compact(GUID, doc);
    await settle();

    expect(result.removedTombstoneIds).toEqual(["n-doomed"]);
    // At most one append for the removal transaction; the truncate then empties
    // the file, so the FILE cannot answer this — the call count can.
    expect(
      io.appends - beforeAppends,
      "the compaction's removal transaction was appended more than once",
    ).toBeLessThanOrEqual(1);
    expect(frameCount(io.files.get(sidecarHistoryPath(GUID)))).toBe(0);

    await lifecycle.destroy();
  });

  it("nothing is lost either — the reconstructed doc still holds every record", async () => {
    // The counterweight. Every assertion above is about an upper bound, and an
    // implementation that appends NOTHING satisfies all of them.
    const io = memoryIO();
    const store = createSidecarStore(io);
    const lifecycle = createSidecarLifecycle(store);
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    lifecycle.attach(GUID, doc);

    for (let i = 0; i < 5; i++) card(doc, `n-${i}`);
    await settle();

    const replica = new Y.Doc();
    const load = await store.load(GUID, replica);
    expect(load.degradation).toBe("none");
    expect([...replica.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "n-0",
      "n-1",
      "n-2",
      "n-3",
      "n-4",
    ]);

    await lifecycle.destroy();
  });
});
