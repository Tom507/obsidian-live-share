# Task Charter — WP20: Quarantine auditor

**Charter Status:** `DONE`
**WP:** WP20
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP12, WP14, WP19
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** self-healing replaces signature-only detection; the A.2/16 class is repaired, not merely reported.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C20 — Quarantine auditor** (work package WP20); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`auditCanvasState` `:880–948`, `scheduleCanvasAudit` `:814–855`, call site `:444`)
  - Responsibility: raise the auditor from detection to idempotent, convergent self-repair.
  - Scope summary: audit log-only → idempotent repair
- **Out of scope / non-goals:**
  - Changing the audit's debounce/scheduling contract beyond what repair requires.
  - Rejecting remote deltas at ingest (forbidden — repair is the remote-side answer).
  - Removing `PROTECTED_KEYS` (it stays as defence in depth).
- **Known interfaces / dependencies:**
  - Input: the doc state
  - Output: quarantine and release-quarantine tombstone writes, plus signatures
  - Depends on work packages: WP12, WP14, WP19
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 schema-invariant assertion + a fault-injection op that writes an invalid record directly into a replica.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Quarantine auditor
- **Interfaces involved:**
  - Input: the doc state
  - Output: quarantine and release-quarantine tombstone writes, plus signatures
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
  - `plugin/src/files/canvas-sync.ts:880–948` — `auditCanvasState` (currently log-only; `noGeo` `:894`, `noType` `:896`, `fileNodesWithoutFile` `:898`, `danglingEdges` `:899+`)
  - `plugin/src/files/canvas-sync.ts:814–855` — `scheduleCanvasAudit` (calls the audit at `:836`)
  - `plugin/src/files/canvas-sync.ts:444` — the single call site, inside the doc observer
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C20. No paraphrasing.*

1. A record in the doc that violates the ingest schema is quarantined (`on:true, q:true`) rather than logged only; it is never serialised and never rendered, and its field containers are preserved.
2. When a later delta restores the missing fields, the auditor releases the quarantine automatically and the record reappears.
3. The operation is idempotent and convergent: several clients auditing concurrently reach the same end state, and repeated audits of an unchanged doc produce no further deltas.
4. An endpoint-less edge can no longer reach disk, and each quarantine/release emits a distinct signature.

**Definition of Done:** self-healing replaces signature-only detection; the A.2/16 class is repaired, not merely reported.

---

<!-- Updated: E1/E2 rulings — two clarifications so WP20 neither re-introduces the E1 over-constraint nor is mistaken for a file-safety mechanism 2026-08-02 -->

### Clarifications (2026-08-02, Worker 2 — E1 / E2 rulings). No AC changed. WP20 is NOT reopened and NOT blocked.

**1. "Endpoint-less" in AC4 means `from.node` or `to.node` absent — not "no side".**

`fromSide`/`toSide` are optional in the JSON Canvas format. A side-less endpoint is a **complete** endpoint (WP10 AC5) and its edge is **valid**. Quarantining it would re-create, inside the auditor, exactly the data loss the E1 ruling just removed from the ingest path — and it would be worse there, because the auditor runs periodically against docs that are already healthy. AC4's target is the genuinely dangling edge: no `node` at all on one end.

**2. Quarantine is not a file-safety mechanism and must not be used as one.**

A quarantined record is *"nie serialisiert"* (Teil 11) and `CanvasPersistence` writes `serialize(doc)` over the file. Quarantining a record therefore **removes it from the user's file** on the next write. That is acceptable and correct for WP20's actual scope — records **already in the doc**, where shared state and (from P2) the sidecar keep them recoverable and a later delta can lift the quarantine — and it is why AC1 preserves the field containers.

It is **not** acceptable as a way to protect a record that exists only in the user's file. Quarantine protects the **doc**, not the **file**. Protecting the file at the seed boundary is I11, owned by **WP63**, and it is a different mechanism at a different boundary. If a WP20 implementation ever appears to make WP63 unnecessary, that reading is wrong — check whether the record survives a `flush()`, which is the only question that matters for the file.

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
  - `plugin/src/files/canvas-sync.ts`
- **Required report:** `ImplementationReport_WP20.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

All eight run under Vitest 4.0.18 from `plugin/` (`npm test`, budget >= 90 s). All eight
FAIL against the pre-implementation tree — that is the intended state; every failure
message names the missing repair, never a harness problem.

**The seam they all drive** is the one §2 names: a peer's delta lands in the subscribed
doc, the doc observer calls `scheduleCanvasAudit`, and the debounced `auditCanvasState`
runs. Tests advance that debounce with `vi.runOnlyPendingTimers()` — one call = one
settled audit pass — so no wall-clock sleep and no new timing constant is introduced, and
a pass that schedules the next one cannot silently run inside the same call. The faults are
injected as REMOTE deltas because that is the only way an invalid record can be in the doc
at all: WP18 refuses an invalid local proposal at the boundary and WP14 forbids refusing a
remote one (`reject: false`).

### TC1 — A schema-invalid record is quarantined `{on:true, q:true}` and never destroyed
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp20/test_tp01_invalid_record_quarantined_not_destroyed_visible.test.ts`
- What it checks: a remote `text` node with no `text` gets a tombstone that reads quarantined through WP12's `readTombstoneEntry`/`isTombstoneQuarantined`; the record's `Y.Map` is still the SAME object with the same field values; `buildCanvasData` and `serializeCanvas` both omit it while the healthy neighbour is untouched; and a `Y.Map` observer proves the audit emitted no key removal at all.
- Test data channel: fixture

### TC2 — A later delta that completes the record lifts the quarantine
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp20/test_tp02_later_delta_lifts_quarantine_visible.test.ts`
- What it checks: a record broken on TWO conjuncts stays quarantined after the delta that repairs only one, and is released (`on:false`, `isTombstoneSuppressed` false) after the second; the container identity is unchanged, the reappeared record carries the fields from both repair deltas, and it is back in the view and in the file with the right geometry.
- Test data channel: fixture

### TC3 — The auditor releases only its own quarantine, never a user delete
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp20/test_tp03_auditor_releases_only_its_own_quarantine_visible.test.ts`
- What it checks: a VALID record the user deleted (`on:true`, no `q`) survives three audit passes still suppressed, still un-flagged, with its `t`/`by` untouched; a healthy visible record gets no entry at all; and the genuinely invalid positive control IS quarantined, so the pass provably ran.
- Test data channel: fixture

### TC4 — A second audit of an unchanged doc emits zero updates
- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp20/test_tp04_repeated_audit_emits_no_further_deltas_visible.test.ts`
- What it checks: the doc's own `update` event is counted; the repair pass must emit >0 (so idempotence is not vacuous) and passes 2–5 must emit exactly 0, with the projected file unchanged. The update count is the discriminant — a re-write of an identical tombstone is invisible to any state assertion but is a delta broadcast to every peer, and because the audit is observer-driven it makes the room self-perpetuate.
- Test data channel: fixture

### TC5 — Three replicas auditing concurrently reach one end state
- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp20/test_tp05_three_replicas_converge_on_one_end_state_visible.test.ts`
- What it checks: three independent clients receive the same broken doc and audit before any has seen another's verdict, then exchange in a full mesh; all three hold byte-identical tombstone state and project byte-identical files, the invalid node and the endpoint-less edge are quarantined and the whole arrow is not, and a further pass on all three emits zero updates. Deliberately asserts AGREEMENT and FIXED POINT, never which replica's `by` survived — that is a Yjs tie-break on a random clientID.
- Test data channel: fixture

### TC6 — An endpoint-less edge can no longer reach disk
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp20/test_tp06_endpointless_edge_cannot_reach_disk_visible.test.ts`
- What it checks: an edge whose `to` register is absent — with both endpoint NODES healthy, so `buildCanvasData`'s GAP-5 guard provably cannot catch it — is asserted to reach the file BEFORE the audit and to be absent from it after, is quarantined, and keeps its container identity and every field so a repair delta can still bring it back.
- Test data channel: fixture

### TC7 — A side-less edge is a valid edge and is NOT quarantined (E1 regression pin)
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp20/test_tp07_sideless_edge_is_not_quarantined_visible.test.ts`
- What it checks: the quarantine set is stated exactly — of a side-less arrow, a one-side arrow, a `group` node with no type-specific field, two cards and one genuinely `to`-less arrow, ONLY the last may be quarantined. The legal arrows still reach the file with their `*Side` keys ABSENT rather than `null`/`""`. Pins the 2026-08-02 clarification: "endpoint-less" means `from.node`/`to.node` absent, never "no side".
- Test data channel: fixture

### TC8 — Quarantine and release emit distinct signatures
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp20/test_tp08_quarantine_and_release_emit_distinct_signatures_visible.test.ts`
- What it checks: doc state is established first (quarantined → released); then each transition must emit a line in this file's established `<NAME> signature: …` shape naming the record, no line may be shared between the two transitions, and the two must still differ after the record id is blanked out — so a single signature reused for both fails. The exact wording is deliberately not pinned.
- Test data channel: fixture

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC of C20 needed INTEGRATION_SCOPE: all four are observable at the
`CanvasSync` doc-observer / `buildCanvasData` / `serializeCanvas` seams with in-memory
vault, IO and sync-manager fakes plus fake timers, so none was deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `auditCanvasState` counted `noGeo` / `noType` /
  `fileNodesWithoutFile` / `danglingEdges` and emitted three telemetry lines. It wrote nothing,
  so an invalid remote record stayed in the doc, in `buildCanvasData` and in the file.
  All 9 visible WP20 tests RED.
- **Approach:** a PLAN-then-WRITE pass. `planQuarantineActions` (module scope, pure) reads each
  record through `projectPostWriteRecord` and asks WP14's `validateNodeIngest` /
  `validateEdgeIngest` — the validity predicate is imported, never re-derived, which is what keeps
  the E1 side-less ruling out of the auditor. Four states, two of which are work: invalid+visible →
  quarantine, valid+`q:true` → release, everything else → nothing. `repairCanvasState` returns
  early on an empty plan (that is idempotence), takes ONE Lamport stamp via `nextTombstoneTime`
  before the first write, and applies every op through WP12's `applyTombstoneOp` so it can lose to
  a fresher peer op. `nodes` / `edges` are never written.
- **Fallback path if all attempts fail:** not needed — attempt 1 reached all 9 green.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1–AC4, all 9 visible tests PASS, all 8 mutations falsified. Full suite is
  at the known 8 pre-existing reds and nothing else; `npx tsc --noEmit` and `npm run build` PASS.
- **What remains open:** nothing in WP20's scope. The `SCATTER` / `DETACH` / `NO TYPE` telemetry is
  retained unchanged and now re-narrates a record that is already quarantined on every pass — noise
  only, no deltas, and out of scope here. I11 / file-boundary protection remains WP63's.
- **Final status:** `DONE`

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
