# Task Charter — WP61: WP49 quiescence blind-set amendments and fixture repairs

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP61
**Phase:** VI
**task_mode:** `standard`
**Depends on:** WP46, WP49, WP55, WP56, WP58
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the five failing tests across WP49's two TypeScript blind sets are resolved — each as a licensed amendment, a licensed fixture repair, or an escalation — and both ledger rows go from DIVERGENT to CONFIRMED with no assertion weakened; and the `timeoutMs = 0` semantics that two artefacts currently disagree about are stated once, in the shared contract.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C61 — WP49 quiescence blind amendments** (work package WP61); phase **VI**. Licensed under the §7 amendment ledger, including its **third class** (unsatisfiable-as-authored), which this WP is the first to use.

---

## 2. Scope and Boundaries

- **In scope — five tests, three distinct classes. The class matters, because the licence differs:**

  | # | File | Test | Class |
  |---|---|---|---|
  | 1 | `blind_set1/WP49/test_tp4_timeout_semantics_preserved_blind1.test.ts:71` | `timeoutMs 0 answers true when already idle and false immediately after activity` | **A** — stale vs deliberate timing |
  | 2 | `blind_set2/WP49/test_tp1_peer_origin_blocks_quiescence_blind2.test.ts:49` | `a remote node removal blocks a zero-budget quiescence probe` | **A** — stale vs deliberate timing |
  | 3 | `blind_set2/WP49/test_tp3_control_edit_still_bumps_blind2.test.ts:83` | `session.info is untouched by the new seam` | **B** — settled-contract shape pin |
  | 4 | `blind_set2/WP49/test_tp2_user_origin_blocks_quiescence_blind2.test.ts:84` | `a user edit landing during a pending wait pushes the answer to false` | **C** — unsatisfiable as authored |
  | 5 | `blind_set2/WP49/test_tp10_absent_file_not_created_blind2.test.ts:50` | `the requested path is missing even though similar files exist` | **C** — unsatisfiable as authored |

  - One statement of `timeoutMs = 0` semantics added to `T3_SharedContract.md` §6 (see AC4).
  - The matching §7 amendment-ledger entries, and re-running both WP49 TS sets under the WP55 runner.
- **Out of scope / non-goals:**
  - **All 30 other tests across the two sets. They pass and must keep passing** — including the two tests in `test_tp3` (lines 41, 60) that are the file's actual subject, both currently green.
  - Any change to `plugin/src/testing/e2e-control.ts` or any other production file. **This WP changes test expectations only.** In particular: do **not** make `waitQuiescent` answer without polling, and do **not** narrow `sessionInfo()`.
  - WP46's, WP49's and WP58's charters and ACs. None is reopened; all stay `DONE`. **WP49 AC1 in particular is untouchable** — the activity seam must never become origin-aware.
  - The WP47 double-`pytest.raises` defect. It is the same class C, but it is Python and out of this WP's scope; §7's new class now gives it a route, which is a separate charter.

---

## 3. Architecture Context

- **Component(s) being changed:** C61 — five blind assertions/fixtures, one contract line, the §7 ledger. **No production code.**
- **Class A — the timing cluster (#1, #2). Stale, but the behaviour change behind it is real and must be recorded.**
  - Current implementation, `plugin/src/testing/e2e-control.ts:997-1018`: `waitQuiescent` uses `pollMs = 20`, `quietWindowMs = 50`, `deadline = Date.now() + timeoutMs`, and **sleeps before it evaluates**.
  - That ordering is `TaskCharter_WP49_RealQuiescenceFileOracle.md` AC1 verbatim, which names the old ordering as the defect: *"`waitQuiescent` answered out of **pre-call** history: it evaluated the idle window before its first sleep, so a caller that started waiting while the instance happened to be idle got `true` even if activity then continued for the entire timeout."* Restated in-source at `e2e-control.ts:1005-1010`.
  - `timeoutMs = 0` therefore means **"expire at the earliest opportunity"**, not "infinite" and not "decided without waiting": `deadline = now + 0` forbids a second lap, so the answer arrives after exactly one 20 ms poll. The router (`:394-398`) defaults only when the value is absent, non-numeric or negative, so `0` is explicitly forwarded — which the blind tests and the implementation already agree on.
  - Both tests advance fake timers by less than one poll interval (10 ms and 5 ms) and so never let the promise settle; they die on vitest's 5 s timeout. **The verdicts they assert are the verdicts the implementation produces** — only the zero-latency assumption is wrong, and no spec statement supports it. `T3_SharedContract.md:205` documents only `timeoutMs?` (default 2000) and says nothing about `0`; `BUILD_SPEC_CanvasV2.md` says nothing about `timeoutMs` at all.
  - **The genuine tension, stated rather than buried.** For `timeoutMs = 0` the AC1 principle ("the wait covers the interval it was asked about") is degenerate: a zero-length interval can only be "covered" by reporting pre-call history, which is exactly what AC1 forbids. The two readings are irreconcilable and WP49 chose the one its own AC mandates. That is a **spec gap**, not a code defect, and AC4 below closes it. There is a real user-visible consequence: a zero-budget probe now costs one 20 ms poll instead of returning synchronously, so rig code that assumed a free probe pays 20 ms per call.
- **Class B — the shape pin (#3). Stale against a contract already settled in writing.**
  - `sessionInfo()` returns nine keys (`e2e-control.ts:832-850`); the assertion pins the pre-WP46 four (`clientId`, `role`, `roomId`, `connected`). *(The ledger's findings table says "2-key"; the assertion is in fact a four-key exact `toEqual` — correct the ledger text when updating the row.)*
  - `TaskCharter_WP46_ReadinessIdentityHandshake.md:95` settles it explicitly: *"It is intended, and it is not separable from the WP … The two assertions are therefore **stale, not violated** — they pin a payload the spec deliberately replaced, while their own subjects are untouched."* The nine keys are pinned field-by-field in `T3_SharedContract.md:199` and §6.2 (`:218-228`).
  - WP46 AC5 already mandates the remedy for exactly this shape: amend to the nine-key payload, **never** soften to `toMatchObject`. This is the third instance of a pattern already licensed twice.
  - The file's own subject is intact: its other two tests — that the widened activity seam does not move `bindingCounters` — both pass.
- **Class C — unsatisfiable as authored (#4, #5). Neither stale nor a product defect: broken tests.**
  - **#5 could never have passed against any implementation.** Line 63 already establishes `result` equals `{exists: false, sha256: "", size: 0, content: null}` — exactly what production returns (`e2e-control.ts:971-973`). Line 64 then runs `expect(result.content).not.toContain("stale")` on a `null` receiver. Vitest's `toContain` (`@vitest/expect/dist/index.js:1249-1252`) skips its string/array handling for `null` and delegates to chai's `include`, whose `default` branch (`chai/index.js:2067-2074`) **throws** `AssertionError: the given combination of arguments (null and string) is invalid for this assertion` — regardless of `.not`. This is the TypeScript twin of WP47's double-`pytest.raises`, and it is only visible now because these sets had never executed.
  - **#4 races itself on the poll boundary.** After `advanceTimersByTimeAsync(400)` (line 87) the instance has been idle 400 ms. `pending` starts at t=400 and its first poll fires at exactly t=420 — the same instant `advanceTimersByTimeAsync(20)` lands on — so `idleFor = 420 ≥ 50` resolves `{quiescent: true}` **before** the `put` on line 91 runs. The property the test names is legitimate and worth keeping; the fixture's timing simply never delivers the edit inside the pending wait.
- **Entry points / relevant files:** the five blind files above; `plugin/src/testing/e2e-control.ts` (read-only: `:394-398`, `:832-850`, `:971-973`, `:997-1018`); `T3_SharedContract.md` §6; `BUILD_SPEC_CanvasV2.md` §7.
- **Structure references:** *(none — Worker 3 fills after implementation.)*

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC §5 C61.*

1. **Class A (#1, #2)** — each test's fake-timer advance is increased to cross at least one full poll interval, so the promise it awaits can settle. **Every `toEqual` verdict assertion is kept verbatim** — `{quiescent: true}` when already idle, `{quiescent: false}` after activity — because those verdicts are what the tests exist to pin and the implementation already produces them. The named subject of each test, that `timeoutMs: 0` does **not** collapse to the 2000 default, is preserved and still fails if it ever does.
2. **Class B (#3)** — the four-key exact-shape `toEqual` is amended to the full nine-key payload, in the same form WP46 AC5 mandates: a whole-object `toEqual` over all nine keys with the honest-degradation values for this fixture. No `toMatchObject`, no subset, no `expect.objectContaining`, no key-count check, no destructuring away of the five added fields.
3. **Class C (#4, #5)** — each is repaired as an unsatisfiable-as-authored test under the §7 amendment ledger's third class, with the repair named by file, line and the reason it could not pass. **#5**'s assertion becomes a direct exact assertion on the value (`toBeNull()` on `content`), which is **stricter** than the substring check it replaces. **#4**'s fixture is retimed so the edit lands strictly inside the pending wait's window, with its `{quiescent: false}` assertion kept verbatim. Neither repair changes what the test is about.
4. **The `timeoutMs = 0` semantics are stated once, in `T3_SharedContract.md` §6**, as the single authority: `0` means "expire at the earliest opportunity — answer after the first poll, never from pre-call history", it is forwarded rather than defaulted, and the answer costs one poll interval. This closes the gap that let a blind test and the implementation each hold a defensible but incompatible reading.
5. **Strictness does not fall anywhere, and the test count does not change** — 12 files and their test count before, the same after, across both sets. Every one of the 30 currently-passing tests in the two sets still passes, unmodified. Each of the five changes carries its own §7 ledger entry with file, line and reason.
6. Both WP49 TypeScript sets are re-run under the WP55 runner with recorded non-zero collected counts, and their `BlindVerificationLedger.md` rows are updated from DIVERGENT to their measured verdicts, with the findings table's "2-key" description of #3 corrected to "4-key".

**Definition of Done:** WP49's blind sets are green because the quiescence oracle behaves as chartered, not because the tests stopped asking.

---

## 5. Constraints and Known Risks

- **Sequencing:** touches `workflowArtifacts/canvas-v2/tests/blind_set{1,2}/WP49/`, `T3_SharedContract.md` and `BUILD_SPEC_CanvasV2.md` §7, and reads `plugin/src/testing/e2e-control.ts`. `src/testing/**` is **not** batch B2 territory (B2 is live in `plugin/src/canvas/**` and `plugin/src/files/**`), so this WP is collision-free with B2 and may run immediately, in parallel with WP60.
- **These failures are genuinely pre-existing — do not attribute them to WP58.** `ImplementationReport_WP58.md:87-91` records WP49's counts (set1 1 fail, set2 4 fail) as **numerically identical before and after** WP58's change, confirming that fix neither caused nor masked them.
- **Hard constraint — WP49 AC1 is untouchable.** The activity seam must never inspect origin. WP58 already declined the tempting origin-filter route and flagged it as a WP49 AC1 regression. If a repair seems to require an origin filter, that is an abort and an escalation.
- **Hard constraint — do not make `waitQuiescent` evaluate before its first sleep.** That restores exactly the pre-call-history defect WP49 exists to remove. The tests move to the implementation's clock, not the other way round.
- **Hard constraint — the anti-weakening rule (§7 abort criteria).** Weakening a test to make a suite green is an abort, never a fix. Class C especially: repairing a broken assertion means making it *assert something true and strict*, not deleting it or replacing it with a tautology. A repaired test that cannot fail is worse than the error it replaced.
- **Class C is the riskiest judgement in this charter.** "This test could never pass" is exactly what a coder sub-agent would claim about a test that has found a real bug. **The licence is conditional on the mechanism being demonstrated, not asserted:** the report must show *why* the assertion is unsatisfiable — for #5, the chai/vitest code path that throws on a `null` receiver; for #4, the arithmetic showing the poll fires on the same tick as the timer advance. Without that demonstration, treat it as a real defect and escalate.
- **Known flaky patterns:** this whole cluster is fake-timer-sensitive. Prefer advancing by an explicit multiple of `pollMs` over sleeping wall-clock time, and never introduce a real sleep — §8 forbids wall-clock sleeps in new tests.
- **Staging hazard when re-running:** a `tsc`/`npm run build` overlapping a blind run type-checks transient staged files. An error whose path contains `v2blind` or a `_blind[12]` suffix is a staging artefact, not a product defect.

---

## 6. Definition of Done Artifacts

- **Required changed files:** the five blind test files named in §2; `T3_SharedContract.md` §6 (one contract statement); `BUILD_SPEC_CanvasV2.md` §7 (five ledger rows); `BlindVerificationLedger.md` (two row updates + findings-table correction).
- **Required report:** `ImplementationReport_WP61.md` — must quote the before and after form of all five changes, state each one's class, and for the two class-C repairs demonstrate the unsatisfiability mechanism rather than asserting it.
- **BUILD_SPEC updates required:** yes — §7 amendment ledger, five rows.
- **Gate status required at handover:** both WP49 TS sets CONFIRMED with non-zero collected counts; all visible tests PASS; plugin test count unchanged.

---

## 7. Visible Test Cases / Producer Artifacts

**No new visible tests — by design.** WP61 restates five existing blind assertions/fixtures; adding a
test would move counts this WP's AC5 requires to stay fixed (32 and 34). Continued strictness is
evidenced by falsification instead — `_falsify_b11.py`, four perturbations covering all five amended
sites:

| Perturbation | Amended site it must redden | Result |
|---|---|---|
| `deadline = now + (timeoutMs \|\| 2000)` | class A #1 **and** #2 | both red, nothing else |
| `canvasSurface: false` | class B #3 | red, nothing else |
| activity seam made origin-aware (the WP49 AC1 violation) | class C #4 | red (+ the file's other test, an independent pin on the same property) |
| absent-file `content: null` → `""` | class C #5 | red (+ `test_tp9`, an independent pin on the same §6.1 value) |

`plugin/src/testing/e2e-control.ts` was restored byte-clean after every perturbation, sha256 verified
identical (`6101d642…8c9fc`), and all sets re-run green afterwards.

**Producer artifacts:** `ImplementationReport_WP61.md` (contains both class-C mechanism demonstrations);
`BUILD_SPEC_CanvasV2.md` §7 (five ledger rows + the third-class table extended with #4 and the WP47
Python twin marked OPEN); `T3_SharedContract.md` §6 (the `timeoutMs = 0` statement, AC4);
`BlindVerificationLedger.md` (both WP49 rows DIVERGENT → CONFIRMED, plus the "2-key" → "4-key"
correction required by AC6); `Worker3Handover_B11_DivergentAmendments.md`.

**Structure references:** `tests/blind_set1/WP49/test_tp4_…_blind1.test.ts` (preamble `:1-12`, advances
`:77`/`:82`); `tests/blind_set2/WP49/test_tp1_…_blind2.test.ts:62`/`:69`;
`…/test_tp3_…_blind2.test.ts:87-92` (nine-key pin) and `:10-15` (import of `E2E_BUILD_MARKER`);
`…/test_tp2_…_blind2.test.ts:89-92` (retimed fixture); `…/test_tp10_…_blind2.test.ts:64` (`toBeNull()`).
Read-only authorities: `plugin/src/testing/e2e-control.ts:394-398`, `:691-721`, `:832-850`, `:971-973`,
`:997-1018`.
