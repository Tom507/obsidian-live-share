// WP25 / AC2 blind2 (cycle half) — the cycle with a PEER STILL EDITING through
// it.
//
// The visible test drives a quiet unsubscribe/resubscribe; blind1 throws the
// whole process away. This one keeps a peer alive across the boundary, which is
// the case that actually happens: the user closes a canvas, someone else keeps
// working on it, and the user opens it again.
//
// Three things then have to be true at once, and only the third is about the
// sidecar at all:
//
//   ├── everything THIS client wrote before the unsubscribe is on disk,
//   ├── the resubscribed replica converges with the peer that never left, and
//   └── the sidecar did not absorb the peer's edits twice — once through the
//       relay and once through its own replay — which is invisible in the doc
//       and visible only in the frame log.
//
// The convergence assertion is deliberately about MEMBERSHIP and the projection,
// never about which of two concurrent writers won a contested key: Yjs breaks
// same-key ties on `clientID`, which is `random.uint32()`, so an identity
// assertion there passes about half the time.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  DELETED_MAP_NAME,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

const GUID = "1a5f83c609d74be2857ce0b41d69f3a8";

function persistentIO(): SidecarIO & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
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

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function projection(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
}

function card(doc: Y.Doc, id: string, text: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    for (const [k, v] of Object.entries({
      id,
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      text,
    })) {
      record.set(k, v);
    }
  });
}

/** Move whatever `from` knows and `to` does not into `to`. */
function relay(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

describe("WP25 AC2 blind2 — the peer keeps working while this client is away", () => {
  it("the returning replica converges with the peer that never left", async () => {
    const io = persistentIO();
    const peer = new Y.Doc();

    // ── attached ──────────────────────────────────────────────────────────
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const mine = new Y.Doc();
    lifecycle.attach(GUID, mine);
    card(mine, "mine-1", "written before leaving");
    relay(mine, peer);
    card(peer, "peer-1", "peer, while we were here");
    relay(peer, mine);
    await settle();

    // ── away ──────────────────────────────────────────────────────────────
    await lifecycle.detach(GUID);
    await settle();
    card(peer, "peer-2", "peer, while we were away");
    card(peer, "peer-3", "peer again");

    // ── back, with nothing but the sidecar ────────────────────────────────
    const returning = new Y.Doc();
    const secondLifecycle = createSidecarLifecycle(createSidecarStore(io));
    secondLifecycle.attach(GUID, returning);
    const load = await secondLifecycle.load(GUID, returning);
    await settle();
    expect(load.degradation).toBe("none");
    expect(
      [...returning.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
      "the pre-departure state was not recovered from the sidecar",
    ).toEqual(["mine-1", "peer-1"]);

    // now the relay catches it up, exactly as a reconnect would
    relay(peer, returning);
    relay(returning, peer);
    await settle();

    expect([...returning.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "mine-1",
      "peer-1",
      "peer-2",
      "peer-3",
    ]);
    expect(projection(returning), "the returning replica did not converge").toBe(
      projection(peer),
    );

    await secondLifecycle.destroy();
    await lifecycle.destroy();
  });

  it("the catch-up is appended, and the replayed history is not appended again", async () => {
    // The subtle one. The load replays what is already on disk; the relay then
    // delivers what is not. Only the SECOND of those may reach the append
    // channel — but it MUST reach it, or the next session loses the catch-up.
    const io = persistentIO();
    const peer = new Y.Doc();

    const first = createSidecarLifecycle(createSidecarStore(io));
    const mine = new Y.Doc();
    first.attach(GUID, mine);
    card(mine, "mine-1", "one");
    card(mine, "mine-2", "two");
    relay(mine, peer);
    await settle();
    await first.detach(GUID);
    await first.destroy();
    await settle();

    card(peer, "peer-late", "arrived while away");

    const second = createSidecarLifecycle(createSidecarStore(io));
    const returning = new Y.Doc();
    second.attach(GUID, returning);
    const beforeLoad = countFrames(io);
    await second.load(GUID, returning);
    await settle();

    const framesAfterLoad = countFrames(io);
    expect(
      framesAfterLoad - beforeLoad,
      "the replayed history was appended back into itself",
    ).toBe(0);

    relay(peer, returning);
    await settle();
    expect(
      countFrames(io) - framesAfterLoad,
      "the catch-up delta was not appended, so the next session loses it",
    ).toBe(1);

    // Prove it: a third session sees the late card without any peer at all.
    await second.detach(GUID);
    await second.destroy();
    await settle();
    const third = new Y.Doc();
    await createSidecarStore(io).load(GUID, third);
    expect([...third.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "mine-1",
      "mine-2",
      "peer-late",
    ]);
  });

  it("a delete taken while away survives the return, and does not resurrect", async () => {
    // Tombstones are values, so they travel like any other write — but a cycle
    // that replayed the pre-delete history AFTER the catch-up would put the card
    // back, and the projection is the only place that shows.
    const io = persistentIO();
    const peer = new Y.Doc();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const mine = new Y.Doc();
    lifecycle.attach(GUID, mine);
    card(mine, "doomed", "will be deleted by the peer");
    card(mine, "safe", "stays");
    relay(mine, peer);
    await settle();
    await lifecycle.detach(GUID);
    await settle();

    peer.transact(() => {
      peer.getMap<unknown>(DELETED_MAP_NAME).set("doomed", { t: 7, by: "peer", on: true });
    });

    const returning = new Y.Doc();
    const second = createSidecarLifecycle(createSidecarStore(io));
    second.attach(GUID, returning);
    await second.load(GUID, returning);
    relay(peer, returning);
    await settle();

    expect(JSON.parse(projection(returning)).nodes.map((n: { id: string }) => n.id)).toEqual([
      "safe",
    ]);
    expect(projection(returning)).toBe(projection(peer));

    await second.destroy();
    await lifecycle.destroy();
  });
});

function countFrames(io: ReturnType<typeof persistentIO>): number {
  let total = 0;
  for (const [path, bytes] of io.files) {
    if (!path.endsWith(".yhistory")) continue;
    let at = 0;
    while (at < bytes.length) {
      const len =
        ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
      at += 4 + len;
      total += 1;
    }
  }
  return total;
}
