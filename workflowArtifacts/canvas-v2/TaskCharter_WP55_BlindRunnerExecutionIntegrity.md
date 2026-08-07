# Task Charter — WP55: Blind-set execution integrity

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP55
**task_mode:** `standard`
**Depends on:** `none`
**W4 Test Targets:** `0`

---

## 1. Task Objective

- **Outcome:** `_run_blind.py` becomes structurally incapable of reporting a blind set as passing that it did not execute — every reported pass carries a recorded executed-test count greater than zero, and a zero-collection run is a hard failure.
- **BUILD_SPEC reference:** §5 PHASE VI → **C55 — Blind-set execution integrity**; gate in §7 "Blind-set execution gate".

---

## 2. Scope and Boundaries

- **In scope:**
  - `workflowArtifacts/canvas-v2/_run_blind.py` — the only file this WP is expected to change.
  - Filename normalisation at staging time so blind files are discoverable by the target framework.
  - Per-set derivation of staging depth and target package.
  - An explicit executed-count assertion, and a machine-readable per-set record for the C56/C57 ledger.
  - Extension of the same guarantees to the Python blind path.
- **Out of scope / non-goals:**
  - Running the re-verification itself — that is WP56 and WP57. This WP delivers the instrument, not the measurement.
  - Fixing the WP46 readiness-probe defect — that is WP58.
  - Editing, repairing, renaming-in-place or deleting **any** file under `tests/blind_set1/` or `tests/blind_set2/`. The authored artefacts are inputs and stay byte-unchanged on disk.
  - Repairing the known-defective `tests/blind_set2/WP47/test_tp04_teardown_exit_paths_blind2.py` (double `pytest.raises`). It stays as it is; it is WP57's finding to record.
  - Any change to `plugin/` or `server/` source, to visible tests, or to the vitest configuration.
- **Known interfaces / dependencies:**
  - Blind sets live at `workflowArtifacts/canvas-v2/tests/blind_set{1,2}/WP<N>/`.
  - Current staging root: `plugin/src/__tests__/v2blind/wp<N>_<set>/`.
  - Vitest 4.0.18; default discovery glob `**/*.{test,spec}.?(c|m)[jt]s?(x)`.
  - Confirmed by inspection: `_run_blind.py` currently hardcodes the plugin package, a fixed two-level staging depth, and copies filenames verbatim.

---

## 3. Architecture Context

- **Component(s) being changed:** C55 (`_run_blind.py`), Worker 3 tooling. Not product code.
- **Interfaces involved:**
  - Input: WP number, set selector (`set1` | `set2` | `both`), and the set's files as authored.
  - Output: per-set verdict + executed-test count + a machine-readable record `(WP, set, framework, files staged, tests collected, tests passed, tests failed, exit code, verdict)`.
- **Constraints from BUILD_SPEC:**
  - §7 blind-set execution gate: a recorded collected-count is the evidence of a pass; an exit code is not.
  - §7 abort criterion: making a set run by editing, relaxing, skipping or deleting an assertion is an abort. Name-only normalisation is licensed; changing what a test asserts is not.
  - The existing always-clean-up guarantee for the staging directory must survive unchanged, including on failure and `KeyboardInterrupt`. A leftover staging directory leaks blind tests to the next coder sub-agent (recorded as B1 process failure #3).
- **Technology / framework / config constraints:**
  - Vitest 4 removed the `basic` reporter; `--reporter=basic` fails with `ERR_LOAD_URL`.
  - `vitest.config.ts` sets `test: {}` — the discovery glob is the framework default, so the runner must satisfy the default rather than change the config.
  - `npx vitest run src/__tests__/v2` matches `v2blind` by substring; the trailing-slash path form is required.
  - `_run_blind.py` crashes with `UnicodeEncodeError` on a Windows cp1252 console when a set fails. Set `PYTHONIOENCODING=utf-8`, or make the runner encoding-safe on its own.
  - Python blind runs: pytest must be invoked from the **repo root**, not the workspace root — from the workspace root, session collection aborts on a pre-existing dangling junction (`Projects/_external/FinaleAbgabe`, absent E: drive), which looks like an import failure and is not.
  - Package shadowing trap: `import tools.obsidian_e2e` silently resolves to the *workspace* `tools` package, because the workspace `tools/` has an `__init__.py` and the repo's does not. The sanctioned form is `sys.path.insert(<repo>/tools)` + `from obsidian_e2e import …`.
  - Launch long-running invocations through `visible-console` `run_python` with an absolute script path, then `await_console`. Never a Bash background process.
- **Entry points / relevant files:** `workflowArtifacts/canvas-v2/_run_blind.py` (107 lines; `run_set()` is where all three defects live).
- **Structure references:** *(none — no Graphify output for this artefact tree; Worker 3 fills after implementation.)*

**Three distinct ways the current runner no-ops — all three must be closed, and closing only the first is not sufficient:**

| # | Defect | Evidence |
|---|---|---|
| 1 | Filenames copied verbatim; `test_*_blind1.ts` matches no vitest glob → "No test files found" | WP46 TS (4+4 files), WP41 (8+8), WP42 (7+7) — **38** files project-wide that cannot be discovered as stored |
| 2 | Staging depth hardcoded; sets differ in what their own imports require | WP1–WP16 need depth 3 (WP5 mixes `../../../canvas/…` with `../../harness/…` and only depth 3 satisfies both); **WP47 and WP49 TS need depth 2** |
| 3 | Target package hardcoded to `plugin/` | WP41 imports `../../mux-protocol` and belongs to `server/`; it can never be staged correctly by the current runner |

<!-- Updated: three premises of this table falsified by the WP55/WP57 re-verification; corrected in place so no later worker inherits them 2026-08-01 -->

**Corrections to this table, established by executing it (2026-08-01) — these supersede the row text above:**

- **Defect 1 did not produce a silent green.** Vitest 4.0.18 exits **1** on zero discovery and neither vitest config sets `passWithNoTests`, so the old runner failed **loudly** on all three affected sets. The defect is real as a *cause* (those sets could not execute); the *concealment mechanism* was mis-stated. The green counts in the handovers came from an unrecorded manual rename-and-retarget step, so the debt is **reproducibility**, not execution. C55 AC1's executed-count rule stands unchanged as defence-in-depth.
- **The undiscoverable-file total is 38, not 46** (16 + 14 + 8). The per-set counts were right; only the sum was wrong.
- **Depth: the affected sets are WP47 and WP49 TS (depth 2), not WP44.** WP44 is depth 3 and was unaffected. **WP49 was omitted from this charter entirely** and is depth-affected.
- **Python sets must never be staged — they run in place.** 60 Python blind files pin `parents[5]/"tools"` to locate the rig package; staging changes the parent count and silently breaks the import. This is not covered by any row above and is the single most likely way to break the repaired runner.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C55.*

1. A run that collects **zero** test cases is a hard failure under a distinct named reason and can never be reported as a pass. Every reported PASS carries a recorded executed-test count greater than zero, and a zero or absent count is treated as a failure of the run rather than as an absence of problems. A process exit code of 0 is not by itself accepted as evidence that a set passed.
2. Staging normalises each blind file's **name** to the target framework's discovery pattern, and the normalisation is name-only: content, assertions, imports, skips and test counts are byte-identical to the authored artefact. No assertion is edited, relaxed, skipped or removed to make a set run. A file the runner cannot make discoverable is named individually and fails the run rather than being silently excluded from it.
3. Staging depth and target package are derived **per set** from that set's own relative import specifiers rather than hardcoded: a set importing `../../x` and a set importing `../../../x` both resolve, and a set whose imports resolve into `server/` is staged and run against the server package rather than the plugin. An import that fails to resolve is a hard, named failure — never a collection error reported as a pass and never a silent zero-collection.
4. The Python blind path is covered by the same runner under the same zero-collection rule, so "no tests ran" cannot pass on either side. The existing guarantee that the staging directory is always removed — on success, on failure, and on interrupt — is preserved unchanged, because a leftover staging directory leaks blind tests to the next coder sub-agent and breaches context isolation.
5. The runner emits, per set, a machine-readable record of `(WP, set, framework, files staged, tests collected, tests passed, tests failed, exit code, verdict)` suitable for direct transcription into the C56/C57 ledger without re-running or re-interpretation.

**Definition of Done:** A never-executed blind set and a fully passing blind set are no longer indistinguishable from the runner's output. Demonstrated on at least one set from each of the three defect classes above (a discoverable set, a non-discoverable plugin set, and the cross-package `server/` set), each reporting a non-zero collected count or a named hard failure.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows host; cp1252 console encoding trap (see §3). Vitest runs are slow — `wp5/latency.test.ts` deliberately sleeps 33.5 s, so budget ≥90 s for any automated plugin-suite invocation.
- **Known flaky patterns:**
  - Do not "fix" discovery by editing `vitest.config.ts` to widen the glob. That makes the workaround invisible to anyone reading the blind files, and it would also change discovery for the real suite. Normalise at staging time.
  - Do not infer the collected count by parsing prose that the reporter may reword between versions if a structured output channel is available. A count parsed from a format that can silently change is the same class of bug as the one being fixed.
- **External dependency risks:** No new runtime dependency. No new npm package (workspace 7-day policy applies and there is no reason to trip it here).
- **Hard constraints:**
  - **The repaired runner must not weaken any blind test.** Renaming files for glob-matching is fine; changing assertions is not. This is an abort criterion, not a preference.
  - Blind files on disk stay byte-unchanged. Normalisation happens on the staged copy only.
  - The staging directory must be gone after every run, unconditionally.
  - Do not run the re-verification (WP56/WP57) as part of this WP, and do not record its results here.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `workflowArtifacts/canvas-v2/_run_blind.py`.
- **Required report:** `ImplementationReport_WP55.md`, which must state for each of the three defect classes how it is now closed, and must show the before/after output for at least one set that previously reported a vacuous pass.
- **BUILD_SPEC updates required:** no — C55 and the §7 gate are already written.
- **Gate status required at handover:** all visible tests PASS; the runner demonstrably fails a deliberately non-discoverable set instead of passing it.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's producer sub-agent.*
