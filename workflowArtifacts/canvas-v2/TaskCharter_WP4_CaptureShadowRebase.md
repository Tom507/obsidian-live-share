# Task Charter — WP4: Capture re-based on the shadow

**Charter Status:** `DONE`
**WP:** WP4
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP1, WP2, WP3
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the Symptom-2 cascade cannot start — a stale save produces no outbound delta.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C4 — Capture path re-based on the shadow** (work package WP4); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/files/canvas-sync.ts`: `handleLocalModify` `:496–619`, baseline reads `:520–521`, echo breaker `:526–538`, `applyLocalDiffToYMaps` `:620–704`, `noteExternalDiskWrite` `:856–879`)
  - Responsibility: replace `lastWrittenContent` as the diff basis with the Surface-Shadow, make the echo breaker byte-based, and advance the shadow for the closed-view surface.
  - Scope summary: replace the `lastWrittenContent` diff basis; byte echo breaker
- **Out of scope / non-goals:**
  - Removing `lastWrittenContent` entirely — it may remain as an echo/telemetry aid; only its role as the *intent basis* is removed.
  - The lock write-denial seam (`canWriteEntity`) — that is WP21.
  - Reconcile-side shadow advancement — that is WP5.
  - <!-- Updated: escalation resolution 2026-07-31 --> Removing `PROTECTED_KEYS` or the `applyToYMap` delete guard — the guard is still live on the host-seed and cold-open boundaries and is retired by WP18. Changing its membership or its export is an ESCALATE (§3.1 S2).
  - <!-- Updated: escalation resolution 2026-07-31 --> Providing any replacement mechanism for clearing an optional field (`color` / `label`) — that capability is deliberately absent from P0 (§3.1 S14) and is owned by WP39 AC5.
- **Known interfaces / dependencies:**
  - Input: a vault `modify` event for an owned, unmuted `.canvas` path
  - Output: CRDT upserts and delete intents derived from the intent plan only
  - Depends on work packages: WP1, WP2, WP3
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 stale-save simulation + shadow-consistency assertion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Capture path re-based on the shadow
- **Interfaces involved:**
  - Input: a vault `modify` event for an owned, unmuted `.canvas` path
  - Output: CRDT upserts and delete intents derived from the intent plan only
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
  - **Schema impact:** No `meta.schemaVersion` change and no `.canvas` file-format change. P0 is a pure logic change in the capture and serialisation paths, which is exactly why it ships first (CONCEPT_V2 Teil 13). Mixed-version behaviour: a P0 client and a pre-P0 client interoperate unchanged at the doc level.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/files/canvas-sync.ts:496–619` — `handleLocalModify` (guards `:498`, `:499`, `:502`; read `:511`; parse `:512`)
  - `plugin/src/files/canvas-sync.ts:520–521` — the baseline read and three-way base construction (the exact seam being replaced)
  - `plugin/src/files/canvas-sync.ts:526–538` — the semantic echo breaker
  - `plugin/src/files/canvas-sync.ts:620–704` — `applyLocalDiffToYMaps`
  - `plugin/src/files/canvas-sync.ts:856–879` — `noteExternalDiskWrite`
  - `plugin/src/files/canvas-sync.ts:251` — `lastWrittenContent` and its writers `:400`, `:535`, `:579`, `:858`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

<!-- Updated: AC5/AC6 appended — WP4 structurally lands I7 for the capture path, so it must also license and replace the probes that pinned the old behaviour 2026-07-31 -->

*Exact copy from BUILD_SPEC section 5, component C4. No paraphrasing.*

1. The three-way diff against `lastWrittenContent` no longer decides what is written to the CRDT; the intent plan from C2 does. `lastWrittenContent` may remain only as an echo/telemetry aid and must not be read as the intent basis at `:520–521`.
2. A save that is byte-identical to the last written content is recognised as an echo and produces zero CRDT writes.
3. When the view is closed, the content of the last persistence write advances the shadow, so a subsequent Obsidian save of that path yields no intent.
4. A save that is stale for a peer's field (the field equals the shadow while the CRDT has moved on) produces **zero** writes for that field, and the discarded staleness is observable in the debug log under a dedicated signature.
5. The three pre-existing probes that pin deletion-by-key-omission on this path — `A4`, `A9` and `A10` in `plugin/src/__tests__/w4-canvas-integrity.test.ts` — are deleted deliberately and enumerated by name in the implementation report against the §7 deletion-ledger entry. No surviving test is weakened, skipped, `.only`'d or relaxed to make the suite green, and no test is left asserting a behaviour that no longer exists.
6. The discrimination coverage those probes provided is **relocated, not dropped**: `PROTECTED_KEYS` keeps its membership and its export and is not removed by this WP, because it still guards the seed boundaries (`applyToYMap`) until WP18. An equivalent discrimination pair asserts, at a boundary where the guard is still live, that disarming it for `fromNode` / `toNode` loses the endpoint while the intact guard preserves it — so the guard stays falsifiable for the rest of the initiative.

**Definition of Done:** the Symptom-2 cascade cannot start — a stale save produces no outbound delta.

**Amendment note (2026-07-31) — resolution of the WP4 escalation.** AC1–AC4 are unchanged and were already met; AC5 and AC6 are appended, not substituted. The escalation asked whether the removal of field-deletion-by-key-omission belongs in P0 or P1. It belongs in **P0**, for this WP, because it is not a separate step: AC1 routes every capture write through the C2 intent plan and that plan has no field-removal category, so the removal is a consequence of AC1 rather than an addition to it. CONCEPT_V2 Teil 5 states the same rule and already annotates it "(I7)". The BUILD_SPEC's §4.6 traceability row was the error and has been corrected; WP2's chartered contract is **not** reopened. Practical consequences for this WP:

- The three probes are now licensed for deletion (AC5). Delete them; do not rewrite, skip or weaken them. Enumerate them by name in `ImplementationReport_WP4.md`.
- `PROTECTED_KEYS` stays (AC6). It is dead on `handleLocalModify` but still live on the two seed paths, and it is WP18's job to retire it there — removing it here would be out of scope and would trip the §3.1 S2 escalation rule.
- Nothing else about WP4 changes: no production behaviour change is required by this amendment, no `.canvas` format change, no doc-schema change. P0 remains the pure logic change CONCEPT_V2 Teil 13 requires.
- The user-visible cost of A4's retirement (clearing `color` / `label` via an Obsidian save no longer propagates) is **accepted and recorded** as BUILD_SPEC §3.1 S14, owned by WP39 AC5. It is not to be re-litigated inside P0, and it must not be "fixed" by reintroducing key-absence semantics.

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
- **Required report:** `ImplementationReport_WP4.md` (in `workflowArtifacts/canvas-v2/`) — <!-- Updated: escalation resolution 2026-07-31 --> must now also carry the deletion-ledger entry required by AC5: `A4`, `A9`, `A10` named individually with the one-line reason each, and the AC6 replacement probes named against the coverage they restore.
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Seven integration-with-injected-seams suites (27 cases). They drive the REAL
`CanvasSync` over a doubled vault + sync manager and REAL `Y.Doc` replicas — the same
composition `w4-canvas-integrity.test.ts` and `canvas-persistence.test.ts` already use for
this seam. The two-peer/canvas-double harness under `src/__tests__/harness/` is deliberately
NOT used: it wires `CanvasBinding`, which stays frozen and flag-off until WP39/WP40, so a
green run there would say nothing about `handleLocalModify`.

No wall-clock sleep, no `setTimeout` wait and no timing constant appears anywhere. The one
real timer in the path (the `VAULT_EVENT_SETTLE_MS` window `noteExternalDiskWrite` opens) is
flushed with `vi.useFakeTimers()` + `await vi.runOnlyPendingTimersAsync()`, which names no
duration at all.

Run from `plugin/`: `npx vitest run src/__tests__/v2/wp4` (or the full `npm test`).

### TC1 — The intent plan, not `lastWrittenContent`, is the write basis

- Verifies AC: 1
- Test file: plugin/src/__tests__/v2/wp4/test_tp01_intent_basis_visible.test.ts
- What it checks: in a state where the two candidate bases give OPPOSITE verdicts (an
  open-view persistence write advances the baseline but not the shadow), the save the
  three-way diff calls a change is discarded as staleness and produces zero CRDT writes,
  while a genuine change in the same save still lands, a record missing from the save is not
  deleted with the view closed but IS deleted with an open view plus a hand-over receipt, and
  a captured local edit advances the shadow it was diffed against.
- Test data channel: fixture

### TC2 — Byte equality is the echo breaker

- Verifies AC: 2
- Test file: plugin/src/__tests__/v2/wp4/test_tp02_byte_echo_visible.test.ts
- What it checks: a save byte-identical to the last written content produces zero CRDT
  writes and one no-op debug line, does not advance the shadow (bytes on disk are not a
  receipt for an open view), does not swallow a one-field change, and does not fire for the
  same values in a different key order — which then still yields zero writes through the
  intent diff, proving the two mechanisms are separate and both hold.
- Test data channel: fixture

### TC3 — The closed-view persistence write advances the shadow

- Verifies AC: 3
- Test file: plugin/src/__tests__/v2/wp4/test_tp03_closed_view_shadow_advance_visible.test.ts
- What it checks: with the view closed, `noteExternalDiskWrite` advances every field of the
  written content in the shadow and a later Obsidian save of those values (different bytes)
  yields no intent; with the view open the same call advances nothing; the host seed is the
  same class of receipt, so the first save after a subscribe cannot replay the file as
  intent; and the advance is scoped to its own path.
- Test data channel: fixture

### TC4 — Zero writes for a stale field, under the `SHADOW STALE:` signature

- Verifies AC: 4
- Test file: plugin/src/__tests__/v2/wp4/test_tp04_shadow_stale_signature_visible.test.ts
- What it checks: the stale field is not written while a real change in the same record is
  (state first, log second); exactly one `SHADOW STALE:` debug line names the divergent
  `kind/id.field`; no divergence produces no line at all; edges are named in their own id
  space; and the line carries no user data.
- Test data channel: fixture

### TC5 — The Symptom-2 cascade cannot start (three peers)

- Verifies AC: 4 (Definition of Done)
- Test file: plugin/src/__tests__/v2/wp4/test_tp05_cascade_cannot_start_visible.test.ts
- What it checks: the outbound delta itself (`Y.encodeStateAsUpdate(doc, svBefore)` replayed
  on a replica that already holds the peer's value) carries no write for the stale field but
  does carry the genuine one; a three-way interleaving converges with nothing reverted; and
  repeated stale saves never accumulate.
- Test data channel: deterministic generator (three `Y.Doc` replicas exchanged explicitly)

### TC6 — Discrimination: the shadow rebase does the work

- Verifies AC: 1, 4 (BUILD_SPEC §8 discrimination requirement)
- Test file: plugin/src/__tests__/v2/wp4/test_tp06_discrimination_seam_visible.test.ts
- What it checks: one scenario, two runs, one difference — with `setShadowRebaseEnabled(false)`
  the identical fixture reproduces the cascade (the stale value reaches both peers), and with
  the default it does not; the two outcomes are compared directly so a change that quietly
  neutralises the seam breaks a test.
- Test data channel: deterministic generator (parameterised scenario function)

### TC7 — Geometry is rounded on the capture side, before the intent diff

- Verifies AC: 1 (capture-side normalisation feeding the intent plan — BUILD_SPEC §4.4 and
  C3 AC3, whose helper `roundCanvasGeometry` has had no caller since WP3)
- Test file: plugin/src/__tests__/v2/wp4/test_tp07_capture_geometry_rounding_visible.test.ts
- What it checks: a fractional drag reaches the CRDT as whole pixels and advances the shadow
  to the rounded value; sub-pixel noise against the shadow is discarded rather than pushed,
  so it cannot revert a peer; only the four geometry keys are rounded and `-0` normalises to
  `0`; whole pixels round-trip with zero CRDT writes.
- Test data channel: fixture

### Required API and seams (defined by the visible tests)

All of this is added to **`plugin/src/files/canvas-sync.ts`**. No new file, no new dependency,
no `.canvas` format change and no doc-schema change. `canvas-shadow.ts` and
`canvas-canonical.ts` are consumed as they are — WP4 adds no export to either.

**1. How the shadow reaches `CanvasSync`**

| Member | Semantics |
|---|---|
| `private shadow: SurfaceShadow = createSurfaceShadow()` | Constructed with the instance, so the capture path always has one. |
| `getSurfaceShadow(): SurfaceShadow` | The live instance (not a copy). The tests' primary state oracle; WP5 reads it to advance confirmed applies. |
| `setSurfaceShadow(shadow: SurfaceShadow): void` | Replaces the instance so reconcile and capture provably share ONE structure (C5 AC1 — "there is no second, parallel shadow"). Not exercised by the visible tests; required for WP5's wiring. |

**2. The two injected seams `planIntentDiff` needs**

| Member | Default | Semantics |
|---|---|---|
| `setSurfaceStateProvider(provider: (path: string) => SurfaceState): void` | `() => ({ viewOpen: false, handedToView: { node: new Set(), edge: new Set() } })` | Per canonical path: is the view open, and which ids did the last apply hand to it. P0's honest default is "closed" until WP5 wires the real view state. Consulted at every `handleLocalModify` AND at every `noteExternalDiskWrite`. |
| `setTombstoneView(view: TombstoneView): void` | `{ isDeleted: () => false }` | The resurrect-block seam. P0 has no `deleted` container (WP12 creates it), so the default must be "nothing is tombstoned". |

**3. `handleLocalModify(rawPath)` — the new order of operations**

1. Existing guards unchanged (`recentDiskWrites`, `subscribedPaths`, `canWrite`, doc handle,
   file lookup).
2. Read `content`. **Byte echo breaker (AC2):** if `content === lastWrittenContent.get(path)`,
   log one debug line and return. Zero CRDT writes, and **no shadow mutation** — the bytes
   prove what the DISK holds, never what an open view holds. The message must keep the
   substring `no-op (disk == shared state)`: two existing suites
   (`canvas-persistence.test.ts:671`, `w4-canvas-integrity.test.ts:707`) pin it, and the gate
   is 0 failures. The semantic `canvasRecordsEqual` comparison at `:526-538` is REMOVED — this
   replaces it (D9).
3. `parseCanvas(content)`, then apply `roundCanvasGeometry` to every node and edge record
   **before** anything else looks at them (BUILD_SPEC §4.4: rounding can never appear as
   intent). Build the `ParsedSave` from the rounded records.
4. `planIntentDiff(this.shadow, save, tombstones, surfaceStateProvider(path))`. **The baseline
   read at `:520-521` is deleted.** `lastWrittenContent` survives only as the echo/telemetry
   aid of step 2 (AC1).
5. Apply the plan inside the existing single `doc.transact(...)`:
   - **upsert** — create the record's `Y.Map` on first upsert for an id absent from the doc
     (all its upserts in the same transaction), otherwise `ymap.set(field, value)` only when
     the current value differs. **Never** delete a field because the save omitted it (I7).
   - **delete** — `ymap.delete(id)`, then the existing GAP-5 edge cascade for deleted nodes.
   - The existing lock seam stays exactly as it is (`canWriteEntity` / `canDeleteNode`,
     `deniedIds`, the `LOCK DENIED:` warn, the baseline hold). Removing it is WP21, not WP4.
6. Advance the shadow for what actually happened: every applied upsert →
   `advanceField(path, kind, id, field, value)`; every applied delete →
   `markRecordAbsent(...)`. A denied id advances nothing.
7. **`SHADOW STALE:` (AC4)** — one `logger.debug("canvas-sync", …)` line per pass that has at
   least one **divergent** discard, i.e. a `DiscardedStaleness` whose field currently differs
   in the CRDT (`ymap.get(field) !== entry.value`). Those are the fields that would have been
   reverted before V2. A save re-states every unchanged field and C2 discards all of them;
   logging those too would bury the one line that matters, so non-divergent discards are
   silent. Format — ids and field NAMES only, never a value:

   ```text
   SHADOW STALE: <path> <n> field(s) not pushed: <kind>/<id>.<field>, <kind>/<id>.<field>
   ```

   This is the §10 "new signature, owner WP4" entry and must have exactly one emitter.
8. The existing local-modify telemetry stays.

**4. `noteExternalDiskWrite(rawPath, content)` — the closed-view receipt (AC3)**

Keeps both current jobs (advance `lastWrittenContent`, open the settle window) and gains a
third, gated on `surfaceStateProvider(path).viewOpen === false`:

- parse `content`, and for every record `advanceRecord(shadow, path, kind, id, fields)`;
- every record the shadow currently holds as `present` for that path and that the content
  does **not** contain → `markRecordAbsent(...)`. With the view closed the file IS the
  surface, so what the writer left out is known-absent, not merely unobserved.

With `viewOpen === true` the shadow is not touched at all: an open Obsidian canvas ignores
external file writes, so only a confirmed apply is a receipt — and that is WP5's mechanism.

**5. The host seed (`subscribe`, `:405-414`) is the same class of receipt**

Alongside `lastWrittenContent.set(path, content)`, the seeded records advance the shadow
(unconditionally — this client just pushed that exact file into the doc). Without it the
shadow is empty right after a subscribe and the first Obsidian save replays the whole file as
intent, which is precisely the window the cascade could start in.

**6. The discrimination seam (BUILD_SPEC §8 — mandatory)**

| Member | Default | Semantics |
|---|---|---|
| `setShadowRebaseEnabled(enabled: boolean): void` | `true` | `false` disables the mechanism at its seam: the parsed save is no longer classified against the shadow — every observed field is treated as intent and written, and nothing is discarded (so no `SHADOW STALE:` line exists). Everything else is unchanged: the byte echo breaker still runs, geometry is still rounded, and the shadow still advances. Test-only; no production caller. |

**7. Types and paths**

`SurfaceShadow`, `SurfaceState`, `TombstoneView`, `ParsedSave`, `ParsedSaveRecord`,
`IntentPlan`, `advanceField`, `advanceRecord`, `markRecordAbsent`, `createSurfaceShadow`,
`planIntentDiff` are imported from `../canvas/canvas-shadow`; `roundCanvasGeometry` from
`../canvas/canvas-canonical`. Every shadow key is the CANONICAL path
(`toCanonicalPath(normalizePath(rawPath))`), matching every other registry in this class.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

None. All four acceptance criteria are verified at the integration-with-injected-seams level
against the real `CanvasSync`, the real `canvas-shadow` core and real `Y.Doc` replicas. The
two facts a runtime environment would add — that `viewOpen` really tracks an Obsidian canvas
view, and that a real `CanvasPersistence` write really reaches `noteExternalDiskWrite` — are
injected here as seams and are owned by other charters: the view state by WP5 (C5) and the
live two-vault run by WP7 (C7). Nothing in WP4 remains that needs a running system.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `handleLocalModify` read `lastWrittenContent` as the three-way base
  (`:520–521`), broke echoes with a SEMANTIC record compare against the CRDT (`:526–538`), and pushed
  the diff through `applyLocalDiffToYMaps` / `applyKeyDiff` — which also DELETED any key the save
  omitted, guarded only by `PROTECTED_KEYS`. `roundCanvasGeometry` (WP3) had no caller.
  `noteExternalDiskWrite` advanced only the baseline and the settle window.
- **Approach:** implemented section 7 literally. `CanvasSync` owns a `SurfaceShadow`; the byte echo
  breaker returns before any parse; the save is geometry-rounded into a `ParsedSave` and classified by
  `planIntentDiff`; the plan is applied per record inside the existing single transaction with the
  lock seam untouched; applied upserts/deletes advance the shadow; divergent discards emit one
  `SHADOW STALE:` line. `noteExternalDiskWrite` and the host seed became shadow receipts, the former
  gated on `viewOpen === false`. `setShadowRebaseEnabled(false)` swaps the classification for
  observation-as-intent and nothing else.
- **Fallback path if all attempts fail:** not needed — no attempt failed. The one unresolved item was a
  pre-existing-test conflict, not an implementation fallback; it is now closed by the AC5/AC6 rework
  (see section 9).

**Phase 7 re-entry (charter amendment of 2026-07-31) — AC5 / AC6.** Test layer + report only; AC1–AC4
and every production file are untouched.

- **AC5:** deleted exactly three `it(...)` blocks from `plugin/src/__tests__/w4-canvas-integrity.test.ts`
  — `A4` (asserts a save omitting `color`/`label` deletes the field; forbidden by I7, accepted
  regression BUILD_SPEC §3.1 S14, owned by WP39 AC5), `A9` and `A10` (unfalsifiable: they disarm
  `PROTECTED_KEYS` and expect `handleLocalModify` to lose `fromNode`/`toNode`, but that path no longer
  reads the guard, so they can never go red). A retirement comment with the reason replaces each site.
  No other test was touched.
- **AC6:** added `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts`
  — a two-test discrimination pair at the still-LIVE host-seed boundary
  (`subscribe(path,"host")` → `applyCanvasToYMaps` → `applyToYMap`). One scenario, two runs, one
  difference; both outcomes asserted and compared directly; `PROTECTED_KEYS` restored in a `finally`.
  Falsifiability verified by hand: neutralising the disarm turns both halves RED. `PROTECTED_KEYS`
  keeps its membership and its export — retiring it is WP18, not WP4 (§3.1 S2).

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1–AC6 and the Definition of Done. All 29 visible tests pass
  (`src/__tests__/v2/wp4` — 8 files, was 27 in 7 files before the AC6 pair),
  `tsc -noEmit -skipLibCheck` is clean, `npm run build` PASSES, and the FULL plugin suite is
  **81 files / 926 tests — 926 passed, 0 failed** (previously 80 / 927 with 3 failures, those being
  exactly A4/A9/A10). `plugin/src/files/canvas-sync.ts` is still the only production file changed in
  the whole WP. Full report incl. the §7 deletion ledger: `ImplementationReport_WP4.md`.
- **What remains open:** nothing in WP4's scope. Two items are handed on by design, not as defects:
  with `surfaceStateProvider` defaulting to `viewOpen: false`, the capture path emits no record
  deletes in production until WP5 wires the real view state (documented P0 posture); and the accepted
  user-visible regression from A4's retirement (clearing `color`/`label` via an Obsidian save no
  longer propagates) is BUILD_SPEC §3.1 S14, owned by WP39 AC5 in P5 — it must not be "fixed" inside
  P0 by reintroducing key-absence semantics. `PROTECTED_KEYS` stays and is retired by WP18.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
