# Task Charter — WP19: Tombstone wiring

**Charter Status:** `RISKY`
**WP:** WP19
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP12, WP15, WP18
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** deletion is reversible without data loss and still converges delete-wins.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C19 — Tombstone semantics wiring** (work package WP19); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (capture delete path, reconcile output, serialisation suppression, edge cascade `pruneEdgesForDeletedNodes` `:723–739`)
  - Responsibility: replace delete-by-diff-logic with the tombstone flag throughout.
  - Scope summary: delete/undo/resurrect/cascade via tombstones
- **Out of scope / non-goals:**
  - Undo (WP38) — this WP only guarantees the data is restorable.
  - Sidecar-time GC of old tombstones — WP25.
  - Quarantine decisions — WP20.
- **Known interfaces / dependencies:**
  - Input: delete intents from the intent plan; remote tombstone deltas
  - Output: `deleted[id]` writes and suppression everywhere
  - Depends on work packages: WP12, WP15, WP18
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 `delete`/`undo` ops + SEC assertion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Tombstone semantics wiring
- **Interfaces involved:**
  - Input: delete intents from the intent plan; remote tombstone deltas
  - Output: `deleted[id]` writes and suppression everywhere
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
  - `plugin/src/files/canvas-sync.ts:620–704` — the delete branch of `applyLocalDiffToYMaps` (`:688`)
  - `plugin/src/files/canvas-sync.ts:723–739` — `pruneEdgesForDeletedNodes` (cascade)
  - `plugin/src/files/canvas-sync.ts:98–130` — the serializer's dangling-edge drop
  - `plugin/src/canvas/reconcile-plan.ts:122–162` — `diffRecords`, which must see suppressed records as absent
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C19. No paraphrasing.*

1. A user delete writes a tombstone; no record's field container is destroyed by any delete path.
2. Delete-wins and no-resurrect still hold observably: a local upsert for a tombstoned id does not resurrect it, and the reconciler removes it from the view.
3. Deleting a node still causes its edges to disappear from the view and the file (cascade preserved), expressed through tombstones or the suppression rule rather than key removal.
4. A delete followed by an undo restores the record with every field value it had before the delete.
5. <!-- Updated: AC5 appended by the B3c escalation ruling — AC1 turns deletion from an ABSENCE into a VALUE, which retires the V1 key-removal oracle in 8 pre-existing tests and silently vacates 5 green ones 2026-08-02 --> The 13 assertion lines across 8 pre-existing tests that pin the V1 key-removal spelling of a delete are **amended** to the tombstone spelling, and the 5 further assertions that prove a record was **not** deleted by asserting key presence — now vacuously true, because no delete path removes a key any more — are **strengthened**, each named individually in the implementation report against the §7 amendment-ledger WP19 entry. Every amended site becomes an exact assertion on **tombstone suppression** (`isTombstoneSuppressed(readTombstoneEntry(deleted, id))`) **and/or absence from the `buildCanvasData(nodes, edges, deleted)` projection**, plus a positive pin that the record's field container and field values survive — no `toMatchObject`, no subset match, no `objectContaining`, no key-count softening, no `skip`/`only`. **The test count does not change**: nothing is added and nothing is deleted.

**Definition of Done:** deletion is reversible without data loss and still converges delete-wins.

---

**Amendment note (2026-08-02) — resolution of the WP19 licensing escalation. LICENCE GRANTED.**
AC1–AC4 are unchanged and were already met on attempt 1; AC5 is **appended, not substituted**. WP19 is
added to the BUILD_SPEC §7 licensed-**amendment** list (never the deletion list — no test is deleted).

The escalation asked whether the 8 failing pre-existing tests are stale oracles or a genuine
regression. **They are stale, and this was verified row by row against the test bodies rather than
accepted from the ledger.** AC1 says *"no record's field container is destroyed by **any** delete
path"*, so the old spelling `nodesMap.has(id) === false` asserts the **pre-tombstone** semantics
directly. In all 8 the delete still happens, the hand-over gating that decides *whether* it happens is
untouched (`plan.deletes` comes from `planIntentDiff`, which WP19 did not touch), and every
discriminating half still passes. The full 13-line ledger, with per-row post-amendment strictness,
is in **BUILD_SPEC §7, "WP19 entry (2026-08-02, B3c escalation ruling)"** — read it before touching a
test; it is the authoritative list and this charter does not restate it.

Four things this WP must get right, because the prepared ledger under-described them:

- **13 assertion lines, not 8.** Rows 1, 3 and 4 each carry a second absence assertion (a `size` count
  or the cascaded edge); row 8 carries three. Amending one line per test leaves those tests red.
- **The two CASCADE lines take the projection form, not a tombstone check.** WP19 deleted
  `pruneEdgesForDeletedNodes`, so a cascaded edge carries **no tombstone of its own** and
  `isTombstoneSuppressed(...)` is `false` for it. `canvas-sync.test.ts:529` and
  `w4-canvas-integrity.test.ts:354` assert **absence from `buildCanvasData(...).edges`**, plus
  container survival. Writing a tombstone assertion there produces a false failure.
- **Row 8 is a helper repair.** `chaos_degraded_adapter.test.ts`'s `hasNode` (`:127-129`, consumed at
  `:388-390`) must be redefined from key presence to projection visibility. Key presence has also
  **collapsed that test's enabled-vs-disabled discrimination at `:602`**, where `on` and `off` now
  both read `true`; the helper repair restores it.
- **The inverse defect (AC5's second half) is GREEN and therefore was not in the escalation.** AC1 also
  makes every "the record was NOT deleted" oracle that asserts key presence true unconditionally.
  **Six** such assertions are enumerated as rows 9–14 in §7. They pin **I7** — *a partial observation is
  ignorance, not deletion* — the invariant whose regression means **user data disappearing**.
  Two are the priority because key presence is their **only** oracle:
  `test_tp05_handover_and_close_visible.test.ts:142` (T1) and
  `v2/wp18/test_tp03_capture_boundary_rejects_invalid_new_record_visible.test.ts:110` (the
  refusal-takes-no-bystanders pin, i.e. the E2/I11 loss class). Neither can fail at all today.
  Strengthening all six is **part of this WP**, not a follow-up.

**Falsification is the gate on the licence, not a formality.** Row 8's amendment is licensed **only if
the measurement confirms the discrimination survives**: with `perFieldReceipt: false` the record `n4`
must read **suppressed**, and with the seam armed it must read **visible**. **If the disarmed run shows
`n4` still visible, the delete did not happen — D2 has caught a real regression in the hand-over
gating, the row is revoked, and this is an ESCALATE, not an amendment.** Correspondingly, rows 9–13
must be shown to go **RED** when delete suppression is inverted (the C23 fault-injection row-2
perturbation); if they stay green, the strengthening did not take and AC5 is not met.

Practical consequences for this WP:

- Amend and strengthen; **never** delete, skip, weaken or `toMatchObject`. Enumerate every touched
  line by file, line and reason in `ImplementationReport_WP19.md`, against the §7 WP19 entry.
- **The test count must not change** — 1338/1346 becomes **1346/1346**, nothing added, nothing removed.
  Any *other* currently-passing test that goes red is a real defect and an ESCALATE, not something to
  absorb into this licence.
- This licence is granted to **WP19 only** and covers **exactly** the sites enumerated in the §7 entry.
  It is not a general licence to edit pre-existing tests, and any further amendment is an abort
  criterion exactly as an unenumerated deletion is.
- **A wider class exists and is NOT yours.** The sweep behind rows 9–14 found ~8 further tests with a
  now-vacuous key-presence oracle but a surviving *field-level* oracle, plus the tombstone-blind
  instruments they read through (`docRecords()` helpers that never consult `deleted`; ~10 remaining
  2-arg `serializeCanvas`/`buildCanvasData` call sites in tests). Those are chartered as **WP64** —
  see `TaskCharter_WP64_TombstoneBlindOracleSweep.md` and §7's WP19 entry. **Do not pull them into
  WP19**; doing so is the scope creep the licence is shaped to prevent.
- **AC1's word "any" is bounded by this charter's scope** (§7 "Scope boundary"). The `CanvasBinding`
  record-level delete and the `e2e-control` rig mirror still remove keys, are green, and must **stay**
  green — they are frozen behind `useCanvasBinding = false` and owned by WP39/WP40. Do not convert
  them here.
- The coder correctly left all 8 byte-untouched and escalated rather than patching them. **That
  instinct stands as the rule**; this licence is the exception that makes the change auditable, not a
  precedent for coders to amend pre-existing tests on their own judgement.
- Out of scope and unchanged: the comment-only reference to the removed lock gate at
  `v2/wp19/test_tp02_*_visible.test.ts:5` (handover §8.5). It is prose, not an oracle, and this
  licence does not cover it.

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
  - `plugin/src/canvas/reconcile-plan.ts`
  - the tombstone module from WP12
- **Required report:** `ImplementationReport_WP19.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

All six run under Vitest 4.0.18 from `plugin/` (`npm test`). All six FAIL against the
pre-implementation tree — that is the intended state; each failure message names the
missing wiring rather than a harness problem.

### TC1 — A user delete of a node writes a tombstone and destroys no field container
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp19/test_tp01_user_delete_writes_tombstone_visible.test.ts`
- What it checks: after a capture-path node delete, `deleted[id]` reads as suppressed through WP12's `readTombstoneEntry`/`isTombstoneSuppressed`, the node's `Y.Map` is still the SAME object with the same field values, `buildCanvasData` no longer emits it, and a `Y.Map` observer proves no delete path emitted a key removal at all.
- Test data channel: fixture

### TC2 — The EDGE delete branch tombstones instead of removing the key
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp19/test_tp02_edge_delete_keeps_field_container_visible.test.ts`
- What it checks: the second (edge) delete branch of `applyIntentPlan` writes a tombstone, leaves the edge's container and every field intact, leaves a parallel edge between the same two cards unsuppressed, and emits no `edgesMap.delete(...)`.
- Test data channel: fixture

### TC3 — A local upsert never resurrects a tombstoned id (3 replicas)
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp19/test_tp03_local_upsert_does_not_resurrect_visible.test.ts`
- What it checks: a save that still carries the deleted card writes none of its fields into the doc and puts none of them on the wire (asserted on a replica rebuilt from the outbound delta), and all three replicas converge with the tombstone on and the stored values unchanged.
- Test data channel: fixture

### TC4 — A remote tombstone reaches the live view
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp19/test_tp04_reconciler_removes_tombstoned_record_visible.test.ts`
- What it checks: a tombstone-only remote delta drives the `setOnRemoteCanvasUpdate` hook with a payload that omits the record, `getCanvasSnapshot` agrees, and `planReconcile` returns `structural` for a live view that still holds the id.
- Test data channel: fixture

### TC5 — The node→edge cascade is preserved and expressed as suppression
- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp19/test_tp05_node_delete_cascades_edges_via_suppression_visible.test.ts`
- What it checks: deleting a node while the save still LISTS its edge removes that edge from the view and from the file `CanvasPersistence` writes, while every node and edge key — and the cascaded edge's field values — survive in the doc, and the unrelated control edge is untouched.
- Test data channel: fixture

### TC6 — Undo restores the record with every field value it had
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp19/test_tp06_delete_undo_restores_every_field_visible.test.ts`
- What it checks: after delete → `applyTombstoneOp(on:false)` (one Lamport tick later, same author) the container identity is unchanged, every pre-delete field is asserted individually by name, the key set is unchanged, and `serializeCanvas` output is byte-identical to the pre-delete file.
- Test data channel: fixture

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC of C19 needed INTEGRATION_SCOPE: all four are observable at the
`CanvasSync` / `CanvasPersistence` / `reconcile-plan` seams with in-memory vault, IO and
sync-manager fakes, so none was deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** both delete branches of `applyIntentPlan` called
  `maps[del.kind].delete(del.id)`, and the GAP-5 cascade called `edgesMap.delete(edgeId)` —
  deletion was an ABSENCE, so undo was lossy and the delete could not merge. The `deleted`
  container had **no production reader or writer at all**: `CanvasSync.tombstoneView`
  defaulted to `{isDeleted: () => false}`, `getCanvasSnapshot` / the remote-update hook /
  `CanvasPersistence.flushToDisk` all called the two-argument (no-suppression)
  `buildCanvasData` / `serializeCanvas`, and nothing observed the map.
- **Approach:** write the tombstone instead of removing the key (both branches, one shared
  Lamport stamp per pass, `by = String(doc.clientID)`); default the capture path's
  `TombstoneView` to a doc-backed one so the resurrect block needs no wiring; pass the
  `deleted` map to every `buildCanvasData` / `serializeCanvas` call site; observe the
  `deleted` map in `CanvasSync.subscribe` and `CanvasPersistence.start`; DELETE
  `pruneEdgesForDeletedNodes` rather than rewrite it, because `buildCanvasData`'s
  `visibleNodeIds` set already expresses the cascade through the same predicate.
- **Fallback path if all attempts fail:** n/a — all four ACs landed on attempt 1.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1–AC4, all 8 visible WP19 tests PASS, `npx tsc --noEmit` PASS,
  `npm run build` PASS. Every AC falsified at source (5 mutations; see
  `ImplementationReport_WP19.md` §Falsification Results) — no test survived a mutation
  that should have broken it.
- **What remains open:** `SPEC_CONTRADICTION` — 8 PRE-EXISTING tests in 5 files assert
  `nodesMap.has(id) === false` / `edgesMap.get(id) === undefined` after a local
  capture-path delete, which AC1 abolishes verbatim ("no record's field container is
  destroyed by any delete path"). They are listed with file:line in the implementation
  report. They were NOT edited — the sub-agent had no deletion licence. Full suite ends at
  `1271 passed | 8 failed`, i.e. the same pass count as the baseline with a different
  failure set.
- **Final status:** PARTIALLY_DONE (implementation complete, handover gate blocked on the
  legacy-oracle ruling).

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
