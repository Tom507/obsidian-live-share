# Task Charter — WP23: Convergence fuzzer

**Charter Status:** `DONE`
**WP:** WP23
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP17, WP19, WP20
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** convergence of the V2 model is checked over interleavings, not examples.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C23 — Convergence fuzzer** (work package WP23); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (property-based test harness)
  - Responsibility: replace ∃-style example tests with the ∀-style check that convergence actually requires.
  - Scope summary: 3–5 replicas, pluggable ops, four assertion families
- **Out of scope / non-goals:**
  - Changing production behaviour to make the fuzzer pass — a fuzzer failure is a finding, not a test defect.
  - Ops that require mechanisms not yet built (text-edit, undo) — they are registered by WP36 and WP38.
  - Live Obsidian — the fuzzer is headless.
- **Known interfaces / dependencies:**
  - Input: a seed, a replica count (3–5), an op registry, and a scenario budget
  - Output: pass, or a minimal reproducible failing sequence frozen as a named regression test
  - Depends on work packages: WP17, WP19, WP20

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Convergence fuzzer
- **Interfaces involved:**
  - Input: a seed, a replica count (3–5), an op registry, and a scenario budget
  - Output: pass, or a minimal reproducible failing sequence frozen as a named regression test
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - **Schema impact:** **`meta.schemaVersion = 2`.** The *doc* format changes; the `.canvas` *file* format does not. Mixed-version rule (CONCEPT_V2 Teil 12): a client whose major schema version differs from the doc's goes to Receive-and-Persist rather than guessing a translation. In P1 that degradation is local — capture disabled for the path, persistence continues — and it is unified with the room-level mode in WP32.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/__tests__/harness/two-peer.ts` (545 L) — the existing multi-peer harness
  - `plugin/src/__tests__/harness/canvas-double.ts` (318 L)
  - CONCEPT_V2 Teil 14 item 1 — the four assertion families
  - CONCEPT_V2 Teil 4 — the convergence argument the fuzzer is checking
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C23. No paraphrasing.*

1. The fuzzer runs **3–5** simulated replicas (never 2), applying random op sequences from a **pluggable op registry** that initially covers create, move, resize, reroute, relabel, delete, undo and reorder, with random partitions, delta reordering and delta duplication, plus randomised Obsidian-save simulations using a deliberately stale view model.
2. After quiescence it asserts on **every** replica: identical doc state (SEC), the schema invariants (no endpoint-less edge, no record without `pos`), identical canonical serialisation (byte equality), and shadow consistency (no replica ever pushed a stale field — the W1 discriminant).
3. Runs are reproducible from their seed, and any discovered counter-example is frozen as a named regression test that fails before the fix and passes after it.
4. The op registry is open for extension so later phases can add ops without modifying the fuzzer core, and every WP in this spec that changes merge or serialisation behaviour is reachable through at least one registered op.

5. **An intent-trace oracle, independent of the implementation's own merge.** For every field the op sequence touched, the converged value on every replica must equal the value written by the **last op on that field under the run's total order**, as computed by the harness from its **own op log** — never read back from the implementation's merge result. **Agreement between replicas is necessary but not sufficient: a run in which all replicas agree on a value that no op ever wrote is a FAILURE, not a pass.** The op registry must include at least one op class that produces a record carrying **both** the flat and the register spelling of the same fact, and one that varies the insertion order of those two keys.

**Definition of Done:** convergence of the V2 model is checked over interleavings, not examples, **and correctness is checked against intent rather than against consensus**.

---

<!-- Updated: AC5 added — the WP18 batch found a real corruption bug that all four existing assertion families were structurally blind to 2026-08-02 -->

### Amendment (2026-08-02, Worker 2). AC5 is new; AC1–AC4 are unchanged. WP23 has not started, so this is a charter extension rather than a reopen.

**Why AC5 exists.** AC2's four assertion families — SEC, schema invariants, byte equality, shadow consistency — share one blind spot: **all four are satisfied when every replica converges on the same *wrong* value.**

This is not hypothetical. Worker 3's WP18 batch found and fixed a real corruption bug of exactly that shape: the doc→file decode resolved flat-vs-register collisions by `Y.Map` **insertion order**, so a moved card could snap back to its pre-move coordinate — on **every** replica. SEC held. The schema held. The bytes were byte-identical everywhere. The shadow agreed. Four green assertion families over a corrupted document, and the only reason it was caught at all is that four unrelated example tests happened to pin the value.

**Byte equality is a *convergence* oracle and can never be a *correctness* oracle.** That is "convergence is not correctness" (CONCEPT_V2 Teil 2, W3) turned on the fuzzer's own instruments. AC5 supplies the missing independent basis: the harness's op log is the only source of truth about what the user *meant*, and it must never be derived from what the implementation *did*.

**Two design constraints on AC5, so it cannot be satisfied vacuously:**
- The expected value must be computed by the harness from its own recorded ops. Reading it back from any replica, or from a "reference" implementation that shares code with the system under test, makes the oracle circular and is a failed implementation of AC5.
- The registry must reach the collision class deliberately — a record carrying both spellings of the same fact, with the insertion order varied — because that class is invisible to every other assertion family and is now known to be reachable in production.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - new fuzzer harness + suite under `plugin/src/__tests__/`
- **Required report:** `ImplementationReport_WP23.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by the Coder Sub-Agent. 11 visible test files, 30 test cases, all PASS.*

Reusable fuzzer core, kept separable from the suite so AC4 holds structurally:
`plugin/src/__tests__/harness/fuzz/` - `prng.ts`, `intent-trace.ts`, `op-registry.ts`,
`replica.ts`, `scheduler.ts`, `oracle.ts`, `fuzzer.ts`, `standard-ops.ts` (2888 lines total).
The core (`fuzzer.ts`) imports `OpRegistry` as a TYPE only and names no op class anywhere.

| TC | Verifies AC | Test file | What it checks | Test data channel |
|---|---|---|---|---|
| TC1 | AC1, AC2, AC5 | `plugin/src/__tests__/v2/wp23/test_tp01_all_families_over_random_interleavings_visible.test.ts` | The fuzzer itself over its budgeted scenario band: 3-5 replicas, random ops from the pluggable registry, random partitions, reordered and duplicated deltas, stale-view Obsidian saves. Asserts all five families on every replica, and that the run was not vacuous (op count, op-class breadth, replica band). | seeded PRNG (`FUZZ_BUDGET`, base seed `0x5eed23`); no fixtures |
| TC2 | AC1 | `.../test_tp02_three_to_five_replicas_never_two_visible.test.ts` | 3-5 replicas, never 2: an explicit count below 3 is refused by the core; over 32 seeds the drawn count is always in band and all three values occur; every count in the band converges with every family green. | seeded PRNG, base seed `0x230001` |
| TC3 | AC5 | `.../test_tp03_flat_register_collision_class_visible.test.ts` | The mandated collision class, deterministic: a record carrying BOTH the flat and the register spelling of one fact, register deliberately stale, built in both insertion orders. Asserts the four convergence families are green in both, and that the value is the one the last op AUTHORED. | hand-built records, no randomness |
| TC4 | AC5 | `.../test_tp04_agreement_is_not_sufficient_visible.test.ts` | Agreement is necessary but not sufficient: replicas converge byte-identically on a value the op log never recorded. The exact family set is `{intent-trace}` - every convergence family is green and the run is a FAILURE anyway. Also the circularity self-test: the expectation is computed with no replica in existence. | hand-built `IntentTrace` + hand-built doc |
| TC5 | AC3 | `.../test_tp05_reproducible_from_seed_visible.test.ts` | Reproducibility: the PRNG replays exactly; the same seed replays the identical op log, op classes and replica count; for a run with no contested write the converged `.canvas` replays byte for byte; 8 different seeds all steer elsewhere; a failure message carries its seed. | seeded PRNG, base seed `0x230005` |
| TC6 | AC4 | `.../test_tp06_registry_open_for_extension_visible.test.ts` | Extension without touching the core: an op class defined inside the test file is registered, drawn, run and judged by the oracle. Duplicate names refused. Every WP in `REQUIRED_WP_COVERAGE` reachable. Every op declares `reaches`, and the two absent mechanisms (WP36 text, WP38 undo) are stated as gaps rather than faked. | in-test op definition + seeded PRNG |
| TC7 | AC2 (SEC); WP19 link | `.../test_tp07_delete_and_undo_reach_sec_visible.test.ts` | Delete and undo both fire over 24 scenarios; every family holds; a suppressed record still HOLDS ITS FIELD CONTAINER on every replica (deletion is a value, not an absence); suppressed-on-disk implies a tombstone entry on every replica. | seeded PRNG, base seed `0x230007` |
| TC8 | AC2 (schema); WP20 link | `.../test_tp08_quarantine_under_concurrency_visible.test.ts` | A fault-injection op writes an invalid record directly into one replica inside a partitioned window; every replica converges on the same quarantine entry, the record never reaches any file, and a repair lifts the quarantine on every replica. Never asserts which replica's op won. | seeded PRNG, base seed `0x230008` |
| TC9 | AC2; WP21 link | `.../test_tp09_write_gate_removal_does_not_change_convergence_visible.test.ts` | Over 32 concurrent interleavings: no write denial (each author's own doc holds its own value), no baseline-hold artefact (replaying the just-saved bytes writes nothing), convergence, and LWW-consistency. The atomic `pos` register converges as ONE author's whole `[x, y]`. Never asserts the winner. | seeded PRNG, base seed `0x230009` |
| TC10 | AC2 (I7); WP22 link | `.../test_tp10_partial_capture_never_removes_a_field_visible.test.ts` | A partial capture observing one field never removes any other, checked on the capturing replica at capture time AND on every integrating replica after quiescence, by whole key set. | seeded PRNG, base seed `0x230010` |
| TC11 | AC2 (bytes, shadow); WP17 link | `.../test_tp11_byte_identity_and_stale_save_discrimination_visible.test.ts` | Every replica serialises the byte-identical file over 32 scenarios; a save made from a deliberately stale view model has its stale fields DISCARDED, with the `SHADOW STALE:` signature as evidence that the pass actually ran rather than being skipped by the byte echo breaker. | seeded PRNG, base seed `0x230011` |

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** the two existing harnesses (`two-peer.ts`, `canvas-double.ts`) drive the DORMANT `CanvasBinding` with exactly two peers, and every V2 suite is example-based. Nothing exercised the live V2 path (`CanvasSync` capture + Surface-Shadow + tombstone wiring + quarantine auditor + canonical serializer) over interleavings, and no oracle existed that could disagree with a converged document.
- **Approach:** a new fuzzer core under `plugin/src/__tests__/harness/fuzz/`, built on real `CanvasSync` replicas rather than on the binding. A run is a sequence of WINDOWS; partitions, delta reordering and delta duplication happen INSIDE a window, and every window ends with a full-mesh quiescence interleaved with the debounced audit flush. A per-window SLOT CLAIM ledger gives every oracle-asserted field a determinate last writer; deliberately concurrent writes are declared CONTESTED and judged by LWW-consistency only. The intent-trace oracle computes its expectations from the harness's own op log, in FILE vocabulary, and imports nothing from the modules under test.
- **Fallback path if all attempts fail:** not needed - all five ACs met on attempt 1.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1-AC5 all met. 11 visible test files (30 cases), a 16-class pluggable op registry reaching WP4/9/10/12/13/14/17/18/19/20/21/22, and a fault-injection matrix proving the fuzzer bites on four independently injected defects - including the WP18-class insertion-order bug, which the intent-trace oracle catches while all four convergence families stay green.
- **What remains open:** nothing for WP23. Two registry entries stand in for mechanisms that do not exist yet and say so plainly in their `note` field: collaborative text editing (WP36) and UI undo (WP38). One design observation for Worker 2 is recorded in the implementation report under FINDINGS - it is a P1 consequence of the capture path still authoring the flat vocabulary, not a defect in any landed WP.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
