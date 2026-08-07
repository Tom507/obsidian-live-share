// WP30 / AC4 (degradation) blind2 — attacked at the ORCHESTRATOR, and paired
// with the consequence that makes degradation a bar rather than a warning.
//
// The consequence is this: a degraded client is one whose view of the board is
// known to be incomplete, and the confirmation dialog QUOTES THAT VIEW back to
// the user ("N records will be replaced"). If the import ran while degraded, the
// user would authorise a destruction on the strength of a number that is wrong,
// and the wholesale replacement would then remove records they were never shown.
// So the assertion that matters is not only "returned false" — it is that the
// DIALOG IS NEVER SHOWN on a degraded path. A user who never saw the number
// cannot have been misled by it.
//
// Degradation is also varied independently of ownership within a single rig, so
// an implementation whose two conditions are fused (one flag standing in for
// both, an `||` where an `&&` belongs) disagrees on the owned-and-degraded row
// specifically and the failure names it.
//
// The liveness pairing is the same discipline as tp02's: every refusal is
// followed by the identical rig with degradation cleared, which must import.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { resolveEpochConflict } from "../../../../../plugin/src/canvas/canvas-epoch";
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
import { IMPORT_UNAVAILABLE } from "../../../../../plugin/src/canvas/canvas-import-command";
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
    meta.set(GUID_KEY, "6ba03fd18e29457c8107ade2f5934c1b");
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

function rig() {
  const doc = replica(4, ["board-1", "board-2"]);
  const dialogs: string[] = [];
  const writes: string[] = [];
  const updates: unknown[] = [];
  doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));
  const state: { owned: unknown; degraded: unknown } = { owned: true, degraded: true };

  const env: ImportFromFileEnv = {
    availability: () => ({ owned: state.owned, degraded: state.degraded }) as never,
    liveDoc: () => doc,
    peers: () => [{ displayName: "Nia" }],
    readCanvasFile: async () => JSON.stringify({ nodes: [node("z")], edges: [] }),
    confirm: async (_summary, message: string) => {
      dialogs.push(message);
      return true;
    },
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
  return { env, doc, dialogs, writes, updates, state };
}

describe("WP30 tp03 blind2 — degradation bars the import, and the dialog with it", () => {
  it("never shows the confirmation on a degraded path", async () => {
    const r = rig();
    r.state.degraded = true;

    const result = await runImportFromFile(PATH, r.env);

    expect(result.status).toBe(IMPORT_STATUS.UNAVAILABLE);
    expect(result.unavailableReason).toBe(IMPORT_UNAVAILABLE.DEGRADED);
    expect(r.dialogs).toEqual([]);
    expect(r.writes).toEqual([]);
    expect(r.updates).toEqual([]);
  });

  it("LIVENESS: clearing the degradation in the same rig shows the dialog and imports", async () => {
    const r = rig();

    r.state.degraded = true;
    expect((await runImportFromFile(PATH, r.env)).status).toBe(IMPORT_STATUS.UNAVAILABLE);
    expect(r.dialogs).toEqual([]);

    r.state.degraded = false;
    expect((await runImportFromFile(PATH, r.env)).status).toBe(IMPORT_STATUS.IMPORTED);
    expect(r.dialogs).toHaveLength(1);
    expect(r.dialogs[0]).toContain(PATH);
    expect(ids(r.doc)).toEqual(["z"]);
  });

  it("the two conditions are not fused: owned-and-degraded is its own row", async () => {
    const rows = [
      { owned: true, degraded: false, expected: IMPORT_STATUS.IMPORTED },
      { owned: true, degraded: true, expected: IMPORT_STATUS.UNAVAILABLE },
      { owned: false, degraded: false, expected: IMPORT_STATUS.UNAVAILABLE },
      { owned: false, degraded: true, expected: IMPORT_STATUS.UNAVAILABLE },
    ];
    for (const row of rows) {
      const r = rig();
      r.state.owned = row.owned;
      r.state.degraded = row.degraded;
      const result = await runImportFromFile(PATH, r.env);
      expect(result.status, JSON.stringify(row)).toBe(row.expected);
    }
  });

  it("blames degradation only when ownership is established", async () => {
    const owned = rig();
    owned.state.owned = true;
    owned.state.degraded = true;
    expect((await runImportFromFile(PATH, owned.env)).unavailableReason).toBe(
      IMPORT_UNAVAILABLE.DEGRADED,
    );

    const unowned = rig();
    unowned.state.owned = false;
    unowned.state.degraded = true;
    expect((await runImportFromFile(PATH, unowned.env)).unavailableReason).toBe(
      IMPORT_UNAVAILABLE.UNOWNED,
    );
  });

  it("an unanswered degradation probe bars the import just as a positive one does", async () => {
    for (const degraded of [undefined, null, "no", 0, {}]) {
      const r = rig();
      r.state.degraded = degraded;
      const result = await runImportFromFile(PATH, r.env);
      expect(result.status, String(degraded)).toBe(IMPORT_STATUS.UNAVAILABLE);
      expect(r.dialogs, String(degraded)).toEqual([]);
    }
  });
});
