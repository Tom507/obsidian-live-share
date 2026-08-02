// WP25 / AC2 (first half) — "Every local and remote update is appended to the
// history exactly once."
//
// "EXACTLY ONCE" HAS TWO FAILURE DIRECTIONS AND THEY NEED SEPARATE ASSERTIONS:
//
//   ├── LOST — an update never reaches the history. Visible in the doc a reload
//   │          reconstructs, so a state oracle can see it.
//   └── DUPLICATED — an update reaches the history twice. INVISIBLE in the doc:
//              Yjs applies are idempotent, so the reconstructed document is
//              byte-for-byte the same. A test that only reloads and compares
//              state CANNOT FAIL on this direction. The oracle must therefore be
//              the APPEND CHANNEL itself — the frame count in the history file —
//              which is what the IO double records.
//
// A third, easily-missed duplication source has its own test below: the SIDECAR
// LOAD's own `Y.applyUpdate` is a doc update like any other. An update handler
// installed before the load, or one that does not exclude
// `SIDECAR_LOAD_ORIGIN`, appends the whole reconstructed state straight back
// into the history it just read — the history doubles on every session, the doc
// still reconstructs perfectly, and no state oracle anywhere can see it.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by the `doc.on("update", …)` handler
// WP25 installs in `SidecarLifecycle.attach` — by removing it (lost), by
// installing it twice / not detaching on `detach` (duplicated), by adding an
// `origin`/`tr.local` filter (lost remote or lost local), or by dropping the
// `SIDECAR_LOAD_ORIGIN` exclusion (duplicated).

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_LOAD_ORIGIN,
  createSidecarStore,
  sidecarHistoryPath,
} from "../../../files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../files/canvas-sidecar-lifecycle";
import {
  FIXED_GUID,
  NODE_A,
  NODE_B,
  applyRemoteDelta,
  createSidecarIO,
  createTrace,
  readFrames,
  seedRecord,
} from "./harness";

function historyFrames(io: ReturnType<typeof createSidecarIO>): Uint8Array[] {
  const bytes = io.files.get(sidecarHistoryPath(FIXED_GUID));
  return bytes === undefined ? [] : readFrames(bytes);
}

/** Let the store's per-guid queue drain. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

describe("WP25 AC2 — every local and remote update is appended exactly once", () => {
  it("a LOCAL update is appended, and appended exactly one time", async () => {
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);

    seedRecord(doc, "nodes", NODE_A);
    await settle();

    const frames = historyFrames(io);
    expect(frames.length, "the local update was not appended exactly once").toBe(1);

    // The bytes are the update itself, not a re-encode: a fresh replica fed only
    // this frame reaches the same observable content.
    const replica = new Y.Doc();
    Y.applyUpdate(replica, frames[0]);
    expect([...replica.getMap<Y.Map<unknown>>("nodes").keys()]).toEqual([NODE_A.id]);

    await lifecycle.destroy();
  });

  it("a REMOTE update is appended too — the channel is not local-only", async () => {
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);

    applyRemoteDelta(doc, (peer) => {
      seedRecord(peer, "nodes", NODE_B);
    });
    await settle();

    expect(historyFrames(io).length, "a remote update was not appended").toBe(1);

    await lifecycle.destroy();
  });

  it("five interleaved local and remote updates produce exactly five frames", async () => {
    // The counting form. A handler installed twice, or a second handler on
    // `afterTransaction`, doubles this to ten while the doc a reload
    // reconstructs stays IDENTICAL — which is why the count is the oracle.
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);

    seedRecord(doc, "nodes", NODE_A);
    applyRemoteDelta(doc, (peer) => {
      seedRecord(peer, "nodes", NODE_B);
    });
    seedRecord(doc, "edges", { id: "e-1", fromNode: NODE_A.id, toNode: NODE_B.id });
    applyRemoteDelta(doc, (peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").get(NODE_B.id)?.set("text", "beta-2");
    });
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>("nodes").get(NODE_A.id)?.set("text", "alpha-2");
    });
    await settle();

    expect(
      historyFrames(io).length,
      "the number of appended frames does not match the number of updates",
    ).toBe(5);
    // And no frame is a byte-for-byte repeat of another — the shape a
    // double-installed handler produces.
    const seen = historyFrames(io).map((f) => [...f].join(","));
    expect(new Set(seen).size, "an identical update was appended twice").toBe(seen.length);

    await lifecycle.destroy();
  });

  it("the SIDECAR LOAD's own apply is NOT appended back into the history", async () => {
    // The invisible duplication. Prime a sidecar, load it, and assert the
    // history did not grow: the load applies a real update to the doc, so an
    // unexcluded handler re-appends the entire reconstructed state.
    const io = createSidecarIO(createTrace());
    const store = createSidecarStore(io);

    const source = new Y.Doc();
    seedRecord(source, "nodes", NODE_A);
    seedRecord(source, "nodes", NODE_B);
    await store.checkpoint(FIXED_GUID, source);
    source.destroy();

    const lifecycle = createSidecarLifecycle(store);
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    const result = await lifecycle.load(FIXED_GUID, doc);
    await settle();

    expect(result.degradation).toBe("none");
    expect([...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort()).toEqual(
      [NODE_A.id, NODE_B.id].sort(),
    );
    expect(
      historyFrames(io).length,
      "the load's own update was appended back into the history",
    ).toBe(0);

    await lifecycle.destroy();
  });

  it("the exclusion is the LOAD ORIGIN, not a blanket 'ignore the first update'", async () => {
    // Discrimination: an implementation that swallows exactly one update after
    // attach would also pass the test above, and would silently lose the user's
    // first edit of every session. So: load, THEN edit, and require the edit.
    const io = createSidecarIO(createTrace());
    const store = createSidecarStore(io);

    const source = new Y.Doc();
    seedRecord(source, "nodes", NODE_A);
    await store.checkpoint(FIXED_GUID, source);
    source.destroy();

    const lifecycle = createSidecarLifecycle(store);
    const doc = new Y.Doc();
    lifecycle.attach(FIXED_GUID, doc);
    await lifecycle.load(FIXED_GUID, doc);
    await settle();
    expect(historyFrames(io).length).toBe(0);

    seedRecord(doc, "nodes", NODE_B);
    await settle();

    expect(
      historyFrames(io).length,
      "the first real edit after a load was swallowed with the load",
    ).toBe(1);

    // And the origin the exclusion keys on is WP24's exported symbol, not a
    // string of WP25's own invention.
    expect(typeof SIDECAR_LOAD_ORIGIN).toBe("symbol");
    const direct = new Y.Doc();
    lifecycle.attach("guid-direct", direct);
    Y.applyUpdate(direct, Y.encodeStateAsUpdate(doc), SIDECAR_LOAD_ORIGIN);
    await settle();
    expect(
      io.appends.filter((a) => a.path.includes("guid-direct")).length,
      "an update stamped SIDECAR_LOAD_ORIGIN was appended",
    ).toBe(0);

    await lifecycle.destroy();
  });

  it("two docs attached at once keep their histories separate", async () => {
    // A single shared handler, or a guid captured once and reused, cross-writes
    // one board's updates into the other board's history. Both files still load
    // without error, and both boards silently acquire each other's cards.
    const io = createSidecarIO(createTrace());
    const lifecycle = createSidecarLifecycle(createSidecarStore(io));
    const first = new Y.Doc();
    const second = new Y.Doc();
    lifecycle.attach(FIXED_GUID, first);
    lifecycle.attach("guid-second", second);

    seedRecord(first, "nodes", NODE_A);
    seedRecord(second, "nodes", NODE_B);
    seedRecord(second, "nodes", { ...NODE_A, id: "n-second-only" });
    await settle();

    expect(historyFrames(io).length).toBe(1);
    const other = io.files.get(sidecarHistoryPath("guid-second"));
    expect(other, "the second doc got no history of its own").toBeDefined();
    expect(readFrames(other as Uint8Array).length).toBe(2);

    await lifecycle.destroy();
  });
});
