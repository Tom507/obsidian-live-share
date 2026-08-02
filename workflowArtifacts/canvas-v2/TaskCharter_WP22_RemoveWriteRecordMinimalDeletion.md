# Task Charter — WP22: REMOVAL: `writeRecordMinimal` deletion

**Charter Status:** `DONE`
**WP:** WP22
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP14, WP18
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the R1 mechanism no longer exists, independent of the flag.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C22 — REMOVAL: `writeRecordMinimal` key deletion** (work package WP22); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/canvas/canvas-binding.ts:126–143`; the mirrored shape in `plugin/src/testing/e2e-control.ts:338–355`)
  - Responsibility: make binding-side writes upsert-only, closing R1 at its root.
  - Scope summary: binding writes become upsert-only
- **Out of scope / non-goals:**
  - Flipping `useCanvasBinding` — that is WP40 only.
  - The wider op-capture contract renewal — that is WP39.
  - Any other change to `canvas-binding.ts`; this is the one narrowly permitted edit before WP39.
- **Known interfaces / dependencies:**
  - Input: an observed partial record
  - Output: upserts only
  - Depends on work packages: WP14, WP18
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "partial capture" op — a capture that observes only a subset of a record's fields must never remove any other field on any replica (the I7 assertion).

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** REMOVAL: `writeRecordMinimal` key deletion
- **Interfaces involved:**
  - Input: an observed partial record
  - Output: upserts only
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
  - `plugin/src/canvas/canvas-binding.ts:126–143` — `writeRecordMinimal` (sets changed keys, deletes absent ones; no `PROTECTED_KEYS` guard)
  - `plugin/src/canvas/canvas-binding.ts:260–309` — `captureLocal`, which calls it at `:294`
  - `plugin/src/testing/e2e-control.ts:338–355` — `upsertRecord`, the rig's mirror of the same write shape
  - `ARCHITECTURE.md` Part IX R1 — the exact mechanism being removed
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C22. No paraphrasing.*

1. `writeRecordMinimal` no longer deletes doc keys that are absent from the incoming record; capturing `{id}` over an existing edge leaves its endpoints intact.
2. Deletion is possible only through an explicit delete trigger that writes a tombstone.
3. The `upsertRecord` mirror in the E2E control server is changed to the same semantics, so the rig cannot reproduce the old behaviour.
4. `useCanvasBinding` remains `false` and the binding stays dormant in production after this change (the flag is not flipped here).

**Definition of Done:** the R1 mechanism no longer exists, independent of the flag.

<!-- Updated: I7 attribution clarified after the WP4 escalation — no AC changed 2026-07-31 -->

**Amendment note (2026-07-31) — scope clarification, no acceptance criterion changed.** All four ACs stand exactly as written; this WP's scope is unchanged. What changed is the surrounding attribution: the BUILD_SPEC previously read as though WP22 removed deletion-by-key-omission *in general*, and §4.6 traced I7 to P1 only. In fact the behaviour exists at three independent write boundaries (§3.1 S4). This WP owns exactly one of them — `writeRecordMinimal` in `canvas-binding.ts` plus its `upsertRecord` mirror in `e2e-control.ts`. The **capture path** was closed in P0 by WP4, and the **seed boundaries** are closed by WP18. An implementer arriving here and finding no key-deletion left in `canvas-sync.ts` is seeing the expected state, not a missing prerequisite.

**On AC2** ("deletion is possible only through an explicit delete trigger that writes a tombstone"): that trigger is record-level. Explicit removal of a single optional field (`color` / `label`) is a separate capability that does not exist anywhere in P0–P4 — it is the accepted regression recorded as §3.1 **S14** and is owned by WP39 AC5. Do not attempt to satisfy it here.

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
  - `plugin/src/canvas/canvas-binding.ts`
  - `plugin/src/testing/e2e-control.ts`
- **Required report:** `ImplementationReport_WP22.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

Five test cases, 16 assertions-bearing `it()` blocks, all under Vitest 4.0.18 from
`plugin/` (`npm test`, budget >= 90 s). No wall-clock sleep, no new `setTimeout` wait,
no new timing constant, no fake timers at all — every oracle in this WP is synchronous
doc state.

**State is the oracle throughout.** Not one assertion reads a log line. The subject of
this WP is which keys exist in a `Y.Map` after a write, so every test compares the doc's
own JSON (or its key set) before and after, and the two source scans that exist (TC4's
mirror body, TC5's `main.ts` gate) are *paired* with behavioural assertions rather than
standing alone.

**Both directions are pinned, deliberately.** The failure mode of a removal is
over-correction: "stop deleting absent keys" trivially becomes "stop writing" or
"always write". So each of TC1–TC3 carries a counter-assertion — a reported field must
still land, a new key must still be added, an unchanged capture must still emit **zero**
Yjs updates (I3), and the explicit record-level delete must still produce a real
tombstone. TC1's I3 half and TC3's tombstone/creation halves pass before implementation
by design; they are the over-correction guards, not the AC.

**CRDT ordering.** Every register in every test has a single author, and replicas only
integrate — updates are exchanged explicitly with `Y.encodeStateAsUpdate` /
`Y.applyUpdate` in a fixed order, so each asserted value has a causal predecessor chain.
No test asserts the winner of a concurrent same-key write, and no convergence claim is
made from two replicas: TC1 uses **three** (author + two integrators).

**AC2 scope.** The delete trigger asserted here is record-level, per the §4 amendment
note. Explicit removal of a single optional field (S14, WP39 AC5) is deliberately NOT
tested; what TC3 does assert is the consequence of its absence — that no entry point on
the binding removes a field, down to a capture reporting nothing at all.

### TC1 — Capturing `{id}` over a connected edge leaves both endpoints intact
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp22/test_tp01_partial_edge_capture_keeps_endpoints_visible.test.ts`
- What it checks: the R1 mechanism at its smallest. A five-key edge (`id`, `fromNode`, `fromSide`, `toNode`, `toSide`) is seeded into the doc; `captureLocal` reports `{id}` alone. Each endpoint key is asserted individually (so a failure names the key the sweep took) and then the whole record is asserted with one `toEqual`, so partial survival cannot pass. Second half: that same capture must still be an EMPTY diff — `doc.on("update")` counts **0**, because "no delete" must not become "always write" (I3). Third half: a partial capture carrying a genuinely new value (`{id, color}`) upserts it, and the resulting record — endpoints included — is what a three-replica exchange integrates on all three docs.
- Test data channel: in-memory `Y.Doc` + fake `CanvasModelBridge`

### TC2 — A multi-field partial capture touches only what it mentions
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp22/test_tp02_multi_field_partial_capture_preserves_rest_visible.test.ts`
- What it checks: the realistic shape of the same defect. An eight-key text card is dragged, so the capture reports `{id, x, y}` and nothing else; `type`, `text`, `color`, `width` and `height` must all survive, asserted both as a whole-record `toEqual` and key-by-key. Minimality is then pinned through the `setCanvasBindingInstrument` seam: exactly **one** `originUpdate` for a real two-field move, and **zero** for a capture that repeats values the doc already holds. Finally the upSERT half — a partial capture naming keys the doc has never held (`color`, `text`) adds them rather than being confused with a deletion signal.
- Test data channel: in-memory `Y.Doc` + fake bridge + binding instrumentation hook

### TC3 — The record-level delete trigger is the only surviving removal, and it tombstones
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp22/test_tp03_record_delete_is_the_only_removal_visible.test.ts`
- What it checks: the "ONLY" half runs progressively emptier observations of one record — full, geometry-only, `{id}`, and finally `{}` (an observation mentioning nothing at all) — and requires the doc record to be byte-identical after every one. The "TOMBSTONE" half drives `record: null` and asserts three separate things: the record is gone, a neighbouring record is untouched (the trigger is record-scoped), and the deletion is a real CRDT tombstone rather than local forgetting — proven by replaying the record's own creation update afterwards (no resurrection) and by a replica that still held the record losing it on integration. A third case pins that a partial capture for an unknown id CREATES, never silently deletes.
- Test data channel: in-memory `Y.Doc` + fake bridge + explicit replica update exchange

### TC4 — The rig's `upsertRecord` mirror cannot delete by omission either
- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp22/test_tp04_rig_mirror_is_upsert_only_visible.test.ts`
- What it checks: the control server's own copy of the write shape, reached through the public command surface (`buildPluginHost(...).simulateEdit` and `routeCommand`) rather than by touching the private function — what matters is what the rig can DO. A partial edge edit (`{id}`) must leave the endpoints connected; a partial node edit through the router must upsert only the reported field and return `{ok:true,{applied:true}}`. The discriminating half: `removeNodes` / `removeEdges` must STILL delete, so "cannot reproduce the old behaviour" is not satisfied by making the command inert. A narrow source scan of the extracted `upsertRecord` body closes the respelling gap (no `delete` call at all inside it, `ymap.set` still present).
- Test data channel: fake `E2EPluginLike` over a real `Y.Doc` + source scan of the extracted function body

### TC5 — The binding is still dormant in production; the flag is not flipped here
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp22/test_tp05_binding_stays_dormant_visible.test.ts`
- What it checks: dormancy at both places it can be broken. The DEFAULT — `DEFAULT_SETTINGS.useCanvasBinding` is `false`, read from the module, with the literal in `types.ts` checked too so a runtime override cannot mask a changed default. The GATE — `main.ts` contains exactly **one** `new CanvasBinding(`, and a brace-depth walk over the comment-stripped source proves that site is lexically inside `if (this.settings.useCanvasBinding) {`; an ungated construction is dormancy lost even with the flag `false`, because the settings object is user-writable. The flag's other consumer (the legacy follower-apply bypass) is pinned separately, since dormancy is a property of both gates.
- Test data channel: module import + source scan (`main.ts` has no test file — the `v2/wp5v2/test_tp07` precedent)

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC of C22 needed INTEGRATION_SCOPE. All four ACs are observable
at module surfaces with in-memory `Y.Doc`s: AC1 and AC2 at `CanvasBinding.captureLocal`
with a fake `CanvasModelBridge`, AC3 at `buildPluginHost` / `routeCommand` with a fake
`E2EPluginLike`, AC4 as a module-value and source-structure claim. Nothing was deferred
to Worker 4. **W4 Test Targets: `0`.**

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `writeRecordMinimal` (`canvas-binding.ts:126–143`) set every
  changed key of `next` and then swept `[...ymap.keys()]`, deleting each key not `in next`.
  Because `captureLocal` forwards whatever the model reports, a partial observation such as
  `{id}` deleted the record's remaining keys — R1. `upsertRecord` (`e2e-control.ts`) carried a
  byte-identical sweep, so `canvas.simulateEdit` reproduced the same loss from the rig.
- **Approach:** delete the sweep loop in both functions and nothing else. The upsert half, the
  `changed` return value (I3's empty-diff ⇒ no Yjs update), the `CANVAS_BINDING_ORIGIN`
  transaction, the explicit `record === null` record-delete in `captureLocal`, and the rig's
  `removeNodes` / `removeEdges` commands are all untouched. Doc comments on both functions
  restated to say why absence now carries no intent.
- **Fallback path if all attempts fail:** n/a — the change landed on attempt 1.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. Binding-side writes are upsert-only, the rig mirror
  matches, the record-level delete trigger is the only removal and still tombstones, and
  `useCanvasBinding` is untouched at `false`. 16 visible tests (5 files) + 27 blind tests
  (10 files across both sets) green. **Zero tests deleted, zero amended** — the deletion
  ledger in `ImplementationReport_WP22.md` is empty by outcome, not by omission.
- **What remains open:** nothing in this WP's scope. Field-level explicit removal remains the
  accepted regression S14 (WP39 AC5). Flipping the flag remains WP40.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
