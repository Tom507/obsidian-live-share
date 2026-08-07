// WP30 / AC2 (peer side) blind1 — attacked as PERMUTATION INVARIANCE across a
// fleet of four replicas, with the archive corpus checked as a partition.
//
// The visible suite walks three peers in one order and checks each one. This
// file asks a different question: does the ORDER in which the peers meet the
// import matter? It must not — the winner is a fixed document, the rule is a
// comparison against it, and every replica behind it must reach the same place
// whichever position it occupies in the queue. So all 24 orderings of four
// replicas are run, and the fleet's end state is required to be identical for
// every one of them. An implementation whose adoption depends on what the
// previous replica did (shared mutable state in the module, a memoised verdict,
// a cached serialisation) is a well-known defect class here and is invisible to
// a single-order walk.
//
// The archives are then checked as a PARTITION rather than one at a time: four
// replicas behind the import produce four archives, each containing exactly its
// own author's records and none of anybody else's. A serialiser that captured
// the wrong doc — the winner, or the previously-adopted peer — still produces
// four files with four correct names, and the partition is what notices.
//
// NOT ASSERTED, DELIBERATELY: that a replica which has already merged the winner
// can prune itself to the winner's set afterwards. It cannot; one `Y.Doc` per doc
// id means a merged replica holds `winner union loser` and no local subtraction
// recovers the winner's set. The complete replacement is the importer's to
// publish, and the scenarios below meet the winner at the epoch seam.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  conflictCopyPath,
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
    meta.set(GUID_KEY, "b06d5e2f9a134c7d8e21fa4370c95b8e");
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

/** Run a real import at `liveEpoch` and return the board the peers will meet. */
async function publish(liveEpoch: number, fileIds: string[]): Promise<Y.Doc> {
  const doc = replica(liveEpoch, ["importer-own"]);
  const env: ImportFromFileEnv = {
    availability: () => ({ owned: true, degraded: false }),
    liveDoc: () => doc,
    peers: () => [],
    readCanvasFile: async () =>
      JSON.stringify({ nodes: fileIds.map((id, i) => node(id, i * 10)), edges: [] }),
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

const FLEET = [
  { name: "p0", epoch: 1, nodes: ["r0a", "r0b"] },
  { name: "p1", epoch: 3, nodes: ["r1a"] },
  { name: "p2", epoch: 5, nodes: ["r2a", "r2b", "r2c"] },
  { name: "p3", epoch: 0, nodes: ["r3a"] },
];

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

async function runFleet(order: typeof FLEET): Promise<{
  end: Record<string, { ids: string[]; epoch: number }>;
  archives: Record<string, string>;
}> {
  const published = await publish(6, ["z1", "z2"]);
  const end: Record<string, { ids: string[]; epoch: number }> = {};
  const archives: Record<string, string> = {};

  for (const spec of order) {
    const peer = replica(spec.epoch, spec.nodes);
    await resolveEpochConflict({
      doc: peer,
      winner: published,
      canvasPath: PATH,
      env: {
        serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
        writeConflictCopy: async (_path: string, content: string) => {
          archives[spec.name] = content;
        },
        notify: () => {},
        today: () => TODAY,
      },
    });
    end[spec.name] = { ids: ids(peer), epoch: readEpoch(peer) };
  }
  return { end, archives };
}

describe("WP30 tp07 blind1 — a fleet of four, in every order", () => {
  it("reaches the same end state under all 24 orderings", async () => {
    const orders = permutations(FLEET);
    expect(orders).toHaveLength(24);

    const canonicalise = (end: Record<string, { ids: string[]; epoch: number }>): string =>
      JSON.stringify(
        Object.keys(end)
          .sort()
          .map((name) => [name, end[name].ids, end[name].epoch]),
      );

    const results: string[] = [];
    for (const order of orders) results.push(canonicalise((await runFleet(order)).end));

    for (const [index, result] of results.entries()) {
      expect(result, `ordering ${index}`).toBe(results[0]);
    }
  });

  it("leaves every replica holding exactly the imported board at the imported epoch", async () => {
    const { end } = await runFleet(FLEET);
    for (const spec of FLEET) {
      expect(end[spec.name].ids, spec.name).toEqual(["z1", "z2"]);
      expect(end[spec.name].epoch, spec.name).toBe(7);
    }
  });

  it("produces one archive per replica, and they partition the fleet's work", async () => {
    const { archives } = await runFleet(FLEET);
    expect(Object.keys(archives).sort()).toEqual(["p0", "p1", "p2", "p3"]);

    for (const spec of FLEET) {
      const mine = archives[spec.name];
      for (const id of spec.nodes) expect(mine, `${spec.name} lost ${id}`).toContain(id);
      // and nobody else's, and not the winner's
      for (const other of FLEET) {
        if (other.name === spec.name) continue;
        for (const id of other.nodes) {
          expect(mine, `${spec.name} archived ${other.name}'s ${id}`).not.toContain(id);
        }
      }
      expect(mine, `${spec.name} archived the winner`).not.toContain("z1");
    }
  });

  it("names every archive with WP28's format, never a hand-spelt one", async () => {
    const published = await publish(6, ["z1"]);
    const peer = replica(2, ["r"]);
    const written: string[] = [];
    await resolveEpochConflict({
      doc: peer,
      winner: published,
      canvasPath: PATH,
      env: {
        serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
        writeConflictCopy: async (path: string) => {
          written.push(path);
        },
        notify: () => {},
        today: () => TODAY,
      },
    });
    expect(written).toEqual([conflictCopyPath(PATH, TODAY)]);
  });
});
