# Implementation Report — WP29

**Attempt:** 1
**WP:** WP29 — Seed-once-per-lifetime + REMOVAL of the destructive host re-seed (C29, phase P2)

---

## Status

`DONE`

- Visible suite `plugin/src/__tests__/v2/wp29`: **68 / 68 passing** (7 files).
  The charter's §7.1 says "34 visible test cases"; the files actually collect **68**
  — `tp01` alone expands to 26 because its fail-closed block is parametrised over
  8 values × 2 fields. No test was added, removed or edited; the count difference is
  charter bookkeeping, not a missing or extra case.
- **R4 regression gate** `w4-canvas-integrity.test.ts` + `v2/wp18`: **61 / 61 passing**
  (13 files) — unchanged from the measured pre-WP29 baseline.
- Neighbours `wp24 / wp25 / wp26 / wp27 / wp28`: **339 / 339 passing**
  (76 + 59 + 46 + 54 + 104, each exactly as handed over).
- `npx tsc --noEmit -skipLibCheck`: **clean, exit 0, zero diagnostics**.
- Full plugin suite: **290 files / 1755 passed / 0 failed**
  (reference 1687 / 0 → **delta +68**, exactly the WP29 visible tests; no pre-existing
  test moved in either direction).
- `plugin/node_modules/.bin/biome lint` on the four touched files: **3 findings, all
  pre-existing** (`canvas-persistence.ts:1` `useImportType`, `:374` `useTemplate`,
  `canvas-sync.ts:2876` `useTemplate`). **Zero findings in `canvas-seed-decision.ts`**
  and zero introduced by this diff.

No `LICENCE_REQUIRED`. No test was deleted, weakened or amended. No `TOOL_REQUEST`.
**Zero new runtime dependencies** — the new module imports nothing at all.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — seed only when **neither** a sidecar **nor** any peer knows the doc | DONE | New pure core `decideSeed` is a **two-conjunct** guard, both spelled `!== false`, in a module with **zero imports**. `CanvasPersistence.coldOpen` consults it; `CanvasSync.subscribe` takes the two measurements and `seedKnowledgeFor(path)` hands them to the wiring layer. The four truth-table rows are produced by four genuinely independent situations (see **Changes Made → the peer measurement**). |
| **AC2** — the destructive re-seed no longer exists; a host rejoin is an ordinary related-replica merge | DONE | The record-level delete-by-omission is **removed from `CanvasSync.seedFlatSpace`** — see **R4 Removal** for the exact three edits and the falsification that proves the tests bind to them. `applyCanvasToYMaps` (the wrapper) is **kept**, including its `ledger.reset()`: the charter §7.0.4(f) says its survival is immaterial, and keeping it means the change is confined to the one method that actually destroyed anything. |
| **AC3** — a host rejoining with an older local file removes no peer record | DONE | Same removal, measured at the three-replica boundary (`tp05`): both peers' nodes and edges survive untombstoned and field-intact, the rejoin propagates no removal, and all three replicas converge **on the full membership**. The seed still runs — `orig-1`'s text does go back to the file's older value, which is WP18 tp06's upsert boundary and deliberately unchanged. |
| **AC4** — the `ColdOpenResult` outcomes stay observable; `coldOpen` after `waitForSync`, before `start()` | DONE (preservation) | `ColdOpenResult` still has **exactly three** members; WP29's branch reuses `"empty"`. The new branch sits **after** the `docNonEmpty` check and **before** `io.exists`, so it reads nothing, writes nothing and opens **zero transactions** (I3). `attachCanvasPersistence` is untouched — the ordering it owns is unchanged, and `start()` still runs on the no-seed branch. |

---

## Blocked Items

None. Nothing in this WP needed a licence, and nothing was found that required one.

### One charter statement that is wrong, and was already known to be wrong

Charter §2/§3 place the R4 path at `CanvasSync.applyCanvasToYMaps :776–813`, "destructive at
`:791–793`". It is not there and has not been for two phases. §7.0.2 and the Shared Ownership
Contract §5 both say so; this report records it again because §2 is the section a future
reader hits first. **Deleting `applyCanvasToYMaps` retires nothing** — its body is four
statements, it is `private`, and it appears in no executable assertion. The destruction was in
`seedFlatSpace`.

### One count discrepancy, non-blocking

Charter §7.1 declares 34 visible test cases across seven test points. The delivered files
collect **68**. Both numbers describe the same seven files; the charter counted test points'
narrated assertions rather than vitest cases. Recorded so a later reader does not conclude
tests went missing.

---

## Tools Created

None.

---

## Changes Made

### New — `plugin/src/files/canvas-seed-decision.ts` (79 lines, **zero imports**)

The whole of WP29's owned surface, exactly as §7.0.4(a) specifies it:

```text
├── SEED_DECISION = { SEED_FROM_FILE: "seed-from-file", LOAD_OR_MERGE: "load-or-merge" }
├── type SeedDecision
├── interface SeedKnowledge { sidecarKnowsDoc; peerKnowsDoc }
├── NOTHING_KNOWS_DOC          ← the both-false shape, Object.freeze'd
└── decideSeed(knowledge)      ← pure, no state, no mutation, never throws
```

Three design points:

- **Two conjuncts, both `!== false`.** Not `!x`. A probe that answers `undefined` because a
  wiring step was skipped is an *unanswered question*, and seeding is the destructive
  direction — so every non-`false` value, plus a missing field, plus a missing object,
  yields `LOAD_OR_MERGE`. A `null`/non-object argument is rejected before either field is
  read, so `decideSeed(undefined)` cannot throw.
- **`NOTHING_KNOWS_DOC` is frozen.** It is shared by every caller in the session; a consumer
  that wrote through it would poison every later cold open in the process, and the write
  would be invisible at the site that suffers from it.
- **No memoisation, no module state.** The function is a straight-line read of its argument.

### Modified — `plugin/src/files/canvas-persistence.ts`

- `CanvasPersistenceOpts.seedKnowledge?: SeedKnowledge` — **optional**, and the default is
  the compatibility guarantee: every pre-WP29 caller (and every pre-existing test) supplies
  nothing and must keep behaving exactly as before.
- The constructor resolves it with `opts.seedKnowledge === undefined ? NOTHING_KNOWS_DOC : opts.seedKnowledge`
  rather than `??`. An **omitted** probe defaults to "nothing knows the doc"; an explicit
  `null` stays an unanswered question and reaches `decideSeed` unchanged, which is the
  fail-closed reading.
- **One new branch in `coldOpen`, in the contracted position:**

  ```text
  1. doc NON-EMPTY               → migrate + flush → "doc-wins"      (UNCHANGED, still FIRST)
  2. decideSeed(...) === LOAD_OR_MERGE → return "empty"              (NEW)
  3. file missing / empty        → "empty"                           (UNCHANGED)
  4. otherwise                   → seed + migrate → "seeded-from-file"(UNCHANGED)
  ```

  Step 2 is after step 1 because WP25's returning client resumes a sidecar replica, arrives
  **non-empty** and *does* know the doc — it must still overwrite its stale file. Step 2 is
  before `io.exists` so a known doc takes no file input at all. It returns `"empty"` and not
  `"doc-wins"` because `doc-wins` flushes, and flushing an empty projection over a `.canvas`
  that still holds the user's cards is a worse data-loss class than the one being removed.
  **No fourth `ColdOpenResult` value.**

### Modified — `plugin/src/files/canvas-sync.ts`

- **The R4 removal.** See the dedicated section below.
- `import { NOTHING_KNOWS_DOC, type SeedKnowledge } from "./canvas-seed-decision"` — a
  **value** import, safe because the target has zero imports and can close no cycle.
- New field `private seedKnowledgeByPath = new Map<string, SeedKnowledge>()`, added to
  `rekeyPathState` (a rename does not change which doc the path names — left behind, the
  renamed canvas would report "nothing knows this board" and become seedable from a stale
  file), removed in `unsubscribe`, cleared in `destroy`.
- **Measurement 1 — `sidecarKnowsDoc`**, from the `SidecarLoadResult` that
  `await this.sidecar.load(guid, doc)` already returned and that `subscribe` **discarded**:

  ```ts
  sidecarKnowsDoc = loaded.checkpointApplied === true || loaded.historyEntriesApplied > 0;
  ```

  A `MISSING`/degraded verdict is **not** knowledge (both fields are false/0 in
  `missingResult` and `degradedResult`) — reading "a load ran" as "the sidecar knows it"
  would make every board unseedable the moment a lifecycle is wired. A frame log with no
  checkpoint **is** knowledge; that is a sidecar's normal state between compactions.
- **Measurement 2 — `peerKnowsDoc`**, a **state-vector delta across the sync step**:

  ```ts
  const stateBeforeSync = Y.encodeStateVector(docHandle.doc);
  await this.syncManager.waitForSync(docId);
  const peerKnowsDoc = !sameBytes(stateBeforeSync, Y.encodeStateVector(docHandle.doc));
  ```

  It is measured this way and not the two obvious alternatives, both of which are wrong:
  - not **"the doc is non-empty"** — that is the pre-WP29 condition, and it is exactly the
    one that misreads a cleared board;
  - not **"foreign clientIDs are present"** — the sidecar load runs immediately before this
    and **replays updates under their original authors' IDs**, so a clientID probe reads a
    sidecar replay as a peer and collapses AC1's two conditions into one.

  A Yjs state vector only grows, so byte-inequality across the await *is* "this replica
  gained state while the peers were speaking". `sameBytes` is a new 7-line module-private
  helper (length + element compare).
- The pair is recorded as `this.seedKnowledgeByPath.set(path, { sidecarKnowsDoc, peerKnowsDoc })`
  right after the post-`waitForSync` subscription re-check and **before** the
  `if (this.observers.has(path)) return;` early exit, so a path whose observer already
  exists still reports what this subscribe measured.
- New public accessor:

  ```ts
  seedKnowledgeFor(rawPath: string): SeedKnowledge   // canonicalised; NOTHING_KNOWS_DOC if never subscribed
  ```
- Two stale header comments corrected: `applyCanvasToYMaps`'s "the RECORD-level delete below
  is deliberately kept", and `subscribe`'s "the HOST branch above stays exactly as it was:
  `applyCanvasToYMaps` DELETES doc entries absent from the host's local file". Both now
  describe what the code does.

### Modified — `plugin/src/main.ts` (wiring only, one line)

```ts
seedKnowledge: this.canvasSync?.seedKnowledgeFor(canonical),
```

inside the existing `attachCanvasPersistence({...})` options object, beside `seedRefusals`,
which it mirrors exactly (both are per-path state filled during `subscribe` and read by the
writer that attaches afterwards). No decision, branch or computation was added.

### NOT modified

`canvas-persistence.ts`'s `attachCanvasPersistence` body, `canvas-sidecar.ts`,
`canvas-sidecar-lifecycle.ts`, `canvas-epoch.ts`, `canvas-schema.ts`, `canvas-presence.ts`,
`canvas-binding.ts`, `canvas-model-bridge.ts`, `package.json`, `manifest.json`,
`plugin/main.js`, `server/`, `docker/`, `deploy/`, `_run_blind.py`, and **every test file in
the tree**, including `wp29/harness.ts`.

---

## Visible Test Results

```text
plugin/src/__tests__/v2/wp29 ..................... 7 files / 68 tests / 68 passed
  tp01 decideSeed two-condition guard ............ 26 / 26
  tp02 coldOpen obeys the decision ...............  8 /  8
  tp03 subscribe measures both conditions ........  9 /  9
  tp04 seed retains records the source omits .....  6 /  6
  tp05 host rejoin keeps peer records ............  6 /  6
  tp06 three ColdOpenResult outcomes .............  8 /  8
  tp07 coldOpen ordering + zero writes ...........  5 /  5

R4 regression gate (w4-canvas-integrity + v2/wp18) 13 files /  61 /  61 passed
  w4-canvas-integrity.test.ts (A1–A8, A7 at :405)  GREEN
  wp18 tp01 host seed rejects invalid record ..... GREEN
  wp18 tp02 cold-open seed rejects invalid record  GREEN
  wp18 tp06 seed is upsert-only (I7) ............. GREEN  ← WP29's own thesis
wp24/25/26/27/28 ................................. 52 files / 339 / 339 passed
Full suite ....................................... 290 files / 1755 / 1755 passed / 0 failed
tsc --noEmit -skipLibCheck ....................... clean (exit 0, zero diagnostics)
```

Reference full-suite total was **1687 / 0**. Delta **+68 / 0**, which is the WP29 visible set
and nothing else.

Foreign edits observed and **not** touched: none new this session beyond the batch-B16
activity already recorded in `ImplementationReport_WP25.md`
(`workflowArtifacts/canvas-v2/_blind_records/**`, `tests/blind_set{1,2}/**`).

---

## R4 Removal

**What was removed, exactly.** Three edits, all inside `CanvasSync.seedFlatSpace`
(`canvas-sync.ts`, formerly `:3173–3209`, the loop at `:3202–3204`):

```ts
// 1. the accumulator, first line of the method:
-    const absentFromFile = new Set(container.keys());

// 2. inside the per-record loop:
     for (const [id, source] of Object.entries(records)) {
-      absentFromFile.delete(id);
       const admission = admitRecordIngest(…);

// 3. after the loop — THE R4 PATH ITSELF:
-    for (const id of absentFromFile) {
-      container.delete(id);
-    }
```

**Nothing replaced it.** No tombstone, no `on:false` entry, no quarantine — a tombstone is
the same removal in WP19's vocabulary, and a seed has no opinion about deletion. What remains
is exactly what `seedRecordsIntoYMaps` (the cold-open seed writer) has always done: validated,
create-once, upsert-only writes of the ids the source actually names.

**Kept deliberately:** the `admitRecordIngest` validator and its refusal signatures, the
`writeRecordCreateOnce` create-once/upsert semantics, the `SeedRefusal` ledger, and
`applyCanvasToYMaps`'s `ledger.reset()`. The wrapper method itself is kept — §7.0.4(f) says
its survival is immaterial and unasserted, and keeping it confines the diff to the one method
that destroyed anything.

**How I verified the R4 path is gone — three independent checks:**

1. **Structural.** `grep -rn "absentFromFile" plugin/src/` returns **only comments in the
   wp29 test files**. There is no `container.delete(` and no `.delete(` of any record id left
   anywhere in `seedFlatSpace` or `applyCanvasToYMaps`.
2. **Differential (TC04).** The host seed reached through `subscribe(path, "host")` and the
   exported `seedRecordsIntoYMaps` are pushed the same fixture and produce **identical
   projections** — `["host-only", "peer-only", "shared"]` + `["peer-edge"]` — with the
   peer-only records untombstoned and the file's own values landed. This is the assertion
   that distinguishes "actually fixed" from "wrapper deleted, `seedFlatSpace` still
   destructive" and from "wrapper deleted and nothing replaces it".
3. **Falsification — I re-injected the loop and measured.** With the three edits reverted
   (loop restored verbatim), `wp29 + wp18 + w4-canvas-integrity` went to
   **9 failed / 120 passed, 2 test files failed** — and the two failing files were exactly
   `tp04` and `tp05`. `wp18` (all six files) and `w4-canvas-integrity.test.ts` stayed
   **green** under the destructive implementation, which independently confirms the licence
   analysis: those four tests do not depend on the delete in either direction. The injection
   was then reverted and the suite re-measured green (68/68, tsc clean).

A fourth falsification was run on the decision itself: dropping the `sidecarKnowsDoc`
conjunct from `decideSeed` (leaving a one-condition guard) reddens **12 wp29 tests across 3
files** — the `sidecar=true peer=false` truth-table row, the count-of-seeding-rows assertion,
`coldOpen`'s agreement test, tp03's sidecar arm and tp06's vocabulary scenario. Reverted and
re-measured green.

---

## Summary for Worker 3

WP29 is complete and green. R4 is gone at the record level, and it is gone from the place it
actually lived: three lines in `CanvasSync.seedFlatSpace`, not the `applyCanvasToYMaps`
wrapper the charter's §2/§3 point at. The host seed is now an upsert of the records the file
names and nothing more, which makes it agree with the cold-open seed writer at the record
level — that agreement is asserted directly rather than inferred.

Five things to carry forward:

1. **`peerKnowsDoc` is a state-vector delta across `waitForSync`, and it has to stay one.**
   The sidecar load runs immediately before that await and replays updates under their
   original authors' clientIDs. Any future "is a peer here?" probe written as *foreign
   clientIDs are present* will read a sidecar replay as a peer, silently collapse AC1's two
   conditions into one, and make the sidecar arm of the guard untestable. `sameBytes` over
   `Y.encodeStateVector` is sound precisely because a state vector only grows.
2. **`seedKnowledge` is optional and defaults to `NOTHING_KNOWS_DOC` on purpose.** That
   default is what keeps every pre-WP29 call site — including wp18 `tp02` — behaving exactly
   as it did. Do not make it required, and do not "tighten" the default to something that
   refuses to seed: a genuinely new board must still seed, and `tp03`'s last test and
   `tp02`'s omitted-knowledge test both pin that.
3. **The guard's position in `coldOpen` is load-bearing in both directions.** Ahead of the
   `docNonEmpty` branch it breaks WP25's returning client (stale file kept forever); returning
   `"doc-wins"` instead of `"empty"` flushes an empty board onto the user's `.canvas`, which
   is a worse data-loss class than R4. The branch is also the reason `CanvasPersistence` still
   emits zero CRDT writes: it records its verdict nowhere.
4. **What WP29 did NOT change, and WP30 will need:** the host seed still upserts the KEYS it
   mentions, so an older file still puts an older *value* back (WP18 tp06's contract, asserted
   explicitly in tp05). AC3 is about RECORDS. Destruction is now only ever an explicit user
   action — which is exactly the entry point WP30 owns, and it should import `SEED_DECISION` /
   `decideSeed` from `canvas-seed-decision.ts` rather than re-spelling either string
   (Shared Ownership Contract §1).
5. **Fuzzer wiring (Contract §7) was not done.** The seed decision *is* fuzzer-shaped — it is
   a "which of two states wins, and what happens to the loser" rule — but its two inputs are
   both *session-lifecycle* facts (a sidecar replay and a sync step), not per-window replica
   mutations, so an op class would have to fabricate a subscribe inside a fuzz window. §7 is a
   *should* with an explicit "record why instead of forcing a bad fit" clause; this is that
   record. The three-replica rejoin in `tp05` covers the same failure deterministically, and
   WP23's "host rejoin" op remains the right home for it if the harness ever grows a
   subscribe-shaped op.
