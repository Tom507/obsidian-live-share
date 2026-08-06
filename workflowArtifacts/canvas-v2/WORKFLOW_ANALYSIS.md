# Workflow Analysis — Canvas V2 / Atomic Orchestrator

**Question:** who wrote 118 000 lines of tests, where did 79 work packages actually come from, and what
in the Atomic Orchestrator caused it?

**Scope:** read-only analysis. Nothing in the tree was modified to produce this report.
**Date:** 2026-08-05 · **Tree:** `liveshareCollab/obsidian-live-share`, branch `fix-bugs-and-raceconditions`
**Analyst provenance:** every number below is measured today by direct file census (`find` / `wc -l` over the
working tree), not taken from any report. Where a measurement contradicts the Dispatcher's own figures,
that is flagged — it is itself a finding.

---

## 0. The short answer

| Question | Answer |
|---|---|
| Who wrote the tests? | **Worker 3's Unit Test Sub-Agent** — 77 separate spawns, one per standard-mode charter. It wrote every one of the 912 generated test files. |
| Why so many? | A **hard, unconditional 3× multiplier** in the workflow: `Worker_3_UnitTestSubAgent.md:23` fixes the blind-set count at 2 per visible test, and `Worker_3_Execution.md:118` gates on it (*"Every visible test has exactly 2 blind counterparts?"*). No risk tiering. The only escape (`task_mode: lightweight`) was used in **2 of 79** charters. |
| Who wrote the tests *of the testing method*? | **Worker 2 (Spec & Task Architect)**, chartering PHASE VI (WP55–67) and the gate-precondition set (WP69–78) at the **Dispatcher's** direction. Worker 3 then generated three test sets for each of those too. |
| Was this in CONCEPT_V2? | **No.** The concept's entire test strategy is **Teil 14 — 37 lines, three items.** Blind sets, ledgers, licence classes, falsification injections and verification-integrity phases are **all workflow-generated**, not concept-generated. |
| Biggest single token driver | **One wrong sentence in CONCEPT_V2 Teil 14** — that the E2E rig "existiert und lief nie". It exists as a headless mock. Cost: **19 work packages** of host-layer and gate-precondition work. |
| Second biggest | **The fixed 3× blind multiplier** — ~97 800 lines of test code that exist only as anti-overfitting duplicates. |
| Third | **PHASE VI** — 12 WPs spent testing the test harness, founded on a premise that was later **withdrawn as non-reproducible**, and which re-verified 59 blind claims to find **0 false ones**. |

---

## 1. The census — what actually exists on disk

Measured 2026-08-05. `.pyc` excluded throughout.

### 1.1 Code

| Corpus | Files | Lines |
|---|---:|---:|
| **Product code** — `plugin/src` (non-test, excl. `src/testing`) | 54 | **22 042** |
| **Product code** — `server/src` | 28 | **7 176** |
| `plugin/src/testing` (production tree, E2E purpose only) | 1 | 1 395 |
| **E2E rig** — `tools/obsidian_e2e` (Python, non-test) | 13 | **9 330** |
| Dispatcher / batch helper scripts — `canvas-v2/*.py` | 8 | 2 519 |

**Product total: ~29 200 lines.**

### 1.2 Tests

| Corpus | Files | Lines |
|---|---:|---:|
| `workflowArtifacts/canvas-v2/tests/visible` (13 WPs, not yet mirrored) | 154 | 20 933 |
| `workflowArtifacts/canvas-v2/tests/blind_set1` (42 WPs) | 379 | **48 577** |
| `workflowArtifacts/canvas-v2/tests/blind_set2` (42 WPs) | 379 | **49 232** |
| **Generated corpus subtotal** | **912** | **118 742** |
| `plugin/src/__tests__/v2` + `wp*` (mirrored visible sets) | ~275 | ~40 851 |
| `plugin/src/__tests__` legacy + harness | ~65 | ~17 738 |

**Generated V2 test corpus: ≈ 159 600 lines. Ratio to product code: ≈ 5.4 : 1.**

**Of that, the blind sets alone are 97 809 lines — 61 % of the entire test corpus exists purely as
anti-overfitting duplicates of tests that already exist.**

### 1.3 Prose

| Corpus | Files | Lines |
|---|---:|---:|
| TaskCharters | 79 | **19 352** |
| ImplementationReports | 54 | **13 884** |
| Worker 3 handovers | 17 | 4 242 |
| `BUILD_SPEC_CanvasV2.md` | 1 | 2 740 |
| `DISPATCHER_STATE.md` | 1 | 999 |
| **`CONCEPT_V2.md` (the authority the whole run derives from)** | 1 | **902** |
| All other canvas-v2 `.md` (dev report, ledger, contracts, dispositions, preflights) | 15 | ~6 744 |
| **canvas-v2 prose total** | **168** | **47 961** |
| W1 exploration output (`ARCHITECTURE.md`, `RepoMap.md`) | 2 | 1 913 |

**Prose is 1.6× the size of the product code. The 902-line concept generated 47 961 lines of
workflow prose — a 53× expansion.**

### 1.4 Measurement discrepancy worth noting

The Dispatcher's own headline table reports *"Generierte Testdateien 23 963"*. The measured figure is
**118 742**. The other four rows in that table reconcile with my census to within 4 %, so this is not a
methodology difference — the orchestrator's self-report **understates its own generated-test corpus by
roughly 5×**. A run that cannot measure its own largest artefact class cannot notice that class growing.

---

## 2. Who wrote what — agent attribution

```text
Dispatcher (Level 1, pure control-flow)
│   └── wrote: DISPATCHER_STATE.md (999), DEVELOPMENT_REPORT (21 968 B), all rulings
│       Did NOT write code or tests — but chartered the *decisions* that created PHASE VI
│       and the gate-precondition set. Origin of the meta-work.
│
├── Worker 1 — Exploration
│      └── ARCHITECTURE.md + RepoMap.md · 1 913 lines · ran once
│
├── Worker 2 — Spec & Task Architect
│      ├── BUILD_SPEC_CanvasV2.md · 2 740 lines
│      │     └── §7 Quality Gates = 580 lines   ← governance machinery
│      │         §8 Test Strategy  =  20 lines   ← the actual test strategy
│      └── 79 TaskCharters · 19 352 lines
│            └── incl. all 22 meta-WP charters (PHASE VI + gate preconditions)
│
├── Worker 3 Core — routing, hidden-test validation, commits
│      │
│      ├── Unit Test Sub-Agent  ×77 spawns   ◄── THE ANSWER TO "WHO WROTE THE TESTS"
│      │     └── 912 files / 118 742 lines across visible + blind_set1 + blind_set2
│      │
│      └── Coder Sub-Agent  ×(54 WPs × up to 3 attempts)
│            └── 54 ImplementationReports · 13 884 lines + the product code
│
└── Worker 4 — Integration & System Testing
       └── ⚠ NEVER PRODUCED AN ARTEFACT. No IntegrationTestReport.md exists anywhere in the tree,
           despite worker4_mode = full and Dispatcher final-output condition #1 requiring one.
```

**This is the structural finding.** The one worker whose job is integration and system testing produced
**zero output** for the entire run, because it sat permanently behind a gate that could not run. All
validation pressure displaced downward into the layer that is cheapest to generate and easiest to fake —
Worker 3's unit tests — and that layer grew to 159 600 lines.

No agent went rogue. The Unit Test Sub-Agent obeyed its prompt exactly. The volume is a **property of the
workflow definition**, not of any agent's judgement.

---

## 3. Where the 79 work packages came from

Full origin breakdown of the chartered total. Traced from `BUILD_SPEC §9`, the phase table in
`DISPATCHER_STATE.md`, and each charter's own stated cause.

| Origin | WPs | Count | % | Traceable to |
|---|---|---:|---:|---|
| **A · Product features from CONCEPT_V2 P0–P6** | WP1–5, 8–22, 24–34, 36–42 | **38** | 48 % | Teil 13's six migration phases. The redesign proper. |
| **B · Testing that CONCEPT_V2 itself asked for** | WP6, WP7, WP23, WP35, WP52–54 | **7** | 9 % | Teil 14's three items: fuzzer (WP23), E2E gate (WP7), chaos suites (WP6/35), `CAPTURE_TRIGGERS` verification (WP52–54). |
| **C · Real-Obsidian host layer — UNPLANNED** | WP43–51 | **9** | 11 % | Teil 14 asserted the rig *"existiert und lief nie"*. It exists as a **headless mock-host** that scopes real Obsidian out by design. The entire host layer had to be built. |
| **D · Gate preconditions — UNPLANNED, SELF-GENERATED** | WP69–78 | **10** | 13 % | Each found by a batch that *tried to run the gate* and discovered it either could not start or could only have produced a false green. |
| **E · Verification integrity — UNPLANNED, SELF-GENERATED** | WP55–62, 64–67 | **12** | 15 % | The shared blind runner (`_run_blind.py`) could not stage TS blind files; every prior blind claim was put in question. Tests of the testing method. |
| **F · Product defects discovered mid-run** | WP63, WP68, WP79 | **3** | 4 % | I11 seed boundary, sidecar rename leak, canvas-never-reaches-guest. |

### The ratio that matters

```text
Product work        (A + F)     41 WPs   52 %
Verification work   (B+C+D+E)   38 WPs   48 %
   ├── asked for by the concept     7 WPs    9 %   ← planned
   └── generated by the run itself  31 WPs   39 %  ← UNPLANNED
```

**Four out of every ten work packages in this project were created by the project's own attempt to
verify itself.** None of them changes anything a user can observe.

The Dispatcher's own count on the *implemented* subset agrees: 22 of 54 implemented WPs are pure
non-product (WP43–49, WP55–64, WP67, WP69, WP70, WP72, WP73) = 41 %.

### The single most expensive sentence in the project

> CONCEPT_V2 Teil 14, line 828: *"`tools/launch_liveshare_e2e.py` **existiert und lief nie**."*

It exists. It is a headless mock-host rig that excludes real Obsidian **deliberately**. The concept
treated "run it" as the remaining work; the real remaining work was "build it".

Downstream cost: **origins C + D = 19 work packages**, plus 9 330 lines of Python rig, plus ~30 000 lines
of test code for the rig itself (WP43–51, WP69, WP70, WP72 test sets), plus the T3 preflight, shared
contracts and gate-order rulings. **Nobody measured the claim before 19 WPs were chartered on it.**

---

## 4. Answering the direct question: was the validation regime already in CONCEPT_V2?

**No. It is almost entirely workflow-generated.** This is worth stating precisely because the concept is
902 dense lines and *feels* like it must have specified the test regime.

`CONCEPT_V2.md` Teil 14 is **lines 808–844 — 37 lines**, and asks for exactly three things:

1. **A property-based convergence fuzzer** — 3–5 replicas, random op sequences, partitions, reordering;
   assert SEC, schema invariants, byte-equality and shadow consistency after quiescence.
2. **The E2E rig becomes a mandatory gate** — green two-vault run with real Obsidian is a release
   condition from P0 onward.
3. **Chaos scenarios as named suites**, each with a discrimination variant (remove the fix → test must
   go red).

That is the whole thing. What the concept **does not contain, anywhere**:

| Mechanism | Lines it produced | Actual source |
|---|---:|---|
| Visible test per AC + **exactly 2 blind counterparts** | ~118 700 | `Worker_3_UnitTestSubAgent.md:23` + `Worker_3_Execution.md:118` (workflow) |
| `BlindVerificationLedger.md` + verdict vocabulary | 264 | WP56/WP57, chartered by W2 |
| Five §7 fixture/assertion **licence classes** | part of 580 | `BUILD_SPEC §7`, grown in-run |
| Falsification-injection requirement per repair | woven through all reports | Dispatcher rulings |
| Unfalsifiable-repair register, amendment ledger, strictness-may-not-fall rule | part of 580 | Dispatcher rulings |
| PHASE VI (verification integrity) | 12 WPs | Worker 3's 2026-08-01 runner finding |
| Shared-ownership contracts, batch contracts, preflights | ~4 000 | Dispatcher |

The concept asked for **one** anti-overfitting device — the discrimination variant, one test per
mechanism. The workflow substituted a **fixed 3× duplication of every test point**, which is a different
and vastly more expensive instrument, and then the run added a second layer of instruments to check that
instrument.

**The concept's own test strategy would have been ~1/20th the cost and, per §7 below, would have caught
most of the same defects.**

---

## 5. The four multipliers, ranked by cost

### M1 · The fixed 3× blind multiplier — ~97 800 lines

`Worker_3_UnitTestSubAgent.md:23`:

> *"If there are N visible tests → 2N blind tests total (minimum — the blind test set count is fixed at `2`)."*

Enforced unconditionally by the Worker 3 Review Gate. `task_mode: lightweight` is the only escape and was
used in **2 of 79** charters (77 ran `standard`).

The multiplier is **insensitive to what the WP does**. WP70 — *gate settings provisioning and local relay
lifecycle*, pure infrastructure for a gate that has never run — produced the largest test corpus in the
project:

| WP | What it is | visible | blind1 | blind2 | total lines |
|---|---|---:|---:|---:|---:|
| **WP70** | rig settings borrow + relay lifecycle | 4 638 | 3 980 | 4 314 | **12 932** |
| WP47 | rig scratch canvas + vault safety | 1 935 | 1 875 | 1 850 | 5 660 |
| WP69 | one-shot e2e build mode | 1 709 | 1 863 | 1 854 | 5 426 |
| WP25 | sidecar lifecycle (product) | — | 2 490 | 2 500 | 4 990 |
| WP48 | rig teardown / crash recovery | 1 696 | 1 585 | 1 617 | 4 898 |

**Four of the top five test-generating WPs are rig infrastructure, not product.** The blind-set device
exists to stop the Coder Sub-Agent shaping an implementation to fit visible tests. For a WP whose ACs are
*"the borrow restores the file byte-for-byte"*, the oracle is a byte comparison — there is no shape to
overfit to. The multiplier fired anyway, three times, for 12 932 lines.

Counter-evidence, stated fairly: blind sets **did** work where the risk was real. WP70 attempt 2 went from
**49 hidden failures → 2**. The device is not worthless; it is **untargeted**.

### M2 · The unmeasured premise — 19 WPs

Covered in §3. One unverified sentence about existing tooling, 19 work packages of consequence. The
workflow has a rule for this in the *product* direction (Dispatcher rule 12: *"verify a defect against the
current tree before chartering it"*) and **no equivalent rule for claims about tooling**.

### M3 · PHASE VI — 12 WPs to check the checker, yield ≈ zero

Trigger (BUILD_SPEC `§PHASE VI`): `_run_blind.py` staged blind files by copying filenames verbatim;
WP46's TS blind files are named `test_*_blind1.ts`, which does not match vitest's discovery glob, so those
sets could not execute.

Then, in the same section, the founding premise is **withdrawn**:

> *"The original text of this phase said vitest 'prints No test files found and **exits 0**', and that the
> runner reported that as a pass. **That does not reproduce and is withdrawn.** Vitest 4.0.18 exits 1 on
> zero discovery … the old runner propagated a **loud red**, not a silent green."*

Final measured result of the whole phase (`BlindVerificationLedger.md`):

| Verdict | Rows |
|---|---:|
| **CONFIRMED** | **59** |
| DIVERGENT | 0 |
| VACUOUS | 0 |
| UNRUNNABLE | 0 |

**59 of 59 blind claims were real. Zero false claims were found.** The phase's product yield was one
genuine defect — a duplicate `bump` count on the edit path in `plugin/src/testing/e2e-control.ts`
(WP58) — which is in the **E2E rig**, not the product. Everything else it found were *"defective tests,
not implementation failures"* (WP57's own words).

This is not an argument that the runner shouldn't have been fixed. Fixing it was one work package
(WP55). Chartering **twelve** — including a suite-wide hollow-fixture sweep (WP66), a ledger-provenance
register (WP65), and falsifiability pins for the repairs made by an earlier sweep (WP67, *"falsifiability
pins for the WP64 helper repairs"* — a test of a fix to a test of a test) — was the expensive decision,
and it was taken **before** any base rate of false claims had been measured.

### M4 · §7 governance read by every sub-agent

`BUILD_SPEC §7 Quality Gates` is **580 lines**. `§8 Validation and Test Strategy` is **20 lines**.

`Worker_3_UnitTestSubAgent.md`, prompt rule 4:

> *"Read BUILD_SPEC section 7 (Quality Gates) to identify the correct test framework and runner."*

Every one of 77 Unit Test Sub-Agent spawns pulled a 580-line governance section — licence classes,
amendment ledgers, abort criteria, deletion registers — **to extract one fact: "use vitest"**. That is
roughly 45 000 lines of context read across the run for a single string, and it is pure overhead in the
narrowest, most-spawned agent in the workflow.

---

## 6. Why it took so long, honestly — the compounding structure

```text
CONCEPT_V2  (902 lines, 1 wrong sentence about tooling)
   │
   ├─► 38 product WPs  ──────────────────────────────────► the actual redesign
   │
   └─► "the rig exists"  ──► FALSE
          │
          ├─► 9 WPs   build the real host layer          (T3)
          │      └─► ×3 test sets each                    ≈ 30 000 lines
          │
          ├─► 10 WPs  make the gate non-vacuous           (WP69–78)
          │      └─► each found by a batch that TRIED to run the gate
          │             └─► ×3 test sets each
          │
          └─► gate never runs ──► W4 never runs
                 │
                 └─► ALL validation pressure lands on W3's unit layer
                        │
                        ├─► fixed 3× multiplier          ≈ 118 700 lines
                        │
                        └─► blind runner defect found
                               └─► 12 WPs testing the tests  (PHASE VI)
                                      └─► ×3 test sets each
                                             └─► WP67: tests of the fixes to the tests of the tests
```

Each layer is individually defensible. The **composition** is what cost the tokens — which is, precisely,
the same failure mode the run itself identified as invariant **I11**: *a validity boundary and a
destructive write must never compose without an explicit decision about what happens between them.*
Nobody made an explicit decision about what happens between "verification is mandatory" and "verification
is itself unverified".

### And the control measurement

On 2026-08-05 the Dispatcher installed the current bundle in two real vaults by hand and watched a card
move. Cost: **one afternoon, zero work packages, zero tests.**

Result, from `DISPATCHER_STATE.md`:

- The V2 serializer executed outside a test for the first time (508 B → 298 B canonical projection).
- Text sync confirmed working peer-to-peer in < 10 s.
- **A P0-class defect found within minutes that 1 856 headless tests could not see** — a canvas existing
  only on the host never reaches a guest (chartered WP79). The dev report's own verdict:
  *"invisible to 1 856 headless tests, and surfaced within minutes of the first real session."*
- Then a **confirmed live data-loss chain** (D1/D2/D3): a host demotes itself to guest on restart, and a
  guest trashes every shared local file absent from a manifest nobody published. Real files were destroyed.

**The single highest-yield hour of the entire run was the one with no work package attached to it.**

---

## 7. What the defect record actually says about unit vs. E2E

This is the empirical basis for §9's ruleset. Every closed or confirmed defect in the run, and what could
have caught it.

| # | Defect | Level that caught / could catch it |
|---|---|---|
| 1 | Corruption cascade — capture diffed against disk, not shadow | **Unit.** Pure function over three states; the concept says so at Teil 13. |
| 2 | Side-less edge deletion (legal JSON Canvas refused, then deleted) | **Unit** — representability + validity boundary. |
| 3 | `"text": ""` refused as invalid | **Unit** — boundary value. |
| 4 | Insertion-order corruption (flat vs register resolved by `Y.Map` order) | **Property/fuzz with an intent-trace oracle.** Measured: SEC, schema, byte-equality and shadow-consistency were **all green** over a provably corrupt document across 200 scenarios × 10 windows. Only the intent-trace oracle fired — 2 913 times. |
| 5 | Manifest sidecar leak on `renameFile` | **Unit** — predicate reachability in one module. |
| 6 | Permanent epoch freeze (`Number.isInteger` admits `2**53`) | **Unit** — numeric boundary. |
| 7 | Conflict-copy clobber (day-granular naming) | **Unit** — naming/idempotence. |
| 8 | File-op rename broadcast leak (WP68) | **Inbound arm: unit. Outbound arm: E2E only** — depends on Obsidian emitting a vault rename into `.obsidian/`, never observed, unobservable without a host. |
| 9 | **Canvas never reaches guest (WP79)** | **E2E only.** Circular dependency across three modules plus Obsidian's own open semantics. Invisible to 1 856 headless tests; found in minutes live. |
| 10 | **D1/D2/D3 data-loss chain (hostless session → guest trashes files)** | **E2E only.** Requires two processes, a restart, and a partial manifest. |
| 11 | I11's protection expires with the session (cold open re-projects the doc over the file) | **E2E or restart-scoped integration.** In-memory ledger, per-session, only observable across a process boundary. |
| 12 | Dropped keystrokes (whole-string LWW under `requestSave` debounce) | **E2E / human.** Requires a real editor's debounce timing. |
| 13 | No cursors / no presence | **Human-observable only.** |

And the nine *"green test that cannot fail"* instances — every single one has the same shape:

| Instance | The double that encoded the assumption |
|---|---|
| `simulateEdit` returns hardcoded `applied: true` | the host can never report failure |
| `sameFileObservation` true for two `{exists:false}` | two absent files "converge" |
| `_run_case` discards `applied` (11 sites) | an unapplied gesture leaves snapshots equal → pass |
| WP25's gate stalled at `hold("exists")` | blocked ahead of the seam it meant to order |
| `__LS_E2E__` count = 0 in **both** bundles | a check consistent with every possible build |
| global perturbation reddens *something* | taken as proof the specific pin bites |
| … and four more | same class |

**The generalisable law this run proves, at a cost of roughly 22 work packages:**

> **When the test double is the thing that would be wrong, the test cannot fail.**

That is the discriminator. Not "is this hard to unit test" — *"if my double were wrong, what would this
test report?"* If the answer is **pass**, the test point is not a unit test point.

---

## 8. Recommendations for the Atomic Orchestrator

Ordered by expected saving. All preserve TDD and blind-set anti-overfitting; none removes validation.

### R1 · Make the blind multiplier conditional, not fixed — largest single saving

**Change** `Worker_3_UnitTestSubAgent.md:23` and the `Worker_3_Execution.md` Review Gate.

```text
Now:  every test point → 1 visible + 2 blind, always, 77/79 charters
New:  every test point → 1 visible + blind_set1, always
      blind_set2 generated ONLY for WPs where blind_set1 reddened on attempt 1
      (i.e. overfitting is demonstrated, not assumed, for that WP)
```

**Why this is safe:** the blind device's purpose is to detect a coder shaping an implementation to visible
tests. Whether that happened is **measurable on attempt 1** — that is exactly what Phase 4 already does.
Generating set 2 up front pays for it in every WP to catch it in a minority.

**Measured basis:** WP70 (49 hidden failures) proves set 1 earns its keep. The ledger's **59/59 CONFIRMED,
0 DIVERGENT** proves that once set 1 is green, set 2 never contradicted it — not once, across the whole run.

**Expected saving:** ~49 000 lines of generated test code (~31 % of the test corpus), plus the
sub-agent time to author it and the Phase 4 time to run it.

### R2 · Tier the multiplier by WP class

Add a required field to every TaskCharter, set by Worker 2:

| `verification_class` | Blind sets | Applies to |
|---|---:|---|
| `pure-core` | 2 | algorithmic ACs over explicit inputs — where overfitting is a genuine risk |
| `wiring` | 1 | integration of cores through existing seams |
| `infrastructure` | **0** | rig, build, install, borrow/restore — ACs whose oracle is a byte comparison or an external effect |
| `removal` | 0 | REMOVAL WPs — the oracle is absence |

**Basis:** four of the top five test-generating WPs were `infrastructure`. WP70 alone would drop from
12 932 lines to ~4 600. `task_mode: lightweight` already exists as the binary version of this idea and was
used **twice in 79 charters** — a binary escape hatch that requires the Dispatcher to predict cheapness is
not used; a required classification field is.

### R3 · A premise-verification gate before any phase expansion

**New Dispatcher rule.** Before Worker 2 charters a phase that rests on a stated fact about existing
tooling, environment or infrastructure — *"X exists"*, *"X was never run"*, *"X supports Y"* — the fact must
be **measured** by Worker 1 (one exploration call) and the measurement recorded in the charter.

**Basis:** 19 WPs — a quarter of the entire project — were chartered on *"the rig exists and merely never
ran."* Cost of the check: one `Read`. Rule 12 already mandates this for **defects**; it must extend to
**premises**.

### R4 · Cap self-referential depth, explicitly

**New rule.** A work package whose deliverable is readable only by another work package of the same run —
not by a user, not by the product — is **meta**. Rules:

- Worker 2 tags each charter `meta: true|false`.
- When meta WPs exceed **25 %** of the chartered total, the Dispatcher **stops and surfaces to the owner**
  with the ratio, rather than continuing to charter.
- **Depth limit 2.** A test of a test is permitted. A test of a fix to a test of a test (WP67) is not —
  it requires an explicit owner decision.

**Basis:** meta reached **48 %** here and nothing in the workflow could notice, because nothing counted it.

### R5 · Require a measured base rate before a verification-integrity phase

**New rule.** When a defect is found in the verification harness itself, the first response is **one** WP:
repair the instrument and re-measure a **sample** (5 sets). Only if the sample yields a **non-zero false-claim
rate** may further verification-integrity WPs be chartered, and the charter must state the measured rate.

**Basis:** PHASE VI cost 12 WPs, and the full sweep returned **0 VACUOUS, 0 DIVERGENT out of 59**. A
5-set sample would have returned 0 and stopped the phase at WP55. Its founding premise was additionally
**withdrawn as non-reproducible** — a base-rate check would have caught that too.

### R6 · The Minimum Observable Product gate — highest yield per token in the whole analysis

**New mandatory Dispatcher step, inserted after the first phase (P0) of any phased plan and before any
further phase is chartered:**

> Install the current build in its real runtime, by hand if necessary, and have a human observe the
> primary user flow once. This is **not** the automated gate, is **not** a work package, produces **no**
> test artefacts, and its output is one paragraph in `DISPATCHER_STATE.md`.

**Basis, measured:** one afternoon of manual smoke testing found a **P0-class product defect (WP79)** and a
**confirmed live data-loss chain (D1/D2/D3)** that 1 856 tests, 79 charters and 159 600 lines of test code
did not. It also retired the false premise behind 19 WPs. Had it run after P0 instead of after P6 + T3 +
PHASE VI, origins C and D would have been scoped correctly from the start.

The Dispatcher's own conclusion, in its own words: *"equally for running the product early, which cost an
afternoon."*

### R7 · Fix the W4 blackhole — a blocked gate must halt, not silently displace

**Basis:** `worker4_mode = full`, and **no `IntegrationTestReport.md` exists anywhere in the tree**.
Dispatcher final-output condition #1 requires one. The workflow ran to 79 charters with its own primary
completion gate structurally unreachable, and nothing flagged it.

**Change:**

- Worker 4 blocked for **2 consecutive W3 handovers** → Dispatcher **must** surface `GATE_BLOCKED` to the
  owner with the blocker chain, and **may not charter further phases** until the owner rules.
- `AtomicOrchestratorWorkflow.md` Final Output Conditions gain an explicit `W4_NEVER_RAN` state that
  cannot be reported as completion.

Without this, W4 being blocked is *invisible*, and the pressure silently lands on W3's unit layer — which
is exactly the mechanism that produced 159 600 lines of headless tests validating a product nobody had run.

### R8 · Split governance out of BUILD_SPEC

`§7 Quality Gates` = 580 lines; `§8 Test Strategy` = 20 lines. The Unit Test Sub-Agent is instructed to read
§7 **to learn the test framework**.

**Change:** move run governance (licence classes, ledgers, amendment registers, abort criteria) into
`GOVERNANCE.md`, loaded only by the Dispatcher and Worker 2. `BUILD_SPEC §7` retains **only** the commands,
framework, and runner — the facts a test author needs. Add the framework/runner as explicit charter
metadata fields so the sub-agent reads neither.

**Saving:** ~45 000 lines of context across 77 spawns, in the workflow's most-spawned agent.

### R9 · The falsifiability question, asked at authoring time

**Add to the Unit Test Sub-Agent prompt, per test point:**

> Name every double, stub, fake and constant this test depends on. For each, state what this test would
> report **if that double were wrong**. If the answer is *"pass"*, do not write this test — classify the
> test point `INTEGRATION_SCOPE` and route it to the Worker 4 target list.

**Basis:** all nine *"green test that cannot fail"* instances have exactly this shape. This run found them
through nine separate archaeological investigations, six consecutive vacuity sweeps, and roughly 22 work
packages. **One prompt question, asked at authoring time, is the cheap version of that entire effort.**

The Review Gate gains: *"Every test point has a stated falsification condition?"*

---

## 9. Generalised routing ruleset — unit vs. property vs. E2E

Derived from §7's defect record, not from general principle. Worker 2 applies this when writing ACs;
the Unit Test Sub-Agent applies it when classifying test points.

### The discriminator

> **If the double were wrong, what would the test report?**
> If **fail** → unit. If **pass** → integration/E2E. There is no third answer.

### Route to UNIT

The AC is a statement about a value computed from inputs the test supplies in full.

- Pure functions over explicit state — shadow diff, canonical form, `ord` allocation
- Representability and validity boundaries — *side-less edge, `text: ""`*
- Numeric, type and overflow boundaries — *`2**53`*
- Precedence and ordering rules with a single definer — *flat-vs-register*
- Predicate reachability inside one module — *`isSharedPath`, `isSidecarPath`*
- Absence assertions **only** when the same test carries its positive control

**Evidence:** 6 of the 8 closed product defects were this shape, and unit tests closed each at its root.
Unit testing is not the problem in this run — **untiered** unit testing is.

### Route to PROPERTY / FUZZ

The AC is universally quantified over sequences: *"for all interleavings…"*

- Convergence, commutativity, idempotence, associativity
- **Mandatory:** the oracle must include an **intent trace**, not only state equality.

> **Measured law: convergence is not correctness.** SEC, schema, byte-equality and shadow-consistency were
> all green over a provably corrupt document across 200 scenarios × 10 windows. Only the intent-trace
> oracle fired — 2 913 times. *Two replicas agreeing on the wrong value is agreement.*

### Route to E2E — if ANY of these six hold

1. **The oracle requires a second process.** Anything whose claim is *"both sides agree"*. A single-process
   double makes agreement trivially true. → *WP79, D1/D2/D3.*
2. **The truth depends on a lifecycle event the harness would have to simulate** — restart, cold open,
   join, rejoin, reconnect, plugin reload. → *I11 expires with the session.*
3. **The host application, not your code, decides the sequence** — `requestSave` debounce,
   `vault.on("modify")`, workspace open semantics, `trashFile`. A host's scheduling cannot be
   fixtured honestly. → *dropped keystrokes.*
4. **The AC asserts that a code path RAN, not that a value is correct.** A unit test constructs the call,
   so it always passes. Positive path evidence requires the real thing. → *WP76 exists solely for this.*
5. **Faking it costs more than doing it.** If the double needed to make the AC checkable approaches the
   complexity of the real dependency, the double becomes the thing under test. → *WP70: 12 932 lines of
   test code to validate a settings borrow.*
6. **The double would encode the assumption under test.** The §8/R9 question, answered *"pass"*.

### Do NOT route to E2E when

- The AC is a pure computation — E2E adds flake, hides the root cause, and is slower to diagnose.
- The behaviour is deterministic and single-module.
- **The E2E rig would have to be more trustworthy than the thing it tests.** This is the trap this run
  fell into: 19 WPs went into making the rig trustworthy, the rig became the project, and the gate still
  never ran.

### Two budget rules, both violated here

**B1 · The instrument may not exceed its subject.**
Measure it per phase: lines of verification instrument vs. lines of product delta. Here, rig +
gate-precondition machinery reached roughly 40 000 lines against a P0/P1 product delta a fraction of that
size. **When the instrument crosses 1:1 with its subject, stop building the instrument and validate that
class by human observation instead.**

**B2 · No verification layer may be built before the layer beneath it has produced one real result.**
The gate machinery (WP69–78) was built before the gate had ever run once. The verification-integrity phase
(WP55–67) was built before any false blind claim had been measured. Both would have been scoped
differently — or not chartered — against one real observation.

The general form, and the run's own I11 one level up:

> **A verification layer and an unrun subject must never compose without an explicit decision about what
> happens between them.**

---

## 10. Expected effect

Applying R1–R9 to a re-run of this same project, holding scope and rigour constant:

| Driver | Now | With recommendations | Basis |
|---|---:|---:|---|
| Generated test corpus | 118 742 lines | ~50 000 | R1 (conditional set 2) + R2 (tiering) |
| Unplanned WPs (origins C+D) | 19 | ~6 | R3 (premise check) — the rig is still needed, but scoped from a measurement |
| Verification-integrity WPs (origin E) | 12 | 1 | R5 (base rate: measured 0/59) |
| §7 context per sub-agent spawn | 580 lines × 77 | ~40 lines × 77 | R8 |
| Meta-WP share | 48 % | < 25 % (enforced) | R4 |
| P0-class defects found before P6 closed | 0 | ≥ 2 (WP79, D1–D3) | R6 |

**Rough order of magnitude: 55–65 % fewer tokens, more real defects found, found earlier.** Nothing in the
above removes TDD, blind-set anti-overfitting, discrimination variants, or falsification requirements —
R1, R2 and R5 make them *conditional on measured risk* instead of unconditional, and R6 and R7 restore the
validation level the concept always required and the run never reached.

---

## 11. What this run got right — so it is not discarded with the fix

The rigour was not the mistake. Its **uniform application** was.

- The redesign works to the limit of headless evidence. The reported corruption cascade is closed at its
  root, plus five further data-loss or data-corruption defects, **four of which no user had reported and
  which byte-equality provably could not have detected.**
- *"Convergence is not correctness"* went from an argument to a **measured constraint** — 200 scenarios ×
  10 windows. That measurement is a durable, transferable result about CRDT verification.
- The nine *"green test that cannot fail"* mechanisms are a genuine taxonomy. **R9 turns nine
  archaeological digs into one prompt question** — that is the return on the effort, and it is real.
- Not one unlicensed test deletion in the entire run. Strictness never fell.
- The Dispatcher recorded its own errors — the mislocated capture path, the shared git index, the two
  checks that could not fire, the gate ordering from recall — which is the only reason this analysis could
  be written at all.

**The single change that would have mattered most is also the cheapest one in the list: run the product,
by hand, after P0.** Everything else in §8 is a refinement. R6 is the finding.
