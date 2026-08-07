# Task Charter — WP21: REMOVAL: lock write-denial seam

**Charter Status:** `DONE`
**WP:** WP21
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP9, WP10, WP19
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** R7 is moot — there is no write permission left for an epoch to protect.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C21 — REMOVAL: the lock write-denial data seam** (work package WP21); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: delete (`canWriteEntity` `:705–722` and its three call sites `:642`, `:660`, `:688`; the baseline-hold on denial; the `LOCK DENIED:` emitter `:576`; the injected `canWriteNode`/`canDeleteNode` write-gates and their `main.ts` wiring `:796–806`, and the binding-side mirrors `main.ts:1279–1285`)
  - Responsibility: remove the machinery that made a UX mechanism carry correctness, now that the data model resolves same-register conflicts.
  - Scope summary: `canWriteEntity`, baseline-hold, `LOCK DENIED:`
- **Out of scope / non-goals:**
  - `plugin/src/canvas/canvas-presence.ts` — must stay byte-unchanged; locks keep working as UX.
  - `canWriteCanvasPath` (read-only permission and guest globs) — that is authorisation, not locking, and stays.
  - The `LOCK REVERT:` view-revert path, which is retained.
  - The awareness liveness machinery (deadline pulse, reconnect reclaim defer, tiebreak) — unchanged.
- **Known interfaces / dependencies:**
  - Input: none (removal)
  - Output: a capture path with no write-authorisation branch
  - Depends on work packages: WP9, WP10, WP19
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 must show that removing the write gate does not change convergence — concurrent writes to the same register converge by honest LWW on every replica, with no baseline-hold artefact and no held-back local state.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** REMOVAL: the lock write-denial data seam
- **Interfaces involved:**
  - Input: none (removal)
  - Output: a capture path with no write-authorisation branch
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
  - `plugin/src/files/canvas-sync.ts:705–722` — `canWriteEntity` and its three call sites `:642`, `:660`, `:688`
  - `plugin/src/files/canvas-sync.ts:576` — the `LOCK DENIED:` emitter
  - `plugin/src/files/canvas-sync.ts:256`, `:259`, `:260`, `:264` — the injected predicates and their setters `:297`, `:304`, `:308`, `:313`
  - `plugin/src/main.ts:792`, `:796–799`, `:800–803`, `:804–806` — the predicate wiring; `:1279–1285` — the binding-side mirrors
  - `plugin/src/main.ts:1176–1185` — `canWriteCanvasPath` (KEEP)
  - `plugin/src/main.ts:1364–1381` — `revertCanvasNode` (KEEP)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C21. No paraphrasing.*

1. `canWriteEntity` and its baseline-hold behaviour no longer exist; no capture path consults a lock before writing, and no code path holds a diff baseline because a write was denied.
2. Locks still work as UX: rings still colour, the loser's **view** revert still happens, and the awareness liveness machinery (deadline pulse, reconnect reclaim defer, tiebreak) is **byte-unchanged** — `canvas-presence.ts` is not modified.
3. `canWriteCanvasPath` (read-only permission and guest globs) is preserved and still consulted — authorisation is not locking.
4. Tests that pinned the removed denial behaviour are deleted deliberately and enumerated by name in the implementation report; no test is left asserting a behaviour that no longer exists.

**Definition of Done:** R7 is moot — there is no write permission left for an epoch to protect.

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
  - `plugin/src/main.ts`
  - test files pinning the removed behaviour (enumerated in the report)
- **Required report:** `ImplementationReport_WP21.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

Six test cases, all under Vitest 4.0.18 from `plugin/` (`npm test`, budget >= 90 s). No
wall-clock sleep, no new `setTimeout` wait and no new timing constant: the only clock any
of them touches is `vi.useFakeTimers()` driving the presence layer's EXISTING
`reclaimDeferMs` seam.

**This is a REMOVAL, so the oracle mix is unusual and deliberate.** The deleted gate was
default-allow (`() => true` until injected), so an unwired `CanvasSync` behaves identically
before and after the deletion — a purely behavioural test cannot see AC1 at all. TC1–TC2
therefore pair an ABSENCE oracle (the seam is not on the class, not in `canvas-sync.ts`,
not wired in `main.ts`) with a BEHAVIOURAL one (a lock genuinely held by two real
`CanvasPresence` peers does not stop the write, and the diff baseline advances). TC3–TC5
are PRESERVATION tests and are expected to pass before implementation; they exist because
over-deletion — not under-deletion — is this WP's failure mode.

**CRDT ordering.** Every peer delta is integrated BEFORE the local save it is compared
against, so each asserted value has a causal predecessor chain and a single author. No test
asserts the winner of a concurrent same-key write. The peers that hold locks never write.

**Three peers, never two**, wherever a tiebreak or a convergence claim is the subject.

### TC1 — The lock write-denial seam is gone from `CanvasSync` and from its `main.ts` wiring
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp21/test_tp01_write_gate_seam_removed_visible.test.ts`
- What it checks: `setCanWriteNode`/`setCanDeleteNode` are absent from the instance AND from the prototype; `canvas-sync.ts` names no `canWriteEntity`, no `canWriteNode`/`canDeleteNode` predicate, no `LOCK DENIED:` emitter and no `denied` list; `main.ts` injects neither gate and hands neither binding-side mirror to `CanvasBinding`. Every absence assertion is PAIRED with a survival assertion on a neighbour that sits in the same few lines — `setCanWrite` (AC3), `setOnLocalNodeChange` and `revertCanvasNode` (AC2), WP18's `rejected` — so an over-deletion is caught by the same test that catches an under-deletion.
- Test data channel: source scan + constructed instance

### TC2 — A peer's held lock no longer denies a local write, delete or edge re-route
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp21/test_tp02_peer_lock_does_not_deny_local_write_visible.test.ts`
- What it checks: two real `CanvasPresence` peers hold the record over one shared awareness map, so `presence.canWriteNode(...)` is genuinely `false` throughout (asserted first — the fixture cannot be vacuous). All three call sites of the removed gate are covered as separate branches of `applyIntentPlan`: the node upsert, the edge write (which was gated on BOTH endpoints), and the node delete. Each lands in the doc, the diff baseline advances to the saved bytes, no `LOCK DENIED:` line is emitted, the delete is still a tombstone with the container identity intact (WP19), and the peers' UX lock is still held afterwards.
- Test data channel: fixture

### TC3 — Locks still work as UX: rings colour, and the loser's VIEW reverts
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp21/test_tp03_lock_ux_rings_and_view_revert_visible.test.ts`
- What it checks: with three co-claimants and claims arriving in DESCENDING id order, both losers see the ring in the winner's colour via `resolveHighlights`/`computeRingDelta`, and the winner draws none for its own hold. Then the loser-revert: the awareness `change` listener settles, `onRevert` fires exactly once for the lost node, the view is reloaded from `getCanvasSnapshot`, a re-settle is idempotent — and the revert emits ZERO CRDT updates, which is the post-WP21 statement that the revert is a VIEW operation and no longer a data rollback. The diff-inferred lock claim (`setOnLocalNodeChange` → `onDiffInferredChange`) is pinned separately: it sits immediately beside the deleted gate and is the likeliest casualty.
- Test data channel: fixture

### TC4 — The awareness liveness machinery is byte-unchanged
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp21/test_tp04_awareness_liveness_unchanged_visible.test.ts`
- What it checks: `canvas-presence.ts` is pinned literally — LF-normalised byte length and SHA-256 — because the AC says byte-unchanged and the file is an initiative-wide invariant. The digest is paired with behavioural pins so a failure is diagnosable rather than cryptic: the deadline pulse (`AWARENESS_TICK_INTERVAL_MS` + `AWARENESS_PULSE_DEADLINE_MS` = the exported bound, still under the 30 s awareness prune window in which the locks live, and `tickAwarenessKeepAlive` still conditional on an open socket); the tiebreak as a MINIMUM over three holders, path-scoped, with the stricter delete rule; and the reconnect reclaim defer (immediate withhold, nothing re-claimed before the settle window, then only the still-free node).
- Test data channel: fixture + file digest

### TC5 — `canWriteCanvasPath` is preserved and still consulted
- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp21/test_tp05_read_only_permission_still_refuses_visible.test.ts`
- What it checks: the decision rule `main.ts` owns is written out as the predicate it injects (`main.ts` has no test file — the `v2/wp5v2/test_tp07` precedent) and driven through the REAL `setCanWrite` seam and the REAL capture path. A globally read-only client still cannot push; a guest inside a host-designated read-only glob is refused while the SAME client on a path the glob does not cover writes (the discrimination half, without which a refuse-everything guard would pass); the host is not caught by a guest glob. The source scan pins that `main.ts` still declares `canWriteCanvasPath`, still uses `minimatch`, and still injects the guard into BOTH capture paths.
- Test data channel: fixture + source scan

### TC6 — No surviving test pins the removed denial behaviour
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp21/test_tp06_no_test_pins_removed_denial_visible.test.ts`
- What it checks: the mechanical half of AC4 only. The whole `src/__tests__` tree is scanned for the removed seam (`.setCanWriteNode(`, `.setCanDeleteNode(`, `LOCK DENIED:`, `canWriteEntity`), excluding WP21's own files, and the failure message IS the deletion ledger — file, line and reason per offender. Deliberately discriminating: `presence.canWriteNode(...)`, `computeCanDeleteNode(...)`, the frozen `CanvasBinding`'s `canWriteNode:` option and `setCanWrite(...)` all survive WP21 and are proven not to match. The ENUMERATION half of AC4 — naming each deletion in `ImplementationReport_WP21.md` under the BUILD_SPEC §7 deletion ledger — is a reporting obligation, not a code property, and is not unit-testable.
- Test data channel: source scan

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC of C21 needed INTEGRATION_SCOPE. AC1 and AC3 are observable at
the `CanvasSync` capture seam with in-memory vault, IO and sync-manager fakes; AC2 is
observable at the `CanvasPresence` / `sync.ts` module surfaces plus a file digest; AC4's
mechanical half is a static scan and its enumeration half is a reporting obligation under
the BUILD_SPEC §7 deletion ledger. Nothing was deferred to Worker 4.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `CanvasSync` carried two injected, default-allow lock predicates (`canWriteNode`/`canDeleteNode`) consulted through one private `canWriteEntity` helper at three `applyIntentPlan` branches (node upsert, node delete, edge delete). A refusal pushed the id onto `AppliedIntent.denied`, which suppressed the `lastWrittenContent` advance and emitted `LOCK DENIED: … (baseline held)`. `main.ts` injected both predicates from `CanvasPresence` and mirrored them onto `CanvasBinding`. Baseline suite: 15 failures = 8 known pre-existing reds + 7 WP21 reds (TC1×3, TC2×3, TC6×1).
- **Approach:** Delete the gate top-down — `canWriteEntity`, the two fields, the two setters, `AppliedIntent.denied`, the three call sites, the baseline-hold branch (now an unconditional advance) — then the two `main.ts` injections and the two binding-side mirrors. Drop the reads that existed only to feed the gate (`getRecordFields` × 2, the `saved` parameter of `applyIntentPlan`). Then the 8 pre-authorised test deletions plus the dead-only collateral they leave behind. Prove removal by search rather than by `tsc`, and prove the preservation half by mutation (read-only refusal → TC5 red; diff-inferred claim → TC3 red; `revertCanvasNode` → TC1 red).
- **Fallback path if all attempts fail:** n/a — no attempt failed. The one unresolved item is a licensing conflict, not an implementation failure, and is escalated rather than worked around.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** All four ACs. TC1, TC2 turned green; TC3, TC4, TC5 stayed green (`canvas-presence.ts` byte-identical, no digest regenerated); TC6 green after Worker 3 Core's polarity correction. All 8 authorised test deletions made and enumerated in the deletion ledger. `npx tsc --noEmit` PASS, `npm run build` PASS. Suite 15 → 8 failures — exactly the 8 known pre-existing legacy V1 delete-oracle reds. Test count 1300 (−8 overall = the 8 deletions; the TC6 predicate refinement moved it by 0).
- **What remains open:** Nothing for WP21. Two escalations were raised and both are resolved: (a) TC6's substring scan produced a false positive on `canvas-sync.test.ts:791`'s `LOCK DENIED:` **absence** assertion — Worker 3 Core ruled the defect was TC6's, corrected the predicate to read assertion POLARITY (fail-closed, no filename allow-list, paren-balanced assertion units), and the protected line stayed byte-untouched; blind1 took the same correction, blind2 needed none (reachability oracle, structurally immune). (b) The authorisation table wrongly predicted that `w4-canvas-integrity.test.ts:1215`'s `describe` would become empty — G2–G5 and `lockFixture()` remain, so only G1 was deleted and the block, helper and title were left intact. Both are recorded in the implementation report under `## Corrections to Worker 3 Core's authorisation table`. Downstream: WP23's convergence fuzzer still owes the "removing the write gate does not change convergence" demonstration (charter §2), and `v2/wp19/test_tp02_*_visible.test.ts:5` carries a comment-only reference to the removed gate, left as-is per ruling and logged as a documentation residual for Worker 4.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
