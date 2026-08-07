// WP42 / C42 AC2 (blind 1) — replay-vs-live equality under CONCURRENCY:
// three peers edit the same registers offline, their updates are merged, and the
// newcomer receives that merged history as a replay while a live client received
// the individual updates in a DIFFERENT order. Both must land on one state.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MUX_REPLAY_END,
  MUX_SYNC,
  createReplayGate,
  encodeReplayEndBody,
} from "../../sync/mux-protocol.js";
import type { GatedFrame } from "../../sync/mux-protocol.js";

/** Drive a batch of stored frames through the barrier into a target doc. */
function replayInto(target: Y.Doc, docId: string, blobs: Uint8Array[]): void {
  const gate = createReplayGate();
  gate.beginReplay(docId);
  for (const blob of blobs) {
    for (const out of gate.accept({ docId, msgType: MUX_SYNC, payload: blob })) {
      Y.applyUpdate(target, out.payload);
    }
  }
  for (const out of gate.accept({
    docId,
    msgType: MUX_REPLAY_END,
    payload: encodeReplayEndBody(blobs.length),
  })) {
    Y.applyUpdate(target, out.payload);
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = stable(src[k]);
    return out;
  }
  return value;
}

function docSnapshot(doc: Y.Doc): string {
  const mirror = new Y.Doc();
  Y.applyUpdate(mirror, Y.encodeStateAsUpdate(doc));
  return JSON.stringify(
    stable({
      nodes: mirror.getMap("nodes").toJSON(),
      content: mirror.getText("content").toString(),
    }),
  );
}

/**
 * Deterministic three-replica generator: each replica starts from the same seed
 * state, edits the SAME node's registers offline, and every update is captured.
 */
function threeWayConcurrentHistory(): { seed: Uint8Array[]; concurrent: Uint8Array[] } {
  const origin = new Y.Doc();
  const seed: Uint8Array[] = [];
  origin.on("update", (u: Uint8Array) => seed.push(u));
  origin.transact(() => {
    const node = new Y.Map<unknown>();
    node.set("pos", { x: 0, y: 0 });
    node.set("color", "grey");
    origin.getMap("nodes").set("shared", node);
    origin.getText("content").insert(0, "seed");
  });

  const seedState = Y.encodeStateAsUpdate(origin);
  const concurrent: Uint8Array[] = [];
  const edits: ((doc: Y.Doc) => void)[] = [
    (doc) => {
      (doc.getMap("nodes").get("shared") as Y.Map<unknown>).set("pos", { x: 100, y: 10 });
    },
    (doc) => {
      // One transaction, so each replica contributes exactly one update.
      doc.transact(() => {
        (doc.getMap("nodes").get("shared") as Y.Map<unknown>).set("color", "rot");
        doc.getText("content").insert(4, "-b");
      });
    },
    (doc) => {
      const extra = new Y.Map<unknown>();
      extra.set("ord", "a1");
      doc.getMap("nodes").set("third", extra);
    },
  ];

  for (const edit of edits) {
    const replica = new Y.Doc();
    Y.applyUpdate(replica, seedState);
    replica.on("update", (u: Uint8Array) => concurrent.push(u));
    edit(replica);
  }

  return { seed, concurrent };
}

describe("WP42 AC2 (blind1) — concurrent three-peer history", () => {
  it("gives the replayed newcomer the same state as a differently-ordered live client", () => {
    const { seed, concurrent } = threeWayConcurrentHistory();
    const all = [...seed, ...concurrent];

    // Live client: received the updates in arrival order.
    const liveClient = new Y.Doc();
    for (const u of all) Y.applyUpdate(liveClient, u);

    // Another live client: received the concurrent updates in reverse order.
    const liveClientReordered = new Y.Doc();
    for (const u of seed) Y.applyUpdate(liveClientReordered, u);
    for (const u of [...concurrent].reverse()) Y.applyUpdate(liveClientReordered, u);

    // Newcomer: gets one merged checkpoint from the relay blob store.
    const merged = new Y.Doc();
    for (const u of all) Y.applyUpdate(merged, u);
    const newcomer = new Y.Doc();
    replayInto(newcomer, "__canvas__:multi", [Y.encodeStateAsUpdate(merged)]);

    const oracle = docSnapshot(liveClient);
    expect(docSnapshot(liveClientReordered)).toBe(oracle);
    expect(docSnapshot(newcomer)).toBe(oracle);
  });

  it("keeps the equality when live traffic follows the replay barrier", () => {
    const { seed, concurrent } = threeWayConcurrentHistory();
    expect(concurrent.length).toBe(3); // one update per replica — fixture guard

    const reference = new Y.Doc();
    for (const u of [...seed, ...concurrent]) Y.applyUpdate(reference, u);

    const seededOnly = new Y.Doc();
    for (const u of seed) Y.applyUpdate(seededOnly, u);

    const docId = "__canvas__:multi";
    const newcomer = new Y.Doc();
    const gate = createReplayGate();
    gate.beginReplay(docId);

    const processed: GatedFrame[] = [];
    // Stored batch: the seed checkpoint plus one of the concurrent deltas.
    processed.push(
      ...gate.accept({
        docId,
        msgType: MUX_SYNC,
        payload: Y.encodeStateAsUpdate(seededOnly),
      }),
    );
    processed.push(...gate.accept({ docId, msgType: MUX_SYNC, payload: concurrent[1] }));
    expect(processed).toEqual([]); // barrier holds
    processed.push(
      ...gate.accept({ docId, msgType: MUX_REPLAY_END, payload: encodeReplayEndBody(2) }),
    );
    const afterBatch = processed.length;
    // Live traffic from the other two peers arrives after the barrier.
    processed.push(...gate.accept({ docId, msgType: MUX_SYNC, payload: concurrent[2] }));
    processed.push(...gate.accept({ docId, msgType: MUX_SYNC, payload: concurrent[0] }));

    for (const f of processed) Y.applyUpdate(newcomer, f.payload);

    expect(afterBatch).toBe(2);
    expect(processed.length).toBe(4);
    expect(gate.lastSeq(docId)).toBe(2);
    expect(docSnapshot(newcomer)).toBe(docSnapshot(reference));
  });
});
