// WP6 / C6 — chaos scenario I.a: "view apply artificially delayed + Obsidian save".
//
// This is the FIRST STEP of the reported Symptom-2 cascade, reproduced end to end:
// a peer's edit reaches this client's CRDT, the open Obsidian canvas has not been
// brought up to date yet, and Obsidian saves what its (stale) model still shows.
// Under V1 that save was observation-as-intent and reverted the peer; the revert
// then travelled back and the two versions shredded each other.
//
// HOW THE DELAY IS EXPRESSED (WP6 AC4, hard constraint):
//   NOT temporally. There is no sleep, no `setTimeout` wait and no timing constant
//   anywhere in this file. The real production hook — `setOnRemoteCanvasUpdate`,
//   the callback `main.ts` reconciles the live view from — is wired to a PENDING
//   QUEUE instead of running the pass inline. The scenario then chooses *when* to
//   drain that queue relative to `handleLocalModify`, which is exactly what "the
//   view apply is delayed past the save" means structurally. Both orderings are
//   real production interleavings; only the scheduler that produces them is ours.
//
// THREE PEERS, not two (charter §5): the interesting property is what the OTHER
// replicas observe. With two peers a revert and a merge are hard to tell apart;
// with three, a revert is visible as a value two independent replicas never asked
// for.
//
// STATE IS THE ORACLE: every assertion reads the CRDT (`Y.Map` values, state
// vectors) or the Surface-Shadow. No log string is used as evidence.
//
//   ├── T1 the delayed pass runs AFTER the save: the stale value never leaves this
//   │      client, the user's genuine drag does, and all three peers converge.
//   ├── T2 the delayed pass then lands and the next save of the now-current view
//   │      emits nothing at all — the cascade cannot take a second step.
//   ├── T3 a three-way interleaving (two peers editing different records while the
//   │      third saves its delayed view) converges with nothing reverted.
//   ├── T4 the delayed pass runs BEFORE the save but its reload never lands: still
//   │      no revert, because an attempted apply is not a receipt.
//   └── T5 AC4 — the scenario is deterministic: two independent runs produce
//          byte-identical CRDT state, and this file contains no wall-clock call.
//
// The two DISCRIMINATION variants live in the second describe block below.

import { readFileSync } from "node:fs";

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { type CanvasAdapter, createCanvasAdapter } from "../../../canvas/canvas-adapter";
import {
  type ApplyOutcome,
  type SurfaceStateStore,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceStateStore,
  getField,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { type CanvasRecords, planReconcile } from "../../../canvas/reconcile-plan";
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";
import { CanvasDouble } from "../../harness/canvas-double";

const PATH = "chaos/cascade.canvas";

// Fixed fixture — no generated ids, no randomness, no clock-derived value.
const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "contested" };
const N2 = { id: "n2", type: "text", x: 300, y: 0, width: 200, height: 100, text: "other" };
const N3 = { id: "n3", type: "text", x: 600, y: 0, width: 200, height: 100, text: "mine" };
const SEED = [N1, N2, N3];

type PassResult = "deferred" | "noop" | "structural" | "geometry";

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

/** One-way replication, as the relay would deliver it (a REMOTE transaction). */
function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

/** State-vector fingerprint — identical before/after ⟺ zero CRDT writes. */
function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

function canonical(doc: Y.Doc): string {
  return serializeCanvas(
        doc.getMap<Y.Map<unknown>>("nodes"),
        doc.getMap<Y.Map<unknown>>("edges"),
        doc.getMap<unknown>("deleted"),
      );
}

/**
 * Flush the settle window `noteExternalDiskWrite` opens.
 *
 * This names NO duration and waits for nothing: it drains whatever the production
 * code itself scheduled. Without it `recentDiskWrites` still holds the path and
 * `handleLocalModify` returns before the scenario begins.
 */
async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

/** Exactly the bytes Obsidian would save: whatever the live view model holds. */
function viewJson(double: CanvasDouble): string {
  const data = double.getData();
  return canvasJson(data.nodes, data.edges);
}

interface Room {
  vault: ReturnType<typeof createVault>;
  cs: CanvasSync;
  doc1: Y.Doc;
  doc2: Y.Doc;
  doc3: Y.Doc;
  double: CanvasDouble;
  adapter: CanvasAdapter;
  store: SurfaceStateStore;
  /** Reconcile passes that were TRIGGERED but not yet executed — the delay. */
  pending: Array<() => PassResult>;
  drain: () => PassResult[];
}

/**
 * Peer 1 owns the real `CanvasSync`, a real `createCanvasAdapter` over the
 * contract-faithful `CanvasDouble`, and an OPEN canvas view. Peers 2 and 3 are
 * plain replicas — the two independent observers a revert has to be visible to.
 */
async function makeRoom(
  opts: { shadowRebase?: boolean; perFieldReceipt?: boolean } = {},
): Promise<Room> {
  const seedJson = canvasJson(SEED);
  const vault = createVault({ [PATH]: seedJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });

  const double = new CanvasDouble({ nodes: SEED.map((record) => ({ ...record })) });
  const adapter = createCanvasAdapter(double.view);
  // Reconcile always consults the busy seam first; that call is also what installs
  // the private-API patches, so the adapter sees the same signals production does.
  adapter.isBusy();

  // The canvas view is OPEN for the whole scenario — that is the precondition of
  // this symptom, and it is what makes `noteExternalDiskWrite` a non-receipt.
  const store = createSurfaceStateStore(() => true);
  cs.setSurfaceStateProvider((path) => store.stateFor(path));
  cs.setShadowRebaseEnabled(opts.shadowRebase ?? true);

  const pending: Array<() => PassResult> = [];

  /** The `reconcileLiveCanvas` body as wiring (the WP5 AC4 shape), one pass. */
  const runPass = (o: { initial?: boolean } = {}): PassResult => {
    if (!adapter.isAvailable()) return "deferred";
    if (adapter.isBusy()) return "deferred";
    // A pass always reconciles against shared truth AS OF WHEN IT RUNS, which is
    // what production does at observer time; delaying the pass must not also
    // freeze its input, or the fixture would simulate a second, unrelated defect.
    const data: CanvasRecords = cs.getCanvasSnapshot(PATH) ?? { nodes: [], edges: [] };
    const plan = planReconcile({
      desired: data,
      lastApplied: shadowToCanvasRecords(cs.getSurfaceShadow(), PATH),
      liveNodeIds: adapter.getLiveNodeIds(),
      liveEdgeIds: adapter.getLiveEdgeIds(),
      initial: o.initial,
    });
    if (plan === "noop") return "noop";

    let reloaded: boolean | undefined;
    let nodeOutcomes: Map<string, ApplyOutcome> | undefined;
    if (plan === "structural") {
      reloaded = adapter.reloadCanvasData({ nodes: data.nodes, edges: data.edges });
    } else {
      nodeOutcomes = new Map<string, ApplyOutcome>();
      for (const node of data.nodes) {
        if (
          typeof node.id !== "string" ||
          typeof node.x !== "number" ||
          typeof node.y !== "number" ||
          typeof node.width !== "number" ||
          typeof node.height !== "number"
        ) {
          continue;
        }
        nodeOutcomes.set(
          node.id,
          adapter.applyNodeGeometry(node.id, {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          }),
        );
      }
    }

    const summary = advanceFromReceipt(
      cs.getSurfaceShadow(),
      buildApplyReceipt({ path: PATH, desired: data, plan, reloaded, nodeOutcomes }),
      { perFieldReceipt: opts.perFieldReceipt ?? true },
    );
    store.noteHandover(PATH, summary.handed);
    return plan;
  };

  // THE DELAY SEAM. Production runs the pass inline from this hook; here the pass
  // is QUEUED and the scenario decides when it executes relative to the save.
  cs.setOnRemoteCanvasUpdate(() => {
    pending.push(() => runPass());
  });

  await cs.subscribe(PATH, "host");
  const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;

  // The mount pass: the view is up to date and the hand-over receipt exists, so
  // the scenario starts from a healthy client rather than an empty shadow.
  runPass({ initial: true });

  const doc2 = new Y.Doc();
  const doc3 = new Y.Doc();
  push(doc1, doc2);
  push(doc1, doc3);

  const drain = (): PassResult[] => {
    const results: PassResult[] = [];
    while (pending.length > 0) {
      const next = pending.shift() as () => PassResult;
      results.push(next());
    }
    return results;
  };

  return { vault, cs, doc1, doc2, doc3, double, adapter, store, pending, drain };
}

/**
 * The single writer (`CanvasPersistence`) flushing the integrated delta to disk.
 *
 * HARNESS TRAP this avoids: without it the view's save below would be BYTE-
 * IDENTICAL to the content the vault was seeded with, WP4's byte echo breaker
 * would short-circuit `handleLocalModify` with `no-op (disk == shared state)`
 * before the shadow was ever consulted, and the scenario would silently test
 * nothing. The view is OPEN, so this write advances no shadow field — it only
 * moves the echo baseline, exactly as in production.
 */
async function flushPersistence(room: Room): Promise<string> {
  const content = canonical(room.doc1);
  room.vault.files.set(PATH, content);
  room.cs.noteExternalDiskWrite(PATH, content);
  await settle();
  return content;
}

/** The local user drags a card in the open view; Obsidian then saves the model. */
async function dragAndSave(room: Room, nodeId: string, y: number): Promise<void> {
  const node = room.double.getNode(nodeId);
  if (!node) throw new Error(`fixture error: ${nodeId} is not in the live view`);
  node.moveAndResize({ x: node.x, y, width: node.width, height: node.height });
  room.vault.files.set(PATH, viewJson(room.double));
  await room.cs.handleLocalModify(PATH);
}

interface CascadeReadings {
  local: unknown;
  peer2: unknown;
  peer3: unknown;
  genuineLocal: unknown;
  genuinePeer2: unknown;
  genuinePeer3: unknown;
  /** The capture basis for n1.x AT SAVE TIME — what the save is classified against. */
  basisAtSave: unknown;
  canonical: string;
}

/**
 * ONE scenario, parameterised only by the seams and by WHERE the delayed pass
 * falls relative to the save.
 *
 *   1. peer 2 moves n1 to x=500; peers 1 and 3 integrate it,
 *   2. peer 1's view apply is TRIGGERED but not executed (the delay),
 *   3. the single writer flushes the delta to disk (echo baseline moves),
 *   4. optionally the delayed pass runs now — and optionally cannot land,
 *   5. the local user drags n3 in the still-stale view and Obsidian saves it,
 *   6. otherwise the delayed pass runs now,
 *   7. everything peer 1 holds is replicated to peers 2 and 3.
 */
async function runDelayedCascade(
  opts: {
    shadowRebase?: boolean;
    perFieldReceipt?: boolean;
    applyBeforeSave?: boolean;
    reloadCanLand?: boolean;
  } = {},
): Promise<CascadeReadings> {
  const room = await makeRoom(opts);

  // A geometry key AND a non-geometry key, so `planReconcile` classifies the
  // delayed pass as `structural` — the branch whose apply can actually fail to
  // land, which is what the per-field receipt has to notice.
  room.doc2.transact(() => {
    const n1 = room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1");
    n1?.set("x", 500);
    n1?.set("text", "peer two");
  });
  push(room.doc2, room.doc1);
  push(room.doc2, room.doc3);

  await flushPersistence(room);

  if (opts.reloadCanLand === false) {
    // I5 degrade-never-break: the private structural-reload surface is gone, so
    // the delayed pass will run and NOT land. An attempt is not a receipt.
    (room.double.canvas as unknown as Record<string, unknown>).setData = undefined;
  }
  if (opts.applyBeforeSave) room.drain();

  // Read BEFORE the save: afterwards the capture path has advanced the shadow by
  // whatever it pushed, which would hide what the save was actually classified
  // against — the one value the receipt seam decides.
  const basisAtSave = getField(room.cs.getSurfaceShadow(), PATH, "node", "n1", "x");

  await dragAndSave(room, "n3", 40);

  if (!opts.applyBeforeSave) room.drain();

  push(room.doc1, room.doc2);
  push(room.doc1, room.doc3);

  const readings: CascadeReadings = {
    local: nodeField(room.doc1, "n1", "x"),
    peer2: nodeField(room.doc2, "n1", "x"),
    peer3: nodeField(room.doc3, "n1", "x"),
    genuineLocal: nodeField(room.doc1, "n3", "y"),
    genuinePeer2: nodeField(room.doc2, "n3", "y"),
    genuinePeer3: nodeField(room.doc3, "n3", "y"),
    basisAtSave,
    canonical: canonical(room.doc1),
  };
  room.cs.destroy();
  return readings;
}

const SOURCE = readFileSync(new URL(import.meta.url), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("WP6 AC1 — delayed view apply + Obsidian save reproduces the cascade trigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 the delayed save carries no stale value and the genuine drag still lands", async () => {
    const readings = await runDelayedCascade();

    expect(readings.local, "the stale x was written back into the shared doc").toBe(500);
    expect(readings.peer2, "the revert reached peer 2 — the cascade started").toBe(500);
    expect(readings.peer3, "the revert reached peer 3 — the cascade started").toBe(500);
    expect(readings.genuineLocal, "the user's own drag was swallowed").toBe(40);
    expect(readings.genuinePeer2).toBe(40);
    expect(readings.genuinePeer3).toBe(40);
  });

  it("T2 once the delayed pass lands, the next save of that view emits nothing", async () => {
    const room = await makeRoom();

    room.doc2.transact(() => {
      const n1 = room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1");
      n1?.set("x", 500);
      n1?.set("text", "peer two");
    });
    push(room.doc2, room.doc1);
    push(room.doc2, room.doc3);
    await flushPersistence(room);

    await dragAndSave(room, "n3", 40);
    expect(nodeField(room.doc1, "n1", "x")).toBe(500);
    expect(nodeField(room.doc1, "n1", "text")).toBe("peer two");

    // The delayed apply finally happens. The view snaps to shared truth and the
    // receipt moves the capture basis with it.
    expect(room.drain(), "exactly one delayed pass, and it must not defer").toEqual(["structural"]);
    expect(room.double.getNode("n1")?.x, "the delayed pass did not reach the view").toBe(500);
    expect(getField(room.cs.getSurfaceShadow(), PATH, "node", "n1", "x")).toBe(500);
    expect(getField(room.cs.getSurfaceShadow(), PATH, "node", "n3", "y")).toBe(40);

    // Obsidian re-serialises the now-current view: every field equals the shadow,
    // so the pass is pure staleness and writes nothing at all.
    const before = fingerprint(room.doc1);
    room.vault.files.set(PATH, viewJson(room.double));
    await room.cs.handleLocalModify(PATH);
    expect(fingerprint(room.doc1), "the settled view still emitted a delta").toBe(before);

    push(room.doc1, room.doc2);
    push(room.doc1, room.doc3);
    for (const doc of [room.doc1, room.doc2, room.doc3]) {
      expect(nodeField(doc, "n1", "x")).toBe(500);
      expect(nodeField(doc, "n3", "y")).toBe(40);
    }
    room.cs.destroy();
  });

  it("T3 two peers editing different records + one delayed save converge with no revert", async () => {
    const room = await makeRoom();

    room.doc2.transact(() => {
      room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("x", 500);
    });
    room.doc3.transact(() => {
      room.doc3.getMap<Y.Map<unknown>>("nodes").get("n2")?.set("text", "renamed by 3");
    });
    push(room.doc2, room.doc1);
    push(room.doc3, room.doc1);
    await flushPersistence(room);

    // Peer 1's view predates BOTH edits (its apply is still queued) and the user
    // drags their own card in it.
    await dragAndSave(room, "n3", 64);

    room.drain();
    push(room.doc1, room.doc2);
    push(room.doc1, room.doc3);
    push(room.doc2, room.doc3);
    push(room.doc3, room.doc2);

    for (const doc of [room.doc1, room.doc2, room.doc3]) {
      expect(nodeField(doc, "n1", "x"), "peer 2's move was reverted").toBe(500);
      expect(nodeField(doc, "n2", "text"), "peer 3's rename was reverted").toBe("renamed by 3");
      expect(nodeField(doc, "n3", "y"), "peer 1's own drag was lost").toBe(64);
    }
    room.cs.destroy();
  });

  it("T4 a delayed pass whose reload never lands still produces no revert", async () => {
    const readings = await runDelayedCascade({ applyBeforeSave: true, reloadCanLand: false });

    expect(readings.basisAtSave, "a reload that did not land must not move the capture basis").toBe(
      0,
    );
    expect(readings.local, "an attempted apply was treated as a receipt").toBe(500);
    expect(readings.peer2).toBe(500);
    expect(readings.peer3).toBe(500);
  });

  it("T5 the scenario is deterministic and this suite touches no wall clock", async () => {
    const first = await runDelayedCascade();
    const second = await runDelayedCascade();
    expect(second).toEqual(first);
    expect(second.canonical, "two runs produced different CRDT bytes").toBe(first.canonical);

    expect(CODE, "no wall-clock sleep").not.toMatch(/\bsleep\s*\(/);
    expect(CODE, "no timer wait").not.toMatch(/\bsetTimeout\s*\(/);
    expect(CODE, "no clock read").not.toMatch(/\bDate\.now\b/);
    expect(CODE, "no entropy — the fixture is fixed, not seeded at random").not.toMatch(
      /\bMath\.random\b/,
    );
    expect(CODE, "no timer advanced by a named duration").not.toMatch(/\badvanceTimersBy\w*\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// DISCRIMINATION (WP6 AC3 / BUILD_SPEC §8): the SAME scenario, run with the V2
// mechanism disabled through its injected seam, asserts that the bad outcome
// occurs. These are part of the suite, not a manual procedure — and each one is
// compared DIRECTLY against the enabled run, so a change that quietly neutralises
// a seam breaks a test instead of leaving two independently-green cases.
// ---------------------------------------------------------------------------
describe("WP6 AC3 — the delayed-apply scenario fails with the mechanism disabled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("D1 seam `setShadowRebaseEnabled(false)`: the stale save reverts both peers", async () => {
    const on = await runDelayedCascade();
    const off = await runDelayedCascade({ shadowRebase: false });

    expect(
      off.local,
      "with the capture-side rebase off the save must fall back to observation-as-intent",
    ).toBe(0);
    expect(off.peer2, "the cascade must reach peer 2 with the mechanism off").toBe(0);
    expect(off.peer3, "the cascade must reach peer 3 with the mechanism off").toBe(0);

    expect(on.peer2).not.toBe(off.peer2);
    expect(on.peer3).not.toBe(off.peer3);
  });

  it("D2 seam `advanceFromReceipt(..., { perFieldReceipt: false })`: an unlanded apply reverts both peers", async () => {
    const on = await runDelayedCascade({ applyBeforeSave: true, reloadCanLand: false });
    const off = await runDelayedCascade({
      applyBeforeSave: true,
      reloadCanLand: false,
      perFieldReceipt: false,
    });

    expect(
      off.basisAtSave,
      "V1 record-snapshot semantics must mark the unapplied reload as applied",
    ).toBe(500);
    expect(off.local, "the stale view must then read as intent and revert the peer").toBe(0);
    expect(off.peer2).toBe(0);
    expect(off.peer3).toBe(0);

    expect(on.basisAtSave).not.toBe(off.basisAtSave);
    expect(on.peer2).not.toBe(off.peer2);
    expect(on.peer3).not.toBe(off.peer3);
  });
});
