# Task Charter — WP63: Non-destructive seed boundary (I11)

**Charter Status:** `DONE`
**WP:** WP63
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP18
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

> **WP63 does NOT block WP19–WP23.** It depends on WP18 and must be DONE before P1 closes, but nothing in the tombstone wiring, the quarantine auditor, the two removals or the fuzzer needs it in place first. Do not serialise the P1 queue behind it.

---

## 1. Task Objective

- **Outcome:** no ingest refusal — present or future, correct or mistaken — can delete data from a `.canvas` file the user did not create with this plugin.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C63 — Non-destructive seed boundary (I11)** (work package WP63); phase **P1**. Invariant **I11** is defined in §4.5 and traced in §4.6.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`CanvasPersistence` write path; the refusal branches of the two seed boundaries)
  - Responsibility: decouple "not admitted to the doc" from "removed from the file" at the one boundary where the input is the user's only copy.
  - Scope summary: a seed refusal withholds the file write for that path instead of silently dropping the record from the next projection.
- **Out of scope / non-goals:**
  - **The refusal itself.** WP18 AC1 stands; the seed remains a local source and invalid records are still refused with a signature. This WP does not admit them, does not relax WP14, and does not move the boundary.
  - **Quarantine.** That is WP20, it operates on records already in the doc, and it is explicitly **not** a file-safety mechanism — a quarantined record is never serialised and therefore also leaves the file.
  - **The endpoint and text-payload model corrections** (WP10 AC5 / WP14 amendment). Those reduce how often this net is needed; they are not this WP's job and this WP must not assume they landed.
  - Repairing, normalising or rewriting the user's file in any way. The file is left **byte-identical**, never "fixed".
- **Known interfaces / dependencies:**
  - Input: the refusal signatures already produced by WP18 AC1 at the two seed boundaries (host seed, cold-open seed), keyed by canvas path
  - Output: a withheld file write plus a signature, instead of a write that drops the refused records
  - Depends on work packages: WP18
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 — a fault-injection op that seeds a replica from a file containing a record invalid under the current rules must leave that file unchanged.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** the CRDT→disk write path and the two seed refusal branches.
- **Interfaces involved:**
  - Input: per-path set of refused record ids with their reasons
  - Output: withheld write + `SEED REFUSED:` signature; lift + `SEED RESTORED:` signature
- **The defect this closes, stated precisely.** Every step in the loss path was individually correct and individually chartered:
  1. WP18 AC1 refuses an invalid local record at the seed — correct, and deliberately so.
  2. The refused record therefore never enters `nodesMap`/`edgesMap`.
  3. The serializer is a **pure projection** of those containers — there is no "drop invalid" pass; a record is absent because its id is not a key.
  4. `CanvasPersistence` is the single writer (I3) and writes that projection over the file.

  Composition: **the user's record is silently and permanently deleted from their own file.** No AC owned step 3→4 as a hazard, which is exactly why it survived review and landed on a path that touches real user vaults. I11 names the missing constraint so the composition becomes testable instead of merely reasoned about.
- **Where the seam belongs.** The condition is a property of *the path*, not of any one record, and the only place that knows both the refusal set and the impending write is the writer. Put the guard in the write path, keyed on the path having a non-empty refused set. Do **not** implement it by re-injecting refused records into the projection: that would make the file stop being a deterministic projection of the doc (C17 DoD) and would break cross-replica byte equality (C17 AC3), since only one replica ever saw those records.
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`), I6–I10 (CONCEPT_V2 Teil 3) and **I11** (§4.5) are binding and must not be weakened.
  - **I5 DEGRADE governs the shape of this feature**: degrade, never break. A withheld write is a degraded persistence state for one path, never an exception, never a silent no-op, and never a reason to tear down the session.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits **zero** CRDT writes — this WP must not make it write to the doc; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported. Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If this WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40.
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - **Schema impact:** none. Neither the doc format nor the `.canvas` file format changes. This WP changes *whether* a write happens, never *what* a write contains.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C63. No paraphrasing.*

1. When any record read from a `.canvas` file is refused at a seed boundary (host seed or cold-open seed), `CanvasPersistence` **withholds the file write for that path** and the file on disk stays **byte-identical**. A `SEED REFUSED:` signature names the path, each refused id and its reason.
2. The withhold is **per path and non-fatal** (I5 DEGRADE): other canvases persist normally, and the affected canvas continues to sync, render and receive remote deltas — only its write-back is suspended. It is never a silent no-op and never an exception that breaks the session.
3. The withhold lifts automatically when the refused set for that path becomes empty — because a later delta or a user repair made every previously-refused record valid — and the first write after lifting is the ordinary canonical projection. Lifting emits a distinct signature.
4. **Discrimination:** with the withhold seam disarmed, a seed refusal followed by a flush removes the record from the file; with it armed, the file is byte-identical. This is the test that would have caught the E1 loss, and it must fail when the mechanism is disabled.

**Definition of Done:** no refusal, present or future, correct or mistaken, can delete data from a file the user did not create with this plugin.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known risks specific to this WP:**
  - **The obvious wrong fix is to admit the record anyway.** That silently reverses WP18 AC1 and lets invalid records into shared state, where they propagate to every peer. AC1 stands; this WP withholds a *write*, it does not widen an *ingest*.
  - **The second wrong fix is to re-inject refused records into the serialized output.** That breaks C17 AC3 (cross-replica byte equality) and C17's Definition of Done, because only one replica ever held them.
  - **A withhold that is never lifted is a bug, not a safe default.** AC3 is as load-bearing as AC1: a canvas stuck in withheld state stops persisting the user's real edits, which is its own data-loss class arriving from the other direction. The lift condition must be checked on the same trigger as the write, not on a timer.
  - **Do not confuse "no records refused" with "the file is fine".** The withhold predicate is about *this session's refusals for this path*, and must be reset when the path's doc is re-seeded or the persistence instance is rebuilt.
  - **AC4 must fail for the right reason.** A discrimination test that passes because the flush never happened proves nothing — drive an actual write and compare file bytes before and after.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Do not assert on log strings as the primary oracle; **file bytes are the oracle here**, signatures are the secondary check AC1 names by hand.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:** as listed in section 3 — I1–I11 binding, `CanvasPersistence` emits zero CRDT writes, zero new runtime dependencies, `canvas-presence.ts` untouched, `main.ts` wiring only, no version bump, `server/` off limits.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/canvas-persistence.ts`
  - `plugin/src/files/canvas-sync.ts`
- **Required report:** `ImplementationReport_WP63.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

*Empty at handover — filled by Worker 3's Test Generator Sub-Agent.*

> **Note for the test generator.** AC4 is the reason this WP exists and is not an ordinary discrimination test: it is the regression pin for a **silent data-loss defect that reached a live path**. Its oracle must be **file bytes before vs. after a real flush**, never a signature, never a doc-state assertion, and never "the write was not called". The armed run and the disarmed run must differ in exactly one thing — the seam — and the disarmed run must be shown to actually lose the record, otherwise the test proves nothing.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC in this WP requires a running two-instance rig, a UI surface or a live relay: every boundary is reachable through injected seams (`PersistenceIO`, the vault/sync-manager doubles).

> **However** — the §7 data-safety gate applies with unusual force to this WP. If any real-Obsidian run is performed while it is in flight, the before/after vault fingerprint of C47 AC3 is the check that matters most here, because this WP is the one that exists to keep that fingerprint unchanged.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent)

1. **Baseline first.** Full `npm test -- --reporter=dot` from `plugin/` before touching anything, and the failing test names captured to a file — the only way a GREEN → RED regression is provable rather than argued.
2. **Make the refusal available as data.** `IngestAdmission` gains `reason`, so the withhold reads the reason code instead of re-parsing the human signature. One definition of the fact, two renderings.
3. **Give the refused set a home per path.** `SeedRefusalLedger` in `canvas-sync.ts` — `note` / `reset` / `hasRefusals` / `list` / `describe` / `prune`. Per path because AC2 is per path; per session because §5 says the predicate is about *this* session's refusals.
4. **Fill it at both seed boundaries.** `seedRecordsIntoYMaps` gains an optional `refusalsOut`; `CanvasSync.seedFlatSpace` returns its refusals and `applyCanvasToYMaps` resets-then-notes the path's ledger. The host seed runs during `subscribe`, i.e. **before** the writer for that path exists — so the ledger is owned by `CanvasSync` and shared with the writer, not the other way round.
5. **Put the guard in the write path.** `CanvasPersistence.flushToDisk` consults `writeIsWithheld()` before `serializeCanvas`. Ahead of the serializer on purpose: `lastQueuedContent` must not advance past a snapshot that never reached disk, or the first write after the lift would be deduplicated away.
6. **Bind the lift to the write trigger.** Every write attempt first prunes refusals that the doc now satisfies (`isSeedRefusalResolved`, which re-asks the *same gate* with an empty proposal). Empty set → `SEED RESTORED:` → the write proceeds as the ordinary projection. No timer, no timing constant, no new dependency.
7. **Ship the seam armed.** `withholdOnSeedRefusal` defaults to `true`; `false` restores the pre-WP63 composition exactly, for AC4 and nothing else.
8. **Wire it in `main.ts`** — one option, no logic.
9. **Write the probes with file bytes as the oracle**, on both boundaries, and prove the disarmed leg actually loses the record.
10. **Verify:** `tsc --noEmit`, `npm run build`, two paired full-suite runs diffed against the captured baseline, plus a source-level falsification (guard forced to `return false`).

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

**Outcome: all four ACs DONE.** A seed refusal now withholds the write-back for that path instead of deleting the record from the user's file. WP18 AC1 is unchanged — nothing new is admitted — and nothing is re-injected into the projection, so C17 AC3 (cross-replica byte equality) and "the file is a deterministic projection of the doc" both stand.

- **Files changed:** `plugin/src/files/canvas-persistence.ts`, `plugin/src/files/canvas-sync.ts` (both §6 required), `plugin/src/main.ts` (one wiring option, no logic). New tests under `plugin/src/__tests__/v2/wp63/` (`harness.ts` + tp01–tp04). No existing test or fixture was modified, deleted, skipped or `.only`'d.
- **Suite:** before `24 failed | 1235 passed (1259)` → after `24 failed | 1247 passed (1271)`, with an **identical failure set** (diff empty across two paired runs). No GREEN → RED. `tsc --noEmit` clean, `npm run build` PASS.
- **AC4 bites (bytes, cold-open leg):** disarmed `182 → 154` bytes and `n-bad` gone from the file; armed `182 → 182`, byte-identical, `n-bad` present. Same result on the host `doc-wins` composition. Forcing the guard to `return false` at the source fails 9 of the 12 probes; the 3 survivors are the no-refusal controls, which must be insensitive to it.
- **Reset:** the ledger is reset at the start of every re-seed of the path (cold-open seed and host seed alike), and a rebuilt `CanvasPersistence` with no shared ledger starts empty by construction. `unsubscribe`/`destroy` release the shared *reference* but never `reset()` it — un-withholding a still-live writer from the teardown path would let through exactly the write this WP exists to stop.
- **Lift:** checked on the same trigger as the write, on every write attempt, never on a timer.
- **Known residual (flagged, not solved):** the lift condition is the charter's — "the refused record is now valid in the doc". If the user deletes the refused record from the file outright mid-session, nothing can make it valid, and the path stays withheld until it is re-seeded. Resolving that case would require the writer to read the file back outside cold open, which the single-writer design forbids; it is reported rather than designed around.
- **Constraints:** all satisfied. `GEOMETRY_KEYS` / `PROTECTED_KEYS` untouched and still exported, `canvas-presence.ts` / `canvas-binding.ts` / `canvas-model-bridge.ts` untouched, `useCanvasBinding` still `false`, zero new runtime dependencies, no new `setTimeout` or timing constant, no wall-clock sleep in any new test, no version bump, `CanvasPersistence` still emits zero CRDT writes, `coldOpen` still runs after `waitForSync` and before `start()`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
