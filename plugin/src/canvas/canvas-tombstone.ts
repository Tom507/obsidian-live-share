// WP12 / P1 — the TOMBSTONE MAP, and the ONE suppression rule.
//
// Why it exists (BUILD_SPEC §5 C12, CONCEPT_V2 Teil 4): in V1 a deleted record
// was an ABSENT key. Absence is not a value, so it carries no author, no time
// and no intent — which makes it impossible to merge. A peer that deletes a
// card while another peer edits it produces "key gone" on one replica and "key
// present with a fresh value" on the other, and Yjs has nothing to arbitrate:
// the edit simply re-creates the record on the deleter's replica (resurrection)
// or the delete silently discards the edit, depending on arrival order. Undo is
// worse still — once the field container is destroyed, the values it held are
// gone, so "undo the delete" can at best re-create an empty husk.
//
// V2 turns deletion into DATA. A record is never removed; a separate `deleted`
// container holds one entry per id:
//
//   deleted[id] := { t, by, on, q? }        (BUILD_SPEC §4.3, never written to the file)
//
//   ├── `t`  → the LAMPORT timestamp of the op. Logical, never wall-clock:
//   │          two hosts' clocks disagree, and a merge that depended on them
//   │          would converge differently per machine. This module never reads
//   │          a clock (see the purity contract below).
//   ├── `by` → the clientID that issued the op; the deterministic tiebreak.
//   ├── `on` → true = the record is SUPPRESSED. Deletion is a flag, not an
//   │          absence, so it merges like any other LWW value.
//   └── `q?` → true only alongside `on:true`: this suppression is a QUARANTINE
//              raised by the auditor (WP20), not a user delete.
//
// ─────────────────────────────────────────────────────────────────────────
// ONE MECHANISM, NOT THREE (Definition of Done)
// ─────────────────────────────────────────────────────────────────────────
// Delete, undo, quarantine and release-quarantine are the SAME operation with
// different payloads. There is no `deleteRecord`, no `undo`, no
// `releaseQuarantine` — every one of them is an `applyTombstoneOp` call, and
// every one of them wins or loses by the same `(t, by)` comparison. That is
// what makes a stale undo unable to resurrect a record over a fresher delete
// (AC3) and a stale release unable to lift a fresher quarantine: there is no
// second arbitration rule for either of them to exploit.
//
// ─────────────────────────────────────────────────────────────────────────
// THIS MODULE IS THE SINGLE AUTHORITY ON "IS THIS RECORD DELETED"
// ─────────────────────────────────────────────────────────────────────────
// Shared Ownership Contract §1 and C12 AC2: `on:true` must suppress the record
// in ALL THREE consumers — reconcile output (WP15), serialisation (WP17) and
// capture resurrect-blocking (WP19) — "through one shared predicate, NOT three
// copies". That predicate is {@link isTombstoneSuppressed} and nothing else.
//
// A consumer that writes `entry?.on === true` inline, or `!!entry && entry.on`,
// or its own `isDeleted()` helper, is the failure this AC exists to prevent:
// three spellings of the same question drift the moment the rule gains a case
// (quarantine already added one, GC in WP25 will add another), every suite
// still passes, and the file on disk disagrees with what the user sees. The
// exported surface is pinned by a dynamic scan in
// `v2/wp12/test_tp06_no_duplicate_suppression_predicate_export_visible.test.ts`
// — a later WP that adds a second suppression-shaped export breaks that test
// rather than the production canvas.
//
// ─────────────────────────────────────────────────────────────────────────
// LOSSLESS UNDO IS STRUCTURAL, NOT CAREFUL (AC3)
// ─────────────────────────────────────────────────────────────────────────
// This module is never handed a record's field container at all — it only ever
// touches the separate `deleted` map, keyed by id. It therefore CANNOT destroy
// a field container, and `on:false` restores the record with every field value
// intact because those values were never anywhere else. Losslessness here is a
// property of the API's shape, not of an implementer remembering to be gentle.
//
// ─────────────────────────────────────────────────────────────────────────
// NO EVENT CHANNEL, DELIBERATELY (AC4)
// ─────────────────────────────────────────────────────────────────────────
// Releasing a quarantine must restore the record "without a user-visible
// delete/undelete event". This module exports no notification surface of any
// kind, for ANY transition — no emitter, no listener, no subscribe. A caller
// observes state by reading it; nothing here can tell a UI that something
// happened. A dedicated `releaseQuarantine()` function is likewise absent on
// purpose: its mere existence would be a signal a caller could hang a toast on,
// and release would stop being an ordinary op that loses to a fresher one.
//
// Purity contract (BUILD_SPEC §3, D12; TaskCharter §3): this module imports
// NOTHING — no Yjs, no Obsidian, no filesystem, no clock, no randomness, no
// logger. The precedents are `reconcile-plan.ts`, `canvas-registers.ts`,
// `canvas-ord.ts` and `canvas-type-guard.ts`. The tombstone container is
// reached through the structural {@link TombstoneMap} interface below, which
// `Y.Map<unknown>` satisfies as-is and without a cast — the same technique
// WP9's `V2RecordMap` uses — so the semantics stay unit-testable without a doc
// and the module stays out of the Yjs import chain.

// ---------------------------------------------------------------------------
// PART A — the value shape and the container seam
// ---------------------------------------------------------------------------

/**
 * One record's tombstone: the whole of what "deleted" means in V2.
 *
 * Pinned by BUILD_SPEC §4.3 and the Shared Ownership Contract §2 table — this
 * shape is not open for design, and it lives in the doc only (it is never
 * written to the `.canvas` file).
 */
export interface TombstoneEntry {
  /**
   * The op's LAMPORT timestamp — logical, monotonically advanced by the
   * caller, NEVER a wall-clock reading. Two replicas comparing wall-clock
   * stamps would converge differently depending on whose clock ran fast.
   */
  readonly t: number;
  /** The clientID that issued the op; the deterministic tiebreak on equal `t`. */
  readonly by: string;
  /** `true` = the record is suppressed (deleted or quarantined). */
  readonly on: boolean;
  /**
   * `true` only alongside `on:true`: this suppression is a quarantine (WP20),
   * not a user delete. Absent on an ordinary delete or undo.
   */
  readonly q?: boolean;
}

/**
 * The structural seam onto the `deleted` container.
 *
 * `Y.Map<unknown>` satisfies this as-is, so production passes the real CRDT
 * container and a unit test passes a plain stub — without this module importing
 * Yjs and without either side needing a cast. Only `get` and `set` appear here:
 * a tombstone is never DELETED from the map (that would recreate the very
 * absence-instead-of-value problem V2 exists to remove), so no `delete` is part
 * of the seam. Sidecar GC of long-dead tombstones is WP25's, under its own
 * rules.
 */
export interface TombstoneMap {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
}

// ---------------------------------------------------------------------------
// PART B — normalisation (module-private)
// ---------------------------------------------------------------------------

/**
 * Build the canonical in-doc form of an entry.
 *
 * `q` is present ONLY when it is `true`. An explicit `q: false` and an absent
 * `q` mean the same thing, and letting both spellings exist would make two
 * replicas holding identical semantic state produce different stored objects —
 * a difference that would surface as a spurious delta on the wire and as a key
 * -shape difference between an ordinary undo and a quarantine release (AC4).
 */
function canonicalEntry(t: number, by: string, on: boolean, q: boolean): TombstoneEntry {
  return q ? { t, by, on, q: true } : { t, by, on };
}

/** Normalise an incoming op, so a caller's `q: false` and omitted `q` agree. */
function normalizeEntry(entry: TombstoneEntry): TombstoneEntry {
  return canonicalEntry(entry.t, entry.by, entry.on === true, entry.q === true);
}

/**
 * Recognise a stored value as a tombstone entry.
 *
 * A value that is not a well-formed entry can only come from a doc this module
 * did not write — a future schema, a hand-edited vault, a partially migrated
 * canvas. It reads as "no tombstone" (the record stays VISIBLE) rather than
 * throwing: an unreadable tombstone must never take a user's record away, and a
 * throw inside a save path is not recoverable (I5, degrade never break).
 */
function asTombstoneEntry(value: unknown): TombstoneEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { t?: unknown; by?: unknown; on?: unknown; q?: unknown };
  if (typeof candidate.t !== "number" || !Number.isFinite(candidate.t)) return undefined;
  if (typeof candidate.by !== "string") return undefined;
  if (typeof candidate.on !== "boolean") return undefined;
  return canonicalEntry(candidate.t, candidate.by, candidate.on, candidate.q === true);
}

// ---------------------------------------------------------------------------
// PART C — the merge (AC1)
// ---------------------------------------------------------------------------

/**
 * Rank two entries under the total order the merge maximises.
 *
 * `(t, by, on, q)` compared in that order, all of it deterministic and
 * host-independent:
 *
 *   ├── `t`  → the higher Lamport stamp wins OUTRIGHT. `on`'s own value never
 *   │          overrides `t`; a delete has no privilege over an undo.
 *   ├── `by` → on equal `t`, the GREATER `by` wins under plain lexicographic
 *   │          string comparison. Not `localeCompare` (host ICU data), not a
 *   │          numeric reading of the id, and emphatically not Yjs's own
 *   │          concurrent-write tie-break — that one is decided by a
 *   │          `random.uint32()` clientID, so a merge that leaned on it would
 *   │          converge to a different answer on each run.
 *   └── `on`, then `q` → only reachable when `t` AND `by` are both equal, i.e.
 *              one client issued two different ops at the same logical time,
 *              which a correct caller never does. Comparing them anyway keeps
 *              the order TOTAL: without this the merge would have to pick an
 *              argument, and "pick the first" is not commutative.
 *
 * Because every field participates, `rank(a, b) === 0` implies `a` and `b` are
 * the same value — which is what makes "max under this order" commutative,
 * associative and idempotent, and therefore convergent under any arrival order.
 */
function rankEntries(a: TombstoneEntry, b: TombstoneEntry): number {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.by !== b.by) return a.by < b.by ? -1 : 1;
  if (a.on !== b.on) return a.on ? 1 : -1;
  const aq = a.q === true;
  const bq = b.q === true;
  if (aq !== bq) return aq ? 1 : -1;
  return 0;
}

/**
 * Merge two candidate entries for the SAME id and return the LWW winner (AC1).
 *
 * THE definition of tombstone convergence (Shared Ownership Contract §1) —
 * every consumer that needs to combine two tombstones imports this one.
 *
 * The rule, stated exactly: the entry with the strictly higher `t` wins; on
 * equal `t`, the entry whose `by` sorts greater under plain lexicographic
 * string comparison wins. See {@link rankEntries} for why the remaining fields
 * take part at all.
 *
 * Algebraically this is `max` over a total order, so it is:
 *
 *   ├── COMMUTATIVE  → the argument order never changes the result, therefore
 *   │                  two replicas that received the same two ops in opposite
 *   │                  order still agree,
 *   ├── ASSOCIATIVE  → grouping never changes the result, therefore three or
 *   │                  more ops converge under every arrival permutation, and
 *   └── IDEMPOTENT   → merging an entry with an equal-valued copy of itself is
 *                      a no-op, therefore a retransmitted op is harmless.
 *
 * Those three properties are not a nicety; they ARE convergence. A merge
 * missing any one of them lets two replicas holding the same set of ops end up
 * with different tombstone state, and no test that looks at one replica can see
 * it.
 *
 * The result is canonical (see {@link canonicalEntry}), never one of the
 * argument objects, so a caller cannot mutate stored state through a reference
 * it handed in.
 */
export function mergeTombstoneEntries(a: TombstoneEntry, b: TombstoneEntry): TombstoneEntry {
  const winner = rankEntries(a, b) >= 0 ? a : b;
  return normalizeEntry(winner);
}

// ---------------------------------------------------------------------------
// PART D — reading and applying
// ---------------------------------------------------------------------------

/**
 * Read the current tombstone for `id`, or `undefined` when the id has never
 * been the subject of a tombstone op.
 *
 * `undefined` means "no tombstone", which means VISIBLE — it is not an error
 * case and callers must not treat it as one. The overwhelming majority of
 * records in a canvas have no entry here at all.
 */
export function readTombstoneEntry(map: TombstoneMap, id: string): TombstoneEntry | undefined {
  return asTombstoneEntry(map.get(id));
}

/**
 * Apply one op to `map` for `id` and return the resulting entry.
 *
 * Delete, undo, quarantine and release-quarantine are all THIS call — they
 * differ only in the `on` / `q` values they carry:
 *
 *   ├── delete    → `{ t, by, on: true }`
 *   ├── undo      → `{ t, by, on: false }`
 *   ├── quarantine→ `{ t, by, on: true, q: true }`
 *   └── release   → `{ t, by, on: false }`   (identical in shape to an undo)
 *
 * The op is merged with whatever is already stored via
 * {@link mergeTombstoneEntries}, so it can LOSE. A stale undo arriving after a
 * fresher delete leaves the record suppressed (AC3); a stale release arriving
 * after a fresher quarantine leaves it quarantined. Undo is not special-cased,
 * which is precisely why it cannot be exploited to resurrect a record.
 *
 * `t` must be a Lamport value the caller advanced — this module never reads a
 * clock and never invents a stamp.
 *
 * Nothing but the `deleted` map is touched. The record's own field container is
 * not passed in, not reachable and never modified, which is what makes undo
 * lossless by construction (AC3).
 */
export function applyTombstoneOp(map: TombstoneMap, id: string, op: TombstoneEntry): TombstoneEntry {
  const incoming = normalizeEntry(op);
  const current = asTombstoneEntry(map.get(id));
  const merged = current === undefined ? incoming : mergeTombstoneEntries(current, incoming);
  map.set(id, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// PART E — the predicates
// ---------------------------------------------------------------------------

/**
 * THE suppression predicate (AC2). The single authority on "is this record
 * deleted", for the whole project.
 *
 * `true` iff `entry !== undefined && entry.on === true`.
 *
 * Reconcile output (WP15), serialisation (WP17) and capture resurrect-blocking
 * (WP19) must ALL route their question through this function — not through an
 * inline `entry?.on`, not through a local helper, not through a second
 * predicate of their own. C12 AC2 requires "one shared predicate, not three
 * copies", and the module's export surface is scanned by a test to keep it that
 * way.
 *
 * It is deliberately `q`-AGNOSTIC: a quarantine suppresses exactly as hard as a
 * user delete. Whether the suppression should be shown to the user differently
 * is {@link isTombstoneQuarantined}'s question, asked separately by the few
 * consumers that care.
 *
 * An absent entry (`undefined`) is VISIBLE. Most records never have a tombstone
 * at all, so this is the common answer.
 */
export function isTombstoneSuppressed(entry: TombstoneEntry | undefined): boolean {
  return entry !== undefined && entry.on === true;
}

/**
 * Distinguish a quarantine from a user delete (AC4).
 *
 * `true` iff the entry is CURRENTLY suppressed (`on:true`) AND carries
 * `q:true`. Both halves are load-bearing: quarantine is a property of the
 * current suppressed state, not a permanent tag on the id, so a leftover
 * `q:true` riding along on an `on:false` entry — which is exactly what a
 * release or an undo of a quarantine can leave behind, since the merge keeps
 * the winning op's payload — reads as NOT quarantined.
 *
 * This is a classification of an already-suppressed record, never a second
 * suppression rule: a caller decides IF a record is hidden with
 * {@link isTombstoneSuppressed}, and only then asks WHY with this.
 */
export function isTombstoneQuarantined(entry: TombstoneEntry | undefined): boolean {
  return isTombstoneSuppressed(entry) && entry?.q === true;
}
