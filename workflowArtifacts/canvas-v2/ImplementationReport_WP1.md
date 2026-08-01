# Implementation Report — WP1

Attempt: 1

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — exported shadow structure keyed path → kind → id → field, no Obsidian / clock / DOM / file I/O | DONE | Four-level nesting is `Map` at every level (`SurfaceShadow.paths` → `ShadowPathState.{node,edge}` → id → `ShadowRecord.fields`), so ids/field names like `constructor` behave as ordinary keys. Module has **zero** import statements, matching the `reconcile-plan.ts` precedent. |
| AC2 — per-field advance isolation, per-record isolation | DONE | `advanceField` writes one `Map` entry; `advanceRecord` upserts only the keys present in its `fields` argument and deletes nothing (I7). Creation is confined to two private helpers, so no code path can reach outside the addressed record. |
| AC3 — present / known-absent / unknown are three readable states | DONE | `unknown` is modelled as the *absence* of a `ShadowRecord`, `absent` as a stored record with an emptied field map. `getRecordState` is the only discriminator; `getField` and `getRecordFields` deliberately cannot distinguish the two. |
| AC4 — clearing a path removes all of its state, leaves others intact | DONE | `clearPath` is an exact-key `Map.delete` on the top level — no prefix match, no case folding, no empty container left behind, no-op for an unknown path. |

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| *(none)* | — | — |

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| *(none)* | — | — |

## Changes Made

- **Created:** `plugin/src/canvas/canvas-shadow.ts` (245 lines) — the only source file touched.
- **Updated:** `workflowArtifacts/canvas-v2/TaskCharter_WP1_SurfaceShadowCore.md` — Charter Status
  `TESTS_ADDED` → `IN_PROGRESS` → `DONE`, plus sections 8 and 9.
- **Created:** this report.

No other file was modified. `main.ts`, `canvas-sync.ts`, `canvas-presence.ts`,
`reconcile-plan.ts`, the visible test files and everything under `server/` are untouched. No
dependency added, no version bump, `plugin/main.js` and `plugin/manifest.json` not touched.

## Visible Test Results

Scoped run from `plugin/`: `npx vitest run src/__tests__/v2/wp1` — Vitest 4.0.18, default
reporter. **6 files / 32 tests, 32 passed, 0 failed** (500 ms, no wall-clock sleep).

| Test | Status | Notes |
|---|---|---|
| TC1 `test_tp01_structure_keying_visible.test.ts` (5) | PASS | Raw four-level walk agrees with every reader; `node`/`edge` are separate id spaces; `getRecordFields` snapshot is detached. |
| TC2 `test_tp02_headless_purity_visible.test.ts` (6) | PASS | Source scan finds no import specifier at all, no Obsidian symbol, no `fs`, no clock/entropy, no DOM or host global; two shadows are runtime-independent. |
| TC3 `test_tp03_field_isolation_visible.test.ts` (6) | PASS | Single-field advance, new-field add, same-value re-advance and partial `advanceRecord` all leave the rest of the 7-field record intact. |
| TC4 `test_tp04_record_isolation_visible.test.ts` (4) | PASS | Sibling records, the edge id space and other paths stay byte-identical; same id on two paths stays two records. |
| TC5 `test_tp05_record_states_visible.test.ts` (6) | PASS | Includes the two sharp cases: `markRecordAbsent` on a never-observed record yields `absent` (not `unknown`), and re-observing an absent record returns `present` with *only* the newly observed fields. |
| TC6 `test_tp06_clear_path_visible.test.ts` (5) | PASS | Both kinds and both states cleared, path key itself gone, other paths untouched, unknown path a no-op, cleared path repopulates from scratch. |

Typecheck: `npx tsc -noEmit -skipLibCheck` from `plugin/` reports **zero errors outside
`src/__tests__/v2/wp3/`**. The wp3 errors are pre-existing and out of scope — those tests import
`../../../canvas/canvas-canonical`, the WP3 module that does not exist yet. `canvas-shadow.ts`
and all six wp1 test files typecheck clean.

The full `npm test` was deliberately not run: other WP test directories under
`src/__tests__/v2/` target modules that are not implemented yet, so a full run is expected red
and carries no signal for WP1.

## Summary for Worker 3

`plugin/src/canvas/canvas-shadow.ts` now provides the complete field-granular Surface-Shadow
core exactly as fixed by section 7 of the charter: types `ShadowRecordKind`,
`ShadowFieldValue`, `ShadowRecordState`, `ShadowRecord`, `ShadowPathState`, `SurfaceShadow`, and
functions `createSurfaceShadow`, `advanceField`, `advanceRecord`, `markRecordAbsent`,
`getRecordState`, `getField`, `getRecordFields`, `clearPath`, `listPaths` — parameter order
`(shadow, path, kind, id, [field], [value])` throughout, all synchronous, all total, none
throwing on unknown keys. Trigger it by importing the module directly; there is no runtime
environment to stand up, which is the point. Two design decisions worth knowing downstream:
(1) `unknown` has no representation in `ShadowRecord` — it is the absence of the record — so
`getRecordState` is the only way to tell `absent` from `unknown`, and both `getField` and
`getRecordFields` intentionally return `undefined`/`null` for the pair; (2) re-observing an
`absent` record resets its field map to empty before applying the new observation, per TC5,
so pre-absence fields never resurrect. `getRecordFields` builds its detached copy with
`Object.defineProperty` so a field literally named `__proto__` lands as an own key rather than
reassigning the copy's prototype — a plain assignment loop would silently drop it. Rough edges:
none functionally; the module has no caller yet (wiring is WP2/WP4/WP5), and a Biome whole-file
`format` finding on the new file is expected in this CRLF environment per the charter's known
flaky patterns — it was not mass-reformatted.
