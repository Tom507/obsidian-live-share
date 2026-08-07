// WP11 / P1 — the WRITE-ONCE `type` GUARD.
//
// Why it exists (`ARCHITECTURE.md` Appendix A.2/17, the `type`-loss silent-drop
// case): a canvas node's `type` is not a field, it is the record's identity.
// Obsidian's `importData` DROPS a node whose type it does not recognise — and
// with it every edge attached to that node. So a single stray write that
// changes `type` from `"text"` to something else, or clears it, deletes user
// content on every replica, silently, with no error anywhere. V1 defended this
// with `PROTECTED_KEYS` in `canvas-sync.ts`: a DELETE guard, which stops the
// key from being removed but not from being overwritten, and which lives at one
// call site rather than in the schema.
//
// The V2 answer is not a longer protected list; it is to make the bad operation
// unrepresentable. `type` is WRITE-ONCE (Shared Ownership Contract §2, BUILD_SPEC
// §4.3): the first write on a record establishes it, and after that the only
// admissible write is the one that changes nothing.
//
//   ├── no type yet, valid proposal   → `accepted`  — the set IS performed
//   ├── same value re-submitted       → `noop`      — the set is NOT performed
//   └── any differing / invalid value → `rejected`  — the set is NOT performed
//
// THE `noop` BRANCH IS LOAD-BEARING, not an optimisation (C11 AC2). A save
// re-states every field of every record, so a same-value `type` write is the
// COMMON case, not the rare one. Yjs emits a real update for a same-value LWW
// `set` — it has no value-equality short circuit — so re-setting an identical
// `type` would put one delta per record per save on the wire, echo to every
// peer, and hand each of them a fresh remote change to reconcile. "No delta"
// therefore has to mean "no `set` call", not "no visible difference".
//
// Purity contract (BUILD_SPEC §3, D12; TaskCharter §3): this module imports
// NOTHING but the V2 vocabulary — no Yjs, no Obsidian, no filesystem, no clock,
// no logger. The precedents are `reconcile-plan.ts`, `canvas-registers.ts` and
// `canvas-ord.ts`. The record is reached through WP9's structural `V2RecordMap`
// interface, which `Y.Map<unknown>` satisfies as-is.
//
// THE VERDICT IS THE MECHANISM; THE SIGNATURE IS FOR HUMANS. The guard returns
// its decision as data — it does not log, and a caller must never infer the
// outcome from a log line. The signature string exists so a rejection is
// greppable in the status console once WP18 wires this in, in the same
// `<NAME> signature: …` shape `canvas-sync.ts` already uses for SCATTER,
// DETACH, NO TYPE and SHADOW STALE.
//
// OWNERSHIP (Shared Ownership Contract §1): this file is the single definition
// site for the write-once `type` guard and its rejection signature. WP14
// (composition) and WP18 (wiring into the write boundaries — explicitly NOT
// this WP, TaskCharter §2) import from here. The `type` KEY NAME is WP9's and
// is reused from `V2_FIELD`; it is deliberately never spelled inline here.
// `PROTECTED_KEYS` in `canvas-sync.ts` stays exactly as it is — defence in
// depth that no longer carries correctness (TaskCharter §2).

import { V2_FIELD, type V2RecordMap } from "./canvas-registers";

/**
 * What the guard decided about one proposed `type` write.
 *
 * Three outcomes, and only ONE of them performs a CRDT write:
 *
 * - `accepted` — the record had no `type`; it has been set to the proposal.
 * - `noop` — the record already holds exactly this value; nothing was written,
 *   and there is deliberately no `signature` KEY at all (not a `signature:
 *   undefined`), so `"signature" in verdict` answers "was anything worth
 *   reporting?" without a value comparison.
 * - `rejected` — the proposal would have changed or erased an established
 *   `type`; nothing was written, and `signature` describes the refusal.
 */
export type TypeWriteVerdict =
  | { readonly kind: "accepted" }
  | { readonly kind: "noop" }
  | { readonly kind: "rejected"; readonly signature: string };

const ACCEPTED: TypeWriteVerdict = Object.freeze({ kind: "accepted" as const });
const NOOP: TypeWriteVerdict = Object.freeze({ kind: "noop" as const });

/**
 * Is this arbitrary doc value an established `type`?
 *
 * A non-string or an empty string is NOT a type — it is the absence of one, and
 * it is exactly the state `canvas-sync.ts`'s `NO TYPE signature` audit already
 * reports as a broken record (`typeof type !== "string" || type.length === 0`).
 * Treating such a value as "established" would be the worst of both worlds: the
 * guard would then refuse the very write that repairs the record, freezing the
 * corruption in place forever. Wholeness on the way out, as everywhere else in
 * the V2 read boundary.
 */
function isEstablishedType(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Read a record's established `type`, or `undefined` when it has none.
 *
 * Exported because "does this record have a real type?" is asked at several
 * boundaries (WP14's ingest validity core, WP18's write boundaries) and must be
 * answered identically at each — one predicate, not three copies, for the same
 * reason the Shared Ownership Contract pins the tombstone suppression predicate
 * to a single site.
 */
export function readRecordType(record: V2RecordMap): string | undefined {
  const stored = record.get(V2_FIELD.type);
  return isEstablishedType(stored) ? stored : undefined;
}

/**
 * The rejection signature, in `canvas-sync.ts`'s existing `<NAME> signature: …`
 * shape — one greppable line naming the record, what it holds and what was
 * refused.
 *
 * `type` values are schema vocabulary (`text`, `file`, `link`, `group`), never
 * user prose, so quoting them verbatim does not leak note content (US6). The
 * proposal is quoted through `JSON.stringify` so an empty or whitespace-only
 * value is still visible in the log rather than collapsing into the surrounding
 * punctuation, and `String(...)` guards the case where an untyped call site
 * hands in something that is not a string at all.
 */
function typeRejectionSignature(
  recordId: string,
  established: string | undefined,
  proposedType: string,
): string {
  const held = established === undefined ? "no type" : `type ${JSON.stringify(established)}`;
  const proposed =
    typeof proposedType === "string" ? JSON.stringify(proposedType) : String(proposedType);
  return (
    `TYPE WRITE REJECTED signature: record ${recordId} holds ${held}; ` +
    `refused proposed type ${proposed} (type is write-once)`
  );
}

/**
 * Decide — and, only when it is the first write, PERFORM — one proposed `type`
 * write on a record.
 *
 * This is C11's whole decision function. The record is touched at most once, by
 * exactly one `set`, and only on the `accepted` path:
 *
 * ```ts
 * const verdict = guardTypeWrite(node, "n1", "text"); // { kind: "accepted" } — stored
 * guardTypeWrite(node, "n1", "text");                 // { kind: "noop" }     — no delta
 * guardTypeWrite(node, "n1", "link");                 // { kind: "rejected" } — no delta
 * ```
 *
 * An invalid PROPOSAL (empty string, or a non-string arriving from an untyped
 * call site) is rejected rather than stored, whether or not the record already
 * has a type: the guard's mandate is that `type` can neither change NOR VANISH
 * after creation, and writing `""` over a record is how it vanishes. Storing it
 * would also produce precisely the record the `NO TYPE signature` audit exists
 * to flag.
 *
 * The guard never throws. It sits on a hot capture path where a throw would
 * abort a whole save; a refusal is data the caller can act on, and the callers
 * that must escalate get the signature to do it with.
 */
export function guardTypeWrite(
  record: V2RecordMap,
  recordId: string,
  proposedType: string,
): TypeWriteVerdict {
  const established = readRecordType(record);

  if (!isEstablishedType(proposedType)) {
    return Object.freeze({
      kind: "rejected" as const,
      signature: typeRejectionSignature(recordId, established, proposedType),
    });
  }

  if (established === undefined) {
    record.set(V2_FIELD.type, proposedType);
    return ACCEPTED;
  }

  // Same value re-submitted: the ONLY correct action is to do nothing at all.
  // Not a fast path — re-setting here would emit a CRDT delta and echo an
  // identical value to every peer on every save (C11 AC2).
  if (established === proposedType) return NOOP;

  return Object.freeze({
    kind: "rejected" as const,
    signature: typeRejectionSignature(recordId, established, proposedType),
  });
}
