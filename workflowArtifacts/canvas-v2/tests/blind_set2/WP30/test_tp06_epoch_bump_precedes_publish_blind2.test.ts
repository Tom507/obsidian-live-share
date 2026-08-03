// WP30 / AC2 (importer side) blind2 — the published epoch attacked as a
// BOUNDARY, measured from the peers' side rather than from the importer's.
//
// The importer's own view of its epoch is not the thing AC2 is about. What the
// acceptance criterion actually claims is that the import "causes peers to adopt
// it through the epoch rule" — a statement about where the verdict boundary
// falls for every other replica in the session. So this file publishes ONE
// import and then sweeps a fresh peer across the epoch range around it,
// recording the verdict at each point. The result must be a clean step function
// with the boundary exactly at the published value:
//
//     peer epoch  <  published  ->  remote-wins  (archives, adopts)
//     peer epoch ===  published  ->  equal       (merges, archives nothing)
//     peer epoch  >  published  ->  local-wins   (keeps its own, archives nothing)
//
// A step function is a much stronger statement than "one peer adopted". An
// implementation that publishes an epoch one too low leaves the boundary in the
// wrong place and the sweep names the exact point where it moved; one that does
// not bump at all collapses the first region to nothing; one that bumps by an
// arbitrary large amount also moves the boundary and is caught even though every
// single-peer scenario would still pass.
//
// The third region matters as much as the first. A replica AHEAD of the import
// must not archive: an implementation that archives on every merge would hand a
// user a "conflict copy" of the state it is about to keep, which is noise that
// trains people to ignore the notice that matters.

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
  type ImportFromFileEnv,
  runImportFromFile,
} from "../../../../../plugin/src/files/canvas-import";
import { DELETED_MAP_NAME, buildCanvasData } from "../../../../../plugin/src/files/canvas-sync";

const PATH = "vault/deck.canvas";
const TODAY = "2026-08-02";
const IMPORTER_EPOCH = 20;

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
    meta.set(GUID_KEY, "2e58a91c04df43b7a86015ecb3729f4d");
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

async function publish(): Promise<Y.Doc> {
  const doc = replica(IMPORTER_EPOCH, ["importer-own"]);
  const env: ImportFromFileEnv = {
    availability: () => ({ owned: true, degraded: false }),
    liveDoc: () => doc,
    peers: () => [],
    readCanvasFile: async () => JSON.stringify({ nodes: [node("z1"), node("z2", 20)], edges: [] }),
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
  await runImportFromFile(PATH, env);
  return doc;
}

async function meet(peerEpoch: number, published: Y.Doc) {
  const peer = replica(peerEpoch, ["peer-own"]);
  const archives: string[] = [];
  const outcome = await resolveEpochConflict({
    doc: peer,
    winner: published,
    canvasPath: PATH,
    env: {
      serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
      writeConflictCopy: async (path: string) => {
        archives.push(path);
      },
      notify: () => {},
      today: () => TODAY,
    },
  });
  return { outcome, archives, peer };
}

describe("WP30 tp06 blind2 — the verdict boundary sits exactly at the published epoch", () => {
  it("publishes an epoch strictly above the importer's own", async () => {
    const published = await publish();
    expect(readEpoch(published)).toBeGreaterThan(IMPORTER_EPOCH);
  });

  it("sweeps to a clean step function around the published value", async () => {
    const published = await publish();
    const target = readEpoch(published);
    const verdicts: Record<number, string> = {};

    for (let peerEpoch = target - 5; peerEpoch <= target + 5; peerEpoch++) {
      if (peerEpoch < 0) continue;
      verdicts[peerEpoch] = (await meet(peerEpoch, published)).outcome.verdict;
    }

    for (const [epochText, verdict] of Object.entries(verdicts)) {
      const peerEpoch = Number(epochText);
      const expected =
        peerEpoch < target ? "remote-wins" : peerEpoch === target ? "equal" : "local-wins";
      expect(verdict, `peer epoch ${peerEpoch}`).toBe(expected);
    }
  });

  it("every replica strictly below the boundary archives exactly once and adopts", async () => {
    const published = await publish();
    const target = readEpoch(published);

    for (const peerEpoch of [0, 1, target - 2, target - 1]) {
      const { outcome, archives, peer } = await meet(peerEpoch, published);
      expect(outcome.adopted, `peer epoch ${peerEpoch}`).toBe(true);
      expect(archives, `peer epoch ${peerEpoch}`).toHaveLength(1);
      expect(ids(peer), `peer epoch ${peerEpoch}`).toEqual(["z1", "z2"]);
      expect(readEpoch(peer), `peer epoch ${peerEpoch}`).toBe(target);
    }
  });

  it("no replica at or above the boundary archives anything", async () => {
    const published = await publish();
    const target = readEpoch(published);

    for (const peerEpoch of [target, target + 1, target + 100]) {
      const { outcome, archives, peer } = await meet(peerEpoch, published);
      expect(outcome.adopted, `peer epoch ${peerEpoch}`).toBe(false);
      expect(outcome.archivedTo, `peer epoch ${peerEpoch}`).toBeNull();
      expect(archives, `peer epoch ${peerEpoch}`).toEqual([]);
      expect(ids(peer), `peer epoch ${peerEpoch}`).toEqual(["peer-own"]);
    }
  });

  it("the boundary moves with each further import, and never backwards", async () => {
    const doc = replica(IMPORTER_EPOCH, ["importer-own"]);
    const env: ImportFromFileEnv = {
      availability: () => ({ owned: true, degraded: false }),
      liveDoc: () => doc,
      peers: () => [],
      readCanvasFile: async () => JSON.stringify({ nodes: [node("z1")], edges: [] }),
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

    const boundaries: number[] = [];
    for (let i = 0; i < 3; i++) {
      await runImportFromFile(PATH, env);
      boundaries.push(readEpoch(doc));
      const stale = await meet(boundaries[0] - 1, doc);
      expect(stale.outcome.verdict, `after import ${i}`).toBe("remote-wins");
    }

    expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b));
    expect(new Set(boundaries).size).toBe(3);
  });
});
