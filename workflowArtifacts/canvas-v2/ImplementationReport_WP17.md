# Implementation Report — WP17

**WP:** WP17 — Canonical serializer V2 (C17, phase P1)
**Attempt:** 1
**Charter:** `workflowArtifacts/canvas-v2/TaskCharter_WP17_CanonicalSerializerV2.md`

---

## Status: DONE

All 12 visible tests pass. The whole `v2/` tree plus the four named load-bearing suites are
green (115 files / 478 tests). `npx tsc -noEmit -skipLibCheck` is clean. No existing test was
deleted, skipped, `.todo`'d, `.only`'d, commented out, weakened or relaxed.

---

## Completed Work

| AC | Claim | Status | Evidence |
|---|---|---|---|
| AC1 | Records emitted sorted by `(ord, id)`; `pos`/`size`/`from`/`to` expanded into the exact Obsidian file keys; `ord` never in the file | DONE | TP1 (ord beats id), TP2 (equal-ord id tiebreak), TP3 (no-ord degenerates to id-only), TP4 (`pos`/`size` → `x`/`y`/`width`/`height`, registers dropped), TP5 (`from`/`to` → `fromNode`/`fromSide`/`fromEnd`/`toNode`/`toSide`, no `toEnd`, registers dropped), TP6 (`ord` absent from records AND from the raw text via `/"ord"\s*:/`) |
| AC2 | Suppressed records not emitted; an edge whose endpoint record is suppressed is not emitted either | DONE | TP7 (tombstoned node dropped, siblings survive), TP8 (cascade: `e1` dropped while `n1`'s key is still present in `nodesMap`; control edge `e2` survives), TP9 (`on:true, q:true` suppressed through the same predicate) |
| AC3 | Two replicas with the same doc state produce byte-identical files, including after a reorder | DONE | TP10 (different Y.Map integration order + different per-record key insertion order → identical bytes, AND the emitted order is `ord` order, not `id` order), TP11 (agree before the reorder, agree after, and the post-reorder bytes genuinely differ and reflect the new sequence) |
| AC4 | Round-trip stability: `parse(serialize(state))` yields the same records and the same relative order | DONE | TP12 (`parseCanvas(serializeCanvas(...)).order.nodes` equals `buildCanvasData`'s emitted order; same id set; `pos` registers round-trip through `encodePos`) |

**Definition of Done** — "the file is a deterministic projection of the doc on every client" —
is met: the projection is a pure function of `(record state, tombstone state)` with no input
from `Y.Map` iteration order, no locale collator, no clock and no randomness.

---

## Blocked Items

None.

---

## Tools Created

None. No new runtime dependency, no new dev dependency, no new script. Everything needed was
already landed by WP9/WP10 (`canvas-registers.ts`), WP12 (`canvas-tombstone.ts`), WP13
(`canvas-ord.ts`) and P0 C3 (`canvas-canonical.ts`), and all four were imported rather than
re-derived.

---

## Changes Made

**One file changed: `plugin/src/files/canvas-sync.ts`.** Nothing else in the repo was touched.

- **Imports.**
  - `canvas-canonical`: `canonicalizeCanvasData` and `serializeCanonicalCanvas` are no longer
    imported (see "The sort, stated precisely"); `canonicalizeRecord` plus the
    `CanvasRecord` / `CanvasRecordKind` types are imported in their place. `roundCanvasGeometry`
    is unchanged and still used by the capture path.
  - `canvas-registers`: added `V2_FIELD` (so the `"ord"` key name is WP9's constant, never an
    inline literal).
  - `canvas-tombstone`: added `TombstoneMap`, `isTombstoneSuppressed`, `readTombstoneEntry`.
  - `canvas-ord`: `compareOrdId` was already imported by WP16; it is now also WP17's comparator.
- **`decodeV2RecordToFlat`** — parameter type widened from `V2Node | V2EdgeRecord` to
  `V2Node | V2EdgeRecord | Readonly<Record<string, unknown>>`. Body untouched; the existing
  `decodeCanvasDataToFlat` call sites are unaffected. This lets the serializer reuse the one
  existing register-expansion routine instead of writing a second one.
- **New module-private helpers** (all directly above `buildCanvasData`):
  - `OrderedFileRecord` — a record plus its `OrdIdEntry` sort key plus its `Y.Map` iteration
    index (a local-only tiebreak, see below).
  - `isRecordSuppressed(deletedMap, id)` — the single call into WP12's predicate.
  - `toCanonicalFileRecord(source, kind)` — reads and strips `ord`, expands registers via
    `decodeV2RecordToFlat`, applies `canonicalizeRecord(record, kind)`.
  - `sortByOrdId(records)` — `compareOrdId` with the index tiebreak.
- **`buildCanvasData(nodesMap, edgesMap, deletedMap?)`** — rewritten body, new OPTIONAL third
  parameter. Return type unchanged.
- **`serializeCanvas(nodesMap, edgesMap, deletedMap?)`** — new OPTIONAL third parameter; body
  is now `JSON.stringify(buildCanvasData(...), null, "\t")`.
- Extensive comment block above `buildCanvasData` documenting the three transformations and,
  explicitly, why `canonicalizeCanvasData` is no longer on the path.

The two existing 2-argument call sites — `CanvasSync.getCanvasSnapshot` /
`onRemoteCanvasUpdate` inside this file, and `CanvasPersistence.flushToDisk`
(`canvas-persistence.ts:230`, re-exported at `:392`) — compile unchanged and keep their exact
current no-suppression behaviour, because `deletedMap === undefined` short-circuits
`isRecordSuppressed` to `false` for every id.

---

## The sort, stated precisely

```
sort key of a record R := ( ord(R), id(R) )

  ord(R) := R["ord"] when it is a string, else ""      ← V2_FIELD.ord, never the literal
  id(R)  := String(R.id ?? "")                         ← same expression canonicalizeCanvasData used

comparator := compareOrdId  from canvas-ord.ts (WP13)  ← compareOrd(ord) || compareOrd(id)
tiebreak   := Y.Map iteration index, reached only when (ord, id) are both equal
```

Four properties this pins:

- **`ord` decides, `id` only breaks ties.** TP1's ids are the exact reverse of their `ord`
  order and TP2 mixes a shared `ord` with a distinct lower one, so neither an id-only sort nor
  an ord-only sort passes both.
- **The comparator is WP13's and only WP13's.** No `<` on raw `ord` strings, no
  `localeCompare`, no numeric parse. WP16's `deriveOrdAssignments` already resolves the current
  order through the same `compareOrdId`; had WP17 chosen a different collation, both suites
  would still pass while two replicas silently produced different bytes — the exact failure
  AC3 exists to prevent.
- **The no-`ord` case degenerates to id-only order.** A record with no `ord` key contributes
  `""`, so a canvas where nothing has been migrated sorts purely by id — byte-identical to P0.
  This is what keeps the frozen `v2/wp3/test_two_client_bytes_visible.test.ts` ("buildCanvasData
  returns canonical, id-sorted records") green, and TP3 pins it against WP17's own AC1 wording.
- **The index tiebreak is unreachable for well-formed state.** It fires only for two records
  sharing both an `ord` and an `id`, i.e. duplicate ids — precisely the case
  `canonicalizeCanvasData` also resolved by input order (its own "stable sort" test). It exists
  so the sort's outcome does not depend on the engine's sort implementation.

### Why `canonicalizeCanvasData`'s id-only array sort was bypassed

`canvas-canonical.ts` does two separable jobs:

```
canonicalizeCanvasData(data)
  ├── canonicalizeRecord(record, kind)   ← per-record KEY order        ← WP17 KEEPS this
  └── decorated.sort(compareCodeUnits(id) || index)   ← ARRAY order, ID-ONLY   ← WP17 DROPS this
```

The array-level sort is correct *for P0* and is documented as such in the module header: "P1's
fractional index (`ord`, WP17) does not exist yet, so the id is the only order information both
peers provably share." In P1 it is actively wrong. Routing an already-`(ord, id)`-sorted array
through it **re-sorts by id and silently discards the ord order** — no throw, no warning, and
every replica does it identically, so *cross-replica byte equality still holds* and any test
that only checks "A's bytes == B's bytes" stays green. That is why TP10 asserts both halves
(equality **and** the actual emitted sequence): equality alone cannot distinguish a correct
implementation from one that dropped `ord` entirely.

`serializeCanonicalCanvas` is avoided for exactly the same reason — its first act is to call
`canonicalizeCanvasData`. `serializeCanvas` therefore stringifies `buildCanvasData`'s output
directly. The `.canvas` shape is unaffected: `buildCanvasData` returns the object literal
`{ nodes, edges }` in that key order, and `JSON.stringify(x, null, "\t")` is byte-for-byte what
`serializeCanonicalCanvas` used to emit — one top-level object, `nodes` before `edges`,
tab-indented, `\n` line endings, no trailing newline, no BOM. The P0 pin
`v2/wp3/test_file_shape_tabs_visible.test.ts` stays green, as does
`v2/wp3/test_two_client_bytes_visible.test.ts`'s "serializeCanvas is exactly the canonical
serialisation of buildCanvasData" (its fixture carries no `ord`, so both orders coincide and
the two expressions are equal by construction, not by luck).

`canonicalizeRecord` is still applied **per record, with the record's kind** — nodes against
`CANONICAL_NODE_KEY_ORDER`, edges against `CANONICAL_EDGE_KEY_ORDER` — so key order, the
unknown-key tail and the `undefined`-value omission are all unchanged. Canonicalisation is
still a reordering and nothing else: an unknown/future key still reaches disk rather than being
deleted on every peer.

---

## The suppression cascade, stated precisely

```
suppressed(id) := deletedMap !== undefined
                  && isTombstoneSuppressed(readTombstoneEntry(deletedMap, id))    ← WP12, verbatim

visibleNodeIds := { k ∈ nodesMap.keys() | ¬suppressed(k) }

node k is emitted  ⟺  k ∈ visibleNodeIds
edge k is emitted  ⟺  ¬suppressed(k)
                      ∧ (typeof record.fromNode !== "string" ∨ record.fromNode ∈ visibleNodeIds)
                      ∧ (typeof record.toNode   !== "string" ∨ record.toNode   ∈ visibleNodeIds)
```

Five points:

1. **One predicate, not three copies.** The suppression question is asked exactly once in this
   file, inside `isRecordSuppressed`, and that function's whole body is a call to WP12's
   `isTombstoneSuppressed` fed by WP12's `readTombstoneEntry`. There is no inline
   `entry?.on === true`, no local `isDeleted` helper and no second q-aware branch — C12 AC2
   requires "one shared predicate, not three copies", and TP9 falsifies any implementation that
   grew a separate quarantine rule.
2. **Quarantine is not special.** `isTombstoneSuppressed` is deliberately `q`-agnostic, so
   `{on:true, q:true}` drops the record through the identical code path as `{on:true}`. WP17
   never calls `isTombstoneQuarantined`; classification is not this component's question.
3. **The cascade and the GAP-5 prune are ONE rule.** In V2 a deleted node is *not* removed from
   `nodesMap` — deletion is a value, not an absence — so its key is still there and the old
   `nodeIds.has(...)` guard alone would happily keep an edge pointing at an invisible card
   (TP8 asserts `[...nodes.keys()]` still contains `n1`). Folding suppression into the very set
   that guard reads means the two questions cannot produce different answers. The GAP-5
   behaviour is otherwise untouched: `v2/wp3`'s "still prunes a dangling edge" and
   `w4-canvas-integrity`'s G4 both stay green.
4. **The endpoint ids are read AFTER register expansion**, so an edge carrying the atomic
   `from`/`to` registers is guarded exactly like one still carrying flat `fromNode`/`toNode`.
   Reading them before expansion would have made the cascade blind to every V2-shaped edge.
5. **The `typeof === "string"` condition is preserved verbatim from P0.** An edge that carries
   no endpoint string at all is still left alone here — that case belongs to the delete guards
   (`PROTECTED_KEYS`), and `canvas-sync.test.ts`'s "the dangling-edge serialization guard cannot
   catch an endpoint-LESS edge (it requires a string)" pins that division of labour.
6. **An edge is a record too**, so its own tombstone suppresses it (AC2 first clause), checked
   before the cascade.

With no `deletedMap` argument, `suppressed(id)` is `false` for every id, `visibleNodeIds` is
exactly `nodesMap.keys()`, and the whole block reduces to the pre-WP17 GAP-5 prune — which is
why the two existing 2-argument call sites are behaviourally untouched.

---

## Existing tests adjusted

**None.** Zero test files were created, deleted, renamed, or edited by this work package. The
12 `v2/wp17/*` files were already present at handover (11 red, 1 green — TP3, the backward
-compatibility guard). No assertion anywhere in the repo was removed, relaxed, skipped or
`.todo`'d, and no documented-seam adaptation was needed.

---

## Regression check

Command (from `plugin/`, per rule 8):

```
npx vitest run src/__tests__/v2/ src/__tests__/canvas-sync.test.ts \
  src/__tests__/canvas-persistence.test.ts src/__tests__/canvas-single-writer.test.ts \
  src/__tests__/w4-canvas-integrity.test.ts --reporter=dot
```

```
Test Files  115 passed (115)
     Tests  478 passed (478)
  Duration  9.22s
```

Load-bearing suites individually accounted for, all green:

| Suite | Why it is load-bearing here | Result |
|---|---|---|
| `v2/wp3/test_file_shape_tabs_visible.test.ts` | pins the `.canvas` bytes — tab-indented, `nodes` before `edges`, no trailing newline (rule 6) | PASS |
| `v2/wp3/test_two_client_bytes_visible.test.ts` | pins id-sorted output for a no-`ord` fixture AND `serializeCanvas === serializeCanonicalCanvas(buildCanvasData(...))` | PASS |
| `v2/wp3/test_record_order_no_ord_visible.test.ts` | pins P0's id-only order in `canvas-canonical` itself (unmodified) | PASS |
| `v2/wp16/*` | `parseCanvas` V2 + `deriveOrdAssignments`; shares `compareOrdId` with WP17 | PASS |
| `v2/wp12/*`, `v2/wp13/*`, `v2/wp9`, `v2/wp10` | the imported cores, including WP12's export-surface scan and WP13's no-mutating-export scan | PASS |
| `canvas-sync.test.ts` | the endpoint-LESS edge case and the delete guards | PASS |
| `canvas-persistence.test.ts` | the single writer's `serializeCanvas` snapshots | PASS |
| `canvas-single-writer.test.ts` | write-queue / echo-window behaviour over the serialised bytes | PASS |
| `w4-canvas-integrity.test.ts` | G4 dangling-edge prune + the end-to-end echo baseline | PASS |

Typecheck:

```
npx tsc -noEmit -skipLibCheck        →  clean, zero output
```

(No `src/__tests__/wp49/` errors were present in this run either; none were introduced.)

Biome (advisory locally, gating in CI) — **no new findings**. `npx biome check
src/files/canvas-sync.ts` reports the same three items before and after this change, verified
by re-running the check against a reconstruction of the pre-edit file:

| Finding | Origin |
|---|---|
| whole-file `format` | the documented CRLF environment artifact (Shared Ownership Contract §5) |
| `lint/style/useTemplate` at `:1214` | pre-existing, in the local-modify telemetry logger |
| `organizeImports` | pre-existing — WP16's `canvas-registers` specifier order, not WP17's blocks |

No mass reformat, no `lint --fix`, no `npm run build`, no version bump, no full `npm test`
(Worker 3 runs that once at the end of the batch, per rule 9).

---

## Visible Test Results

```
npx vitest run src/__tests__/v2/wp17/ --reporter=dot

Test Files  12 passed (12)
     Tests  12 passed (12)
  Duration  999ms
```

| TP | Test file | AC | Before | After |
|---|---|---|---|---|
| TP1 | `test_tp01_ord_primary_sort_visible.test.ts` | AC1 sort key | FAIL | PASS |
| TP2 | `test_tp02_equal_ord_id_tiebreak_visible.test.ts` | AC1 tiebreak | FAIL | PASS |
| TP3 | `test_tp03_missing_ord_id_only_fallback_visible.test.ts` | AC1 degenerate | PASS | PASS |
| TP4 | `test_tp04_node_geometry_register_expansion_visible.test.ts` | AC1 geometry | FAIL | PASS |
| TP5 | `test_tp05_edge_endpoint_register_expansion_visible.test.ts` | AC1 endpoints | FAIL | PASS |
| TP6 | `test_tp06_ord_absent_from_file_visible.test.ts` | AC1 `ord` absence | FAIL | PASS |
| TP7 | `test_tp07_tombstoned_record_suppressed_visible.test.ts` | AC2 suppression | FAIL | PASS |
| TP8 | `test_tp08_suppressed_endpoint_cascades_edge_visible.test.ts` | AC2 cascade | FAIL | PASS |
| TP9 | `test_tp09_quarantine_suppressed_like_delete_visible.test.ts` | AC2 quarantine | FAIL | PASS |
| TP10 | `test_tp10_replica_byte_identity_ord_order_visible.test.ts` | AC3 byte identity | FAIL | PASS |
| TP11 | `test_tp11_byte_identity_after_reorder_visible.test.ts` | AC3 after reorder | FAIL | PASS |
| TP12 | `test_tp12_round_trip_order_and_content_stability_visible.test.ts` | AC4 round trip | FAIL | PASS |

---

## Summary for Worker 3

- **WP17 is DONE on attempt 1.** One production file changed:
  `plugin/src/files/canvas-sync.ts` (`buildCanvasData`, `serializeCanvas`, four new
  module-private helpers, one widened parameter type, an import swap). Nothing else in the repo
  was touched — no `server/`, no `docker/`, no `deploy/`, no `main.js`, no `manifest.json`, no
  `package.json`, no `canvas-presence.ts` / `canvas-binding.ts` / `canvas-model-bridge.ts`, no
  version bump, no `npm run build`.
- **Signature change, as the charter pinned it:** `buildCanvasData(nodesMap, edgesMap,
  deletedMap?: TombstoneMap)` and `serializeCanvas(nodesMap, edgesMap, deletedMap?:
  TombstoneMap)`. The third parameter is optional; both existing 2-argument call sites compile
  and behave identically to before.
- **No test was touched.** Test count is unchanged; nothing was deleted, skipped or relaxed.
  The "Existing tests adjusted" section reads "none".
- **The one subtlety worth carrying forward:** `canonicalizeCanvasData` /
  `serializeCanonicalCanvas` must **never** sit downstream of an `ord`-ordered array. Their
  array sort is id-only and silently discards the order while *preserving* cross-replica byte
  equality, so the failure is invisible to any test that only compares two replicas' bytes.
  WP17 uses `canonicalizeRecord` (per record) and owns the array order itself. Any later WP
  that adds a serialisation path should do the same.
- **Deliberately NOT done (Shared Ownership Contract §3, WP18's scope):** no production caller
  passes a `deletedMap` yet — the `deleted` container is not reached from
  `CanvasPersistence`, the write boundaries are not wired to registers, and the temporary
  `decodeCanvasDataToFlat` bridge is still in place. WP17 landed the core plus the minimum
  integration its own ACs demand, nothing more.
- **Open risk for W4:** none. All four ACs are falsifiable at the pure
  `buildCanvasData` / `serializeCanvas` / `parseCanvas` function boundary; `W4 Test Targets`
  stays `0`.

---

# Amendment — WP17 REOPENED for AC5 (attempt 1, 2026-08-02)

**Status: DONE.** AC1–AC4 untouched and still green. AC5 (all three Parts of the
Worker 2 amendment at the bottom of TaskCharter §4) is now implemented and pinned.

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC5 Part 1 — optional endpoint keys omitted, side-less file byte-identical | DONE | Codec half had ALREADY landed with WP10 AC5 (`decodeEndpointToFile` gates `*Side` / `*End` on `isNonEmptyString`). WP17 adds the byte-identity **pin**, which is what the charter asks for. |
| AC5 Part 2 — no `null` / `""` via the verbatim flat-key pass | DONE | New drop rule in `decodeV2RecordToFlat`'s PASS 2. |
| AC5 Part 3 — flat-vs-register precedence, insertion-order independent | DONE | The two-pass fix was **already present** (landed in passing during WP18). Verified correct, re-commented with explicit WP17 ownership, and pinned by a named regression test. |

## Changes Made

- `plugin/src/files/canvas-sync.ts` — the only source file changed.
  - New module-private `TYPED_FILE_KEYS` (derived from `GEOMETRY_KEYS` + WP10's
    `ENDPOINT_FILE_KEYS` via the existing `ENDPOINT_FILE_KEY_SET`, so the ten literals
    are still spelt once) and `isJunkFileValue(key, value)`.
  - `decodeV2RecordToFlat` PASS 2 now skips a `null` / `""` sitting under one of those
    ten typed file keys. It is dropped, so it neither reaches disk nor overrides the
    register that still holds the real answer.
  - PASS 1's header comment gained an OWNERSHIP note: the two-pass precedence is now
    WP17's, and the property under test is insertion-order independence.
- `plugin/src/__tests__/v2/wp17/fixtures/sideless_edges.canvas` — **new fixture**
  (2 nodes, 3 edges: one side-less at both ends, one fully sided control, one
  asymmetric). Canonical bytes: `nodes` before `edges`, tab-indented, `\n`, no
  trailing newline, records id-sorted, canonical key order.
- `plugin/src/__tests__/v2/wp17/fixtures/.gitattributes` — **new**, `*.canvas -text`.
  The repo has `core.autocrlf=true` and no `.gitattributes`; without this a fresh
  Windows checkout would rewrite the fixture to CRLF and fail a byte-identity test for
  a reason that has nothing to do with the serializer.
- Three **new** test files (17 tests, all new — no existing test was edited, deleted,
  skipped, `.only`'d or weakened):
  - `test_tp13_sideless_edge_file_byte_identical_round_trip_visible.test.ts` (5)
  - `test_tp14_junk_flat_key_never_reaches_disk_visible.test.ts` (5)
  - `test_tp15_flat_over_register_precedence_is_insertion_order_independent_visible.test.ts` (7)

## Why the geometry half does NOT make required keys optional

`x` / `y` / `width` / `height` stay required numeric JSON Canvas keys. `TYPED_FILE_KEYS`
only says that a `null` / `""` sitting under one of them is **not a coordinate**. Where a
`pos` / `size` register knows the real geometry, the junk flat key is dropped and the
register's expansion survives — asserted in TP14. `GEOMETRY_KEYS` keeps exactly
`{x, y, width, height}` and stays exported; its membership was not touched.

The drop is deliberately scoped to the ten typed file keys. An unknown/future key with a
`null` value still passes through untouched — canonicalisation is a REORDERING, and
deleting a key this build does not understand would delete user data on every peer
(asserted in TP14's last case).

## Why the AC5 Part 3 test asserts insertion order, not the value

A value-only assertion ("the serialised `x` is the fresh one") passes **even with the
bug**, on any doc whose `Y.Map` insertion order happens to favour the flat key. And this
defect class is invisible to cross-replica byte equality (AC3) by construction: both
replicas converge on the SAME wrong value, so their bytes agree perfectly. TP15 therefore
builds the same logical record twice — stale register first, then fresh flat key; and the
exact reverse — and asserts the outcome is **unchanged**, including a byte-identity
assertion between the two files.

## Falsification (mutation-checked, all mutations reverted)

Each new test file was proven to fail against the defect it protects:

| Mutation | Result |
|---|---|
| `isJunkFileValue` guard disabled in PASS 2 | TP14: **4 of 5 fail** |
| `decodeV2RecordToFlat` collapsed back to a single insertion-order pass | TP15: **4 of 7 fail**, including both "opposite insertion order → same outcome" cases and the byte-identity case |
| `decodeEndpointToFile` made to emit `fromSide: null` | TP13: **3 of 5 fail** |

## Verification

- `npx tsc --noEmit` from `plugin/` — **clean**, no output.
- `npm test -- --reporter=dot` from `plugin/`, ~43 s per run.
  - **Before:** `25 failed | 1217 passed (1242)` — 188 test files.
  - **After:** `25 failed | 1234 passed (1259)` — 191 test files.
  - **+17 tests, all passing. Zero tests changed state in either direction.**
- `src/__tests__/v2/wp17` alone: **29 passed (29)** across 15 files (12 pre-existing + 17 new).

## Known suite flake (NOT caused by this change)

`src/__tests__/wp5/latency.test.ts > US6 — latency injection > harness injects a
measurable RTT inside the 50–150 ms band (US6 AC1)` is **flaky**: it failed in one of two
baseline runs *before* any change and in one of two runs *after*. Both a before-run and an
after-run scored `26 failed | ... (…)` with exactly this test as the 26th. The
25-vs-25 comparison above pairs the two clean runs.

## Left failing (pre-existing, untouched, out of WP17's scope)

The 25 failures are the same 25 as the baseline, in the same three files:
`canvas-persistence.test.ts` (5), `canvas-sync.test.ts` (17), `w4-canvas-integrity.test.ts`
(3). They are the fixture-shape failures the licensed legacy-fixture step owns — several
fail with `Cannot read properties of undefined (reading 'set')` because their fixtures are
invalid JSON Canvas records. Per the task's hard constraint, no other WP's fixture was
edited and they are left failing.

## Constraint conflict to flag

The task brief listed "do NOT touch `canvas-persistence.ts` or `canvas-sync.ts`" while
also naming `buildCanvasData` / `serializeCanvas` / `parseCanvas` / `decodeV2RecordToFlat`
as the work. **All four live in `plugin/src/files/canvas-sync.ts`** (they were never
relocated to `canvas-canonical.ts` / `canvas-schema.ts`), and TaskCharter §6 names
`plugin/src/files/canvas-sync.ts` as WP17's required changed file. The charter's Ownership
note ("the owner is the module, not the file") resolves it the same way. `canvas-sync.ts`
was therefore edited — narrowly, inside `decodeV2RecordToFlat` only.
`canvas-persistence.ts` was **not** touched. Neither was `canvas-registers.ts` (WP10's
model is correct and was left exactly as it landed), `canvas-canonical.ts`,
`canvas-presence.ts`, `canvas-binding.ts` or `canvas-model-bridge.ts`.
