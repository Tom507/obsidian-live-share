// WP25 / AC3 blind2 (GC half) — GC proven by DIFFERENCE against a deliberately
// GC-disabled twin, rather than by a marker search.
//
// The visible test searches the sidecar bytes for a marker string; blind1 does
// the same with nested `Y.Text` over three generations. This one builds the same
// board twice — once on a `gc: true` doc and once on `gc: false` — feeds both
// the identical op sequence, and compares the compacted checkpoints:
//
//   ├── the GC-disabled twin's encoding must be STRICTLY LARGER, because it
//   │   retains the deleted content, and
//   └── both must reconstruct the IDENTICAL observable projection, because GC
//       removes only what nobody can see.
//
// That pair is what makes the size comparison meaningful. A size assertion alone
// would also be satisfied by an implementation that dropped live content; the
// projection assertion alone would be satisfied by one that never GC'd at all.
//
// This angle also catches something the marker search cannot: an implementation
// that copies records into a fresh `Y.Doc` "to compact them". That produces a
// small encoding and an identical projection — and a doc with a brand-new
// clientID and no causal relationship to any peer, which the state-vector
// assertion at the end rejects.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  type SidecarIO,
  createSidecarStore,
  sidecarCheckpointPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { createSidecarLifecycle } from "../../../../../plugin/src/files/canvas-sidecar-lifecycle";
import {
  DELETED_MAP_NAME,
  serializeCanvas,
} from "../../../../../plugin/src/files/canvas-sync";

const GUID = "b83c50f4d7e94a12ae6f0139c74b25a8";
const HORIZON = 5;
const FILLER = "x".repeat(400);

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

/** The identical op sequence, applied to whichever doc is handed in. */
function buildBoard(doc: Y.Doc): void {
  doc.transact(() => {
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const id of ["n-doomed-1", "n-doomed-2", "n-live"]) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      for (const [k, v] of Object.entries({
        id,
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        text: `${id} ${FILLER}`,
      })) {
        record.set(k, v);
      }
    }
  });
  doc.transact(() => {
    const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
    deleted.set("n-doomed-1", { t: 1, by: "peer-a", on: true });
    deleted.set("n-doomed-2", { t: 2, by: "peer-a", on: true });
    deleted.set("n-live", { t: 90, by: "peer-b", on: false });
  });
}

async function compactOn(gc: boolean): Promise<{
  doc: Y.Doc;
  checkpoint: Uint8Array;
  removed: readonly string[];
  clientIdBefore: number;
}> {
  const io = memoryIO();
  const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
  const doc = new Y.Doc({ gc });
  const clientIdBefore = doc.clientID;
  lifecycle.attach(GUID, doc);
  buildBoard(doc);
  await settle();
  const result = await lifecycle.compact(GUID, doc);
  await settle();
  const checkpoint = io.files.get(sidecarCheckpointPath(GUID)) as Uint8Array;
  await lifecycle.destroy();
  return { doc, checkpoint, removed: result.removedTombstoneIds, clientIdBefore };
}

describe("WP25 AC3 blind2 — GC is what makes the compacted checkpoint smaller", () => {
  it("both twins collect the same tombstones (premise)", async () => {
    const on = await compactOn(true);
    const off = await compactOn(false);
    expect([...on.removed].sort()).toEqual(["n-doomed-1", "n-doomed-2"]);
    expect([...off.removed].sort()).toEqual(["n-doomed-1", "n-doomed-2"]);
    on.doc.destroy();
    off.doc.destroy();
  });

  it("the GC-disabled twin's checkpoint is strictly larger", async () => {
    const on = await compactOn(true);
    const off = await compactOn(false);

    expect(on.checkpoint.length, "no checkpoint was written").toBeGreaterThan(0);
    expect(
      off.checkpoint.length,
      "the two twins produced the same size — the compaction is not using Yjs' GC",
    ).toBeGreaterThan(on.checkpoint.length);
    // The removed records carried 400 bytes of filler each; retaining them is a
    // difference far larger than encoding noise.
    expect(off.checkpoint.length - on.checkpoint.length).toBeGreaterThan(400);

    on.doc.destroy();
    off.doc.destroy();
  });

  it("and yet both project identically — GC removed nothing anyone can see", async () => {
    const on = await compactOn(true);
    const off = await compactOn(false);

    expect(projection(on.doc)).toBe(projection(off.doc));
    expect(JSON.parse(projection(on.doc)).nodes.map((n: { id: string }) => n.id)).toEqual([
      "n-live",
    ]);

    on.doc.destroy();
    off.doc.destroy();
  });

  it("the compaction does not swap the doc for a fresh one", async () => {
    // The implementation that would pass every size and projection assertion
    // above and destroy the board: rebuild the state into a new `Y.Doc`. The
    // clientID changes and the causal chain to every peer is severed — the doc
    // converges beautifully, with nobody.
    const { doc, clientIdBefore } = await compactOn(true);
    expect(doc.clientID, "the compaction replaced the Y.Doc").toBe(clientIdBefore);
    doc.destroy();
  });

  it("this replica's own clock never moves BACKWARDS across a compaction", async () => {
    // The compaction writes (it removes records), so the clock must ADVANCE —
    // asserting "unchanged" would be unsatisfiable by any correct
    // implementation. What must hold is that the history was EXTENDED, never
    // replaced: every client entry present before is still present, at a clock
    // no lower than before.
    const io = memoryIO();
    const lifecycle = createSidecarLifecycle(createSidecarStore(io), { horizonTicks: HORIZON });
    const doc = new Y.Doc();
    lifecycle.attach(GUID, doc);
    buildBoard(doc);
    await settle();

    const before = Y.decodeStateVector(Y.encodeStateVector(doc));
    await lifecycle.compact(GUID, doc);
    await settle();
    const after = Y.decodeStateVector(Y.encodeStateVector(doc));

    for (const [client, clock] of before) {
      expect(after.has(client), "a client entry vanished from the state vector").toBe(true);
      expect(after.get(client) as number).toBeGreaterThanOrEqual(clock);
    }

    await lifecycle.destroy();
  });
});
