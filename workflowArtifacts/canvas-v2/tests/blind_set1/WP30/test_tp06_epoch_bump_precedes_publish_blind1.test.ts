// WP30 / AC2 (importer side) blind1 — the epoch attacked as a STRICT ORDER
// PROPERTY over a corpus of live values, including corrupt cells, rather than as
// a handful of `n -> n+1` examples.
//
// The property, stated once and checked everywhere: for every live epoch a board
// can be carrying — absent, zero, ordinary, corrupt, fractional, negative, a
// string, an object — the epoch the import publishes must STRICTLY BEAT it under
// WP28's own comparison. Not "be one larger", which bakes in an arithmetic an
// implementation is free to change; strictly beat, which is the only thing the
// peers actually consult.
//
// The second attack is REPEATED IMPORT. One import proves nothing about
// monotonicity — an implementation that always publishes epoch 1 satisfies every
// single-shot assertion against an unstamped board and freezes the board forever
// afterwards. Importing four times in a row must produce four strictly
// increasing epochs, and every one of them must beat its own predecessor.
//
// The third attack is COMPLETENESS AT THE OFFER. The publish is offered exactly
// once, and at that instant the winner must already be finished: the file's
// records AND the new epoch, with the live board still untouched. That is
// checked by capturing the winner's own state inside `adoptEpochWinner` before
// delegating, so an implementation that bumps after publishing, or that seeds the
// live doc first, is caught by the snapshot rather than by the end state.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  compareEpoch,
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
  type ImportFromFileEnv,
  runImportFromFile,
} from "../../../../../plugin/src/files/canvas-import";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

const PATH = "atlas/roadmap.canvas";
const TODAY = "2026-08-02";

function node(id: string, x = 0): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text: id };
}

function fileText(nodeIds: string[]): string {
  return JSON.stringify({ nodes: nodeIds.map((id, i) => node(id, i * 10)), edges: [] });
}

function ids(doc: Y.Doc): string[] {
  const data = buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>(DELETED_MAP_NAME),
  );
  return data.nodes.map((n) => String(n.id)).sort();
}

function replica(epoch: unknown, nodeIds: string[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap<unknown>(META_MAP_NAME);
    meta.set(GUID_KEY, "8f31b0c7a24e4d5b91762ce03ad8f419");
    meta.set(PATH_KEY, PATH);
    if (epoch !== undefined) meta.set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const [i, id] of nodeIds.entries()) {
      const record = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(node(id, i * 25))) record.set(key, value);
      nodes.set(id, record);
    }
  });
  return doc;
}

interface Offer {
  winnerIds: string[];
  winnerEpoch: number;
  liveIdsThen: string[];
  liveEpochThen: number;
}

function rig(epoch: unknown, live: string[], text: string) {
  const doc = replica(epoch, live);
  const offers: Offer[] = [];
  const updates: unknown[] = [];
  doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));

  const env: ImportFromFileEnv = {
    availability: () => ({ owned: true, degraded: false }),
    liveDoc: () => doc,
    peers: () => [],
    readCanvasFile: async () => text,
    confirm: async () => true,
    adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) => {
      offers.push({
        winnerIds: ids(winner),
        winnerEpoch: readEpoch(winner),
        liveIdsThen: ids(doc),
        liveEpochThen: readEpoch(doc),
      });
      return resolveEpochConflict({
        doc,
        winner,
        canvasPath,
        env: {
          serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
          writeConflictCopy: async () => {},
          notify: () => {},
          today: () => TODAY,
        },
      });
    },
    notify: () => {},
  };
  return { env, doc, offers, updates };
}

/** Everything a `meta.epoch` cell can hold in the field. */
const LIVE_EPOCHS: unknown[] = [undefined, 0, 1, 2, 41, 9007199254740990, -1, 2.5, "9", null, {}, []];

describe("WP30 tp06 blind1 — the published epoch strictly beats whatever was there", () => {
  it.each(LIVE_EPOCHS.map((epoch) => ({ epoch, label: String(epoch) })))(
    "beats a live epoch of $label",
    async ({ epoch }) => {
      const { env, doc, offers } = rig(epoch, ["a"], fileText(["z"]));
      const before = readEpoch(doc);

      const result = await runImportFromFile(PATH, env);

      expect(typeof result.epoch).toBe("number");
      expect(compareEpoch(before, result.epoch as number)).toBe("remote-wins");
      expect(offers).toHaveLength(1);
      expect(compareEpoch(before, offers[0].winnerEpoch)).toBe("remote-wins");
    },
  );

  it("four imports in a row produce four strictly increasing epochs", async () => {
    const doc = replica(0, ["a"]);
    const seen: number[] = [];
    const env: ImportFromFileEnv = {
      availability: () => ({ owned: true, degraded: false }),
      liveDoc: () => doc,
      peers: () => [],
      readCanvasFile: async () => fileText(["z"]),
      confirm: async () => true,
      adoptEpochWinner: async (canvasPath: string, winner: Y.Doc) =>
        resolveEpochConflict({
          doc,
          winner,
          canvasPath,
          env: {
            serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
            writeConflictCopy: async () => {},
            notify: () => {},
            today: () => TODAY,
          },
        }),
      notify: () => {},
    };

    for (let i = 0; i < 4; i++) {
      const result = await runImportFromFile(PATH, env);
      seen.push(result.epoch as number);
      expect(readEpoch(doc)).toBe(result.epoch);
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(4);
    for (let i = 1; i < seen.length; i++) {
      expect(compareEpoch(seen[i - 1], seen[i])).toBe("remote-wins");
    }
  });

  it("the winner is COMPLETE at the moment it is offered, and the board is not", async () => {
    const { env, offers } = rig(12, ["a", "b"], fileText(["z1", "z2", "z3"]));

    await runImportFromFile(PATH, env);

    expect(offers).toHaveLength(1);
    expect(offers[0].winnerIds).toEqual(["z1", "z2", "z3"]);
    expect(offers[0].winnerEpoch).toBe(13);
    expect(offers[0].liveIdsThen).toEqual(["a", "b"]);
    expect(offers[0].liveEpochThen).toBe(12);
  });

  it("the board is published in one transaction, never in two", async () => {
    const { env, updates } = rig(12, ["a", "b"], fileText(["z"]));

    await runImportFromFile(PATH, env);

    expect(updates).toHaveLength(1);
  });

  it("the epoch is the same number in the result, on the winner, and on the board", async () => {
    const { env, doc, offers } = rig(30, ["a"], fileText(["z"]));

    const result = await runImportFromFile(PATH, env);

    expect(offers[0].winnerEpoch).toBe(result.epoch);
    expect(readEpoch(doc)).toBe(result.epoch);
  });
});
