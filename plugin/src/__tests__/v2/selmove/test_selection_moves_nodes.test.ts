// INVESTIGATION — "selecting cards on client 1 makes other cards jump on client 2".
//
// This file is EVIDENCE, not a fix. It drives the shipped code and measures what a
// pure, read-only SELECT gesture does to a peer.
//
// The chain under measurement, entirely in production code:
//
//   canvas-adapter.ts:874     patch("updateSelection", () => emitHeld(readSelectionIds()))
//   canvas-presence.ts:320    onNodeInteractionStart(id => acquireLock(id))
//   canvas-presence.ts:344    acquireLock -> lockedNodes[id] -> emitLocalState()  [AWARENESS WRITE]
//   canvas-presence.ts:307    peer's awareness "change" listener -> reconcileClaims()
//   canvas-presence.ts:372    reconcileClaims: a LOWER clientID co-holder => onRevert(nodeId)
//   main.ts:3896              onRevert -> revertCanvasNode(path, nodeId, awareness)
//   main.ts:3930              revertCanvasNode -> reconcileLiveCanvas(path, snapshot, {initial:true})
//   reconcile-plan.ts:166     initial === true => plan "structural", unconditionally
//   main.ts:3179              structural => adapter.reloadCanvasData(WHOLE BOARD) -> canvas.setData
//
// So the TRIGGER is one node and the EFFECT is the entire board. That is the shape
// of the report: the user selects, and cards they never touched move.
//
// VACUITY GUARDS (every row that must be able to go red has a control that does):
//   * T1 has a NEGATIVE control (peer B holds the lowest id => no revert) and an
//     UNRELATED-NODE control (a select of a node nobody contests => no revert).
//   * T1 also asserts the gesture wrote NOTHING locally (no setData, no requestSave),
//     so "read-only" is measured rather than assumed.
//   * T2 has a NO-SNAPSHOT control (nothing to revert to => the view is untouched)
//     and a NON-AUTHORITATIVE control (the same pass without `initial` is a noop and
//     moves nothing), so the board-wide movement is attributable to the `initial:true`
//     that `revertCanvasNode` passes and not to the harness.
//   * T3's leak row is paired with the release row that DOES work, so "locks are
//     never released" cannot pass by accident.
//
// WHAT THIS FILE CANNOT SETTLE: whether Obsidian's own renderer re-routes the arrows
// after the cards move. The CanvasDouble has no renderer. See the report.

import { describe, expect, it, vi } from "vitest";

// `main.ts` pulls in `Menu`, `requestUrl` and `FuzzySuggestModal` at module scope;
// the shared Obsidian double does not export them. Same local supplement as
// `v2/wp85/test_tp02_sync_canvas_presences_attach_seam.test.ts`.
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  class Stub {
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    constructor(..._args: any[]) {}
    open() {}
    close() {}
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    addItem(_cb: any) {
      return this;
    }
    // biome-ignore lint/suspicious/noExplicitAny: a test double for an untyped Obsidian class
    showAtMouseEvent(_e: any) {}
  }
  return {
    ...actual,
    Menu: Stub,
    FuzzySuggestModal: Stub,
    SuggestModal: Stub,
    requestUrl: async () => ({ status: 200, json: {}, text: "" }),
    setIcon: () => {},
    addIcon: () => {},
  };
});

import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import { createEditingDeferralQueue } from "../../../canvas/canvas-editing-deferral";
import { type AwarenessLike, CanvasPresence } from "../../../canvas/canvas-presence";
import { advanceField, createSurfaceShadow } from "../../../canvas/canvas-shadow";
import { createSurfaceStateStore } from "../../../canvas/canvas-shadow";
import LiveSharePlugin from "../../../main";
import { CanvasDouble, type DoubleNodeRecord } from "../../harness/canvas-double";
import { InteractionDriver } from "../../harness/interaction-driver";

const PATH = "_liveshare-test/board.canvas";

const BOARD: DoubleNodeRecord[] = [
  { id: "n1", x: 0, y: 0, width: 200, height: 100, type: "text", text: "one" },
  { id: "n2", x: 400, y: 0, width: 200, height: 100, type: "text", text: "two" },
  { id: "n3", x: 0, y: 300, width: 200, height: 100, type: "text", text: "three" },
];
const EDGES = [{ id: "e1", fromNode: "n1", toNode: "n3" }];

/**
 * One shared awareness "wire" — several `CanvasPresence` instances contend over the
 * same states map exactly as peers do. Lifted from `canvas-presence.test.ts`.
 */
function makeNetwork() {
  const states = new Map<number, Record<string, unknown>>();
  const listeners: Array<() => void> = [];
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  return {
    states,
    client(clientID: number): AwarenessLike {
      return {
        clientID,
        getLocalState: () => states.get(clientID) ?? null,
        setLocalState: (s: Record<string, unknown> | null) => {
          if (s === null) states.delete(clientID);
          else states.set(clientID, s);
          notify();
        },
        getStates: () => states,
        on: (_e, cb) => {
          listeners.push(cb);
        },
        off: (_e, cb) => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
  };
}

interface Peer {
  double: CanvasDouble;
  driver: InteractionDriver;
  presence: CanvasPresence;
  reverted: string[];
}

function makePeer(
  net: ReturnType<typeof makeNetwork>,
  clientID: number,
  name: string,
): Peer {
  const double = new CanvasDouble({ nodes: BOARD, edges: EDGES });
  const adapter = createCanvasAdapter(double.view);
  const reverted: string[] = [];
  const presence = new CanvasPresence({
    path: PATH,
    awareness: net.client(clientID),
    identity: { clientId: clientID, name, color: "#abc" },
    adapter,
    onRevert: (nodeId) => reverted.push(nodeId),
    showCursors: false,
    showPresence: false,
  });
  presence.start();
  return { double, driver: new InteractionDriver(double), presence, reverted };
}

// ---------------------------------------------------------------------------
// T1 — A PURE SELECT ON PEER A REACHES PEER B'S MUTATION PATH.
// ---------------------------------------------------------------------------

describe("T1: a read-only selection is a peer-visible event", () => {
  it("peer A merely SELECTS a card and peer B's loser-revert fires for it", () => {
    const net = makeNetwork();
    // A holds the LOWER clientID, so B is the loser of the GAP-1 tiebreak.
    const a = makePeer(net, 1, "A");
    const b = makePeer(net, 2, "B");

    // B holds a DIFF-INFERRED lock on n2. This is the production seam: every node
    // a local capture upserts calls `onLocalNodeChange` (canvas-sync.ts:4130),
    // which main.ts:2505 forwards to exactly this method.
    b.presence.onDiffInferredChange("n2");
    expect(b.presence.isLockedByMe("n2")).toBe(true);
    expect(b.reverted).toEqual([]);

    // THE GESTURE. Nothing but a selection: the driver sets `canvas.selection` and
    // calls `canvas.updateSelection()`, which is what Obsidian does when the user
    // clicks a card.
    a.driver.select(["n2"]);

    // The gesture itself wrote nothing on A — it is genuinely read-only locally.
    expect(a.double.setDataCount).toBe(0);
    expect(a.double.requestSaveCount).toBe(0);
    expect(a.double.getNode("n2")?.x).toBe(400);

    // ...and yet it reached B's revert path.
    expect(b.reverted).toEqual(["n2"]);
  });

  it("NEGATIVE CONTROL: with B on the lower id the same select reverts nothing", () => {
    const net = makeNetwork();
    // Only the ids are swapped. Everything else is byte-identical to the row above.
    const a = makePeer(net, 2, "A");
    const b = makePeer(net, 1, "B");

    b.presence.onDiffInferredChange("n2");
    a.driver.select(["n2"]);

    expect(b.reverted).toEqual([]);
  });

  it("CONTROL: selecting a card B does not hold reverts nothing", () => {
    const net = makeNetwork();
    const a = makePeer(net, 1, "A");
    const b = makePeer(net, 2, "B");

    b.presence.onDiffInferredChange("n2");
    a.driver.select(["n1"]);

    expect(b.reverted).toEqual([]);
  });

  it("a MULTI-select reverts every contested card in one gesture", () => {
    const net = makeNetwork();
    const a = makePeer(net, 1, "A");
    const b = makePeer(net, 2, "B");

    b.presence.onDiffInferredChange("n1");
    b.presence.onDiffInferredChange("n2");
    b.presence.onDiffInferredChange("n3");

    a.driver.select(["n1", "n3"]);

    expect(b.reverted.sort()).toEqual(["n1", "n3"]);
  });
});

// ---------------------------------------------------------------------------
// T2 — THE REVERT IS PER-NODE IN ITS TRIGGER AND BOARD-WIDE IN ITS EFFECT.
//
// The real `revertCanvasNode` and the real `reconcileLiveCanvas` are invoked off
// `LiveSharePlugin.prototype` with a fake `this` (the `v2/wp85` precedent), so the
// code under measurement is the shipped code, byte for byte.
// ---------------------------------------------------------------------------

interface ReconcileHarness {
  // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  fake: any;
  double: CanvasDouble;
}

function makeReconcileHarness(opts: {
  snapshot: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null;
  /** Seed the Surface-Shadow with these node records (what we last applied). */
  shadowNodes?: Record<string, unknown>[];
  shadowEdges?: Record<string, unknown>[];
}): ReconcileHarness {
  const double = new CanvasDouble({ nodes: BOARD, edges: EDGES });
  const adapter = createCanvasAdapter(double.view);
  const canvasAdapters = new Map([[PATH, adapter]]);

  const shadow = createSurfaceShadow();
  for (const rec of opts.shadowNodes ?? []) {
    for (const [field, value] of Object.entries(rec)) {
      if (field === "id") continue;
      advanceField(shadow, PATH, "node", String(rec.id), field, value as never);
    }
  }
  for (const rec of opts.shadowEdges ?? []) {
    for (const [field, value] of Object.entries(rec)) {
      if (field === "id") continue;
      advanceField(shadow, PATH, "edge", String(rec.id), field, value as never);
    }
  }

  const fake = {
    canvasAdapters,
    canvasDeferrals: createEditingDeferralQueue(),
    surfaceState: createSurfaceStateStore(
      (p: string) => canvasAdapters.get(p)?.isAvailable() === true,
    ),
    canvasSync: {
      getSurfaceShadow: () => shadow,
      getCanvasSnapshot: () => opts.snapshot,
    },
    fileOpsManager: {
      mutePathEvents: () => {},
      armMuteRelease: () => {},
    },
    settings: { useCanvasBinding: false },
    logger: { debug: () => {}, warn: () => {}, log: () => {}, error: () => {} },
    // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  } as any;
  // `revertCanvasNode` calls `this.reconcileLiveCanvas(...)`, so the real method has
  // to be reachable on the fake. Both come off the prototype; neither is re-written.
  fake.reconcileLiveCanvas = (
    LiveSharePlugin.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
  ).reconcileLiveCanvas.bind(fake);
  fake.revertCanvasNode = (
    LiveSharePlugin.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
  ).revertCanvasNode.bind(fake);

  return { fake, double };
}

const AWARENESS_STUB = {
  clientID: 1,
  getStates: () => new Map<number, Record<string, unknown>>(),
} as unknown as AwarenessLike;

describe("T2: one contested node re-lays out the whole board", () => {
  it("reverting n2 moves n1 and n3 — cards the revert was never about", () => {
    // Shared truth disagrees with the live view about n1 and n3. n2 — the ONLY node
    // the revert names — is at the same place in both.
    const snapshot = {
      nodes: [
        { id: "n1", x: -900, y: -700, width: 200, height: 100, type: "text", text: "one" },
        { id: "n2", x: 400, y: 0, width: 200, height: 100, type: "text", text: "two" },
        { id: "n3", x: 1500, y: 900, width: 200, height: 100, type: "text", text: "three" },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n3" }],
    };
    const { fake, double } = makeReconcileHarness({ snapshot });

    expect(double.getNode("n1")?.x).toBe(0);
    expect(double.getNode("n3")?.y).toBe(300);

    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);

    // The named node did not move. Two cards nobody contested did.
    expect(double.getNode("n2")?.x).toBe(400);
    expect(double.getNode("n1")?.x).toBe(-900);
    expect(double.getNode("n1")?.y).toBe(-700);
    expect(double.getNode("n3")?.x).toBe(1500);
    expect(double.getNode("n3")?.y).toBe(900);

    // ...and it happened through ONE whole-board setData, not a per-node move.
    expect(double.setDataCount).toBe(1);
    const handed = double.lastSetData as { nodes: unknown[]; edges: unknown[] };
    expect(handed.nodes).toHaveLength(3);
  });

  it("CONTROL: no shared snapshot => the view is left untouched", () => {
    const { fake, double } = makeReconcileHarness({ snapshot: null });
    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);
    expect(double.setDataCount).toBe(0);
    expect(double.getNode("n1")?.x).toBe(0);
    expect(double.getNode("n3")?.y).toBe(300);
  });

  it("CONTROL: the SAME data without `initial` is a noop and moves nothing", () => {
    // Identical world, except the pass is an ordinary remote-delta reconcile whose
    // desired data already matches the view. This is what proves the movement above
    // is caused by the authoritative `initial: true` that `revertCanvasNode` passes.
    const live = [
      { id: "n1", x: 0, y: 0, width: 200, height: 100, type: "text", text: "one" },
      { id: "n2", x: 400, y: 0, width: 200, height: 100, type: "text", text: "two" },
      { id: "n3", x: 0, y: 300, width: 200, height: 100, type: "text", text: "three" },
    ];
    const edges = [{ id: "e1", fromNode: "n1", toNode: "n3" }];
    const { fake, double } = makeReconcileHarness({
      snapshot: { nodes: live, edges },
      shadowNodes: live,
      shadowEdges: edges,
    });

    fake.reconcileLiveCanvas(PATH, { nodes: live, edges });

    expect(double.setDataCount).toBe(0);
    expect(double.getNode("n1")?.x).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T3 — WHY IT IS "EVERY TIME" RATHER THAN "SOMETIMES": the diff-inferred lock is
// acquired by the capture path and there is NO path that releases it.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// T4 — THE DEFECT, END TO END, AS A TEST THAT IS RED TODAY.
//
// Both halves are production code and they are joined at the seam `main.ts` joins
// them at (`onRevert: nodeId => this.revertCanvasNode(...)`, main.ts:3896). Peer A
// makes ONE read-only gesture; peer B's board is measured before and after.
//
// `it.fails` is used deliberately. The assertion inside is the CORRECT behaviour
// and it genuinely fails on this tree, so this row is a red measurement — but it
// does not wedge the shared gate for other workers. When the defect is fixed this
// row goes RED by itself and whoever fixed it flips `it.fails` back to `it`.
// ---------------------------------------------------------------------------

describe("T4: selecting on peer A moves cards on peer B (RED — the defect)", () => {
  function wire() {
    const net = makeNetwork();

    // Peer A: a plain peer with the LOWER clientID.
    const a = makePeer(net, 1, "A");

    // Peer B: a real adapter over a real double, and the REAL revert wired to it.
    const bDouble = new CanvasDouble({ nodes: BOARD, edges: EDGES });
    const bAdapter = createCanvasAdapter(bDouble.view);
    const canvasAdapters = new Map([[PATH, bAdapter]]);
    // Shared truth disagrees with B's view about n1 and n3 — the ordinary state of
    // a board whose peer has moved cards B has not applied yet. n2, the card A is
    // about to click, agrees.
    const snapshot = {
      nodes: [
        { id: "n1", x: -900, y: -700, width: 200, height: 100, type: "text", text: "one" },
        { id: "n2", x: 400, y: 0, width: 200, height: 100, type: "text", text: "two" },
        { id: "n3", x: 1500, y: 900, width: 200, height: 100, type: "text", text: "three" },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n3" }],
    };
    const shadow = createSurfaceShadow();
    const fake = {
      canvasAdapters,
      canvasDeferrals: createEditingDeferralQueue(),
      surfaceState: createSurfaceStateStore(
        (p: string) => canvasAdapters.get(p)?.isAvailable() === true,
      ),
      canvasSync: { getSurfaceShadow: () => shadow, getCanvasSnapshot: () => snapshot },
      fileOpsManager: { mutePathEvents: () => {}, armMuteRelease: () => {} },
      settings: { useCanvasBinding: false },
      logger: { debug: () => {}, warn: () => {}, log: () => {}, error: () => {} },
      // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
    } as any;
    fake.reconcileLiveCanvas = (
      LiveSharePlugin.prototype as unknown as Record<string, (...x: unknown[]) => unknown>
    ).reconcileLiveCanvas.bind(fake);
    fake.revertCanvasNode = (
      LiveSharePlugin.prototype as unknown as Record<string, (...x: unknown[]) => unknown>
    ).revertCanvasNode.bind(fake);

    const bAwareness = net.client(2);
    const bPresence = new CanvasPresence({
      path: PATH,
      awareness: bAwareness,
      identity: { clientId: 2, name: "B", color: "#def" },
      adapter: bAdapter,
      // THE PRODUCTION SEAM, main.ts:3896.
      onRevert: (nodeId: string) => fake.revertCanvasNode(PATH, nodeId, bAwareness),
      showCursors: false,
      showPresence: false,
    });
    bPresence.start();

    // B's capture path has claimed n2 at some earlier point (canvas-sync.ts:4130).
    bPresence.onDiffInferredChange("n2");

    return { a, bDouble, bPresence };
  }

  it("SANITY: the world is wired and B's board starts where it started", () => {
    // Without this row the `it.fails` below could pass for the wrong reason — e.g.
    // an exception in the wiring rather than the defect.
    const { bDouble } = wire();
    expect(bDouble.getNode("n1")?.x).toBe(0);
    expect(bDouble.getNode("n3")?.y).toBe(300);
    expect(bDouble.setDataCount).toBe(0);
  });

  it.fails("a read-only selection on peer A must not move any card on peer B", () => {
    const { a, bDouble } = wire();

    // ONE gesture. No edit, no drag, no save, no doc write.
    a.driver.select(["n2"]);

    // What the owner should see: nothing moved on the other client.
    expect(bDouble.setDataCount).toBe(0);
    expect(bDouble.getNode("n1")?.x).toBe(0);
    expect(bDouble.getNode("n1")?.y).toBe(0);
    expect(bDouble.getNode("n3")?.x).toBe(0);
    expect(bDouble.getNode("n3")?.y).toBe(300);
  });

  it("WITNESS: the same gesture, measured positively — B's cards DID move", () => {
    // The other side of the `it.fails` row, so the failure above is attributable to
    // this movement and not to any other assertion in it.
    const { a, bDouble } = wire();

    a.driver.select(["n2"]);

    expect(bDouble.setDataCount).toBe(1);
    expect(bDouble.getNode("n1")?.x).toBe(-900);
    expect(bDouble.getNode("n3")?.y).toBe(900);
    // The card that WAS clicked is the one card that did not move.
    expect(bDouble.getNode("n2")?.x).toBe(400);
  });
});

describe("T3: a diff-inferred lock has no release", () => {
  it("a selection-acquired lock IS released when the selection is dropped", () => {
    // The control. This is the release path that works, and it is what makes the
    // leak row below a measurement rather than a tautology.
    const net = makeNetwork();
    const b = makePeer(net, 2, "B");

    b.driver.select(["n2"]);
    expect(b.presence.isLockedByMe("n2")).toBe(true);

    b.driver.select([]);
    expect(b.presence.isLockedByMe("n2")).toBe(false);
  });

  it("a DIFF-INFERRED lock survives everything except a later select of that same card", () => {
    const net = makeNetwork();
    const b = makePeer(net, 2, "B");

    // The capture path claimed it (main.ts:2505 <- canvas-sync.ts:4130). The user
    // made no gesture on n2 at all — a capture pass upserted the record.
    b.presence.onDiffInferredChange("n2");
    expect(b.presence.isLockedByMe("n2")).toBe(true);

    // Everything a user can do that is NOT "select n2 and then deselect it".
    b.driver.select(["n1"]);
    b.driver.select([]);
    b.driver.driveDrag("n1", { x: 50, y: 50 });
    b.driver.select(["n3"]);
    b.driver.select([]);

    // Still held. `emitHeld` can only release ids it put in `held` itself, and a
    // diff-inferred claim was never there — so nothing but a later selection of n2
    // in person can clear it, and until then every select of n2 by a lower-id peer
    // re-triggers the board-wide revert measured in T2.
    expect(b.presence.isLockedByMe("n2")).toBe(true);

    // BOUND ON THE CLAIM (so the row above is not read as more than it is): the one
    // gesture that DOES clear it is selecting n2 and dropping the selection.
    b.driver.select(["n2"]);
    b.driver.select([]);
    expect(b.presence.isLockedByMe("n2")).toBe(false);
  });
});
