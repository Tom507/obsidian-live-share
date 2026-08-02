// WP6 / C6 — chaos scenario I.b: "adapter unavailable + open view + remote deltas".
//
// Obsidian's Canvas view is PRIVATE and untyped (I5: degrade, never break). When
// that surface is missing — a version change, a mount race, a view whose internals
// this build does not recognise — the client is in DEGRADED mode: the canvas view
// is open in front of the user, remote deltas keep arriving into the CRDT, and
// nothing can be applied to the view at all. The view's model therefore drifts
// arbitrarily far from shared truth while Obsidian keeps saving it.
//
// The property under test (WP6 AC2): the scenario runs WITHOUT the open view
// leaking stale values into the shared state. Deferring an apply must be a
// deferral — not a receipt, and not a hole either.
//
// Two shapes of degradation are exercised, because they fail differently:
//   ├── "unavailable"   — `createCanvasAdapter({})`: `isAvailable()` is false, the
//   │                     pass never even builds a receipt.
//   └── "reload-broken" — the adapter is available but the structural-reload
//                         surface (`canvas.setData`) is gone, so the pass RUNS and
//                         does not land. This is the one the per-field receipt has
//                         to notice, and it is the seam for discrimination D2.
//
// THREE PEERS (charter §5): a leak has to be visible to two independent replicas
// that never asked for the value. STATE IS THE ORACLE — every assertion reads CRDT
// values, state vectors or the Surface-Shadow; no log string is evidence here.
//
//   ├── T1 the degraded client's save carries no stale value; its own genuine edit
//   │      still reaches both peers.
//   ├── T2 a record the open view NEVER received is not deleted by the save that
//   │      omits it — absence without a hand-over receipt is ignorance.
//   ├── T3 rounds of deltas and saves never accumulate into a revert.
//   ├── T4 recovery: once the private surface reappears the pass lands, the shadow
//   │      advances, and the next save of the settled view emits nothing.
//   └── T5 AC4 — deterministic: two runs produce byte-identical CRDT state, and
//          this suite contains no wall-clock call.
//
// No wall-clock sleep, no `setTimeout` wait, no timing constant: the degradation is
// structural (a missing method / a view the adapter does not recognise), never a
// race won by waiting.

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
  getRecordState,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { type CanvasRecords, planReconcile } from "../../../canvas/reconcile-plan";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";
import { CanvasDouble } from "../../harness/canvas-double";

const PATH = "chaos/degraded.canvas";

// Fixed fixture — no generated ids, no randomness, no clock-derived value.
const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "contested" };
const N2 = { id: "n2", type: "text", x: 300, y: 0, width: 200, height: 100, text: "other" };
const N3 = { id: "n3", type: "text", x: 600, y: 0, width: 200, height: 100, text: "mine" };
/** Created by peer 3 while this client is degraded — the view never sees it. */
const N4 = { id: "n4", type: "text", x: 900, y: 0, width: 200, height: 100, text: "from peer 3" };
const SEED = [N1, N2, N3];

type PassResult = "deferred" | "noop" | "structural" | "geometry";
type Degradation = "unavailable" | "reload-broken";

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

/**
 * Is the record still THERE, as the user would experience it?
 *
 * WP19 AC1 turned deletion from an ABSENCE into a VALUE: a delete writes a
 * tombstone and never removes the key. Read as `nodes.has(id)` this question
 * therefore answers `true` unconditionally — it cannot distinguish a record
 * that survived from one that was deleted, which silently collapsed D2's
 * enabled-vs-disabled discrimination below (both sides read `true`).
 *
 * Reading the PROJECTION restores the distinction, and is the better oracle
 * anyway: it pins what the canvas actually shows rather than a storage detail.
 */
function hasNode(doc: Y.Doc, id: string): boolean {
  return buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  ).nodes.some((node) => node.id === id);
}

/** State-vector fingerprint — identical before/after ⟺ zero CRDT writes. */
function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

// WP64 — `canonical()` stands in for THE BYTES PRODUCTION WOULD WRITE, and
// production (`canvas-persistence.ts`) serialises with the tombstone map. This
// helper is captured after the save that omits `n4` — i.e. after a delete — so a
// 2-arg call here would have emitted a record the real writer suppresses.
function canonical(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
}

/** Drain the settle window the production code itself opened. Names no duration. */
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
  store: SurfaceStateStore;
  /** What every reconcile pass triggered by a remote delta returned, in order. */
  passes: PassResult[];
  /** The private Canvas surface reappears: swap in a healthy adapter. */
  recover: () => PassResult;
}

/**
 * Peer 1 owns the real `CanvasSync` and an OPEN canvas view whose adapter is
 * degraded. Peers 2 and 3 are plain replicas — the two independent observers a
 * leak has to be visible to.
 */
async function makeRoom(
  opts: {
    degradation?: Degradation;
    shadowRebase?: boolean;
    perFieldReceipt?: boolean;
  } = {},
): Promise<Room> {
  const degradation: Degradation = opts.degradation ?? "unavailable";
  const seedJson = canvasJson(SEED);
  const vault = createVault({ [PATH]: seedJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });

  const double = new CanvasDouble({ nodes: SEED.map((record) => ({ ...record })) });
  if (degradation === "reload-broken") {
    // I5: the private structural-reload surface is gone from this build's view.
    (double.canvas as unknown as Record<string, unknown>).setData = undefined;
  }
  // "unavailable": the adapter is handed a view whose private canvas it cannot
  // recognise at all, which is what `isAvailable()` gates on.
  let adapter: CanvasAdapter =
    degradation === "unavailable" ? createCanvasAdapter({}) : createCanvasAdapter(double.view);
  adapter.isBusy();

  // The canvas view is OPEN for the whole scenario. That is why
  // `noteExternalDiskWrite` may not advance the shadow: an open Obsidian canvas
  // ignores external file writes, so only a confirmed apply is a receipt here.
  const store = createSurfaceStateStore(() => true);
  cs.setSurfaceStateProvider((path) => store.stateFor(path));
  cs.setShadowRebaseEnabled(opts.shadowRebase ?? true);

  const passes: PassResult[] = [];

  /** The `reconcileLiveCanvas` body as wiring (the WP5 AC4 shape), one pass. */
  const runPass = (o: { initial?: boolean } = {}): PassResult => {
    if (!adapter.isAvailable()) return "deferred";
    if (adapter.isBusy()) return "deferred";
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

  // Production wiring: every integrated remote delta drives one reconcile pass.
  cs.setOnRemoteCanvasUpdate(() => {
    passes.push(runPass());
  });

  await cs.subscribe(PATH, "host");
  const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  // The mount pass is attempted and cannot succeed — that IS the degraded state.
  passes.push(runPass({ initial: true }));

  const doc2 = new Y.Doc();
  const doc3 = new Y.Doc();
  push(doc1, doc2);
  push(doc1, doc3);

  const recover = (): PassResult => {
    (double.canvas as unknown as Record<string, unknown>).setData = (data: unknown) => {
      // Restore the real double behaviour: replace the live records wholesale.
      const d = data as { nodes?: Record<string, unknown>[]; edges?: Record<string, unknown>[] };
      double.canvas.nodes.clear();
      for (const rec of d.nodes ?? []) double.upsertNode(rec as never);
      double.canvas.edges.clear();
      for (const rec of d.edges ?? []) double.upsertEdge(rec as never);
    };
    adapter = createCanvasAdapter(double.view);
    adapter.isBusy();
    return runPass();
  };

  return { vault, cs, doc1, doc2, doc3, double, store, passes, recover };
}

/**
 * The single writer (`CanvasPersistence`) flushing the integrated deltas to disk.
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

/** Peer 2 moves and renames n1; peer 3 adds a whole new card. */
function remoteDeltas(room: Room, x: number, label: string): void {
  room.doc2.transact(() => {
    const n1 = room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1");
    n1?.set("x", x);
    n1?.set("text", label);
  });
  room.doc3.transact(() => {
    const created = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(N4)) created.set(key, value);
    room.doc3.getMap<Y.Map<unknown>>("nodes").set("n4", created);
  });
  push(room.doc2, room.doc1);
  push(room.doc3, room.doc1);
}

interface DegradedReadings {
  local: unknown;
  peer2: unknown;
  peer3: unknown;
  localText: unknown;
  genuineLocal: unknown;
  genuinePeer2: unknown;
  genuinePeer3: unknown;
  /** Did the record the open view never received survive the view's save? */
  newRecordLocal: boolean;
  newRecordPeer2: boolean;
  newRecordPeer3: boolean;
  /** The capture basis for n1.x AT SAVE TIME — what the save is classified against. */
  basisAtSave: unknown;
  passes: PassResult[];
  canonical: string;
}

/**
 * ONE scenario, parameterised only by the degradation shape and the two seams.
 *
 *   1. the client is degraded before anything arrives (the mount pass fails),
 *   2. peer 2 moves and renames n1 while peer 3 creates n4; both reach this
 *      client's CRDT and each triggers a reconcile pass that cannot land,
 *   3. the single writer flushes the deltas to disk (echo baseline moves; the
 *      open view is NOT updated by that write, exactly as in Obsidian),
 *   4. the local user drags their own card in the never-updated view and Obsidian
 *      saves what that view still shows,
 *   5. everything peer 1 holds is replicated to peers 2 and 3.
 */
async function runDegraded(
  opts: {
    degradation?: Degradation;
    shadowRebase?: boolean;
    perFieldReceipt?: boolean;
  } = {},
): Promise<DegradedReadings> {
  const room = await makeRoom(opts);

  remoteDeltas(room, 500, "peer two");
  await flushPersistence(room);

  const basisAtSave = getField(room.cs.getSurfaceShadow(), PATH, "node", "n1", "x");

  await dragAndSave(room, "n3", 40);

  push(room.doc1, room.doc2);
  push(room.doc1, room.doc3);

  const readings: DegradedReadings = {
    local: nodeField(room.doc1, "n1", "x"),
    peer2: nodeField(room.doc2, "n1", "x"),
    peer3: nodeField(room.doc3, "n1", "x"),
    localText: nodeField(room.doc1, "n1", "text"),
    genuineLocal: nodeField(room.doc1, "n3", "y"),
    genuinePeer2: nodeField(room.doc2, "n3", "y"),
    genuinePeer3: nodeField(room.doc3, "n3", "y"),
    newRecordLocal: hasNode(room.doc1, "n4"),
    newRecordPeer2: hasNode(room.doc2, "n4"),
    newRecordPeer3: hasNode(room.doc3, "n4"),
    basisAtSave,
    passes: [...room.passes],
    canonical: canonical(room.doc1),
  };
  room.cs.destroy();
  return readings;
}

const SOURCE = readFileSync(new URL(import.meta.url), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("WP6 AC2 — an unavailable adapter with an open view leaks nothing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 the degraded client's save carries no stale value; its own edit still lands", async () => {
    const readings = await runDegraded();

    expect(
      readings.passes.every((result) => result === "deferred"),
      "the fixture is not degraded",
    ).toBe(true);

    expect(readings.local, "the stale x was written back into the shared doc").toBe(500);
    expect(readings.peer2, "the leak reached peer 2").toBe(500);
    expect(readings.peer3, "the leak reached peer 3").toBe(500);
    expect(readings.localText, "the stale text was written back into the shared doc").toBe(
      "peer two",
    );

    expect(readings.genuineLocal, "the user's own drag was swallowed").toBe(40);
    expect(readings.genuinePeer2).toBe(40);
    expect(readings.genuinePeer3).toBe(40);
  });

  it("T2 a record the open view never received is not deleted by the save that omits it", async () => {
    const readings = await runDegraded();

    expect(readings.newRecordLocal, "the degraded view deleted a card it never received").toBe(
      true,
    );
    expect(readings.newRecordPeer2).toBe(true);
    expect(readings.newRecordPeer3).toBe(true);
  });

  it("T3 the same degradation with the reload surface gone leaks nothing either", async () => {
    const readings = await runDegraded({ degradation: "reload-broken" });

    expect(
      readings.passes.every((result) => result === "structural"),
      "the fixture must actually RUN a pass in this mode",
    ).toBe(true);
    expect(readings.basisAtSave, "an apply that did not land moved the capture basis").toBe(0);
    expect(readings.local).toBe(500);
    expect(readings.peer2).toBe(500);
    expect(readings.peer3).toBe(500);
    expect(readings.newRecordLocal).toBe(true);
    expect(readings.genuinePeer3).toBe(40);
  });

  it("T4 rounds of deltas and saves never accumulate into a revert", async () => {
    const room = await makeRoom();

    // Three rounds, each with a fresh remote value and a fresh local drag — the
    // record ORDER and the values differ every round, so no round can be silently
    // swallowed by the byte echo breaker.
    let y = 40;
    for (const [x, label] of [
      [500, "peer two a"],
      [520, "peer two b"],
      [540, "peer two c"],
    ] as Array<[number, string]>) {
      room.doc2.transact(() => {
        const n1 = room.doc2.getMap<Y.Map<unknown>>("nodes").get("n1");
        n1?.set("x", x);
        n1?.set("text", label);
      });
      push(room.doc2, room.doc1);
      await flushPersistence(room);
      y += 1;
      await dragAndSave(room, "n3", y);

      expect(nodeField(room.doc1, "n1", "x"), `round ${label} reverted the peer`).toBe(x);
      expect(nodeField(room.doc1, "n1", "text")).toBe(label);
    }

    push(room.doc1, room.doc2);
    push(room.doc1, room.doc3);
    for (const doc of [room.doc1, room.doc2, room.doc3]) {
      expect(nodeField(doc, "n1", "x")).toBe(540);
      expect(nodeField(doc, "n1", "text")).toBe("peer two c");
      expect(nodeField(doc, "n3", "y")).toBe(43);
    }
    room.cs.destroy();
  });

  it("T5 recovery: once the private surface returns, the pass lands and the view settles", async () => {
    const room = await makeRoom({ degradation: "reload-broken" });

    remoteDeltas(room, 500, "peer two");
    await flushPersistence(room);
    await dragAndSave(room, "n3", 40);

    expect(getRecordState(room.cs.getSurfaceShadow(), PATH, "node", "n4")).toBe("unknown");

    // The private Canvas surface reappears and the next pass lands.
    expect(room.recover()).toBe("structural");
    expect(room.double.getNode("n1")?.x, "the recovered pass did not reach the view").toBe(500);
    expect(room.double.getNode("n4"), "the never-seen card did not reach the view").toBeDefined();
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
      expect(hasNode(doc, "n4")).toBe(true);
    }
    room.cs.destroy();
  });

  it("T6 the scenario is deterministic and this suite touches no wall clock", async () => {
    const first = await runDegraded();
    const second = await runDegraded();
    expect(second).toEqual(first);
    expect(second.canonical, "two runs produced different CRDT bytes").toBe(first.canonical);

    const firstBroken = await runDegraded({ degradation: "reload-broken" });
    const secondBroken = await runDegraded({ degradation: "reload-broken" });
    expect(secondBroken).toEqual(firstBroken);

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
describe("WP6 AC3 — the degraded-adapter scenario fails with the mechanism disabled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("D1 seam `setShadowRebaseEnabled(false)`: the open view leaks into both peers", async () => {
    const on = await runDegraded();
    const off = await runDegraded({ shadowRebase: false });

    expect(
      off.local,
      "with the capture-side rebase off the save must fall back to observation-as-intent",
    ).toBe(0);
    expect(off.localText, "the stale text must be pushed back too").toBe("contested");
    expect(off.peer2, "the leak must reach peer 2 with the mechanism off").toBe(0);
    expect(off.peer3, "the leak must reach peer 3 with the mechanism off").toBe(0);

    expect(on.peer2).not.toBe(off.peer2);
    expect(on.peer3).not.toBe(off.peer3);
    expect(on.localText).not.toBe(off.localText);
  });

  it("D2 seam `advanceFromReceipt(..., { perFieldReceipt: false })`: the unlanded apply leaks and deletes", async () => {
    const on = await runDegraded({ degradation: "reload-broken" });
    const off = await runDegraded({ degradation: "reload-broken", perFieldReceipt: false });

    expect(
      off.basisAtSave,
      "V1 record-snapshot semantics must mark the unapplied reload as applied",
    ).toBe(500);
    expect(off.local, "the stale view must then read as intent and revert the peer").toBe(0);
    expect(off.peer2).toBe(0);
    expect(off.peer3).toBe(0);
    // The other half of the V1 defect: a hand-over receipt for records the surface
    // never received also unlocks the delete rule, so the degraded view's save
    // removes a card it never saw.
    expect(
      off.newRecordLocal,
      "a hand-over the surface never took must let the save delete an unseen record",
    ).toBe(false);
    expect(off.newRecordPeer2).toBe(false);

    expect(on.basisAtSave).not.toBe(off.basisAtSave);
    expect(on.peer2).not.toBe(off.peer2);
    expect(on.newRecordLocal).not.toBe(off.newRecordLocal);
  });
});
