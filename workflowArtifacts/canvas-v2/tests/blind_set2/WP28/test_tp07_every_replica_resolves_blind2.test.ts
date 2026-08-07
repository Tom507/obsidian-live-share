// WP28 / AC1 blind2 — "on every replica" under a MOVING winner: the authoritative
// state is imported twice, and the four peers meet it at different points.
//
// Different angle: the visible probe and blind1 both hold the winner still. In
// the field it does not stand still — WP30's import command is a user action that
// can happen again five minutes later, so a peer that was offline meets epoch 14
// while a peer that was online already adopted epoch 13. The claim under test is
// that each replica lands on the epoch and the board it actually met, and that a
// later import supersedes an earlier one on every replica that sees it.
//
// WHICH ASSERTIONS ARE SAFE (Shared Ownership Contract §5, WP28): every value
// asserted by identity here has a SINGLE AUTHOR — each replica writes its own
// adoption locally, from a winner it read, with no concurrent same-key write for
// Yjs to tie-break on `clientID`. That single-authorship is exactly why an epoch
// can carry an ordering that record content cannot, and it is why nothing in this
// file asserts a specific winner for a genuinely concurrent write.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  bumpEpoch,
  readEpoch,
  resolveEpochConflict,
} from "../../../../../plugin/src/canvas/canvas-epoch";
import { EPOCH_KEY, META_MAP_NAME } from "../../../../../plugin/src/canvas/canvas-schema";

const BOARD = "team/atlas.canvas";
const PEERS = 4;

function makeDoc(epoch: number, ids: readonly string[], marker: string): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap<unknown>(META_MAP_NAME).set(EPOCH_KEY, epoch);
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    for (const id of ids) {
      const record = new Y.Map<unknown>();
      nodes.set(id, record);
      record.set("id", id);
      record.set("origin", marker);
    }
  });
  return doc;
}

function ids(doc: Y.Doc): string[] {
  return [...doc.getMap("nodes").keys()].sort();
}

function ledger() {
  const archives: string[] = [];
  return {
    archives,
    env: {
      serializeDoc: (doc: Y.Doc) => JSON.stringify(ids(doc)),
      writeConflictCopy: async (_path: string, content: string) => {
        archives.push(content);
      },
      notify: () => {},
      today: () => "2026-12-01",
      logger: { debug: () => {}, warn: () => {} },
    },
  };
}

describe("WP28 AC1 blind2 — four peers, two successive imports", () => {
  it("peers that meet the FIRST import land on it; the fourth stays behind until it meets one", async () => {
    const peers = Array.from({ length: PEERS }, (_u, i) =>
      makeDoc(1, ["common", `own-${i}`], `peer-${i}`),
    );
    const ledgers = peers.map(() => ledger());
    const firstImport = makeDoc(13, ["common", "import-a"], "import-1");

    for (const index of [0, 1, 2]) {
      await resolveEpochConflict({
        doc: peers[index],
        winner: firstImport,
        canvasPath: BOARD,
        env: ledgers[index].env,
      });
    }

    for (const index of [0, 1, 2]) {
      expect(readEpoch(peers[index]), `peer ${index}`).toBe(13);
      expect(ids(peers[index])).toEqual(["common", "import-a"]);
      expect(ledgers[index].archives).toHaveLength(1);
    }
    expect(readEpoch(peers[3])).toBe(1);
    expect(ids(peers[3])).toEqual(["common", "own-3"]);
    expect(ledgers[3].archives).toEqual([]);

    for (const peer of peers) peer.destroy();
    firstImport.destroy();
  });

  it("a SECOND import supersedes the first on every peer that sees it", async () => {
    const peers = Array.from({ length: PEERS }, (_u, i) =>
      makeDoc(1, ["common", `own-${i}`], `peer-${i}`),
    );
    const ledgers = peers.map(() => ledger());
    const firstImport = makeDoc(13, ["common", "import-a"], "import-1");
    for (const index of [0, 1, 2]) {
      await resolveEpochConflict({
        doc: peers[index],
        winner: firstImport,
        canvasPath: BOARD,
        env: ledgers[index].env,
      });
    }

    bumpEpoch(firstImport);
    firstImport.transact(() => {
      const nodes = firstImport.getMap<Y.Map<unknown>>("nodes");
      nodes.delete("import-a");
      const record = new Y.Map<unknown>();
      nodes.set("import-b", record);
      record.set("id", "import-b");
      record.set("origin", "import-2");
    });

    for (const index of [0, 1, 2, 3]) {
      await resolveEpochConflict({
        doc: peers[index],
        winner: firstImport,
        canvasPath: BOARD,
        env: ledgers[index].env,
      });
    }

    for (const [index, peer] of peers.entries()) {
      expect(readEpoch(peer), `peer ${index} epoch`).toBe(14);
      expect(ids(peer), `peer ${index} board`).toEqual(["common", "import-b"]);
    }
    // Peers 0-2 archived twice (they were behind at both imports); peer 3 once.
    expect(ledgers.map((l) => l.archives.length)).toEqual([2, 2, 2, 1]);
    for (const peer of peers) peer.destroy();
    firstImport.destroy();
  });

  it("each peer's FIRST archive holds its own private record, not a neighbour's", async () => {
    const peers = Array.from({ length: PEERS }, (_u, i) =>
      makeDoc(1, ["common", `own-${i}`], `peer-${i}`),
    );
    const ledgers = peers.map(() => ledger());
    const importDoc = makeDoc(13, ["common", "import-a"], "import-1");

    for (let index = 0; index < PEERS; index++) {
      await resolveEpochConflict({
        doc: peers[index],
        winner: importDoc,
        canvasPath: BOARD,
        env: ledgers[index].env,
      });
    }

    for (const [index, l] of ledgers.entries()) {
      expect(l.archives[0], `peer ${index}`).toContain(`own-${index}`);
      for (let other = 0; other < PEERS; other++) {
        if (other === index) continue;
        expect(l.archives[0]).not.toContain(`own-${other}`);
      }
    }
    for (const peer of peers) peer.destroy();
    importDoc.destroy();
  });

  it("a peer that already adopted the second import does not archive a third time", async () => {
    const peer = makeDoc(1, ["common", "own-0"], "peer-0");
    const l = ledger();
    const importDoc = makeDoc(20, ["common", "import-a"], "import-1");

    await resolveEpochConflict({ doc: peer, winner: importDoc, canvasPath: BOARD, env: l.env });
    await resolveEpochConflict({ doc: peer, winner: importDoc, canvasPath: BOARD, env: l.env });
    await resolveEpochConflict({ doc: peer, winner: importDoc, canvasPath: BOARD, env: l.env });

    expect(
      l.archives,
      "re-offering an already-adopted winner produced further conflict copies — the " +
        "archive path is firing on a related-replica merge",
    ).toHaveLength(1);
    peer.destroy();
    importDoc.destroy();
  });

  it("all four peers agree on the board at the end, id for id", async () => {
    const peers = Array.from({ length: PEERS }, (_u, i) =>
      makeDoc(i, ["common", `own-${i}`], `peer-${i}`),
    );
    const ledgers = peers.map(() => ledger());
    const importDoc = makeDoc(30, ["common", "import-a", "import-b"], "import-1");

    for (let index = PEERS - 1; index >= 0; index--) {
      await resolveEpochConflict({
        doc: peers[index],
        winner: importDoc,
        canvasPath: BOARD,
        env: ledgers[index].env,
      });
    }

    const boards = peers.map((peer) => JSON.stringify(ids(peer)));
    expect(new Set(boards).size, "the peers did not agree").toBe(1);
    expect(JSON.parse(boards[0])).toEqual(["common", "import-a", "import-b"]);
    expect(peers.map((peer) => readEpoch(peer))).toEqual([30, 30, 30, 30]);
    for (const peer of peers) peer.destroy();
    importDoc.destroy();
  });
});
