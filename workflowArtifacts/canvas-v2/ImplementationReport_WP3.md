# Implementation Report — WP3

Attempt: 1

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — two independently ordered inputs serialise byte-identically | DONE | `canonicalizeCanvasData` sorts both arrays by `String(record.id ?? "")` using UTF-16 code-unit comparison and reorders every record's keys, so array order and key insertion order are both erased. Verified pure-data (TC1) and through the real Y.Doc seam (TC9). |
| AC2 — Obsidian-canonical key order + Obsidian number format, no field gains/loses a value | DONE | `CANONICAL_NODE_KEY_ORDER` / `CANONICAL_EDGE_KEY_ORDER` exactly as specified in charter section 7; unknown keys appended in UTF-16 code-unit order (never `localeCompare`). Values pass through by identity, only `undefined` is dropped. Number format needs no custom writer — `JSON.stringify` already emits integers without a decimal tail, `-0` as `0`, and plain decimal for the magnitudes a canvas uses. |
| AC3 — capture-side rounding to whole pixels, idempotent | DONE | `roundCanvasGeometry` rounds only finite numbers under the four `CANONICAL_GEOMETRY_KEYS`, normalises `-0` to `0`, preserves input key order, never mutates the input. Idempotent by construction (`Math.round` of an integer is that integer); asserted over 240 seeded-LCG samples plus the `±.5` tie boundaries. |
| AC4 — deterministic record order without `ord`, tab indentation and file shape unchanged | DONE | Order is id-only; neither key-order array contains `ord`/`pos`/`size`/`from`/`to`/`schemaVersion`. `serializeCanonicalCanvas` is `JSON.stringify(..., null, "\t")` — same tab indentation, `nodes` before `edges`, no trailing newline, no BOM, no CRLF. Byte-exact expected string pinned by TC8. |

**Definition of Done:** met — TC9 drives two in-memory `Y.Doc`s holding the same state with different Y.Map iteration *and* key insertion orders through the real `serializeCanvas` seam and gets identical bytes.

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| *(none)* | — | — |

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| *(none)* | — | — |

## Changes Made

- **Created** `plugin/src/canvas/canvas-canonical.ts` — the pure canonical-form core. Zero imports (verified by TC10's source-text purity oracle), zero new runtime dependencies. Exports `CanvasRecord`, `CanvasRecordKind`, `CanvasRecordSets`, `CanonicalCanvasData`, `CANONICAL_NODE_KEY_ORDER`, `CANONICAL_EDGE_KEY_ORDER`, `CANONICAL_GEOMETRY_KEYS`, `canonicalizeRecord`, `roundCanvasGeometry`, `canonicalizeCanvasData`, `serializeCanonicalCanvas`. Keeps its own private mirror of the geometry key set, exactly like `RECONCILE_GEOMETRY_KEYS` in `reconcile-plan.ts`.
- **Modified** `plugin/src/files/canvas-sync.ts` — three touch points only:
  - one added import of the new module,
  - `buildCanvasData` now returns `canonicalizeCanvasData({ nodes, edges })`; the dangling-edge prune is unchanged and still runs *before* canonicalisation,
  - `serializeCanvas` now returns `serializeCanonicalCanvas(buildCanvasData(...))`.
- `GEOMETRY_KEYS` untouched: still exactly `{x, y, width, height}`, still exported from `canvas-sync.ts`. `parseCanvas` untouched. No `.canvas` format change, no `meta.schemaVersion`, no version bump, `plugin/main.js` and `plugin/manifest.json` not touched.
- `roundCanvasGeometry` is delivered as the capture-side helper but is **not yet called** from a capture path — no capture seam exists in P0 scope for WP3 to wire it into, and the charter scopes it as "a canonical-rounding helper usable by the capture path". Wiring belongs to the capture work package.

## Existing Tests Adjusted

| Test file | Test name | What changed and why |
|---|---|---|
| *(none)* | — | No existing test needed an index or lookup adjustment. |

The two candidates flagged in the task brief were re-checked explicitly and both pass unmodified:

- `w4-canvas-integrity.test.ts` probe **G4** (`:1425`) — asserts on the pruned edge set, not on a positional node index.
- `canvas-sync.test.ts` `:966` — indexes `edges[0]` in a fixture with a single surviving edge, so id-sorting cannot move it.

No test was deleted, skipped, or weakened.

## Visible Test Results

| Test | Status | Notes |
|---|---|---|
| TC1 `test_order_independent_bytes_visible.test.ts` | PASS | 4/4 |
| TC2 `test_key_order_visible.test.ts` | PASS | 5/5 |
| TC3 `test_value_preservation_visible.test.ts` | PASS | 5/5 |
| TC4 `test_number_format_visible.test.ts` | PASS | 5/5 |
| TC5 `test_geometry_rounding_visible.test.ts` | PASS | 6/6 |
| TC6 `test_rounding_idempotent_visible.test.ts` | PASS | 3/3 (240 seeded samples) |
| TC7 `test_record_order_no_ord_visible.test.ts` | PASS | 5/5 |
| TC8 `test_file_shape_tabs_visible.test.ts` | PASS | 6/6 |
| TC9 `test_two_client_bytes_visible.test.ts` | PASS | 4/4 (real seam, in-memory `Y.Doc`s) |
| TC10 `test_geometry_keys_drift_visible.test.ts` | PASS | 4/4 (drift guard + purity oracle) |

`npx vitest run src/__tests__/v2/wp3` → **10 files, 47 tests, 47 passed, 0 failed** (0.8 s). Green on the first run; no implementation retry was needed.

## Regression Suite Results

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| `canvas-sync.test.ts` | 40 | 40 | 0 |
| `w4-canvas-integrity.test.ts` | 50 | 50 | 0 |
| `canvas-single-writer.test.ts` | 19 | 19 | 0 |
| `canvas-persistence.test.ts` | 17 | 17 | 0 |
| `background-sync.test.ts` | 28 | 28 | 0 |
| `manifest.test.ts` | 57 | 57 | 0 |
| `regression.test.ts` | 13 | 13 | 0 |
| **Required-suite total** | **224** | **224** | **0** |
| *Extra insurance:* all non-v2 suites (`src/__tests__` minus `v2/**`) | 674 (35 files) | 674 | 0 |
| `npx tsc -noEmit -skipLibCheck` | — | clean, 0 errors | — |

The wider non-v2 run was added on top of the required list because id-sorting changes `buildCanvasData` output for *every* consumer, not just the named suites. It is green, so no consumer anywhere in the plugin depended on Y.Map iteration order.

## Summary for Worker 3

`plugin/src/canvas/canvas-canonical.ts` now exists as a zero-import pure core and both `buildCanvasData` and `serializeCanvas` route through it, so the `.canvas` bytes a client writes are a pure function of the doc state — the precondition byte-equality echo breaking (D9) and the WP23 convergence fuzzer need. Trigger it by calling either seam function (or anything downstream of `CanvasPersistence`'s single writer at `canvas-persistence.ts:229`): records come back id-sorted with schema-ordered keys, the dangling-edge prune still runs first, and the emitted text is byte-for-byte the old tab-indented shape. Two rough edges worth flagging upward. First, `roundCanvasGeometry` is implemented and fully tested but has no caller yet — geometry currently still reaches the register unrounded, so the "rounding reads as intent" failure mode is only *fixable*, not yet *fixed*, until a capture seam calls it; that wiring was outside this WP's declared file scope. Second, sort determinism rests on `String(record.id ?? "")` plus UTF-16 code units: it is deliberately locale-independent, but two records sharing an id stay in input order, which is Y.Map order — a duplicate id would therefore still be a byte-equality hazard. Nothing in P0 can produce one, and WP17's `(ord, id)` sort supersedes this ordering anyway, but it is the one remaining input under which byte identity is not guaranteed.
