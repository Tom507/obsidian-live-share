// WP25 / AC2 blind1 — "exactly once", measured against an INDEPENDENT count of
// the doc's own update events rather than against an expected number.
//
// Different angle from the visible test, which counts frames and compares them
// to a literal. Here the test installs its OWN `doc.on("update", …)` listener
// and builds the multiset of payloads Yjs emitted; the sidecar's history must be
// exactly that multiset. No literal appears anywhere, so the oracle cannot drift
// as the fixture changes, and BOTH failure directions are read off one
// comparison:
//
//   ├── a payload in the test's multiset and not in the history → LOST
//   └── a payload in the history more times than in the test's  → DUPLICATED
//
// The fixture is a THREE-peer interleave, because two peers only ever produce
// one interleaving class and this AC is about a channel that sees every one of
// them.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_LOAD_ORIGIN,
  type SidecarIO,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import { DELETED_MAP_NAME } from "../../../../../plugin/src/files/canvas-sync";

const GUID = "5d90b1c7e2f34a68b0d7ac41e9538f26";

function memoryIO(): SidecarIO & { files: Map<string, Uint8Array> } {
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

function frames(bytes: Uint8Array | undefined): Uint8Array[] {
  if (!bytes) return [];
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) throw new Error("torn header");
    const n =
      ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
    if (at + 4 + n > bytes.length) throw new Error("torn payload");
    out.push(bytes.slice(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}

const key = (b: Uint8Array): string => [...b].join(",");

function multiset(items: Uint8Array[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return out;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

/** Push a delta in from a distinct peer replica, so the receive is non-local. */
function fromPeer(target: Y.Doc, peer: Y.Doc, mutate: (d: Y.Doc) => void): void {
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(target));
  mutate(peer);
  Y.applyUpdate(target, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(target)));
}

function card(doc: Y.Doc, id: string, text: string): void {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set(id, record);
    record.set("type", "text");
    record.set("text", text);
  });
}

describe("WP25 AC2 blind1 — the history is exactly the doc's own update stream", () => {
  it("three peers, eight updates: the history multiset equals the emitted multiset", async () => {
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    const peerB = new Y.Doc();
    const peerC = new Y.Doc();

    // The independent counter. Installed BEFORE attach on purpose: if the
    // lifecycle's own handler is installed first and this one second, both see
    // the same events, so the comparison is still apples to apples.
    const emitted: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === SIDECAR_LOAD_ORIGIN) return;
      emitted.push(Uint8Array.from(update));
    });

    lifecycle.attach(GUID, doc);

    card(doc, "a-1", "local one");
    fromPeer(doc, peerB, (d) => card(d, "b-1", "peer b one"));
    card(doc, "a-2", "local two");
    fromPeer(doc, peerC, (d) => card(d, "c-1", "peer c one"));
    fromPeer(doc, peerB, (d) => {
      d.getMap<Y.Map<unknown>>("nodes").get("b-1")?.set("text", "peer b edited");
    });
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>("nodes").get("a-1")?.set("text", "local one edited");
    });
    fromPeer(doc, peerC, (d) => card(d, "c-2", "peer c two"));
    doc.transact(() => {
      doc.getMap<unknown>(DELETED_MAP_NAME).set("a-2", { t: 1, by: "local", on: true });
    });
    await settle();

    const onDisk = frames(io.files.get(sidecarHistoryPath(GUID)));
    expect(emitted.length, "the fixture emitted no updates").toBeGreaterThanOrEqual(8);
    expect(
      multiset(onDisk),
      "the history is not exactly the stream of updates the doc emitted",
    ).toEqual(multiset(emitted));

    await lifecycle.destroy();
    peerB.destroy();
    peerC.destroy();
  });

  it("a payload never appears in the history more times than the doc emitted it", async () => {
    // The duplication direction, isolated. Yjs applies are idempotent, so a doc
    // rebuilt from a doubled history is IDENTICAL — only the channel can see it.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    const emitted: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== SIDECAR_LOAD_ORIGIN) emitted.push(Uint8Array.from(u));
    });
    lifecycle.attach(GUID, doc);

    for (let i = 0; i < 6; i++) card(doc, `n-${i}`, `card ${i}`);
    await settle();

    const counts = multiset(frames(io.files.get(sidecarHistoryPath(GUID))));
    const expected = multiset(emitted);
    for (const [payload, n] of counts) {
      expect(n, `a payload was appended ${n} times`).toBe(expected.get(payload));
    }

    // And rebuilding from the history reaches the same doc, so "no duplicates"
    // was not bought by dropping something.
    const rebuilt = new Y.Doc();
    for (const frame of frames(io.files.get(sidecarHistoryPath(GUID)))) {
      Y.applyUpdate(rebuilt, frame);
    }
    expect([...rebuilt.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(
      [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
    );

    await lifecycle.destroy();
  });

  it("replaying a sidecar into a fresh replica appends nothing", async () => {
    // The load's own apply is an update like any other. Left unexcluded, every
    // session doubles the history while the reconstructed doc stays perfect.
    const io = memoryIO();
    const store = createSidecarStore(io);
    const seedDoc = new Y.Doc();
    card(seedDoc, "s-1", "seeded");
    card(seedDoc, "s-2", "seeded too");
    await store.checkpoint(GUID, seedDoc);
    seedDoc.destroy();

    const lifecycle = createSidecarLifecycle(store);
    const fresh = new Y.Doc();
    lifecycle.attach(GUID, fresh);
    await lifecycle.load(GUID, fresh);
    await settle();

    expect(frames(io.files.get(sidecarHistoryPath(GUID))).length).toBe(0);
    expect([...fresh.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(["s-1", "s-2"]);

    // Doing it a second time is still zero: idempotent load, idempotent channel.
    await lifecycle.load(GUID, fresh);
    await settle();
    expect(frames(io.files.get(sidecarHistoryPath(GUID))).length).toBe(0);

    await lifecycle.destroy();
  });

  it("an update authored while the doc is attached to TWO guids is not cross-filed", async () => {
    // A single shared handler writes one board's updates into another board's
    // history. Both files still load; both boards silently acquire each other's
    // cards, and only a per-guid comparison can see it.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const first = new Y.Doc();
    const second = new Y.Doc();
    lifecycle.attach(GUID, first);
    lifecycle.attach("aa11bb22cc33dd44ee55ff6677889900", second);

    card(first, "only-first", "one");
    card(second, "only-second-a", "two");
    card(second, "only-second-b", "three");
    await settle();

    const firstDoc = new Y.Doc();
    for (const f of frames(io.files.get(sidecarHistoryPath(GUID)))) Y.applyUpdate(firstDoc, f);
    const secondDoc = new Y.Doc();
    for (const f of frames(
      io.files.get(sidecarHistoryPath("aa11bb22cc33dd44ee55ff6677889900")),
    )) {
      Y.applyUpdate(secondDoc, f);
    }

    expect([...firstDoc.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual(["only-first"]);
    expect([...secondDoc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual([
      "only-second-a",
      "only-second-b",
    ]);

    await lifecycle.destroy();
  });
});
