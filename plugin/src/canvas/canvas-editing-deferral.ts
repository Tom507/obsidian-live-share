// WP37 (C37) — the editing-aware deferral: THE DECISION, headless.
//
// WHAT THIS FIXES
// ---------------
// The owner's report is *"manchmal verschluckt er noch Buchstaben"*. Measured on
// two live instances, the chain is:
//
//   reconcile-plan.ts   any NON-GEOMETRY remote difference  =>  verdict "structural"
//   main.ts             "structural" is executed as a full reloadCanvasData/setData
//   main.ts             the ONLY guard is `if (adapter.isBusy()) return;`
//   canvas-adapter.ts   isBusy() was DRAG-ONLY — it had no editing arm at all
//
// and the *measured* loss condition is narrower than the chain suggests, which
// is exactly why it is *"manchmal"*: Obsidian's `setData` reuses existing nodes,
// so handing it a record whose fields already match the live card is a no-op and
// the inline editor survives. The characters are destroyed when the incoming
// record for the card being edited DIFFERS from what that card currently holds —
// i.e. when a peer touches the SAME card. Reproduced deterministically, RED,
// before this module existed (`H:\tmp\liveshare_wp37_e2e.py`, scenario S3).
//
// THE SHAPE OF THE FIX
// --------------------
// Per RECORD, not per pass. Today's gate drops the WHOLE pass, which is why an
// unrelated card is held hostage by an editor on some other card; and it drops it
// FOREVER, because "the next delta" may never come.
//
//   ├── "proceed"    nothing is being edited — byte-identical behaviour to HEAD
//   ├── "defer-drag" a drag, not an edit — byte-identical behaviour to HEAD
//   ├── "substitute" the edited record is replaced by WHAT THE SURFACE ALREADY
//   │                HOLDS before the data reaches `setData`, so the reload is a
//   │                no-op for that one card and a real apply for every other.
//   │                The editor is never rebuilt; the rest of the board updates.
//   └── "hold"       the pass cannot be made harmless for the edited card (a
//                    membership change rebuilds the view whatever we substitute),
//                    so nothing reaches the surface and everything is queued.
//
// WHAT IS DEFERRED IS THE **VIEW** APPLY, NEVER THE DISK WRITE. `CanvasPersistence`
// keeps writing the converged file the whole time. That asymmetry is what makes
// deferral safe: the data is never at risk, only the pixels are briefly stale.
//
// PURITY CONTRACT (the `reconcile-plan.ts` precedent): no clock, no DOM, no
// Obsidian import, no adapter read. Every fact it needs is an argument.
//
// WHAT THIS FILE MUST NOT DO
// --------------------------
//   * It does NOT change `ReconcilePlan`'s verdict set and does NOT make
//     `planReconcile` editing-aware. The deferral happens at EXECUTION, after the
//     classifier has spoken (C37 §2).
//   * It does NOT touch the drag watchdog. Drag stays exactly as it was.

import type { CanvasRecords, ReconcilePlan } from "./reconcile-plan";
import { canvasIds } from "./reconcile-plan";

/**
 * How long the BLUR drain waits before re-applying, in ms.
 *
 * Not a cosmetic delay — draining immediately would re-commit the very defect
 * this WP exists to fix. At blur Obsidian first commits the editor's text into
 * its node model and then saves the file, and `handleLocalModify` turns that save
 * into this client's capture. A drain that runs before that capture lands would
 * put the withheld REMOTE value on the surface, Obsidian would save THAT, and the
 * characters the user just typed would be gone — with WP37's own drain as the
 * mechanism.
 *
 * So the drain waits for the capture window to close. By then the local text is
 * in the shared doc, `planReconcile` sees the view already matching, and the
 * drained pass is a `noop` — which is the correct outcome, not a wasted one.
 */
export const CANVAS_EDIT_DRAIN_DELAY_MS = 2500;

/** What `reconcileLiveCanvas` should do with this pass. Executed, never decided, by main.ts. */
export type EditingDeferralMode = "proceed" | "defer-drag" | "substitute" | "hold";

/** The gate verdict that replaces the raw `if (adapter.isBusy()) return;` read. */
export type BusyGateVerdict = "proceed" | "defer-drag" | "editing";

/**
 * `isBusy()` is now true for TWO different states, and they call for opposite
 * treatment: a drag wants the pass dropped (a drag lasts a second and the view
 * catches up), an edit wants it DEFERRED PER RECORD (an edit lasts as long as the
 * user types, which is the window in which a dropped pass is most visible).
 *
 * Told apart HERE rather than in `main.ts`, so `main.ts` executes a verdict
 * instead of holding a conditional over canvas state (C37 §2 / BUILD_SPEC §3.1 S11).
 */
export function classifyBusyGate(input: {
  busy: boolean;
  editingNodeId: string | null;
}): BusyGateVerdict {
  if (input.editingNodeId !== null && input.editingNodeId !== undefined) return "editing";
  return input.busy === true ? "defer-drag" : "proceed";
}

/** One record whose apply to the VIEW was withheld this pass. */
export interface DeferredRecord {
  kind: "node";
  id: string;
  /** The desired fields that did not reach the surface. Detached. */
  fields: Record<string, unknown>;
}

export interface EditingDeferralInput {
  /** Canonical `.canvas` path. */
  path: string;
  /** Shared truth the pass wants on the surface. */
  desired: CanvasRecords;
  /** What the shadow says is on the surface; null before the first apply. */
  lastApplied: CanvasRecords | null;
  /** Ids currently in the live view. */
  liveNodeIds: ReadonlySet<string>;
  liveEdgeIds: ReadonlySet<string>;
  /** The verdict `planReconcile` already returned. NOT recomputed here. */
  plan: ReconcilePlan;
  /** An authoritative pass (fresh mount, loser-revert). */
  initial: boolean;
  /** The node whose inline editor is focused, or null. */
  editingNodeId: string | null;
  /**
   * The live card's OWN record, read from the adapter (`getNodeFields`). This is
   * what makes the substitution provably a no-op: it is not a guess at what the
   * surface holds, it is what the surface says it holds.
   */
  editingSurfaceRecord: Record<string, unknown> | null;
}

export interface EditingDeferralDecision {
  mode: EditingDeferralMode;
  editingNodeId: string | null;
  /** What to hand to the surface. Identical (by reference) to `desired` unless something was held. */
  surfaceData: CanvasRecords;
  /** Record ids withheld from the surface this pass. */
  heldNodeIds: string[];
  /** What to queue. Empty when nothing differed for the held record. */
  deferred: DeferredRecord[];
  /** Why, in one line, for the debug log. Never an oracle — state is the oracle. */
  reason: string;
}

function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Shallow field equality over the union of both records' own keys. */
export function sameRecordFields(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  if (!a || !b) return false;
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function findById(
  records: ReadonlyArray<Record<string, unknown>>,
  id: string,
): Record<string, unknown> | null {
  for (const record of records) {
    if (record && record.id === id) return record;
  }
  return null;
}

function proceed(input: EditingDeferralInput, reason: string): EditingDeferralDecision {
  return {
    mode: "proceed",
    editingNodeId: input.editingNodeId ?? null,
    surfaceData: input.desired,
    heldNodeIds: [],
    deferred: [],
    reason,
  };
}

/**
 * Decide what this pass may put on the surface while an inline editor is open.
 *
 * Total and defensive: every unusable input degrades to `"hold"`, which withholds
 * the VIEW apply and nothing else. Holding is always safe — the file stays
 * converged and the queue is drained at blur — so "I could not prove this is
 * harmless" resolves to the harmless answer (I11: never turn an unknown into a
 * destructive act).
 */
export function planEditingDeferral(input: EditingDeferralInput): EditingDeferralDecision {
  const editingNodeId = input.editingNodeId ?? null;
  if (editingNodeId === null) return proceed(input, "no inline editor is focused");

  // An authoritative pass exists to REPLACE the view wholesale (a fresh mount, a
  // loser-revert). It cannot be made a no-op for one card, so it is held rather
  // than half-executed.
  if (input.initial === true) {
    return hold(input, editingNodeId, "an authoritative (initial) pass cannot spare an editor");
  }

  // The card being edited is not in the incoming data at all: it is being removed
  // remotely. There is nothing to substitute, and yanking a card out from under a
  // live editor is exactly the class of thing this WP exists to stop, so the pass
  // is held whole and the removal lands at the drain.
  const desiredRecord = findById(input.desired.nodes, editingNodeId);
  if (!desiredRecord) {
    return hold(input, editingNodeId, `the edited card '${editingNodeId}' is absent from the pass`);
  }

  // NOTE — a membership change (a card or arrow added or removed elsewhere on the
  // board) is deliberately NOT held. It was, in the first build, on the reasoning
  // that `setData` rebuilds the view wholesale. MEASURED on the live rig and that
  // reasoning is wrong: Obsidian reuses existing cards, so a card added by a peer
  // arrives while the editor keeps its unflushed characters (run 035215, S3,
  // PASSING on the unmodified tree). Holding it therefore bought nothing and cost
  // a board that stops updating for as long as somebody is typing — a stale view,
  // which is the failure mode this WP is not allowed to introduce.
  const desiredNodeIds = canvasIds(input.desired.nodes);
  const desiredEdgeIds = canvasIds(input.desired.edges);
  const membershipChanged =
    !sameIdSet(desiredNodeIds, input.liveNodeIds) ||
    !sameIdSet(desiredEdgeIds, input.liveEdgeIds);

  // What the surface holds for that card. The adapter's live read is preferred
  // because it is a MEASUREMENT of the surface; the shadow is the fallback,
  // because it is this client's best RECORD of the surface. With neither, nothing
  // can be proven harmless — hold.
  const surfaceRecord =
    input.editingSurfaceRecord ??
    (input.lastApplied ? findById(input.lastApplied.nodes, editingNodeId) : null);
  if (!surfaceRecord) {
    return hold(
      input,
      editingNodeId,
      `no readable surface state for the edited card '${editingNodeId}'`,
    );
  }

  // Nothing about the edited card is changing: the pass is already harmless for
  // it, so it runs unmodified and nothing is queued. Stated explicitly rather
  // than falling out of the substitution, because "we deferred nothing" and "we
  // deferred something that happened to be equal" are different facts.
  if (sameRecordFields(desiredRecord, surfaceRecord)) {
    return proceed(
      input,
      `the edited card '${editingNodeId}' is unchanged by this pass` +
        (membershipChanged ? " (membership changed elsewhere; applied in full)" : ""),
    );
  }

  // THE SUBSTITUTION. Every other record keeps its desired value; the edited one
  // is replaced by what the surface already holds, so `setData` writes it back
  // unchanged and Obsidian's node-reuse leaves the live editor — and the
  // characters in it — completely alone.
  const nodes = input.desired.nodes.map((record) =>
    record && record.id === editingNodeId ? { ...surfaceRecord } : record,
  );
  return {
    mode: "substitute",
    editingNodeId,
    surfaceData: { nodes, edges: input.desired.edges },
    heldNodeIds: [editingNodeId],
    deferred: [{ kind: "node", id: editingNodeId, fields: { ...desiredRecord } }],
    reason:
      `deferred (inline editor on '${editingNodeId}'); ` +
      `${nodes.length - 1} other record(s) applied`,
  };
}

function hold(
  input: EditingDeferralInput,
  editingNodeId: string,
  why: string,
): EditingDeferralDecision {
  const deferred: DeferredRecord[] = [];
  for (const record of input.desired.nodes) {
    const id = record?.id;
    if (typeof id === "string" && id.length > 0) {
      deferred.push({ kind: "node", id, fields: { ...record } });
    }
  }
  return {
    mode: "hold",
    editingNodeId,
    surfaceData: input.desired,
    heldNodeIds: deferred.map((entry) => entry.id),
    deferred,
    reason: `held (inline editor on '${editingNodeId}'): ${why}`,
  };
}

// ---------------------------------------------------------------------------
// The queue. Per path, per record, COALESCING — and drained at blur / close /
// teardown.
// ---------------------------------------------------------------------------

/** What one drain hands back. `data` is the last full snapshot that was withheld. */
export interface DrainedDeferral {
  path: string;
  records: DeferredRecord[];
  data: CanvasRecords;
  /** How many passes were folded into these records. Diagnostics; proves coalescing. */
  passes: number;
}

export interface EditingDeferralQueue {
  /** Record a withheld pass. Repeated writes to one record REPLACE, never append. */
  note(path: string, records: readonly DeferredRecord[], data: CanvasRecords): void;
  /** Distinct records pending for `path`. This is the bound the burst test drives. */
  pending(path: string): number;
  /** Their ids, sorted — so a test can name what is queued rather than count it. */
  pendingIds(path: string): string[];
  /** Passes folded into `path`'s pending set. */
  passes(path: string): number;
  /** Every path with something pending. */
  paths(): string[];
  /** Take and CLEAR `path`'s pending set. `null` when nothing is pending. */
  drain(path: string): DrainedDeferral | null;
  /** Drop `path`'s pending set without applying it. */
  clear(path: string): void;
  /** Drop everything. Nothing may outlive the adapters that produced it. */
  clearAll(): void;
}

interface QueueEntry {
  records: Map<string, DeferredRecord>;
  data: CanvasRecords;
  passes: number;
}

/**
 * A per-path, per-record deferral queue.
 *
 * BOUNDED BY CONSTRUCTION: the pending set is a `Map` keyed by record id, so a
 * burst of N remote changes to ONE card leaves exactly ONE entry however large N
 * is. There is no growth term to cap, and a cap would only hide the case where a
 * key is computed wrongly.
 */
export function createEditingDeferralQueue(): EditingDeferralQueue {
  const byPath = new Map<string, QueueEntry>();

  return {
    note(path, records, data) {
      if (records.length === 0) return;
      let entry = byPath.get(path);
      if (!entry) {
        entry = { records: new Map(), data, passes: 0 };
        byPath.set(path, entry);
      }
      entry.data = data;
      entry.passes += 1;
      for (const record of records) {
        // COALESCE: the latest desired value for a record replaces the previous
        // one. Appending would grow without bound for exactly the workload this
        // queue exists for — a peer typing into a card this client has open.
        entry.records.set(`${record.kind}:${record.id}`, record);
      }
    },
    pending(path) {
      return byPath.get(path)?.records.size ?? 0;
    },
    pendingIds(path) {
      const entry = byPath.get(path);
      return entry ? [...entry.records.values()].map((r) => r.id).sort() : [];
    },
    passes(path) {
      return byPath.get(path)?.passes ?? 0;
    },
    paths() {
      return [...byPath.keys()].sort();
    },
    drain(path) {
      const entry = byPath.get(path);
      if (!entry) return null;
      byPath.delete(path);
      return {
        path,
        records: [...entry.records.values()],
        data: entry.data,
        passes: entry.passes,
      };
    },
    clear(path) {
      byPath.delete(path);
    },
    clearAll() {
      byPath.clear();
    },
  };
}
