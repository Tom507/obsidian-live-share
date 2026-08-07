# Task Charter — WP57: Blind re-verification, non-discoverable and cross-package sets

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP57
**task_mode:** `standard`
**Depends on:** WP55, WP56
**W4 Test Targets:** `0`

---

## 1. Task Objective

- **Outcome:** The blind sets that the broken runner provably could not have executed are re-run under the repaired runner, and `BlindVerificationLedger.md` is completed to cover every blind set in the project with no gaps.
- **BUILD_SPEC reference:** §5 PHASE VI → **C57 — Blind re-verification: non-discoverable and cross-package sets**; gate in §7 "Blind-set execution gate" (retro-application clause).

---

## 2. Scope and Boundaries

- **In scope — the sets WP56 deferred, enumerated exhaustively:**
  - **WP41** (`blind_set1` + `blind_set2`, 8 + 8 TS files) — filenames match no discovery glob **and** the set's imports (`../../mux-protocol`) resolve into `server/`, which the old runner never targeted. Both defect classes at once.
  - **WP42** (7 + 7 TS files) — filenames match no discovery glob.
  - **WP46 TypeScript half** (4 + 4 files) — filenames match no discovery glob. **Already proven vacuous**; the row records the confirmed real result, not a fresh discovery.
  - **The TypeScript files inside WP44** (2 per set) **and WP47** (3 per set) — discoverable by name, but their imports (`../../testing/e2e-control`) require a staging depth the old runner did not use. Never reported as a TS blind count in any handover.
  - **The Python sets for WP43–WP48** — both sets each.
- **Out of scope / non-goals:**
  - Everything WP56 covered (WP1–WP16, WP49 TypeScript). Do not re-run or re-row them.
  - Repairing any implementation defect this WP surfaces, including the WP46 probe defect (that is **WP58**) and the double-`pytest.raises` defect in `tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` (recorded, never repaired).
  - Any change to `_run_blind.py`. If the repaired runner cannot run a set, that is an `UNRUNNABLE` row with the obstruction named and an escalation — not a local patch.
- **Known interfaces / dependencies:**
  - WP55 `DONE`; WP56 `DONE` (it owns the ledger file, the row schema and the verdict vocabulary, which this WP reuses without redefining).
  - Claim sources: `Worker3Handover_B8_P6.md` (WP41, WP42), `Worker3Handover_B9a_T3infra.md` §4.1 and §5 (WP43–WP49), `ImplementationReport_WP4[1-8].md`.

---

## 3. Architecture Context

- **Component(s) being changed:** C57 — appends to `BlindVerificationLedger.md`. No source code changes.
- **Interfaces involved:** input is WP55's per-set record plus the prior claims; output is ledger rows in WP56's schema.
- **Constraints from BUILD_SPEC:** §7 — a claim without a CONFIRMED ledger row and a non-zero collected count is unverified regardless of what any handover says; a VACUOUS or DIVERGENT verdict invalidates the corresponding closed-handover claim.
- **Technology / framework / config constraints:**
  - `PYTHONIOENCODING=utf-8` before invoking the runner (the runner crashes with `UnicodeEncodeError` on a cp1252 console when a set fails — and this WP expects failures).
  - pytest from the **repo root**, never the workspace root (dangling `Projects/_external/FinaleAbgabe` junction aborts session collection and looks like an import error).
  - `sys.path.insert(<repo>/tools)` + `from obsidian_e2e import …`; never `import tools.obsidian_e2e`, which silently resolves to the workspace `tools` package.
  - WP41's set targets the **server** package (`server/`), not `plugin/`.
- **Entry points / relevant files:** `_run_blind.py` (repaired), `tests/blind_set{1,2}/WP{41,42,43,44,45,46,47,48}/`.
- **Structure references:** *(none — Worker 3 fills after implementation.)*

**The specific contradiction this WP must resolve, stated up front.** `Worker3Handover_B8_P6.md` reports for WP41 "blind_set1 + blind_set2 (combined run) | 16 files | 44 tests | 44 pass | 0 fail" and for WP42 "14 files | 73 | 73 | 0". Those files, **as they are stored today**, carry `_blind1.ts` / `_blind2.ts` names that no vitest glob can discover, and WP41's imports point at a package the runner never targeted. Both statements cannot be true of the same artefacts under the same runner. Either B8 staged them through a mechanism that no longer exists and was never recorded, or the counts are not attributable to the stored files. **The ledger must say which**, and must not paper over it by re-running and reporting a fresh green as though it retroactively validated the old claim. A fresh green confirms the *code*; it does not confirm the *claim*.

<!-- Updated: this contradiction was resolved by execution — the disjunct's FIRST branch is true; the counts reproduce exactly 2026-08-01 -->

> **RESOLVED (2026-08-01) — the first branch of the disjunct is the true one.** All four claimed quantities reproduce **exactly** under the repaired runner: WP41 24 + 20 = **44** across **16** files; WP42 28 + 45 = **73** across **14** files. B8/P6 staged the files through a rename-and-retarget mechanism it **never recorded**, doing by hand exactly what WP55 has now made permanent. Worker 2's framing that "both statements cannot be true" was a sound inference on the evidence then available and is **falsified**; `B8_P6:54` and `B8_P6:87` are **CONFIRMED**, not vacuous.
>
> This distinction matters and is not a technicality: what was recorded is the **exact reproduction of numbers written down by an earlier agent that could not have known this run's outcome** — evidence about the *claim*, not merely about the code. Had the counts come back 51 and 66, B8/P6 would have been invalidated. The residual finding is a **process** defect, not a correctness one: *a claim no committed instrument can reproduce is unverifiable when made, however true it later proves to be.*

<!-- Updated: WP46 TS half was NOT vacuous — every set in the project executed 2026-08-01 -->

> **Correction to §2's "Already proven vacuous" (WP46 TypeScript half).** No set in this project is vacuous. The final ledger carries **48 CONFIRMED, 4 DIVERGENT, 0 VACUOUS, 0 UNRUNNABLE** over 52 rows. The WP46 TS half executed; its `set1` row confirms a prior claim that was itself **not a green** (`B9a:223` reported 22 collected / 21 pass / 1 fail and left it open), matched exactly pre-fix, and reads 22/22/0 after WP58.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C57.*

1. Every blind set not covered by C56 is re-run under C55 and recorded to the C56 row schema and verdict vocabulary. The scope is: the TypeScript sets whose filenames match no discovery pattern (**WP41**, **WP42**, and the TypeScript half of **WP46**), the TypeScript files inside the otherwise-Python sets (**WP44**, **WP47**), and the Python sets (**WP43**–**WP48**).
2. For **WP41** and **WP42** the ledger resolves an explicit contradiction rather than merely restating it: `Worker3Handover_B8_P6.md` claims 44 and 73 executed tests for sets whose files, as stored, no framework glob can discover. The ledger records whether those counts are reproducible under C55 and, if they are not, states that the claimed counts cannot be attributed to the stored artefacts.
3. For the Python sets the ledger records the executed counts and confirms or corrects `Worker3Handover_B9a_T3infra.md` §4.1's claim of 647 blind tests with 2 failures, including whether the two known failures are the same two.
4. On completion the ledger covers **every** blind set present in `tests/blind_set{1,2}/` with no gaps, and it says so with a count that a reader can check against the directory listing.
5. No blind test file is edited, renamed in place, deleted or weakened by this work package, and the known-defective `tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` remains unmodified and is recorded as a finding rather than repaired.

**Definition of Done:** The ledger is complete, and every blind claim in the project is either confirmed or named as unverified.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows; cp1252 encoding trap; pytest rootdir trap; slow vitest runs (≥90 s budget).
- **Known flaky patterns:**
  - **Expect red rows.** This is the scope where vacuous claims concentrate, and WP46's TS half is already known to hide a real deterministic failure. A red row here is the expected shape of a correct result, not a sign the run went wrong. Do not tune, retry-until-green, or narrow scope to keep the ledger clean.
  - `tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` has two structurally unsatisfiable test points — `drive()` already wraps the body in `pytest.raises`, consuming the exception, and the two failing points wrap `drive()` in a second outer `pytest.raises`, which can therefore never see one. `DID NOT RAISE` is guaranteed regardless of implementation. Record as a **defective test**, not as an implementation failure, and leave it unmodified.
  - `__pycache__` directories sit inside the blind set folders and are being committed (the repo `.gitignore` has no pycache rule). Do not count them as blind files, and do not fix the gitignore here.
- **External dependency risks:** none.
- **Hard constraints:**
  - Do not edit, rename in place, or delete any blind file.
  - Do not fix any defect found. Name the owner and hand back to the Dispatcher.
  - **The outcome may invalidate earlier handover claims — that is a permitted and expected result of this work package, and it must be stated plainly rather than softened.** B8/P6 is the batch most exposed; B9a's TypeScript claims are next. Do not adjust the verdict to protect a closed handover.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `workflowArtifacts/canvas-v2/BlindVerificationLedger.md` (extended to completion).
- **Required report:** `ImplementationReport_WP57.md`, containing a plain-language statement of which batches' blind claims are now invalidated, which are confirmed, and which remain unverifiable with the reason.
- **BUILD_SPEC updates required:** no. If a verdict contradicts a §7 ledger entry or a component AC, **escalate to Worker 2** rather than editing the spec.
- **Gate status required at handover:** ledger row count matches the directory listing of `tests/blind_set{1,2}/`; no blank cells; every non-CONFIRMED verdict has a named owner.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's producer sub-agent.*
