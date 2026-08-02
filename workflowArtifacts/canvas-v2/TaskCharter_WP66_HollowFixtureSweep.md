# Task Charter — WP66: Hollow-fixture detection sweep

**Charter Status:** `SPEC_COMPLETE`
**WP:** WP66
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP18, WP64
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** no test in the tree passes by asserting over a record set that its own fixture never put
  into the doc — and for every one that was, the record says whether completing it revealed a defect.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component
  **C66 — Hollow-fixture detection sweep** (work package WP66); phase **P1**. The fixture-editing
  licence this WP runs under is **§7's fifth class, "hollow-fixture completion (licensed for WP66
  only)"** — read it before touching a single fixture; it is narrower than it sounds and it is the only
  authority this WP has to edit anything.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (**test fixtures only**)
  - Responsibility: find by measurement every test that asserts over an empty or materially short
    record set because its own fixture is refused at ingest, then complete or disposition each one.
  - Scope summary: a mechanical detection pass over the whole `plugin/src/__tests__/` tree; fixture
    completion under the §7 fifth licence; falsification per completed site; escalation of every
    verdict change.
- **Out of scope / non-goals:**
  - **Any production source file.** Nothing under `plugin/src/` except `plugin/src/__tests__/`. If a
    completion appears to require a production change, that is a real defect — ESCALATE, do not
    implement it here.
  - **Any assertion, matcher, title, strictness, helper or test instrument.** WP64 owned the
    instruments; this WP owns only the scenery. Touching an oracle here is an unlicensed edit even
    when the oracle is obviously wrong — report it instead.
  - **Adding or removing tests.** The count does not change. (Additive pins on the two `wp5v2`
    helpers are **WP67**, not this WP.)
  - The nine WP64 residual sites, which are closed. In particular `v2/wp63/test_tp02:99` is **not** a
    WP66 site: its `text === "from a peer"` pin is itself the measurement that its record reaches the
    doc. The sweep passes over that file as it does every other, and is expected to measure it
    non-hollow.
  - Fixtures under `plugin/src/__tests__/v2/wp24/` — **batch B4 is live there** (see §5).
- **Known interfaces / dependencies:**
  - Input: the whole `plugin/src/__tests__/` tree; the C18 AC1 refusal path
    (`plugin/src/canvas/canvas-ingest-schema.ts`) and its refusal signatures; B16's `PROBE_A1`
    technique — a temporary probe that reads the doc's record set at the moment of assertion and is
    removed afterwards
  - Output: a measured population, each entry completed or dispositioned; an enumerated ledger in
    `ImplementationReport_WP66.md`; unchanged test count; no production source touched
  - Depends on work packages: **WP18** (C18 AC1 is the boundary that creates this class),
    **WP64** (B16's measurement is this WP's starting evidence, and WP64's instrument repairs must
    land first so a completed fixture is read through a tombstone-aware instrument)

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** test fixtures across the `plugin/src/__tests__/` tree; the known
  concentration is `w4-canvas-integrity.test.ts`, but the population is whatever AC1 measures.
- **The one idea this WP implements:** **a green test is not evidence that its scenario ran.** C18 AC1
  refuses invalid records at ingest — correctly. Every fixture written before that boundary tightened
  is now potentially invalid input, and an invalid fixture does not make its test fail: the records are
  refused, they never enter the doc, the test asserts over an empty set, and it **passes**. Every gate
  in §7 watches for tests that fail. Nothing watches for this.
- **Why the sweep is chartered by measurement and not by a list.** B16's charter estimated ~10
  serializer call sites; the tree held **57**. That error is the precedent this charter is written
  against, and it cuts both ways:
  - B16 named `A2`, `A3`, `A5`, `A6` as very likely hollow. **They are starting points, not the
    scope.** A spot check already shows incomplete literals **outside** that list (in `A7`, and in the
    `W4 L4 — WP4 lock seam` describe) — and at least one *inside* it that may already be valid: `A6`'s
    seed carries `text: ""`, and the validator's only refusal test is `storedSpecific === undefined`,
    so an empty string is **accepted**.
  - Therefore: **do not hard-code the four.** Derive the population by measurement, report it as
    measured, and state plainly wherever the measurement contradicts this charter.
- **Two known false-positive classes a grep will produce, and the reason the oracle must be runtime
  state rather than literal shape:**
  - `text: ""` — **valid.** `canvas-ingest-schema.ts:244` refuses only on `storedSpecific ===
    undefined`; `:245` then applies `requirement.accepts(...)`. An empty string is defined.
  - `remoteRecord(...)` fixtures — **not on this path at all.** A remote delta is accepted into the doc
    and then quarantined (§6 error table), so an incomplete-looking remote literal is not refused at
    ingest and its test is not hollow for this reason.
- **What "hollow" means, precisely:** the record set **actually under assertion** at the moment of
  assertion is **empty** (hollow) or **materially smaller than the fixture literal declares**
  (partially hollow). Partially hollow is the more dangerous half: a test with three declared nodes and
  one admitted one still looks like it is doing work.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - **No production source file is modified by this WP.**
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`.
  - Zero new dependencies of any kind.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project;
  FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation.
  Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C66. No paraphrasing.*

1. **The population is established by measurement over the whole suite, not by the suspected list.** For every test that asserts over a record set derived from a canvas doc, the sweep measures the record set **actually under assertion** (node ids, edge ids) at the moment of assertion and compares it to the set the fixture literal declares. A fixture is **hollow** when the measured set is empty and **partially hollow** when it is materially smaller than its literal declares. `w4-canvas-integrity` **A2, A3, A5, A6** are known starting points and are **neither the boundary nor the expected total** — the measured population is reported as measured, with the same estimate-vs-measurement discipline that turned B16's "~10 call sites" into 57. **Literal-shape matching is a screen, not the oracle**, and the report states how many screen hits the measurement rejected: `text: ""` is *valid* (the refusal test is `storedSpecific === undefined` and nothing else), and a `remoteRecord(...)` fixture takes the accept-then-quarantine path rather than the refusal path, so both would be false positives of a grep.
2. **Every hollow fixture is either completed under §7's fifth licence or dispositioned with a measured reason** why an empty record set is that test's intended state. Each completion is enumerated by **file · line · test title · which declared record ids were absent from the doc · which keys were added · why the completion is faithful to the test's original subject**. **Completing a fixture must not change what the test asserts:** no assertion, matcher, title or strictness is touched, no `skip`/`only`, the test count does not change, and no id, coordinate, edge topology or any value an assertion reads is altered.
3. **Falsification per completed site**, by the method B14 and B16 established: a **targeted injection of the exact class the test claims to catch** — never a global perturbation — with confirmation that the test goes **red on its own named assertion** rather than on a neighbour's, and a note on whether the pre-existing oracles stayed green under the same injection. **Where a prior batch's amendment in the same file masks the falsification** (B15's finding), the injection is narrowed until the failure is attributable to the site under test, and the narrowing is recorded. Every perturbed file is restored and hash-verified.
4. **A verdict change on completion is an escalation, not a fix.** A fixture that has asserted nothing for some time may be concealing a genuine regression that surfaces the moment real records reach the doc. If completing a fixture makes its test **fail**, that failure is a candidate real defect: it is left red, reported with the measured before/after, and handed back for its own charter. Repairing it by weakening the assertion, by reverting the completion, or by treating it as fixture noise is an **abort criterion**.

**Definition of Done:** no test in the tree passes by asserting over a record set that its own fixture never put into the doc — and for every one that was, the record says whether completing it revealed a defect.

---

**Charter note (2026-08-02) — why this WP exists and what it must not become.**

This class has been found **three times by accident and never once by design**: B14 at
`w4-canvas-integrity:352` (never red — refused at the host seed with `MISSING_TYPE_SPECIFIC`), B16 at
**A1** (`PROBE_A1 nodes=[] edges=["e1"]`, a delete-path test running against an empty node map), and
B16's report of the same incomplete literal **13×** in that one file. B16 enumerated A1 and correctly
**reported rather than edited** the rest, because they were outside its residual list. That discipline
is why this charter exists instead of a silent widening — and it is the discipline this WP inherits.

Three guard-rails, because a "sweep" charter is the easiest kind to over-run:

- **Measure first, edit second, and never edit on a grep's authority.** A fixture enters scope only
  once its record set has been *measured* empty or short. The two false-positive classes in §3 are
  named because both would survive a pattern match and neither is a defect.
- **This is a licence over scenery, not over tests.** No assertion, no matcher, no helper, no
  instrument, no test added or removed. If a completed fixture reveals that the test's oracle was
  always wrong, that is a **finding to report**, not a line to fix.
- **The expected outcome is not "all green".** AC4 inverts the usual reflex: a green test going red
  under completion is the most valuable thing this WP can produce. Undoing a completion to restore
  green is an abort criterion — that green was never worth anything.

If a site turns out to be **genuinely uncompletable without a production change**, that is a real
defect in the ingest boundary — leave it as measured and ESCALATE.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never
  the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or
  `--reporter=dot`. Budget ≥90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s
  the floor, not a hang). `FUZZ_TEST_TIMEOUT_MS = 120_000`. No Graphify graph exists (declared FALLBACK
  mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Concurrency — batch B4 is live in phase P2 (WP24–WP30) production source.**
  - **Stay out of `plugin/src/__tests__/v2/wp24/`.** Those files are B4's, spec-first, and red by
    construction until its production module lands.
  - **Expect the tree's gates to be red for reasons that are not yours.** Per §7's concurrent-batch
    attribution entry, the standing state at charter time is 6 file-level collection errors (all
    `Cannot find module '../../../files/canvas-sidecar'`, collecting **zero** tests) and 11
    `tsc`/`build` errors, **all inside `v2/wp24/`**. Measure your own gates against your own touched
    set and **attribute explicitly**, exactly as B16 did — a handover that reports the tree's red as
    its own is as misleading as one that hides a real regression.
- **Known flaky patterns:**
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory
    locally, gating in CI — do not mass-reformat.
  - `wp5/latency.test.ts`'s 50–150 ms RTT band is a registered named intermittent (§7, owner WP65). If
    it fails, re-run that file alone and report both results rather than counting it as a new red.
- **Known risks specific to this WP:**
  - **Scope inflation through pattern matching.** The literal is a screen with known false positives.
    Editing on the screen's authority rather than the measurement's is an unlicensed edit.
  - **Scope deflation through trusting the suspected list.** `A2/A3/A5/A6` is B16's inference from one
    literal appearing 13×, not a measurement of four tests. Both directions of that error are live.
  - **False confidence from a green suite** — this WP's entire subject is tests that pass while proving
    nothing, so a green run is *not* evidence that it worked. AC3's falsification is.
  - **Masking (B15's finding).** A prior batch's amendment in the same file can absorb an injection and
    turn the test red on the wrong line, falsely certifying a site. Narrow until attributable.
  - **A completed fixture may surface a real regression.** That is AC4's expected outcome, not a
    failure of this WP — and it must be escalated with its own charter rather than absorbed.
- **Hard constraints:**
  - **No production source file is modified.** This is the single defining constraint of this WP.
  - **No assertion is touched, and the test count does not change.**
  - Invariants I1–I5 and I6–I10 are binding and must not be weakened.
  - Do not bump the plugin version; do not hand-edit `plugin/main.js` or `server/dist/`.
  - `server/` source is off limits. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:** test fixture literals under `plugin/src/__tests__/` only
- **Required report:** `ImplementationReport_WP66.md` (in `workflowArtifacts/canvas-v2/`), containing
  the measured population with its estimate-vs-measurement comparison, the rejected screen hits, the
  per-site completion ledger, the AC3 falsification result per completed site, and every AC4 escalation
  with its measured before/after
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in
  which case ESCALATE rather than editing the spec
- **Gate status required at handover:** `npm run build` and `npm test` run from `plugin/`, with results
  **attributed** — your own touched set separated from batch B4's `v2/wp24/` state — **plus** the AC3
  falsification run per completed site, every perturbed file restored and hash-verified

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC of C66 needs INTEGRATION_SCOPE — every AC is observable in the unit suite
and through targeted injection, so none is deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
