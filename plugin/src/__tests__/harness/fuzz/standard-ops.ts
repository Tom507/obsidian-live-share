// WP23 / AC1 + AC4 — THE STANDARD OP REGISTRY.
//
// Every op class the initial fuzzer covers lives here, and NOTHING in
// `fuzzer.ts` knows any of their names: the core takes an `OpRegistry` and a
// `bootstrap` callback, so a later phase adds an op class by calling
// `registry.register(...)` and changes not one line of the core (AC4, first
// half).
//
// AC4's second half — "every WP in this spec that changes merge or serialisation
// behaviour is reachable through at least one registered op" — is declared per
// op in `reaches` and asserted by the suite, so an op class cannot quietly stop
// covering the WP it was written for.
//
// WHICH SPELLING AN OP MAY HONESTLY AUTHOR
// ----------------------------------------
// A P1 doc is half-migrated BY DESIGN: `migrateV1ToV2` is additive (it ADDS
// `pos`/`size`/`from`/`to` and KEEPS the flat keys it translated), and the
// capture path still authors the flat vocabulary until the write boundaries move
// to the registers (WP22/WP39). So a record can carry BOTH spellings of one
// fact, and which one the user's intent is spelled in depends on the record:
//
//   ├── a record with flat keys  → the FLAT key is the authored spelling, and a
//   │      register on it is only ever a translation of it. Production's rule
//   │      (`decodeV2RecordToFlat`) is "the flat key wins, independently of
//   │      insertion order", so the intent trace expects the flat value.
//   └── a register-ONLY record   → the register IS the authored spelling.
//
// `dualSpellingWrite` below is the AC5 collision class: it produces a record
// carrying both spellings of the same fact with the register deliberately STALE,
// and varies which spelling was inserted into the `Y.Map` first. That class is
// invisible to SEC, to the schema invariants, to byte equality and to the
// shadow — all four go green while every replica shows the pre-move coordinate.

import * as Y from "yjs";

import { CanvasBinding, type CanvasModelBridge, type CanvasRecord, type LocalChange } from "../../../canvas/canvas-binding";
import {
  encodeEndpoint,
  encodePos,
  encodeSize,
  writePosRegister,
} from "../../../canvas/canvas-registers";
import { applyTombstoneOp } from "../../../canvas/canvas-tombstone";
import { nextTombstoneTime } from "../../../files/canvas-sync";
import {
  type FieldSlot,
  type FileValue,
  type FuzzRecordKind,
  type IntentTrace,
  type TracedRecord,
  visibilitySlot,
  ordSlot,
} from "./intent-trace";
import { OpRegistry, type OpContext } from "./op-registry";
import { container, type FuzzReplica } from "./replica";
import { quiesce } from "./scheduler";

// ---------------------------------------------------------------------------
// The simulated Obsidian surface.
// ---------------------------------------------------------------------------

type FileRecord = Record<string, FileValue>;
interface SurfaceSnapshot {
  node: Map<string, FileRecord>;
  edge: Map<string, FileRecord>;
  window: number;
}

const SNAPSHOT_KEY = "wp23.surface-snapshot";

/**
 * The `.canvas` text this replica's Obsidian would write RIGHT NOW, built from
 * the harness's own model and from nothing else.
 *
 * Never read back from a replica: the file a save carries is what the SURFACE
 * shows, and deriving it from the doc would make every save a tautology and the
 * stale-view simulation impossible.
 */
function buildSurface(trace: IntentTrace, overrides?: ReadonlyMap<string, FileRecord>): SurfaceSnapshot {
  const snapshot: SurfaceSnapshot = { node: new Map(), edge: new Map(), window: -1 };
  for (const kind of ["node", "edge"] as const) {
    for (const record of trace.surfaceRecords(kind)) {
      const fields = { ...trace.expectedRecord(kind, record.id) };
      const override = overrides?.get(`${kind}|${record.id}`);
      if (override) Object.assign(fields, override);
      snapshot[kind].set(record.id, fields);
    }
  }
  return snapshot;
}

function snapshotToText(snapshot: SurfaceSnapshot): string {
  return JSON.stringify(
    {
      nodes: [...snapshot.node.values()],
      edges: [...snapshot.edge.values()],
    },
    null,
    "\t",
  );
}

function cloneSnapshot(snapshot: SurfaceSnapshot, window: number): SurfaceSnapshot {
  return {
    window,
    node: new Map([...snapshot.node].map(([id, fields]) => [id, { ...fields }])),
    edge: new Map([...snapshot.edge].map(([id, fields]) => [id, { ...fields }])),
  };
}

/** Count the Yjs updates one action produces on one replica. */
function countUpdates(replica: FuzzReplica, action: () => Promise<void>): Promise<number> {
  let updates = 0;
  const listener = (): void => {
    updates += 1;
  };
  replica.doc.on("update", listener);
  return action()
    .then(() => updates)
    .finally(() => replica.doc.off("update", listener));
}

/**
 * ONE simulated Obsidian save: write the file, set the view state the save is
 * observed under, and run the REAL capture path (`CanvasSync.handleLocalModify`).
 *
 * `viewOpen` matters: with the view OPEN, a record the shadow holds as present
 * but the save omits — and that the last apply provably handed over — is a
 * DELETE intent. Every op here that does not mean a delete therefore saves with
 * the view closed, so an omission is ignorance rather than deletion.
 */
async function runSave(
  replica: FuzzReplica,
  content: string,
  view: { viewOpen: boolean; handedNodes?: readonly string[]; handedEdges?: readonly string[] },
): Promise<void> {
  replica.surface.viewOpen = view.viewOpen;
  replica.surface.handedToView.node = new Set(view.handedNodes ?? []);
  replica.surface.handedToView.edge = new Set(view.handedEdges ?? []);
  replica.writeFile(content);
  await replica.sync.handleLocalModify(replica.path);
  replica.surface.viewOpen = false;
  replica.surface.handedToView.node = new Set();
  replica.surface.handedToView.edge = new Set();
}

function rememberSurface(replica: FuzzReplica, snapshot: SurfaceSnapshot, content: string, window: number): void {
  replica.lastSavedContent = content;
  replica.lastSavedWindow = window;
  replica.scratch.set(SNAPSHOT_KEY, cloneSnapshot(snapshot, window));
}

/** Claim every slot a whole-surface save could possibly write. */
function claimSurface(ctx: OpContext): boolean {
  const targets: [FuzzRecordKind, string][] = [];
  for (const kind of ["node", "edge"] as const) {
    for (const record of ctx.trace.allRecords(kind)) {
      if (record.saveEligible) targets.push([kind, record.id]);
    }
  }
  for (const [kind, id] of targets) {
    if (!ctx.claims.isFree({ kind, id, field: "x" })) return false;
  }
  for (const [kind, id] of targets) {
    if (!ctx.claims.claimRecord(kind, id)) return false;
  }
  return true;
}

/** Record that this replica's OWN local write landed in its OWN doc (WP21). */
function noteWriteLanded(
  replica: FuzzReplica,
  kind: FuzzRecordKind,
  id: string,
  field: string,
  intended: FileValue,
): void {
  const record = container(replica, kind).get(id);
  replica.writeAdmissions.push({
    replica: replica.index,
    kind,
    id,
    field,
    intended,
    landed: record?.get(field),
  });
}

function logWrite(
  ctx: OpContext,
  opClass: string,
  slot: FieldSlot,
  value: FileValue,
  contested = false,
): void {
  ctx.trace.write({
    window: ctx.window,
    replica: ctx.replica.index,
    opClass,
    slot,
    value,
    contested,
  });
}

// ---------------------------------------------------------------------------
// Bootstrap — the shared world every scenario starts from.
// ---------------------------------------------------------------------------

const GEOMETRY = { width: 240, height: 120 } as const;

function seedRecord(
  map: Y.Map<Y.Map<unknown>>,
  id: string,
  entries: readonly [string, unknown][],
): void {
  const record = new Y.Map<unknown>();
  for (const [key, value] of entries) record.set(key, value);
  map.set(id, record);
}

/**
 * Build the base world on replica 0, declare it in the trace, sync everybody,
 * then let every replica ESTABLISH ITS SURFACE with one honest save.
 *
 * The surface-establishing save is not decoration. `planIntentDiff` classifies a
 * save against the Surface-Shadow, and an EMPTY shadow makes every observed
 * field read as fresh intent — so without it the first save of any replica would
 * replay the whole file as user edits, which is the very cascade V2 removes and
 * would make the first window of every scenario meaningless.
 */
export async function bootstrapStandardWorld(ctx: OpContext): Promise<void> {
  const { trace } = ctx;
  const author = ctx.replicas[0];

  author.doc.transact(() => {
    const nodes = author.nodes();
    const edges = author.edges();

    // Three SURFACE nodes: flat file keys plus the registers, consistent — the
    // shape a migrated record has, and the shape every save-path op authors.
    const surfaceNodes = ["s0", "s1", "s2"];
    surfaceNodes.forEach((id, index) => {
      const x = index * 300;
      const y = 0;
      seedRecord(nodes, id, [
        ["id", id],
        ["type", "text"],
        ["x", x],
        ["y", y],
        ["width", GEOMETRY.width],
        ["height", GEOMETRY.height],
        ["text", `surface ${id}`],
        ["pos", encodePos(x, y)],
        ["size", encodeSize(GEOMETRY.width, GEOMETRY.height)],
      ]);
      trace.declareRecord({ kind: "node", id, shape: "dual", keyOrder: "flatFirst", saveEligible: true });
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "id" }, id);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "type" }, "text");
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "x" }, x);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "y" }, y);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "width" }, GEOMETRY.width);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "height" }, GEOMETRY.height);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "text" }, `surface ${id}`);
    });

    // One SURFACE edge, both spellings, fully connected.
    seedRecord(edges, "se0", [
      ["id", "se0"],
      ["fromNode", "s0"],
      ["fromSide", "right"],
      ["toNode", "s1"],
      ["toSide", "left"],
      ["from", encodeEndpoint("s0", "right")],
      ["to", encodeEndpoint("s1", "left")],
    ]);
    trace.declareRecord({ kind: "edge", id: "se0", shape: "dual", keyOrder: "flatFirst", saveEligible: true });
    logWrite(ctx, "bootstrap", { kind: "edge", id: "se0", field: "id" }, "se0");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "se0", field: "fromNode" }, "s0");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "se0", field: "fromSide" }, "right");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "se0", field: "toNode" }, "s1");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "se0", field: "toSide" }, "left");

    // Two DOC-ONLY dual nodes — the AC5 collision-class targets. They never
    // appear in a save, so no capture-path register repair can hide the
    // collision the fuzzer is looking for.
    ["d0", "d1"].forEach((id, index) => {
      const x = 100 + index * 400;
      const y = 500;
      seedRecord(nodes, id, [
        ["id", id],
        ["type", "text"],
        ["x", x],
        ["y", y],
        ["width", GEOMETRY.width],
        ["height", GEOMETRY.height],
        ["text", `doc ${id}`],
        ["pos", encodePos(x, y)],
        ["size", encodeSize(GEOMETRY.width, GEOMETRY.height)],
      ]);
      trace.declareRecord({ kind: "node", id, shape: "dual", keyOrder: "flatFirst", saveEligible: false });
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "id" }, id);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "type" }, "text");
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "x" }, x);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "y" }, y);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "width" }, GEOMETRY.width);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "height" }, GEOMETRY.height);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "text" }, `doc ${id}`);
    });

    // Two REGISTER-ONLY nodes — what a V2 cold-open seed writes. Here the
    // register IS the authored spelling, and the atomic-contest op needs a
    // record whose position lives in exactly one key.
    ["r0", "r1"].forEach((id, index) => {
      const x = 100 + index * 400;
      const y = 900;
      seedRecord(nodes, id, [
        ["id", id],
        ["type", "text"],
        ["pos", encodePos(x, y)],
        ["size", encodeSize(GEOMETRY.width, GEOMETRY.height)],
        ["text", `register ${id}`],
      ]);
      trace.declareRecord({
        kind: "node",
        id,
        shape: "registerOnly",
        keyOrder: "registerFirst",
        saveEligible: false,
      });
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "id" }, id);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "type" }, "text");
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "x" }, x);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "y" }, y);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "width" }, GEOMETRY.width);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "height" }, GEOMETRY.height);
      logWrite(ctx, "bootstrap", { kind: "node", id, field: "text" }, `register ${id}`);
    });

    // One DOC-ONLY edge between the two doc-only nodes.
    seedRecord(edges, "de0", [
      ["id", "de0"],
      ["fromNode", "d0"],
      ["fromSide", "right"],
      ["toNode", "d1"],
      ["toSide", "left"],
      ["from", encodeEndpoint("d0", "right")],
      ["to", encodeEndpoint("d1", "left")],
    ]);
    trace.declareRecord({ kind: "edge", id: "de0", shape: "dual", keyOrder: "flatFirst", saveEligible: false });
    logWrite(ctx, "bootstrap", { kind: "edge", id: "de0", field: "id" }, "de0");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "de0", field: "fromNode" }, "d0");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "de0", field: "fromSide" }, "right");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "de0", field: "toNode" }, "d1");
    logWrite(ctx, "bootstrap", { kind: "edge", id: "de0", field: "toSide" }, "left");
  });

  quiesce(ctx.replicas, ctx.flushTimers);

  const snapshot = buildSurface(ctx.trace);
  const content = snapshotToText(snapshot);
  for (const replica of ctx.replicas) {
    await runSave(replica, content, { viewOpen: false });
    rememberSurface(replica, snapshot, content, -1);
  }
  quiesce(ctx.replicas, ctx.flushTimers);
}

// ---------------------------------------------------------------------------
// Op helpers.
// ---------------------------------------------------------------------------

function surfaceNodes(trace: IntentTrace): TracedRecord[] {
  return trace.surfaceRecords("node");
}

function docOnly(trace: IntentTrace, kind: FuzzRecordKind, shape?: "dual" | "registerOnly"): TracedRecord[] {
  return trace
    .allRecords(kind)
    .filter(
      (record) =>
        !record.saveEligible &&
        !record.invalid &&
        record.visible &&
        (shape === undefined || record.shape === shape),
    );
}

/** What this replica's OWN simulated Obsidian surface last showed for a field. */
function surfaceValueOf(
  replica: FuzzReplica,
  kind: FuzzRecordKind,
  id: string,
  field: string,
): FileValue | undefined {
  const snapshot = replica.scratch.get(SNAPSHOT_KEY) as SurfaceSnapshot | undefined;
  return snapshot?.[kind].get(id)?.[field];
}

/** Does this replica's own surface carry the record at all? */
function surfaceHolds(replica: FuzzReplica, kind: FuzzRecordKind, id: string): boolean {
  const snapshot = replica.scratch.get(SNAPSHOT_KEY) as SurfaceSnapshot | undefined;
  return snapshot?.[kind].has(id) ?? false;
}

/**
 * Save the whole surface with one field overridden, and log that field as intent.
 *
 * DECLINES when a "changed" value is one this replica's OWN surface already
 * showed. That is not a workaround, it is the Surface-Shadow's rule stated from
 * the other side: a field whose save value equals the shadow value is STALENESS,
 * never intent, and `planIntentDiff` correctly discards it. An op that logged
 * such a write as intent would be asserting that a restatement must overwrite a
 * peer's newer value — the exact cascade V2 exists to remove — so the harness
 * declines instead of inventing an expectation the design forbids.
 */
async function saveWithOverride(
  ctx: OpContext,
  opClass: string,
  kind: FuzzRecordKind,
  id: string,
  changes: Readonly<Record<string, FileValue>>,
): Promise<boolean> {
  for (const [field, value] of Object.entries(changes)) {
    if (Object.is(surfaceValueOf(ctx.replica, kind, id, field), value)) return false;
  }
  if (!claimSurface(ctx)) return false;
  const overrides = new Map<string, FileRecord>([[`${kind}|${id}`, { ...changes }]]);
  const snapshot = buildSurface(ctx.trace, overrides);
  const content = snapshotToText(snapshot);
  await runSave(ctx.replica, content, { viewOpen: false });
  for (const [field, value] of Object.entries(changes)) {
    logWrite(ctx, opClass, { kind, id, field }, value);
    noteWriteLanded(ctx.replica, kind, id, field, value);
  }
  rememberSurface(ctx.replica, snapshot, content, ctx.window);
  return true;
}

// ---------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------

/**
 * The initial op registry: create, move, resize, reroute, relabel, delete, undo
 * and reorder (AC1), plus the five classes the WP links require and the
 * collision class AC5 mandates.
 */
export function createStandardRegistry(): OpRegistry {
  const registry = new OpRegistry();

  // -- AC1: create -------------------------------------------------------
  registry.register({
    name: "createNodeViaSave",
    weight: 3,
    reaches: ["WP18", "WP22", "WP4"],
    note: "the real capture boundary: validated, create-once, upsert-only",
    applicable: (ctx) => surfaceNodes(ctx.trace).length < 8,
    async run(ctx) {
      if (!claimSurface(ctx)) return false;
      const id = ctx.nextId("n");
      const x = ctx.rng.between(0, 30) * 20;
      const y = ctx.rng.between(0, 30) * 20;
      ctx.trace.declareRecord({
        kind: "node",
        id,
        shape: "dual",
        keyOrder: "flatFirst",
        saveEligible: true,
      });
      const fields: FileRecord = {
        id,
        type: "text",
        x,
        y,
        width: GEOMETRY.width,
        height: GEOMETRY.height,
        text: `created ${id}`,
      };
      for (const [field, value] of Object.entries(fields)) {
        logWrite(ctx, "createNodeViaSave", { kind: "node", id, field }, value);
      }
      const snapshot = buildSurface(ctx.trace, new Map([[`node|${id}`, fields]]));
      const content = snapshotToText(snapshot);
      await runSave(ctx.replica, content, { viewOpen: false });
      noteWriteLanded(ctx.replica, "node", id, "x", x);
      rememberSurface(ctx.replica, snapshot, content, ctx.window);
      return true;
    },
  });

  // -- AC1: move ---------------------------------------------------------
  registry.register({
    name: "moveViaSave",
    weight: 6,
    reaches: ["WP4", "WP9", "WP18", "WP21"],
    applicable: (ctx) => surfaceNodes(ctx.trace).length > 0,
    async run(ctx) {
      const target = ctx.rng.pick(surfaceNodes(ctx.trace));
      if (!target) return false;
      return saveWithOverride(ctx, "moveViaSave", "node", target.id, {
        x: ctx.rng.between(0, 40) * 20,
        y: ctx.rng.between(0, 40) * 20,
      });
    },
  });

  // -- AC1: resize -------------------------------------------------------
  registry.register({
    name: "resizeViaSave",
    weight: 3,
    reaches: ["WP4", "WP9", "WP18"],
    applicable: (ctx) => surfaceNodes(ctx.trace).length > 0,
    async run(ctx) {
      const target = ctx.rng.pick(surfaceNodes(ctx.trace));
      if (!target) return false;
      return saveWithOverride(ctx, "resizeViaSave", "node", target.id, {
        width: ctx.rng.between(4, 20) * 40,
        height: ctx.rng.between(2, 12) * 40,
      });
    },
  });

  // -- AC1: reroute ------------------------------------------------------
  registry.register({
    name: "rerouteViaSave",
    weight: 3,
    reaches: ["WP10", "WP18", "WP20"],
    applicable: (ctx) =>
      ctx.trace.surfaceRecords("edge").length > 0 && surfaceNodes(ctx.trace).length >= 2,
    async run(ctx) {
      const edge = ctx.rng.pick(ctx.trace.surfaceRecords("edge"));
      if (!edge) return false;
      const nodes = surfaceNodes(ctx.trace);
      const from = ctx.rng.pick(nodes);
      const to = ctx.rng.pick(nodes.filter((node) => node.id !== from?.id));
      if (!from || !to) return false;
      return saveWithOverride(ctx, "rerouteViaSave", "edge", edge.id, {
        fromNode: from.id,
        fromSide: ctx.rng.pick(["top", "right", "bottom", "left"]) ?? "right",
        toNode: to.id,
        toSide: ctx.rng.pick(["top", "right", "bottom", "left"]) ?? "left",
      });
    },
  });

  // -- AC1: relabel ------------------------------------------------------
  registry.register({
    name: "relabelViaSave",
    weight: 4,
    reaches: ["WP4", "WP17"],
    note:
      "P1 `text` is a plain LWW string field. COLLABORATIVE TEXT EDITING (a nested " +
      "`Y.Text` with character-level merge) does NOT exist yet — that is WP36 — so this " +
      "op exercises whole-value replacement and nothing finer. It is not a stand-in for it.",
    applicable: (ctx) => surfaceNodes(ctx.trace).length > 0,
    async run(ctx) {
      const target = ctx.rng.pick(surfaceNodes(ctx.trace));
      if (!target) return false;
      return saveWithOverride(ctx, "relabelViaSave", "node", target.id, {
        text: `edited w${ctx.window} by r${ctx.replica.index}`,
      });
    },
  });

  // -- AC1: delete (WP19) ------------------------------------------------
  registry.register({
    name: "deleteViaSave",
    weight: 3,
    reaches: ["WP19", "WP12", "WP17"],
    applicable: (ctx) => surfaceNodes(ctx.trace).length >= 3 || ctx.trace.surfaceRecords("edge").length > 0,
    async run(ctx) {
      // The target must be a record THIS replica's own surface carries. Rule 4
      // only produces a delete intent for a record the shadow holds as
      // `present`: absence from a save the shadow never saw is ignorance, not
      // deletion, and a harness that expected a tombstone from it would be
      // asserting the opposite of the rule.
      const edges = ctx.trace
        .surfaceRecords("edge")
        .filter((record) => surfaceHolds(ctx.replica, "edge", record.id));
      const nodes = surfaceNodes(ctx.trace).filter((record) =>
        surfaceHolds(ctx.replica, "node", record.id),
      );
      const kind: FuzzRecordKind = edges.length > 0 && ctx.rng.bool(0.4) ? "edge" : "node";
      const pool = kind === "edge" ? edges : nodes;
      if (kind === "node" && pool.length < 3) return false;
      const target = ctx.rng.pick(pool);
      if (!target) return false;
      if (!claimSurface(ctx)) return false;

      // The content OMITS the target; the view is OPEN and the target is the one
      // id the last apply provably handed over. Absence without that proof is
      // ignorance, not deletion — which is why nothing else is handed over here.
      target.visible = false;
      const snapshot = buildSurface(ctx.trace);
      const content = snapshotToText(snapshot);
      await runSave(ctx.replica, content, {
        viewOpen: true,
        handedNodes: kind === "node" ? [target.id] : [],
        handedEdges: kind === "edge" ? [target.id] : [],
      });
      logWrite(ctx, "deleteViaSave", visibilitySlot(kind, target.id), false);
      rememberSurface(ctx.replica, snapshot, content, ctx.window);
      return true;
    },
  });

  // -- AC1: undo (WP19) --------------------------------------------------
  registry.register({
    name: "undoDelete",
    weight: 3,
    reaches: ["WP19", "WP12"],
    note:
      "WP38 owns real UI undo and does not exist yet. What the spec says an undo IS — " +
      "one more `applyTombstoneOp` with `on:false`, stamped strictly above the delete it " +
      "reverses — is exactly what this issues. It does not simulate an undo stack.",
    applicable: (ctx) =>
      ctx.trace
        .allRecords("node")
        .concat(ctx.trace.allRecords("edge"))
        .some((record) => !record.visible && !record.invalid),
    run(ctx) {
      const deleted = ctx.trace
        .allRecords("node")
        .concat(ctx.trace.allRecords("edge"))
        .filter((record) => !record.visible && !record.invalid);
      const target = ctx.rng.pick(deleted);
      if (!target) return false;
      if (!ctx.claims.claimRecord(target.kind, target.id)) return false;

      const deletedMap = ctx.replica.deleted();
      ctx.replica.doc.transact(() => {
        applyTombstoneOp(deletedMap, target.id, {
          t: nextTombstoneTime(deletedMap),
          by: String(ctx.replica.doc.clientID),
          on: false,
        });
      });
      target.visible = true;
      logWrite(ctx, "undoDelete", visibilitySlot(target.kind, target.id), true);
      return true;
    },
  });

  // -- AC1: reorder (WP13 / WP17) ---------------------------------------
  registry.register({
    name: "reorderRecord",
    weight: 3,
    reaches: ["WP13", "WP17"],
    applicable: (ctx) => ctx.trace.allRecords("node").length > 0,
    run(ctx) {
      const pool = ctx.trace.allRecords("node").filter((record) => record.visible && !record.invalid);
      const target = ctx.rng.pick(pool);
      if (!target) return false;
      if (!ctx.claims.claim(ordSlot("node", target.id))) return false;
      // A plain, totally ordered alphabet. The oracle re-derives the expected
      // ORDER from these strings with its OWN comparator, never `compareOrdId`.
      const ord = `o${String.fromCharCode(97 + ctx.rng.int(20))}${ctx.window}`;
      const record = ctx.replica.nodes().get(target.id);
      if (!record) return false;
      ctx.replica.doc.transact(() => record.set("ord", ord));
      target.ord = ord;
      logWrite(ctx, "reorderRecord", ordSlot("node", target.id), ord);
      return true;
    },
  });

  // -- AC5: THE COLLISION CLASS -----------------------------------------
  registry.register({
    name: "dualSpellingWrite",
    weight: 6,
    reaches: ["WP17", "WP18", "WP9"],
    note:
      "AC5's mandated op class: one record carrying BOTH the flat and the register " +
      "spelling of the same fact, with the insertion order varied. Invisible to SEC, " +
      "schema, bytes and shadow alike.",
    applicable: () => true,
    run(ctx) {
      const existing = docOnly(ctx.trace, "node", "dual");
      const nextX = ctx.rng.between(0, 40) * 20;
      const nextY = ctx.rng.between(0, 40) * 20;

      // BRANCH 1 — MOVE a record that already carries both spellings, by
      // writing the FLAT keys ONLY. Nothing repairs the register on a record
      // that never goes through a save, so from this moment the two spellings
      // disagree and the doc→file projection has to pick by a RULE.
      if (existing.length > 0 && ctx.rng.bool(0.5)) {
        const target = ctx.rng.pick(existing);
        if (!target) return false;
        if (!ctx.claims.claimRecord("node", target.id)) return false;
        const record = ctx.replica.nodes().get(target.id);
        if (!record) return false;
        ctx.replica.doc.transact(() => {
          record.set("x", nextX);
          record.set("y", nextY);
        });
        logWrite(ctx, "dualSpellingWrite", { kind: "node", id: target.id, field: "x" }, nextX);
        logWrite(ctx, "dualSpellingWrite", { kind: "node", id: target.id, field: "y" }, nextY);
        return true;
      }

      // BRANCH 2 — CREATE a record carrying BOTH spellings of the same fact,
      // with the register deliberately holding the PRE-MOVE value and the
      // INSERTION ORDER of the two spellings varied.
      //
      // This is not a contrived state. `migrateV1ToV2` is deliberately ADDITIVE:
      // it adds `pos`/`size` built at migration time and KEEPS the flat keys,
      // and every live writer on this build then moves the card by writing the
      // FLAT keys. From then on the register is a stale translation sitting in
      // the same record, and which of the two the file shows was — before WP17
      // AC5 — decided by whichever key happened to be inserted first.
      const id = ctx.nextId("dual");
      const staleX = ctx.rng.between(0, 40) * 20;
      const staleY = ctx.rng.between(0, 40) * 20;
      const order: "flatFirst" | "registerFirst" = ctx.rng.bool() ? "flatFirst" : "registerFirst";
      const flatEntries: [string, unknown][] = [
        ["x", nextX],
        ["y", nextY],
        ["width", GEOMETRY.width],
        ["height", GEOMETRY.height],
      ];
      const registerEntries: [string, unknown][] = [
        ["pos", encodePos(staleX, staleY)],
        ["size", encodeSize(GEOMETRY.width, GEOMETRY.height)],
      ];
      const entries: [string, unknown][] = [
        ["id", id],
        ["type", "text"],
        ...(order === "flatFirst"
          ? [...flatEntries, ...registerEntries]
          : [...registerEntries, ...flatEntries]),
        ["text", `dual ${id}`],
      ];
      ctx.replica.doc.transact(() => {
        seedRecord(ctx.replica.nodes(), id, entries);
      });
      ctx.trace.declareRecord({
        kind: "node",
        id,
        shape: "dual",
        keyOrder: order,
        saveEligible: false,
      });
      // THE INTENT: the user moved the card, and the vocabulary the live writer
      // authored it in is the FLAT one. The register is only ever a translation.
      logWrite(ctx, "dualSpellingWrite", { kind: "node", id, field: "id" }, id);
      logWrite(ctx, "dualSpellingWrite", { kind: "node", id, field: "type" }, "text");
      logWrite(ctx, "dualSpellingWrite", { kind: "node", id, field: "x" }, nextX);
      logWrite(ctx, "dualSpellingWrite", { kind: "node", id, field: "y" }, nextY);
      logWrite(ctx, "dualSpellingWrite", { kind: "node", id, field: "width" }, GEOMETRY.width);
      logWrite(ctx, "dualSpellingWrite", { kind: "node", id, field: "height" }, GEOMETRY.height);
      logWrite(ctx, "dualSpellingWrite", { kind: "node", id, field: "text" }, `dual ${id}`);
      return true;
    },
  });

  // -- register-only geometry (WP9 / WP10 / WP17) ------------------------
  registry.register({
    name: "moveRegisterOnly",
    weight: 3,
    reaches: ["WP9", "WP17"],
    applicable: (ctx) => docOnly(ctx.trace, "node", "registerOnly").length > 0,
    run(ctx) {
      const target = ctx.rng.pick(docOnly(ctx.trace, "node", "registerOnly"));
      if (!target) return false;
      if (!ctx.claims.claimRecord("node", target.id)) return false;
      const record = ctx.replica.nodes().get(target.id);
      if (!record) return false;
      const x = ctx.rng.between(0, 40) * 20;
      const y = ctx.rng.between(0, 40) * 20;
      ctx.replica.doc.transact(() => {
        writePosRegister(record as unknown as { get(k: string): unknown; set(k: string, v: unknown): unknown }, encodePos(x, y));
      });
      logWrite(ctx, "moveRegisterOnly", { kind: "node", id: target.id, field: "x" }, x);
      logWrite(ctx, "moveRegisterOnly", { kind: "node", id: target.id, field: "y" }, y);
      return true;
    },
  });

  // -- WP22: partial capture --------------------------------------------
  registry.register({
    name: "partialCapture",
    weight: 4,
    reaches: ["WP22"],
    note: "a capture observing ONE field of a record — I7, observation never deletes",
    applicable: (ctx) => docOnly(ctx.trace, "node").length + docOnly(ctx.trace, "edge").length > 0,
    run(ctx) {
      const pool = [...docOnly(ctx.trace, "node"), ...docOnly(ctx.trace, "edge")];
      const target = ctx.rng.pick(pool);
      if (!target) return false;
      const slot: FieldSlot = { kind: target.kind, id: target.id, field: "label" };
      if (!ctx.claims.claim(slot)) return false;
      const map = container(ctx.replica, target.kind);
      const record = map.get(target.id);
      if (!record) return false;

      const before = new Map<string, unknown>();
      for (const [key, value] of record) before.set(key, value);

      const label = `tag-${ctx.window}-${ctx.replica.index}`;
      const binding = new CanvasBinding(ctx.replica.doc, new InertBridge(), {
        seedModelFromDoc: false,
      });
      binding.captureLocal({
        kind: target.kind,
        id: target.id,
        record: { id: target.id, label } as CanvasRecord,
      });
      binding.destroy();

      // THE I7 ASSERTION. Everything the capture did NOT mention must still be
      // there, with the value it had. A capture is a PARTIAL OBSERVATION; an
      // absent key carries no intent at all.
      const after = map.get(target.id);
      for (const [key, value] of before) {
        if (key === "label") continue;
        if (after === undefined || !after.has(key)) {
          ctx.replica.fieldRemovals.push({
            replica: ctx.replica.index,
            kind: target.kind,
            id: target.id,
            field: key,
            before: value,
          });
          continue;
        }
        const now = after.get(key);
        if (now !== value && JSON.stringify(now) !== JSON.stringify(value)) {
          ctx.replica.fieldRemovals.push({
            replica: ctx.replica.index,
            kind: target.kind,
            id: target.id,
            field: key,
            before: value,
          });
        }
      }

      logWrite(ctx, "partialCapture", slot, label);
      noteWriteLanded(ctx.replica, target.kind, target.id, "label", label);
      return true;
    },
  });

  // -- WP20: fault injection + quarantine lift ---------------------------
  registry.register({
    name: "injectInvalidEdge",
    weight: 3,
    reaches: ["WP20", "WP14"],
    note: "writes an invalid record DIRECTLY into one replica, so the auditor is exercised under concurrency",
    applicable: (ctx) => docOnly(ctx.trace, "node").length > 0,
    run(ctx) {
      const anchor = ctx.rng.pick(docOnly(ctx.trace, "node"));
      if (!anchor) return false;
      const id = ctx.nextId("bad");
      ctx.replica.doc.transact(() => {
        seedRecord(ctx.replica.edges(), id, [
          ["id", id],
          ["from", encodeEndpoint(anchor.id, "right")],
        ]);
      });
      ctx.trace.declareRecord({
        kind: "edge",
        id,
        shape: "registerOnly",
        keyOrder: "registerFirst",
        saveEligible: false,
        invalid: true,
      });
      logWrite(ctx, "injectInvalidEdge", visibilitySlot("edge", id), false);
      return true;
    },
  });

  registry.register({
    name: "repairInvalidEdge",
    weight: 3,
    reaches: ["WP20", "WP14", "WP10"],
    applicable: (ctx) =>
      ctx.trace.allRecords("edge").some((record) => record.invalid) &&
      docOnly(ctx.trace, "node").length >= 2,
    run(ctx) {
      const broken = ctx.rng.pick(ctx.trace.allRecords("edge").filter((record) => record.invalid));
      if (!broken) return false;
      if (!ctx.claims.claimRecord("edge", broken.id)) return false;
      const nodes = docOnly(ctx.trace, "node");
      const from = nodes[0];
      const to = nodes[1];
      if (!from || !to) return false;
      const record = ctx.replica.edges().get(broken.id);
      if (!record) return false;
      ctx.replica.doc.transact(() => {
        record.set("from", encodeEndpoint(from.id, "right"));
        record.set("to", encodeEndpoint(to.id, "left"));
      });
      broken.invalid = false;
      broken.visible = true;
      logWrite(ctx, "repairInvalidEdge", visibilitySlot("edge", broken.id), true);
      logWrite(ctx, "repairInvalidEdge", { kind: "edge", id: broken.id, field: "fromNode" }, from.id);
      logWrite(ctx, "repairInvalidEdge", { kind: "edge", id: broken.id, field: "fromSide" }, "right");
      logWrite(ctx, "repairInvalidEdge", { kind: "edge", id: broken.id, field: "toNode" }, to.id);
      logWrite(ctx, "repairInvalidEdge", { kind: "edge", id: broken.id, field: "toSide" }, "left");
      return true;
    },
  });

  // -- AC1: the STALE-VIEW Obsidian save (the W1 discriminant) -----------
  registry.register({
    name: "staleObsidianSave",
    weight: 5,
    reaches: ["WP4", "WP5", "WP22"],
    note: "replays a view model that is at least two windows old — deliberately stale",
    applicable(ctx) {
      const snapshot = ctx.replica.scratch.get(SNAPSHOT_KEY) as SurfaceSnapshot | undefined;
      return snapshot !== undefined && snapshot.window <= ctx.window - 2;
    },
    async run(ctx) {
      const snapshot = ctx.replica.scratch.get(SNAPSHOT_KEY) as SurfaceSnapshot | undefined;
      if (!snapshot) return false;
      if (!claimSurface(ctx)) return false;

      // Which of the stale surface's fields the world has genuinely moved past.
      // Only writes from a STRICTLY EARLIER window count: a value written in
      // THIS window may not have reached this replica yet, and calling that a
      // stale push would be the harness's error, not the implementation's.
      const superseded: {
        kind: FuzzRecordKind;
        id: string;
        field: string;
        stale: FileValue;
        expected: FileValue;
      }[] = [];
      for (const kind of ["node", "edge"] as const) {
        for (const [id, fields] of snapshot[kind]) {
          if (!ctx.trace.expectedVisible(kind, id)) continue;
          for (const [field, stale] of Object.entries(fields)) {
            const expectation = ctx.trace.expect({ kind, id, field });
            if (expectation?.kind !== "determinate") continue;
            if (expectation.by.window >= ctx.window) continue;
            if (Object.is(expectation.value, stale)) continue;
            superseded.push({ kind, id, field, stale, expected: expectation.value });
          }
        }
      }
      if (superseded.length === 0) return false;

      // The stale save must carry ONE genuine new intent, or the byte echo
      // breaker recognises it as this client's own last write and the pass never
      // runs at all — a save that is byte-identical to `lastWrittenContent` is
      // correctly a no-op, and a fuzzer that only ever produced those would be
      // asserting over a capture path it never invoked.
      const carrier = ctx.rng.pick(
        [...snapshot.node.keys()].filter((id) => ctx.trace.expectedVisible("node", id)),
      );
      if (!carrier) return false;
      const freshText = `stale-carrier w${ctx.window} r${ctx.replica.index}`;
      const staleContent = snapshotToText({
        window: snapshot.window,
        node: new Map(
          [...snapshot.node].map(([id, fields]) => [
            id,
            id === carrier ? { ...fields, text: freshText } : { ...fields },
          ]),
        ),
        edge: new Map([...snapshot.edge].map(([id, fields]) => [id, { ...fields }])),
      });

      await runSave(ctx.replica, staleContent, { viewOpen: false });
      logWrite(ctx, "staleObsidianSave", { kind: "node", id: carrier, field: "text" }, freshText);

      // THE W1 DISCRIMINANT. A field the stale surface re-stated, and that the
      // world has moved past, must NOT have been pushed back over the newer
      // value. The verdict is read from this replica's own doc — the surface
      // never saw the newer value, so the shadow is the only thing that can tell
      // restatement from intent.
      for (const entry of superseded) {
        const record = container(ctx.replica, entry.kind).get(entry.id);
        const held = record?.get(entry.field);
        if (Object.is(held, entry.stale) && !Object.is(entry.stale, entry.expected)) {
          ctx.replica.stalePushes.push({
            replica: ctx.replica.index,
            kind: entry.kind,
            id: entry.id,
            field: entry.field,
            staleValue: entry.stale,
            expectedValue: entry.expected,
          });
        }
      }

      const replayed = cloneSnapshot(snapshot, ctx.window);
      const carried = replayed.node.get(carrier);
      if (carried) carried.text = freshText;
      ctx.replica.lastSavedContent = staleContent;
      ctx.replica.lastSavedWindow = ctx.window;
      ctx.replica.scratch.set(SNAPSHOT_KEY, replayed);
      return true;
    },
  });

  // -- WP21: concurrent same-field writes, both allowed to land ----------
  registry.register({
    name: "contendedFieldWrite",
    weight: 4,
    reaches: ["WP21", "WP4"],
    note: "the empirical backing for WP21: with the write gate gone, both writes land and the run still converges",
    applicable: (ctx) =>
      ctx.replicas.length >= 3 &&
      surfaceNodes(ctx.trace).length > 0 &&
      ctx.replicas.some((peer) => ctx.partitionOf(peer.index) !== ctx.partitionOf(ctx.replica.index)),
    async run(ctx) {
      const peer = ctx.rng.pick(
        ctx.replicas.filter(
          (candidate) => ctx.partitionOf(candidate.index) !== ctx.partitionOf(ctx.replica.index),
        ),
      );
      const target = ctx.rng.pick(surfaceNodes(ctx.trace));
      if (!peer || !target) return false;
      if (!claimSurface(ctx)) return false;

      const authors: [FuzzReplica, string][] = [
        [ctx.replica, `contended-A w${ctx.window}`],
        [peer, `contended-B w${ctx.window}`],
      ];
      for (const [replica, text] of authors) {
        const snapshot = buildSurface(ctx.trace, new Map([[`node|${target.id}`, { text }]]));
        const content = snapshotToText(snapshot);
        await runSave(replica, content, { viewOpen: false });
        // Neither write may be DENIED. WP21 removed the lock write-gate, so a
        // local write always reaches the local doc; a value that failed to land
        // is a write-denial artefact.
        noteWriteLanded(replica, "node", target.id, "text", text);
        // And no BASELINE-HOLD artefact: the echo baseline advanced with the
        // write, so replaying the identical content is recognised as this
        // client's own bytes and produces nothing. Under the removed gate the
        // baseline was withheld and this replayed the whole file as intent.
        const replayed = await countUpdates(replica, () => runSave(replica, content, { viewOpen: false }));
        if (replayed > 0) {
          replica.lwwArtefacts.push(
            `replaying its own just-saved content produced ${replayed} Yjs update(s) — the echo ` +
              `baseline was held back after a write to node/${target.id}.text`,
          );
        }
        rememberSurface(replica, snapshot, content, ctx.window);
        logWrite(ctx, "contendedFieldWrite", { kind: "node", id: target.id, field: "text" }, text, true);
      }
      return true;
    },
  });

  // -- I8: concurrent writes to ONE atomic register ----------------------
  registry.register({
    name: "contendedAtomicRegister",
    weight: 3,
    reaches: ["WP9", "WP21"],
    note: "two peers dragging the same card: the winner must be ONE author's whole [x, y]",
    applicable: (ctx) =>
      docOnly(ctx.trace, "node", "registerOnly").length > 0 &&
      ctx.replicas.some((peer) => ctx.partitionOf(peer.index) !== ctx.partitionOf(ctx.replica.index)),
    run(ctx) {
      const peer = ctx.rng.pick(
        ctx.replicas.filter(
          (candidate) => ctx.partitionOf(candidate.index) !== ctx.partitionOf(ctx.replica.index),
        ),
      );
      const target = ctx.rng.pick(docOnly(ctx.trace, "node", "registerOnly"));
      if (!peer || !target) return false;
      if (!ctx.claims.claimRecord("node", target.id)) return false;

      const pairs: [number, number][] = [
        [ctx.rng.between(0, 20) * 20, ctx.rng.between(0, 20) * 20],
        [ctx.rng.between(21, 40) * 20, ctx.rng.between(21, 40) * 20],
      ];
      const authors: [FuzzReplica, [number, number]][] = [
        [ctx.replica, pairs[0]],
        [peer, pairs[1]],
      ];
      for (const [replica, [x, y]] of authors) {
        const record = replica.nodes().get(target.id);
        if (!record) return false;
        replica.doc.transact(() => {
          writePosRegister(
            record as unknown as { get(k: string): unknown; set(k: string, v: unknown): unknown },
            encodePos(x, y),
          );
        });
        logWrite(ctx, "contendedAtomicRegister", { kind: "node", id: target.id, field: "x" }, x, true);
        logWrite(ctx, "contendedAtomicRegister", { kind: "node", id: target.id, field: "y" }, y, true);
      }
      ctx.trace.declarePairedContest({
        window: ctx.window,
        kind: "node",
        id: target.id,
        fields: ["x", "y"],
        candidates: pairs.map(([x, y]) => [x, y]),
      });
      return true;
    },
  });

  return registry;
}

/**
 * A bridge that does nothing. `partialCapture` needs a `CanvasModelBridge` to
 * construct a `CanvasBinding`, but the binding is being used ONLY as the WP22
 * write path — the model side is irrelevant and must not react.
 */
class InertBridge implements CanvasModelBridge {
  getNodeIds(): Iterable<string> {
    return [];
  }
  getEdgeIds(): Iterable<string> {
    return [];
  }
  getNode(): CanvasRecord | null {
    return null;
  }
  getEdge(): CanvasRecord | null {
    return null;
  }
  applyNodeUpsert(): void {}
  applyNodeRemove(): void {}
  applyEdgeUpsert(): void {}
  applyEdgeRemove(): void {}
  onLocalChange(_cb: (change: LocalChange) => void): () => void {
    return () => {};
  }
}

/** The WPs the initial registry claims to reach. Asserted by the suite (AC4). */
export const REQUIRED_WP_COVERAGE: readonly string[] = [
  "WP4",
  "WP9",
  "WP10",
  "WP12",
  "WP13",
  "WP14",
  "WP17",
  "WP18",
  "WP19",
  "WP20",
  "WP21",
  "WP22",
];
