# Task Charter — WP56: Blind re-verification, previously discoverable sets

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP56
**task_mode:** `standard`
**Depends on:** WP55
**W4 Test Targets:** `0`

---

## 1. Task Objective

- **Outcome:** Every blind set whose files were already framework-discoverable is re-run under the repaired runner, and `BlindVerificationLedger.md` records per `(WP, set)` what was previously claimed, what actually executed, and what the real result is.
- **BUILD_SPEC reference:** §5 PHASE VI → **C56 — Blind re-verification: previously discoverable sets**; gate in §7 "Blind-set execution gate" (retro-application clause).

---

## 2. Scope and Boundaries

- **In scope:**
  - Re-running, under WP55's repaired runner, the TypeScript blind sets for **WP1–WP16 and WP49**, both `blind_set1` and `blind_set2`.
  - Creating `workflowArtifacts/canvas-v2/BlindVerificationLedger.md` with the row schema and verdict vocabulary that WP57 will extend.
  - Reconciling each result against the claim recorded in the owning handover or implementation report, by artefact and line.
- **Out of scope / non-goals:**
  - The sets whose files match no discovery pattern (WP41, WP42, WP46-TS), the TypeScript files inside WP44/WP47, and the Python sets WP43–WP48 — **all deferred to WP57**. This charter must not silently absorb them.
  - Repairing anything. This WP observes and records; it does not fix implementations, tests or the runner.
  - Re-running visible test suites, or re-establishing the plugin/server baselines.
- **Known interfaces / dependencies:**
  - WP55 must be `DONE`. Under the unrepaired runner this WP produces exactly the untrustworthy evidence it exists to eliminate.
  - Claim sources: `Worker3Handover_B1_P0.md` (WP1–WP5, and the WP4 Phase-7 regression re-run), `Worker3Handover_B9a_T3infra.md` (WP49), and `ImplementationReport_WP*.md` for the rest. WP8–WP16 are batch **B2**, which is in flight — coordinate with the Dispatcher on when B2's sets are stable enough to re-run, and record the commit or run state the measurement was taken at.

---

## 3. Architecture Context

- **Component(s) being changed:** C56 — a new artefact, `BlindVerificationLedger.md`. No source code changes at all.
- **Interfaces involved:**
  - Input: WP55's per-set machine-readable record; the blind sets; the prior claims.
  - Output: one ledger row per `(WP, set)`.
- **Constraints from BUILD_SPEC:**
  - §7: until a `(WP, set)` pair carries a CONFIRMED verdict with a non-zero collected count in this ledger, its blind claim is unverified regardless of what any handover says.
  - Absence of a ledger row is never readable as a pass.
- **Technology / framework / config constraints:** Vitest 4.0.18; `PYTHONIOENCODING=utf-8` before invoking the runner; long runs through `visible-console` `run_python` with an absolute path, then `await_console`; budget ≥90 s per plugin-suite invocation.
- **Entry points / relevant files:** `workflowArtifacts/canvas-v2/_run_blind.py` (repaired), `tests/blind_set{1,2}/WP<N>/`.
- **Structure references:** *(none — Worker 3 fills after implementation.)*

**Prior-probability note, to be tested and not assumed.** These sets' files already carry `*.test.ts` names and their `../../../` imports match the current staging depth, so they are the sets most likely to have genuinely executed. `Worker3Handover_B1_P0.md` additionally reports concrete non-zero counts (e.g. 362 tests over three stable runs for WP1–WP5), which is itself evidence of execution under the very rule §7 now mandates. **This is a reason to expect CONFIRMED, not a reason to skip the measurement.** A set is verified when it has a row, not when it looks plausible.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C56.*

1. Every blind set whose files already carried a framework-discoverable name — the TypeScript sets for WP1–WP16 and WP49, and no others — is re-run under C55, and each produces one ledger row carrying: the previously-claimed result with the artefact and line that claimed it, the number of tests actually collected, the numbers passed and failed, and a verdict.
2. The verdict vocabulary is exactly **CONFIRMED** (the set executed a non-zero count and the result matches the prior claim), **VACUOUS** (the prior claim rests on a run that executed zero tests), **DIVERGENT** (the set executed but the result contradicts the prior claim) or **UNRUNNABLE** (the set cannot be executed even under the repaired runner, with the obstruction named). No other verdict is admissible, and no row may be left blank.
3. Every WP whose blind claim is found VACUOUS or DIVERGENT is named explicitly in the ledger and in the implementation report, together with the handover artefact whose claim it invalidates. The ledger states plainly, in its own text, that a VACUOUS or DIVERGENT verdict invalidates the corresponding claim in an already-closed handover.
4. The ledger states its own coverage boundary: which `(WP, set)` pairs this work package re-ran, which are deferred to C57, and which have no blind set at all — so a reader can distinguish a set that passed from a set nobody looked at. Absence of a row is never readable as a pass.
5. No blind test file is edited, renamed in place, deleted or weakened by this work package. Re-verification observes; it does not repair. A blind test found to be itself defective is recorded as a finding and left unmodified.

**Definition of Done:** For every previously-discoverable blind set, the project can say whether its green was real, citing a ledger row with a collected count.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows; cp1252 encoding trap; slow vitest runs.
- **Known flaky patterns:**
  - **WP4's blind sets have a documented history of nondeterminism.** `Worker3Handover_B1_P0.md` records a blind test that failed on runs 1, 3, 4 and 6 of six on an unchanged tree, because two peers wrote the same key concurrently and Yjs broke the tie on a random `clientID`. It was subsequently repaired to be causally deterministic. If a WP4 row goes red, **re-run before assigning DIVERGENT** and record the run count — a flake recorded as a divergence would be a false accusation against a closed batch.
  - WP6 has **no blind set by declared deviation** (its deliverable *is* a test suite). WP7 likewise has none. These are "no blind set" rows, not missing rows, and must be present as such under AC4.
  - B2 is in flight. A red row for WP8–WP16 may reflect work in progress rather than a vacuous historical claim. Record the run state and say which it is; do not report an in-flight failure as an invalidated claim.
- **External dependency risks:** none — no code changes, no dependencies.
- **Hard constraints:**
  - Do not edit, rename in place, or delete any blind file. Not even an obviously broken one.
  - Do not fix any implementation defect this WP surfaces. Record it, name its owner, and hand it back to the Dispatcher.
  - Every row carries a collected count. A row without one is not a row.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `workflowArtifacts/canvas-v2/BlindVerificationLedger.md` (created).
- **Required report:** `ImplementationReport_WP56.md`, naming every VACUOUS or DIVERGENT verdict and the handover claim it invalidates.
- **BUILD_SPEC updates required:** no.
- **Gate status required at handover:** the ledger covers its declared scope with no blank cells, and its deferred-scope statement matches WP57's charter exactly.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's producer sub-agent.*
