// WP79 / AC2, AC3, AC4, AC5 — the mirror pass itself.
//
// tp01 pins the verdict. This pins that the pass OBEYS it and that the file a
// guest ends up with is produced by the ONE existing projection through the ONE
// existing writer.
//
// THE POSITIVE CONTROL IS PART OF THE CRITERION, not decoration. "The guest has
// the file" passes trivially when the fixture pre-created it, when the test's
// own helper wrote it, or when a stray fallback wrote it from a `Y.Text`. So:
//   ├── the file is asserted ABSENT immediately before the pass
//   ├── the write is attributed by the receipt the pass itself emits
//   ├── the bytes are asserted to CHANGE when the doc changes, so the oracle
//   │   cannot be satisfied by a constant
//   └── the same fixture with the pass disabled at its injected seam leaves the
//       file ABSENT
//
// PRODUCTION LINE <-> ASSERTION: `mirrorSharedCanvases` /`mirrorOne` in
// `plugin/src/files/canvas-mirror.ts`. The `materialise` call is the only line
// that ends in a file; removing the `verdict !== MATERIALISE` guard above it
// reddens the create-only and empty-doc blocks.

import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { MIRROR_VERDICT } from "../../../files/canvas-mirror-decision";
import { mirrorSharedCanvases } from "../../../files/canvas-mirror";
import {
  canvasJson,
  canvasPath,
  createMirrorWorld,
  edge,
  hostProjectionOf,
  seedDoc,
  textNode,
} from "./harness";

const BOARD = canvasPath("plan");
const GUID = "3c81a75e9f2b47d6a0e14c5b8d7629fa";

const PEER_NODES = [textNode("p-1", 0, "from the host"), textNode("p-2", 400, "second card")];
const PEER_EDGES = [edge("p-e1", "p-1", "p-2")];

function guestWorld(overrides: Record<string, unknown> = {}) {
  return createMirrorWorld({
    role: "guest",
    files: {},
    manifestPaths: [BOARD],
    guids: { [BOARD]: GUID },
    peerContent: { [BOARD]: { nodes: PEER_NODES, edges: PEER_EDGES } },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// AC2 — the mirrored file comes from the one projection and the one writer.
// ---------------------------------------------------------------------------

describe("WP79 AC2 - a guest materialises a canvas it never had", () => {
  it("the file is ABSENT before the pass and PRESENT after it", async () => {
    const world = guestWorld();
    expect(world.disk(BOARD), "the fixture pre-created the file").toBeUndefined();

    const report = await mirrorSharedCanvases(world.deps);

    expect(world.disk(BOARD)).toBeTypeOf("string");
    expect(report.materialised).toBe(1);
  });

  it("the receipt attributes the write - path, verdict and outcome", async () => {
    const world = guestWorld();
    const report = await mirrorSharedCanvases(world.deps);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      path: BOARD,
      verdict: MIRROR_VERDICT.MATERIALISE,
      outcome: "materialised",
    });
    // The write went through the single writer's IO and nowhere else.
    expect(world.writes).toEqual([BOARD]);
  });

  it("the bytes equal what the HOST's own writer produces from the same doc", async () => {
    const world = guestWorld();
    await mirrorSharedCanvases(world.deps);

    const local = world.localDocs.get(BOARD);
    expect(local).toBeDefined();
    const hostBytes = await hostProjectionOf(local as Y.Doc, BOARD);

    // Byte agreement is a CONSEQUENCE of one definer: both sides ran
    // `CanvasPersistence` -> `serializeCanvas`. No second serialiser exists in
    // this test, which is the point.
    expect(world.disk(BOARD)).toBe(hostBytes);
  });

  it("the content is the host's records, not an empty skeleton", async () => {
    const world = guestWorld();
    await mirrorSharedCanvases(world.deps);

    const parsed = JSON.parse(world.disk(BOARD) as string) as {
      nodes: { id: string }[];
      edges: { id: string }[];
    };
    expect(parsed.nodes.map((n) => n.id).sort()).toEqual(["p-1", "p-2"]);
    expect(parsed.edges.map((e) => e.id)).toEqual(["p-e1"]);
  });

  it("the bytes CHANGE when the doc changes - the oracle is not a constant", async () => {
    const first = guestWorld();
    await mirrorSharedCanvases(first.deps);

    const second = createMirrorWorld({
      role: "guest",
      files: {},
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: {
        [BOARD]: { nodes: [textNode("other-1", 77, "a different board")], edges: [] },
      },
    });
    await mirrorSharedCanvases(second.deps);

    expect(second.disk(BOARD)).toBeTypeOf("string");
    expect(second.disk(BOARD)).not.toBe(first.disk(BOARD));
  });

  it("INJECTION (i): with the pass disabled at its seam the file stays ABSENT", async () => {
    const world = guestWorld({ materialiseOverride: async () => {} });
    const report = await mirrorSharedCanvases(world.deps);

    expect(world.disk(BOARD), "a file appeared without the mechanism under test").toBeUndefined();
    // The verdict is still MATERIALISE — the decision was taken, the act was
    // disabled — and the receipt reports the discrepancy rather than hiding it.
    expect(report.entries[0]?.verdict).toBe(MIRROR_VERDICT.MATERIALISE);
    expect(report.entries[0]?.outcome).toBe("failed");
    expect(report.materialised).toBe(0);
  });

  it("the R10 raw-text fallback is not reached - subscribe is called DIRECTLY", async () => {
    const world = guestWorld();
    await mirrorSharedCanvases(world.deps);
    // The pass calls `CanvasSync.subscribe` itself. It never routes through
    // `subscribeCanvasWithHandover`, whose unowned branch would install a
    // bare-path `Y.Text` for the same bytes.
    expect(world.subscribeCalls).toEqual([`guest:${BOARD}`]);
  });
});

// ---------------------------------------------------------------------------
// AC3 — identity and seed-once, at each of the four entry points.
// ---------------------------------------------------------------------------

interface EntryPoint {
  name: string;
  build: () => ReturnType<typeof createMirrorWorld>;
}

const ENTRY_POINTS: EntryPoint[] = [
  {
    // join: nothing local, nothing subscribed, the peers' state arrives on sync.
    name: "join",
    build: () => guestWorld(),
  },
  {
    // rejoin / resume: same, but this client arrives holding a sidecar replica —
    // modelled as a local doc that already carries the board before the pass.
    name: "rejoin/resume",
    build: () => {
      const world = guestWorld();
      const replica = new Y.Doc();
      seedDoc(replica, PEER_NODES, PEER_EDGES);
      world.localDocs.set(BOARD, replica);
      return world;
    },
  },
  {
    // reconnect: mid-session, the doc is already live and subscribed.
    name: "reconnect (mid-session, already subscribed)",
    build: () => guestWorld({ preSubscribed: [BOARD] }),
  },
  {
    // reload-from-host: a user command over an already-converged session. The
    // pass has already run once; this is the second run.
    name: "reload-from-host (second pass over a converged session)",
    build: () => guestWorld(),
  },
];

describe("WP79 AC3 - each entry point separately: never a seed, never a mint", () => {
  for (const entry of ENTRY_POINTS) {
    it(`${entry.name}: the guest mints no guid and creates no second doc`, async () => {
      const world = entry.build();
      const docsBefore = world.peerDocs.size;

      if (entry.name.startsWith("reload-from-host")) {
        await mirrorSharedCanvases(world.deps); // the converged first pass
      }
      await mirrorSharedCanvases(world.deps);

      expect(world.mintCalls, "a guest minted a guid").toEqual([]);
      expect(world.peerDocs.size, "a second shared doc was created").toBe(docsBefore);
      expect(world.guids.get(BOARD), "the published identity changed").toBe(GUID);
    });

    it(`${entry.name}: the materialised file is never read back as a seed`, async () => {
      const world = entry.build();
      if (entry.name.startsWith("reload-from-host")) {
        await mirrorSharedCanvases(world.deps);
      }
      await mirrorSharedCanvases(world.deps);

      expect(world.coldOpens.length).toBeGreaterThan(0);
      for (const opened of world.coldOpens) {
        // Three outcomes only (C29 AC4). A materialisation is a doc->file act,
        // so it must take the doc-wins branch, never `seeded-from-file`.
        expect(["doc-wins", "empty", "seeded-from-file"]).toContain(opened.outcome);
        expect(opened.outcome, `${entry.name}: a materialisation became a seed`).not.toBe(
          "seeded-from-file",
        );
      }
    });

    it(`${entry.name}: a second pass writes nothing more - it is not a rewrite loop`, async () => {
      const world = entry.build();
      await mirrorSharedCanvases(world.deps);
      const afterFirst = world.disk(BOARD);
      const writesAfterFirst = world.writes.length;

      await mirrorSharedCanvases(world.deps);

      expect(world.disk(BOARD)).toBe(afterFirst);
      expect(
        world.writes.length,
        "the second pass wrote over a file the guest now has",
      ).toBe(writesAfterFirst);
    });
  }

  it("FALSIFICATION: the 'never seeded-from-file' oracle CAN go red", async () => {
    // Same assertion, same harness, a doc nobody knows and a file on disk. If
    // this returned "doc-wins" the absence assertion above would be
    // unfalsifiable — an absence with no positive control is not evidence.
    const { attachCanvasPersistence } = await import("../../../files/canvas-persistence");
    const { createManualScheduler, createPersistenceIO } = await import("../wp29/harness");
    const files = new Map<string, string>([
      [BOARD, canvasJson([textNode("f-1", 0, "on disk only")])],
    ]);
    const io = createPersistenceIO(files);
    const { persistence, coldOpen } = await attachCanvasPersistence(new Y.Doc(), io, BOARD, {
      scheduler: createManualScheduler(),
      seedKnowledge: { sidecarKnowsDoc: false, peerKnowsDoc: false },
    });
    persistence.destroy();
    expect(coldOpen).toBe("seeded-from-file");
  });
});

// ---------------------------------------------------------------------------
// AC4 — nothing this WP adds ever destroys, and an empty doc produces no file.
// ---------------------------------------------------------------------------

describe("WP79 AC4 - create-only: an existing .canvas is never written to", () => {
  const DIVERGED = canvasJson(
    [textNode("local-1", 999, "the user's own card, NOT in the host's doc")],
    [],
  );

  it("the pre-existing file DIFFERS from what the doc would produce", async () => {
    const world = createMirrorWorld({
      role: "guest",
      files: { [BOARD]: DIVERGED },
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: { [BOARD]: { nodes: PEER_NODES, edges: PEER_EDGES } },
    });
    const peer = world.peerDocs.get(GUID) as Y.Doc;
    const projection = await hostProjectionOf(peer, BOARD);
    // Without this, "unchanged" would be satisfied by an overwrite.
    expect(DIVERGED).not.toBe(projection);
  });

  it("its BYTES are identical before and after the pass", async () => {
    const world = createMirrorWorld({
      role: "guest",
      files: { [BOARD]: DIVERGED },
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: { [BOARD]: { nodes: PEER_NODES, edges: PEER_EDGES } },
    });
    const before = world.disk(BOARD);

    const report = await mirrorSharedCanvases(world.deps);

    expect(world.disk(BOARD)).toBe(before);
    expect(world.writes, "a write was issued for a path that already had a file").toEqual([]);
    expect(report.entries[0]?.verdict).toBe(MIRROR_VERDICT.SKIP_LOCAL_FILE);
    expect(report.skippedLocalFile).toBe(1);
  });

  it("no doc is even opened for a path the guest already has", async () => {
    const world = createMirrorWorld({
      role: "guest",
      files: { [BOARD]: DIVERGED },
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: { [BOARD]: { nodes: PEER_NODES, edges: PEER_EDGES } },
    });
    await mirrorSharedCanvases(world.deps);
    // Both the cost argument and the safety argument: the only paths this pass
    // touches are paths where there is no user file to destroy.
    expect(world.subscribeCalls).toEqual([]);
  });

  it("this holds WITHOUT the seed-refusal withhold - no ledger is wired here", async () => {
    // The withhold is per-session and in-memory and its protection expires with
    // the session (a confirmed live P0). The create-only property above comes
    // from the verdict alone: `seedRefusals` is never passed by this pass, and
    // the file is untouched anyway.
    const world = createMirrorWorld({
      role: "guest",
      files: { [BOARD]: DIVERGED },
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: { [BOARD]: { nodes: PEER_NODES, edges: PEER_EDGES } },
    });
    await mirrorSharedCanvases(world.deps);
    expect(world.disk(BOARD)).toBe(DIVERGED);
  });

  it("INJECTION (ii): forcing MATERIALISE for a path whose file exists reddens the byte comparison", async () => {
    // The injection is applied to the decision, not to the assertion: with the
    // core answering `materialise` for a present file, the very same byte
    // comparison above must FAIL. That is what makes it evidence.
    const world = createMirrorWorld({
      role: "guest",
      files: { [BOARD]: DIVERGED },
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: { [BOARD]: { nodes: PEER_NODES, edges: PEER_EDGES } },
    });
    const before = world.disk(BOARD);
    // Lie about the world exactly the way a broken `localFileExists` probe
    // would: report the file as absent so the verdict becomes MATERIALISE.
    let firstCall = true;
    world.deps.localFileExists = vi.fn(async () => {
      if (firstCall) {
        firstCall = false;
        return false;
      }
      return false;
    });

    await mirrorSharedCanvases(world.deps);

    expect(
      world.disk(BOARD),
      "the byte comparison did not notice an overwrite - it is not measuring bytes",
    ).not.toBe(before);
  });
});

describe("WP79 AC4 - an empty doc materialises no file", () => {
  it("identity resolves, doc holds no records -> no file, by its own named verdict", async () => {
    const world = createMirrorWorld({
      role: "guest",
      files: {},
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: { [BOARD]: { nodes: [], edges: [] } },
    });
    const report = await mirrorSharedCanvases(world.deps);

    expect(world.disk(BOARD), "an empty or skeleton .canvas was written").toBeUndefined();
    expect(world.writes).toEqual([]);
    expect(report.entries[0]?.verdict).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    expect(report.skippedNoSource).toBe(1);
    expect(report.materialised).toBe(0);
  });

  it("POSITIVE CONTROL: the SAME fixture produces a file once one record exists", async () => {
    // Without this, "no file" is just "no mechanism": an empty-doc test whose
    // doc is empty for the wrong reason (wrong doc id, wrong map names, never
    // populated) passes for a reason that has nothing to do with the criterion.
    const world = createMirrorWorld({
      role: "guest",
      files: {},
      manifestPaths: [BOARD],
      guids: { [BOARD]: GUID },
      peerContent: { [BOARD]: { nodes: [textNode("only-1", 0, "one record")], edges: [] } },
    });
    const report = await mirrorSharedCanvases(world.deps);

    expect(world.disk(BOARD)).toBeTypeOf("string");
    expect(report.materialised).toBe(1);
  });

  it("no resolvable identity -> skip, never a mint and never a fallback", async () => {
    const world = createMirrorWorld({
      role: "guest",
      files: {},
      manifestPaths: [BOARD],
      guids: {},
      peerContent: {},
    });
    const report = await mirrorSharedCanvases(world.deps);

    expect(report.entries[0]?.verdict).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    expect(world.subscribeCalls).toEqual([]);
    expect(world.mintCalls).toEqual([]);
    expect(world.disk(BOARD)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC5 — the mirror is complete, counted and falsifiable.
// ---------------------------------------------------------------------------

describe("WP79 AC5 - a whole folder of canvases, N > 1", () => {
  const A = canvasPath("alpha");
  const B = canvasPath("beta");
  const C = canvasPath("gamma");
  const HELD = canvasPath("already-here");
  const BROKEN = canvasPath("broken");
  const NOTE = `${"_liveshare-test"}/notes.md`;

  function folder(overrides: Record<string, unknown> = {}) {
    return createMirrorWorld({
      role: "guest",
      files: { [HELD]: canvasJson([textNode("h-1", 0, "the guest's own")]) },
      manifestPaths: [A, B, C, HELD, BROKEN, NOTE],
      guids: { [A]: "guid-a", [B]: "guid-b", [C]: "guid-c", [HELD]: "guid-h", [BROKEN]: "guid-x" },
      peerContent: {
        [A]: { nodes: [textNode("a-1", 0, "alpha")], edges: [] },
        [B]: { nodes: [textNode("b-1", 0, "beta")], edges: [] },
        [C]: { nodes: [textNode("c-1", 0, "gamma")], edges: [] },
        [HELD]: { nodes: [textNode("h-9", 0, "host version")], edges: [] },
        [BROKEN]: { nodes: [textNode("x-1", 0, "unreachable")], edges: [] },
      },
      failingSubscribes: [BROKEN],
      ...overrides,
    });
  }

  it("all three missing canvases arrive; the .md is not considered at all", async () => {
    const world = folder();
    for (const path of [A, B, C]) expect(world.disk(path)).toBeUndefined();

    const report = await mirrorSharedCanvases(world.deps);

    expect(report.materialised).toBe(3);
    for (const path of [A, B, C]) expect(world.disk(path)).toBeTypeOf("string");
    expect(report.entries.map((e) => e.path)).not.toContain(NOTE);
    expect(report.considered).toBe(5);
  });

  it("a canvas that must be skipped is skipped BY ITS OWN NAMED VERDICT and is reported", async () => {
    const world = folder();
    const report = await mirrorSharedCanvases(world.deps);

    const held = report.entries.find((e) => e.path === HELD);
    expect(held, "a skipped canvas was dropped silently").toBeDefined();
    expect(held?.verdict).toBe(MIRROR_VERDICT.SKIP_LOCAL_FILE);
    expect(held?.outcome).toBe("skipped");
    expect(report.skippedLocalFile).toBe(1);
  });

  it("a canvas that fails degrades ALONE - the other N-1 still arrive (I5)", async () => {
    const world = folder();
    const report = await mirrorSharedCanvases(world.deps);

    const broken = report.entries.find((e) => e.path === BROKEN);
    expect(broken?.outcome).toBe("failed");
    expect(broken?.reason).toContain("subscribe refused");
    expect(report.failed).toBe(1);
    expect(report.materialised).toBe(3);
    expect(world.disk(BROKEN)).toBeUndefined();
  });

  it("the guest's own canvas is untouched while its neighbours are mirrored", async () => {
    const world = folder();
    const before = world.disk(HELD);
    await mirrorSharedCanvases(world.deps);
    expect(world.disk(HELD)).toBe(before);
  });

  it("INJECTION (iv): the completeness count is not satisfied by an empty lookup", async () => {
    // The vacuity the criterion names by hand: a count of zero satisfies "every
    // canvas that should have arrived, arrived" unless the count is asserted
    // against a NUMBER the fixture fixes. With nothing to look at, every counter
    // is zero — so the assertion `materialised === 3` above cannot be passing on
    // an empty lookup.
    const world = createMirrorWorld({
      role: "guest",
      files: {},
      manifestPaths: [],
      guids: {},
      peerContent: {},
    });
    const report = await mirrorSharedCanvases(world.deps);

    expect(report.considered).toBe(0);
    expect(report.materialised).toBe(0);
    expect(report.entries).toEqual([]);
    expect(report.materialised).not.toBe(3);
  });

  it("INJECTION (iii): emptying every doc leaves the whole folder unmirrored", async () => {
    const world = createMirrorWorld({
      role: "guest",
      files: {},
      manifestPaths: [A, B, C],
      guids: { [A]: "guid-a", [B]: "guid-b", [C]: "guid-c" },
      peerContent: {
        [A]: { nodes: [], edges: [] },
        [B]: { nodes: [], edges: [] },
        [C]: { nodes: [], edges: [] },
      },
    });
    const report = await mirrorSharedCanvases(world.deps);

    expect(report.materialised).toBe(0);
    expect(world.writes).toEqual([]);
    for (const path of [A, B, C]) expect(world.disk(path)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The HOST arm — publish, and NOTHING else.
// ---------------------------------------------------------------------------

describe("WP79 - the host publishes identity and never rewrites its own files", () => {
  const HOST_BOARD = canvasPath("host-board");
  const CONTENT = canvasJson([textNode("hb-1", 0, "the host's board")]);

  function hostWorld() {
    return createMirrorWorld({
      role: "host",
      files: { [HOST_BOARD]: CONTENT },
      manifestPaths: [HOST_BOARD],
      guids: {},
      peerContent: {},
    });
  }

  it("subscribes the canvas so the guid is minted and published", async () => {
    const world = hostWorld();
    expect(world.guids.get(HOST_BOARD)).toBeUndefined();

    const report = await mirrorSharedCanvases(world.deps);

    expect(world.subscribeCalls).toEqual([`host:${HOST_BOARD}`]);
    expect(world.mintCalls).toHaveLength(1);
    expect(world.guids.get(HOST_BOARD)).toBeTypeOf("string");
    expect(report.published).toBe(1);
    expect(report.entries[0]?.verdict).toBe(MIRROR_VERDICT.PUBLISH);
  });

  it("does NOT attach a writer and does NOT touch the host's file", async () => {
    const world = hostWorld();
    await mirrorSharedCanvases(world.deps);

    // AC4 is absolute and does not carve out the host: an existing `.canvas` is
    // never written to, in any branch, under any entry point.
    expect(world.writes).toEqual([]);
    expect(world.disk(HOST_BOARD)).toBe(CONTENT);
    expect(world.coldOpens).toEqual([]);
  });

  it("skips a manifest path the host does not actually hold", async () => {
    const world = createMirrorWorld({
      role: "host",
      files: {},
      manifestPaths: [HOST_BOARD],
      guids: {},
      peerContent: {},
    });
    const report = await mirrorSharedCanvases(world.deps);

    expect(report.entries[0]?.verdict).toBe(MIRROR_VERDICT.SKIP_NO_SOURCE);
    expect(world.subscribeCalls).toEqual([]);
    expect(world.mintCalls).toEqual([]);
  });

  it("is idempotent - a second pass mints nothing and subscribes nothing new", async () => {
    const world = hostWorld();
    await mirrorSharedCanvases(world.deps);
    const mints = world.mintCalls.length;
    const calls = world.subscribeCalls.length;

    await mirrorSharedCanvases(world.deps);

    expect(world.mintCalls.length).toBe(mints);
    expect(world.subscribeCalls.length).toBe(calls);
  });
});

// ---------------------------------------------------------------------------
// Degradation and hygiene.
// ---------------------------------------------------------------------------

describe("WP79 - the pass degrades rather than throws", () => {
  it("an unusable role produces an empty report instead of an exception", async () => {
    const world = guestWorld();
    const report = await mirrorSharedCanvases({
      ...world.deps,
      role: "spectator" as unknown as "guest",
    });
    expect(report.considered).toBe(0);
    expect(world.disk(BOARD)).toBeUndefined();
  });

  it("a manifest that throws does not take the session down", async () => {
    const world = guestWorld();
    const report = await mirrorSharedCanvases({
      ...world.deps,
      listManifestPaths: () => {
        throw new Error("manifest not connected");
      },
    });
    expect(report.considered).toBe(0);
  });

  it("only .canvas paths are considered - the selector is not a text-file test", async () => {
    const world = createMirrorWorld({
      role: "guest",
      files: {},
      manifestPaths: ["_liveshare-test/a.md", "_liveshare-test/b.json", "_liveshare-test/c.canvas"],
      guids: { "_liveshare-test/c.canvas": "guid-c" },
      peerContent: {
        "_liveshare-test/c.canvas": { nodes: [textNode("c-1", 0, "c")], edges: [] },
      },
    });
    const report = await mirrorSharedCanvases(world.deps);
    expect(report.entries.map((e) => e.path)).toEqual(["_liveshare-test/c.canvas"]);
  });
});
