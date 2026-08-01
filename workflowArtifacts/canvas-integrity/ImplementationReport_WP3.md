# ImplementationReport — WP3 — Adapter robustness (S2-B/C)

- **Work Package:** WP3 (Batch A, second — after WP1 in the same file)
- **User stories covered:** US4 AC9–AC17, US6 (`DRAG WATCHDOG:`, `ADAPTER PATCH:` rows only)
- **Status:** DONE — with one flagged handover item (production logger wiring lives in `main.ts`, which is off limits; see *ACs Not Satisfied* and *Risk Notes*)
- **Date:** 2026-07-26
- **Grounding:** degraded mode (authorised — `graphify_enabled: false`, `graphify_required: false`, no `graph.json`, no `GRAPH_REPORT.md`; Graphify never invoked). The WP block's `file:line` anchors were treated as STALE because WP1 landed in the same file first; every target was re-located by symbol name (`isBusy`, `patch`, `applyNodeGeometry`, `reloadCanvasData`, `destroy`, `patchState`) and the actual shifted line numbers are recorded in *Files Changed*.

---

## ACs Satisfied

### WP3 Acceptance Criteria

| AC | How verified |
|---|---|
| **AC1** — US4 AC9–AC17 all hold | See the US4 table below. Every one has a live assertion in `canvas-adapter.test.ts`; no `.skip`, no `.todo`, no weakened assertion. |
| **AC2** — the US4 AC13 test confirmed **RED against current HEAD**, GREEN after | Written first, run before any production edit, verbatim failure in *RED-First Observations §1*. Green in run 3. |
| **AC3** — the US4 AC16 test confirmed **RED against current HEAD**, GREEN after | Same method, run in isolation (`-t` filtered so only that test executed), verbatim failure in *RED-First Observations §2*. Green in run 3. |
| **AC4** — US4 AC10: a long but **active** drag never trips the watchdog | Two tests, one per refresh source. Both drive a signal every `DRAG_WATCHDOG_MS / 2` for three windows (1.5× the window of total drag time) and assert `isBusy() === true` at every step plus `0` warn lines, then assert expiry once the signals stop. `canvas-adapter.test.ts:422` (viewport) and `:443` (pointermove). |
| **AC5** — US4 AC11: on expiry `dragTargetId` retained; `applyNodeGeometry(dragTargetId, …)` still `"interacting"` while `reloadCanvasData` returns `true` | `canvas-adapter.test.ts:462`. Asserts all four facts in one case: `"interacting"` for the held node, the held node's live coords are **unchanged**, `"applied"` for a *different* node, `reloadCanvasData → true` with `setData` called exactly once, and exactly one `DRAG WATCHDOG:` warn. |
| **AC6** — `DRAG_WATCHDOG_MS = 5000`, exported, asserted against the constant | `canvas-adapter.ts:260`. `canvas-adapter.test.ts:387` asserts the value; **every** watchdog test uses the imported constant (`DRAG_WATCHDOG_MS + 1000`, `DRAG_WATCHDOG_MS - 1`, `DRAG_WATCHDOG_MS / 2`) — no literal ms value survives in any assertion. The doc comment states it measures inactivity, not drag length. |
| **AC7** — `canvas-adapter.ts` is the only production file changed | `git diff --stat` scoped to my two files shows exactly `plugin/src/canvas/canvas-adapter.ts` + `plugin/src/__tests__/canvas-adapter.test.ts`. `canvas-presence.ts`, `sync/sync.ts`, `main.ts`, `harness/canvas-double.ts` were never opened for edit. |
| **AC8** — `destroy()` still restores every patch and resets `patchState`; the displaced adapter's disposer is a **no-op**, asserted explicitly | Two tests. `canvas-adapter.test.ts:568` (AC15/AC8): after `second` adopts, `first.destroy()` leaves `view.canvas.setDragging` **identical to the live wrapper** and the live adapter still receives signals (`second.isBusy() === true`). `canvas-adapter.test.ts:585` (AC8, `patchState` reset proven behaviourally): all three methods are `!== pristine` after subscription, `=== pristine` after `destroy()`, and `patchState` reset is proven behaviourally — the same adapter re-patches on the next `isBusy()`, and a fresh adapter then logs `updateSelection=installed setDragging=adopted markViewportChanged=installed`. |

### US4 Acceptance Criteria (AC9–AC17 — mine; AC1–AC8 belong to another WP and `sync.ts` was not touched)

| AC | How verified |
|---|---|
| **AC9** — `isBusy()` cannot latch; it becomes an inactivity predicate | `isBusy()` (`canvas-adapter.ts:574-578`) returns `dragActive()`, never the raw flag. `dragActive()` (`:318-337`) is `isDragging && (now - lastDragSignalAt) < DRAG_WATCHDOG_MS`, and releases the flag in the else branch. Tests: `:373` (release), `:391` (not one tick early: still `true` at `DRAG_WATCHDOG_MS - 1`, `false` at the boundary). |
| **AC10** — the clock is refreshed by real interaction (`markViewportChanged` patch + `pointermove` listener) | `noteDragSignal()` is called inside the `markViewportChanged` patch (`:465`) and at the **top** of the `pointermove` listener (`:649`), before the coordinate mapping, so a failed mapping cannot swallow the refresh. Both production subscribers exist: `canvas-presence.ts:325` (`onPointerMove`) and `:329` (`onViewportChange`). Tests `:422` and `:443`. |
| **AC11** — on expiry: clear `isDragging`, log one `warn`, **retain** `dragTargetId` | `dragActive()` sets `isDragging = false`, emits one `DRAG WATCHDOG:` warn behind a one-shot guard, and never writes `dragTargetId`. `isDragTarget()` (`:339-342`) is the per-node gate and outlives the release. Tests `:462` (retention + protection) and `:494` (a genuine `setDragging(false)` *does* clear the target, so the retention is not permanent, and the next drag logs its own line → 2 warns total). |
| **AC12** — `applyNodeGeometry` and `reloadCanvasData` consult the same watchdog-aware predicate, not the raw flag | `applyNodeGeometry` (`:587-592`) calls `isDragTarget(nodeId)`, which sweeps via `dragActive()` first. `reloadCanvasData` (`:610-614`) calls `dragActive()` directly. Test `:516` proves the structural path recovers **without** any `isBusy()` poll: `false` while dragging, `true` after expiry, `setData` called once. |
| **AC13** — the release test | `canvas-adapter.test.ts:373`. **Observed RED first** (see below). |
| **AC14** — a second adapter can never end up patch-less; `patch()` unwraps `__lsOriginal` and re-wraps | `patch()` (`:369-400`) no longer early-returns on `__lsWrapped`. It classifies via `classifyPatch()`, takes `existing.__lsOriginal` when adopting, and re-wraps the pristine method. Tests `:549` (three adapters over one canvas → the pristine method is reached **exactly once** per invocation, `calls === [true]`, so wrappers do not stack) and `:633`/`:645` (`unavailable` paths do not throw). |
| **AC15** — the displaced adapter's restore is harmless because of the existing `if (c[name] === wrapper)` guard | Test `:568`, asserted explicitly (see WP3 AC8 above). The guard already existed at HEAD and was left byte-identical; only `original` now denotes the unwrapped pristine method, so a displaced-adapter `destroy()` can neither match nor clobber. |
| **AC16** — the two-adapter test | `canvas-adapter.test.ts:539`. **Observed RED first** (see below). |
| **AC17** — adapter (re)mount is observable: one line per construction naming the per-method outcome | `canvas-adapter.ts:470-479` emits exactly one `ADAPTER PATCH:` line per `createCanvasAdapter(...)` call, built from `PATCHED_METHODS.map(n => n + "=" + classifyPatch(n))`. Path-independent by construction (the adapter never receives a path). Tests `:615` (first mount all-`installed`; second mount over the same canvas → `updateSelection=adopted setDragging=adopted markViewportChanged=installed`), `:633` (`unavailable` for a missing member), `:645` (no-canvas view → all three `unavailable`). |

### US6 Acceptance Criteria (the two rows I own)

| AC | How verified |
|---|---|
| **AC1** — emitted through the existing `DebugLogger` seam, no new framework, no new dependency | `CanvasAdapterLogger` (`:263-266`) declares only `log(category, message)` and `warn(category, message)` — structurally satisfied by `DebugLogger` and identical in spirit to `CanvasSyncLogger` / `CanvasModelBridgeLogger` / `CanvasBindingLogger`. Injected via the new optional `CanvasAdapterOpts`, mirroring `createCanvasModelBridge(adapter, { logger })`. `package.json` dependencies untouched. |
| **AC2** — fixed uppercase greppable prefix; each asserted by a logger spy | `DRAG WATCHDOG:` and `ADAPTER PATCH:` are literal uppercase prefixes. Nine spy assertions across the two describes. |
| **AC4** — the two new rows exist with their documented payloads | `DRAG WATCHDOG: isDragging released after <idle>ms with no drag signal (limit 5000ms); dragTargetId=<id|none> retained`. `ADAPTER PATCH: updateSelection=<outcome> setDragging=<outcome> markViewportChanged=<outcome>` with outcomes drawn from `installed` / `adopted` / `unavailable`. |
| **AC5** — once per occurrence, not per poll | `watchdogLogged` one-shot guard, re-armed only by a real `setDragging` edge. Test `:404` polls `isBusy()` five times plus `applyNodeGeometry` plus `reloadCanvasData` after a `3 ×` overrun and asserts **exactly one** line; test `:494` asserts a second drag produces a second line. Also proven not-early: test `:391` asserts `0` lines at `DRAG_WATCHDOG_MS - 1`. |
| **AC7** — no user data | Only ids, a measured ms value and the ms limit. Asserted in test `:404` (`limit 5000ms`, `dragTargetId=n1 retained`). No node text, no file content, no path. |

---

## ACs Not Satisfied

**One item, structural, out of my file allow-list — not a code defect:**

- **US6 AC6 (`ARCHITECTURE.md` appendix table row for the two signatures) — NOT DONE.** `ARCHITECTURE.md` is not in this WP's permitted file set (hard constraint: `canvas-adapter.ts` + `canvas-adapter.test.ts` only), and it is currently an **untracked, concurrently-authored file** in this working tree, so appending to it during a three-batch parallel round is a collision. US6 AC6 is a story-level requirement shared by six WPs; the two rows I own are `DRAG WATCHDOG:` and `ADAPTER PATCH:` with the exact payloads documented above. **Recommend one consolidation pass by the dispatcher after the merge**, adding all ten rows at once.

Everything else in WP3 AC1–AC8 and US4 AC9–AC17 is satisfied. See *Risk Notes* for the one runtime-wiring caveat (the log **emitter** is production code and greppable, but its production **sink** is passed in `main.ts`, which is off limits).

---

## RED-First Observations

Method: each test was written into `canvas-adapter.test.ts` and executed **before any production edit**, then re-run after. **No `git stash` / `checkout` / `reset` / `restore` / `commit` / `clean` was used at any point** — the working tree's uncommitted 0.6.0 baseline and WP1's uncommitted changes are intact (26 pre-existing tests passing in run 1 proves WP1 was live during the red runs).

All runs via `visible-console` `run_command`, `cwd = …/plugin`, `session_key = w3-wp3`, log `tools/_console_runtime/3dbf2afd/console.log`.

### 1. US4 AC13 (WP3 AC2) — RED

**Command:**

```
npx vitest run src/__tests__/canvas-adapter.test.ts
```

**Verbatim failure (run 1):**

```
 FAIL  src/__tests__/canvas-adapter.test.ts > drag watchdog > US4 AC13: isBusy() releases a drag that produced no signal for the whole window
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/__tests__/canvas-adapter.test.ts:383:24
    381|     // constant in the green revision of this test).
    382|     vi.advanceTimersByTime(6000);
    383|     expect(a.isBusy()).toBe(false);
       |                        ^
    384|     expect(linesWith(logger, "warn", "DRAG WATCHDOG:")).toHaveLength(1…

 Test Files  1 failed (1)
      Tests  1 failed | 26 passed (27)
```

`true` after 6 s of complete silence is the latch itself: at HEAD `isBusy()` returns the raw `isDragging`, so the whole `main.ts` reconcile short-circuit stays engaged with no timeout. The `DRAG WATCHDOG:` spy assertion on the next line was equally unmet (0 lines).

**Disclosure — the one edit between the red and green revision of this test:** the red run used the literal `6000`, because importing the not-yet-existing `DRAG_WATCHDOG_MS` would have failed module resolution and taken all 26 pre-existing tests down with it, destroying the evidence. The green revision replaces it with `vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1000)` (hard rule: assert against the constant, never a literal). The two assertions that were observed red — `isBusy() === false` and exactly one `DRAG WATCHDOG:` warn — are byte-identical in both revisions.

### 2. US4 AC16 (WP3 AC3) — RED

**Command** (name-filtered so only the new test executed; the other 27 are reported `skipped`):

```
npx vitest run src/__tests__/canvas-adapter.test.ts -t patch adoption
```

**Verbatim failure (run 2):**

```
 FAIL  src/__tests__/canvas-adapter.test.ts > patch adoption > US4 AC16: the SECOND adapter over one canvas still sees the drag
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ src/__tests__/canvas-adapter.test.ts:403:29
    401|     second.isBusy(); // second adapter must ADOPT it, not early-return…
    402|     view.canvas.setDragging(true);
    403|     expect(second.isBusy()).toBe(true);
       |                             ^
    404|   });
    405| })

 Test Files  1 failed (1)
      Tests  1 failed | 27 skipped (28)
```

`false` is the patch-less second adapter: `patch()` saw `__lsWrapped` on the method the first adapter owned and returned early, so the second adapter's `isDragging` was never written by any signal. This test is byte-identical in the red and green runs.

### 3. GREEN

```
npx vitest run src/__tests__/canvas-adapter.test.ts
```

```
 ✓ src/__tests__/canvas-adapter.test.ts (42 tests) 30ms

 Test Files  1 passed (1)
      Tests  42 passed (42)
```

Both previously-red tests are in that 42 and pass. Regression neighbours in the same run 4:

```
 ✓ src/__tests__/canvas-adapter.test.ts (42 tests)
 ✓ src/__tests__/harness/canvas-double.test.ts (12 tests)
 ✓ src/__tests__/canvas-matrix.test.ts (6 tests)
 ✓ src/__tests__/canvas-binding-apply.test.ts (4 tests)
 ✓ src/__tests__/canvas-binding-capture.test.ts (8 tests)

 Test Files  5 passed (5)
      Tests  72 passed (72)
```

---

## Files Changed

Exactly two, both inside the WP3 allow-list:

```text
plugin/
├── src/canvas/canvas-adapter.ts          ← the only production file (+242/-32 vs HEAD, incl. WP1's uncommitted lines)
└── src/__tests__/canvas-adapter.test.ts  ← 26 → 42 tests
```

**`plugin/src/canvas/canvas-adapter.ts`** (line refs = post-WP1 positions; the WP block's anchors were ~+25 stale)

- `:27-35` — header: a short "TWO STATES THIS FILE MAKES UNREACHABLE" block naming the watchdog and the adoption invariant. Phrased as structural impossibility + log observability only.
- `:80-87` — `CanvasAdapter.isBusy()` doc: rewritten as an INACTIVITY predicate bounded by `DRAG_WATCHDOG_MS`.
- `:239-248` — new `type PatchName` + `const PATCHED_METHODS` (the three patched methods, in log order) and `type PatchOutcome`.
- `:250-260` — new **exported `DRAG_WATCHDOG_MS = 5000`** with the rationale that it bounds inactivity, not drag length.
- `:262-270` — new `CanvasAdapterLogger` (`log` + `warn`) and `CanvasAdapterOpts { logger? }`.
- `:280-281` — `createCanvasAdapter(view: unknown, opts: CanvasAdapterOpts = {})` + `const logger = opts.logger`; the second parameter is optional, so the existing `main.ts:1113` call site compiles and behaves unchanged.
- `:296-299` — new state `lastDragSignalAt` + `watchdogLogged` next to the existing `isDragging` / `dragTargetId`.
- `:304-342` — new `noteDragSignal()` (`:305`), `dragActive()` (`:318`, the shared watchdog-aware seam that releases + logs, warn text at `:327`), `isDragTarget()` (`:339`, per-node gate that outlives a release).
- `:355-367` — new `classifyPatch(name)` (`:362`): non-mutating `installed` / `adopted` / `unavailable` classification; single source of truth for both the log line and `patch()`.
- `:369-400` — `patch()`: `if (typeof original !== "function" || original.__lsWrapped) return;` → `if (typeof existing !== "function") return;` plus adoption at `:382-384` (`existing.__lsOriginal` unwrap, fallback to `existing` if the marker is present but the stored original is unusable). `wrapper.__lsWrapped` / `wrapper.__lsOriginal` bookkeeping and the disposer's `if (c[name] === wrapper)` guard are **byte-identical to HEAD**.
- `:441-446` — `setDragging` patch body: `noteDragSignal()` (`:444`) + `watchdogLogged = false` (`:445`) on both edges. `isDragging` / `dragTargetId` assignment unchanged.
- `:462-468` — `markViewportChanged` patch body: `noteDragSignal()` (`:465`) before the listener fan-out.
- `:470-479` — the one-per-construction `ADAPTER PATCH:` emitter (template at `:478`), immediately before `return {`.
- `:574-578` — `isBusy()`: `return isDragging` → `return dragActive()` (`:578`).
- `:587-592` — `applyNodeGeometry`: `if (isDragging && dragTargetId === nodeId)` → `if (isDragTarget(nodeId))` (`:592`). Result-code order (`missing` before `interacting` before `unsupported`/`unchanged`/`applied`) is unchanged.
- `:610-614` — `reloadCanvasData`: `if (isDragging)` → `if (dragActive())` (`:614`).
- `:645-651` — `onPointerMove` listener: `noteDragSignal()` (`:649`) first, before `clientToCanvas`.
- `:683-687` — `destroy()`: the existing patch restore + `patchState` reset are untouched; three lines added to clear `isDragging` / `dragTargetId` / `watchdogLogged` (`:684-686`) so a detached adapter cannot keep reporting a drag it can no longer observe.
- **Not touched:** every WP1 symbol (`viewportScale`, `canvasToScreenRel`, `clientToCanvasManual`, `viewport()`, the `scale` typings) — verified line-by-line in the diff. No focus/blur/visibility listener anywhere.

**`plugin/src/__tests__/canvas-adapter.test.ts`** — 26 → **42 tests** (+16, all additive; nothing renamed, weakened, skipped or deleted)

- `:1` `afterEach` / `beforeEach` added to the vitest import; `:5` `DRAG_WATCHDOG_MS` added to the adapter import.
- `makeView` gained two optional fields: `onSetDragging` (records calls reaching the pristine method) and `wrapperEl`; `setDragging` now forwards to the hook. All 26 existing tests pass unchanged.
- New fixtures `FakeWrapperEl` / `makeWrapperEl()` (DOM-free `addEventListener` + `getBoundingClientRect` + manual `dispatch`), `makeLoggerSpy()`, `linesWith(spy, level, prefix)`.
- `describe("drag watchdog")` — 8 tests, `vi.useFakeTimers()` in `beforeEach` / `vi.useRealTimers()` in `afterEach`, zero wall-clock waits: AC13 release · `DRAG_WATCHDOG_MS === 5000` · boundary (`-1` still busy) · once-per-drag logging + payload · AC10 viewport refresh · AC10 pointermove refresh · AC11/AC12 retained target vs. reconciling canvas · AC11 genuine drag end re-arms.
- `describe("patch adoption")` — 8 tests: AC16 second adapter · AC14 three adapters, pristine method reached once · AC15/AC8 displaced disposer no-op · AC8 destroy restores all three + `patchState` reset · AC17 one line per construction with per-method outcomes · AC17 `unavailable` member · AC14 no-canvas view.

---

## main.ts Constraint

**`plugin/src/main.ts` is ABSENT from my diff. I never opened it for edit.**

- Evidence 1: `main.ts` mtime is `16:57:48`; my first production write to `canvas-adapter.ts` was `17:08:49` and my last test write `17:10:20`. The file has not been touched since before I started editing.
- Evidence 2: the adapter registry keyed by canonical path (`main.ts:1115`) is **unchanged** — I did not re-key it by `view.canvas` identity. The patch-less-second-adapter failure mode is removed *inside* the adapter instead: after adoption the newest adapter always owns the patch, so an adapter with no patches is unreachable, and the displaced adapter's guarded disposer cannot clobber the live wrapper.
- Evidence 3: the new second parameter of `createCanvasAdapter` is **optional**, precisely so that `main.ts:1113`'s existing one-argument call site needs no edit and Batch C's concurrent work on that file cannot conflict.
- Caveat for the dispatcher: a bare `git diff --name-only` on this tree **does** list `plugin/src/main.ts` (135/18) — that is the pre-existing uncommitted 0.6.0 wiring baseline plus Batch C's concurrent work, not mine. Scope the audit with `git diff --name-only -- plugin/src/canvas plugin/src/__tests__` and subtract the known baseline set.

No `ESCALATE_TO_W2` was required: nothing in US4 AC9–AC17 turned out to need a `main.ts` change.

---

## Quality Gates

| Command | Result |
|---|---|
| `npx vitest run src/__tests__/canvas-adapter.test.ts` (run 1, pre-fix) | **FAIL as intended** — 1 failed / 26 passed (27). The failure is the US4 AC13 assertion. |
| `npx vitest run … -t patch adoption` (run 2, pre-fix) | **FAIL as intended** — 1 failed / 27 skipped (28). The failure is the US4 AC16 assertion. |
| `npx vitest run src/__tests__/canvas-adapter.test.ts` (run 3, post-fix) | **PASS** — 42/42. File baseline 26 → **42** (+16), 0 regressions. |
| `npx vitest run` × 5 canvas files (run 4) | **PASS** — 72/72. `harness/canvas-double.test.ts` 12/12, `canvas-matrix.test.ts` 6/6, `canvas-binding-apply.test.ts` 4/4, `canvas-binding-capture.test.ts` 8/8 — all exactly at baseline. These four matter because they construct adapters over `CanvasDouble` and (via `two-peer.ts`) monkey-patch the double's `setDragging` / `updateSelection` themselves, which is the surface the adoption change touches. |
| `npx tsc -noEmit -skipLibCheck` (whole project, run 5) | **FAIL — 5 diagnostics, none of them mine, all in files another batch is editing right now.** `src/__tests__/canvas-sync.test.ts` (3: `PROTECTED_KEYS`, `buildCanvasData`, `docHandle_delete`) — that file's mtime is `17:11:21`, i.e. it changed *while this tsc was running*. `src/__tests__/reconcile-plan.test.ts` (2307: cannot find module `../canvas/reconcile-plan`) — an **untracked** test file whose production module does not exist yet in `plugin/src/canvas/`, i.e. another WP's red-first test mid-flight. Zero diagnostics in `canvas-adapter.ts` or `canvas-adapter.test.ts`. WP1 recorded this same command as clean earlier today, so both regressions post-date WP1 and belong to concurrent batches. |
| `npx tsc -p <scoped> --noEmit && echo WP3_SCOPED_TSC_CLEAN` (run 6) | **PASS** — printed `WP3_SCOPED_TSC_CLEAN`. Scoped config `extends` the project `tsconfig.json` verbatim (same `strict`, `isolatedModules`, `lib`, `target`) and restricts `files` to my two paths plus their transitive imports. This is the isolated proof that my change typechecks under the project's own options. Config kept outside the repo at `h:\tmp\wp3-tsconfig.json` so no stray file lands in the tree. |
| `npx biome check src/canvas/canvas-adapter.ts src/__tests__/canvas-adapter.test.ts` (run 7) | **2 findings (1 whole-file format diagnostic per file), 0 added.** The full diff is 4 hunks, every one on a line I did not author: `canvas-adapter.ts:282` (`const canvas = (view as …`) and `:497` (`markViewportChanged(optional)` in `availabilityReport`), `canvas-adapter.test.ts:277-279` and `:324` (both `createCanvasAdapter(makeView(…))` call wrapping). All four are in WP1's recorded pre-existing list. WP1 listed **five** such snippets; the fifth (`function patch(name`) is **gone**, because reformatting that signature to use `PatchName` shortened it below the print width. Finding count on touched files therefore went **down**. Advisory gate. |
| `npm run build` | **NOT RUN, by dispatcher instruction** — its esbuild step writes `plugin/main.js` while three batches run concurrently. Build gate part 1 (`tsc -noEmit -skipLibCheck`) was run standalone; see the two rows above. |
| `npm test` (full suite) | **NOT RUN, by dispatcher instruction.** Expected merged total: `537` (baseline 526 + WP1's 11) `+ 16` = **553**, all additive; no test deleted or renamed. Dispatcher runs the authoritative gate on the merged tree. |
| `grep -rniE "visibilitychange\|document\.hidden\|'blur'" plugin/src` | **0 hits** (US4 AC8 still satisfiable — no focus/visibility listener was added). |
| `grep -rnE "DRAG WATCHDOG:\|ADAPTER PATCH:" plugin/src --include=*.ts \| grep -v __tests__` | **2 production emitters**, both in `canvas-adapter.ts` (`:327` warn, `:478` log). |

### Abort criteria — all clear

- `plugin/src/types.ts:65` `useCanvasBinding: false` — verified unchanged (the file is modified in the working tree by the pre-existing baseline, not by me).
- No production import of `canvas-binding.ts` / `canvas-model-bridge.ts` added — the adapter imports nothing new at all.
- Version still `0.6.0` (`plugin/package.json:3`). No touch to `server/`, `docker/`, deploy files, `plugin/manifest.json`, the repo-root `manifest.json`, `plugin/main.js`, `server/dist/`.
- No new dependency. No reformatting of code I did not otherwise change. No wall-clock waits — every timing assertion uses `vi.useFakeTimers()` + `vi.advanceTimersByTime`.
- WP1's 26 tests: all still green, none renamed or altered.

---

## Phrasing Gate

**No line of this report, of the production code, of any code comment, or of any log message claims that S2 is diagnosed, explained or fixed.** Candidates B (a latched `isDragging`) and C (a patch-less second adapter) are treated throughout as *unproven guesses about a failure mode*, exactly as the BUILD_SPEC's architecture note requires.

Specifically:

- Every claim in this document is of one of the two permitted forms: *"the failure mode is structurally impossible"* (a drag flag that outlives its inactivity budget cannot exist because every consulting path releases it; an adapter with no patches cannot exist because `patch()` adopts) or *"the failure mode is observable in the log"* (`DRAG WATCHDOG:`, `ADAPTER PATCH: …=adopted`).
- The production header block (`canvas-adapter.ts:25-35`) is titled "TWO STATES THIS FILE MAKES UNREACHABLE" and states explicitly: *"both are observable in the log, neither is a claim about any particular reported symptom"*.
- The `DRAG WATCHDOG:` message is purely factual — measured idle ms, the limit, and which target id was retained. It does not name a cause, a bug, a user, or a symptom.
- Test names describe behaviour (`releases a drag that produced no signal for the whole window`, `the SECOND adapter over one canvas still sees the drag`) and never assert a root cause.
- No occurrence of "fixes the bug", "root cause", "this was the cause", "diagnosed", or an equivalent claim about S2 appears anywhere in my diff.

---

## Risk Notes

- **HANDOVER / flagged for the dispatcher — the two log signatures have a production emitter but no production *sink* yet.** `main.ts:1113` calls `createCanvasAdapter(view)` with no options object, so at runtime `logger` is `undefined` and both lines are suppressed by the `logger?.` guard. Adding the sink is a **one-line** change — `createCanvasAdapter(view, { logger: this.logger })` — in `main.ts`, which this WP is forbidden to touch (it is Batch C's file this round). Everything else is already in place: the emitters are production code and greppable, the injection point mirrors the established `createCanvasModelBridge(adapter, { logger: this.logger })` pattern two dozen lines below, `CanvasAdapterLogger` is structurally satisfied by `DebugLogger`, and both lines have logger-spy assertions. **The behavioural half of the WP is unaffected** — the watchdog releases the flag and `applyNodeGeometry` / `reloadCanvasData` / `isBusy` all recover with or without a logger. This is not an `ESCALATE_TO_W2` case (no AC required a `main.ts` edit), but the dispatcher should land that one line on merge or US6's runtime observability stays dark.
- **`ADAPTER PATCH:` reports the outcome as classified at *construction*, while patches install *lazily*.** US4 AC17 demands one line per construction; making the real outcomes available at that moment would require eager patching, which would reorder adapter patching against the WP2 harness's own `setDragging` / `updateSelection` wrapping in `two-peer.ts` and risk the 8 `canvas-binding-capture` and 6 `canvas-matrix` cases. I therefore kept lazy install and log the classification produced by `classifyPatch()` — the **same function** `patch()` uses to decide adoption, evaluated on the same canvas object. In production the gap is microseconds inside `mountCanvasPresence` (construct → `canvas-presence` subscribes), and the divergence-proof is behavioural: test `:615` asserts the logged `adopted` and test `:539` asserts the second adapter really does receive the signal.
- **Adoption intentionally silences the displaced adapter.** After adoption the older adapter's `after` callback is no longer in the chain, so its `isDragging` freezes and its listeners stop firing. That is the AC14 contract ("the newest adapter always owns the patch") and the reason the guarded disposer matters, but a consumer holding a stale adapter reference will observe a permanently non-busy adapter. `main.ts`'s registry replaces the entry on re-mount, so no production reader is left holding one; a future refactor that caches adapters elsewhere must call `destroy()` on displacement.
- **The watchdog is only as good as its refresh sources.** Both live in production (`canvas-presence.ts:325` `onPointerMove`, `:329` `onViewportChange`), but if presence fails to mount, the only remaining source is `setDragging` itself. A slow drag with **zero** pointer events for 5 s would then release the canvas-wide block early. The retained `dragTargetId` is the deliberate mitigation: the node under the drag keeps returning `"interacting"` regardless, so the worst case is that *other* nodes reconcile during a drag — which is the pre-existing behaviour for every non-target node anyway.
- **`Date.now()`, not a `setTimeout`.** The watchdog is evaluated on consultation, so there is no timer to leak, nothing for `destroy()` to cancel, and no interaction with other suites' fake timers. Consequence: the `DRAG WATCHDOG:` line is emitted at the first *consultation* after expiry rather than at the expiry instant. In production that consultation is `main.ts:994`'s `isBusy()` on the next reconcile — exactly the moment the latch would have mattered. Verified that Vitest 4's default `vi.useFakeTimers()` does fake `Date`, so this is fully testable without wall-clock waits.
- **`reloadCanvasData` still does not call `ensureDraggingPatch()`** (unchanged from HEAD). If a caller reaches it without ever polling `isBusy()`, the dragging patch may be uninstalled and `isDragging` therefore always `false` — a pre-existing gap, deliberately left alone to keep this WP's diff minimal. Worth a follow-up; it is not part of US4 AC9–AC17.
- **`DRAG_WATCHDOG_MS` and the two new interfaces are new exported symbols** from `canvas-adapter.ts`. Deliberate (AC6 requires the constant be assertable), and free at runtime: no production file imports them yet, so tree-shaking is unaffected.

---

## Handover summary

`isBusy()` is no longer a raw flag read. `dragActive()` is the single watchdog-aware seam — `isBusy()`, `applyNodeGeometry()` (via `isDragTarget()`) and `reloadCanvasData()` all go through it — and it releases `isDragging` after `DRAG_WATCHDOG_MS` (exported, 5000) of complete drag-signal silence while **retaining** `dragTargetId`, so whole-canvas reconciliation returns but the held card stays protected. The clock is refreshed by the `markViewportChanged` patch and the `pointermove` listener, so a long but active drag never trips it. `patch()` now adopts: it unwraps an existing `__lsWrapped` wrapper via `__lsOriginal` and re-wraps the pristine method, so the newest adapter over a canvas always owns the patch, the pristine method is still invoked exactly once, and the displaced adapter's disposer is a proven no-op thanks to the pre-existing `if (c[name] === wrapper)` guard. `destroy()` still restores everything and resets `patchState`. Two greppable signatures were added (`DRAG WATCHDOG:`, `ADAPTER PATCH:` with `installed`/`adopted`/`unavailable` per method) behind an optional injected logger — **one line in `main.ts` is still needed to give them a runtime sink**. Two files changed, `main.ts` untouched, 26 → 42 tests, no neighbour regressed.
