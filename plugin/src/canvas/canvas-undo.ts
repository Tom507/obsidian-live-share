// ===========================================================================
// WP38 (C38) — the canvas undo scope, headless.
//
// This module owns the DECISION, not the wiring: which transactions are
// undoable, which are deliberately not, where one undo step ends and the next
// begins, and what a client is allowed to reach when it asks to undo. `main.ts`
// and `session/commands.ts` hold calls into it and nothing else (charter §7
// clause 3 — "register a command" is wiring, "decide whether this step is
// undoable" is not).
//
// Dependencies: `yjs` (which ships `Y.UndoManager` — no new runtime dependency,
// D11) and `./canvas-binding` for the ONE origin symbol that already names the
// op-capture path. `canvas-binding.ts` is imported, never edited: it is frozen
// until P5 and editing it is a §7 abort criterion. Its only own import is `yjs`,
// so reaching it costs nothing.
// ===========================================================================

import * as Y from "yjs";

import { CANVAS_BINDING_ORIGIN } from "./canvas-binding";

/**
 * The FILE-DRIVEN capture origin. Created by WP38 — it did not exist before.
 *
 * Before this work package the capture transaction in `files/canvas-sync.ts`
 * was a bare `doc.transact(fn)` with no origin argument at all, so its origin
 * was `null`. The string `"capture-net"` elsewhere in that file is a
 * REJECTION-SIGNATURE LABEL and has never been a Yjs origin.
 *
 * Same shape as the six origins that already exist — `CANVAS_BINDING_ORIGIN`,
 * `CANVAS_EPOCH_ADOPT_ORIGIN`, `CANVAS_MIGRATION_ORIGIN`,
 * `CANVAS_IMPORT_SEED_ORIGIN`, `CANVAS_SEED_ORIGIN`, `SIDECAR_LOAD_ORIGIN`.
 */
export const CANVAS_CAPTURE_ORIGIN: unique symbol = Symbol("canvas-capture-origin");

/**
 * The capture origin used for a pass that CONVERTS a plain-string `text` /
 * `label` into a nested `Y.Text` (WP36's lazy, write-triggered migration).
 *
 * Deliberately NOT in {@link UNDO_TRACKED_ORIGINS}, and this is C38 AC5 as
 * code rather than as prose.
 *
 * A tracked conversion produces an undo step whose meaning is "delete the
 * `Y.Text` and restore the plain string that preceded it". Executed LATER —
 * after peers have merged characters into that `Y.Text` — it restores a string
 * that never contained them, so a purely local undo DESTROYS A PEER'S
 * CHARACTERS. That is an AC2 violation reached through a path AC2's own
 * scenario cannot exercise, because AC2's scenario never crosses the
 * conversion boundary.
 *
 * A representation change is not a user action: nobody performed it and nobody
 * expects `Ctrl+Z` to reverse it. Excluding it is also the only option that
 * does not require undo to reason about content it did not author.
 *
 * COST, stated rather than hidden: the pass that performs the conversion is
 * therefore not undoable at all, including anything else that pass captured.
 * That is one save per field per record, the first one after the V2 model
 * starts merging text, and every later save on that record is a normal,
 * tracked, undoable step. The alternative — splitting the conversion out of
 * the capture transaction — would change what a capture WRITES, which is
 * WP18's/WP19's/WP36's and is out of scope for this work package.
 */
export const CANVAS_CAPTURE_MIGRATION_ORIGIN: unique symbol = Symbol(
  "canvas-capture-migration-origin",
);

/**
 * THE ALLOW-LIST. Explicit, by contents, and never Yjs's default.
 *
 * `Y.UndoManager`'s default `trackedOrigins` is `{null}`, and it would work
 * TODAY BY ACCIDENT: every other writer in the tree is already tagged, so the
 * only untagged transaction is the capture. It would also silently absorb the
 * next untagged transaction anybody adds, at which point the undo scope
 * becomes an accident of what nobody has got round to naming. An allow-list is
 * the only form of this that is assertable at all.
 *
 * Two members, and the second is forward-correct rather than live:
 *   ├── CANVAS_CAPTURE_ORIGIN  — the file-driven capture path, the live one
 *   └── CANVAS_BINDING_ORIGIN  — the op-capture path, which cannot fire while
 *       `useCanvasBinding` is `false` (frozen until P5). Including an origin
 *       that cannot fire yet is harmless and means P5 needs no re-point.
 *
 * NOT here, deliberately, and each for its own reason:
 *   ├── the SyncManager itself (remote deltas)     — undoing a peer is AC2's prohibition
 *   ├── SIDECAR_LOAD_ORIGIN                        — undoing a replay deletes the history
 *   ├── CANVAS_SEED_ORIGIN / CANVAS_IMPORT_SEED_ORIGIN — a seed is not a user action
 *   ├── CANVAS_MIGRATION_ORIGIN                    — V1→V2 is not a user action
 *   ├── CANVAS_EPOCH_ADOPT_ORIGIN                  — an adoption is not a user action
 *   └── CANVAS_CAPTURE_MIGRATION_ORIGIN            — see its own docstring
 */
export const UNDO_TRACKED_ORIGINS: readonly symbol[] = Object.freeze([
  CANVAS_CAPTURE_ORIGIN,
  CANVAS_BINDING_ORIGIN,
]);

/** The named root types an undo may reach. A canvas doc holds no others. */
export const UNDO_SCOPE_NAMES: readonly string[] = Object.freeze(["nodes", "edges", "deleted"]);

/**
 * How far apart two captures have to be before they become two undo steps.
 *
 * A drag burst arrives as many captures inside a few hundred milliseconds and
 * is ONE user action. 500 ms is `Y.UndoManager`'s own default and is kept.
 */
export const DEFAULT_UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Obsidian command ids. Single definer — `session/commands.ts` and the E2E
 * instrument both read them from here, so the instrument cannot invoke a
 * command id that drifted away from the registered one. */
export const CANVAS_UNDO_COMMAND_ID = "undo-canvas-change";
export const CANVAS_REDO_COMMAND_ID = "redo-canvas-change";
export const CANVAS_UNDO_COMMAND_NAME = "Undo last canvas change (Live Share)";
export const CANVAS_REDO_COMMAND_NAME = "Redo last canvas change (Live Share)";

/**
 * Would a collaborative-text write against this stored value CONVERT it?
 *
 * Mirrors `CanvasSync.writeCollabText`'s own three-way branch, from the outside
 * and without importing it:
 *   ├── a `Y.Text` already        → merged in place, no conversion
 *   ├── a `string` or ABSENT      → **converted** (WP36 sets a populated `Y.Text`)
 *   └── anything else ("other")   → the pre-WP36 register write, no conversion
 *
 * `undefined` counts. WP36's `targetBefore === "absent"` branch falls through
 * to the conversion with an empty start string, so an absent field is
 * converted exactly like a present one.
 *
 * Pure: no Yjs value is constructed, nothing is read from a doc, nothing is
 * written. The caller supplies the stored values.
 */
export function willConvertToYText(storedValue: unknown): boolean {
  if (storedValue === undefined) return true;
  return typeof storedValue === "string";
}

/** True when ANY of the collaborative-text writes in this pass will convert. */
export function captureConvertsCollabText(storedValues: Iterable<unknown>): boolean {
  for (const value of storedValues) {
    if (willConvertToYText(value)) return true;
  }
  return false;
}

/**
 * THE ORIGIN DECISION for one capture pass, and the whole of C38 AC5's
 * mechanism.
 *
 * A pass that converts is tagged with the untracked migration origin, so it
 * contributes no undo step and no undo step can ever revert a conversion. A
 * pass that does not convert is tagged with the tracked capture origin.
 *
 * Nested `doc.transact(fn, otherOrigin)` inside an open transaction is IGNORED
 * by Yjs — the outer origin wins — so the decision has to be taken before the
 * transaction opens. That is why it is a pure function of the plan and the
 * stored values rather than something decided at the write site.
 */
export function chooseCaptureOrigin(convertsCollabText: boolean): symbol {
  return convertsCollabText ? CANVAS_CAPTURE_MIGRATION_ORIGIN : CANVAS_CAPTURE_ORIGIN;
}

/** What an undo/redo invocation MEASURED. Every field is read off the manager
 * before and after the call; none is a constant. */
export interface CanvasUndoOutcome {
  seq: number;
  path: string | null;
  available: boolean;
  reason: string | null;
  kind: "undo" | "redo";
  /** `true` only when the stack actually got shorter. */
  popped: boolean;
  /** `Y.UndoManager.undo()` returned a stack item rather than `null`. */
  changed: boolean;
  undoDepthBefore: number;
  undoDepthAfter: number;
  redoDepthBefore: number;
  redoDepthAfter: number;
}

/** A read of one canvas's undo state that moves nothing. */
export interface CanvasUndoReport {
  available: boolean;
  path: string | null;
  reason: string | null;
  undoDepth: number;
  redoDepth: number;
  /** The allow-list AS CONSTRUCTED, by contents. `Symbol.description` strings —
   * a symbol does not survive JSON, and the point is that it is assertable. */
  trackedOrigins: string[];
  captureTimeoutMs: number;
  scope: string[];
  /** How many managers this registry holds — AC1's "one per canvas doc". */
  managers: number;
}

interface Entry {
  readonly manager: Y.UndoManager;
  readonly doc: Y.Doc;
  lastCaptureAt: number | null;
}

function emptyOutcome(
  seq: number,
  path: string | null,
  kind: "undo" | "redo",
  reason: string,
): CanvasUndoOutcome {
  return {
    seq,
    path,
    available: false,
    reason,
    kind,
    popped: false,
    changed: false,
    undoDepthBefore: 0,
    undoDepthAfter: 0,
    redoDepthBefore: 0,
    redoDepthAfter: 0,
  };
}

/**
 * One `Y.UndoManager` per client and per canvas doc, with an explicit
 * named-origin allow-list, destroyed with its doc.
 *
 * The registry is per CLIENT (one `CanvasSync` owns one registry) and keyed by
 * canonical canvas path, so two subscribed canvases get two managers whose
 * stacks cannot interact — there is no shared stack for them to interact
 * through.
 */
export class CanvasUndoRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  readonly captureTimeoutMs: number;
  private seq = 0;
  private last: CanvasUndoOutcome | null = null;

  constructor(opts?: { now?: () => number; captureTimeoutMs?: number }) {
    // The clock is INJECTED. C38 AC4 asserts both sides of the capture timeout
    // and a wall-clock sleep would make that timing-dependent and flaky (S56 —
    // 116 of this repo's 197 waits are a bare sleep standing in for a wait).
    this.now = opts?.now ?? (() => Date.now());
    this.captureTimeoutMs = opts?.captureTimeoutMs ?? DEFAULT_UNDO_CAPTURE_TIMEOUT_MS;
  }

  /** Attach a manager to a canvas doc. Idempotent per path — a second attach
   * for a path that already has one returns the existing manager rather than
   * building a second stack over the same doc. */
  attach(path: string, doc: Y.Doc): Y.UndoManager {
    const existing = this.entries.get(path);
    if (existing !== undefined && existing.doc === doc) return existing.manager;
    if (existing !== undefined) this.detach(path);

    // `Y.UndoManager`'s scope parameter is declared over `AbstractType<any>`,
    // which no concretely-typed `Y.Map` is assignable to under this repo's
    // strictness. The cast is to the constructor's OWN declared parameter type,
    // read off the constructor rather than spelt by hand, so it cannot drift.
    const scope = [
      doc.getMap<Y.Map<unknown>>("nodes"),
      doc.getMap<Y.Map<unknown>>("edges"),
      doc.getMap<unknown>("deleted"),
    ] as unknown as ConstructorParameters<typeof Y.UndoManager>[0];

    const manager = new Y.UndoManager(scope, {
      // THE ALLOW-LIST, by contents. `Y.UndoManager` additionally adds ITSELF
      // to this set in its own constructor, so that its undo/redo transactions
      // land on the opposite stack; that member is Yjs's, not ours, and an
      // assertion on the contents has to account for it.
      trackedOrigins: new Set<unknown>(UNDO_TRACKED_ORIGINS),
      // The step boundary is decided HERE, by `noteCapture`, against the
      // injected clock — see its docstring. Yjs's own wall-clock merge window
      // is therefore switched off rather than merely widened, so that no
      // behaviour of this registry depends on how fast the host happens to be.
      captureTimeout: Number.POSITIVE_INFINITY,
      doc,
    });

    this.entries.set(path, { manager, doc, lastCaptureAt: null });
    return manager;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  size(): number {
    return this.entries.size;
  }

  managerFor(path: string): Y.UndoManager | null {
    return this.entries.get(path)?.manager ?? null;
  }

  /**
   * THE STEP BOUNDARY. Called by the capture path IMMEDIATELY BEFORE it opens
   * its transaction, never after: `stopCapturing()` has to be in effect when
   * Yjs's `afterTransaction` handler runs, or the boundary lands one step late.
   *
   * A burst of captures closer together than `captureTimeoutMs` collapses into
   * one undo step; a burst that spans the timeout produces two. Both sides
   * come from the SAME comparison against the injected clock, which is why
   * neither is satisfiable by a timeout of infinity: with an infinite timeout
   * `at - last >= timeout` is never true and nothing is ever separated.
   *
   * A multi-node move needs nothing here: it arrives as one transaction and
   * one transaction is one stack item by construction.
   */
  noteCapture(path: string, at?: number): void {
    const entry = this.entries.get(path);
    if (entry === undefined) return;
    const now = at ?? this.now();
    const last = entry.lastCaptureAt;
    if (last === null || now - last >= this.captureTimeoutMs) {
      entry.manager.stopCapturing();
    }
    entry.lastCaptureAt = now;
  }

  /** Undo this canvas's own last action. Nothing is short-circuited: the
   * manager is called and the answer is the difference between two reads, so
   * the empty-stack answer is measured rather than branched. */
  undo(path: string | null): CanvasUndoOutcome {
    return this.run(path, "undo");
  }

  redo(path: string | null): CanvasUndoOutcome {
    return this.run(path, "redo");
  }

  private run(path: string | null, kind: "undo" | "redo"): CanvasUndoOutcome {
    const seq = ++this.seq;
    if (path === null) {
      return (this.last = emptyOutcome(seq, null, kind, "no canvas in context"));
    }
    const entry = this.entries.get(path);
    if (entry === undefined) {
      return (this.last = emptyOutcome(seq, path, kind, "no undo manager for this canvas"));
    }
    const manager = entry.manager;
    const undoBefore = manager.undoStack.length;
    const redoBefore = manager.redoStack.length;
    const item = kind === "undo" ? manager.undo() : manager.redo();
    const undoAfter = manager.undoStack.length;
    const redoAfter = manager.redoStack.length;
    const before = kind === "undo" ? undoBefore : redoBefore;
    const after = kind === "undo" ? undoAfter : redoAfter;
    // A step already open for merging must not swallow the next capture after
    // an undo: the next thing the user does is a new action.
    entry.lastCaptureAt = null;
    return (this.last = {
      seq,
      path,
      available: true,
      reason: after < before ? null : "empty stack",
      kind,
      popped: after < before,
      changed: item !== null && item !== undefined,
      undoDepthBefore: undoBefore,
      undoDepthAfter: undoAfter,
      redoDepthBefore: redoBefore,
      redoDepthAfter: redoAfter,
    });
  }

  /** The outcome of the LAST invocation, carrying its own `seq` so a stale
   * reading cannot masquerade as a fresh one. */
  lastOutcome(): CanvasUndoOutcome | null {
    return this.last;
  }

  report(path: string | null): CanvasUndoReport {
    const trackedOrigins = UNDO_TRACKED_ORIGINS.map((s) => s.description ?? String(s));
    const base = {
      trackedOrigins,
      captureTimeoutMs: this.captureTimeoutMs,
      scope: [...UNDO_SCOPE_NAMES],
      managers: this.entries.size,
    };
    if (path === null) {
      return { available: false, path: null, reason: "no canvas in context", undoDepth: 0, redoDepth: 0, ...base };
    }
    const entry = this.entries.get(path);
    if (entry === undefined) {
      return {
        available: false,
        path,
        reason: "no undo manager for this canvas",
        undoDepth: 0,
        redoDepth: 0,
        ...base,
      };
    }
    return {
      available: true,
      path,
      reason: null,
      undoDepth: entry.manager.undoStack.length,
      redoDepth: entry.manager.redoStack.length,
      ...base,
    };
  }

  /**
   * AC1's third conjunct — destruction is part of the criterion, not cleanup.
   * A manager that outlives its doc is a retained reference (a leak) and an
   * undo reaching a torn-down surface is a crash.
   */
  detach(path: string): void {
    const entry = this.entries.get(path);
    if (entry === undefined) return;
    this.entries.delete(path);
    entry.manager.destroy();
  }

  destroy(): void {
    for (const path of [...this.entries.keys()]) this.detach(path);
    this.entries.clear();
  }
}
