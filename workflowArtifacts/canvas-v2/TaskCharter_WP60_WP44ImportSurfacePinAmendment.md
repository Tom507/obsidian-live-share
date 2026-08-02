# Task Charter — WP60: WP44 set2 import-surface pin amendment

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP60
**Phase:** VI
**task_mode:** `lightweight`
**Depends on:** WP49, WP55, WP57
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the node-builtin import pin in `tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts` matches the sanctioned import surface of `e2e-control.ts`, and the WP44 set2 TS ledger row goes from DIVERGENT to CONFIRMED without loosening the pin.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C60 — WP44 import-surface pin amendment** (work package WP60); phase **VI**. Licensed under the §7 amendment ledger.

---

## 2. Scope and Boundaries

- **In scope:**
  - Amending exactly **one** assertion — `workflowArtifacts/canvas-v2/tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts:74-77`, the test `"imports exactly one node builtin: node:http"`, including its title and the file's prose preamble where it restates the one-builtin claim.
  - Adding the matching §7 amendment-ledger entry.
  - Re-running `WP44 set2` (TS half) under the WP55 runner and updating its ledger row.
- **Out of scope / non-goals:**
  - The other four tests in the file. **They pass and must keep passing** — in particular the behavioural one (no `createServer` on an unprovisioned plugin) and the bare-specifier pin (`{yjs}`), which are what AC4 actually protects.
  - Any change to `plugin/src/testing/e2e-control.ts`. **Removing `node:crypto` is not the fix** — see §3.
  - WP44's and WP49's charters and ACs. Neither is reopened; both stay `DONE`.
  - The `fs`/`path`/`child_process`/`os`/`net`/`worker_threads` ban regex — unchanged and still enforced.

---

## 3. Architecture Context

- **Component(s) being changed:** C60 — one blind assertion plus the §7 ledger. No production code.
- **The finding:** the test reads `plugin/src/testing/e2e-control.ts` as text and asserts `new Set(builtins)` equals `new Set(["node:http"])`. The module now imports `node:crypto` as well (`e2e-control.ts:24`), with exactly one use site — `e2e-control.ts:978`, `sha256: createHash("sha256").update(bytes).digest("hex")`, inside the WP49 `canvas.file` read-back.
- **Why this is stale rather than a violation — the intent test, resolved against the charter:**
  - `TaskCharter_WP44_PerVaultControlPortProvisioning.md:87` (AC4, verbatim): *"`resolvePort` keeps its existing precedence and **gains no new dependency**, and a vault with no provisioned port still starts no control server at all."* The subject is `resolvePort` and port/server behaviour — **not** the module's total import surface.
  - WP44's dependency constraints (`:51`, `:107`, `:112`) are uniformly about **runtime packages**: "zero new runtime dependencies", publish date ≥ 7 days, `npm view`. A Node built-in is not a dependency in that sense and cannot be.
  - The **visible counterpart states the intended rule explicitly** and contradicts the blind pin: `tests/visible/WP44/test_tp12_no_server_no_port_visible.test.ts:13-14` — *"every bare import specifier in `e2e-control.ts` is a `node:` builtin **or** a package already in `plugin/package.json`"* — implemented at `:111-131` as an allow-list that **skips anything starting with `node:`**.
  - `node:crypto` adds no port, no socket and no listener; it hashes bytes already in memory. The digest is **mandated** by `T3_SharedContract.md` §6.1, which pins `canvas.file` → `{exists, sha256, size, content}`, and was added by WP49 and recorded at `ImplementationReport_WP49.md:17`, `:128`, `:210`.
  - The blind author's "exactly one node builtin" is therefore a **self-imposed tightening beyond AC4**, which a later chartered WP legitimately outgrew.
- **The counter-argument, and why it does not hold.** The one way `node:crypto` could be a real violation is by enlarging the production bundle. It cannot: the whole of `src/testing/` tree-shakes out of production (C46 AC1). That property is **not** assumed here — it is measured by `W4-1` in `TaskCharter_WP46_ReadinessIdentityHandshake.md` §7b, which Worker 4 must re-run. This WP's ruling depends on that check, and if `W4-1` ever returns a non-zero match count, this amendment must be revisited.
- **Entry points / relevant files:** the blind file above; `plugin/src/testing/e2e-control.ts:24` and `:978` (read-only); `tests/visible/WP44/test_tp12_no_server_no_port_visible.test.ts` (read-only, the authority for the intended rule).
- **Structure references:** *(none — Worker 3 fills after implementation.)*

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C60.*

1. The assertion is amended to pin the node-builtin import set to exactly `{node:crypto, node:http}` — the module's actual, sanctioned surface — and the test title and file preamble are corrected to match, so the file no longer asserts one thing in prose and another in code.
2. **Strictness does not fall.** The assertion remains a whole-set exact `toEqual` over the complete builtin set. No subset match, no `expect.arrayContaining`, no "at least" check, no filtering `node:crypto` out before comparing, and no `skip`/`only`. A future import of `node:net` or `node:child_process` must still fail this test.
3. The test count in the file does not change — five before, five after — and the four currently-passing tests still pass unmodified, including the behavioural no-server check and the bare-specifier pin.
4. The amendment is entered in the §7 amendment ledger with file, line and reason, and `WP44 set2` (TS) is re-run under the WP55 runner with a recorded non-zero collected count, its ledger row updated from DIVERGENT to its measured verdict.

**Definition of Done:** the import-surface pin still catches a genuinely new dependency, and no longer fails on one the spec mandates.

---

## 5. Constraints and Known Risks

- **Sequencing:** touches only `workflowArtifacts/canvas-v2/tests/blind_set2/WP44/` and reads `plugin/src/testing/e2e-control.ts`. `src/testing/**` is **not** batch B2 territory (B2 is live in `plugin/src/canvas/**` and `plugin/src/files/**`), so this WP is collision-free with B2 and may run immediately.
- **Hard constraint — do not "fix" this by deleting the import.** Removing `node:crypto` from `e2e-control.ts` would break WP49's `canvas.file` sha256, which `T3_SharedContract.md` §6.1 pins as part of the control-protocol contract. That is a contract breach dressed as a green test.
- **Hard constraint — the anti-weakening rule (§7 abort criteria).** If the pin cannot be made to pass while staying an exact whole-set `toEqual`, leave it failing and escalate.
- **Staging hazard when re-running:** the blind runner stages into `plugin/src/__tests__/`, so a `tsc`/`npm run build` overlapping a blind run can report errors belonging to a blind set. A build error whose path contains `v2blind` or a `_blind[12]` suffix is a staging artefact, not a product defect — re-check before recording a build failure.
- **Known flaky patterns:** none — the test reads the module as **text** and never imports it, so it is immune to module-graph and timing effects.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `workflowArtifacts/canvas-v2/tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts` (one assertion + title + preamble), `BUILD_SPEC_CanvasV2.md` §7 (one ledger row), `BlindVerificationLedger.md` (row update).
- **Required report:** `ImplementationReport_WP60.md` — must quote the before and after assertion in full.
- **BUILD_SPEC updates required:** yes — §7 amendment ledger, one row.
- **Gate status required at handover:** `WP44 set2` (TS) CONFIRMED with a non-zero collected count; all visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

**No new visible tests — by design.** WP60 restates one existing blind assertion; adding a test would
move a count this WP's AC3 requires to stay fixed. The pin's continued strictness is evidenced by
falsification instead (`_falsify_b11.py`, perturbation **P1**: adding a `node:util` import to
`e2e-control.ts` turns this test and only this test red, and the set returns to green when the file is
restored byte-clean).

**Producer artifacts:** `ImplementationReport_WP60.md`; `BUILD_SPEC_CanvasV2.md` §7 (one ledger row);
`BlindVerificationLedger.md` (`WP44 / set2 / vitest` DIVERGENT → CONFIRMED, 25 collected / 25 pass / 0
fail); `Worker3Handover_B11_DivergentAmendments.md`.

**Structure references:** amended assertion at
`tests/blind_set2/WP44/test_tp12_no_server_no_port_blind2.test.ts:82-85` (post-edit line numbers;
`:74-77` pre-edit), preamble `:1-16`. Read-only authorities: `plugin/src/testing/e2e-control.ts:24`
(the `node:crypto` import) and `:978` (its single use site, the `canvas.file` sha256);
`tests/visible/WP44/test_tp12_no_server_no_port_visible.test.ts:111-131` (the allow-list that skips
every `node:` specifier).
