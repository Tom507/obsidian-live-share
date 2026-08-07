# ImplementationReport — WP1 — Cursor transform (S4)

- **Work Package:** WP1 (Batch A, first)
- **User stories covered:** US1
- **Status:** DONE
- **Date:** 2026-07-26
- **Grounding:** degraded mode (authorised — `graphify_enabled: false`, no `graph.json`). Structural map = the `file:line` anchors in the WP1 block, all re-verified against source before editing.

---

## ACs Satisfied

### WP1 Acceptance Criteria

| AC | How verified |
|---|---|
| **AC1** — US1 AC1-AC6 all hold | See the US1 table below; every one has a live assertion in `canvas-adapter.test.ts`. |
| **AC2** — AC3 + AC4 assertions confirmed RED against HEAD, GREEN after | Written first, run against unmodified production code, verbatim failures recorded in *RED-First Observations*. Same two assertions green in run 2. |
| **AC3** — all four US1 AC7 tests corrected | See *Corrected Tests*. None accommodated, skipped or deleted; each carries an in-file `CORRECTED (US1 AC7)` comment naming the wrong assumption. |
| **AC4** — `grep -n "linear"` shows no claim that `canvas.zoom` is linear | Grep over `canvas-adapter.ts`: the only surviving uses of "linear"/"LINEAR" attach to *the linear scale factor* (`canvas.scale`). `:13-17`, `:33-36` and `:190` now state `zoom` is `log2(scale)`, "logarithmic, never a multiplier". |
| **AC5** — diff lists at most the three files | I changed exactly three files (list below). `plugin/src/canvas/canvas-presence.ts` does **not appear in `git diff --name-only` at all** — byte-identical to HEAD. See the caveat in *Risk Notes* about reading a bare `git diff` on this tree. |
| **AC6** — suite green; the `canvas-double` zoom-default change breaks no matrix case | `canvas-matrix.test.ts` **6/6 pass** after the fixture correction (before: 6/6). `harness/canvas-double.test.ts` 12/12. `canvas-binding-apply` 4/4 and `canvas-binding-capture` 8/8 (also consume the double). No matrix finding to report. |

### US1 Acceptance Criteria

| AC | How verified |
|---|---|
| **AC1** — multiply by the linear factor, not `vp.zoom` | `canvasToScreenRel` (`canvas-adapter.ts:129-141`) now multiplies by `viewportScale(vp)`, matching Obsidian's `domFromPos(p) = ((p.x-x)*scale, (p.y-y)*scale)`. Test `"canvasToScreenRel scales by the linear factor, not by vp.zoom"`. |
| **AC2** — factor read from `canvas.scale` when finite, else `2 ** canvas.zoom`; `scale` added to both typings | `scale?: number` added to `CanvasViewport` (`:43`) and to `PrivateCanvas` (`:193`); `viewport()` (`:248-257`) destructures and forwards it. Exported helper `viewportScale` (`:118-120`). Four assertions: the `viewportScale` unit test plus three `getViewport` tests (`canvas-adapter.test.ts:45`, `:192`, `:197`, `:205`) covering scale-present, scale-absent and non-finite-scale. |
| **AC3** — `zoom === 0`: 100 units right → 100 px right of centre | `canvas-adapter.test.ts:124`. **Observed RED first** (rendered *at* centre, x = 400), green after. |
| **AC4** — `zoom === -1`: 50 px right of centre, same side | `canvas-adapter.test.ts:132`, incl. an explicit `toBeGreaterThan(centre)` side assertion. **Observed RED first** (rendered 100 px *left*, x = 300), green after. |
| **AC5** — `clientToCanvasManual` is the exact inverse; no `zoom === 0` bail | The `if (vp.zoom === 0) return null;` line is gone. Replaced by `if (scale === 0 || !Number.isFinite(scale)) return null;` (`:157`) which divides by the same factor `canvasToScreenRel` multiplies by. Tests `"clientToCanvasManual treats zoom 0 as a valid 100 % viewport"` (`:82`) and `"…returns null only on a degenerate linear scale"` (`:94`, covering `scale: 0`, `zoom: NaN`, `zoom: -Infinity`). |
| **AC6** — round-trip for `zoom ∈ {-4,-1,0,1}` to 6 dp, zero-origin rect | `it.each([-4, -1, 0, 1])` at `canvas-adapter.test.ts:105`, three points per level (offset point, the origin itself, a large fractional point), `RECT` = `{left: 0, top: 0, …}`. 4/4 green. |
| **AC7** — the four defect-encoding tests corrected | See *Corrected Tests*. |
| **AC8** — the two false "linear" comments corrected | `canvas-adapter.ts:13-17` (header GROUND TRUTH block) and `:28-45` (the `CanvasViewport` doc) now state `zoom = log2(scale)`, clamped `[-4, 1]`, 0 = 100 %. The `canvasToScreenRel` doc comment carried the same false formula (`s = (c - origin) * zoom + halfSize`) and was corrected to `* scale` in the same pass. |
| **AC9** — `canvas-presence.ts:485` / `:493` not modified | The file is absent from `git diff --name-only` entirely. Never opened for edit. Batch A stays file-disjoint from Batch C. |

---

## ACs Not Satisfied

None.

---

## RED-First Observations

Method: both assertions were written into `canvas-adapter.test.ts` and executed **before any production edit**. No `git stash` / `checkout` / `reset` / `restore` was used at any point — the working tree's uncommitted 0.6.0 baseline is intact.

**Command (both):**

```
npx vitest run src/__tests__/canvas-adapter.test.ts
```

*(via `visible-console` `run_command`, `cwd=…/plugin`, `session_key=w3-wp1`; log `tools/_console_runtime/c9b960f1/console.log`, "Run 1")*

### US1 AC3 — RED (verbatim)

```
FAIL  src/__tests__/canvas-adapter.test.ts > canvas <-> screen transforms > US1 AC3: at zoom 0 (100 %) a point 100 units right renders 100 px right of centre
AssertionError: expected 400 to be close to 500, received difference is 100, but expected 5e-7
 ❯ src/__tests__/canvas-adapter.test.ts:63:17
```

Received `400` = `SIZE.width / 2` exactly: the factor was `vp.zoom === 0`, so the offset collapsed and the peer cursor rendered **at** the wrapper centre. This is precisely the defect US1 AC3 describes.

### US1 AC4 — RED (verbatim)

```
FAIL  src/__tests__/canvas-adapter.test.ts > canvas <-> screen transforms > US1 AC4: at zoom -1 (50 %) the same point renders 50 px right of centre
AssertionError: expected 300 to be close to 450, received difference is 150, but expected 5e-7
 ❯ src/__tests__/canvas-adapter.test.ts:71:17
```

Received `300` = `400 - 100`: the negative `zoom` acted as a point mirror, putting the cursor 100 px on the **wrong side** of centre. Exactly the behaviour US1 AC4 predicts.

**Run 1 totals:** `Test Files 1 failed (1)` · `Tests 2 failed | 15 passed (17)`.

### GREEN (after the production fix)

```
npx vitest run src/__tests__/canvas-adapter.test.ts src/__tests__/harness/canvas-double.test.ts src/__tests__/canvas-matrix.test.ts src/__tests__/canvas-binding-apply.test.ts src/__tests__/canvas-binding-capture.test.ts
```

```
 ✓ src/__tests__/canvas-adapter.test.ts (26 tests) 12ms
 ✓ src/__tests__/harness/canvas-double.test.ts (12 tests) 11ms
 ✓ src/__tests__/canvas-binding-apply.test.ts (4 tests) 25ms
 ✓ src/__tests__/canvas-matrix.test.ts (6 tests) 21ms
 ✓ src/__tests__/canvas-binding-capture.test.ts (8 tests) 22ms

 Test Files  5 passed (5)
      Tests  56 passed (56)
```

Both AC3 and AC4 are in that 26 and are green.

---

## Corrected Tests

All four are corrections of a wrong *assumption* (that `canvas.zoom` is a linear multiplier), not relaxations of a strict assertion. Each site carries an in-file comment recording the old text.

| # | Site (at HEAD) | Old encoding of the defect | Correction | Reason |
|---|---|---|---|---|
| 1 | `canvas-adapter.test.ts:16` — fixture | `const VP = { x: 100, y: 50, zoom: 2 }` | `{ x: 100, y: 50, zoom: 1, scale: 2 }` (now `:21`) | `zoom: 2` is **two** defects: it means 4× in Obsidian (`2 ** 2`), and it is outside Obsidian's `[-4, 1]` clamp, so it is an unreachable viewport. Replaced with a real 200 % viewport carrying the explicit `scale` Obsidian reports, which also exercises the AC2 primary path. |
| 2 | `canvas-adapter.test.ts:26-27` — `"canvasToScreenRel scales by live zoom"` | Asserted `+20 px` for a 10-unit offset at `zoom: 2` — a ×2 factor, i.e. it asserted `vp.zoom` *is* the multiplier | Renamed to `"canvasToScreenRel scales by the linear factor, not by vp.zoom"` (`:33`). Asserts ×2 for the 200 % fixture **and** additionally asserts the old fixture value `zoom: 2` with no explicit scale yields ×4 (`+40 px`) | The title and the arithmetic both taught the wrong model. Keeping a live ×4 assertion for `zoom: 2` pins down the exact number the old test got wrong, so a regression to the linear reading fails loudly. |
| 3 | `canvas-adapter.test.ts:55-56` — `"clientToCanvasManual returns null on zero zoom (no divide-by-zero)"` | Asserted `null` for `{ x: 0, y: 0, zoom: 0 }` — locking in the bail that US1 AC5 removes | Replaced by two tests: `"…treats zoom 0 as a valid 100 % viewport"` (`:82`, asserts the round-trip value, not just non-null) and `"…returns null only on a degenerate linear scale"` (`:94`) | `zoom: 0` is Obsidian's **default 100 %** — the single most common viewport. The old bail made the whole manual fallback dead at 100 %, and the test called that correct. The divide-by-zero concern is real but belongs on the *linear* factor, which is what the replacement guards (`scale: 0`, `zoom: NaN`, `zoom: -Infinity`); `2 ** z > 0` for every finite `z`, so no legitimate zoom can reach it. |
| 4 | `harness/canvas-double.ts:200` — `zoom: opts.zoom ?? 1` | Default `1` = 200 %, so every harness case silently ran double-scaled | `const zoom = opts.zoom ?? 0` plus `scale: opts.scale ?? 2 ** zoom` (`:211`, `:216`); `scale` added to `DoubleCanvas` and `CanvasDoubleOptions` | `0` is Obsidian's 100 %. Did **both** options the BUILD_SPEC allows: corrected the default *and* made the double accept an explicit `scale`, so a future case can set a zoom level without re-deriving the factor. **No matrix case broke** — see *Risk Notes*. |

### Additional (unlisted) fixture correction

`canvas-adapter.test.ts:176` — `makeView`'s own `zoom: 1` hardcode had the identical defect as item 4 (it is the ancestor `makeView` that `canvas-double.ts` was lifted from). Changed to `zoom: opts.zoom ?? 0` and given optional `zoom`/`scale` opts so the new `getViewport` tests can drive it. Not in the AC7 list; recorded here for completeness. All 12 pre-existing reconciliation tests in that describe stay green unchanged.

---

## Files Changed

Exactly three, all inside the WP1 allow-list:

```text
plugin/
├── src/canvas/canvas-adapter.ts                 ← production fix (+62/-…)
└── src/__tests__/
    ├── canvas-adapter.test.ts                   ← corrections + new coverage
    └── harness/canvas-double.ts                 ← fixture correction
```

**`plugin/src/canvas/canvas-adapter.ts`**
- `:13-17` — GROUND TRUTH header: the false "(linear)" claim on `canvas.zoom` replaced by `log2(scale)`, clamp `[-4, 1]`, 0 = 100 % / -1 = 50 % / 1 = 200 %, and a pointer to `canvas.scale` as the factor transforms must use. (US1 AC8)
- `:28-45` — `CanvasViewport`: header comment corrected; `zoom` given a doc comment stating it is logarithmic and never a multiplier; **new optional `scale?: number`** (`:43`). (US1 AC2, AC8)
- `:112-120` — **new exported `viewportScale(vp)`**: returns `vp.scale` when it is a finite number, else `2 ** vp.zoom`. Single source of truth for the factor. (US1 AC2)
- `:122-141` — `canvasToScreenRel`: multiplies by `viewportScale(vp)` instead of `vp.zoom`; doc comment's false formula corrected to `s = (c - origin) * scale + halfSize`. (US1 AC1, AC3, AC4)
- `:143-162` — `clientToCanvasManual`: divides by `viewportScale(vp)`; the `if (vp.zoom === 0) return null;` bail **removed** and replaced at `:157` by `if (scale === 0 || !Number.isFinite(scale)) return null;`. (US1 AC5)
- `:190-193` — `PrivateCanvas`: `zoom` doc-commented as logarithmic; **new optional `scale?: number`** so `canvas.scale` can be read at all (it was read nowhere at HEAD). (US1 AC2)
- `:248-257` — `viewport()`: destructures `scale` alongside `x/y/zoom` and forwards it only when it is a finite number, so a drifted shape falls back to `2 ** zoom` rather than poisoning the transform. The `x/y/zoom` numeric gate is unchanged, so `isAvailable()` / `availabilityReport()` semantics are untouched.
- **Not touched:** `patch()` (still stores `wrapper.__lsOriginal = original`; that is WP3), the watchdog, everything else.

**`plugin/src/__tests__/canvas-adapter.test.ts`** — 15 → **26 tests**
- `:21` corrected `VP` fixture; `:33` corrected scaling test; `:82` + `:94` replace the zero-zoom bail test (AC7 items 1-3).
- New: `:45` `viewportScale` unit (AC2), `:105` `it.each` round-trip over `zoom ∈ {-4,-1,0,1}` (AC6), `:124` AC3, `:132` AC4, `:191-211` a `describe` with three `getViewport`-reads-`canvas.scale` tests (AC2).
- `:153-177` `makeView` gained optional `zoom`/`scale` and its `zoom: 1` hardcode became `?? 0`.
- `viewportScale` added to the import list at `:3-9`.

**`plugin/src/__tests__/harness/canvas-double.ts`**
- `:21-22` header comment: viewport shape now documents `canvas.scale` and the `log2` relation.
- `:149-152` `DoubleCanvas`: `zoom` doc-commented, **new required `scale: number`**.
- `:174-181` `CanvasDoubleOptions`: `zoom` documented as `log2(scale)` defaulting to 0, **new optional `scale`**.
- `:209-216` constructor: `zoom` default `1` → `0`; `scale: opts.scale ?? 2 ** zoom`.
- No behavioural change to nodes/edges/instrumentation, so `two-peer.ts` and every consumer keep working untouched.

---

## Quality Gates

| Command | Result |
|---|---|
| `npx vitest run src/__tests__/canvas-adapter.test.ts` (RED phase, pre-fix) | **FAIL as intended** — 2 failed / 15 passed (17). Both failures are the AC3/AC4 assertions. |
| `npx vitest run src/__tests__/canvas-adapter.test.ts` (post-fix, inside the 5-file run) | **PASS** — 26/26. Baseline for this file was 15 → **+11**, 0 regressions. |
| `npx vitest run src/__tests__/harness/canvas-double.test.ts` | **PASS** — 12/12 (baseline 12, unchanged). |
| `npx vitest run src/__tests__/canvas-matrix.test.ts` | **PASS** — 6/6 (baseline 6, unchanged). **All six matrix cases survive the zoom-default correction.** |
| `npx vitest run src/__tests__/canvas-binding-apply.test.ts` | **PASS** — 4/4 (extra safety: also consumes `CanvasDouble`). |
| `npx vitest run src/__tests__/canvas-binding-capture.test.ts` | **PASS** — 8/8 (same reason). |
| `npx tsc -noEmit -skipLibCheck` | **PASS** — zero diagnostics (confirmed with a `&& echo WP1_TSC_PASS_MARKER` positive marker, since a clean tsc prints nothing). |
| `npx biome check` on the three touched files | **2 pre-existing formatter findings, 0 added.** Both are on lines absent from my diff — verified with `git diff -U0 -- <file> \| grep -E "<offending text>"` returning empty for all five flagged snippets (`const canvas = (view as`, `function patch(name`, `markViewportChanged(optional)`, `getLiveNodeIds / getLiveEdgeIds reflect`, `setData, requestFrame }))`). `harness/canvas-double.ts` is clean. Nothing I wrote was flagged. Advisory gate — finding count on touched files did not increase. |
| `npm run build` | **NOT RUN, by dispatcher instruction** — its esbuild step writes `plugin/main.js` and three batches are running concurrently. `tsc -noEmit -skipLibCheck` (build gate part 1) was run standalone and passes. |
| `npm test` (full suite) | **NOT RUN, by dispatcher instruction** (~43 s, one test sleeps 33 s). Dispatcher runs the authoritative gates on the merged tree. Expected merged total from WP1 alone: **526 → 537** (+11, all additive; no test deleted, no test count reduced — the one replaced test became two). |

### Abort criteria — all clear

- `plugin/src/types.ts:65` `useCanvasBinding: false` — verified unchanged (the file is modified in the working tree by the pre-existing 0.6.0 baseline, not by me).
- No production import of `canvas-binding.ts` / `canvas-model-bridge.ts` added.
- Version still `0.6.0` (`plugin/package.json:3`); no touch to `server/`, `docker/`, deploy files, manifests, `plugin/main.js`, `server/dist/`.
- No new dependency. No reformatting of untouched code.

---

## Risk Notes

- **R11 / WP1 AC6 — the `canvas-double` zoom default: NO real finding.** Correcting `zoom: 1` → `0` moves the fixture from 200 % to 100 % for every consumer of the double, including all six `canvas-matrix.test.ts` cases. All six stay green, as do `canvas-double.test.ts` (12), `canvas-binding-apply` (4) and `canvas-binding-capture` (8). Root cause of the non-event: the two-peer/matrix path is **purely model-level** — it converges canvas-space node records through `CanvasModelBridge`/Y.Doc and never calls `canvasToScreenRel` / `clientToCanvasManual` / `getViewport`. A repo-wide grep for `\.zoom|\.scale|canvasToScreenRel|clientToCanvasManual|getViewport` finds no hit anywhere under `__tests__/harness/` other than `canvas-double.ts`'s own comments, and no test outside `canvas-adapter.test.ts` asserts on zoom. `canvas-double.test.ts:26` only asserts `typeof c.zoom === "number"`, which `0` satisfies. `canvas-matrix.test.ts` was **not** touched and not re-tuned. WP status is therefore **DONE**, not RISKY.
- **AC5 caveat for the dispatcher — a bare `git diff --name-only` on this tree is not a WP1 audit.** The working tree carries the uncommitted 0.6.0 Phase 2-4 wiring baseline, so `git diff --name-only` lists 17 modified files (incl. `plugin/src/main.ts`, `plugin/src/types.ts`, `manifest.json`, `versions.json`, several test files) plus 8 untracked paths. Only these three are mine: `plugin/src/canvas/canvas-adapter.ts`, `plugin/src/__tests__/canvas-adapter.test.ts`, `plugin/src/__tests__/harness/canvas-double.ts`. The strongest available proof of the US1 AC9 file-disjointness guarantee is that `plugin/src/canvas/canvas-presence.ts` is **not in the diff at all**, so `:485`/`:493` are byte-identical to HEAD. Scope the AC5 check with `git diff --name-only -- plugin/src/canvas plugin/src/__tests__` and subtract the known baseline set.
- **`canvas.scale` is now typed but has never been observed on a live Obsidian canvas from this codebase** (it was read nowhere at HEAD; the BUILD_SPEC's ground truth comes from `obsidian.asar`). The `viewportScale` fallback makes this safe either way: if the real canvas exposes `scale`, it is used verbatim; if not, `2 ** zoom` reproduces it exactly. A non-finite `scale` (shape drift) is ignored rather than propagated. No runtime path can now produce `NaN`/`0` coordinates that HEAD would not also have produced.
- **Behaviour change visible to Batch C.** `canvasToScreenRelativeToWrapper` and `clientToCanvas` (the manual-fallback branch) now return *different numbers* than at HEAD for every zoom level except the accidental fixed point. `canvas-presence.ts:485`/`:493` consume the first of these — unmodified, but their rendered output moves (that is the point of US1). Any Batch C snapshot/px assertion written against HEAD's mirrored coordinates would now fail, correctly.
- `viewportScale` is a **new exported symbol** from `canvas-adapter.ts`. Deliberate (it is the single source of truth for the factor and is unit-tested directly), and it costs nothing at runtime — no new import appears in any production file, so tree-shaking is unaffected.
- `clientToCanvas`'s preferred path is still `canvas.posFromEvt`, untouched; the AC5 fix only repairs the manual fallback, which is the branch that was dead at 100 % zoom.

---

## Handover summary

`canvas.zoom` is no longer treated as a multiplier anywhere in the adapter. The linear factor is `viewportScale(vp)` = `canvas.scale` when finite, else `2 ** zoom`; it is applied in `canvasToScreenRel` and divided out in `clientToCanvasManual`, which no longer bails at 100 % zoom. `scale?: number` is now on both `CanvasViewport` and the private shape and is surfaced by `viewport()`. Round-trip identity holds across Obsidian's whole clamp range `[-4, 1]`. The four defect-encoding tests are corrected with reasons on record; the harness double now defaults to 100 % and accepts an explicit `scale`, and no matrix case regressed. Three files changed, `canvas-presence.ts` untouched.
