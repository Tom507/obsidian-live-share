# Task Charter — WP64: Tombstone-blind test-instrument sweep

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP64
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP19, WP23
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** no test in the tree proves a record survived by an oracle that a tombstone can satisfy.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component
  **C64 — Tombstone-blind test-instrument sweep** (work package WP64); phase **P1**. The residual list
  this WP consumes is in **§7, WP19 entry → "Not covered by this licence, and deferred to WP64"**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (**test instruments and test assertions only**)
  - Responsibility: restore falsifiability to the *survival* oracles that WP19 silently vacated
    outside WP19's own licensed scope.
  - Scope summary: tombstone-aware readings in the named helpers and call sites; suppression pins
    added alongside existing field-level oracles.
- **Out of scope / non-goals:**
  - **Any production source file.** This WP touches nothing under `plugin/src/` except
    `plugin/src/__tests__/`. If a fix appears to require a production change, that is a real defect —
    ESCALATE, do not implement it here.
  - The 8 red rows and the 6 green rows already licensed to **WP19** (§7 rows 1–14). They land with
    WP19; re-touching them here is an unlicensed edit.
  - The `CanvasBinding` record-level delete and the `e2e-control` rig mirror, which still remove keys
    legitimately and are owned by WP39/WP40 (§7 "Scope boundary").
  - Converting production delete paths to tombstones — that is WP19, and it is done.
- **Known interfaces / dependencies:**
  - Input: §7's WP19-entry residual list; WP12's `readTombstoneEntry` / `isTombstoneSuppressed`;
    the 3-arg `buildCanvasData(nodes, edges, deleted)` / `serializeCanvas(nodes, edges, deleted)`
  - Output: tombstone-aware test instruments; strictly stronger assertions; unchanged test count
  - Depends on work packages: **WP19** (the tombstone wiring and its licence must land first),
    **WP23** (its fault-injection matrix row 2 is the falsification instrument for AC4)

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** test instruments across WP4, WP5v2, WP6, WP18, WP20, WP23, WP63 and
  `w4-canvas-integrity`
- **The one idea this WP implements:** after WP19, **key presence no longer means the record is
  alive.** A record can be present-and-suppressed. Therefore any assertion of the form *"the record
  survived"* that reads `map.has(id)` / `.toBeDefined()` is satisfied by a tombstone and can no longer
  fail. The repair is to make the *reading* mean **visible**, not **present**.
- **The two instrument families to fix:**
  - `docRecords()`-style helpers that iterate the raw `nodes`/`edges` map and never consult `deleted`:
    `plugin/src/__tests__/w4-canvas-integrity.test.ts:132`,
    `plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts:99`,
    `plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts:87`,
    `plugin/src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts:94`
  - Remaining **2-arg** `serializeCanvas` / `buildCanvasData` call sites in tests, which suppress
    nothing by construction — approximately ten, including
    `v2/wp6/chaos_degraded_adapter.test.ts:136-138` (`canonical()`),
    `v2/wp6/chaos_cascade.test.ts:128`,
    `v2/wp4/test_tp01_intent_basis_visible.test.ts:151,185`,
    `v2/wp4/test_tp02_byte_echo_visible.test.ts:148`,
    `v2/wp4/test_tp03_closed_view_shadow_advance_visible.test.ts:127,169`,
    `v2/wp5v2/test_tp01_single_shadow_visible.test.ts:199`,
    `v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts:140`,
    `v2/wp63/test_tp03_withhold_lifts_when_refused_set_empties_visible.test.ts:85`,
    `canvas-sync.test.ts:838`.
    **The count and the list are a starting point, not a contract — re-derive them by search rather
    than trusting this charter's arithmetic**, and report the measured list.
- **The residual tests carrying a partial oracle** (each keeps an oracle that still catches
  *container destruction*, so what is missing is only the *suppressed-tombstone* case
  — <!-- Updated: the stated reason was FALSE for one of the nine sites; corrected against B16's per-site measurement 2026-08-02 --> **corrected 2026-08-02, see the note below: this originally read "keeps a
  field-level check", which is not true of `wp63/test_tp02:99`**):
  `v2/wp18/test_tp04_remote_delta_never_rejected_at_ingest_visible.test.ts:128-131`,
  `v2/wp18/test_tp06_seed_is_upsert_only_i7_visible.test.ts:149-150`,
  `v2/wp18/test_tp07_cold_open_migrates_existing_v1_doc_visible.test.ts:133-135`,
  `v2/wp18/test_tp09_cold_open_migration_is_additive_visible.test.ts:87`,
  `v2/wp23/test_tp10_partial_capture_never_removes_a_field_visible.test.ts:74-77`,
  `w4-canvas-integrity.test.ts:210` (A1), `:946-949` (E1), `:1474-1477` (L1),
  `v2/wp63/test_tp02_withhold_is_per_path_and_non_fatal_visible.test.ts:99`.

  > **Correction to the parenthesis above (2026-08-02, Worker 2, on B16's per-site measurement).**
  > B16 verified this deferral judgement **site by site rather than assuming it**, and confirmed it
  > for **8 of the 9**. At `v2/wp63/test_tp02:99` the stated reason is **false**: the record
  > `n-peer` has **no field-level assertion anywhere in that test** — `expect(nodes.has("n-peer"),
  > …).toBe(true)` was its entire oracle, and the neighbouring `nodes.get("n-ok")?.get("x")` pins a
  > *different* record.
  >
  > **The deferral itself was still safe, but for a weaker reason than the one this charter gave.**
  > `has()` does catch outright container destruction, which is the P0-critical loss class, so the
  > site was not more urgent than the charter implied. What `has()` does **not** catch — and what the
  > words "field-level check" wrongly implied was covered — is an **emptied container**: the record
  > present with every field stripped would have passed silently.
  >
  > **This site is closed and is NOT carried into WP66.** B16 pinned it three ways (suppression,
  > projection, **and** `text === "from a peer"`), and that third pin is also the measurement showing
  > the fixture is **not hollow** — the record genuinely reaches the doc carrying a real value, so the
  > C66 class does not apply here. WP66's sweep covers the whole suite and will pass over this file
  > regardless; it is expected to come back non-hollow, for that reason.
  >
  > Recorded rather than silently edited because a deferral is a claim about what stays protected
  > while work waits: overstating the protection makes the deferral unreviewable, since the next
  > reader checks the reason and not the site. Mirrored in BUILD_SPEC §7, WP19 entry.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - **No production source file is modified by this WP.** `plugin/src/canvas/canvas-presence.ts`,
    `canvas-binding.ts`, `canvas-model-bridge.ts`, `main.ts`, `server/`, `docker/`, `deploy/` and
    `plugin/manifest.json` are all untouched, as is every other file outside `plugin/src/__tests__/`.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`.
  - Zero new dependencies of any kind.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project;
  FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation.
  Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C64. No paraphrasing.*

1. Every `docRecords()`-style helper that iterates the raw `nodes`/`edges` map without consulting `deleted` either becomes tombstone-aware or gains a tombstone-aware sibling used by every **survival** assertion (`w4-canvas-integrity.test.ts:132`, `v2/wp5v2/test_tp01:99`, `v2/wp5v2/test_tp05:87`, `v2/wp5v2/test_tp06:94`). Helpers used only for **field-value** reads may stay as they are, and the report states which is which.
2. Every remaining **2-arg** `serializeCanvas` / `buildCanvasData` call site in the test tree is either converted to the 3-arg `(nodes, edges, deleted)` form or carries a one-line comment stating why suppression is deliberately not wanted there. A 2-arg call used as a "the record is gone / still there" oracle is a defect.
3. Each test in §7's WP19 residual list gains a suppression pin alongside its existing field-level oracle, so that it fails both when the container is destroyed **and** when the record survives only as a suppressed tombstone. **Strictness rises on every site; no assertion is relaxed, retitled, skipped or deleted, and the test count does not change.**
4. **Discrimination:** with delete suppression inverted (the C23 fault-injection matrix row 2 perturbation), every test touched by this WP goes **RED**. A test that stays green under that perturbation has not been made falsifiable and does not satisfy AC3.

**Definition of Done:** no test in the tree proves a record survived by an oracle that a tombstone can satisfy.

---

**Charter note (2026-08-02) — why this WP exists and what it must not become.**

WP19 turned deletion from an **absence** into a **value**. §7's WP19 licence repairs the oracles that
went **red** — those announce themselves. This WP repairs the ones that went **green**, which do not.
**An unfalsifiable data-safety test is worse than a missing one, because it is counted as coverage** —
the same reasoning that produced §7's blind-set execution gate and C23 AC5.

Two guard-rails, because a "sweep" charter is the easiest kind to over-run:

- **This is not a licence to edit tests freely.** It covers the sites enumerated in §7's WP19 residual
  list and the two instrument families in §3, and nothing else. Every touched line is enumerated by
  file, line and reason in `ImplementationReport_WP64.md`, exactly as the §7 amendment ledger requires.
  Anything found beyond that list is **reported, not edited**.
- **Strictness may only rise.** No `toMatchObject`, subset match, `objectContaining`, key-count check,
  `skip` or `only`, and no test added or removed. AC4 is the proof: a site that cannot be made to go
  red under the suppression-inversion perturbation has not been fixed, and reporting it as fixed is an
  abort criterion.

If a site turns out to be **genuinely unfixable without a production change**, that is a real defect
in the production suppression path — leave it red and ESCALATE. Do not repair it by weakening the
assertion, and do not repair it by touching production source under this charter.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget ≥90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). `FUZZ_TEST_TIMEOUT_MS = 120_000` — the fuzzer band is slow under full-suite parallel load and that is expected. No Graphify graph exists (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known flaky patterns:**
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Known risks specific to this WP:**
  - **Over-reach.** The residual list is long and the temptation is to "just fix the rest while in
    there". §7's abort criterion applies unchanged: an unenumerated assertion rewrite is an abort.
  - **False confidence from a green suite.** This WP's whole subject is tests that pass while proving
    nothing. A green run is therefore **not** evidence that it worked — AC4's perturbation is.
  - **Ordering.** WP19 must land first. Running this WP against a pre-WP19 tree would "fix" oracles
    that are not yet broken and would collide with WP19's licence.
- **Hard constraints:**
  - **No production source file is modified.** This is the single defining constraint of this WP.
  - Invariants I1–I5 and I6–I10 are binding and must not be weakened.
  - Do not bump the plugin version; do not hand-edit `plugin/main.js` or `server/dist/`.
  - `server/` source is off limits. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:** test files and test helpers under `plugin/src/__tests__/` only
- **Required report:** `ImplementationReport_WP64.md` (in `workflowArtifacts/canvas-v2/`), containing
  the enumerated ledger of every touched line **and** the AC4 perturbation result per touched test
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in
  which case ESCALATE rather than editing the spec
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from
  `plugin/`, **plus** the AC4 perturbation run showing every touched test red with suppression
  inverted and green with it restored (production `cmp`-verified byte-identical afterwards)

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC of C64 needs INTEGRATION_SCOPE — every AC is observable in the unit suite
and through the C23 fault-injection harness, so none is deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
