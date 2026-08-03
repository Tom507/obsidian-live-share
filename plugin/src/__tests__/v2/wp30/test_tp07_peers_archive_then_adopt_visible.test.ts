// WP30 / AC2, peer side — "... and causes peers to adopt it through the epoch
// rule while archiving their state as a conflict copy".
//
// THIS IS THE HALF THAT JUSTIFIES ROUTING AN IMPORT THROUGH THE EPOCH RULE AT
// ALL. If the import merely wrote the file's records into the shared doc, peers
// would merge them as ordinary edits: nothing would be archived, and every
// record a peer held that the file does not mention would survive, so the file
// would not have overwritten anything. The archive is not a courtesy attached to
// the mechanism — it is the evidence that the mechanism ran.
//
// THE SUBJECT HERE IS WHAT THE IMPORT PUBLISHED, NOT A FIXTURE. Each scenario
// runs a real import first and then meets a peer replica with the board the
// import actually left behind. So an import that publishes the wrong epoch, or
// publishes the file's records without a wholesale replacement, is caught by the
// PEER's verdict rather than by an assertion about the importer.
//
// THREE REPLICAS, NOT TWO. Interleaving classes from three peers upward are
// distinct, and a two-replica scenario cannot show that the loser set is not
// simply "the other one".
//
// WHAT IS DELIBERATELY *NOT* ASSERTED, and must never be added: that a replica
// which has ALREADY merged the winner can prune itself to the winner's record
// set. It cannot, and no implementation can — `SyncManager.getDoc` creates one
// `Y.Doc` per doc id and every peer's state arrives as updates into it, so after
// a merge the doc holds `winner union loser` and the shared ids are in both.
// No local subtraction yields the winner's set. That is why the COMPLETE
// replacement is executed by the importer and published wholesale through
// `CanvasSync.adoptEpochWinner`, and why the peer scenarios below meet the
// winner at the epoch seam (a staged replica vs the settled doc) rather than
// after a union.
//
// CRDT DISCIPLINE: `meta.epoch` has a single author per replica and a causal
// predecessor chain, so it is asserted by value. Record CONTENT after a merge is
// never asserted by identity anywhere in this file — only membership.
//
// PRODUCTION LINE <-> ASSERTION: the epoch WP30 publishes (`bumpEpoch(winner)`
// in `plugin/src/files/canvas-import.ts`) and the wholesale replacement it
// publishes it with (`env.adoptEpochWinner`). Publishing the same epoch reddens
// every "remote-wins" assertion below and turns `archivedTo` null; publishing
// the records by a direct write instead of the seam reddens
// `the peer's board becomes exactly what was imported`.

import { describe, expect, it } from "vitest";
import type * as Y from "yjs";

import {
  conflictCopyPath,
  epochConflictNotice,
  readEpoch,
  resolveEpochConflict,
} from "../../../canvas/canvas-epoch";
import { runImportFromFile } from "../../../files/canvas-import";
import {
  CANVAS_PATH,
  CONFLICT_COPY,
  TODAY,
  canvasJson,
  createImportHarness,
  edge,
  makeLiveDoc,
  projection,
  textNode,
} from "./harness";

const FILE_TEXT = canvasJson(
  [textNode("file-a", 0, "alpha"), textNode("file-b", 60, "beta")],
  [edge("file-e", "file-a", "file-b")],
);

interface PeerProbe {
  writes: {
    path: string;
    content: string;
    idsAtWriteTime: { nodes: string[]; edges: string[] };
    epochAtWriteTime: number;
  }[];
  notices: string[];
}

/** Meet `peer` with `winner` the way `reconcileEpochOnSubscribe` does. */
async function meetWinner(peer: Y.Doc, winner: Y.Doc, probe: PeerProbe) {
  return resolveEpochConflict({
    doc: peer,
    winner,
    canvasPath: CANVAS_PATH,
    env: {
      serializeDoc: (doc: Y.Doc) => JSON.stringify(projection(doc)),
      writeConflictCopy: async (path: string, content: string) => {
        probe.writes.push({
          path,
          content,
          idsAtWriteTime: projection(peer),
          epochAtWriteTime: readEpoch(peer),
        });
      },
      notify: (message: string) => probe.notices.push(message),
      today: () => TODAY,
    },
  });
}

function newProbe(): PeerProbe {
  return { writes: [], notices: [] };
}

/** Run a real import and hand back the board the peers will meet. */
async function importThenPublish(liveEpoch = 7): Promise<Y.Doc> {
  const harness = createImportHarness({
    liveEpoch,
    liveNodes: [textNode("live-1", 0, "one")],
    fileText: FILE_TEXT,
    answer: true,
  });
  await runImportFromFile(CANVAS_PATH, harness.env);
  return harness.liveDoc as Y.Doc;
}

describe("WP30 tp07 — peers adopt the import through the epoch rule, archiving first", () => {
  it("a peer behind the import archives its own state and then adopts", async () => {
    const published = await importThenPublish(7);
    const peer = makeLiveDoc({ epoch: 7, nodes: [textNode("peer-1", 0, "peer work")] });
    const probe = newProbe();

    const outcome = await meetWinner(peer, published, probe);

    expect(outcome.verdict).toBe("remote-wins");
    expect(outcome.adopted).toBe(true);
    expect(outcome.archivedTo).toBe(conflictCopyPath(CANVAS_PATH, TODAY));
    expect(outcome.archivedTo).toBe(CONFLICT_COPY);
    expect(probe.writes).toHaveLength(1);
  });

  it("the archive holds the PEER's pre-import work, not the imported board", async () => {
    const published = await importThenPublish(7);
    const peer = makeLiveDoc({ epoch: 7, nodes: [textNode("peer-1", 0, "peer work")] });
    const probe = newProbe();

    await meetWinner(peer, published, probe);

    // Captured at the instant of the write: an archive taken after the adoption
    // would be a copy of the winner and would look perfectly healthy on disk.
    expect(probe.writes).toHaveLength(1);
    expect(probe.writes[0].idsAtWriteTime).toEqual({ nodes: ["peer-1"], edges: [] });
    expect(probe.writes[0].epochAtWriteTime).toBe(7);
    expect(probe.writes[0].content).toContain("peer-1");
    expect(probe.writes[0].content).not.toContain("file-a");
  });

  it("the peer is told, by name, where its work went", async () => {
    const published = await importThenPublish(7);
    const peer = makeLiveDoc({ epoch: 7, nodes: [textNode("peer-1", 0, "peer work")] });
    const probe = newProbe();

    await meetWinner(peer, published, probe);

    expect(probe.notices).toHaveLength(1);
    expect(probe.notices).toEqual([epochConflictNotice(CONFLICT_COPY)]);
    expect(probe.notices[0]).toContain(CONFLICT_COPY);
  });

  it("the peer's board becomes exactly what was imported", async () => {
    const published = await importThenPublish(7);
    const peer = makeLiveDoc({
      epoch: 7,
      nodes: [textNode("peer-1", 0, "peer work"), textNode("file-a", 0, "peer's own alpha")],
    });
    const probe = newProbe();

    await meetWinner(peer, published, probe);

    // MEMBERSHIP, not content. `file-a` exists on both sides and its fields are
    // contested; the assertion is that the id set is the winner's exactly, which
    // is what "overwrites" means and what an ordinary merge would not produce.
    expect(projection(peer)).toEqual(projection(published));
    expect(projection(peer)).toEqual({ nodes: ["file-a", "file-b"], edges: ["file-e"] });
    expect(projection(peer).nodes).not.toContain("peer-1");
    expect(readEpoch(peer)).toBe(readEpoch(published));
    expect(readEpoch(peer)).toBe(8);
  });

  it("three replicas behind the import all archive and all converge", async () => {
    const published = await importThenPublish(7);
    const peers = [
      makeLiveDoc({ epoch: 7, nodes: [textNode("p1", 0, "one")] }),
      makeLiveDoc({ epoch: 7, nodes: [textNode("p2", 0, "two"), textNode("p2b", 30, "two b")] }),
      makeLiveDoc({ epoch: 3, nodes: [textNode("p3", 0, "three")] }),
    ];
    const probes = [newProbe(), newProbe(), newProbe()];

    for (let i = 0; i < peers.length; i++) {
      const outcome = await meetWinner(peers[i], published, probes[i]);
      expect(outcome.adopted, `peer ${i}`).toBe(true);
      expect(probes[i].writes, `peer ${i}`).toHaveLength(1);
    }

    for (let i = 0; i < peers.length; i++) {
      expect(projection(peers[i]), `peer ${i}`).toEqual(projection(published));
      expect(readEpoch(peers[i]), `peer ${i}`).toBe(8);
    }
    // Each archive carries that peer's own work and nobody else's.
    expect(probes[0].writes[0].content).toContain("p1");
    expect(probes[1].writes[0].content).toContain("p2b");
    expect(probes[2].writes[0].content).toContain("p3");
    expect(probes[0].writes[0].content).not.toContain("p2");
  });

  it("a peer already AT the imported epoch merges normally and archives nothing", async () => {
    // The discriminating half. Without it, an implementation that archives on
    // every merge passes every assertion above.
    const published = await importThenPublish(7);
    const uptodate = makeLiveDoc({ epoch: 8, nodes: [textNode("peer-1", 0, "peer work")] });
    const probe = newProbe();

    const outcome = await meetWinner(uptodate, published, probe);

    expect(outcome.verdict).toBe("equal");
    expect(outcome.adopted).toBe(false);
    expect(outcome.archivedTo).toBeNull();
    expect(probe.writes).toEqual([]);
    expect(probe.notices).toEqual([]);
    expect(projection(uptodate)).toEqual({ nodes: ["peer-1"], edges: [] });
  });

  it("an import that did NOT raise the epoch changes nothing on any peer", async () => {
    // The failure this whole test point exists to catch, stated directly: a
    // "seed without a bump" publishes a board whose epoch equals the peers', the
    // epoch rule declines, and the user's import silently does not arrive.
    const notBumped = makeLiveDoc({
      epoch: 7,
      nodes: [textNode("file-a", 0, "alpha"), textNode("file-b", 60, "beta")],
    });
    const peer = makeLiveDoc({ epoch: 7, nodes: [textNode("peer-1", 0, "peer work")] });
    const probe = newProbe();

    const outcome = await meetWinner(peer, notBumped, probe);

    expect(outcome.adopted).toBe(false);
    expect(probe.writes).toEqual([]);
    expect(projection(peer)).toEqual({ nodes: ["peer-1"], edges: [] });

    // ... whereas the real import, on the identical peer, does arrive.
    const published = await importThenPublish(7);
    const peer2 = makeLiveDoc({ epoch: 7, nodes: [textNode("peer-1", 0, "peer work")] });
    const probe2 = newProbe();
    const real = await meetWinner(peer2, published, probe2);
    expect(real.adopted).toBe(true);
    expect(probe2.writes).toHaveLength(1);
  });
});
