// WP24 / AC1 blind2 — the ordering claim checked SEMANTICALLY at the moment of
// truncation, not by comparing indices in a log.
//
// Different angle: the fake's `truncate` is the assertion. When the store asks
// to truncate the history, the fake immediately reads whatever is in the
// checkpoint file and tries to rebuild the doc from it. If the checkpoint is
// absent, empty, or does not decode to the state that is about to be thrown
// away, the truncate itself fails. "Durably written" is thereby interpreted the
// way a crash would interpret it — as "a restarted process could use it" —
// rather than as "the promise settled".
//
// This catches an implementation that writes the checkpoint of the WRONG doc
// state (for instance one captured before a pending transaction) as well as
// every ordering violation, neither of which the end state shows.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createSidecarStore,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-order";

function makeIO(expectedKeys: () => string[]) {
  const disk = new Map<string, Uint8Array>();
  const failures: string[] = [];
  return {
    disk,
    failures,
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
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
      // The crash-consistency probe, executed AT the truncate.
      const checkpoint = disk.get(sidecarCheckpointPath(GUID));
      if (checkpoint === undefined || checkpoint.length === 0) {
        failures.push("truncate reached with no durable checkpoint on disk");
      } else {
        const probe = new Y.Doc();
        try {
          Y.applyUpdate(probe, checkpoint);
        } catch {
          failures.push("truncate reached with an unreadable checkpoint");
        }
        const keys = Object.keys(probe.getMap("nodes").toJSON()).sort();
        const wanted = expectedKeys().sort();
        if (JSON.stringify(keys) !== JSON.stringify(wanted)) {
          failures.push(`checkpoint held ${JSON.stringify(keys)}, expected ${JSON.stringify(wanted)}`);
        }
      }
      disk.set(p, new Uint8Array(0));
    },
    remove: async (p: string): Promise<void> => {
      disk.delete(p);
    },
  };
}

function seeded(): { doc: Y.Doc; updates: Uint8Array[]; keys: string[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(Uint8Array.from(u)));
  const keys = ["r1", "r2", "r3", "r4"];
  for (const key of keys) doc.getMap("nodes").set(key, { key, w: key.length });
  return { doc, updates, keys };
}

describe("WP24 AC1 blind2 — the checkpoint is usable at the instant of truncation", () => {
  it("a compaction never reaches truncate without a readable, complete checkpoint", async () => {
    const { doc, updates, keys } = seeded();
    const io = makeIO(() => keys);
    const store = createSidecarStore(io);
    for (const update of updates) await store.append(GUID, update);

    await store.checkpoint(GUID, doc);

    expect(io.failures).toEqual([]);
    expect(io.disk.get(sidecarHistoryPath(GUID))).toEqual(new Uint8Array(0));
  });

  it("the probe would have spoken up — it fails loudly against an empty checkpoint", async () => {
    // Falsification of the probe itself: with no checkpoint written, the same
    // code path records a failure. Without this, an always-silent probe would
    // make the test above unable to fail.
    const io = makeIO(() => ["r1"]);
    await io.truncate(sidecarHistoryPath(GUID));
    expect(io.failures).toEqual(["truncate reached with no durable checkpoint on disk"]);
  });

  it("a compaction that follows further edits checkpoints the LATEST state", async () => {
    const { doc, updates } = seeded();
    doc.getMap("nodes").set("r5", { key: "r5", w: 2 });
    const keys = ["r1", "r2", "r3", "r4", "r5"];
    const io = makeIO(() => keys);
    const store = createSidecarStore(io);
    for (const update of updates) await store.append(GUID, update);

    await store.checkpoint(GUID, doc);

    expect(io.failures).toEqual([]);
  });

  it("after the compaction the sidecar still rebuilds the doc exactly", async () => {
    const { doc, updates, keys } = seeded();
    const io = makeIO(() => keys);
    const store = createSidecarStore(io);
    for (const update of updates) await store.append(GUID, update);
    await store.checkpoint(GUID, doc);

    const revived = new Y.Doc();
    await store.load(GUID, revived);

    expect(Object.keys(revived.getMap("nodes").toJSON()).sort()).toEqual([...keys].sort());
    expect(Y.encodeStateVector(revived)).toEqual(Y.encodeStateVector(doc));
    expect(io.failures).toEqual([]);
  });
});
