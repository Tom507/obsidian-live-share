# Implementation Report — WP2
Attempt: 1

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — a field equal to the shadow produces no intent and is an explicit discarded-staleness entry | DONE | Strict `===` against `getField(shadow, save.path, kind, id, field)`; emits `DiscardedStaleness` with `reason: "equals-shadow"`. The CRDT is structurally unreachable — it is not a parameter, and `planIntentDiff.length === 4` pins that. |
| AC2 — a differing field produces exactly one upsert and no deletion of any other key of that record | DONE | One `FieldUpsertIntent` per `(record, field)` pair. Fields the save does not mention are never touched (I7 — a partial observation is not a removal). |
| AC3 — a record missing from the save deletes only with an open view AND a hand-over receipt | DONE | Conjunction of `surface.viewOpen && surface.handedToView[kind].has(id)`, applied only to shadow records of `save.path` whose state is `"present"`. `absent` and `unknown` produce nothing. Hand-over sets are kind-scoped. |
| AC4 — resurrect block for tombstoned ids present in the save | DONE | Evaluated first, per record: a blocked record contributes to no category at all, not even a discard. It is still registered as "present in the save", so it can never fall through into the delete rule. Rule 4 itself never consults the tombstone view. |
| AC5 — purity | DONE | No import, no clock, no entropy, no timer, no I/O, no module-level mutable state. The shadow is read-only (`Map` iteration only); every returned array and object is freshly allocated per call; deep-frozen `save` / `surface` inputs are accepted unchanged. |
| DoD — four rules observable as distinct output categories from a single pure call | DONE | TC6 composition test green: 1 upsert, 1 delete, 5 discards, tombstoned record mentioned in no category. |

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| — | — | — |

None.

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| — | — | — |

None.

## Changes Made

- `plugin/src/canvas/canvas-shadow.ts` — **appended only**. Added the WP2 section: input types (`ParsedSaveRecord`, `ParsedSave`, `TombstoneView`, `SurfaceState`), output types (`FieldUpsertIntent`, `DeleteIntent`, `DiscardedStaleness`, `IntentPlan`) and the function `planIntentDiff`. No existing WP1 export, signature, comment or behaviour was changed; the module still imports nothing.
- `workflowArtifacts/canvas-v2/TaskCharter_WP2_ShadowIntentDiff.md` — Charter Status, section 8 and section 9 filled in.
- `workflowArtifacts/canvas-v2/ImplementationReport_WP2.md` — this file.

No other file was touched. `main.ts`, `canvas-sync.ts`, `canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `server/`, `plugin/main.js`, the plugin version and `manifest.json` are all untouched. Zero new dependencies.

## Visible Test Results

Command: `npx vitest run src/__tests__/v2/wp2` (from `plugin/`), Vitest 4.0.18 — **6 files / 53 tests, all PASS, 0 fail** (612 ms).

| Test | Status | Notes |
|---|---|---|
| TC1 `test_tp01_stale_equals_shadow_visible.test.ts` (7 tests) | PASS | Includes the arity assertion (`planIntentDiff.length === 4`), per-field discard granularity, edges, observed `null`, and the all-stale save. |
| TC2 `test_tp02_upsert_on_difference_visible.test.ts` (9 tests) | PASS | I7 (omitted fields deleted nothing), `unknown`/`absent` re-creation, strict `"10"` vs `10`, view-independence, id-space independence, path carried from the save. |
| TC3 `test_tp03_delete_gating_visible.test.ts` (11 tests) | PASS | All four seam combinations, `absent`/`unknown`, kind-scoped receipts, multi-record, delete-intent shape (`id`/`kind`/`path` only), foreign-path isolation. |
| TC4 `test_tp04_resurrect_block_visible.test.ts` (9 tests) | PASS | Block covers changed and unchanged fields alike, discriminates against `isDeleted: () => false`, is per record and kind-scoped, is consulted with `(kind, id)`, and does not extend to the delete rule. |
| TC5 `test_tp05_purity_visible.test.ts` (9 tests) | PASS | Repeated/interleaved calls deeply equal and not identity-shared, shadow snapshot byte-identical after the call, deep-frozen inputs accepted, returned plan independently mutable, source scan clean (no clock/entropy/timer/I/O/import/module `let`+`var`). |
| TC6 `test_tp06_four_categories_visible.test.ts` (8 tests) | PASS | Exactly 1 upsert, 1 delete, 5 discards from one realistic save; categories disjoint per record and per `(record, field)`; every classifiable field lands in exactly one category. |

## Regression Results

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| `src/__tests__/v2/wp2` (visible, this WP) | 53 | 53 | 0 |
| `src/__tests__/v2/wp1` (the module being extended) | 32 | 32 | 0 |
| `npx tsc -noEmit -skipLibCheck` (whole plugin) | — | exit 0, no diagnostics | — |

The full `npm test` was deliberately not run: other `src/__tests__/v2/` work-package directories exist whose modules are not implemented yet, so a full run is red for reasons unrelated to WP2.

## Summary for Worker 3

`plugin/src/canvas/canvas-shadow.ts` now exports `planIntentDiff(shadow, save, tombstones, surface): IntentPlan` alongside the WP1 API, exactly as section 7 of the charter specifies — four parameters, three output arrays (`upserts` / `deletes` / `discarded`), zero imports. Trigger it by building a shadow with the WP1 writers (`advanceRecord` / `markRecordAbsent`), handing in a parsed save plus the two injected seams (`TombstoneView`, `SurfaceState`), and reading the three categories off the returned plan; the resurrect block and the delete gate are directly discriminating, so flipping `isDeleted` or `viewOpen` flips the corresponding category for otherwise identical inputs. Rule order is fixed in code and matters: the tombstone block runs before field classification, and blocked records are still registered as "present in the save" so they can never leak into the delete rule. No rough edges — the function is total (no throw path), allocates a fresh plan per call and never writes to the shadow, so WP4 owns both the shadow advance and the CRDT write. One thing worth carrying into WP4: `undefined` from `getField` means "never observed" and therefore never equals a save value, which is why a genuinely new record is upserted field by field rather than discarded, and why the discard list is the only place a stale field is ever mentioned. The declared handover gate `npm run build` was not run, because it would rewrite the checked-in `plugin/main.js` that this attempt is forbidden to touch; `npx tsc -noEmit -skipLibCheck` was used as the equivalent compile gate and is clean.
