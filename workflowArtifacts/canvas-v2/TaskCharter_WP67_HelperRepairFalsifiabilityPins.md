# Task Charter — WP67: Falsifiability pins for the WP64 helper repairs

<!-- Updated: status carried to DONE — B17 closed this WP (Worker3Handover_B17_WP67: WP67 DONE, risk_flag NONE), §7 is filled and the A/B is measured; the field had been left at SPEC_COMPLETE 2026-08-02 -->
**Charter Status:** `DONE`
**WP:** WP67
**Phase:** P1
**task_mode:** `lightweight`
**Depends on:** WP64
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** no WP64 helper repair is carried in the record as verified without a measurement behind it.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component
  **C67 — Falsifiability pins for the unfalsifiable WP64 helper repairs** (work package WP67); phase
  **P1**. The obligation this WP discharges is recorded in **§7's unfalsifiable-repair register**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (**additive pins only**) in exactly two files:
    `plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts` and
    `plugin/src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts`
  - Responsibility: give the two suppression-aware `docRecords()` helpers WP64 repaired a direct,
    falsifiable pin, plus the A/B measurement that shows the pin discriminates.
- **Out of scope / non-goals:**
  - **Any production source file.**
  - **Adding a tombstone to either existing fixture.** This is the defining boundary of this WP, and it
    is a refusal rather than a preference — see §3.
  - **Any existing assertion, fixture, matcher, title or strictness in either file.** Both stay
    byte-identical apart from the added pins.
  - `v2/wp5v2/test_tp05_handover_and_close_visible.test.ts` — its helper repair was already measured
    A/B by B16 (repaired **RED**, raw **GREEN**, identical injection) and needs nothing.
  - The `w4-canvas-integrity` `docRecords()` helper, deliberately left tombstone-blind by WP64 and
    correctly so: every remaining use is a field-value read or an absence check, and its two new
    siblings carry all survival assertions. **Do not "finish the job" by converting it** — that would
    change what the field-value reads observe.
- **Known interfaces / dependencies:**
  - Input: the two suppression-aware helpers as WP64 left them; WP12's `isTombstoneSuppressed` /
    `readTombstoneEntry`; B16's A/B method as recorded in `ImplementationReport_WP64.md` §8a
  - Output: one direct pin per helper, each with its A/B measurement
  - Depends on work packages: **WP64** (the repairs being pinned are its output)

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** the two `wp5v2` test files named above.
- **The one idea this WP implements:** **an unfalsifiable repair is a claim, not a fact.** B16 made
  three `wp5v2` helpers suppression-aware. At `test_tp05` it proved the repair discriminates — repaired
  helper **RED**, original raw helper **GREEN**, identical injection. At `test_tp01` and `test_tp06` it
  could not, because **those fixtures contain no tombstones**, so the repair is a behaviour-preserving
  no-op today and no injection can tell the two forms apart. B16 recorded this openly and **declined to
  count them as AC4 reds** — the right call, and the reason this WP exists rather than a note in a
  handover nobody re-reads.
- **Why the pin goes on the helper and not into the fixture.** The obvious way to make the repair
  falsifiable is to put a tombstone in the fixtures. That is refused: `test_tp01`'s subject is the
  single-shadow reload and `test_tp06`'s is the discrimination seam, and introducing a deleted record
  into either changes **what those tests are about**. §7's fixture licences permit *completion*, never
  *reshaping*, and neither file is in WP66's scope anyway. **The helper is the thing whose behaviour is
  unverified, so the helper is what gets pinned** — directly, in isolation, without touching the
  scenario the file exists to test.
- **What "verified" requires here.** Not that a suppression-aware helper is a good idea — that is
  already settled — but that **these two call sites** would actually fire. The form was proven at
  `test_tp05`; what is missing is a measurement at these two.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 and I6–I10 are binding and must not be weakened.
  - **No production source file is modified by this WP.**
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`.
  - Zero new dependencies of any kind.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project;
  FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation.
  Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C67. No paraphrasing.*

1. Each of the two helpers gains a **direct pin on the helper itself** — a test asserting that it omits a suppressed id and retains an unsuppressed one — rather than a tombstone added to the existing fixtures. **The existing fixtures and every existing assertion in both files stay byte-identical.** Adding a tombstone to fixtures whose subjects are the single-shadow reload and the discrimination seam would change what those tests are about, which AC2 of C66 and §7 both forbid; the helper is the thing under test here, so the helper is what gets pinned.
2. Each new pin is measured **A/B on an identical injection**: red against the pre-WP64 raw helper form, green against the repaired form — the measurement B16 recorded at `test_tp05` and could not take at these two sites. The test count rises by exactly the number of pins added, each is enumerated by file and name, and no existing test changes state in either direction.

**Definition of Done:** no WP64 helper repair is carried in the record as verified without a measurement behind it.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never
  the repo root). Runner is Vitest 4.0.18 — use the default reporter or `--reporter=dot`. Budget ≥90 s
  for any automated `npm test` invocation.
- **Concurrency:** batch **B4** is live in P2 production source (WP24–WP30). Stay out of
  `plugin/src/__tests__/v2/wp24/`, and **attribute gate results** — per §7's concurrent-batch
  attribution entry the tree's standing red (6 collection errors collecting zero tests, 11 `tsc`/`build`
  errors) is entirely inside `v2/wp24/` and is not yours.
- **Known flaky patterns:** state is the oracle, not log strings. Biome reports a whole-file `format`
  finding per touched file (CRLF artefact) — advisory locally, do not mass-reformat.
- **Known risks specific to this WP:**
  - **The tempting shortcut is the forbidden one.** Dropping a tombstone into an existing fixture would
    make the repair falsifiable in two lines and would silently change what two tests are about. It is
    an abort criterion, not a trade-off.
  - **A pin that cannot go red is not a pin.** AC2's A/B is the whole deliverable; a pin that passes
    against the raw helper too has measured nothing and must be reported as such rather than adjusted
    until it looks right.
- **Hard constraints:**
  - **No production source file is modified.**
  - Existing fixtures and existing assertions in both files stay **byte-identical**.
  - No existing test changes state in either direction.

---

## 6. Definition of Done Artifacts

- **Required changed files:** `plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts`
  and `plugin/src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts`
- **Required report:** `ImplementationReport_WP67.md` (in `workflowArtifacts/canvas-v2/`), containing
  each added pin by file and name, the A/B measurement per pin (raw form vs repaired form on an
  identical injection), and the before/after test count
- **BUILD_SPEC updates required:** no — beyond flipping the §7 unfalsifiable-repair register row to
  discharged, which Worker 2 does on handover
- **Gate status required at handover:** `npm run build` and `npm test` from `plugin/` with results
  attributed against batch B4's `v2/wp24/` state, plus the A/B measurement for both pins

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3 Core (`lightweight` — no Unit Test Sub-Agent, no blind sets).*

Two pins, one per file, identical describe/test name in both:

| # | File | Test | Covers |
|---|---|---|---|
| 1 | `plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts` | `WP67 — this file's suppression-aware docRecords() is falsifiable > P1 docRecords omits a tombstoned record the raw form hands over, and keeps the live one` | AC1 + AC2 |
| 2 | `plugin/src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts` | `WP67 — this file's suppression-aware docRecords() is falsifiable > P1 docRecords omits a tombstoned record the raw form hands over, and keeps the live one` | AC1 + AC2 |

Each pin builds its **own** `Y.Doc` (one suppressed node + one suppressed edge beside live siblings) —
no tombstone was added to either existing fixture — and carries `rawDocRecordsControl()`, the pre-WP64
raw form verbatim, as a permanent in-file A/B control so the pin cannot pass vacuously.

**A/B measured (AC2):** helper reverted to the raw pre-WP64 form → P1 **RED** on its own assertion
(`test_tp01:403`, `test_tp06:386`) while every pre-existing test in the file stayed **GREEN**; helper
restored → **GREEN**, restoration verified by hash. Count 9 → 11 (+2). Detail in
`ImplementationReport_WP67.md` §4.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* Both ACs are observable in the unit suite; none is deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
