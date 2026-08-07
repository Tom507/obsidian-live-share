# Task Charter — WP62: WP17 blind-set ledger coverage

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP62
**Phase:** VI
**task_mode:** `standard`
**Depends on:** WP55, WP56, WP57 · **and on batch B2 being closed** (see §5)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** `BlindVerificationLedger.md` carries a row for `WP17 set1` and `WP17 set2`, so that no `(WP, set)` pair that exists on disk is without a verdict.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C62 — WP17 blind-set coverage** (work package WP62); phase **VI**. Closes the coverage boundary that C56 AC4 and C57 AC4 established.

---

## 2. Scope and Boundaries

- **In scope:**
  - Running `tests/blind_set1/WP17/` and `tests/blind_set2/WP17/` (12 TypeScript files each) under the repaired WP55 runner.
  - Appending exactly two rows to `BlindVerificationLedger.md` in the schema and verdict vocabulary WP56 already established.
  - Updating the ledger's **coverage-boundary section** so the stated folder count matches what a reader's directory listing shows today (**24** WP folders, not 23), and removing the "WP17 is deliberately not covered" carve-out once the rows exist.
  - Recording any failing test as a **finding**, exactly as WP56/WP57 did.
- **Out of scope / non-goals:**
  - Editing, renaming in place, deleting or weakening any blind test file. This work package observes; it does not repair. This is the same hard constraint C56 AC5 and C57 AC5 carry, and it is not relaxed here.
  - Repairing any WP17 implementation defect the run surfaces. If WP17's blind set is red, that is a finding handed back for its own charter — not something this WP fixes.
  - Any change to `_run_blind.py`. If the repaired runner cannot run WP17, that is an `UNRUNNABLE` row with the obstruction named, plus an escalation — never a local patch.
  - Re-running or re-rowing any other `(WP, set)` pair. The 52 existing rows are not reopened.
- **Known interfaces / dependencies:**
  - WP55 `DONE` (the runner), WP56 `DONE` (owns the ledger file, the row schema and the verdict vocabulary, reused here without redefining), WP57 `DONE` (completed the rest of the coverage).
  - `TaskCharter_WP17_CanonicalSerializerV2.md` is already `DONE`; its claim source, if any, is `ImplementationReport_WP17.md` and whichever B2 handover closes it.

---

## 3. Architecture Context

- **Component(s) being changed:** C62 — appends to `BlindVerificationLedger.md`. **No source code changes.**
- **Interfaces involved:** input is the WP55 runner's per-set machine-readable record plus WP17's prior claim (if one exists); output is two ledger rows in WP56's schema.
- **Constraints from BUILD_SPEC:**
  - §7 — a blind claim without a CONFIRMED ledger row and a non-zero collected count is unverified regardless of what any handover says.
  - §7 — **absence of a row is never readable as a pass.** WP17 currently has no row; that is precisely the gap this WP closes, and it must not be closed by asserting a pass.
  - A run that collects **zero** tests is a hard failure under a named reason, never a pass (C55 AC1).
- **Technology / framework / config constraints:**
  - `PYTHONIOENCODING=utf-8` before invoking the runner — it raises `UnicodeEncodeError` on a cp1252 console when a set fails, and this WP may well see failures.
  - WP17's blind files are TypeScript (`*_blind{1,2}.test.ts`), already discoverable by name; they target the **plugin** package.
  - **Staging depth is derived per set by the repaired runner — do not hardcode or assume it.** WP1–WP16 resolve at depth 3; WP47 and WP49 TS need depth 2. WP17 must be resolved by the runner's own import-resolution pass, not by analogy to its neighbours.
  - Invocation: `python _run_blind.py WP17 both`, then read the emitted `_blind_records/*.json`. Launch through `visible-console` `run_python` with an absolute script path and `await_console`; never a Bash background process.
- **Entry points / relevant files:** `_run_blind.py`, `tests/blind_set{1,2}/WP17/`, `BlindVerificationLedger.md`.
- **Structure references:** *(none — Worker 3 fills after implementation.)*

**Why this set has no row, stated honestly.** B2 created `tests/blind_set{1,2}/WP17/` between 21:42 and 21:49 on 2026-08-01, *after* the WP56/WP57 sweep had already begun and while B2 was still authoring the files. It fell outside both C56's declared scope (WP1–WP16, WP49) and C57's (WP41–WP48). Worker 3 named the gap rather than skipping it silently, which is the correct behaviour and is exactly what the "absence of a row is never a pass" rule was written to make possible. **WP17 is unverified. It is not failing and it is not passing — nobody has looked.**

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C62.*

1. `tests/blind_set1/WP17/` and `tests/blind_set2/WP17/` are each run under the repaired C55 runner, and each produces one ledger row in the C56 schema carrying: the previously-claimed result with the artefact and line that claimed it (or an explicit "no prior claim" marker), the number of tests actually collected, the numbers passed and failed, and a verdict from the C56 vocabulary. A row with a zero or absent collected count is a failure of the run, not a pass.
2. The ledger's coverage-boundary section is corrected so that the folder count it states matches the directory listing a reader takes at that moment, and the "One set is deliberately NOT covered: WP17" carve-out is replaced by the rows themselves. On completion the ledger covers **every** blind set present in `tests/blind_set{1,2}/` with no gaps, and says so with a count the reader can check.
3. No blind test file is edited, renamed in place, deleted or weakened. A blind test found to be itself defective is recorded as a finding and left unmodified, naming the file and the failing assertion.
4. If either set is DIVERGENT, the finding is recorded in the ledger's findings table with the failing test named, and is handed back for its own charter rather than repaired here. The verdict is reported as measured even when it invalidates a claim in a closed B2 handover.

**Definition of Done:** every `(WP, set)` pair that exists on disk carries a verdict, and the ledger's own coverage claim is checkable against the filesystem.

---

## 5. Constraints and Known Risks

- **Hard constraint — sequencing against batch B2.** B2 is live in `plugin/src/canvas/**` and `plugin/src/files/**`, and WP17 (canonical serializer V2) sits in exactly that territory. **This work package must not start until B2 is closed.** Running a set whose implementation another agent is mid-way through editing produces noise, not evidence: a red row would say nothing about WP17 and would misreport B2's work in progress. That is the same reasoning that (correctly) kept WP17 out of the WP56/WP57 sweep, and it has not expired — it just moved.
- **Observed 2026-08-01, and it will mislead you:** the runner's staging directories appear and vanish *inside the plugin source tree* (`plugin/src/__tests__/v2blind/…`) while a run is in flight. A directory listing or a `tsc` run taken during someone else's blind run will show staged blind files that are gone seconds later. **Do not diagnose a leaked staging directory, a build break or a context-isolation breach from a single observation** — re-check before concluding. C55 AC4's teardown guarantee was observed working correctly.
- **Permission / environment limits:** pytest is irrelevant here (WP17 is TypeScript-only), but if the runner is invoked from the workspace root instead of the repo root, session collection aborts on the dangling `Projects/_external/FinaleAbgabe` junction and looks like an import failure. Run from the **repo root**.
- **Known flaky patterns:** none specific to WP17; the vitest suite has a deliberate 33.5 s sleep in `wp5/latency.test.ts`, so budget ≥90 s for any invocation that could pull it in.
- **External dependency risks:** none. No dependency is added, and no dependency may be added by this WP.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `workflowArtifacts/canvas-v2/BlindVerificationLedger.md` (two rows appended + coverage-boundary section corrected), plus the runner's own `_blind_records/*.json` and `index.jsonl` entries.
- **Required report:** `ImplementationReport_WP62.md` — must state the collected/passed/failed counts verbatim from the JSON record, not retyped from console output.
- **BUILD_SPEC updates required:** no (C62 is added by this charter's authoring; the §7 gate is unchanged).
- **Gate status required at handover:** both WP17 rows present with non-zero collected counts and a verdict from the C56 vocabulary; all visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's producer sub-agent. Worker 2 leaves this section empty.*
