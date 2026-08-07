# Task Charter — WP11: Write-once `type` guard

**Charter Status:** `DONE`
**WP:** WP11
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP8
**W4 Test Targets:** `1`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** `type` cannot change or vanish after record creation.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C11 — Write-once `type` guard** (work package WP11); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (pure guard, consumed by the ingest boundary)
  - Responsibility: turn `type` loss from a protected key into an impossible operation.
  - Scope summary: immutable type after creation
- **Out of scope / non-goals:**
  - Wiring the guard into the write boundaries — that is WP18.
  - Removing `PROTECTED_KEYS`, which stays as defence in depth without carrying correctness.
- **Known interfaces / dependencies:**
  - Input: a proposed field write for `type` on a record
  - Output: accept (first write) or reject-with-signature (any later change)
  - Depends on work packages: WP8

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Write-once `type` guard
- **Interfaces involved:**
  - Input: a proposed field write for `type` on a record
  - Output: accept (first write) or reject-with-signature (any later change)
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
  - `plugin/src/files/canvas-sync.ts:53–62` — `PROTECTED_KEYS`
  - `plugin/src/files/canvas-sync.ts:171–195` / `:210–234` — `applyToYMap` and `applyKeyDiff`, the two existing delete guards
  - `ARCHITECTURE.md` Appendix A.2/17 — the `type`-loss silent-drop case
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C11. No paraphrasing.*

1. The first write of `type` on a record is accepted; every subsequent write with a different value is rejected and produces a signature in the log.
2. A subsequent write with the **same** value is a no-op and produces no delta and no signature.
3. A record can never reach the doc without `type` through any local write path.

**Definition of Done:** `type` cannot change or vanish after record creation.

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
  - the ingest/guard module under `plugin/src/canvas/`
- **Required report:** `ImplementationReport_WP11.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

### TC1 — first write of `type` is accepted
- Verifies AC: AC1 (first half)
- Test file: `plugin/src/__tests__/v2/wp11/test_tp01_first_write_accepted_visible.test.ts`
- What it checks: calling the guard on a record with no `type` yet stores the proposed value and returns an `"accepted"` verdict. State (the record's stored `type`) is the primary oracle, checked alongside the verdict's `kind`.
- Test data channel: real `Y.Doc` / `Y.Map` record host, node id `"n1"`, proposed value `"text"`.

### TC2 — a later differing write is rejected with a signature
- Verifies AC: AC1 (second half)
- Test file: `plugin/src/__tests__/v2/wp11/test_tp02_differing_write_rejected_signature_visible.test.ts`
- What it checks: after an accepted first write, a second write with a *different* value leaves the stored `type` unchanged (primary oracle), returns a `"rejected"` verdict (primary oracle), fires zero Yjs `update` events, and carries a `signature` string (secondary oracle) that names the record id and the offending proposed value — never asserted as an exact hardcoded string.
- Test data channel: real `Y.Doc` / `Y.Map`, node id `"n9"`, first value `"text"`, rejected value `"link"`.

### TC3 — a same-value rewrite is a no-op with no delta and no signature
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp11/test_tp03_same_value_rewrite_noop_no_delta_visible.test.ts`
- What it checks: re-submitting the identical value after an accepted first write returns a `"noop"` verdict carrying no `signature` field, fires zero `update` events, and produces zero encoded CRDT delta against a state-vector snapshot taken right after the first write (deep-equal on the stored value alone would falsely pass here — Yjs still emits a real delta for a same-value LWW `set`, per the WP8 tp04 precedent).
- Test data channel: real `Y.Doc` / `Y.Map`, node id `"n5"`, value `"text"` written then re-submitted unchanged.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

### AC3 — `INTEGRATION_SCOPE`

- **AC text:** "A record can never reach the doc without `type` through any local write path."
- **Why this cannot be proven at unit level:** the guard's own decision function only judges one proposed field write against a record's current state; "any local write path" spans every call site that can create or mutate a record in the doc (the capture path in `canvas-sync.ts`, the eventual ingest boundary). Proving no such path can land a record without `type` requires the write boundaries to actually be wired through the guard — which is explicitly WP18's scope, not WP11's (TaskCharter §2: "Wiring the guard into the write boundaries — that is WP18"). Faking this proof at the unit level (e.g. by asserting only against the guard's own API) would not actually demonstrate the property AC3 claims.
- **Where it belongs:** W4 / integration testing, once WP18 wires `canvas-type-guard.ts` into the write boundaries.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `type` was defended only by `PROTECTED_KEYS` (`canvas-sync.ts:53–62`), a *delete* guard at one call site — it stops the key from being removed but not from being overwritten, and it carries no notion of "already established". `canvas-sync.ts`'s `auditCanvasState` already *detects* the resulting `NO TYPE signature` corruption after the fact, but nothing prevents it.
- **Approach:** a pure decision function `guardTypeWrite(record, recordId, proposedType)` in the new `plugin/src/canvas/canvas-type-guard.ts`, zero imports beyond `canvas-registers.ts` (`V2_FIELD`, `V2RecordMap`). Three verdicts — `accepted` (the only branch that calls `record.set`), `noop` (same value; no `set`, therefore no CRDT delta and no `signature` key at all), `rejected` (differing or invalid proposal; no `set`, carries the signature). An established `type` is defined as a non-empty string, matching the existing audit's own predicate, so a record already corrupted to `""`/non-string can still be repaired rather than being frozen broken. The verdict is the mechanism; the signature string reuses `canvas-sync.ts`'s `<NAME> signature: …` shape and is emitted by the *caller*, not by this module.
- **Fallback path if all attempts fail:** n/a — all three visible tests passed on attempt 1.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** `plugin/src/canvas/canvas-type-guard.ts` with `guardTypeWrite`, `TypeWriteVerdict` and `readRecordType`. AC1 and AC2 fully covered; 3/3 visible tests green; `npx tsc -noEmit -skipLibCheck` clean.
- **What remains open:** AC3 (classified `INTEGRATION_SCOPE` in §7b) — the guard is deliberately NOT wired into any write boundary; that is WP18. `PROTECTED_KEYS` left untouched as defence in depth.
- **Final status:** `DONE`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
