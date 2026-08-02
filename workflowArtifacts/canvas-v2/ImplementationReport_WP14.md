# Implementation Report — WP14

**Attempt: 1**
**WP:** WP14 — Ingest schema validator (C14, phase P1)
**Module:** `plugin/src/canvas/canvas-ingest-schema.ts` (created)

## Status: DONE

All 4 ACs met, all 13 visible test files (39 assertions) PASS, `npx tsc -noEmit -skipLibCheck`
clean. No existing test was deleted, skipped, weakened or touched. No `SPEC_CONTRADICTION`, no
`TOOL_REQUEST`.

---

## Completed Work

| AC | Requirement | How it is met | Verified by |
|---|---|---|---|
| **AC1** | `Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific` and `Edge valid ⟺ id ∧ from.node ∧ to.node`, type-specific covering at least `file`→`file` and `text`→`text` | `validateNodeIngest` tests the four core conjuncts in schema order, then the type-specific requirement from a table keyed by node type (`file`→`file`, `text`→`text`, plus the spec's `…` extension `link`→`url`). `validateEdgeIngest` tests `id`, then delegates the whole endpoint question to `hasBothEndpoints`. | TP01, TP02, TP03, TP04, TP07, TP09 |
| **AC2** | Missing key and present-but-empty/ill-typed are both invalid with distinguishable machine-readable reasons | Every conjunct reads the raw value first: `undefined` → `MISSING_*`, otherwise the owning predicate decides → `INVALID_*`. Seven code pairs, no merged code. | TP04 (`id: ""` → `INVALID_ID`), TP05, TP06, TP08 |
| **AC3** | Local rejects, remote never rejects; the asymmetry is explicit in the API, not left to callers | `IngestInvalid.reject` carries it as data. It is computed in exactly one place (`invalid(...)`) as `origin === "local"`. `reason` is origin-independent. `IngestValid` has no `reject` key at all, so origin cannot leak into the valid path. | TP10 (crux), TP11 |
| **AC4** | The module is pure — no knowledge of Yjs, Obsidian or the filesystem | Two relative imports only (`./canvas-registers`, `./canvas-type-guard`, both themselves pure). No clock, no entropy, no host globals, no `set()` on the record. Y.Text tolerance is duck-typed precisely so no Yjs import is needed. | TP12 (source scan), TP13 (determinism + zero `set` calls) |

**Definition of Done** — "an edge has two endpoints" is now a type constraint at the boundary: an
edge missing an endpoint fails `validateEdgeIngest` before it can be written, instead of being
counted afterwards by `auditCanvasState`'s `danglingEdges`.

## Blocked Items

None.

## Tools Created

None. No new dependency, no new script, no config change.

## Changes Made

| File | Change |
|---|---|
| `plugin/src/canvas/canvas-ingest-schema.ts` | **created** — the whole WP (≈250 lines incl. rationale comments) |
| `workflowArtifacts/canvas-v2/TaskCharter_WP14_IngestSchemaValidator.md` | Charter Status `TESTS_ADDED` → `DONE`; §8 execution plan and §9 handover filled |
| `workflowArtifacts/canvas-v2/ImplementationReport_WP14.md` | **created** — this file |

Nothing else was touched. No test file was modified. `canvas-registers.ts`, `canvas-type-guard.ts`,
`canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `main.ts`, `server/`, `docker/`,
`package.json` and the plugin version are all unchanged. No build was run, no formatter, no
`lint --fix`.

## Exported API surface

Exactly the contract pinned in TaskCharter §7 — nothing more:

```ts
export type IngestOrigin = "local" | "remote";

export type IngestReasonCode =
  | "MISSING_ID" | "INVALID_ID"
  | "MISSING_TYPE" | "INVALID_TYPE"
  | "MISSING_POS" | "INVALID_POS"
  | "MISSING_SIZE" | "INVALID_SIZE"
  | "MISSING_TYPE_SPECIFIC" | "INVALID_TYPE_SPECIFIC"
  | "MISSING_FROM" | "INVALID_FROM"
  | "MISSING_TO" | "INVALID_TO";

export interface IngestValid { readonly valid: true }
export interface IngestInvalid {
  readonly valid: false;
  readonly reason: IngestReasonCode;
  readonly reject: boolean;
}
export type IngestVerdict = IngestValid | IngestInvalid;

export function validateNodeIngest(record: V2RecordMap, origin: IngestOrigin): IngestVerdict;
export function validateEdgeIngest(record: V2RecordMap, origin: IngestOrigin): IngestVerdict;
```

Verdicts are `Object.freeze`d; the valid verdict is a single shared frozen instance. The
type-specific requirement table and the small value predicates are module-private — WP18 consumes
verdicts, not internals.

## Symbols imported rather than redefined

Per Shared Ownership Contract §1 — a consumer imports, it does not re-declare, not even as an inline
string literal.

| Symbol | Owner / module | Used for |
|---|---|---|
| `V2_FIELD` (`id`, `type`, `pos`, `size`, `from`, `to`, `file`, `text`, `url`) | WP9 · `canvas-registers.ts` | every doc key name; no field name is spelled inline anywhere in the module |
| `V2RecordMap` (type) | WP9 · `canvas-registers.ts` | the structural record slice — the reason no Yjs import is needed |
| `isPosRegister`, `isSizeRegister` | WP9 · `canvas-registers.ts` | "is this a whole, well-formed register?" — a torn `[1]` is `INVALID_POS`, never half-read |
| `hasBothEndpoints` | WP9/WP10 · `canvas-registers.ts` | **the entire edge endpoint validity decision** |
| `readFrom`, `readTo` | WP10 · `canvas-registers.ts` | only to attribute a failed edge to a slot after `hasBothEndpoints` said no — they are the readers that predicate is built from, so diagnosis cannot contradict verdict |
| `readRecordType` | WP11 · `canvas-type-guard.ts` | "does this record have an established type?" |

The only locally-declared predicates are `isNonEmptyString` (a private helper, not an owned symbol —
`canvas-registers.ts`'s namesake is module-private and unexported) and `isRichTextValue` (see below).

## The validity rules, stated precisely

### Node — `id ∧ type ∧ pos ∧ size ∧ type-specific requirement`

Evaluated in that order; the first failing conjunct is reported, so the reason names the most
fundamental defect rather than an arbitrary member of a set.

| Conjunct | `MISSING_*` when | `INVALID_*` when |
|---|---|---|
| `id` | `record.get(V2_FIELD.id) === undefined` | present, but not a non-empty string (`""` → `INVALID_ID`) |
| `type` | `record.get(V2_FIELD.type) === undefined` | present, but `readRecordType(record) === undefined` (WP11's "established type" = non-empty string) |
| `pos` | key absent | present, but `!isPosRegister(value)` — a torn `[1]`, an `{x, y}` object, a `[NaN, 3]` |
| `size` | key absent | present, but `!isSizeRegister(value)` |
| type-specific | the demanded key is absent | present, but not an acceptable value of it |

**Type-specific table** (BUILD_SPEC §4.5 `type-specific (file→file, text→text, …)`):

```text
file  → `file` must be a non-empty string
text  → `text` must be an acceptable rich-text value  (see below)
link  → `url`  must be a non-empty string             ← the spec's "…", same shape as file
other → no type-specific requirement at all
```

A node type absent from the table (e.g. `group`) is valid on its four core conjuncts alone. Silence
means "nothing further is demanded", never "unknown, therefore refuse" — refusing an unrecognised
type would make this validator the thing that drops records when the schema grows, which is exactly
the `importData` failure mode WP11 exists to prevent.

### How `text` tolerates both the string and the future `Y.Text` shape

Shared Ownership Contract §3 / Worker 2 escalation 5: P4 moves node `text` and edge `label` into a
nested collaborative text value **within schema major 2**, and reads must tolerate **both** shapes.
`V2Node.text` is already typed `unknown` for this reason. Asserting `typeof text === "string"` as a
hard validity condition would make the schema's own next version invalid on ingest — a declared
`SPEC_CONTRADICTION`.

The implemented predicate is therefore a disjunction, not a string test:

```ts
function isRichTextValue(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- **today's shape** — a plain, non-empty string (TP02). `""` is `INVALID_TYPE_SPECIFIC`, absent is
  `MISSING_TYPE_SPECIFIC`, so AC2's distinction survives on this field too.
- **P4's shape** — any non-null, non-array object is accepted. TP03 drives this with a real,
  standalone `new Y.Text("hello world")` and it validates.
- **duck-typed on purpose:** an `instanceof` check against the CRDT text type would require
  importing Yjs and would break AC4 (and TP12 scans the source for exactly that import). Arrays are
  excluded because an array is the register vocabulary's shape (`pos` is `[x, y]`); `null` is
  excluded because it is the JSON spelling of "no value at all". Anything narrower would be a guess
  about a type this module is not permitted to know.

No contradiction with the forward-compatibility constraint was encountered, so no escalation.

### Edge — `id ∧ from.node ∧ to.node`

1. `id` — same rule as the node's.
2. `hasBothEndpoints(record)` → **valid**. This single call *is* the endpoint decision; the module
   contains no inline endpoint logic and no endpoint string literal.
3. Otherwise the failure is attributed with `readFrom` / `readTo` (the same readers
   `hasBothEndpoints` is composed of), and `MISSING_*` vs `INVALID_*` again comes from whether the
   raw key was absent or merely malformed: `from` first, then `to`.

TP09 pins this behaviourally across 8 `to` shapes (well-formed, well-formed-with-`end`, absent,
missing `side`, empty `node`, a bare string, an array, an object with an extra key): the validator's
verdict equals `hasBothEndpoints` on every one. Delegation, not agreement-by-coincidence — which is
what keeps WP23's fuzzer oracle from ever drifting away from this barrier.

### Origin

`reason` never depends on origin. `reject` is computed in exactly one function:

```ts
function invalid(reason: IngestReasonCode, origin: IngestOrigin): IngestInvalid {
  return Object.freeze({ valid: false, reason, reject: origin === "local" });
}
```

Invalid **local** proposal → `reject: true` (never enters the doc; the invariant holds by
construction). Invalid **remote** delta → `reject: false`, always — refusing it would leave this
replica holding state its peers do not, i.e. divergence; those records are quarantined later by
WP20. A valid record returns `{valid: true}` with **no `reject` key**, under either origin.

## Visible Test Results

```text
$ npx vitest run src/__tests__/v2/wp14/ --reporter=dot
 Test Files  13 passed (13)
      Tests  39 passed (39)
   Duration  715ms
```

| Test point | File | Result |
|---|---|---|
| TP01 | `test_tp01_node_valid_file_type_visible.test.ts` | PASS |
| TP02 | `test_tp02_node_valid_text_type_string_visible.test.ts` | PASS |
| TP03 | `test_tp03_node_text_ytext_like_forward_compat_visible.test.ts` | PASS |
| TP04 | `test_tp04_node_missing_core_field_invalidates_visible.test.ts` | PASS (5) |
| TP05 | `test_tp05_node_type_specific_missing_vs_illtyped_visible.test.ts` | PASS (3) |
| TP06 | `test_tp06_node_pos_missing_vs_illtyped_visible.test.ts` | PASS (4) |
| TP07 | `test_tp07_edge_valid_both_endpoints_visible.test.ts` | PASS |
| TP08 | `test_tp08_edge_endpoint_missing_vs_illtyped_visible.test.ts` | PASS (3) |
| TP09 | `test_tp09_edge_validity_matches_hasBothEndpoints_visible.test.ts` | PASS (8) |
| TP10 | `test_tp10_origin_asymmetry_same_invalid_record_visible.test.ts` | PASS (2) |
| TP11 | `test_tp11_origin_no_effect_on_valid_record_visible.test.ts` | PASS |
| TP12 | `test_tp12_module_purity_static_imports_visible.test.ts` | PASS (6) |
| TP13 | `test_tp13_module_purity_deterministic_no_mutation_visible.test.ts` | PASS (3) |

**Typecheck:** `npx tsc -noEmit -skipLibCheck` from `plugin/` → clean, zero output. No new errors;
the previously-noted `src/__tests__/wp49/` errors were not present at the time of this run.

**Not run (per instructions):** the full `npm test` suite (Worker 3 runs it once at end of batch) and
`npm run build`.

## Summary for Worker 3

- `plugin/src/canvas/canvas-ingest-schema.ts` exists and is green on its own bucket: 13 files / 39
  assertions, plus a clean typecheck. Nothing outside the module, its charter and this report was
  touched; the visible tests were not modified.
- The module is **pure and unwired** — nothing imports it yet, so it cannot affect any other bucket
  in the batch run. Expect the full-suite delta to be exactly +13 files / +39 tests over the
  baseline.
- **Reuse held:** edge validity is a straight delegation to `hasBothEndpoints`, so WP14 and WP23's
  fuzzer oracle are structurally incapable of disagreeing. `readRecordType` (WP11),
  `isPosRegister` / `isSizeRegister` (WP9) and every `V2_FIELD` key name are imported; the module
  declares no field literal of its own.
- **One judgement call to be aware of:** the type-specific table also covers `link`→`url`, read as
  the BUILD_SPEC §4.5 "…" after the two named instances. It is additive and untested by the visible
  set; a node type not in the table has no type-specific requirement and is valid on its core
  conjuncts. If a blind test expects `link` nodes to have no requirement, this is the one line to
  revisit.
- **Handover to WP18:** call `validateNodeIngest` / `validateEdgeIngest` at the write boundaries and
  **obey `verdict.reject`** — do not re-derive rejection from the origin at the call site. That
  re-derivation is the bug AC3 and TP10 exist to prevent.

---

# Implementation Report — WP14 · AMENDMENT (E1 / E1-b rulings)
Attempt: 1 (re-entry, batch B3b, 2026-08-02)

## Status: DONE

## What this amendment does

Implements the two readings pinned by Worker 2's 2026-08-02 ruling. No AC is replaced.

1. **AC1's edge rule is exactly `id ∧ from.node ∧ to.node` — `side` is not a conjunct.** The rule
   itself was never wrong; WP10's over-constraint leaked in through the delegation. WP10 AC5 (landed
   in this same batch) fixes the model; WP14 now pins the consequence **directly**, so the two
   modules cannot silently drift apart again.
2. **`"text": ""` is a LEGAL empty text card.** For `text` the requirement is **presence and correct
   type** — any string satisfies it, including `""`.

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 node/edge validity rules | DONE | edge rule unchanged in code; now pinned directly against a side-less endpoint |
| AC2 missing vs. ill-typed distinguishable | DONE (subject untouched) | `MISSING_FROM`/`INVALID_FROM` and `MISSING_TYPE_SPECIFIC`/`INVALID_TYPE_SPECIFIC` still distinct; only the *per-field emptiness* rule for `text` changed |
| AC3 local rejects / remote never rejects | DONE (unchanged) | untouched |
| AC4 purity | DONE (unchanged) | no new import; source-scan test still green |

## Changes Made

`plugin/src/canvas/canvas-ingest-schema.ts` — one behavioural line.

| Symbol | Change |
|---|---|
| `isRichTextValue` | `typeof value === "string"` now returns `true` for ANY string (was `value.length > 0`). Object half unchanged; arrays and `null` remain invalid. |
| `validateEdgeIngest` | **code unchanged**; doc-comment now states that `side` is not a conjunct and why WP14 pins it independently. |

Explicitly NOT changed, and asserted so by the new test:

- `file` → `V2_FIELD.file` and `link` → `V2_FIELD.url` **keep** the non-empty requirement.
- A node type absent from `NODE_TYPE_SPECIFIC` (e.g. `group`) still carries no further requirement.
- The reason-code set, the origin asymmetry and the purity contract are untouched.

## Visible Test Results

| Test | Status | Notes |
|---|---|---|
| `wp14/test_tp01`…`tp07`, `tp10`…`tp13` | PASS | unchanged |
| `wp14/test_tp08_edge_endpoint_missing_vs_illtyped_visible` | PASS | **amended under licence** |
| `wp14/test_tp09_edge_validity_matches_hasBothEndpoints_visible` | PASS | **amended under licence** |
| `wp14/test_tp14_edge_sideless_endpoint_is_valid_visible` | PASS (new, 6 cases) | the E1 pin |
| `wp14/test_tp15_empty_text_card_is_valid_visible` | PASS (new, 6 cases) | the E1-b pin |

### Licensed test amendments (TC8, TC9)

Both used "`to` present but missing `side`" as their invalid example. That shape is now VALID, so the
example was pinning the defect.

- **TC8** — the ill-typed example is re-pointed at `to = {node: "", side: "left"}`: an endpoint that
  is present but genuinely unreadable. The test's real subject (absent key ⇒ `MISSING_TO`,
  present-but-unreadable ⇒ `INVALID_TO`, and the two reasons distinct) is asserted exactly as
  strictly as before.
- **TC9** — behavioural equality with `hasBothEndpoints` is retained unchanged (the expectation is
  still *derived* from the oracle at runtime, not hardcoded). The "missing side" row was relabelled
  as the legal side-less shape and the table was **extended**, not reduced: `side-less with end`,
  `no node, side only` and `wrong-typed side` were added (8 shapes → 11).

## Full-suite result (from `plugin/`)

- `npx tsc --noEmit` — clean.
- `npm test -- --reporter=dot` — **before: 30 failed | 1189 passed (1219)** → **after: 25 failed |
  1217 passed (1242)**.
- **Zero tests changed from passing to failing.** Five pre-existing baseline failures in
  `src/__tests__/canvas-sync.test.ts` now PASS (consequence of the WP10 AC5 model fix landed in the
  same batch).
- No test was deleted, skipped, `.only`'d, `.todo`'d, commented out or relaxed. No fixture edited.

## Summary for Worker 3

The validator no longer refuses two shapes that are legal JSON Canvas. A side-less endpoint validates
(pinned in five shapes, including the raw `{node}` object a peer or a migration could write, not just
`encodeEndpoint`'s output), and `text: ""` validates while `file: ""` / `url: ""` still do not. The
standing rule from the ruling is honoured: nothing was tightened, and the one loosening is bounded by
an explicit "does not leak sideways" assertion over `file` and `url`. The remaining 25 suite failures
are the pre-existing baseline set (WP18 wiring / `canvas-sync` / `canvas-persistence`), untouched by
this WP.
