// WP30 / AC2 (peer side) blind2 — attacked as IDEMPOTENCE and as ARCHIVE
// ACCOUNTING, on a fleet that is not uniformly behind the import.
//
// A peer does not meet the import once. It meets it at every subscribe, and a
// session reconnects. So the property that matters in the field is: a replica
// that has already adopted must adopt again for free — no second archive, no
// second transaction, no second notice. An implementation that archived on every
// encounter would fill the vault with copies of the board the user is currently
// looking at, and would bury the ONE archive that contains work under a pile
// that does not.
//
// The accounting is the second half. Over a fleet where some replicas are
// behind, one is exactly level and one is ahead, the number of archives written
// must equal the number of replicas that actually lost work — not the number of
// replicas, and not one. That single number is what distinguishes "the epoch
// rule ran" from "something wrote some files".
//
// NOT ASSERTED, DELIBERATELY: that a replica which has already unioned the
// winner can prune itself to the winner's record set. One `Y.Doc` per doc id
// means the merged replica holds `winner union loser`, shared ids are on both
// sides, and no local subtraction recovers the winner's set. The complete
// replacement belongs to the importer and is published wholesale.

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
    meta.set(GUID_KEY, "cf9207e451ab4d38b60e1972ad35c8f1");
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

async function publish(importerEpoch: number, fileIds: string[]): Promise<Y.Doc> {
  const doc = replica(importerEpoch, ["importer-own"]);
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

interface Ledger {
  archives: string[];
  notices: string[];
  transactions: number;
}

async function meet(peer: Y.Doc, winner: Y.Doc, ledger: Ledger) {
  const listener = () => {
    ledger.transactions += 1;
  };
  peer.on("update", listener);
  try {
    return await resolveEpochConflict({
      doc: peer,
      winner,
      canvasPath: PATH,
      env: {
        serializeDoc: (d: Y.Doc) => JSON.stringify(ids(d)),
        writeConflictCopy: async (path: string, content: string) => {
          ledger.archives.push(`${path}::${content}`);
        },
        notify: (message: string) => ledger.notices.push(message),
        today: () => TODAY,
      },
    });
  } finally {
    peer.off("update", listener);
  }
}

describe("WP30 tp07 blind2 — meeting the import twice is free", () => {
  it("a replica that has adopted archives nothing the second time", async () => {
    const published = await publish(10, ["z1", "z2"]);
    const peer = replica(4, ["peer-own"]);
    const ledger: Ledger = { archives: [], notices: [], transactions: 0 };

    const first = await meet(peer, published, ledger);
    expect(first.adopted).toBe(true);
    expect(ledger.archives).toHaveLength(1);
    expect(ledger.transactions).toBe(1);

    const second = await meet(peer, published, ledger);
    expect(second.verdict).toBe("equal");
    expect(second.adopted).toBe(false);
    expect(ledger.archives).toHaveLength(1);
    expect(ledger.notices).toHaveLength(1);
    expect(ledger.transactions).toBe(1);
  });

  it("meeting it five more times changes nothing at all", async () => {
    const published = await publish(10, ["z1", "z2"]);
    const peer = replica(4, ["peer-own"]);
    const ledger: Ledger = { archives: [], notices: [], transactions: 0 };

    await meet(peer, published, ledger);
    const settled = { ids: ids(peer), epoch: readEpoch(peer) };
    for (let i = 0; i < 5; i++) await meet(peer, published, ledger);

    expect(ledger.archives).toHaveLength(1);
    expect(ledger.transactions).toBe(1);
    expect(ids(peer)).toEqual(settled.ids);
    expect(readEpoch(peer)).toBe(settled.epoch);
  });

  it("the archive count equals the number of replicas that actually lost work", async () => {
    const published = await publish(10, ["z1", "z2"]);
    const target = readEpoch(published);
    const fleet = [
      { name: "behind-a", epoch: 2, nodes: ["a1"], loses: true },
      { name: "behind-b", epoch: 9, nodes: ["b1", "b2"], loses: true },
      { name: "level", epoch: target, nodes: ["c1"], loses: false },
      { name: "ahead", epoch: target + 3, nodes: ["d1"], loses: false },
    ];
    const ledger: Ledger = { archives: [], notices: [], transactions: 0 };

    for (const spec of fleet) {
      await meet(replica(spec.epoch, spec.nodes), published, ledger);
    }

    expect(ledger.archives).toHaveLength(fleet.filter((s) => s.loses).length);
    expect(ledger.notices).toHaveLength(fleet.filter((s) => s.loses).length);
    expect(ledger.transactions).toBe(fleet.filter((s) => s.loses).length);
  });

  it("the replica ahead of the import keeps its own board untouched", async () => {
    const published = await publish(10, ["z1", "z2"]);
    const ahead = replica(readEpoch(published) + 1, ["ahead-1", "ahead-2"]);
    const ledger: Ledger = { archives: [], notices: [], transactions: 0 };

    const outcome = await meet(ahead, published, ledger);

    expect(outcome.verdict).toBe("local-wins");
    expect(outcome.adopted).toBe(false);
    expect(ledger.archives).toEqual([]);
    expect(ids(ahead)).toEqual(["ahead-1", "ahead-2"]);
  });

  it("each archive body is that replica's own, and never the winner's", async () => {
    const published = await publish(10, ["z1", "z2"]);
    const ledger: Ledger = { archives: [], notices: [], transactions: 0 };

    await meet(replica(1, ["only-mine"]), published, ledger);

    expect(ledger.archives).toHaveLength(1);
    expect(ledger.archives[0]).toContain("only-mine");
    expect(ledger.archives[0]).not.toContain("z1");
    expect(ledger.archives[0]).not.toContain("z2");
  });
});
