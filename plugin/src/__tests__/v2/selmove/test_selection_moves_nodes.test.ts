// WP119 — "selecting cards on client 1 makes other cards jump on client 2".
//
// Filed by the investigation as EVIDENCE (T4 committed `it.fails`); WP119 repaired
// the defect and this file is now the regression fence for it. Every row drives the
// shipped code: the presence rows use two real `CanvasPresence` instances over one
// shared awareness map, and the reconcile rows invoke the real `revertCanvasNode` /
// `applyCanvasNodeRevert` / `reconcileLiveCanvas` off `LiveSharePlugin.prototype`
// with a fake `this` (the `v2/wp85` precedent).
//
// THE CHAIN, all production code. The last three lines are what WP119 changed:
//
//   canvas-adapter.ts:874     patch("updateSelection", () => emitHeld(readSelectionIds()))
//   canvas-presence.ts:320    onNodeInteractionStart(id => acquireLock(id))
//   canvas-presence.ts:344    acquireLock -> lockedNodes[id] -> emitLocalState()  [AWARENESS WRITE]
//   canvas-presence.ts:307    peer's awareness "change" listener -> reconcileClaims()
//   canvas-presence.ts:372    reconcileClaims: a LOWER clientID co-holder => onRevert(nodeId)
//   main.ts:3896              onRevert -> revertCanvasNode(path, nodeId, awareness)
//   main.ts                   revertCanvasNode now KEEPS the node id and reverts THAT
//                             record through `applyCanvasNodeRevert` -> one
//                             `adapter.applyNodeGeometry(nodeId, ...)`.
//
//   BEFORE: revertCanvasNode threw the id away and passed the WHOLE snapshot with
//   `{initial: true}` -> `reconcile-plan.ts:166` returns "structural"
//   unconditionally -> `canvas.setData(ENTIRE BOARD)`. The TRIGGER was one node and
//   the EFFECT was every node, which is exactly the owner's report.
//
// VACUITY GUARDS (every row that must be able to go red has a control that does):
//   * T1 has a NEGATIVE control (peer B holds the lowest id => no revert) and an
//     UNRELATED-NODE control (a select of a node nobody contests => no revert).
//   * T1 also asserts the gesture wrote NOTHING locally (no setData, no requestSave),
//     so "read-only" is measured rather than assumed.
//   * T2's "nothing else moved" row is paired with a POSITIVE control in which the
//     reverted node DOES disagree with shared truth and converges on it, so a
//     plugin that had simply stopped reverting could not pass both.
//   * T4's SANITY row proves the world is wired; its two WITNESS rows prove the
//     revert still FIRED and the loser still CONVERGED, so the green on the headline
//     row is attributable to the narrowed blast radius and not to a dead sync.
//   * T3's leak row is paired with the release row that DOES work, so "locks are
//     never released" cannot pass by accident. That leak is UNREPAIRED — see the
//     ESCALATE note above T3.
//
// WHAT THIS FILE CANNOT SETTLE: whether Obsidian's own renderer re-routes the arrows.
// The CanvasDouble has no renderer. See the report.

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

import { type CanvasAdapter, createCanvasAdapter } from "../../../canvas/canvas-adapter";
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
  adapter: CanvasAdapter;
  driver: InteractionDriver;
}

function makeReconcileHarness(opts: {
  snapshot: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null;
  /** Seed the Surface-Shadow with these node records (what we last applied). */
  shadowNodes?: Record<string, unknown>[];
  shadowEdges?: Record<string, unknown>[];
}): ReconcileHarness {
  const double = new CanvasDouble({ nodes: BOARD, edges: EDGES });
  const adapter = createCanvasAdapter(double.view);
  // The adapter installs its monkey-patches LAZILY, on first subscription
  // (`canvas-adapter.ts:1175-1178`). In production `CanvasPresence.start()` always
  // subscribes, so `setDragging` is always patched and `isBusy()` can answer; an
  // unsubscribed adapter would report "not busy" for a live drag and the guard
  // rows below would pass for the wrong reason.
  adapter.onNodeInteractionStart(() => {});
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
  bindShippedMethods(fake);

  return { fake, double, adapter, driver: new InteractionDriver(double) };
}

/**
 * `revertCanvasNode` calls `this.applyCanvasNodeRevert(...)` (WP119) and
 * `reconcileLiveCanvas` is still driven directly by the controls, so all three
 * real methods have to be reachable on the fake. Every one comes off
 * `LiveSharePlugin.prototype` and none is re-written — that is what makes these
 * rows a measurement of the SHIPPED code rather than of a double.
 */
// biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
function bindShippedMethods(fake: any): void {
  const proto = LiveSharePlugin.prototype as unknown as Record<
    string,
    (...a: unknown[]) => unknown
  >;
  for (const name of ["reconcileLiveCanvas", "revertCanvasNode", "applyCanvasNodeRevert"]) {
    fake[name] = proto[name].bind(fake);
  }
}

const AWARENESS_STUB = {
  clientID: 1,
  getStates: () => new Map<number, Record<string, unknown>>(),
} as unknown as AwarenessLike;

describe("T2: a revert of one contested node touches THAT node and nothing else", () => {
  // Shared truth disagrees with the live view about n1 and n3. n2 — the ONLY node
  // the revert names — is at the same place in both. Before WP119 this snapshot
  // made `revertCanvasNode("n2")` move n1 and n3 through one whole-board setData.
  const DISAGREES_ABOUT_OTHERS = {
    nodes: [
      { id: "n1", x: -900, y: -700, width: 200, height: 100, type: "text", text: "one" },
      { id: "n2", x: 400, y: 0, width: 200, height: 100, type: "text", text: "two" },
      { id: "n3", x: 1500, y: 900, width: 200, height: 100, type: "text", text: "three" },
    ],
    edges: [{ id: "e1", fromNode: "n1", toNode: "n3" }],
  };

  it("reverting n2 leaves n1 and n3 alone — cards the revert was never about", () => {
    const { fake, double } = makeReconcileHarness({ snapshot: DISAGREES_ABOUT_OTHERS });

    expect(double.getNode("n1")?.x).toBe(0);
    expect(double.getNode("n3")?.y).toBe(300);

    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);

    // n2 already agreed with shared truth, so the revert is an honest no-op...
    expect(double.getNode("n2")?.x).toBe(400);
    // ...and the two cards nobody contested are exactly where they were.
    expect(double.getNode("n1")?.x).toBe(0);
    expect(double.getNode("n1")?.y).toBe(0);
    expect(double.getNode("n3")?.x).toBe(0);
    expect(double.getNode("n3")?.y).toBe(300);

    // No whole-board reload. This is the assertion the defect failed.
    expect(double.setDataCount).toBe(0);
  });

  it("POSITIVE CONTROL (A4): a node that DOES disagree is reverted — and only it", () => {
    // Without this row the row above would pass for a plugin that had simply
    // stopped reverting. The loser's view must still converge on shared truth.
    const snapshot = {
      nodes: [
        // n2 is where the LOSER's rejected edit is NOT: shared truth says (777, 555).
        { id: "n1", x: -900, y: -700, width: 200, height: 100, type: "text", text: "one" },
        { id: "n2", x: 777, y: 555, width: 200, height: 100, type: "text", text: "two" },
        { id: "n3", x: 1500, y: 900, width: 200, height: 100, type: "text", text: "three" },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n3" }],
    };
    const { fake, double } = makeReconcileHarness({ snapshot });

    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);

    // The contested card converged...
    expect(double.getNode("n2")?.x).toBe(777);
    expect(double.getNode("n2")?.y).toBe(555);
    // ...through a per-node move, not a board reload...
    expect(double.setDataCount).toBe(0);
    // ...and the collateral is still zero even on a snapshot that disagrees
    // about every card.
    expect(double.getNode("n1")?.x).toBe(0);
    expect(double.getNode("n3")?.y).toBe(300);
  });

  it("CONTROL: a node absent from shared truth leaves the whole view untouched", () => {
    // There is nothing to revert TO. The old code reloaded the board anyway,
    // because it never looked at the node id at all.
    const { fake, double } = makeReconcileHarness({ snapshot: DISAGREES_ABOUT_OTHERS });

    fake.revertCanvasNode(PATH, "nope-not-a-node", AWARENESS_STUB);

    expect(double.setDataCount).toBe(0);
    expect(double.getNode("n1")?.x).toBe(0);
    expect(double.getNode("n2")?.x).toBe(400);
    expect(double.getNode("n3")?.y).toBe(300);
  });

  // WP87's editing/drag predicate. `applyNodeGeometry` is a GUARDED-BY-CALLER
  // surface sink and the per-node revert is a NEW caller of it, so it must consult
  // the one definer and act on the answer. These two rows are the behavioural half
  // of what `v2/wp87/test_tp01_surface_route_census` asserts structurally, and the
  // POSITIVE CONTROL above them is the row that moves n2 when nothing is busy — a
  // revert that withheld unconditionally would pass these two and fail that one.
  const CONTESTED = {
    nodes: [
      { id: "n1", x: 0, y: 0, width: 200, height: 100, type: "text", text: "one" },
      { id: "n2", x: 777, y: 555, width: 200, height: 100, type: "text", text: "two" },
      { id: "n3", x: 0, y: 300, width: 200, height: 100, type: "text", text: "three" },
    ],
    edges: [{ id: "e1", fromNode: "n1", toNode: "n3" }],
  };

  it("GUARD: a revert is WITHHELD while an inline editor is open", () => {
    const { fake, double, adapter } = makeReconcileHarness({ snapshot: CONTESTED });

    adapter.noteEditingFocus?.("n1"); // the user is typing in a DIFFERENT card
    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);

    // Nothing reseated. WP37 measured that reseating a card with an open editor
    // discards its unflushed text, and a lock revert is never worth that.
    expect(double.getNode("n2")?.x).toBe(400);
    expect(double.setDataCount).toBe(0);

    // ...and once the editor closes, the same revert lands.
    adapter.noteEditingFocus?.(null);
    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);
    expect(double.getNode("n2")?.x).toBe(777);
  });

  it("GUARD: a revert is DEFERRED while the user is dragging", () => {
    const { fake, double, driver } = makeReconcileHarness({ snapshot: CONTESTED });

    driver.beginDrag("n1");
    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);
    expect(double.getNode("n2")?.x).toBe(400);

    driver.endDrag();
    fake.revertCanvasNode(PATH, "n2", AWARENESS_STUB);
    expect(double.getNode("n2")?.x).toBe(777);
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
// T4 — THE DEFECT, END TO END. RED BEFORE WP119, GREEN AFTER IT.
//
// Both halves are production code and they are joined at the seam `main.ts` joins
// them at (`onRevert: nodeId => this.revertCanvasNode(...)`, main.ts:3896). Peer A
// makes ONE read-only gesture; peer B's board is measured before and after.
//
// This row was committed as `it.fails` by the investigation that filed the defect
// (`expect(setDataCount).toBe(0)` receiving `1`). WP119 made it pass and converted
// it to an ordinary `it`. Its two companion rows are KEPT and now carry the whole
// attribution burden between them:
//
//   ├── SANITY  — the world is wired before the gesture, so a green cannot come
//   │             from an exception in the harness.
//   └── WITNESS — the presence machinery genuinely RAN for this gesture (B's
//                 contested claim was resolved), so a green cannot come from a
//                 plugin that simply stopped reverting. Its second row drives a
//                 snapshot that disagrees about the CLICKED card and measures the
//                 loser converging — charter A4, end to end.
// ---------------------------------------------------------------------------

// Shared truth disagrees with B's view about n1 and n3 — the ordinary state of a
// board whose peer has moved cards B has not applied yet. n2, the card A is about
// to click, agrees.
const T4_SNAPSHOT = {
  nodes: [
    { id: "n1", x: -900, y: -700, width: 200, height: 100, type: "text", text: "one" },
    { id: "n2", x: 400, y: 0, width: 200, height: 100, type: "text", text: "two" },
    { id: "n3", x: 1500, y: 900, width: 200, height: 100, type: "text", text: "three" },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n3" }],
};

describe("T4: a read-only selection on peer A must not move cards on peer B", () => {
  function wire(
    snapshot: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } =
      T4_SNAPSHOT,
  ) {
    const net = makeNetwork();

    // Peer A: a plain peer with the LOWER clientID.
    const a = makePeer(net, 1, "A");

    // Peer B: a real adapter over a real double, and the REAL revert wired to it.
    const bDouble = new CanvasDouble({ nodes: BOARD, edges: EDGES });
    const bAdapter = createCanvasAdapter(bDouble.view);
    const canvasAdapters = new Map([[PATH, bAdapter]]);
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
    bindShippedMethods(fake);

    const bAwareness = net.client(2);
    const reverted: string[] = [];
    const bPresence = new CanvasPresence({
      path: PATH,
      awareness: bAwareness,
      identity: { clientId: 2, name: "B", color: "#def" },
      adapter: bAdapter,
      // THE PRODUCTION SEAM, main.ts:3896.
      onRevert: (nodeId: string) => {
        reverted.push(nodeId);
        fake.revertCanvasNode(PATH, nodeId, bAwareness);
      },
      showCursors: false,
      showPresence: false,
    });
    bPresence.start();

    // B's capture path has claimed n2 at some earlier point (canvas-sync.ts:4130).
    bPresence.onDiffInferredChange("n2");

    return { a, bDouble, bPresence, reverted };
  }

  it("SANITY: the world is wired and B's board starts where it started", () => {
    // Without this row the assertion below could pass for the wrong reason — e.g.
    // an exception in the wiring rather than the repair.
    const { bDouble } = wire();
    expect(bDouble.getNode("n1")?.x).toBe(0);
    expect(bDouble.getNode("n3")?.y).toBe(300);
    expect(bDouble.setDataCount).toBe(0);
  });

  it("a read-only selection on peer A must not move any card on peer B", () => {
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

  it("WITNESS: the contest was still RESOLVED — the row above is not a dead sync", () => {
    // The other side of the row above. The gesture must still reach B's revert
    // path and B must still drop the claim it lost; what changed is the blast
    // radius, not whether presence works.
    const { a, bDouble, bPresence, reverted } = wire();

    a.driver.select(["n2"]);

    expect(reverted).toEqual(["n2"]);
    expect(bPresence.isLockedByMe("n2")).toBe(false);
    // ...and the clicked card is where shared truth says it is.
    expect(bDouble.getNode("n2")?.x).toBe(400);
  });

  it("WITNESS (A4): when shared truth disagrees about the CLICKED card, B converges", () => {
    // A genuinely contested edit: B's view of n2 is its own un-agreed position and
    // shared truth says otherwise. The loser must still converge — on that card,
    // and on no other.
    const { a, bDouble, reverted } = wire({
      nodes: [
        { id: "n1", x: -900, y: -700, width: 200, height: 100, type: "text", text: "one" },
        { id: "n2", x: 777, y: 555, width: 200, height: 100, type: "text", text: "two" },
        { id: "n3", x: 1500, y: 900, width: 200, height: 100, type: "text", text: "three" },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n3" }],
    });

    expect(bDouble.getNode("n2")?.x).toBe(400);

    a.driver.select(["n2"]);

    expect(reverted).toEqual(["n2"]);
    // The loser converged on the contested card...
    expect(bDouble.getNode("n2")?.x).toBe(777);
    expect(bDouble.getNode("n2")?.y).toBe(555);
    // ...without a whole-board reload and without touching anything else.
    expect(bDouble.setDataCount).toBe(0);
    expect(bDouble.getNode("n1")?.x).toBe(0);
    expect(bDouble.getNode("n3")?.y).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// T3 — WHY IT IS "EVERY TIME" RATHER THAN "SOMETIMES": the diff-inferred lock is
// acquired by the capture path and there is NO path that releases it.
//
// ⚠ WAS AN OPEN ESCALATE AFTER WP119. CLOSED BY WP120 — READ THIS BEFORE THE ROWS.
//
// WP119 could not discharge charter A3 here: `canvas-presence.ts` was an
// initiative-wide byte-unchanged invariant (BUILD_SPEC §7, enforced by the digest
// pin in `v2/wp21/test_tp04_awareness_liveness_unchanged_visible.test.ts`), so the
// leak was carried up with a worked design in `ImplementationReport_WP119.md` §4.
// The owner then LIFTED that pin for this one repair (DISPATCHER_STATE.md §5) and
// **WP120 landed the lifetime**: a diff-inferred claim now expires after
// `INFERRED_LOCK_IDLE_MS` of not being re-touched, swept on the awareness change
// BEFORE the tiebreak. The pin was re-established at the new digest, not removed.
//
// THESE TWO ROWS ARE UNCHANGED, ASSERTION FOR ASSERTION, AND STILL PASS — because
// what they measure is a GESTURE bound, not a time bound: no *user action* other
// than re-selecting n2 clears a diff-inferred claim. That is still true after
// WP120, whose release is the passage of idle time and not a gesture. They remain
// the fence that `emitHeld` never gained a release path it does not have.
// The time-bound half is `v2/wp120/test_tp01_a_presence_lock_has_a_lifetime_visible`.
//
// What WP119 DID change is the cost of the leak: a stale claim bought one per-node
// `applyNodeGeometry` — almost always `"unchanged"` — instead of a whole-board
// `setData`. WP120 removed the cause on top of that bounded cost.
// ---------------------------------------------------------------------------

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
    // in person can clear it. WP119 CORRECTION: what that costs is no longer the
    // board-wide revert T2 used to measure. Every select of n2 by a lower-id peer
    // still fires the loser-revert, but the revert is now scoped to n2 alone.
    expect(b.presence.isLockedByMe("n2")).toBe(true);

    // BOUND ON THE CLAIM (so the row above is not read as more than it is): the one
    // gesture that DOES clear it is selecting n2 and dropping the selection.
    b.driver.select(["n2"]);
    b.driver.select([]);
    expect(b.presence.isLockedByMe("n2")).toBe(false);
  });
});
