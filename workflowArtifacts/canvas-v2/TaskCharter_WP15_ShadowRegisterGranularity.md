# Task Charter — WP15: Shadow at register granularity

**Charter Status:** `DONE`
**WP:** WP15
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP2, WP9, WP10
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** I6 and I8 hold together — staleness is judged per atomic register.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C15 — Shadow and intent diff at atomic-register granularity** (work package WP15); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (the C1/C2 module)
  - Responsibility: lift the shadow and the intent diff from V1 keys to V2 registers, so staleness detection compares whole registers.
  - Scope summary: shadow + intent diff lifted to V2 registers
- **Out of scope / non-goals:**
  - Creating the registers themselves (WP9/WP10) — this WP consumes them.
  - Writing tombstones — the tombstone view is an input.
  - Any change to the capture wiring — WP4 already owns that seam.
- **Known interfaces / dependencies:**
  - Input: V2-shaped records
  - Output: intent plans expressed in V2 registers
  - Depends on work packages: WP2, WP9, WP10
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 shadow-consistency assertion under the V2 model.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Shadow and intent diff at atomic-register granularity
- **Interfaces involved:**
  - Input: V2-shaped records
  - Output: intent plans expressed in V2 registers
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
  - `plugin/src/canvas/canvas-shadow.ts` (WP1/WP2)
  - the register modules from WP9 and WP10
  - CONCEPT_V2 Teil 5 and Teil 6.1 — one shadow, two consumers
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C15. No paraphrasing.*

1. The shadow stores `pos`, `size`, `from` and `to` as single fields; a change to one component of a composite marks the whole register as intent.
2. A save in which only the rounding of a coordinate differs produces **no** intent, because the capture-side rounding is applied before comparison.
3. The delete-intent rule and the resurrect block from C2 operate against the tombstone view rather than against key absence.
4. No V1 key names (`x`, `y`, `width`, `height`, `fromNode`, `fromSide`, `toNode`, `toSide`) remain as shadow field keys.

**Definition of Done:** I6 and I8 hold together — staleness is judged per atomic register.

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
  - `plugin/src/canvas/canvas-shadow.ts`
- **Required report:** `ImplementationReport_WP15.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

Module under test (modify-path, already exists and is green under P0): `plugin/src/canvas/canvas-shadow.ts`.

**Required implementation delta, derived from the test suite below (no `TombstoneView` shape
change, no new export is strictly required for the visible tests to compile — only a behaviour
fix in `planIntentDiff` rule 2):**

- **AC2 is the only genuine gap.** `ShadowFieldValue` must widen (type-only) to admit the
  composite register shapes (`readonly [number, number]` for `pos`/`size`, `{node, side, end?}`
  for `from`/`to`) so `npm run build`'s `tsc -noEmit` stays clean once callers pass V2-shaped
  fields. At runtime, rule 2's staleness comparison (`value === getField(...)`) is currently
  **reference** equality. `encodePos`/`encodeSize` (`canvas-registers.ts`) freeze a **freshly
  allocated** array on every call, so two calls with fractional input that round to the identical
  integer pair produce two different array instances holding the same numbers — `===` reports
  them unequal, a same-pixel restatement reads as intent, and I6 breaks. Rule 2 must use
  **structural/value equality** for array and plain-object field values (falling back to `===`
  for primitives, which is unaffected and preserves every existing primitive-keyed test). This can
  be a small local helper in `canvas-shadow.ts` — no new import is required to satisfy it.
- **AC1, AC3 and AC4 are already satisfied by the current, unmodified implementation** for
  V2-shaped composite fields, because the shadow's storage (`advanceField`/`advanceRecord`/
  `getField`/`getRecordFields`) and `planIntentDiff`'s field iteration are field-name- and
  field-shape-agnostic — they treat a field's value as one opaque unit regardless of whether a
  caller passes `"x": 10` or `"pos": [10, 20]`. The visible suite below confirms this rather than
  driving new production code for those three ACs. See the Impact Assessment / verification notes
  in `ImplementationReport_WP15.md` (Coder Sub-Agent) for confirmation once implemented.
- **AC3 — do not gate the delete-intent rule (rule 4) on tombstone status.** `test_tp05` locks in
  the existing, intentional "re-asserting an existing tombstone converges" design
  (`canvas-shadow.ts`'s own rule-4 docstring) and the existing `wp2/test_tp03_delete_gating_visible
  .test.ts` — "the block covers records in the save only — a missing record still follows the
  delete rule" — already pins a proven-missing + already-tombstoned record producing a delete
  intent. Making rule 4 suppress that intent would break a licensed-green existing test; WP15 is
  **not** one of the batch's licensed test-deleters (WP4/WP21/WP22/WP33 only). If a future reading
  of AC3 requires that suppression anyway, that is a `SPEC_CONTRADICTION` against the existing
  test — escalate, do not weaken the test.

### TC1 — pos/size/from/to are stored as single composite fields, never split
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp15/test_tp01_composite_single_field_visible.test.ts`
- What it checks: one `advanceField`/`advanceRecord` call with a `pos` (`[x, y]`), `size`
  (`[w, h]`) or `from`/`to` (`{node, side, end?}`) value produces exactly one shadow field key
  (`getRecordFields` returns one key per composite, never a split `x`/`y`/`width`/`height`/
  `fromNode`/... key), and `getField` round-trips the whole value intact.
- Test data channel: literal fractional/rounded coordinates via `encodePos`/`encodeSize`/
  `encodeEndpoint` (`canvas-registers.ts`).

### TC2 — a change to ONE component of a composite marks the WHOLE register as intent (I8)
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp15/test_tp02_component_change_whole_register_visible.test.ts`
- What it checks: `planIntentDiff` over a save whose `pos`/`size` register differs from the shadow
  in only one component (e.g. x moves, y does not) produces exactly ONE upsert for the composite
  field name, whose value carries BOTH components — never two component-shaped upserts, never a
  discard for the unchanged component (which cannot exist, since there is no such field).
- Test data channel: `encodePos`/`encodeSize` pairs differing in exactly one component.

### TC3 — a rounding-only difference produces zero intent (I6, the highest-risk gap)
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp15/test_tp03_rounding_no_intent_visible.test.ts`
- What it checks: a shadow holding a rounded `pos`/`size` register and a save re-encoding a
  fractional coordinate that rounds to the SAME integer pair (via a fresh, reference-distinct
  `encodePos`/`encodeSize` call) produces zero upserts and one `discarded` entry
  (`reason: "equals-shadow"`); a genuine move to a different pixel still produces a real upsert
  (discrimination case, proves the fix does not over-suppress).
- Test data channel: fractional coordinates chosen to round to a pre-established integer register,
  plus one coordinate chosen to round to a different pixel.

### TC4 — the resurrect block reads the real WP12 tombstone predicate, for V2 registers
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp15/test_tp04_resurrect_block_tombstone_view_visible.test.ts`
- What it checks: a `TombstoneView` test double built entirely from `canvas-tombstone.ts`'s own
  `applyTombstoneOp` + `isTombstoneSuppressed` (never a local `Set`/boolean reimplementation of "is
  this deleted") still fully blocks a tombstoned record's changed `pos`/`size` registers from
  producing any upsert, delete or discard; the identical save without the tombstone yields the real
  upsert (discrimination).
- Test data channel: real `TombstoneEntry` values applied via `applyTombstoneOp` to a stub
  `TombstoneMap`.

### TC5 — the delete rule stays correct for V2 registers under the real tombstone view
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp15/test_tp05_delete_rule_tombstone_view_visible.test.ts`
- What it checks: a proven-missing (open view + hand-over receipt) record with a V2 `pos` register
  produces a delete intent identically whether or not it already carries an active tombstone
  (applied via the same real `isTombstoneSuppressed`-backed view as TC4) — pins the existing,
  intentional "re-asserting an existing tombstone converges" design rather than introducing a
  tombstone-status gate on rule 4 (see the delta note above).
- Test data channel: real `TombstoneEntry` values via `applyTombstoneOp`, `pos` registers via
  `encodePos`.

### TC6 — a dynamic scan finds zero V1 key names anywhere in the shadow
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp15/test_tp06_no_v1_key_names_visible.test.ts`
- What it checks: after driving the shadow through `advanceRecord` with V2 composite fields and
  through a `planIntentDiff` pass over a V2-shaped save, every field key actually stored/emitted is
  scanned (`Object.keys` of `getRecordFields` output and of the intent plan's field names) against
  the literal eight-name V1 list (`x`, `y`, `width`, `height`, `fromNode`, `fromSide`, `toNode`,
  `toSide`) — none may appear, checked by membership, not a hand-picked spot check.
- Test data channel: `encodePos`/`encodeSize`/`encodeEndpoint` values across multiple records.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*None — all 4 ACs are unit-testable directly against the pure `canvas-shadow.ts` module with no
Obsidian/Yjs/filesystem seam involved; nothing here is INTEGRATION_SCOPE.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** 15 of the 17 visible tests already passed against the unmodified
  module. The two failures were both in `test_tp03_rounding_no_intent_visible.test.ts` (`pos` and
  `size` rounding-only restatement): `planIntentDiff` rule 2 compared with `===`, so the freshly
  frozen array `encodePos`/`encodeSize` allocates on every call never matched the value-identical
  array already in the shadow, and a same-pixel restatement was classified as intent (I6 broken).
- **Approach:** two changes in `canvas-shadow.ts`, no restructuring.
  1. `ShadowFieldValue` widened (type-only) with `PosRegister | SizeRegister | EndpointRegister`,
     **imported** via `import type` from `canvas-registers.ts` rather than re-declared (Shared
     Ownership Contract §1). Erased at compile time, so the runtime purity contract is untouched.
  2. Rule 2's comparison replaced by a module-private `fieldValueEquals(a, b)`: `===` first (so the
     primitive path is byte-identical to before), then element-wise for arrays and observed-key-wise
     for plain data objects, with a depth cap so a malformed cyclic value degrades instead of
     blowing the stack. AC1/AC3/AC4 needed no production change, exactly as §7 predicted.
- **Fallback path if all attempts fail:** not needed — attempt 1 passed all 17 visible tests with
  the five P0 buckets and `tsc -noEmit` clean.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. 17/17 visible tests green; the five P0 buckets (wp1, wp2, wp4,
  wp5v2, wp6) 164/164 green; the whole `src/__tests__/v2/` tree 330/330 green; the five non-v2 files
  that consume this seam 136/136 green; `npx tsc -noEmit -skipLibCheck` exits 0.
- **What remains open:** nothing in WP15's scope. No existing test was adjusted, deleted or relaxed.
  Note for the batch: `canvas-shadow.ts` consumes the tombstone view as an INPUT seam and holds zero
  copies of the suppression predicate — the `isTombstoneSuppressed` binding lives at the call site,
  which is what TC4/TC5 exercise. See the report's AC3 note.
- **Final status:** `DONE`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
