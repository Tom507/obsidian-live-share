# Task Charter — WP65: Ledger row provenance and the named-intermittent register

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP65
**Phase:** VI
**task_mode:** `standard`
**Depends on:** WP55 (the repaired runner), WP56 / WP57 (the ledger artefact and its row schema)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** every blind measurement records the tree state it was taken against, so a ledger row can be recognised as **expired** rather than read as a standing fact; and the one observed intermittent has a name, an owner and a threshold that can void its acceptance.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C65 — Ledger row provenance and the named-intermittent register**; phase **VI**. Governed by §7's *"Ledger rows are measurements, not timeless facts"* rule.

---

## 2. Scope and Boundaries

- **In scope:**
  - `workflowArtifacts/canvas-v2/_run_blind.py` — add `measured_at` and `tree_rev` to the record it writes. Additive only.
  - `workflowArtifacts/canvas-v2/_gen_ledger.py` — transcribe those fields into a provenance column, by script, exactly as the counts already are.
  - `workflowArtifacts/canvas-v2/BlindVerificationLedger.md` — the provenance column, the verdict-semantics statement, and the named-intermittent register.
- **Out of scope / non-goals:**
  - **Re-measuring the existing 58 rows.** Rows measured before this schema carry `unknown (pre-C65)` and are re-measured only when a batch has its own reason to.
  - **Backfilling provenance from mtime, git log or inference.** A reconstructed timestamp is indistinguishable in the artefact from a recorded one, and this WP exists to remove exactly that ambiguity. If it was not recorded, it is `unknown`.
  - Any blind test file, any production file, any charter's ACs. No test is edited, renamed, deleted or weakened.
  - Fixing the `wp5` latency band. This WP **registers and bounds** it; changing the band or the harness is a separate escalation if the threshold is ever breached.

---

## 3. Architecture Context

- **Component(s) being changed:** C65 — two helper scripts and one markdown artefact. No production code, no tests.
- **The finding, and why it is a real gap rather than bookkeeping:**
  - `WP3 set1` was ledgered **CONFIRMED 56/56/0** by WP56, its counts transcribed by script from `_blind_records/*.json`. B13 re-measured the **untouched** set at **56/55/1**.
  - **WP56 was not wrong.** WP10 AC5 landed in between. The mechanism is decisive and is worth stating precisely, because it is what makes this more than staleness: `toV2Edge` (`plugin/src/files/canvas-sync.ts:263-299`) keeps an edge's flat keys **only when the endpoint register fails to build**. Before AC5, a side-less endpoint failed to build, so `parsed.edges["e-only"].fromNode` was readable and the assertion passed. **The row was green on account of the very defect AC5 was written to fix.** After AC5 the register builds, the fold happens correctly, and the assertion is red.
  - So a ledger row can be green *because of* a bug, and turn red *because the bug was fixed*. Read later as a timeless fact, that row is evidence that a fixed bug is still fixed — when what it actually records is the bug.
  - **The record cannot express this.** `_blind_records/*.json` currently holds `wp`, `set`, `framework`, `files_staged`, `tests_collected`, `tests_passed`, `tests_failed`, `exit_code`, `verdict`, `reason`, `package`, `depth`, `detail` — **no timestamp, no revision**. File mtime is the only signal available and every re-run overwrites it.
- **Entry points / relevant files:** `_run_blind.py`, `_gen_ledger.py`, `BlindVerificationLedger.md`, `_blind_records/*.json` (schema), BUILD_SPEC §7.
- **Structure references:** *(none — Worker 3 fills after implementation.)*

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C65.*

1. **Every blind record is self-dating.** `_run_blind.py` writes at minimum `measured_at` (ISO-8601 UTC) and `tree_rev` (the `git rev-parse HEAD` short sha, plus an explicit dirty marker when `git status --porcelain` is non-empty) into each `_blind_records/*.json`. Existing fields keep their names and meanings — this is additive, and no consumer of the current schema may break.
2. **Every ledger row shows its provenance,** transcribed by `_gen_ledger.py` from those fields exactly as the counts already are — never retyped by hand. A row whose record predates the schema carries an explicit `provenance: unknown (pre-C65)` marker rather than a blank or a guessed value; a blank would be indistinguishable from a fresh measurement, which is the failure mode this WP exists to remove.
3. **The ledger states its own semantics.** `BlindVerificationLedger.md` says in its verdict section that a CONFIRMED row is evidence for the tree it was measured against and is never readable as a current pass, with WP3 set1 named as the worked example — including the part that makes it instructive: the row was green *because of* the defect WP10 AC5 later fixed.
4. **The named-intermittent register is live.** §7's register (currently one row: `wp5/latency.test.ts`'s 50–150 ms RTT band, owner WP65) is reflected in the ledger so a batch meeting an intermittent finds it already named. The acceptance threshold is recorded with it and is falsifiable: **more than one failure in ten consecutive full-suite runs, or any failure co-occurring with another `wp5` assertion**, voids the acceptance and escalates it as a real defect in the latency harness.

**Definition of Done:** a reader of any ledger row can tell what tree it was measured against without archaeology, and the one known intermittent has an owner and a threshold rather than a footnote.

---

## 5. Constraints and Known Risks

- **The dirty-tree marker is the load-bearing half of AC1, not decoration.** Most measurements in this project are taken against a working tree with uncommitted changes — B13's own run was one. A `tree_rev` that records only a commit sha would claim more precision than exists and would be *worse* than no field, because it reads as exact. Record the sha **and** the dirty flag; when dirty, the row means "this sha plus uncommitted work", and the ledger must say so in as many words.
- **Do not let this become a re-measurement project.** The temptation on reading AC2 is to re-run all 58 rows so none carries `unknown`. That is explicitly out of scope and would consume the batch. The `unknown (pre-C65)` marker is the correct, honest state for a row measured before the schema existed.
- **`_gen_ledger.py` is the only writer of row content.** If a provenance value is easier to paste by hand than to transcribe, that is a signal the script needs the field, not that the row needs an exception. Hand-typed counts are what WP56's header explicitly promises never happened; the same promise now covers provenance.
- **Known flaky patterns:** the registered `wp5` RTT band (see AC4). It is expected to be met during full-suite runs in this WP; meeting it once is not a red and is not evidence for or against the threshold.
- **Ordering:** nothing blocks this WP, but running it *before* the next AC-landing batch is worth more than running it after — its value is entirely in the rows measured from now on.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `workflowArtifacts/canvas-v2/_run_blind.py`, `workflowArtifacts/canvas-v2/_gen_ledger.py`, `workflowArtifacts/canvas-v2/BlindVerificationLedger.md`.
- **Required report:** `ImplementationReport_WP65.md` — must show one complete `_blind_records/*.json` before and after, and one ledger row before and after, so a reader can verify the schema change is additive without running anything.
- **BUILD_SPEC updates required:** no — §5 C65 and §7's two new rules are already written by this ruling.
- **Gate status required at handover:** plugin suite count unmoved (this WP touches no test and no production file); at least one blind set re-run under the extended runner to demonstrate the new fields are populated, with its record quoted verbatim in the report.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's producer sub-agent. Worker 2 leaves this section empty.*
