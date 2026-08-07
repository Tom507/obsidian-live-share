# Task Charter — WP14: Ingest schema validator

**Charter Status:** `DONE`
**WP:** WP14
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP9, WP10, WP11
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** "an edge has two endpoints" is a type constraint at the boundary, not a downstream filter.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C14 — Ingest schema validator** (work package WP14); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (pure module)
  - Responsibility: express the schema invariants as a type barrier at the replica's boundary rather than as a filter at serialisation.
  - Scope summary: node/edge validity, local-vs-remote asymmetry
- **Out of scope / non-goals:**
  - Calling the validator at write boundaries — that is WP18.
  - Repairing invalid records already in the doc — that is WP20.
  - Rejecting remote deltas (explicitly forbidden: it would cause divergence).
- **Known interfaces / dependencies:**
  - Input: a proposed record (node or edge) and its origin class (`local` | `remote`)
  - Output: valid, or invalid with a machine-readable reason
  - Depends on work packages: WP9, WP10, WP11

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Ingest schema validator
- **Interfaces involved:**
  - Input: a proposed record (node or edge) and its origin class (`local` | `remote`)
  - Output: valid, or invalid with a machine-readable reason
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - **Schema impact:** **`meta.schemaVersion = 2`.** The *doc* format changes; the `.canvas` *file* format does not. Mixed-version rule (CONCEPT_V2 Teil 12): a client whose major schema version differs from the doc's goes to Receive-and-Persist rather than guessing a translation. In P1 that degradation is local — capture disabled for the path, persistence continues — and it is unified with the room-level mode in WP32.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - CONCEPT_V2 Teil 11 — the two validity rules
  - `plugin/src/files/canvas-sync.ts:880–948` — `auditCanvasState`, whose current detection categories (`noGeo`, `noType`, `fileNodesWithoutFile`, `danglingEdges`) define the same invariants
  - `ARCHITECTURE.md` Appendix A.2/16–18
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C14. No paraphrasing.*

1. `Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific requirement` and `Edge valid ⟺ id ∧ from.node ∧ to.node` are both implemented exactly as stated, with the type-specific requirement covering at least `file`→`file` and `text`→`text`.
2. A record that is missing a key and a record whose key is present but empty/ill-typed are both invalid, and their reasons are distinguishable.
3. For origin `local`, the verdict is reject; for origin `remote`, the function reports invalidity but never signals rejection — this asymmetry is explicit in the API, not left to callers.
4. The module is pure and has no knowledge of Yjs, Obsidian or the filesystem.

**Definition of Done:** "an edge has two endpoints" is a type constraint at the boundary, not a downstream filter.

---

<!-- Updated: E1 + E1-b rulings — WP14 REOPENED; the validator refused two shapes that are legal JSON Canvas, and refusal was destructive 2026-08-02 -->

### Amendment (2026-08-02, Worker 2 — E1 / E1-b rulings). WP14 is REOPENED. No AC is replaced; AC1 and AC2 are read as follows.

**1. AC1's edge rule is exactly `id ∧ from.node ∧ to.node` — `side` is not a conjunct.**

The rule was never wrong. WP14 delegates the endpoint test to WP10, so WP10's over-constraint (a register required a non-empty `side`) leaked in as `MISSING_FROM` on a fully-connected edge — and because refusal at the seed then composed with `flush()` into deletion, it destroyed the user's edge. CONCEPT_V2 Teil 11's own predicate is `Edge gültig ⟺ id ∧ from.node ∧ to.node`; `side` was never in it.

The rule becomes correct automatically once WP10 AC5 lands. **WP14 must additionally pin it directly:** a validator test over an edge whose `from` register carries a `node` and **no** `side` must return valid. Without that pin the two modules can silently drift apart again, which is exactly how this defect reached a live path. The diagnosis codes stay distinguishable: an absent `from` key is `MISSING_FROM`, a present-but-unreadable `from` is `INVALID_FROM`.

**2. AC2's "present but empty is invalid" is per-field, and `text` is exempt.**

`"text": ""` is a **legal** JSON Canvas text node — an empty card the user has not typed into yet, or one whose content they cleared. The landed implementation requires a non-empty string, so it refuses that card, and under the pre-I11 coupling the refusal deleted it. This is a second, independent instance of the E1 class, found during the ruling and not previously reported.

- `text` → the requirement is **presence and correct type**. **Any** string satisfies it, including `""`. The tolerant object form reserved for the future `Y.Text` shape stays; arrays and `null` stay invalid.
- `file` and `url` → **keep** the non-empty requirement. An empty path or URL addresses nothing, and under I11 a misjudgement there is no longer destructive.
- A node type absent from the type-specific table (e.g. `group`) continues to carry **no** further requirement. Absence from the table means "nothing more demanded", never "refuse".

AC2's real subject — that a **missing** key and a **present-but-ill-typed** key produce **distinguishable** reasons — is untouched and still binding.

**Standing rule for this module.** The validator's job is to refuse records that are invalid *under the JSON Canvas format and this spec's registers*, never records that are merely unusual. Any future tightening must be checked against a real `.canvas` file first: at this boundary, "stricter" and "safer" point in **opposite** directions, because refusal is the input to a write-back that overwrites the user's file. I11 / WP63 is the safety net, not a licence to guess.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - a new validator module under `plugin/src/canvas/`
- **Required report:** `ImplementationReport_WP14.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

13 distinct test points identified across the 4 ACs, each realised as a visible test plus two
independent blind tests (`workflowArtifacts/canvas-v2/tests/blind_set1/WP14/`,
`.../blind_set2/WP14/`). All test doubles are a plain `Map`-backed `V2RecordMap` stub — no
`Y.Doc`, no real Yjs document. Module under test (create-path, does not exist yet):
`plugin/src/canvas/canvas-ingest-schema.ts`.

### TC1 — a fully-populated `file`-type node is valid
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp14/test_tp01_node_valid_file_type_visible.test.ts`
- What it checks: `id ∧ type ∧ pos ∧ size ∧ file` all present → `validateNodeIngest(...).valid === true`, the `file`→`file` instance AC1 pins by name.
- Test data channel: synthetic `V2RecordMap` stub, `encodePos`/`encodeSize` for the registers.

### TC2 — a fully-populated `text`-type node (plain string) is valid
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp14/test_tp02_node_valid_text_type_string_visible.test.ts`
- What it checks: `id ∧ type ∧ pos ∧ size ∧ text` (plain string) → valid, the `text`→`text` instance AC1 pins by name.
- Test data channel: synthetic `V2RecordMap` stub.

### TC3 — a `text`-type node whose `text` is a `Y.Text` instance is valid (forward-compat)
- Verifies AC: AC1 (plus the rule-0 forward-compatibility check: P4's move of `text`/`label` to a nested `Y.Text` stays within schema major 2, per Shared Ownership Contract §3)
- Test file: `plugin/src/__tests__/v2/wp14/test_tp03_node_text_ytext_like_forward_compat_visible.test.ts`
- What it checks: a real, unattached `Y.Text` instance in the `text` field is accepted, not rejected as ill-typed — pinning the tolerant reading (non-empty string OR non-null object), not `typeof text === "string"`.
- Test data channel: synthetic `V2RecordMap` stub; `text` value is a real `new Y.Text(...)` (constructed standalone, not integrated into a `Y.Doc`).

### TC4 — each of the four core conjuncts is independently required
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp14/test_tp04_node_missing_core_field_invalidates_visible.test.ts`
- What it checks: removing `id` / `type` / `pos` / `size` in turn from an otherwise-valid node each invalidates it with the matching `MISSING_*` reason; `id: ""` gives `INVALID_ID`, distinct from `MISSING_ID`.
- Test data channel: synthetic `V2RecordMap` stub, fields deleted individually from a valid base fixture.

### TC5 — the type-specific requirement distinguishes missing from ill-typed
- Verifies AC: AC1, AC2
- Test file: `plugin/src/__tests__/v2/wp14/test_tp05_node_type_specific_missing_vs_illtyped_visible.test.ts`
- What it checks: a `file`-type node with no `file` key → `MISSING_TYPE_SPECIFIC`; with `file: ""` → `INVALID_TYPE_SPECIFIC`; the two reason codes differ.
- Test data channel: synthetic `V2RecordMap` stub.

### TC6 — `pos` distinguishes missing from ill-typed
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp14/test_tp06_node_pos_missing_vs_illtyped_visible.test.ts`
- What it checks: no `pos` key → `MISSING_POS`; `pos` present but a torn one-element array → `INVALID_POS`, distinct reason; a well-formed `pos` alongside the same base is valid (sanity bound).
- Test data channel: synthetic `V2RecordMap` stub.

### TC7 — an edge with id and both well-formed endpoints is valid
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp14/test_tp07_edge_valid_both_endpoints_visible.test.ts`
- What it checks: `id ∧ from.node ∧ to.node` all present and well-formed (via WP10's `encodeEndpoint`) → `validateEdgeIngest(...).valid === true`.
- Test data channel: synthetic `V2RecordMap` stub.

### TC8 — an edge endpoint distinguishes missing from ill-typed
- Verifies AC: AC1, AC2
- Test file: `plugin/src/__tests__/v2/wp14/test_tp08_edge_endpoint_missing_vs_illtyped_visible.test.ts`
- What it checks: no `to` key → `MISSING_TO`; `to` present but missing `side` → `INVALID_TO`, distinct reason.
- Test data channel: synthetic `V2RecordMap` stub.

### TC9 — edge validity agrees with `hasBothEndpoints` across a shape table
- Verifies AC: AC1 (reuse — Shared Ownership Contract §1: `hasBothEndpoints` is WP9/WP10's single predicate for "no endpoint-less edge", and WP14 must ask the same question the same way, not re-derive it)
- Test file: `plugin/src/__tests__/v2/wp14/test_tp09_edge_validity_matches_hasBothEndpoints_visible.test.ts`
- What it checks: for a table of 8 `to` shapes (well-formed, absent, missing `side`, empty `node`, wrong primitive, wrong array shape, extra key), `validateEdgeIngest(...).valid` equals `hasBothEndpoints(record)` exactly — a behavioural, not source-level, reuse pin.
- Test data channel: synthetic `V2RecordMap` stub; imports `hasBothEndpoints` directly from `canvas-registers.ts` as the comparison oracle.

### TC10 — local rejects, remote never rejects, for the SAME invalid record (the crux)
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp14/test_tp10_origin_asymmetry_same_invalid_record_visible.test.ts`
- What it checks: one invalid node record (missing `pos`), validated under both origins: `local` → `reject: true`; `remote` → `reject: false`; same `reason` under both. Fails a design where both origins return an identical verdict shape and the caller must infer rejection from the origin itself.
- Test data channel: synthetic `V2RecordMap` stub, one fixture validated twice (once per origin).

### TC11 — origin has no effect on a valid record's verdict
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp14/test_tp11_origin_no_effect_on_valid_record_visible.test.ts`
- What it checks: a valid node is `valid: true` under both `local` and `remote`, with the two verdicts deep-equal — bounds the asymmetry to the invalid path only.
- Test data channel: synthetic `V2RecordMap` stub.

### TC12 — the module imports nothing but its declared P1-core dependencies
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp14/test_tp12_module_purity_static_imports_visible.test.ts`
- What it checks: source-scan (following the `wp1`/`wp2` precedent) — no `yjs`/`obsidian`/`node:fs` specifier, no `Date.now`/`Math.random`/`setTimeout`/DOM globals, and every `from "..."` specifier is relative.
- Test data channel: `readFileSync` on the module's own source file (not a runtime probe — Vitest's node environment already lacks DOM/host globals, which would make a runtime check pass vacuously).

### TC13 — the validator is deterministic and never writes to the record
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp14/test_tp13_module_purity_deterministic_no_mutation_visible.test.ts`
- What it checks: repeated calls on the same input return deep-equal verdicts; a `set()`-call-counting stub records zero writes across both valid and invalid, `local` and `remote` calls.
- Test data channel: synthetic `V2RecordMap` stub instrumented with a `setCallCount` counter.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*None.* WP14 is a pure, non-wired module (TaskCharter §2: calling the validator at write
boundaries is WP18's, explicitly out of scope here). All 13 test points are unit-scope against a
synthetic `V2RecordMap` stub; none require the running plugin, a live doc, or an integration
harness. `W4 Test Targets` therefore stays `0`.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** the invariants existed only downstream, as `auditCanvasState`'s
  `noGeo` / `noType` / `fileNodesWithoutFile` / `danglingEdges` counters — a description of damage
  already in the doc, not a barrier. No module existed at `plugin/src/canvas/canvas-ingest-schema.ts`.
- **Approach:** one pure module exporting `validateNodeIngest` / `validateEdgeIngest`, testing the
  conjuncts in schema order and returning the first failure as a `MISSING_*` / `INVALID_*` code.
  Every question is asked through the predicate that already owns it — `readRecordType` (WP11),
  `isPosRegister` / `isSizeRegister` (WP9), and `hasBothEndpoints` (WP9/WP10) for the whole of edge
  endpoint validity. Origin is read in exactly one place (the `invalid(...)` constructor), where it
  sets `reject: origin === "local"`; the valid verdict has no `reject` key at all.
- **Fallback path if all attempts fail:** n/a — attempt 1 landed green (39/39 visible assertions).

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** `plugin/src/canvas/canvas-ingest-schema.ts` — AC1–AC4 all satisfied; 13/13
  visible test files, 39/39 assertions PASS; `npx tsc -noEmit -skipLibCheck` clean.
- **What remains open:** nothing in scope. Wiring at the write boundaries is WP18, quarantine of
  invalid remote records is WP20 — both explicitly out of scope here.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
