// WP24 / AC1+AC2 blind1 — "full state, not a delta", attacked by DELETING the
// history file outright after the checkpoint instead of relying on the store's
// own truncate.
//
// Different angle: the visible test compacts once and reloads. Here the doc is
// built by THREE peers (so the checkpoint has to carry three client entries,
// not one) and compacted twice with edits in between, and after the final
// compaction the history file is removed from the fake disk entirely. If the
// checkpoint were a delta against anything, the surviving file could not
// rebuild a replica that never saw the earlier bytes.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind1-checkpoint";

function makeIO() {
  const disk = new Map<string, Uint8Array>();
  const cat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };
  return {
    disk,
    ensureDir: async (_d: string): Promise<void> => undefined,
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
      disk.set(p, cat(disk.get(p) ?? new Uint8Array(0), Uint8Array.from(d)));
    },
    truncate: async (p: string): Promise<void> => {
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      disk.delete(p);
    },
  };
}

/** Three peers, merged — the checkpoint must carry all three client clocks. */
function threePeerDoc(): { doc: Y.Doc; updates: Uint8Array[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));

  for (const [peerIndex, key] of [
    [0, "from-p1"],
    [1, "from-p2"],
    [2, "from-p3"],
  ] as const) {
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getMap("nodes").set(key, { peer: peerIndex, w: 100 + peerIndex });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
  }
  return { doc, updates };
}

describe("WP24 blind1 — the checkpoint alone rebuilds a three-peer state", () => {
  it("survives the history file being deleted, not merely truncated", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = threePeerDoc();
    for (const update of updates) await store.append(GUID, update);

    await store.checkpoint(GUID, doc);
    io.disk.delete(sidecarHistoryPath(GUID));

    const revived = new Y.Doc();
    const result = await store.load(GUID, revived);

    expect(result.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(result.checkpointApplied).toBe(true);
    expect(result.historyEntriesApplied).toBe(0);
    expect(revived.getMap("nodes").toJSON()).toEqual(doc.getMap("nodes").toJSON());
    expect(Y.encodeStateVector(revived)).toEqual(Y.encodeStateVector(doc));
  });

  it("the state vector really did span three clients — the fixture is not degenerate", () => {
    const { doc } = threePeerDoc();
    const sv = Y.decodeStateVector(Y.encodeStateVector(doc));
    expect(sv.size).toBeGreaterThanOrEqual(3);
  });

  it("two compactions with edits in between lose nothing", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = threePeerDoc();
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, doc);

    doc.getMap("nodes").set("between", { v: "kept" });
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, doc);

    doc.getMap("nodes").set("after", { v: "also kept" });
    for (const update of updates.splice(0)) await store.append(GUID, update);

    const revived = new Y.Doc();
    await store.load(GUID, revived);

    expect(Object.keys(revived.getMap("nodes").toJSON()).sort()).toEqual([
      "after",
      "between",
      "from-p1",
      "from-p2",
      "from-p3",
    ]);
    expect(Y.encodeStateVector(revived)).toEqual(Y.encodeStateVector(doc));
  });

  it("the checkpoint file grows to cover new content rather than staying frozen", async () => {
    const io = makeIO();
    const store = createSidecarStore(io);
    const { doc, updates } = threePeerDoc();
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, doc);
    const first = Uint8Array.from(io.disk.get(sidecarCheckpointPath(GUID)) as Uint8Array);

    doc.getMap("nodes").set("bulk", { text: "z".repeat(400) });
    for (const update of updates.splice(0)) await store.append(GUID, update);
    await store.checkpoint(GUID, doc);
    const second = io.disk.get(sidecarCheckpointPath(GUID)) as Uint8Array;

    expect(second.length).toBeGreaterThan(first.length + 300);
  });
});
