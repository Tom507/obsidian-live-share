# Implementation Report — WP16

**WP:** WP16 — `parseCanvas` V2 + `ord` capture
**Phase:** P1
Attempt: 1

## Status:

`RISKY` — **SPEC_CONTRADICTION, escalated, not worked around.**

All four ACs are implemented and all 13 visible WP16 tests pass. All four load-bearing
suites pass unmodified (123/123). **One pre-existing test is now red and I have no licence
to touch it**: `plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts` asserts a
property that AC1 requires to be absent. It is a logical contradiction, not an
implementation defect — details and the exact test names in **Blocked Items**.

Nothing was deleted, skipped, `.todo`-ed, commented out, weakened or relaxed. The red test
is red and left red, deliberately, for Worker 3 to adjudicate.

---

## Completed Work

| AC | Statement (abbreviated) | Status | Where |
|---|---|---|---|
| AC1 | Parsing produces V2 records (`pos`, `size`, `from`, `to`) and preserves array order as an explicit observation | DONE | `parseCanvas`, `toV2Node`, `toV2Edge`, `RecordOrderObservation` |
| AC2 | `ord` reassigned **only** when relative order demonstrably changed; appends allocate at the end and touch no existing `ord` | DONE | `deriveOrdAssignments` |
| AC3 | On a detected reorder, the number of reassigned `ord` values is minimal | DONE | `longestIncreasingSubsequence` + `deriveOrdAssignments` |
| AC4 | Failure behaviour preserved: JSON error → empty records, no throw; entries without `id` dropped | DONE | `parseCanvas` `catch` branch + the unchanged `if (node.id)` truthiness check |

**Definition of Done** — "order round-trips through the file without churn on unchanged
documents" — is pinned by TC3 and passes: a byte-identical re-parse yields a reassignment
map of size 0.

---

## Blocked Items

**SPEC_CONTRADICTION — AC1 and an existing WP3 test cannot both hold.**

The two assertions, both against `parseCanvas` output for an edge carrying a complete
`fromNode` / `fromSide` / `toNode` / `toSide` set:

| | File | Test name | Line | Assertion |
|---|---|---|---|---|
| **WP16 (new, visible)** | `plugin/src/__tests__/v2/wp16/test_tp1_v2_record_shape_visible.test.ts` | `WP16 AC1 — parseCanvas produces V2-shaped records (pos/size/from/to)` › `an edge's flat fromNode/fromSide/toNode/toSide become one from register and one to register` | 73 | `expect("toSide" in edge).toBe(false)` |
| **WP3 (existing, red)** | `plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts` | `WP3 AC4 — the .canvas file shape is unchanged` › `round-trips through the unchanged parseCanvas reader` | 96 | `expect(data.edges.e1.toSide).toBe("left")` |

`edge.toSide` must be simultaneously **absent** and **`"left"`** on the same input class.
No implementation satisfies both. This is not a bridging problem — the decode bridge
(below) protects every *internal consumer* of `parseCanvas`, but this test asserts on
`parseCanvas`'s **return value directly**, which is exactly the surface AC1 changes.

The same line is also the **only** `tsc` error in the tree:

```
src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts(96,26):
  error TS2339: Property 'toSide' does not exist on type 'V2EdgeRecord'.
```

Note that line 95 of the same test (`data.nodes.n1.file`) still passes — content fields
pass through untouched. The contradiction is confined to the one endpoint assertion.

**Recommended resolution (NOT applied — outside my licence).** The assertion's *claim* is
"the canonical serialisation round-trips through the reader, and e1's `to` side is `left`".
That claim survives V2 verbatim through WP10's documented codec seam:

```ts
import { decodeEndpointToFile } from "../../../canvas/canvas-registers";
// line 96
expect(decodeEndpointToFile("to", data.edges.e1.to).toSide).toBe("left");
```

Nothing is removed and nothing is relaxed — this is precisely the "declare its precondition
through a documented seam" form the Shared Ownership Contract §4 permits. But §4 also says
the licensed deleters/adjusters for this initiative are **WP4 / WP21 / WP22 / WP33 only**,
and WP16 is not one of them. **Worker 3 must authorise it.** I did not apply it.

**Blast radius is exactly one line.** Full v2 tree + the four load-bearing suites: 466
tests, 465 pass, 1 fail — the one above.

---

## Tools Created

None. No new runtime dependency, no new dev dependency, no script, no `package.json` touch,
no version bump, no `npm run build`.

---

## Changes Made

### `plugin/src/files/canvas-sync.ts` (the WP's declared file)

- **New imports** (owned symbols only, nothing re-derived):
  - from `../canvas/canvas-ord` (WP13): `OrdIdEntry`, `OrdRng`, `allocateOrd`, `compareOrdId`
  - from `../canvas/canvas-registers` (WP9/WP10): `EndpointRegister`, `EndpointSlot`,
    `V2EdgeRecord`, `V2Node`, `ENDPOINT_FILE_KEYS`, `ENDPOINT_SLOTS`, `FROM_KEY`, `POS_KEY`,
    `SIZE_KEY`, `TO_KEY`, `decodeEndpointToFile`, `decodePos`, `decodeSize`,
    `encodeEndpointFromFile`, `encodePos`, `encodeSize`, `isEndpointRegister`,
    `isPosRegister`, `isSizeRegister`
- **New type `RecordOrderObservation`** — `{ readonly nodes: readonly string[]; readonly edges: readonly string[] }`.
- **`CanvasData` changed** — `nodes: Record<string, V2Node>`, `edges: Record<string, V2EdgeRecord>`,
  plus `order: RecordOrderObservation`. Same name, same export, new shape.
- **New type `FlatCanvasData`** — the pre-V2 flat, file-keyed shape, kept alive explicitly
  as a named temporary seam rather than as an untyped `Record`.
- **`parseCanvas` rewritten** — same signature, V2 output, order observation, unchanged
  failure semantics.
- **New private `toV2Node` / `toV2Edge`** — the file→doc translation, in-place: `pos` takes
  `x`'s key slot, `size` takes `width`'s, `from` takes `fromNode`'s, `to` takes `toNode`'s.
  Registers are built only from a WHOLE pair/triple; a partial disk read keeps its flat keys
  instead of losing them to a half-built register.
- **New private `decodeV2RecordToFlat`, new export `decodeCanvasDataToFlat`** — the bridge.
- **New private `longestIncreasingSubsequence`** — the minimality engine for AC3.
- **New export `deriveOrdAssignments`** — the conservative `ord` capture policy.
- **Three internal call sites bridged**: the host seed in `subscribe`, `toParsedSave(...)`
  in `handleLocalModify`, and `advanceShadowFromContent`.
- **`toParsedSave` and `applyCanvasToYMaps` signatures** re-typed from `CanvasData` to
  `FlatCanvasData`. Their bodies are untouched.

### `plugin/src/files/canvas-persistence.ts` (the fourth internal consumer)

Not in the charter's "required changed files", but it is a genuine internal consumer of
`parseCanvas` — `coldOpen()` feeds the parse straight into `applyToYMap`. Left unbridged it
would have seeded registers into the doc through the flat-shaped seed path, silently, and
regressed `canvas-persistence.test.ts` / `canvas-single-writer.test.ts`. Minimal change:

- import `FlatCanvasData` + `decodeCanvasDataToFlat` instead of `CanvasData`
- `coldOpen()`: `parseCanvas(content)` → `decodeCanvasDataToFlat(parseCanvas(content))`
- `isCanvasDataEmpty` / `seedDocFromCanvasData` parameter type `CanvasData` → `FlatCanvasData`

No logic changed in that file.

**Not touched:** `server/`, `docker/`, `deploy/`, `plugin/main.js`, `manifest.json`,
`package.json`, `canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`,
`main.ts`, `GEOMETRY_KEYS` (membership and export both unchanged), the plugin version.
No repo-wide formatter, no `lint --fix`.

---

## The decode bridge, stated precisely

**Where it sits.** Immediately after **every** internal `parseCanvas` call, and nowhere
else. Four call sites, all bridged:

```text
canvas-sync.ts
├── subscribe()                  host seed      → decodeCanvasDataToFlat(parseCanvas(content)) → applyCanvasToYMaps → applyToYMap
├── handleLocalModify()          local capture  → decodeCanvasDataToFlat(parseCanvas(content)) → toParsedSave → toParsedRecords
└── advanceShadowFromContent()   shadow receipt → decodeCanvasDataToFlat(parseCanvas(content)) → advanceRecord
canvas-persistence.ts
└── coldOpen()                   one-time seed  → decodeCanvasDataToFlat(parseCanvas(content)) → seedDocFromCanvasData → applyToYMap
```

**What it does.** `decodeCanvasDataToFlat(data: CanvasData): FlatCanvasData` walks each
record and expands every register back into the flat `.canvas` keys it was built from,
passing every other field through untouched:

| Register | Expanded via | Back to |
|---|---|---|
| `pos` | `decodePos` (WP9) | `x`, `y` |
| `size` | `decodeSize` (WP9) | `width`, `height` |
| `from` | `decodeEndpointToFile("from", …)` (WP10) | `fromNode`, `fromSide`, `fromEnd?` |
| `to` | `decodeEndpointToFile("to", …)` (WP10) | `toNode`, `toSide`, `toEnd?` |

It uses the owning modules' own decoders — never a hand-rolled re-expansion — so it cannot
drift from WP9/WP10's idea of what the file keys are. Because `toV2Node`/`toV2Edge`
substitute registers *in the original key's slot*, the bridge reproduces the source
record's key order as well as its values.

**Why it is temporary.** The registers are the parse **output**. The three consumers
downstream are still flat-shaped and are *not* WP16's to change:

- `applyToYMap` / `applyCanvasToYMaps` push whatever they are handed straight into a
  `Y.Map` — bridging is what keeps the seed writing the file schema rather than registers.
- `toParsedRecords` → `planIntentDiff` classifies against a Surface-Shadow keyed by flat
  **field names**; handing it registers would make every field read as new intent.
- Shared Ownership Contract §3 is explicit: this batch lands **pure, independently testable
  cores** and does **not** wire them into the write boundaries.

**Which WP retires it.** **WP18.** The day WP18 teaches the seed path and the capture path
to read/write registers directly, `decodeCanvasDataToFlat`, `decodeV2RecordToFlat` and
`FlatCanvasData` are deleted outright and the four call sites drop the wrapper. There is no
partial migration state: the bridge is one function with four callers.

**One deliberate behavioural narrowing to record.** Geometry now passes through
`encodePos`/`encodeSize` on the *seed* path too, which rounds to whole pixels
(BUILD_SPEC §4.4). Previously only the *capture* path rounded (`roundCanvasGeometry`), and
the seed wrote raw values. A file with fractional `x` therefore seeds `10` where it used to
seed `10.4`. This is the §4.4 rule applied at one more boundary, it is idempotent, and it
is exactly what WP18 would do anyway. No test observes the difference.

---

## The conservative ord policy, stated precisely

`deriveOrdAssignments(previous, nextOrder, clientID, rng?) → Map<id, ord>`, containing
**only** ids whose `ord` is new or reassigned. An id absent from the map keeps its existing
`ord`, untouched.

**How "has the order changed" is answered.** Never by `previous`'s array position, never by
`<` on raw strings, never by `localeCompare`. The current order is **recomputed** from
`previous` with WP13's `compareOrdId`, which is the `(ord, id)` total order — `ord` decides,
record `id` breaks a tie. That is what TC8 discriminates: two entries sharing an identical
`ord`, supplied in the array order *opposite* to canonical, with `nextOrder` equal to the
canonical order, must be recognised as unchanged.

**An `ord` is NOT reassigned when:**

- the document is unchanged — a byte-identical re-parse produces an **empty** map (AC2, the
  DoD statement, TC3);
- a record is **appended** — new ids are allocated, and *only* the new ids (AC2, TC4);
- a record is **deleted** — a record that vanished needs no `ord`, and its absence is not
  evidence that anything else moved;
- the record is part of the longest run of records already in the correct relative order.

**An `ord` IS reassigned when, and only when:**

- the id is new to this doc (no previous `ord`) — allocated, never a rewrite of anyone
  else's value; or
- the id is one of the records that must move to realise the observed permutation.

**Minimality (AC3), and why it is provable rather than hopeful.** Restrict to the ids
present in both views. Express the observed order as each id's *current* canonical position.
A strictly increasing sequence means "unchanged". Otherwise, the records forming a **longest
strictly-increasing subsequence** keep their `ord` and everything else is reassigned:
`n − |LIS|` is the smallest possible number of reassignments for that permutation, so no
cheaper answer exists. `[a,b,c,d,e] → [e,a,b,c,d]` gives positions `[4,0,1,2,3]`, LIS
`[0,1,2,3]`, so exactly `{e}` moves — never all five.

**Allocation.** Each new/reassigned `ord` is allocated strictly between its already-resolved
predecessor and the next id that **kept** its `ord` (`undefined` on either side = head/tail
of the sequence), via WP13's `allocateOrd`. Head insert → `allocateOrd(undefined, firstKept)`;
append → `allocateOrd(lastResolved, undefined)`. The resulting `(ord, id)` total order
reproduces `nextOrder` exactly.

**Determinism.** `rng?: OrdRng` is WP13's injected randomness seam, threaded through to
`allocateOrd` unchanged. Omitted → WP13's own `Math.random` default. No wall-clock read, no
`setTimeout`, no timing constant anywhere in this WP.

**`ord` is never written to the `.canvas` file.** Nothing here emits it; serialisation is
WP17's. This function only decides *when* to call WP13's allocator — it does not allocate a
format and does not compare `ord`s by any rule of its own.

---

## Existing tests adjusted

**None.** Not one existing test file was edited, deleted, skipped, `.todo`-ed, `.only`-ed,
commented out, weakened or relaxed. The single incompatible assertion
(`v2/wp3/test_file_shape_tabs_visible.test.ts:96`) is **left failing** and escalated as
`SPEC_CONTRADICTION` above.

---

## Regression check

Command (rule 9, trailing slash on the v2 path):

```sh
npx vitest run src/__tests__/canvas-sync.test.ts src/__tests__/canvas-persistence.test.ts \
  src/__tests__/canvas-single-writer.test.ts src/__tests__/w4-canvas-integrity.test.ts \
  src/__tests__/v2/ --reporter=dot
```

```
Test Files  1 failed | 102 passed (103)
     Tests  1 failed | 465 passed (466)
  Duration  18.32s
```

The four load-bearing suites, run alone, are **fully green**:

```
Test Files  4 passed (4)
     Tests  123 passed (123)
```

| Suite | Result |
|---|---|
| `canvas-sync.test.ts` | PASS |
| `canvas-persistence.test.ts` | PASS |
| `canvas-single-writer.test.ts` | PASS |
| `w4-canvas-integrity.test.ts` | PASS |
| `src/__tests__/v2/` | 1 FAIL — `wp3/test_file_shape_tabs_visible.test.ts` (the SPEC_CONTRADICTION), rest PASS |

**Typecheck** — `npx tsc -noEmit -skipLibCheck` from `plugin/`:

```
src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts(96,26): error TS2339: Property 'toSide' does not exist on type 'V2EdgeRecord'.
```

That is the *same* line as the failing assertion and the *only* error in the tree. I
introduced no type errors of my own. (No `src/__tests__/wp49/` errors were present in this
run.)

**Biome** — checked before and after on both touched files. Findings are **identical**:
one pre-existing `lint/style/useTemplate` (the `local modify` telemetry template literal,
unchanged, only renumbered by the insert) plus the known whole-file `format` CRLF artifact
on each file. **Zero new findings.** No reformatting was performed.

`npm test` (full suite) was **not** run, per rule 10 — Worker 3 runs it once at the end of
the batch. `npm run build` was **not** run, per rule 12.

---

## Visible Test Results

```sh
npx vitest run src/__tests__/v2/wp16/ --reporter=dot
```

```
Test Files  8 passed (8)
     Tests  13 passed (13)
  Duration  1.97s
```

| TC | Test file | AC | Result |
|---|---|---|---|
| TC1 | `test_tp1_v2_record_shape_visible.test.ts` | AC1 (V2 record shape) | PASS (2) |
| TC2 | `test_tp2_order_observation_explicit_visible.test.ts` | AC1 (explicit order) | PASS (2) |
| TC3 | `test_tp3_unchanged_document_zero_churn_visible.test.ts` | AC2 (negative — the DoD) | PASS |
| TC4 | `test_tp4_append_only_no_existing_touch_visible.test.ts` | AC2 (positive) | PASS |
| TC5 | `test_tp5_minimal_reassignment_on_reorder_visible.test.ts` | AC3 (discriminating) | PASS |
| TC6 | `test_tp6_malformed_json_empty_records_visible.test.ts` | AC4 (part 1) | PASS (2) |
| TC7 | `test_tp7_missing_id_dropped_visible.test.ts` | AC4 (part 2) | PASS (2) |
| TC8 | `test_tp8_ord_total_order_uses_shared_comparator_visible.test.ts` | shared comparator | PASS (2) |

(The charter predicted 12 tests across 8 files; the landed files contain 13 `it(...)` cases.
All 13 pass.)

---

## Summary for Worker 3

WP16 is **functionally complete**. `parseCanvas` returns V2 registers plus an explicit
file-array order observation; `deriveOrdAssignments` implements the conservative policy with
provably minimal reassignment, resolving order exclusively through WP13's `compareOrdId`;
the malformed-JSON and missing-`id` failure behaviour is byte-for-byte preserved. All 13
visible tests pass. All four load-bearing suites pass unmodified (123/123). The decode
bridge is in place at all four internal `parseCanvas` call sites and is documented in-source
as a WP18-retired P1 seam.

**One decision is yours, and it is a one-line decision.**

`plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts:96` —
suite `WP3 AC4 — the .canvas file shape is unchanged`, test
`round-trips through the unchanged parseCanvas reader` — asserts
`data.edges.e1.toSide === "left"` on `parseCanvas` output. WP16 AC1 and its visible test
TC1 require that exact key to be **absent**. Absent and `"left"` cannot both be true. It is
also the only `tsc` error in the tree (TS2339, same line).

I left it red. The fix I recommend preserves the assertion's claim without removing or
relaxing anything, through WP10's own documented codec:

```ts
expect(decodeEndpointToFile("to", data.edges.e1.to).toSide).toBe("left");
```

That is a legitimate §4 "declare the precondition through a documented seam" adjustment —
but WP16 is not on the licensed list (WP4/WP21/WP22/WP33), so it is your call, not mine.
**Apply that one line and the entire tree goes green** (466/466 and a clean typecheck).
Nothing else in this WP is outstanding.

Secondary note for the batch record: I also bridged `canvas-persistence.ts`'s `coldOpen()`,
which is outside the charter's "required changed files" list but is a real internal
`parseCanvas` consumer. Without it the one-time file seed would have written registers into
the doc through the flat-shaped seed path. The change there is type-level plus one wrapped
call — no logic touched.
