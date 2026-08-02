# Implementation Report — WP18

Attempt: 2

## Status: PARTIALLY_DONE

All **15 visible WP18 tests PASS**. `npx tsc -noEmit -skipLibCheck` is **clean**. The full suite is
**30 failed / 1189 passed (1219)**. Every one of the 30 has been classified by direct measurement,
not by argument:

- **29 = class A** — legacy fixtures that WP14 (frozen) rules invalid, quoted below with the exact
  failing conjunct.
- **1 = neither class A nor a defect of mine** — `canvas-persistence.test.ts` asserts the doc-wins
  branch opens **zero** transactions on the doc, while charter §7 TC7 requires that same branch to
  migrate an unmigrated V1 doc, which necessarily opens one. Reported as `SPEC_CONTRADICTION`.
- **Class B (my defects) is EMPTY**, and that is a measurement, not a claim — see
  "The decisive counterfactual" below.

`SPEC_CONTRADICTION:` charter §7 TC7 ("the migration call site fires on the doc-non-empty branch")
and the pre-existing test `canvas-persistence.test.ts > "non-empty doc + stale file → doc wins, file
overwritten, NO file→CRDT read"` (`expect(tx.count()).toBe(0)`, comment: *"doc-wins path opens no
transaction on the doc"*) are mutually exclusive over the same fixture class — a non-empty, unstamped
V1 doc. Measurement: with the ingest gate forced fully open, the full suite drops to 5 failures and
this is the only non-WP18 one left, i.e. it is caused by the migration call site alone, which the
charter itself orders into `coldOpen()` on both branches.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — every local write boundary consults the validator; an invalid local record never reaches the doc + a rejection signature naming the boundary and the reason | **DONE** (cost: 29 legacy fixtures, class A) | All three local boundaries (host seed, cold-open seed, `CAPTURE_NET`) call one gate, `admitRecordIngest`, which calls WP14 and branches on `verdict.reject` — it never re-derives rejection from the `origin` it forwarded. Signature: `INGEST REJECTED signature: boundary=<host-seed\|cold-open-seed\|capture-net> refused <node\|edge> <id> (<REASON_CODE>)`. TP01/TP02/TP03 green. |
| **AC2** — creation is one transaction carrying a complete record; never `set(id, new Y.Map())` for an existing id | **DONE, zero regressions** | `buildDetachedRecord` assembles a plain draft, populates a **detached** `Y.Map`, and attaches it with a single `container.set`, so the id's first appearance in the doc is already complete. An existing id is always merged in place. TP05 green on both halves (whole payload at first observation; container identity preserved across a re-seed with the peer's concurrent `color` intact). |
| **AC3** — partial observation produces upserts only (I7) | **DONE, zero regressions** | `applyToYMap`'s absent-key delete loop is gone, and with it the `PROTECTED_KEYS` read that guarded it. No local write path deletes a doc key any more. The **record-level** delete in the host seed is deliberately retained (C29/WP29 owns it; TC6 explicitly does not assert it) and is skipped for any id whose local proposal was refused. TP06 green. |
| **AC4** — remote deltas are never rejected at ingest | **DONE, zero regressions** | There is no remote ingest path in this module, and the gate reads `verdict.reject` rather than the origin. TP04 green: the same `MISSING_TYPE` is refused + signed locally and kept, unrepaired and unsigned, when it arrives as a peer delta. |
| **(a)** `migrateV1ToV2` production call site | **DONE on both branches**, 1 spec contradiction | See "The migration call site". TC7/TC8/TC9/TC10/TC11 green. |
| **(b)** `PROTECTED_KEYS` exported, membership unchanged | **DONE** | Untouched. TP12 green; `w4-canvas-integrity` A8 and WP3 `blind_set1/test_geometry_keys_drift` still read it. |

---

## Deletion Ledger

| Test title (verbatim) | File | Reason unsatisfiable | Replacement coverage |
|---|---|---|---|
| ``T1 DISCRIMINATION `fromNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it`` | `plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts` (whole file removed) | Pure discrimination pair: it requires the **disarmed** run to LOSE the endpoint. AC3 retires absent-key deletion on the seed path entirely, so the intact and disarmed runs now agree and the pair proves nothing — the same way WP4's `A9`/`A10` became unfalsifiable. Ordered by name in the WP18 charter §4 amendment note. | The property is now **structural, not guarded**: no local write path deletes a key at all. TP06 (`test_tp06_seed_is_upsert_only_i7_visible.test.ts`) asserts it positively using keys `PROTECTED_KEYS` never shielded (`color`, `background`, an edge's `color`), so it cannot be satisfied by a guard-membership answer. `PROTECTED_KEYS` itself stays falsifiable via TP12 + `w4` A8. |
| ``T2 DISCRIMINATION `toNode`: intact guard keeps the endpoint through the host seed, disarmed guard loses it`` | same file | same | same |

Nothing else was deleted, skipped, `.only`'d, weakened or relaxed. Test count 1219 = the pre-WP18
baseline's 1221 minus these two. `applyToYMap` survives as an exported upsert-only merge; its only
remaining callers are inside `canvas-sync.ts`.

---

## Changes Made

### `plugin/src/files/canvas-persistence.ts`

- **`coldOpen()` — the migration now runs AFTER the seed, never before it.** The empty/non-empty
  split comes first; the doc-wins branch migrates and then `flush()`es (so the snapshot that reaches
  disk is the post-migration one); the seed branch seeds first and migrates afterwards.
- **New private `migrateRecordBearingDoc()`** — the single migration call, guarded on the doc
  actually holding at least one record. A doc with no records is never stamped with `meta`, so
  `coldOpen` on an empty doc with no file still emits zero CRDT delta.
- The seed consumes `decodeCanvasDataToFlat(parseCanvas(content))` again — **attempt 1's move of
  this path onto the V2 vocabulary is reverted** (see below). `seedDocFromCanvasData` remains a thin
  private method that only narrates the returned signatures. `isCanvasDataEmpty` → `isFlatCanvasDataEmpty`.

### `plugin/src/files/canvas-sync.ts`

- **New WP18 section** — `INGEST_BOUNDARY`, `IngestBoundary`, `IngestRecordKind`,
  `ingestRejectionSignature()` (the format WP18 owns per Shared Ownership Contract §1),
  `IngestAdmission`, `admitRecordIngest()`. The gate calls WP14 and returns on `verdict.reject`; it
  never inspects the `origin` it forwarded. An invalid-but-not-rejected record is **admitted** and
  produces no signature — that is AC4, in the data.
- `projectPostWriteRecord()` — the subject the gate judges: `doc ∪ proposal` (correct because I7
  means nothing is removed), run through `toV2Node` / `toV2Edge` so a flat `x`/`y` pair and an atomic
  `pos` register are judged as the **same fact**. This is the "judge the V2-converted view" rule, and
  it is measurably load-bearing: remove it and the fixture named in Correction 2 fails on its *node*
  as well (see "Correction 2, measured").
- `docValueEquals()` — **structural** whole-value equality via WP9/WP10's own `posEquals` /
  `sizeEquals` / `endpointEquals`, never reference equality (Shared Ownership Contract §3).
- `upsertRecordFields()` — upsert only, never delete; `type` routed through WP11's `guardTypeWrite`,
  whose `noop` branch keeps a re-stated same-value type off the wire.
- `buildDetachedRecord()` / `writeRecordCreateOnce()` — AC2. The draft is a plain object first,
  because an unattached `Y.Map` answers every read `undefined` (and Yjs warns), which would make the
  write-once guard inspect an empty container.
- `syncRegistersFromFlat()` — keeps an **already-present** register in step with the flat keys the
  seed/capture boundaries write. Never *introduces* a register, so an un-migrated record's doc shape
  is unchanged.
- `seedV2RecordsIntoYMaps` → **renamed `seedRecordsIntoYMaps` and moved back to the FLAT
  vocabulary.** It still owns the gate (AC1), create-once (AC2) and upsert-only (AC3); it no longer
  pre-empts the migration. Helper `seedV2Space` → `seedSpace`.
- `applyToYMap()` — the absent-key delete loop and its `PROTECTED_KEYS` read are **retired** (AC3).
  The function survives as an upsert-only merge.
- `applyCanvasToYMaps()` → `seedFlatSpace()` — the host seed, validated / create-once / upsert-only.
  It keeps the **record-level** delete (C29/WP29's, not AC3's) and exempts any id whose local
  proposal was refused, so a local refusal can never reach out and delete shared state.
- `applyIntentPlan()` — the capture boundary: gate before writing, create-once on the new-record
  branch, `guardTypeWrite` on `type`, structural compare on every other field, `syncRegistersFromFlat`
  afterwards. `AppliedIntent.rejected` carries the signatures; `handleLocalModify` logs them
  **outside** the transaction.
- `decodeV2RecordToFlat()` — **kept split into two passes** (registers, then flat keys overriding).
  Retained from attempt 1; still a real fix, see below.
- `pruneEdgesForDeletedNodes()` / `auditCanvasState()` — endpoint and geometry reads go through
  WP10/WP9's readers with the flat file key as fallback, so the GAP-5 cascade, the dangling-edge
  signature and the SCATTER signature still see a record written in either vocabulary.
- `decodeCanvasDataToFlat` — **not retired.** Its doc comment now says why: §2/§4 of this charter
  never mention it, it is a P1 scaffold, and its removal belongs with the write boundaries' own move
  to registers (WP22/WP39).

### What attempt 1 got wrong and this attempt reverses

Attempt 1 called `migrateV1ToV2(this.doc)` as the first statement of `coldOpen`, **before** the
empty/non-empty split. Because the migration guard is one-shot on `meta`, that forced the seed into
the V2 vocabulary so nothing would land behind the guard — which cascaded into pre-V2 tests that read
flat `x`/`y` breaking, and left seeded records with no `ord` (only a migration that actually fires
runs `assignOrds`). Both symptoms are gone: the migration now runs last, the seed is flat again, and
`ord`s are allocated by the migration passing over the just-seeded records.

### The `decodeV2RecordToFlat` collision fix (retained from attempt 1)

`decodeV2RecordToFlat` resolved a record holding **both** spellings of the same fact by `Y.Map`
insertion order — i.e. by no rule at all. The migration is additive, so every migrated record holds
both, and a subsequent **flat** write (local capture, or a peer still on this build) left the register
stale while the register still won the expansion: **a card would snap back to its pre-move coordinate
on disk.** The rule is now explicit and replica-independent: **the flat key wins**, because in P1 it is
the vocabulary every live writer authors in and a register is only ever a translation of it. A record
carrying only a register is unaffected. When the write boundaries move to registers (WP22/WP39) the
precedence becomes moot rather than wrong.

---

## The migration call site

**Where:** `CanvasPersistence.coldOpen()`, `plugin/src/files/canvas-persistence.ts`, through the new
private `migrateRecordBearingDoc()`. Two placement rules, both load-bearing:

- **after the seed, never before** — the guard is one-shot on `meta`, so anything written after the
  stamp is untranslatable forever. Seeding first means the seed keeps writing the flat vocabulary
  every pre-V2 reader still expects, and the migration then translates exactly what was just written.
- **only on a doc that holds records** — stamping `meta` on an empty doc manufactures a schema claim
  about a board with no content, and would make the `"empty"` cold open emit a CRDT delta.

**Branch by branch:**

```text
coldOpen()
├── doc NON-EMPTY (the real V1-relay case)
│     └── migrateRecordBearingDoc() → flush()        ← migrate, THEN write disk
├── doc EMPTY + file present & non-empty
│     └── seedRecordsIntoYMaps()  (FLAT, gated, create-once)
│         → migrateRecordBearingDoc()                ← seed, THEN migrate
└── doc EMPTY + file missing/empty
      └── return "empty"                             ← no migration, no `meta`
```

**What proves a V1 doc actually migrates, on BOTH branches:**

- **doc-wins:** `test_tp07_cold_open_migrates_existing_v1_doc_visible` builds a doc with three flat V1
  records and **no `meta`** (`doc.share.has(META_MAP_NAME) === false` asserted as the fixture
  precondition), runs a real `coldOpen()`, asserts the result is `"doc-wins"` — i.e. it took the branch
  that reads no file and previously wrote nothing — then reads back
  `meta.schemaVersion === SUPPORTED_SCHEMA_MAJOR`, `readPosRegister`/`readSizeRegister` on both nodes,
  `readFrom`/`readTo` on the edge, and a string `ord` on every record.
- **seed:** `test_tp11_cold_open_leaves_no_record_unmigrated_visible` seeds two nodes and an edge from
  a file into an empty doc, then asserts `meta.schemaVersion = 2` and that **every** record satisfies
  `validateNodeIngest` / `validateEdgeIngest` and carries a string `ord`. The `ord` is what makes the
  green honest: nothing in WP18 allocates an `ord`, so the only thing that can have put one on a
  seeded record is `assignOrds` inside a migration that genuinely ran over it. The same test's second
  case pins the identical post-condition on the doc-wins branch.
- **idempotence:** TP08 — a second cold open produces the empty Yjs update against the post-first-open
  state vector and fires zero `update` events. TP10 — an already-V2 doc yields zero delta, zero
  `update`, and a `meta` container that keeps its identity.
- **additivity:** TP09 — every original field, including the translated flat keys and an unknown
  forward-compat key, survives unchanged.

### The host seed: considered, and deliberately NOT given a migration call

**Decision: no.** `CanvasSync.subscribe`'s host seed does not migrate, for four reasons, in order of
weight:

1. **A second call site would give the one-shot guard two racing arming points.** `meta` is the
   migration marker; whichever of the two seeds ran first would stamp it and leave the other's records
   behind the guard permanently. That is precisely the hazard Correction 1 removes on the cold-open
   path, and adding it back on a second path would reintroduce it with an ordering dependency instead
   of a fixed one.
2. **It is unnecessary in production wiring.** `main.ts:attachCanvasWriter` runs `attachCanvasPersistence`
   → `coldOpen()` only once `CanvasSync.subscribe` has resolved (its own comment states this). So the
   host seed's records are already in the doc when `coldOpen` runs, the doc is non-empty, and the
   doc-wins branch migrates exactly them. The host seed is covered *because* the migration is last.
3. **The charter names one call site.** §7: *"The call site belongs in `CanvasPersistence.coldOpen()`"*.
   Two call sites would also mean `canvas-sync.ts` — which is not the CRDT→disk owner — stamping a
   doc-level schema claim.
4. **`CanvasSync` can run without persistence attached** (guest paths, teardown races). Stamping
   `meta` from there would claim V2 for a doc no one is going to finish migrating.

---

## Visible Test Results

`cd plugin && npx vitest run src/__tests__/v2/wp18/ --reporter=dot` → **12 files / 15 tests, 15 passed, 0 failed.**

| Test | Status | Notes |
|---|---|---|
| TP01 host seed rejects invalid local record | PASS | `n-bad` absent, no husk container, `n-ok` present, signature names `host-seed` + `MISSING_TYPE`. |
| TP02 cold-open seed rejects invalid local record | PASS | Second seed path covered; signature names `cold-open-seed`. |
| TP03 capture boundary rejects invalid NEW record | PASS | `cap-bad` refused, `cap-good` created with `id`/`type`, `n1` untouched, signature names `capture-net`. |
| TP04 remote delta never rejected at ingest | PASS | One doc, one scenario; peer's `MISSING_TYPE` record survives with `text` intact, `type` not invented, zero signatures mentioning it. |
| TP05 create-once, complete, single transaction (2 tests) | PASS | 1 observed transaction; every record carries `size > 1`, its own `id` and its `type` at first sight. Re-seed preserves container identity and the peer's `color`. |
| TP06 seed is upsert-only (I7) | PASS | `color`, `background`, edge `color` survive; the file's `text`/`label` still land. |
| TP07 migration fires on the doc-non-empty branch | PASS | `meta.schemaVersion = 2`, `pos`/`size`/`from`/`to`, `ord` on every record. |
| TP08 migration call site idempotent | PASS | Second cold open: empty delta vs. the post-first-open state vector, zero `update` events. |
| TP09 migration additive, never destructive | PASS | Every original field incl. translated flat keys and `futureDecoration` present and unchanged. |
| TP10 already-V2 doc untouched | PASS | Zero delta, zero `update`, `meta` keeps value **and** container identity. |
| TP11 cold open leaves no record unmigrated (2 tests) | PASS | Seed branch and doc-wins branch: `schemaVersion = 2`, every record V2-ingest-valid, every record carries a string `ord`. |
| TP12 `PROTECTED_KEYS` survives as an exported constant (2 tests) | PASS | Membership unchanged; strict superset of `GEOMETRY_KEYS`. |

## Full-suite gate

`cd plugin && npx vitest run --reporter=dot`

```
Test Files   3 failed | 182 passed (185)
     Tests  30 failed | 1189 passed (1219)
```

`npx tsc -noEmit -skipLibCheck` → **clean, no output.**

Failing files: `canvas-sync.test.ts` (22), `canvas-persistence.test.ts` (5),
`w4-canvas-integrity.test.ts` (3). No WP18, WP8–WP17, WP1–WP6, T3, WP43–WP49 or blind bucket is red.

### The decisive counterfactual (how the classification was obtained, not argued)

One line changed — `admitRecordIngest` returns `ADMITTED` on the refusal branch — with **every other
part of WP18 in place** (migration ordering, flat seed, create-once, I7 retirement, register
precedence):

| Configuration | Visible WP18 | Total failures |
|---|---|---|
| **As shipped** | **15 / 15 PASS** | **30** |
| Refusal disabled, all other WP18 work live | 11 / 15 (TP01–TP04 fail, by construction) | **5** — TP01–TP04 + the `tx.count()` contradiction |

Therefore: **29 failures are attributable solely to the refusal**, **1 is the TC7 contradiction**, and
**every other part of WP18 is regression-free — Class B is empty by measurement.**

Refusals were then captured per test by temporarily printing `boundary / kind / id / reason` plus the
V2-converted record at the rejection branch; the instrumentation was removed and the tree re-verified
(`grep -c WP18TRACE src/ → 0`, tsc clean, 15/15 visible).

---

## Residual failure classification

### Class A — legacy fixture invalid under WP14

Fixtures are quoted as the `.canvas` file record; the "failing conjunct" column names the WP14
conjunct and reason code observed on the **V2-converted** record (`toV2Node`/`toV2Edge`), i.e. after
Correction 2's rule is already applied.

**A1 — `type:"text"` / `type:"file"` node with no type-specific payload → `MISSING_TYPE_SPECIFIC`**
(WP14 `NODE_TYPE_SPECIFIC`: `text → text`, `file → file`)

| Test | File | Fixture | Failing conjunct |
|---|---|---|---|
| AC13: with CanvasPersistence attached, ONE remote delta = exactly ONE disk write | `canvas-persistence.test.ts` | `{id:"n1", type:"text", x:0, y:0, width:100, height:50}` | type-specific → `MISSING_TYPE_SPECIFIC` (no `text`) |
| AC7: the persistence write opens CanvasSync's echo window, then closes it | `canvas-persistence.test.ts` | same | `MISSING_TYPE_SPECIFIC` |
| AC15: after a persistence write, an unchanged-content modify is a no-op (echo-breaker) | `canvas-persistence.test.ts` | same | `MISSING_TYPE_SPECIFIC` |
| AC17: coldOpen runs BEFORE start — a file→CRDT seed is never written straight back out | `canvas-persistence.test.ts` | `{id:"n1", type:"text", x:5, y:6, width:100, height:50}` | `MISSING_TYPE_SPECIFIC` |
| A6 US3 AC11: a node's `type` survives BOTH delete paths | `w4-canvas-integrity.test.ts` | `{id:"n1", type:"text", x:0, y:0, width:100, height:50}` | `MISSING_TYPE_SPECIFIC` |
| C1 a real CanvasSync + a real CanvasPersistence over one vault adapter = ONE write per change | `w4-canvas-integrity.test.ts` | `{id:"n1", type:"text", …}` + `{id:"n2", type:"text", x:300, y:0, width:100, height:50}` | `MISSING_TYPE_SPECIFIC` (both) |
| C2 noteExternalDiskWrite opens CanvasSync's echo window and advances its baseline | `w4-canvas-integrity.test.ts` | same | `MISSING_TYPE_SPECIFIC` |

**A2 — node with no `type` at all → `MISSING_TYPE`** (WP14 conjunct 2, via WP11 `readRecordType`)

| Test | File | Fixture | Failing conjunct |
|---|---|---|---|
| handleLocalModify updates Y.Map from disk content | `canvas-sync.test.ts` | `{id:"new-node", x:100, y:200}` (capture boundary, NEW record) | `type` → `MISSING_TYPE` |
| concurrent node moves merge correctly via shared Y.Doc | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}`, `{id:"n2", x:100, y:100}` | `MISSING_TYPE` (both) |
| local move of one node does not clobber an un-flushed remote move of another | `canvas-sync.test.ts` | same | `MISSING_TYPE` |
| local add-node does not clobber an un-flushed remote key edit | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}` | `MISSING_TYPE` |
| genuine local delete removes the node from the Y map | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}`, `{id:"n2", x:100, y:100}` | `MISSING_TYPE` |
| read-only guard prevents pushing local edits | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}` | `MISSING_TYPE` |
| canWriteNode=false drops a local node edit in the diff path | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}` | `MISSING_TYPE` |
| canDeleteNode=false blocks a local delete of a peer-held node | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}`, `{id:"n2", x:1, y:1}` | `MISSING_TYPE` |
| drops an un-flushed local edit when a remote peer holds the node (US5 AC2) | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}` | `MISSING_TYPE` |
| never serializes a dangling edge to disk (US5 AC3) | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}` (refused at `host-seed` AND `cold-open-seed`) | `MISSING_TYPE` |
| a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5) | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0}` | `MISSING_TYPE` |
| the tiebreak loser is denied, holds its baseline, reverts once, and lands on the winner's coords | `canvas-sync.test.ts` (`CanvasSync + CanvasPresence loser-revert (US2 AC9)`) | `{id:"n1", x:0, y:0, width:100, height:60}` | `MISSING_TYPE` |

**A3 — node with no `width`/`height` → `MISSING_SIZE`** (WP14 conjunct 4, via WP9 `isSizeRegister`)

| Test | File | Fixture | Failing conjunct |
|---|---|---|---|
| a genuine local DELETE of a whole record is still honoured (protection is per-key only) | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0, type:"text"}`, `{id:"n2", x:9, y:9, type:"text"}` | `size` → `MISSING_SIZE` |
| audits a live node missing `type` and a type:file node missing `file` (US3 AC12/AC13) | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0, type:"text", text:"hi"}`, `{id:"n2", x:9, y:9, type:"file", file:"a.md"}`, `{id:"n3", x:5, y:5, type:"text", text:"fine"}` | `MISSING_SIZE` (all three) |
| emits NO signature for a fully healthy canvas (no false positives) | `canvas-sync.test.ts` | `{id:"n1", x:0, y:0, type:"text", text:"hi"}`, `{id:"n2", x:9, y:9, type:"file", file:"a.md"}` + edge below | `MISSING_SIZE` |

**A4 — edge whose file record omits `fromSide` / `toSide` → `MISSING_FROM`**

WP14 asks WP10's `hasBothEndpoints`. WP10's `encodeEndpointFromFile` builds an endpoint register only
from a **whole** `{node, side}` pair (`encodeEndpoint` throws on an empty `side`), and
`isEndpointRegister` reads a side-less value back as *absent*. JSON Canvas makes `fromSide`/`toSide`
optional, so a fully-connected side-less edge has no representable V2 endpoint and reads as
`MISSING_FROM`. **No conversion can fix this without inventing a `side`** — and inventing one would
admit a record that `migrateV1ToV2` also cannot bring to V2 (`migrateEndpoint` calls the same
`encodeEndpointFromFile`), leaving the doc permanently in the state WP20 quarantines. Refusal is the
coherent answer; the phasing question is WP9/WP10's endpoint model vs. the file format.

| Test | File | Fixture | Failing conjunct |
|---|---|---|---|
| subscribe as host populates Y.Map from file content | `canvas-sync.test.ts` | edge `{id:"e1", fromNode:"n1", toNode:"n1"}` | `from.node` → `MISSING_FROM` (no `fromSide`) |
| getCanvasSnapshot returns the dangling-edge-pruned shared snapshot | `canvas-sync.test.ts` | node `{id:"n1", x:5, y:6, width:100, height:80}` → `MISSING_TYPE`; edges `{id:"e1", fromNode:"n1", toNode:"n1"}` and `{id:"e2", fromNode:"n1", toNode:"ghost"}` | `MISSING_TYPE` + `MISSING_FROM` |
| edge write is denied while a peer holds one of its endpoint nodes (US2 AC1) | `canvas-sync.test.ts` | nodes `{id:"n1", x:0, y:0}`/`{id:"n2", x:100, y:100}`; edge `{id:"e1", fromNode:"n1", toNode:"n2", toSide:"left"}` | `MISSING_TYPE` + `MISSING_FROM` (`to` register builds, `from` does not) |
| edge write is allowed while both endpoint nodes are free (US2 AC1, default-allow) | `canvas-sync.test.ts` | same | `MISSING_TYPE` + `MISSING_FROM` |
| a changed edge that still exists is merged per key, never re-created (US2 AC2) | `canvas-sync.test.ts` | same | `MISSING_TYPE` + `MISSING_FROM` |
| keeps an edge's fromNode/toNode when the full-merge branch sees a partial local record (US3 AC9) | `canvas-sync.test.ts` | nodes as above; edge `{id:"e1", fromNode:"n1", toNode:"n2", toSide:"left"}` | `MISSING_TYPE` + `MISSING_FROM` |
| keeps an edge's endpoints when the key-diff branch sees a partial local record (US3 AC9) | `canvas-sync.test.ts` | same | `MISSING_TYPE` + `MISSING_FROM` |

*(The `emits NO signature for a fully healthy canvas` row in A3 also carries edge
`{id:"e1", fromNode:"n1", toNode:"n2"}` → `MISSING_FROM`; it is listed once, under A3.)*

**Cascade note (not a separate class).** Several of the above additionally show
`capture-net … MISSING_ID` with a proposal like `{x:5}` or `{}`. That is the *downstream* consequence
of the same class-A refusal, not an independent failure: the seed refused the record, so it is not in
the doc, so `doc ∪ proposal` for a later field-level capture intent is the bare field diff, which
carries no `id`. Restore the record and the merge supplies `id` (proved by TP03/TP05, which exercise
exactly this path on admitted records).

**Class A total: 29.** Not one of them was fixed by special-casing, by softening WP14, or by editing
a fixture — no test file was touched.

### Class B — my defects (must be empty)

**EMPTY.** Established by the counterfactual above: with the refusal branch disabled and every other
WP18 change live, the full suite has 5 failures, 4 of which are the WP18 tests that exist to assert
the refusal, and the 5th is the TC7 spec contradiction. No failure in the tree is attributable to the
migration ordering, the seed vocabulary, create-once, the I7 retirement, the register precedence fix
or the signature format.

### Neither class — the one spec contradiction

| Test | File | Why it is neither |
|---|---|---|
| non-empty doc + stale file → doc wins, file overwritten, NO file→CRDT read | `canvas-persistence.test.ts` | It asserts `expect(tx.count()).toBe(0)` (*"doc-wins path opens no transaction on the doc"*) over the fixture `{id:"n1", type:"text", x:100, y:100, width:100, height:50}` — a non-empty **unstamped V1** doc. Charter §7 TC7 requires that exact branch to migrate exactly that doc class, and `migrateV1ToV2` opens one transaction to do it. `countTransactions` hooks bare `afterTransaction`, so no origin/locality loophole exists. Mutually exclusive; survives with the gate forced open, so it is caused by the charter-ordered call site, not by the gate. |

### Correction 2, measured

Correction 2's stated symptom is falsified by the same instrumentation that classified everything
else, and I am reporting the measurement rather than the expectation:

- For the fixture named in Correction 2, **`nodesMap.size` is `1`, not `0`.** The node
  `{id:"n1", x:0, y:0, width:100, height:100, type:"text", text:"Hello"}` is **admitted**. The assertion
  that fails is the next line, `expect(edgesMap.size).toBe(1)` — it is the **edge** that is refused.
- The prescribed fix — "judge validity on the V2-converted view" — was **already implemented in
  attempt 1** (`projectPostWriteRecord` → `toV2Node`/`toV2Edge`) and is what makes that node pass:
  without the conversion the node fails `MISSING_POS`, because the doc-vocabulary `pos` register does
  not exist on a flat file record. It is retained and now documented as load-bearing.
- The residual is therefore **not** a geometry/presentation defect. It is A4 above: WP10's endpoint
  register requires a `side` that JSON Canvas makes optional. I could only make it green by
  fabricating a `side`, which would (a) invent data at a validity boundary and (b) admit a record the
  migration itself cannot bring to V2. I did neither, and report it as class A with the exact conjunct
  instead.

---

## Summary for Worker 3

Corrections 1 and 2 are done and the ordering is now the one you specified: `coldOpen` seeds first in
the **flat** vocabulary and migrates afterwards, only ever on a doc that actually holds records, so
nothing lands behind the one-shot `meta` guard, `decodeCanvasDataToFlat` stays alive as the P1
scaffold it is, and TP11's `ord`-presence discriminator is satisfied the only way it can be — by
`assignOrds` inside a migration that genuinely ran over the seeded records. The three legacy failures
attempt 1 blamed on ordering (TC7's doc-wins case aside) are gone. I decided **not** to add a second
migration call in `CanvasSync.subscribe`: production wires `coldOpen` after `subscribe` resolves, so
the host seed's records are migrated by the doc-wins branch anyway, and a second call site would give
the one-shot guard two racing arming points — the exact hazard Correction 1 removes.

The residual is 30, and it is now measured rather than argued: **29 class A, 0 class B, 1 spec
contradiction.** The class-A causes are *not* what attempt 1 claimed — empty `text:""` never appears
in any failing fixture. The real four are: `type:"text"`/`type:"file"` nodes carrying no `text`/`file`
(7 tests), nodes with no `type` at all (12), nodes with no `width`/`height` (3), and **edges whose
file record omits `fromSide`/`toSide`** (7). That last one is the interesting one and it is the
phasing question I need you to rule on: WP10's endpoint register requires a `side`, JSON Canvas makes
it optional, and WP14 asks `hasBothEndpoints` — so a perfectly connected `{fromNode, toNode}` edge is
`MISSING_FROM`. It cannot be fixed by conversion, because `migrateV1ToV2` uses the same encoder and
would leave such an edge un-migratable even if I admitted it. The other decision you owe me is
narrower: TC7 versus `canvas-persistence.test.ts`'s `tx.count() === 0`, one test, irreconcilable by
construction. Everything else in WP18 — all four ACs, the migration call site on both branches, the
`decodeV2RecordToFlat` collision fix — is green and regression-free, and the counterfactual run
(one line, the gate forced open) reproduces the whole classification in about 45 s.

---

# Amendment — B3b / E3: the migration origin and the amended `tx` instrument

**Attempt:** 1 (of this amendment) · **Date:** 2026-08-02 · **Status:** DONE
**Authority:** `TaskCharter_WP18_IngestCreateOnceWiring.md` §4b, E3 subsection (Worker 2 ruling).

This section is additive. Nothing above it is retracted — in particular the migration
call site, which E3 ratifies as correct and which was **not** moved.

## What was ruled, and what that made necessary

The spec contradiction reported in the Summary above ("TC7 versus `tx.count() === 0`, one
test, irreconcilable by construction") is resolved in favour of the **call site**. The
instrument is what changes: `tx.count() === 0` was a proxy for the test's actual subject —
its own title, *"NO file→CRDT read"* — valid only while a file→CRDT seed was the sole thing
that could open a transaction on the doc-wins branch. The V1→V2 migration is a doc-internal
translation that reads nothing from the file, so the proxy had begun forbidding a
transaction the spec mandates while still not pinning the property it exists to protect.

That makes the migration's transaction something an observer must be able to **name**, not
merely count — hence a distinct origin.

## Changes made

| File | Change |
|---|---|
| `plugin/src/canvas/canvas-schema.ts` | New exported `CANVAS_MIGRATION_ORIGIN: unique symbol`; `migrateV1ToV2` now transacts as `doc.transact(fn, CANVAS_MIGRATION_ORIGIN)`. |
| `plugin/src/files/canvas-persistence.ts` | Re-exports `CANVAS_MIGRATION_ORIGIN` beside `CANVAS_SEED_ORIGIN` (line 79) so both origins import from one place. |
| `plugin/src/__tests__/canvas-persistence.test.ts` | `countTransactions` gains `countWithOrigin(origin)`; the one `tx.count()` conjunct in the doc-wins test is replaced by the three required ones. |

**Where the symbol is declared, and why not beside the seed's.** `canvas-persistence.ts`
already imports `migrateV1ToV2` from `canvas-schema.ts`. Declaring the origin in
`canvas-persistence.ts` would have made the pure core import the persistence layer and
closed an import cycle over a `Symbol()` initialiser — an evaluation-order hazard for no
gain. It is declared next to the transaction it stamps and **re-exported** from
`canvas-persistence.ts`, so the charter's "sibling exported symbol" holds at the import
site while ownership stays with the module that owns the migration.

**Behavioural neutrality of the origin.** Yjs's `Transaction.local` flag is independent of
the origin argument, so the migration's transaction is still local. Every downstream origin
filter in the tree was checked and none changes verdict: `canvas-binding.ts:198`
(`tr.local || tr.origin === CANVAS_BINDING_ORIGIN` — already skipped via `tr.local`),
`sync/sync.ts:250` (`origin === this`) and `sync/sync.ts:262` (`origin === "remote"`) all
saw `undefined` before and see a symbol now; neither value matches either guard.

## The amended assertion

Replaced (one line):

```ts
expect(tx.count()).toBe(0); // doc-wins path opens no transaction on the doc
```

with, all three of which must hold:

```ts
expect(tx.countWithOrigin(CANVAS_SEED_ORIGIN)).toBe(0);      // the subject, pinned directly
expect(tx.countWithOrigin(CANVAS_MIGRATION_ORIGIN)).toBe(1); // exactly one, not "at least one"
expect(tx.count()).toBe(1);                                  // and nothing else transacted
```

Strictly stronger: the old form admitted any world with zero transactions, including one
where the migration silently never ran. The new form pins the absence of the seed **by
name**, pins the migration to exactly one occurrence, and still closes the total — an
unstamped (`undefined`-origin) transaction matches neither named origin and is caught by
the third conjunct. Every other assertion in the test — `result === "doc-wins"`,
`io.read` never called, the file overwritten byte-for-byte with `serializeCanvas(doc)`,
and `not.toContain("STALE")` — is **untouched**.

`countWithOrigin` is a test-local extension of the existing `countTransactions` helper. No
observability was added to production code beyond the exported origin symbol itself.

## Falsification (required proof that the new assertions bite)

The origin argument was temporarily removed from `migrateV1ToV2`'s `doc.transact` call
(bare/undefined origin) and the test re-run:

```
FAIL  non-empty doc + stale file → doc wins, file overwritten, NO file→CRDT read
AssertionError: expected +0 to be 1   at canvas-persistence.test.ts:428
                                      (tx.countWithOrigin(CANVAS_MIGRATION_ORIGIN))
```

The conjunct fails exactly where it should. The origin was restored and the test re-run
green. A migration that transacts without its origin cannot satisfy this test.

## Measurement

| | failed | passed | total |
|---|---|---|---|
| Before | 25 | 1234 | 1259 |
| After  | **24** | **1235** | **1259** |

Test count unchanged (1259 → 1259) — no test added, deleted, skipped or renamed.

- **RED → GREEN (1):** `canvas-persistence.test.ts > CanvasPersistence.coldOpen — load path (SPEC_03 §4/§8) > non-empty doc + stale file → doc wins, file overwritten, NO file→CRDT read`
- **GREEN → RED (0):** none.

`npx tsc --noEmit` from `plugin/`: clean, exit 0. The `wp5/latency.test.ts` timing-band
flake did not fire in either the before or the after run.

## What remains red, and why it is not this step's

All 24 residual failures are the **class-A legacy-fixture** set already classified above
(`canvas-sync.test.ts` ×17, `canvas-persistence.test.ts` ×4, `w4-canvas-integrity.test.ts`
×3) — fixtures that are not legal JSON Canvas records under WP14. Per §4b's mandatory
licence ordering, they are step 3 (the fixture-completion licence) and are **only** to be
touched after E1's model fixes are re-measured. No fixture was edited here.

The set is identical before and after this change; nothing in it is caused by, or masked
by, the migration origin.


---

# Amendment — B3b step 3: the fixture-completion licence (2026-08-02)

Appended, not overwriting. Executes **only** step 3 of TaskCharter §4b *"The three
licences, and the order they must be exercised in"*. Steps 1 and 2 (land E1/E3, re-measure)
were already complete at entry; the measured entry state was **24 failed | 1247 passed
(1271)**, tsc clean, build PASS.

**Nothing outside the three test files was changed.** `plugin/src/files/canvas-sync.ts` was
verified byte-identical (md5 `aa8a6efb66d8711bdf72526116947185`) before and after the whole
step, including after every falsification mutation.

## 0. Licence gate 1 — proving every one of the 24 is an ingest refusal and nothing else

The ratified counterfactual method was used before a single fixture was touched:
`admitRecordIngest` was temporarily forced to `return ADMITTED` unconditionally and the
three files re-run.

```
gate forced open →  3 files, 104 tests, 104 passed (0 failed)
gate restored    →  3 files, 104 tests,  24 failed
```

All 24 failures are caused **solely** by the record being refused at ingest. No test in
these files is failing for any other reason, so completing a fixture is licensed for each
of them and for nothing else. The temporary patch was reverted and the file hash re-checked.

## 1. Ledger — every edited fixture

46 object literals across 3 files, serving the 24 tests. **Every** id, coordinate, edge
topology and every value any assertion reads is byte-identical; only format-required keys
with neutral values were appended to the end of each literal. No assertion, matcher,
strictness level, `skip`, `only`, title or `describe` was touched — verified mechanically
by diffing for `expect|toBe|toEqual|toHaveLength|it(|describe(|test(|.skip|.only`: zero
hits.

Neutral values used: `width: 100`, `height: 50`, `type: "text"`, `text: ""`. `text: ""` is
a legal JSON Canvas text card under the WP14 E1-b amendment.

### `plugin/src/__tests__/canvas-sync.test.ts` — 17 tests, 38 literals

| Test title | Line(s) | Keys added | Why the record was genuinely invalid JSON Canvas |
|---|---|---|---|
| handleLocalModify updates Y.Map from disk content | 209 | `width:100, height:50, type:"text", text:""` | node carried only `id`/`x`/`y` — no `type`, no size, no type payload |
| concurrent node moves merge correctly via shared Y.Doc | 244, 245 | `width:100, height:50, type:"text", text:""` | same |
| local move of one node does not clobber an un-flushed remote move of another | 288, 289, 309, 310 | `width:100, height:50, type:"text", text:""` | same |
| local add-node does not clobber an un-flushed remote key edit | 328, 345, 346 | `width:100, height:50, type:"text", text:""` | same |
| genuine local delete removes the node from the Y map | 364, 365, 384 | `width:100, height:50, type:"text", text:""` | same |
| read-only guard prevents pushing local edits | 397, 405 | `width:100, height:50, type:"text", text:""` | same |
| canWriteNode=false drops a local node edit in the diff path | 484, 491 | `width:100, height:50, type:"text", text:""` | same |
| canDeleteNode=false blocks a local delete of a peer-held node | 520, 521, 531 | `width:100, height:50, type:"text", text:""` | same |
| drops an un-flushed local edit when a remote peer holds the node (US5 AC2) | 563, 578 | `width:100, height:50, type:"text", text:""` | same |
| never serializes a dangling edge to disk (US5 AC3) | 625 | `width:100, height:50, type:"text", text:""` | same |
| getCanvasSnapshot returns the dangling-edge-pruned shared snapshot | 690 | `type:"text", text:""` | size present, but no `type` and therefore no type payload |
| a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5) | 850, 851 | `width:100, height:50, type:"text", text:""` | node carried only `id`/`x`/`y` |
| keeps an edge's fromNode/toNode when the full-merge branch sees a partial local record (US3 AC9) | 949, 950 | `width:100, height:50, type:"text", text:""` | the two NODES were `id`/`x`/`y` only; the edge itself is untouched |
| a genuine local DELETE of a whole record is still honoured (protection is per-key only) | 1013, 1014, 1028 | `width:100, height:50, text:""` | `type: "text"` present but no size and no `text` payload |
| audits a live node missing `type` and a type:file node missing `file` (US3 AC12/AC13) | 1042, 1043, 1044 | `width:100, height:50` | complete but for `width`/`height` |
| emits NO signature for a fully healthy canvas (no false positives) | 1075, 1076 | `width:100, height:50` | complete but for `width`/`height` |
| the tiebreak loser is denied, holds its baseline, reverts once, and lands on the winner's coords | 1145, 1196 | `type:"text", text:""` | size present, no `type`, no type payload |

### `plugin/src/__tests__/canvas-persistence.test.ts` — 4 tests, 4 literals

All four carried `{ id, type: "text", x, y, width, height }` and **no `text`** — a JSON
Canvas `text` node without its required `text` field. Added key in every case: `text: ""`.

| Test title | Line |
|---|---|
| AC13: with CanvasPersistence attached, ONE remote delta = exactly ONE disk write | 500 |
| AC7: the persistence write opens CanvasSync's echo window, then closes it | 655 |
| AC15: after a persistence write, an unchanged-content modify is a no-op (echo-breaker) | 681 |
| AC17: coldOpen runs BEFORE start — a file→CRDT seed is never written straight back out | 785 |

### `plugin/src/__tests__/w4-canvas-integrity.test.ts` — 3 tests, 4 literals

Same defect, same single added key `text: ""`.

| Test title | Line(s) |
|---|---|
| A6 US3 AC11: a node's `type` survives BOTH delete paths | 313 (`full` only — the two partial fixtures at 316/322 deliberately omit `type` and are the SUBJECT; left untouched) |
| C1 a real CanvasSync + a real CanvasPersistence over one vault adapter = ONE write per change | 555, 556 |
| C2 noteExternalDiskWrite opens CanvasSync's echo window and advances its baseline | 601 |

### What was deliberately NOT edited

- **No `fromSide` / `toSide` was added anywhere.** Both are optional in JSON Canvas
  (E1 / WP10 AC5 / WP14's direct pin); adding one would be an unlicensed edit that
  fabricates data the user never authored.
- Fixtures of tests that were **already green** — including `twoNodesOneEdge`,
  `does NOT resurrect a remote-deleted node`, `canWriteNode=false drops a brand-new local
  node`, w4 `A5`/`A7` — even where they carry the identical invalid shape. Their failure
  is not the licence's subject.
- The partial/stale fixtures that are each test's own subject (the omitted `type` in
  A6/US3 AC11, the endpoint-less edge record in US3 AC9).

## 2. Falsification — every named subject family still bites

Method: break the SUBJECT in production (never the fixture), re-run the three files, confirm
the test fails on **its own** assertion, restore, re-verify the file hash. Eight mutations
were run in three rounds.

| Family | Mutation | Representative test | Result |
|---|---|---|---|
| dangling-edge pruning | F1 — `buildCanvasData`'s two endpoint-visibility `continue` guards removed | `never serializes a dangling edge to disk (US5 AC3)` | **RED** — `expected [ { id: 'e2', … } ] to have a length of +0 but got 1`. Also caught `getCanvasSnapshot returns the dangling-edge-pruned shared snapshot` (`length 1 but got 2`) and two unrelated green tests. |
| lock denial | F2 — `canWriteEntity` returns `true` for every node | `a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5)` | **RED** — `expected 999 to be +0`. Also caught `canWriteNode=false drops a local node edit`, `drops an un-flushed local edit… (US5 AC2)` and the loser-revert test (`expected 50 to be 300`). |
| echo window | F3 — `isRecentDiskWrite` always returns `false` | `AC7: the persistence write opens CanvasSync's echo window, then closes it` | **RED** — `expected false to be true`. Also caught w4 `C2` and w4 `A1`. |
| delete paths | F4 — `maps[del.kind].delete(del.id)` suppressed | `genuine local delete removes the node from the Y map` | **RED** — `expected 2 to be 1`. Also caught `a genuine local DELETE of a whole record is still honoured` (`expected YMap{…} to be undefined`). |
| merge | F5 — shadow rebase forced off (observation-as-intent) | `local move of one node does not clobber an un-flushed remote move of another` | **RED** — `expected 100 to be 999`. Also caught `local add-node does not clobber an un-flushed remote key edit` (`expected '' to be 'remote'`). |
| merge (2nd, per-field) | F11 — capture path rebuilds the record instead of merging per field | `keeps an edge's fromNode/toNode when the full-merge branch sees a partial local record (US3 AC9)` | **RED** — `expected undefined to be 'n1'`. Also caught w4 `A6` (`type deleted via applyKeyDiff`) and five other green tests. |
| (extra) read-only gate | F7 — `if (!this.canWrite(path)) return;` removed | `read-only guard prevents pushing local edits` | **RED** — `expected 500 to be +0` |

All five families named in the licence bite. Every mutation was reverted; the final
`canvas-sync.ts` is byte-identical to the pre-step file.

## 3. Findings — dead and weak tests (reported, not silently left green)

**FINDING 1 (dead test).** `canvas-sync.test.ts:515` —
`canDeleteNode=false blocks a local delete of a peer-held node`.
Mutation **F6** removed the `canDeleteNode` gate entirely
(`if (!this.canDeleteNode(...))` → `if (false)`) and **no test failed**. The test cannot
observe the removal of the very gate it names. Cause: it never calls
`setSurfaceStateProvider`, so WP4's delete rule (open view + hand-over receipt) plans no
delete intent at all and the gate is never reached. Its sibling
`genuine local delete removes the node from the Y map` — which does set the provider — was
correctly caught by F4. This is a **pre-existing** defect, not created by the fixture
completion: the fixture edit makes the test pass because the record is now admitted
(`toBeDefined()`), which is exactly the licensed reason, but the test no longer pins US3
AC7. Repairing it requires adding a surface-state provider to the test body, which is
outside this licence.

**FINDING 2 (vacuously green, NOT edited).** `canvas-sync.test.ts:499` —
`canWriteNode=false drops a brand-new local node`. Its fixture
`{ id: "n2", x: 1, y: 1 }` is refused at ingest, so `expect(nodesMap.get("n2")).toBeUndefined()`
holds whatever the lock gate does — confirmed by F2, under which this test stayed green.
It is currently green for the wrong reason. Its fixture was **not** completed: the test is
not failing, so editing it is explicitly unlicensed. Flagged for a follow-up WP.

**FINDING 3 (dead production export).** `applyToYMap` in `canvas-sync.ts:1371` is exported
but has **no production caller** — mutations F8 and F9, which rewrote it to delete
omitted keys and to drop records, changed nothing in any test. The w4 tests titled
`A1 applyToYMap branch …` and `A2 applyKeyDiff branch …` are alive (F11 and F3 catch them)
but now exercise the capture path, not the functions their titles name. Naming drift, not
a correctness defect.

**FINDING 4 (weak test).** `concurrent node moves merge correctly via shared Y.Doc` was not
falsifiable by any of the eight mutations. It performs two `doc.transact` calls on the
shared doc and asserts the results — it pins Yjs's own `Y.Map` semantics, not project code.
Completing its fixture is still licensed and still necessary (without admission the records
do not exist and it dies with a `TypeError`), but it carries no behavioural signal beyond
"the seed admitted both records".

**FINDING 5 (coverage gap, informational).** Mutations F8b and F10 broke
`writeRecordCreateOnce` (I7 delete-by-omission at the seed; container replacement instead of
in-place merge) and **no test in these three files** noticed. That surface is covered by
WP18's own visible tests in `src/__tests__/v2/wp18/` (TC5/TC6), which are outside the three
files under this licence and stayed green throughout — noted so the gap is not mistaken for
an uncovered property.

## 4. Measurement

| | failed | passed | total |
|---|---|---|---|
| Before | 24 | 1247 | 1271 |
| After  | **0** | **1271** | **1271** |

**Test count unchanged: 1271 → 1271.** No test added, deleted, skipped, renamed or
re-`describe`d. The −2 the charter licensed (the ratified `tp08` deletion) was already
taken before this step and is not part of this movement.

- **RED → GREEN (24):** exactly the 24 enumerated in §1 — `canvas-sync.test.ts` ×17,
  `canvas-persistence.test.ts` ×4, `w4-canvas-integrity.test.ts` ×3.
- **GREEN → RED (0):** none.
- **Left red (0):** none. No test required an unlicensed edit and no ESCALATE was triggered.

### Gate status

| Gate | Command (from `plugin/`) | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | clean, exit 0 |
| Build | `npm run build` | PASS |
| Suite | `npm test -- --reporter=dot` | `195 passed (195)` files, `1271 passed (1271)` tests, ~43 s |
| Suite (confirmation run) | `npm test -- --reporter=dot` | `1271 passed (1271)` — identical |

The `src/__tests__/wp5/latency.test.ts` RTT-band flake did **not** fire in either run, so no
pairing was required. Biome's whole-file `format` finding on the three touched files is the
known CRLF artifact; no reformatting was performed.
