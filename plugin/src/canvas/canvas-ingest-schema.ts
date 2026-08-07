// WP14 / P1 — the INGEST SCHEMA VALIDATOR: the replica's type barrier.
//
// Why it exists (BUILD_SPEC §4.5, `ARCHITECTURE.md` Appendix A.2/16–18): the
// schema invariants "a node has an identity, a type, a position and a size" and
// "an edge has two endpoints" were, in V1, expressed as a FILTER at
// serialisation — `auditCanvasState` counted `noGeo`, `noType`,
// `fileNodesWithoutFile` and `danglingEdges` long after the broken record was
// already in the doc and on every peer. A filter downstream of the doc can only
// describe the damage; it cannot prevent it.
//
// V2 moves the same statements to the BOUNDARY, where a record is proposed:
//
//   ├── `Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific requirement`
//   └── `Edge valid ⟺ id ∧ from.node ∧ to.node`
//
// THE ORIGIN ASYMMETRY IS THE POINT, AND IT IS IN THE DATA (C14 AC3). A local
// proposal that fails the schema is REJECTED — it never enters the doc, so the
// invariant holds by construction. A remote delta that fails the schema is
// reported invalid and is NEVER rejected: refusing it would mean this replica
// holds a state its peers do not, which is divergence — the one failure mode a
// CRDT exists to make impossible. Broken remote records are quarantined later by
// the auditor (WP20), not refused here. Because both cases run through the same
// two functions, the difference is carried by `IngestInvalid.reject` rather than
// left to a caller that would have to remember which way round it goes. A caller
// obeys the verdict; it does not re-derive it from the origin.
//
// MISSING IS NOT THE SAME AS BROKEN (C14 AC2). "The key was never written" and
// "the key holds something that is not a value of this kind" are different
// stories about how a record got here — the first is an incomplete write, the
// second a bad one — and a repair pass cannot choose a strategy from a single
// merged code. Every conjunct therefore reports a `MISSING_*` / `INVALID_*`
// pair.
//
// Purity contract (BUILD_SPEC §3, D12; TaskCharter §3, AC4): this module imports
// nothing but the two P1 cores below — no Yjs, no editor host, no filesystem, no
// clock, no randomness, no logger. It reads the record through WP9's structural
// `V2RecordMap` and never writes: a boundary check that repaired what it
// inspects would be a filter with side effects, which is exactly the shape this
// component replaces. The precedents are `reconcile-plan.ts`,
// `canvas-registers.ts` and `canvas-type-guard.ts`.
//
// OWNERSHIP (Shared Ownership Contract §1): this file is the single definition
// site for the ingest validity rules and the machine-readable reason codes; WP18
// imports them when it wires the write boundaries — that wiring is explicitly
// NOT this WP (TaskCharter §2). Everything else is imported, never re-derived:
// the field key names and the register readers are WP9/WP10's, the established-
// type predicate is WP11's, and edge endpoint validity is WP10's
// `hasBothEndpoints` — the same single predicate WP23's fuzzer oracle asks, so
// the two can never drift apart on an edge case.

import {
  V2_FIELD,
  hasBothEndpoints,
  isPosRegister,
  isSizeRegister,
  readFrom,
  readTo,
  type V2RecordMap,
} from "./canvas-registers";
import { readRecordType } from "./canvas-type-guard";

/**
 * Where the proposed record came from — the only axis on which the verdict's
 * consequence differs.
 *
 * `local` is anything this replica authored: the capture path, the seed, a
 * binding write. `remote` is a delta that already exists on a peer.
 */
export type IngestOrigin = "local" | "remote";

/**
 * Why a record failed the schema, as a code a machine can branch on.
 *
 * Paired by conjunct on purpose: `MISSING_X` means the key is absent, `INVALID_X`
 * means it is present and holds something that is not an X (C14 AC2). The
 * type-specific pair is deliberately NOT per node type — the requirement is
 * "whatever this type demands", and naming the field in the code would make the
 * set grow with the schema instead of with the failure modes.
 */
export type IngestReasonCode =
  | "MISSING_ID"
  | "INVALID_ID"
  | "MISSING_TYPE"
  | "INVALID_TYPE"
  | "MISSING_POS"
  | "INVALID_POS"
  | "MISSING_SIZE"
  | "INVALID_SIZE"
  | "MISSING_TYPE_SPECIFIC"
  | "INVALID_TYPE_SPECIFIC"
  | "MISSING_FROM"
  | "INVALID_FROM"
  | "MISSING_TO"
  | "INVALID_TO";

/**
 * The record satisfies the schema.
 *
 * There is deliberately no `reject` key here, not even `reject: false`: a valid
 * record has no rejection question to answer, and `origin` has no effect at all
 * on this branch (C14 AC3 bounds the asymmetry to the invalid path).
 */
export interface IngestValid {
  readonly valid: true;
}

/**
 * The record fails the schema, with the reason and the consequence.
 *
 * `reject` is the asymmetry, in the data: `true` for a local proposal (refuse
 * it — the invariant is preserved by never storing it), `false` for a remote
 * delta (report it, keep it, let WP20's auditor quarantine it — refusing it
 * would diverge this replica from its peers). `reason` is identical under both
 * origins: the diagnosis does not depend on who proposed the record.
 */
export interface IngestInvalid {
  readonly valid: false;
  readonly reason: IngestReasonCode;
  readonly reject: boolean;
}

/** The verdict on one proposed record. */
export type IngestVerdict = IngestValid | IngestInvalid;

const VALID: IngestValid = Object.freeze({ valid: true });

/**
 * Build an invalid verdict — the ONE place in this module that reads `origin`,
 * so the local/remote rule exists exactly once and every reason code obeys it
 * identically.
 */
function invalid(reason: IngestReasonCode, origin: IngestOrigin): IngestInvalid {
  return Object.freeze({ valid: false, reason, reject: origin === "local" });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Is this value an acceptable rich-text payload?
 *
 * THE REQUIREMENT IS PRESENCE AND CORRECT TYPE, NOT CONTENT (Worker 2's E1-b
 * ruling, 2026-08-02). `"text": ""` is a **legal** JSON Canvas text node — an
 * empty card the user has not typed into yet, or one whose content they
 * cleared — so ANY string satisfies this, including the empty one. Demanding a
 * non-empty string refused that card; composed with the write-back, the refusal
 * deleted it from the user's own file. `file` and `url` KEEP their non-empty
 * requirement: an empty path or URL addresses nothing, whereas an empty card is
 * simply an empty card.
 *
 * Two shapes are admissible, and that is a forward-compatibility REQUIREMENT,
 * not leniency (Shared Ownership Contract §3, Worker 2 escalation 5): P4 moves a
 * node's `text` (and an edge's `label`) into a nested collaborative text type
 * WITHIN schema major 2, so a read must tolerate both the plain string it holds
 * today and the object it will hold afterwards. `V2Node.text` is typed `unknown`
 * in `canvas-registers.ts` for precisely this reason. Asserting
 * `typeof value === "string"` alone here would make the future shape invalid on
 * ingest the day P4 lands — a validator that rejects the schema's own next
 * version.
 *
 * The object half is duck-typed on purpose: an `instanceof` check against the
 * CRDT text type would require importing Yjs and would break AC4's purity. An
 * array is excluded because it is the register vocabulary's shape (`pos` is
 * `[x, y]`), and `null` because it is the JSON spelling of "no value at all" —
 * which is ill-typed, and therefore still distinguishable from the key being
 * missing (AC2, untouched).
 */
function isRichTextValue(value: unknown): boolean {
  if (typeof value === "string") return true;
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The type-specific requirement, per node type (BUILD_SPEC §4.5:
 * `type-specific (file→file, text→text, …)`).
 *
 * `field` is the doc key the type demands — always a name imported from WP9's
 * `V2_FIELD`, never an inline literal. `accepts` is what counts as a value of
 * it: a path or URL is a non-empty string, while `text` takes the tolerant
 * reading above.
 *
 * A type absent from this table carries NO type-specific requirement and is
 * valid on its four core conjuncts alone — `group` is the standing example, a
 * frame that holds nothing of its own. Silence here means "nothing further is
 * demanded", never "unknown, therefore refuse": refusing an unrecognised type
 * would make this validator the thing that drops records when the schema grows,
 * which is the `importData` failure mode WP11 exists to prevent.
 */
const NODE_TYPE_SPECIFIC: Readonly<
  Record<string, { readonly field: string; readonly accepts: (value: unknown) => boolean }>
> = Object.freeze({
  file: { field: V2_FIELD.file, accepts: isNonEmptyString },
  text: { field: V2_FIELD.text, accepts: isRichTextValue },
  link: { field: V2_FIELD.url, accepts: isNonEmptyString },
});

/**
 * The `id` conjunct, shared by both record kinds — a record without an identity
 * cannot be addressed, merged or repaired, whatever else it holds.
 */
function checkId(record: V2RecordMap, origin: IngestOrigin): IngestInvalid | undefined {
  const stored = record.get(V2_FIELD.id);
  if (stored === undefined) return invalid("MISSING_ID", origin);
  if (!isNonEmptyString(stored)) return invalid("INVALID_ID", origin);
  return undefined;
}

/**
 * Validate a proposed NODE record: `id ∧ type ∧ pos ∧ size ∧ type-specific`
 * (BUILD_SPEC §4.5, C14 AC1).
 *
 * The conjuncts are tested in schema order and the FIRST failure is reported,
 * so the reason names the most fundamental thing wrong with the record rather
 * than an arbitrary member of a set. Each is asked through the predicate that
 * owns it — `readRecordType` (WP11), `isPosRegister` / `isSizeRegister` (WP9) —
 * so "well formed" means exactly the same thing here as at every other V2
 * boundary. A register is whole or absent: a torn `[1]` is INVALID, never
 * half-read.
 *
 * The record is only ever read (C14 AC4); `origin` decides the consequence of a
 * failure, never the diagnosis.
 */
export function validateNodeIngest(record: V2RecordMap, origin: IngestOrigin): IngestVerdict {
  const idFailure = checkId(record, origin);
  if (idFailure) return idFailure;

  const storedType = record.get(V2_FIELD.type);
  if (storedType === undefined) return invalid("MISSING_TYPE", origin);
  const nodeType = readRecordType(record);
  if (nodeType === undefined) return invalid("INVALID_TYPE", origin);

  const storedPos = record.get(V2_FIELD.pos);
  if (storedPos === undefined) return invalid("MISSING_POS", origin);
  if (!isPosRegister(storedPos)) return invalid("INVALID_POS", origin);

  const storedSize = record.get(V2_FIELD.size);
  if (storedSize === undefined) return invalid("MISSING_SIZE", origin);
  if (!isSizeRegister(storedSize)) return invalid("INVALID_SIZE", origin);

  const requirement = NODE_TYPE_SPECIFIC[nodeType];
  if (requirement !== undefined) {
    const storedSpecific = record.get(requirement.field);
    if (storedSpecific === undefined) return invalid("MISSING_TYPE_SPECIFIC", origin);
    if (!requirement.accepts(storedSpecific)) return invalid("INVALID_TYPE_SPECIFIC", origin);
  }

  return VALID;
}

/**
 * Validate a proposed EDGE record: `id ∧ from.node ∧ to.node` (BUILD_SPEC §4.5,
 * C14 AC1) — the Definition of Done, "an edge has two endpoints", as a type
 * constraint at the boundary rather than a downstream `danglingEdges` count.
 *
 * THE RULE IS EXACTLY `id ∧ from.node ∧ to.node` — `side` is NOT a conjunct
 * (Worker 2's E1 ruling, 2026-08-02; CONCEPT_V2 Teil 11 never had it). An edge
 * whose `from` register carries a `node` and no `side` is a fully-connected,
 * legal JSON Canvas edge and is VALID here. That follows from WP10 AC5 rather
 * than from anything written in this function, which is why WP14 pins it with
 * its own test: the two modules drifting apart on this is exactly how a live
 * path came to delete the user's edges.
 *
 * Endpoint validity is `hasBothEndpoints` and nothing else. That predicate is
 * WP9/WP10's single expression of "no endpoint-less edge" and is also WP23's
 * fuzzer oracle (Shared Ownership Contract §1); asking it here — rather than
 * re-deriving "does `to` look like an endpoint?" with local logic — is what
 * makes the validator and the oracle incapable of disagreeing about an odd
 * shape, such as an object carrying an extra key or a `node` that is present
 * but empty.
 *
 * The per-slot readers are used only AFTER that answer, to say WHICH endpoint
 * failed and whether it was absent or malformed (C14 AC2). They are the very
 * readers `hasBothEndpoints` is built from, so the diagnosis can never
 * contradict the verdict.
 */
export function validateEdgeIngest(record: V2RecordMap, origin: IngestOrigin): IngestVerdict {
  const idFailure = checkId(record, origin);
  if (idFailure) return idFailure;

  if (hasBothEndpoints(record)) return VALID;

  if (readFrom(record) === undefined) {
    const storedFrom = record.get(V2_FIELD.from);
    return invalid(storedFrom === undefined ? "MISSING_FROM" : "INVALID_FROM", origin);
  }

  const storedTo = record.get(V2_FIELD.to);
  return invalid(storedTo === undefined ? "MISSING_TO" : "INVALID_TO", origin);
}
