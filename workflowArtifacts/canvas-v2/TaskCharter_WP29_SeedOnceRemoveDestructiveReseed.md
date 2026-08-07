# Task Charter — WP29: Seed-once + REMOVAL of destructive re-seed

**Charter Status:** `DONE`
**WP:** WP29
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP25, WP27
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** R4 is eliminated; destruction is only ever an explicit user action.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C29 — Seed-once-per-lifetime and REMOVAL of the destructive host re-seed** (work package WP29); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`CanvasPersistence.coldOpen` `:310–327`) + delete (`CanvasSync.applyCanvasToYMaps` `:776–813` destructive semantics, the R4 path)
  - Responsibility: enforce I9 — a doc is seeded from a file exactly once in its life — and stop a returning host from discarding peer work.
  - Scope summary: I9 seeding rule; R4 eliminated
- **Out of scope / non-goals:**
  - The explicit import command — WP30.
  - Changing `ColdOpenResult`'s observable outcomes or the `coldOpen` ordering contract.
  - `CanvasSync.writeToDisk` and its `remoteSeq` gate, which remain retained-with-no-caller.
- **Known interfaces / dependencies:**
  - Input: doc state, sidecar presence, peer availability
  - Output: a seed decision
  - Depends on work packages: WP25, WP27
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "host rejoin" op — a replica that rejoins carrying an older local file must not remove any record held by the other replicas.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Seed-once-per-lifetime and REMOVAL of the destructive host re-seed
- **Interfaces involved:**
  - Input: doc state, sidecar presence, peer availability
  - Output: a seed decision
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
  - **Schema impact:** No `schemaVersion` bump. Adds `meta.guid`, `meta.epoch` and `meta.path`, the sidecar files, and changes the doc-id namespace from path-based to guid-based. Mixed-version rule: a client that cannot resolve a guid for a path treats the doc as unknown and asks peers or the manifest — it never seeds a second doc for the same file.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/files/canvas-persistence.ts:310–327` — `coldOpen` (emptiness test `:312`)
  - `plugin/src/files/canvas-persistence.ts:79–83` — `ColdOpenResult`
  - `plugin/src/files/canvas-sync.ts:776–813` — `applyCanvasToYMaps`, destructive at `:791–793` (the R4 path)
  - `plugin/src/files/canvas-sync.ts:388–401` — the host seed that calls it
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C29. No paraphrasing.*

1. Seeding from file happens only when **neither** a sidecar **nor** any peer knows the doc; in every other case the client loads/merges instead of seeding.
2. The destructive re-seed that deleted doc entries absent from the host's local file no longer exists; a host rejoin is an ordinary related-replica merge.
3. A host rejoining with an older local file does not remove any peer's records.
4. The `ColdOpenResult` outcomes remain observable and the `coldOpen`-after-`waitForSync`-before-`start()` ordering is preserved.

**Definition of Done:** R4 is eliminated; destruction is only ever an explicit user action.

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
  - `plugin/src/files/canvas-persistence.ts`
- **Required report:** `ImplementationReport_WP29.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

### 7.0 — What WP29 must provide, and the three facts the charter above does not know

> **Read this block before writing a line of implementation.** Sections 2 and 3 were
> written against the pre-P0/P1 tree; every `:NNN` in them is stale, and two of the
> statements about `applyCanvasToYMaps` are no longer true of the code.

#### 7.0.1 — THE LICENCE RULE (non-negotiable)

**WP29 has no licence to delete, weaken or amend any test.** BUILD_SPEC §7's
licensed-deletion list is `WP4, WP18, WP21, WP22, WP33`; the licensed-amendment list is
`WP10, WP14, WP18, WP19, WP27, WP46, WP59, WP60, WP61, WP64`; the fixture-completion class
is `WP18` (+ `WP64`). **WP29 is on none of them.**

If a change makes an existing assertion unsatisfiable, do **not** delete it, relax it or
rewrite it. Stop and escalate to Worker 3 Core with file · line · assertion · why. An
unenumerated deletion or assertion rewrite is an abort criterion.

Four pre-existing tests exercise the host-seed path through `subscribe(path, "host")` and
were measured **green** immediately before this section was written
(`13 files · 61 tests · 61 passed`):

| Test | Expectation under WP29 |
|---|---|
| `plugin/src/__tests__/w4-canvas-integrity.test.ts` (`A1`–`A8`, incl. A7 at `:405`) | **stays green.** Its record-level delete is driven by `handleLocalModify` with a proven surface receipt, not by the seed. |
| `v2/wp18/test_tp01_host_seed_rejects_invalid_local_record_visible.test.ts` | **stays green.** WP29 removes the record-level *delete*, not the *validator*. |
| `v2/wp18/test_tp02_cold_open_seed_rejects_invalid_local_record_visible.test.ts` | **stays green.** The cold-open seed's default knowledge is `NOTHING_KNOWS_DOC`, so an un-wired call site behaves exactly as before. |
| `v2/wp18/test_tp06_seed_is_upsert_only_i7_visible.test.ts` | **stays green — this is WP29's own thesis.** A red `tp06` means WP29's implementation is wrong, not that the test is stale. Its fixture mentions every record in the doc, so it never depended on the deletion. |

#### 7.0.2 — THE FACT THAT DECIDES AC2: the destruction is in `seedFlatSpace`

`CanvasSync.applyCanvasToYMaps` is `private`, its body is **four statements**, it has exactly
**one** caller (inside `subscribe`'s `role === "host"` block) and it is named in **no**
executable assertion anywhere in the tree — only in header comments. **Removing the method
by itself retires nothing.**

The record-level delete-by-omission now lives in `CanvasSync.seedFlatSpace`:

```ts
const absentFromFile = new Set(container.keys());
…
for (const id of absentFromFile) {
  container.delete(id);          // ← this is R4
}
```

Deleting the wrapper while leaving that loop satisfies the charter's *words* and none of its
*purpose*. The exported sibling `seedRecordsIntoYMaps` / `seedSpace` (the cold-open seed
writer) already has the correct semantics and never had this loop — **make the host seed
agree with it at the record level.** `TC04` is a direct differential between the two
boundaries and is the test that catches "wrapper deleted, `seedFlatSpace` still destructive".

#### 7.0.3 — Current, verified anchors (locate by name, never by line)

| Symbol | Where it actually is |
|---|---|
| `CanvasPersistence.coldOpen` | `plugin/src/files/canvas-persistence.ts:443` |
| `ColdOpenResult` (3 outcomes) | `canvas-persistence.ts:92–95` |
| `attachCanvasPersistence` | `canvas-persistence.ts:646–656` — construct → `await coldOpen()` → `start()` |
| `CanvasSync.subscribe` | `canvas-sync.ts:2348`; host seed call site `:2445–2468` |
| `CanvasSync.applyCanvasToYMaps` | `canvas-sync.ts:3137` (private, 4 statements) |
| `CanvasSync.seedFlatSpace` | `canvas-sync.ts:3173` — **the R4 loop is `:3202–3204`** |
| `seedRecordsIntoYMaps` / `seedSpace` | `canvas-sync.ts:1580` / `:1594` — record-retaining already |
| `SidecarLifecycle.load` → `SidecarLoadResult` | `canvas-sidecar-lifecycle.ts:126`, `canvas-sidecar.ts:119` |

#### 7.0.4 — THE EXACT API SURFACE WP29 MUST PROVIDE

**(a) New pure core — `plugin/src/files/canvas-seed-decision.ts`.**
Zero imports (precedent: `canvas/reconcile-plan.ts`). This is the module the Shared Ownership
Contract §1 assigns to WP29 and that WP30 imports; nobody re-spells these strings.

```ts
export const SEED_DECISION = {
  SEED_FROM_FILE: "seed-from-file",
  LOAD_OR_MERGE: "load-or-merge",
} as const;
export type SeedDecision = (typeof SEED_DECISION)[keyof typeof SEED_DECISION];

export interface SeedKnowledge {
  /** A sidecar replica for this doc was replayed into it. */
  readonly sidecarKnowsDoc: boolean;
  /** Some peer knows this doc — it is not this client's alone. */
  readonly peerKnowsDoc: boolean;
}

/** The both-false shape. Also the default everywhere `SeedKnowledge` is optional. */
export const NOTHING_KNOWS_DOC: SeedKnowledge;

/** Pure. No state between calls. Does not mutate its argument. Never throws. */
export function decideSeed(knowledge: SeedKnowledge): SeedDecision;
```

`decideSeed` returns `SEED_FROM_FILE` **only** when `sidecarKnowsDoc` and `peerKnowsDoc` are
both **exactly `false`**. Anything else — `true`, `undefined`, `null`, `0`, `""`, a boxed
boolean, a missing field, a missing object — counts as "knows the doc" and yields
`LOAD_OR_MERGE`. **Fail-closed**, because seeding is the destructive direction: a knowledge
probe that cannot answer is not evidence that the board is new. Use `!== false`, never `!x`.

**(b) `CanvasPersistenceOpts` gains one optional field.**

```ts
/** WP29 (I9/AC1). Read on every `coldOpen()`. Default: NOTHING_KNOWS_DOC. */
seedKnowledge?: SeedKnowledge;
```

The default is what keeps every pre-WP29 caller — and every pre-existing test — behaving
exactly as it did. Do not make it required.

**(c) `CanvasPersistence.coldOpen` gains one branch, in this position:**

```
1. doc NON-EMPTY  → migrate + flush → "doc-wins"     (UNCHANGED, and still FIRST)
2. WP29: decideSeed(seedKnowledge) === LOAD_OR_MERGE  → return "empty"
        · the file is NOT read · nothing is written · ZERO transactions on the doc
3. file missing / empty → "empty"                    (UNCHANGED)
4. otherwise → seed + migrate → "seeded-from-file"   (UNCHANGED)
```

Step 2 must sit **after** step 1: a returning client that resumed a sidecar replica arrives
with a non-empty doc and must still overwrite its stale file (WP25 AC4's fourth case).
Step 2 must return `"empty"` and **not** `"doc-wins"` — `doc-wins` flushes, and flushing an
empty projection over a `.canvas` that still holds the user's cards is a second, worse
data-loss class. **No fourth `ColdOpenResult` value may be introduced** (AC4).

**(d) `CanvasSync` gains one public accessor.**

```ts
/** WP29 (AC1): what THIS client learned about the doc during `subscribe`. */
seedKnowledgeFor(rawPath: string): SeedKnowledge;
```

Per-path (a vault has many canvases open through one `CanvasSync`), stable across repeat
calls, and `NOTHING_KNOWS_DOC` for a path that was never subscribed. The two fields are filled
by two measurements that `subscribe` is already positioned to take:

- `sidecarKnowsDoc` ← the `SidecarLoadResult` the sidecar load **already returns and currently
  discards** (`await this.sidecar.load(guid, doc)`): true iff `checkpointApplied === true` **or**
  `historyEntriesApplied > 0`. A `MISSING` degradation is **not** knowledge — reading "a load
  ran" as "the sidecar knows it" would make every board unseedable the moment a lifecycle is
  wired. A frame log with no checkpoint **is** knowledge (that is a sidecar's normal state
  between compactions).
- `peerKnowsDoc` ← true iff this replica **gained state across `waitForSync`** for this doc:
  compare `Y.encodeStateVector(doc)` immediately before `await this.syncManager.waitForSync(docId)`
  with the same immediately after. It must be measured across the sync step, not from
  "the doc is non-empty" (that condition already existed) and not from "foreign clientIDs are
  present" (the sidecar load supplies those too, which would collapse the two conditions).

**(e) The wiring.** `main.ts` passes `seedKnowledge: canvasSync.seedKnowledgeFor(path)` into
`attachCanvasPersistence`. Wiring only — `main.ts` holds no logic and has no test file.

**(f) AC2, restated as the change to make.** Remove the record-level delete-by-omission from
`seedFlatSpace`. Keep the validator, keep create-once, keep the refusal ledger, keep
`applyCanvasToYMaps`'s `ledger.reset()`. Do not write a tombstone in its place: a seed has no
opinion about deletion. Whether the wrapper method survives is immaterial and is not asserted.

#### 7.0.5 — Oracles and traps these tests already encode

- **Survival is never spelled as key presence.** Post-WP19 a removal instruction *is* a
  tombstone, so `nodes.get(id) !== undefined` stays green against a seed that tombstoned every
  omitted record. Every survival assertion here reads
  `buildCanvasData(nodes, edges, deleted)` and checks `isTombstoneSuppressed` explicitly.
- **The node→edge cascade.** `buildCanvasData` prunes an edge whose endpoint node is gone, so
  one deleted node can remove four records from the projection. Count edges too.
- **No concurrent same-key writes.** Yjs tie-breaks on `clientID = random.uint32()`. Every
  value asserted has a single author or a causal predecessor chain; the peers in these
  fixtures author disjoint ids.
- **Ordering needs an ordering oracle.** AC4's sequence claim is asserted from a trace and
  from the consequence (`the seed arms no write`), never from an end state.
- **What WP29 does NOT change:** the host seed still UPSERTS the keys it mentions, so an older
  file still puts an older *value* back (WP18 tp06's contract). AC3 is about RECORDS. A stale
  key is visible and self-correcting; a removed record is silent, shared and permanent.

---

### 7.1 — Test cases

Framework **vitest**. Visible set: `plugin/src/__tests__/v2/wp29/` (+ `harness.ts`).
Seven test points, 34 visible test cases. All seven are UNIT scope.

### TC01 — `decideSeed` is a two-condition guard (AC1)
- **File:** `plugin/src/__tests__/v2/wp29/test_tp01_decide_seed_two_condition_guard_visible.test.ts`
- **Scope:** UNIT · **Subject:** `canvas-seed-decision.ts`
- **Asserts:** the full 2×2 truth table row by row; `SEED_FROM_FILE` reachable on exactly one
  row, stated as a count; the `SEED_DECISION` vocabulary is exactly two strings;
  `NOTHING_KNOWS_DOC` is the only seeding shape; the fail-closed rule over
  `true/undefined/null/0/""/"false"/NaN/{}` for each field independently, plus a missing
  object; purity across alternating calls; the argument and the exported constant are not
  mutated.
- **Catches:** a guard that checks one condition (`if (!peerKnowsDoc) seed`) — it satisfies
  three of four rows and fails exactly one; a truthiness guard (`!x` instead of `x !== false`);
  a memoised decision.

### TC02 — `coldOpen` obeys the decision (AC1)
- **File:** `test_tp02_cold_open_seeds_only_when_nothing_knows_visible.test.ts`
- **Scope:** UNIT · **Subject:** `CanvasPersistence.coldOpen`
- **Asserts:** over an EMPTY doc and a file with records — the ignorant shape seeds and reads
  the file once; each of the three informed shapes returns `"empty"`, reads nothing, writes
  nothing, leaves the doc empty, opens **zero transactions**, and leaves the file's bytes
  untouched; the outcome agrees with `decideSeed` on all four shapes; `doc-wins` still takes
  precedence for a non-empty doc even when both flags are true; omitting `seedKnowledge`
  reproduces the pre-WP29 behaviour exactly.
- **Catches:** a perfectly correct `decideSeed` that `coldOpen` never consults; a guard placed
  ahead of the `docNonEmpty` branch; a branch that returns `"empty"` while still applying the
  file; a branch that flushes an empty board onto the user's file.

### TC03 — the two conditions are measured by `subscribe` (AC1)
- **File:** `test_tp03_seed_knowledge_wired_from_subscribe_visible.test.ts`
- **Scope:** UNIT · **Subject:** `CanvasSync.seedKnowledgeFor` + the two measurements in `subscribe`
- **Asserts:** the four (sidecar × peer) situations produce the four knowledge pairs, with the
  peer's state delivered **inside** `waitForSync` so the two conditions vary independently;
  a MISSING sidecar is not knowledge; an unsubscribed path knows nothing; **the R4 case in
  both arms** — a sidecar replica that replays an EMPTY board, and a peer whose board is
  empty, are each not re-seeded from the stale file (outcome `"empty"`, no read, no write, the
  file byte-identical); and a genuinely new board still seeds end to end.
- **Catches:** a plugin in which nothing ever computes the knowledge; attributing the sidecar's
  own replay to a peer (or vice versa); reading "a load ran" as "the sidecar knows it"; a guard
  that simply switched seeding off.

### TC04 — the seed retains records the source omits (AC2)
- **File:** `test_tp04_host_seed_retains_records_absent_from_file_visible.test.ts`
- **Scope:** UNIT · **Subject:** `seedFlatSpace` via `subscribe(path, "host")`, differentially against `seedRecordsIntoYMaps`
- **Asserts:** a peer-only node and a peer-only edge survive the host seed and are **not**
  tombstoned, with their fields intact; the seed genuinely ran (the file's value lands, the
  file's own record is created); **the host seed and the exported cold-open seed writer produce
  the same board** from the same fixture; a second host seed over the same doc removes nothing;
  an EMPTY host file removes nothing at all; the seed writes zero `deleted` entries.
- **Catches:** **this is the test that catches "wrapper deleted but `seedFlatSpace` still
  destructive"** — the two arms diverge and the peer-only record is missing from the host arm.
  It equally catches "wrapper deleted and nothing replaces it" (the file's values never land),
  and "kept it by tombstoning it".

### TC05 — a host rejoining with an older file removes no peer record (AC3)
- **File:** `test_tp05_host_rejoin_older_file_keeps_peer_records_visible.test.ts`
- **Scope:** UNIT · **Subject:** the R4 regression pin, three replicas
- **Asserts:** the fixture genuinely puts the peers' records out of the file's reach (the file
  is the board as it stood at T0); both peers' nodes and edges survive the rejoin, untombstoned
  and field-intact; the seed genuinely ran (the older file's key value lands — stated
  explicitly as the boundary of the claim); **the rejoin propagates no removal to either
  peer**; all three replicas converge AND hold the full membership; an empty host file is
  equally harmless.
- **Catches:** the destructive re-seed in its original form; a "fix" that deleted the host seed
  outright; a removal spelled as a tombstone; convergence-on-a-damaged-board.

### TC06 — the three `ColdOpenResult` outcomes stay observable (AC4)
- **File:** `test_tp06_cold_open_outcomes_remain_observable_visible.test.ts`
- **Scope:** UNIT · **Subject:** `ColdOpenResult`, `coldOpen`, `attachCanvasPersistence`
- **Asserts:** each of the three outcomes is produced by its own scenario; the observed value
  set across five scenarios (including both WP29 branches) is exactly
  `{seeded-from-file, doc-wins, empty}`; WP29's branch is `"empty"` and does **not** flush;
  `attachCanvasPersistence` still returns `{persistence, coldOpen}`; a destroyed writer still
  answers `"empty"`.
- **Catches:** a fourth outcome invented for the new branch; a new branch that returns
  `"doc-wins"` and writes an empty board to disk; an outcome the attach wrapper swallows.

### TC07 — the `coldOpen` ordering contract is preserved (AC4)
- **File:** `test_tp07_cold_open_ordering_and_zero_writes_visible.test.ts`
- **Scope:** UNIT · **Subject:** `attachCanvasPersistence` ordering, both branches
- **Asserts:** sidecar load → `waitForSync` → `coldOpen`'s file IO → `start()`, from one trace,
  on the seeding branch; the same ordering holds on **WP29's own no-seed branch** (the case
  WP25's AC4 test cannot reach); the consequence — the seed arms no timer and is never written
  back; the no-seed branch opens **zero transactions** on the doc (I3) and rewrites nothing;
  `start()` still installs the observer, so a later change still persists.
- **Catches:** `start()` before `coldOpen`; a guard that records its verdict in the doc; a "fix"
  that skipped `start()` on the no-seed branch, leaving the board with no writer.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**INTEGRATION_SCOPE count: `0`.**

Every WP29 test point is exercisable with injected doubles (`PersistenceIO`, `SidecarIO`, the
sync-manager double, a manual scheduler) and a real `Y.Doc`. Nothing in this WP needs a live
Obsidian host, a real vault or a relay: the seed decision is a pure core, the cold-open guard
is reachable through the constructor's injected `PersistenceIO`, and both AC2 and AC3 are
observable at `CanvasSync.subscribe` with a vault double. `W4 Test Targets` stays `0`.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** §7.0.2 confirmed in-tree. The record-level
  delete-by-omission was `canvas-sync.ts:3178` (`const absentFromFile = new Set(container.keys())`),
  `:3182` (`absentFromFile.delete(id)`) and `:3202–3204` (`for (const id of absentFromFile) container.delete(id)`),
  all inside `CanvasSync.seedFlatSpace`. `applyCanvasToYMaps` was already four statements and
  destroyed nothing itself. `coldOpen` (`canvas-persistence.ts:443`) read doc-emptiness alone as
  "nobody has ever seen this board". Nothing anywhere computed sidecar or peer knowledge; the
  `SidecarLoadResult` from `await this.sidecar.load(...)` in `subscribe` was discarded.
- **Approach:** (1) new zero-import pure core `files/canvas-seed-decision.ts` with
  `SEED_DECISION` / `SeedDecision` / `SeedKnowledge` / `NOTHING_KNOWS_DOC` / `decideSeed`,
  two conjuncts both spelled `!== false`; (2) optional `CanvasPersistenceOpts.seedKnowledge`
  defaulting to `NOTHING_KNOWS_DOC`, consulted by one new `coldOpen` branch placed after the
  `docNonEmpty` check and before `io.exists`, returning the existing `"empty"`; (3) the two
  measurements in `subscribe` — the `SidecarLoadResult`'s `checkpointApplied || historyEntriesApplied > 0`,
  and a `Y.encodeStateVector` byte delta across `waitForSync` — surfaced by
  `CanvasSync.seedKnowledgeFor(path)`; (4) the three-edit removal in `seedFlatSpace`, with
  nothing put in its place; (5) one wiring line in `main.ts`.
- **Fallback path if all attempts fail:** not needed — no attempt failed and no licence was required.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. Visible set 68/68 (7 files; the charter's "34" undercounts
  the parametrised `tp01`). R4 regression gate `w4-canvas-integrity` + `wp18` 61/61 green;
  neighbours wp24/25/26/27/28 339/339 green; full suite 290 files / 1755 passed / 0 failed
  (reference 1687/0, delta +68 = the WP29 visible set exactly); `tsc --noEmit -skipLibCheck`
  clean. The removal was falsified by re-injecting the loop (9 failed, exactly `tp04` + `tp05`;
  `wp18` and `w4-canvas-integrity` stayed green, confirming the licence analysis) and by
  dropping one conjunct from `decideSeed` (12 failed across 3 files). Both reverted.
- **What remains open:** the Shared Ownership Contract §7 fuzzer op class was NOT registered —
  the seed decision's two inputs are session-lifecycle facts (a sidecar replay, a sync step)
  rather than per-window replica mutations, so an op would have to fabricate a subscribe inside
  a fuzz window. §7 is a *should* with a record-why clause; the reason is recorded in
  `ImplementationReport_WP29.md`. `tp05`'s three-replica rejoin covers the same failure
  deterministically.
- **Final status:** `DONE`. No `LICENCE_REQUIRED`, no `TOOL_REQUEST`, no test file touched,
  zero new runtime dependencies.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
