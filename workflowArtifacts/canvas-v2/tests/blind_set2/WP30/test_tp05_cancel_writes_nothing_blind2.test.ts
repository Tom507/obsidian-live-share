// WP30 / AC3 ("no write of any kind") blind2 — attacked ACROSS TIME, while the
// dialog is open, rather than after the run has finished.
//
// A confirmation is not instantaneous. Between the moment the dialog opens and
// the moment the user answers there are arbitrarily many event-loop turns, and
// the whole of AC3 lives in that window: nothing may be written during it, and
// nothing may be written after it if the answer was no. An end-of-run oracle
// sees neither — it observes one number at one instant and cannot tell an
// implementation that wrote eagerly and would have rolled back from one that
// never wrote at all.
//
// So the confirmation here is a DEFERRED promise held open across ten
// event-loop turns, and the write channels are sampled on every one of them.
// The sample series must be all zeroes for the whole window, in both the cancel
// case and the confirm case — the difference between them may only appear after
// the answer.
//
// The second scenario is CONCURRENCY: two imports of the same board with both
// dialogs open at once, one cancelled and one confirmed. The cancelled one must
// contribute nothing, and the confirmed one must still land — a shared
// "in-flight" flag or a module-level staging doc would make the two interfere,
// and that interference is invisible to any sequential test.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  readEpoch,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import {
  EPOCH_KEY,
  GUID_KEY,
  META_MAP_NAME,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
import {
  IMPORT_STATUS,
  type ImportFromFileEnv,
  runImportFromFile,
} from "../../../../../plugin/src/files/canvas-import";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

const PATH = "vault/deck.canvas";
const TODAY = "2026-08-02";

function node(id: string, x = 0): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text: id };
}

function ids(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return data.nodes.map((n) => String(n.id)).sort();
}

function replica(epoch: number, nodeIds: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, "a71f30d95c8e42b6801fde52c73a94b0");
    meta.set(PATH_KEY, PATH);
    meta.set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const [i, id] of nodeIds.entries()) {
      const record = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(node(id, i * 25))) record.set(key, value);
      nodes.set(id, record);
    }
  });
  return doc;
}

function deferredRig(fileIds: string[]) {
  const doc = replica(3, ["board-1", "board-2"]);
  const writes: string[] = [];
  const updates: unknown[] = [];
  doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));

  const gate: { open: ((value: boolean) => void)[] } = { open: [] };

  const env: ImportFromFileEnv = {
    availability: () => ({ owned: true, degraded: false }),
    liveDoc: () => doc,
    peers: () => [{ displayName: "Nia" }],
    readCanvasFile: async () =>
      JSON.stringify({ nodes: fileIds.map((id, i) => node(id, i * 10)), edges: [] }),
    confirm: () =>
      new Promise<boolean>((resolve) => {
        gate.open.push(resolve);
      }),
    adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) =>
      resolveEpochConflict({
        doc,
        winner,
        canvasPath,
        env: {
          serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
          writeConflictCopy: async (path: string) => {
            writes.push(path);
          },
          notify: () => {},
          today: () => TODAY,
        },
      }),
    notify: () => {},
  };
  return { env, doc, writes, updates, gate };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WP30 tp05 blind2 — nothing is written while the dialog is open", () => {
  it("samples zero on both channels for ten turns before a cancel", async () => {
    const rig = deferredRig(["z"]);
    const pending = runImportFromFile(PATH, rig.env);

    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      await tick();
      samples.push(rig.writes.length + rig.updates.length);
    }
    expect(samples).toEqual(Array(10).fill(0));
    expect(rig.gate.open).toHaveLength(1);

    rig.gate.open[0](false);
    const result = await pending;

    expect(result.status).toBe(IMPORT_STATUS.CANCELLED);
    expect(rig.writes).toEqual([]);
    expect(rig.updates).toEqual([]);
    expect(ids(rig.doc)).toEqual(["board-1", "board-2"]);
    expect(readEpoch(rig.doc)).toBe(3);
  });

  it("samples zero for ten turns before a CONFIRM too, then writes", async () => {
    const rig = deferredRig(["z"]);
    const pending = runImportFromFile(PATH, rig.env);

    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      await tick();
      samples.push(rig.writes.length + rig.updates.length);
    }
    expect(samples).toEqual(Array(10).fill(0));

    rig.gate.open[0](true);
    const result = await pending;

    expect(result.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(rig.writes).toHaveLength(1);
    expect(rig.updates).toHaveLength(1);
    expect(ids(rig.doc)).toEqual(["z"]);
    expect(readEpoch(rig.doc)).toBe(4);
  });

  it("two dialogs open at once: the cancelled one contributes nothing", async () => {
    const rig = deferredRig(["z"]);
    const first = runImportFromFile(PATH, rig.env);
    await tick();
    const second = runImportFromFile(PATH, rig.env);
    await tick();

    expect(rig.gate.open).toHaveLength(2);
    expect(rig.writes.length + rig.updates.length).toBe(0);

    rig.gate.open[0](false); // the first user cancels
    rig.gate.open[1](true); // the second confirms

    const [a, b] = await Promise.all([first, second]);

    expect(a.status).toBe(IMPORT_STATUS.CANCELLED);
    expect(b.status).toBe(IMPORT_STATUS.IMPORTED);
    expect(rig.writes).toHaveLength(1);
    expect(rig.updates).toHaveLength(1);
    expect(ids(rig.doc)).toEqual(["z"]);
  });

  it("two cancels open at once write nothing at all", async () => {
    const rig = deferredRig(["z"]);
    const first = runImportFromFile(PATH, rig.env);
    await tick();
    const second = runImportFromFile(PATH, rig.env);
    await tick();

    rig.gate.open[0](false);
    rig.gate.open[1](false);
    const results = await Promise.all([first, second]);

    for (const result of results) expect(result.status).toBe(IMPORT_STATUS.CANCELLED);
    expect(rig.writes).toEqual([]);
    expect(rig.updates).toEqual([]);
    expect(readEpoch(rig.doc)).toBe(3);
  });

  it("a dialog that is never answered writes nothing and stays pending", async () => {
    const rig = deferredRig(["z"]);
    void runImportFromFile(PATH, rig.env);

    for (let i = 0; i < 20; i++) await tick();

    expect(rig.writes).toEqual([]);
    expect(rig.updates).toEqual([]);
    expect(ids(rig.doc)).toEqual(["board-1", "board-2"]);

    // settle it so the promise does not dangle into the next test
    rig.gate.open[0](false);
  });
});
