// WP117 / A1, A2, A6, A8 — a guest creates a canvas and it becomes real for
// every peer, byte for byte, with the originating guest converged onto the
// HOST'S document rather than keeping a private copy.
//
// THE ORACLE IS WP116'S, AND IT TAKES AN EXPECTATION. `judgeConvergence` is the
// only green verdict available and it is unreachable without one, so this file
// never scores convergence by comparing the three peers to each other — that
// oracle passed `S119` while every note in the vault was being destroyed. The
// expectation's `origin` names the gesture that produced the bytes: the fixture
// this test planted on the originating guest before anything was sent.
//
// EVERYTHING IS SCORED ON DISK BYTES (S138). `canvas.mirror` reports the last
// completed pass rather than the current state, so a verdict is read here as
// evidence about the DECISION and never as evidence about the file.
//
// PRODUCTION LINES <-> ASSERTIONS:
//   `CanvasCreateCoordinator.requestCreate` / `.handleRequest` / `.handleResult`
//   `decideCanvasCreate`            — the host's validation
//   `CanvasSync.subscribe(_, "host")` — the mint, the bind and the seed
//   `decideCanvasMirror`            — `adopt-local-file` vs `materialise`
//   `CanvasPersistence.coldOpen`    — `doc-wins` on both receiving peers

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { MIRROR_VERDICT } from "../../../files/canvas-mirror-decision";
import {
  CONVERGENCE_VERDICT,
  judgeConvergence,
} from "../../../testing/e2e-control";
import {
  type World,
  canvasJson,
  canvasPath,
  createWorld,
  edge,
  readFile,
  settle,
  textNode,
} from "./harness";

const PATH = canvasPath("plan");

// The fixture, and it is the EXTERNAL REFERENCE POINT for the oracle below. It
// is written down here, before anything is sent, and never read back off a peer.
const NODE_A = "wp117-a";
const NODE_B = "wp117-b";
const EDGE_AB = "wp117-e";
const AUTHORED = canvasJson(
  [textNode(NODE_A, 0, "authored on the guest"), textNode(NODE_B, 400, "second card")],
  [edge(EDGE_AB, NODE_A, NODE_B)],
);

/** One card, written into a doc exactly the way `CanvasSync` writes records. */
function addCard(doc: Y.Doc, id: string, x: number, text: string): void {
  doc.transact(() => {
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set(id, record);
    for (const [k, v] of Object.entries(textNode(id, x, text))) record.set(k, v);
  });
}

async function threePeerWorld(originatorFiles: Record<string, string>): Promise<World> {
  const world = await createWorld();
  await world.add({ id: "host", role: "host" });
  await world.add({ id: "g1", role: "guest", files: originatorFiles });
  await world.add({ id: "g2", role: "guest" });
  return world;
}

/** Run the whole gesture: g1 asks, the host answers, both guests mirror. */
async function runCreation(world: World, path: string): Promise<void> {
  const g1 = world.peer("g1");
  await g1.coordinator.requestCreate(path);
  await settle();
  // The manifest change every peer would be woken by in production. Here the
  // passes are driven explicitly so their ORDER is part of the test rather than
  // an accident of scheduling.
  await world.peer("g1").mirror();
  await world.peer("g2").mirror();
  await settle();
  for (const peer of world.peers.values()) {
    // Flush the debounced writer, the same way a settled burst would.
    peer.scheduler.runAll();
  }
  await settle();
}

describe("WP117 A1 — the canvas reaches every peer", () => {
  it("host, originating guest and third guest all hold the same bytes, judged against the gesture", async () => {
    const world = await threePeerWorld({ [PATH]: AUTHORED });
    const host = world.peer("host");
    const g1 = world.peer("g1");
    const g2 = world.peer("g2");

    // PRE-CONDITION, and it is the S122 shape: only the originator has it.
    expect(host.disk(PATH)).toBeUndefined();
    expect(g2.disk(PATH)).toBeUndefined();

    await runCreation(world, PATH);

    // 1. THE HOST ACTED, and the request was validated rather than trusted.
    expect(host.coordinator.getStats().decided.materialise).toBe(1);
    expect(host.coordinator.getStats().materialised).toBe(1);

    // 2. THE IDENTITY IS THE HOST'S MINT, published in the manifest and resolved
    //    by both guests. A guest never mints, so a guid the guests can read is
    //    proof the host minted it.
    const guid = host.manifest.getCanvasGuid(PATH);
    expect(guid, "the host did not mint a guid for the new canvas").toBeTruthy();
    expect(g1.manifest.getCanvasGuid(PATH)).toBe(guid);
    expect(g2.manifest.getCanvasGuid(PATH)).toBe(guid);

    // 3. THE BYTES. Judged with WP116's oracle against an expectation whose
    //    origin is this file's fixture — never a reading taken off a peer.
    const readings = [
      await readFile(host, PATH),
      await readFile(g1, PATH),
      await readFile(g2, PATH),
    ];
    const judgement = judgeConvergence(readings, {
      origin:
        "the canvas this test planted on g1's disk before any frame was sent: two text " +
        "nodes and one edge, written down in this file as AUTHORED",
      exists: true,
      contains: [NODE_A, NODE_B, EDGE_AB, "authored on the guest", "second card"],
      atLeastBytes: 100,
    });
    expect(judgement.verdict, judgement.reason).toBe(CONVERGENCE_VERDICT.CONVERGED);
    expect(judgement.converged).toBe(true);
    expect(judgement.violations).toEqual([]);

    world.peers.forEach((p) => p.destroy());
  });

  it("the third guest MATERIALISED and the originator ADOPTED — two different acts", async () => {
    const world = await threePeerWorld({ [PATH]: AUTHORED });
    await runCreation(world, PATH);

    const g1 = world.peer("g1");
    const g2 = world.peer("g2");

    const g1Entry = g1.lastMirror?.entries.find((e) => e.path === PATH);
    const g2Entry = g2.lastMirror?.entries.find((e) => e.path === PATH);

    // A6 — the originating guest's local file already exists, so `skip-local-file`
    // would be the pre-WP117 verdict and would leave it holding a private copy.
    expect(g1Entry?.verdict).toBe(MIRROR_VERDICT.ADOPT_LOCAL_FILE);
    expect(g1Entry?.outcome).toBe("adopted");
    expect(g1.lastMirror?.adopted).toBe(1);
    expect(g1.lastMirror?.skippedLocalFile).toBe(0);

    // …and the third guest, which never had the file, takes the ordinary route.
    expect(g2Entry?.verdict).toBe(MIRROR_VERDICT.MATERIALISE);
    expect(g2Entry?.outcome).toBe("materialised");
    expect(g2.lastMirror?.materialised).toBe(1);
    expect(g2.lastMirror?.adopted).toBe(0);

    world.peers.forEach((p) => p.destroy());
  });

  it("the adoption is ONE-SHOT: a second pass over the same path is an ordinary skip", async () => {
    const world = await threePeerWorld({ [PATH]: AUTHORED });
    await runCreation(world, PATH);
    const g1 = world.peer("g1");
    expect(g1.coordinator.getStats().adoptionsArmed).toBe(1);
    expect(g1.coordinator.getStats().adoptionsCleared).toBe(1);

    const before = g1.disk(PATH);
    const second = await g1.mirror();
    expect(second.entries.find((e) => e.path === PATH)?.verdict).toBe(
      MIRROR_VERDICT.SKIP_LOCAL_FILE,
    );
    expect(second.adopted).toBe(0);
    // …and the file is untouched by the skip. Scored on bytes (S138).
    expect(g1.disk(PATH)).toBe(before);

    world.peers.forEach((p) => p.destroy());
  });
});

describe("WP117 A6 — the originating guest is on the HOST'S document, not its own", () => {
  it("a host-side edit after the creation reaches the originator's disk", async () => {
    const world = await threePeerWorld({ [PATH]: AUTHORED });
    await runCreation(world, PATH);
    const host = world.peer("host");
    const g1 = world.peer("g1");
    const g2 = world.peer("g2");

    // The strongest available oracle for "it adopted rather than kept a copy":
    // change the HOST's document and watch the originator's FILE follow. A guest
    // holding a private replica cannot pass this row however byte-identical its
    // file was a moment ago.
    const hostDoc = host.docFor(PATH);
    expect(hostDoc).not.toBeNull();
    // Written through the same shape `CanvasSync` writes records in: a `Y.Map`
    // per record inside the `nodes` map, one transaction.
    addCard(hostDoc as Y.Doc, "wp117-host-card", 800, "added by the host");
    await settle();
    for (const peer of world.peers.values()) peer.scheduler.runAll();
    await settle();

    expect(g1.disk(PATH), "the originator's file did not follow the host's edit").toContain(
      "added by the host",
    );
    expect(g2.disk(PATH)).toContain("added by the host");
    expect(host.disk(PATH)).toContain("added by the host");

    world.peers.forEach((p) => p.destroy());
  });
});

describe("WP117 A2 — IMPORT is covered by the same door", () => {
  it("a canvas authored elsewhere and dropped into the shared folder reaches every peer", async () => {
    // The distinction between "new" and "imported" is not a branch in this
    // plugin: both raise one vault `create` carrying the file's bytes. What is
    // different about an import is that the bytes are somebody ELSE's — many
    // records, unknown ids, formatting this vault did not produce — so that is
    // what this row plants.
    const IMPORTED_PATH = canvasPath("imported-board");
    const nodes = Array.from({ length: 40 }, (_, i) =>
      textNode(`imported-${i}`, i * 250, `imported card ${i}`),
    );
    const edges = Array.from({ length: 20 }, (_, i) =>
      edge(`imported-edge-${i}`, `imported-${i}`, `imported-${i + 1}`),
    );
    // Pretty-printed with a different key order, the way an external tool emits.
    const imported = JSON.stringify({ edges, nodes }, null, 2);

    const world = await threePeerWorld({ [IMPORTED_PATH]: imported });
    await runCreation(world, IMPORTED_PATH);

    const readings = [
      await readFile(world.peer("host"), IMPORTED_PATH),
      await readFile(world.peer("g1"), IMPORTED_PATH),
      await readFile(world.peer("g2"), IMPORTED_PATH),
    ];
    const judgement = judgeConvergence(readings, {
      origin:
        "the 40-node/20-edge board this test planted on g1's disk, pretty-printed with a " +
        "foreign key order, before any frame was sent",
      exists: true,
      contains: ["imported-0", "imported-39", "imported-edge-19", "imported card 17"],
      atLeastBytes: 1000,
    });
    expect(judgement.verdict, judgement.reason).toBe(CONVERGENCE_VERDICT.CONVERGED);

    world.peers.forEach((p) => p.destroy());
  });
});

describe("WP117 A1 — the RESIDUAL, pinned so it is a known behaviour and not a surprise", () => {
  it("an EMPTY canvas reaches the host but not a third peer, until it holds a record", async () => {
    // Obsidian's "New canvas" creates a file with NO records. The host
    // materialises it — the file is there, the manifest names it, the guid is
    // minted, and the originating guest is on the host's document. The THIRD
    // peer does not get a file, because `decideCanvasMirror` refuses to
    // materialise from a doc with no records, and that refusal is DELIBERATE and
    // is not WP117's to reopen: "an empty doc materialises no file — never an
    // empty or skeleton `.canvas` — because an empty file that then wins a
    // reconcile is how the E2 cascade destroyed user data."
    //
    // The first card the user drops on the board closes it, which the second
    // half of this row measures. Recorded here rather than in prose alone so a
    // later change to the empty-doc rule reddens something.
    const EMPTY_PATH = canvasPath("brand-new");
    const world = await threePeerWorld({ [EMPTY_PATH]: JSON.stringify({ nodes: [], edges: [] }) });
    await runCreation(world, EMPTY_PATH);

    const host = world.peer("host");
    const g1 = world.peer("g1");
    const g2 = world.peer("g2");

    expect(host.disk(EMPTY_PATH), "the host did not materialise the empty canvas").toBeDefined();
    expect(host.manifest.getCanvasGuid(EMPTY_PATH)).toBeTruthy();
    expect(g1.coordinator.getStats().accepted).toBe(1);
    // The named limitation, and it is named by its own verdict.
    expect(g2.lastMirror?.entries.find((e) => e.path === EMPTY_PATH)?.verdict).toBe(
      MIRROR_VERDICT.SKIP_NO_SOURCE,
    );
    expect(g2.disk(EMPTY_PATH)).toBeUndefined();
    // I11: nothing was destroyed anywhere by the skip.
    expect(g1.disk(EMPTY_PATH)).toBeDefined();

    // …and the first record closes it. Written into the HOST's document, the
    // way the originating guest's first card would arrive.
    addCard(host.docFor(EMPTY_PATH) as Y.Doc, "first-card", 0, "the first card");
    await settle();
    await g2.mirror();
    await settle();
    for (const peer of world.peers.values()) peer.scheduler.runAll();
    await settle();

    expect(g2.disk(EMPTY_PATH)).toContain("the first card");

    world.peers.forEach((p) => p.destroy());
  });
});

describe("WP117 A8 — the three invariants, asserted rather than assumed", () => {
  it("WP83: no `.canvas` byte ever travels as a file-op or a chunk — one structured frame only", async () => {
    const world = await threePeerWorld({ [PATH]: AUTHORED });
    await runCreation(world, PATH);

    const types = world.bus.frames.map((f) => String(f.message.type));
    // The handoff is ONE request and ONE result, and nothing else went on the
    // wire. A `file-op` or a `file-chunk-*` carrying this path would be WP83's
    // raw character-merge door, reopened.
    expect(types).toEqual(["canvas-create-request", "canvas-create-result"]);
    expect(types).not.toContain("file-op");
    expect(world.bus.framesOfType("canvas-create-request")).toHaveLength(1);

    world.peers.forEach((p) => p.destroy());
  });

  it("host-only manifest authority: a guest that RECEIVES the request refuses before the write", async () => {
    // ── PREMISE CORRECTION, and it is in the charter and the spec ───────────
    //
    // Both name the first of the three doors as "manifest `updateFile` refuses
    // non-hosts". IT DOES NOT. `ManifestManager.updateFile` has no role test at
    // all — its only guards are `this.manifest` and `isSharedPath`. The
    // `role === "host"` gate is at the CALL SITES (`files/vault-events.ts`, the
    // create / modify / delete arms). Measured, not argued: the row below calls
    // a guest's `updateFile` directly and the entry lands.
    //
    // The invariant itself is untouched — no guest CALLS it — but the guard is
    // one layer further out than the documents say, which matters for anything
    // that adds a new caller. This feature adds one, and it is on the host.
    const world = await threePeerWorld({ [PATH]: AUTHORED });
    const g1 = world.peer("g1");

    const guestFile = g1.vault.getAbstractFileByPath(PATH);
    await g1.manifest.updateFile(guestFile as never, AUTHORED);
    expect(
      g1.manifest.getEntries().has(PATH),
      "the premise correction above is stale: `updateFile` now refuses a guest",
    ).toBe(true);
    g1.manifest.removeFile(PATH);

    // ── THE INVARIANT AS IT ACTUALLY HOLDS ──────────────────────────────────
    //
    // Every peer receives the broadcast request. The guest that receives
    // ANOTHER guest's request must decide `not-host` — the branch that returns
    // before `publishManifestEntry` is reachable — and it must answer nothing,
    // because a second answer on the wire is a second authority.
    await runCreation(world, PATH);

    const g2 = world.peer("g2");
    expect(g2.coordinator.getStats().received).toBe(1);
    expect(g2.coordinator.getStats().decided["refuse-not-host"]).toBe(1);
    expect(g2.coordinator.getStats().materialised).toBe(0);
    // …and the do-nothing branch is COUNTED rather than silent (S155): the two
    // numbers above are what distinguish "declined" from "never delivered".
    expect(world.bus.framesOfType("canvas-create-result")).toHaveLength(1);
    expect(world.bus.frames.filter((f) => f.from !== "host" && f.from !== "g1")).toHaveLength(0);

    // The identity every peer reads is the host's mint.
    const guid = world.peer("host").manifest.getCanvasGuid(PATH);
    expect(guid).toBeTruthy();
    expect(g2.manifest.getCanvasGuid(PATH)).toBe(guid);

    world.peers.forEach((p) => p.destroy());
  });

  it("single writer: exactly one peer seeded, and it is the host", async () => {
    const world = await threePeerWorld({ [PATH]: AUTHORED });
    await runCreation(world, PATH);

    // Every peer's cold open is observable through the writer it attached. The
    // host seeded (through `subscribe`'s host arm), and BOTH guests reached
    // `doc-wins` — the branch that never reads a file.
    for (const id of ["g1", "g2"]) {
      const peer = world.peer(id);
      expect(peer.writers.has(PATH), `${id} never attached a writer`).toBe(true);
    }
    // The residual's own condition, asserted here as a property of the run
    // rather than left to tp05: no guest is permitted to seed at all.
    for (const id of ["g1", "g2"]) {
      const peer = world.peer(id);
      const knowledge = { ...peer.canvasSync.seedKnowledgeFor(PATH), role: "guest" as const };
      const { explainSeed, SEED_DECISION } = await import(
        "../../../files/canvas-seed-decision"
      );
      expect(explainSeed(knowledge).decision).toBe(SEED_DECISION.LOAD_OR_MERGE);
    }

    world.peers.forEach((p) => p.destroy());
  });
});
