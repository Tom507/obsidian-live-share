# Implementation Report — WP6: Single-writer precondition (US5 AC1–AC12, US6 `CANVAS TEXT FALLBACK:`)

**Batch C, third.** Depends on WP4 + WP5 (both already landed in `main.ts`); WP7 follows.
**Result:** DONE. The round's headline RED was observed against HEAD logic, with the concrete
edge corruption recorded verbatim below, and is GREEN after the fix.

---

## ACs Satisfied

### BUILD_SPEC WP6 acceptance criteria

| # | AC | How verified |
|---|---|---|
| 1 | US5 AC1–AC12 hold, incl. the exact four-case matrix | 19 new tests in `canvas-single-writer.test.ts` + 2 in `background-sync.test.ts`; table below |
| 2 | Composition regression confirmed **RED against HEAD**, GREEN after | Observed twice: initial run (production untouched), then again under a verbatim HEAD-logic revert. Corruption recorded below |
| 3 | The concurrency touches **edges**; reuses `makeTwoPeer` + `waitQuiescent` | Both peers' concurrent edits recolour an edge (`e1` on A, `e2` on B) as well as dragging a node. Canvas docs come from `makeTwoPeer()` and are exchanged by `tp.waitQuiescent()`; the `Y.Text` doc pair is exchanged by the harness's exported `waitQuiescent(a, b)` — the same state-vector-snapshot function, not a re-implementation |
| 4 | US5 AC2: `startAll` never calls `getDoc(<bare canvas path>)` | `background-sync.test.ts` → *"WP6/US5-AC2: startAll creates no Y.Text document for a .canvas entry"* asserts the recorded `getDoc` argument list excludes `board.canvas` while `notes/hello.md` in the same manifest is still subscribed |
| 5 | US5 AC4: echo **or** flag-ON calls **neither** handler | Matrix cases 2 and 3. Both were RED under HEAD logic (`handleLocalTextModify` called 1×) |
| 6 | US5 AC8: `backgroundSync.unsubscribe` precedes `canvasSync.subscribe` at **both** sites, asserted by call-order spies | Call-order spy test (exact array equality) on `subscribeCanvasWithHandover`, plus a source assertion that `main.ts` contains **zero** direct `canvasSync.subscribe(` and exactly **two** `subscribeCanvasWithHandover({` call sites |
| 7 | US5 AC9: a failed subscribe installs the text fallback; both call sites | Two tests — subscribe that settles without claiming, and a subscribe that **rejects**. Both call sites are covered by construction (single shared helper) + the `main.ts` source assertion |
| 8 | `useCanvasBinding` stays `false`; flag-ON branch only exercised by a local setting | `plugin/src/types.ts` untouched (`useCanvasBinding: false` verified); matrix case 3 flips `settings.useCanvasBinding` on its own fixture only |
| 9 | `background-sync.test.ts` stays green | 23 → 25, all pass. No existing case modified (see *Corrected Tests*) |
| 10 | `main.ts` wiring only; predicate unit-testable (D6) | `canvasOwned` and `subscribeCanvasWithHandover` are exported from `vault-events.ts` and unit-tested directly. `main.ts` gained: one import, one loop body, one lazy-subscribe body, one teardown line |

### US5 AC1–AC12

- **AC1** exactly one subsystem per shared `.canvas` at any instant — enforced by AC2 (no text doc created) + AC3/AC4 (text path unreachable when canvas-owned); proven end-to-end by the composition test.
- **AC2** `startAll` creates no `Y.Text` for a `.canvas`. ✔
- **AC3** ownership is one explicit predicate, evaluated once per modify event: `canvasOwned(path, canvasSync)`. ✔
- **AC4** canvas-owned ⇒ `handleLocalTextModify` never called, whatever the reason the canvas branch declined. ✔
- **AC5** not canvas-owned ⇒ text path unchanged, announced with one `warn` per path. ✔
- **AC6** four-case matrix. ✔ (table below)
- **AC7** only a genuinely FAILED subscribe produces the unowned state — a **pending** subscribe already reports owned. Verified with a real `CanvasSync` whose `waitForSync` never settles: `canvasOwned` is `false` before the call and `true` immediately after the un-awaited `subscribe(...)`. ✔
- **AC8** unowned → owned handover ordering. ✔
- **AC9** owned → unowned fallback at both call sites. ✔
- **AC10** failed-then-successful subscribe hands the path back with `unsubscribe` before `subscribe`. ✔ (full 5-element call-order array asserted)
- **AC11** composition regression exists and was RED first. ✔
- **AC12** the concurrency touches edges. ✔

### US6 — `CANVAS TEXT FALLBACK:`

Production emitter: `plugin/src/files/vault-events.ts` → `warnCanvasTextFallback()`, routed through the
existing `DebugLogger` seam (`warn(category, message)`), no new logging framework, no new dependency.
Two production call sites: the failed-subscribe branch of `subscribeCanvasWithHandover`, and the
unowned-canvas branch of the `modify` handler. Fires **once per path per session** (module-level set,
cleared by `resetCanvasTextFallbackWarnings()` from `cleanupSession()`); asserted by logger-spy tests in
both places. No file contents, node text or user data in the line — path only.

---

## ACs Not Satisfied

- **US6 AC6** (append the new signature rows to the `ARCHITECTURE.md` § Appendix table) is *not* done.
  `ARCHITECTURE.md` is outside WP6's declared file set, and US6 is explicitly shared across WP2–WP7
  ("no WP owns this story alone"). The `CANVAS TEXT FALLBACK:` row still needs to be appended by
  whoever closes US6 documentation. Everything else in US6 that WP6 owns (emitter, prefix, spy
  assertion, once-per-occurrence, no user data) is done.

Nothing else. US5 AC13–AC18 are WP7's and were deliberately not touched; `CanvasPersistence` is **not**
wired.

---

## RED-First Observations

### Headline: the composition regression (US5 AC11/AC12) — with the actual edge corruption

Written and run **before** any production change. Verbatim failure:

```
FAIL  src/__tests__/canvas-single-writer.test.ts > WP6 / US5 — single-writer precondition for .canvas
      > US5 AC11/AC12: concurrent edits touching edges never break edge endpoints
AssertionError: peer A canvas on disk is not valid JSON: (unparseable JSON, 835 chars):
expected null not to be null
```

**The concrete corruption.** Scenario: 3 cards `n1 → n2 → n3` wired by 2 arrows
(`e1: n1→n2`, `e2: n2→n3`). Peer A drags card `n1` and recolours arrow `e1`; peer B *concurrently*
drags card `n3` and recolours arrow `e2`. Neither peer touched an endpoint. After the exchange,
**both peers' `board.canvas` on disk were byte-identical garbage** — the merged `Y.Text`, written last
by `BackgroundSync` over the correct file `CanvasSync` had just produced:

```text
  "edges": [
    {
      "id": "e1",
      "fromNode": "n1",
      "fromSide": "right",
      "toNode": "n2",
      "toSide": "left",
      "color": "1900,        ←  A's  "color": "1"  collided with B's  n3.x = 900
      "y": 0,                ←  the tail of NODE n3 spliced INSIDE edge e1's object
      "width": 200,
      "height": 100,
      "text": "gamma"
    }
  ],
  "edges": [                 ←  a SECOND "edges" array; e2 is outside the first one
    { "id": "e1", "fromNode": "n1", ... },
    { "id": "e2", "fromNode": "n2", ..., "color": "6" }
  ]
}
```

Damage, precisely:

- `e1` acquired the unterminated string value `"color": "1900,` — A's `"1"` and B's `900` merged
  character-wise into one token.
- Node `n3`'s remaining fields (`y`, `width`, `height`, `text`) were relocated **into the edges array**,
  inside `e1`'s object.
- The `"edges"` key appears **twice**; `e2` lives in the orphaned second array.
- Net effect: the file no longer parses (835 chars). Obsidian's `importData` gets nothing —
  **all 3 cards and both arrows (`e1: n1→n2`, `e2: n2→n3`) are lost.** This is the literal
  "connections break on parallel edit" symptom, reproduced deterministically.

Mechanism confirmed by the same dump: peer A's **bare-path `Y.Text`** (`board.canvas`, the
`BackgroundSync` document) held the identical garbage. It can only exist because `startAll` created a
second CRDT for a path `CanvasSync` already owned. `applyMinimalYTextUpdate` replaces ONE contiguous
span (first difference → last difference); each peer's edit spanned from a node to an edge, so the two
spans overlapped and Yjs applied both replacements into the union of the deleted range.

After the fix: **GREEN**, unchanged test, no assertion weakened.

### The other five REDs

To keep the record honest, the production `modify` handler was temporarily restored to its verbatim
HEAD form and the `startAll` skip removed (a manual, exactly-reversed edit pair marked
`TEMP-HEAD-REVERT`; **no git command was used at any point**). Under HEAD logic, run `w3-wp6-r5`:

```text
Tests  6 failed | 38 passed (44)

× WP6/US5-AC2: startAll creates no Y.Text document for a .canvas entry
  AssertionError: expected [ 'notes/hello.md', 'board.canvas' ] to not include 'board.canvas'
× US5 AC11/AC12: concurrent edits touching edges never break edge endpoints
  AssertionError: peer A canvas on disk is not valid JSON: (unparseable JSON, 835 chars)
× AC6 case 1 — subscribed, no disk-write echo, flag OFF → canvas x1, text x0
  AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times
× AC6 case 2 — subscribed, CanvasSync's own disk-write echo → NEITHER
  AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times
× AC6 case 3 — subscribed, useCanvasBinding ON → NEITHER
  AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times
× US5 AC5 / US6: the unowned-canvas text path warns CANVAS TEXT FALLBACK: once per path
  AssertionError: expected [] to have a length of 2 but got +0
```

The revert was then undone verbatim; `grep TEMP-HEAD-REVERT src` returns nothing and the full
neighbour set is green (below).

---

## Four-Case Matrix

`.canvas` modify event, shared path, driven through the real `registerVaultEvents` dispatcher.
Observed call counts (`w3-wp6-r10`, after the fix; HEAD column from `w3-wp6-r5`):

| Case | `handleLocalModify` | `handleLocalTextModify` | Under HEAD logic |
|---|---|---|---|
| subscribed, not a recent disk write, flag OFF | **1** | **0** | 1 / **1** ← RED |
| subscribed, CanvasSync's own disk-write echo | **0** | **0** | 0 / **1** ← RED |
| subscribed, `useCanvasBinding` ON | **0** | **0** | 0 / **1** ← RED |
| **not** subscribed, shared path | **0** | **1** | 0 / 1 (already correct) |

Additional guard cases asserted alongside:

| Case | Result |
|---|---|
| `canvasSync === null` (no session canvas layer) | text 1, canvas 0 — not canvas-owned |
| `backgroundSync.isRecentDiskWrite` true | neither — the pre-existing short-circuit still wins first |
| plain `notes/hello.md` modify | text 1 (with the path), canvas 0 — markdown path untouched |

The AC5 trap is closed structurally, not by an `else`: `canvasOwned` true takes an **early return**, so
the text call below it is unreachable for a canvas-owned path *regardless* of why the canvas branch
declined. `grep -n handleLocalTextModify plugin/src/files/vault-events.ts` → exactly one hit, at line
256, below that return.

---

## Handover Ordering

`subscribeCanvasWithHandover` is the single place `canvasSync.subscribe` is invoked in production.
`backgroundSync.unsubscribe(path)` is the statement **immediately preceding** it, in the same
synchronous block — `unsubscribe` flushes the pending `Y.Text` write and detaches the observer, so the
last text flush lands before CanvasSync's seed reads the file and no vault event can interleave.

Call-order spy evidence (exact array equality, not "was called"):

```text
successful subscribe        [ backgroundSync.unsubscribe(board.canvas),
                              canvasSync.subscribe(board.canvas,host) ]
                            backgroundSync.subscribe  NOT called;  no warn

failed subscribe            [ backgroundSync.unsubscribe(board.canvas),
                              canvasSync.subscribe(board.canvas,host),
                              backgroundSync.subscribe(board.canvas) ]
                            warn 1×  "CANVAS TEXT FALLBACK: board.canvas ..."

fail then succeed (AC10)    [ backgroundSync.unsubscribe(board.canvas),
                              canvasSync.subscribe(board.canvas,host),
                              backgroundSync.subscribe(board.canvas),
                              backgroundSync.unsubscribe(board.canvas),   ← hand-back
                              canvasSync.subscribe(board.canvas,host) ]
                            warn still 1× total (once per path per session)
```

Both call sites: asserted at source level, because `main.ts` has no test file —

```ts
expect(source).not.toMatch(/canvasSync\??\.subscribe\(/);              // zero direct calls left
expect(source.match(/subscribeCanvasWithHandover\(\{/g)).toHaveLength(2); // session start + lazy
```

Also asserted: the helper issues the subscribe **synchronously**, so `isSubscribed()` still reads true
in the same pass — `syncCanvasPresences` mounts the presence overlay on that same tick, exactly as
before. A rejected subscribe is caught, so the fallback is installed rather than swallowed by an
unhandled rejection.

---

## Corrected Tests

**None found.** All 23 pre-existing cases in `background-sync.test.ts` were reviewed; none asserts that
a `.canvas` entry *is* subscribed (the closest, *"subscribes to all text files from manifest"*, uses
only `.md` and `.png`). `regression.test.ts` calls `startAll` five times but contains no `.canvas`
path at all (`grep -n "\.canvas" regression.test.ts` → no matches). No existing test was modified,
weakened or deleted anywhere in this WP — the two `background-sync.test.ts` additions are purely new.

That absence is itself the finding: **no test at HEAD ever put a `.canvas` through `BackgroundSync`**,
which is exactly why 526 green tests never caught a bug that destroys user data.

---

## Files Changed

```text
plugin/src/files/vault-events.ts        ← predicate + handover helper + restructured modify handler
├── NEW export  canvasOwned(path, canvasSync)                    ← US5 AC3 predicate (D6, unit-tested)
├── NEW export  subscribeCanvasWithHandover(options)             ← US5 AC8/AC9 transition
├── NEW export  warnCanvasTextFallback(path, logger)             ← US6 signature emitter
├── NEW export  resetCanvasTextFallbackWarnings()                ← once-per-session reset
├── NEW types   CanvasOwnershipSource, CanvasFallbackLogger, CanvasHandoverOptions
└── modify handler: canvas branch → early return; text call now unreachable when canvas-owned

plugin/src/files/background-sync.ts     ← 1 statement + comment
└── startAll(): `if (path.endsWith(".canvas")) continue;`        ← US5 AC2

plugin/src/main.ts                      ← WIRING ONLY (4 edits, no logic)
├── import { registerVaultEvents, resetCanvasTextFallbackWarnings, subscribeCanvasWithHandover }
├── cleanupSession(): + resetCanvasTextFallbackWarnings()        ← after `this.canvasSync = null`
├── connectSync(): manifest canvas loop → subscribeCanvasWithHandover({...})
└── syncCanvasPresences(): lazy subscribe → subscribeCanvasWithHandover({...})

plugin/src/__tests__/background-sync.test.ts   ← +2 tests (23 → 25), none modified
plugin/src/__tests__/canvas-single-writer.test.ts  ← NEW, 19 tests
```

Not touched: `canvas-sync.ts`, `canvas-persistence.ts`, `utils.ts`, `types.ts`, `manifest.json`,
`server/`, `docker/`, deploy files, `plugin/main.js`. Version stays `0.6.0`. No new dependency.

---

## Quality Gates

| Command | Result |
|---|---|
| `npx tsc -noEmit -skipLibCheck` | **PASS** (`TSC_CLEAN`) |
| `npx vitest run` over WP6 files + regression neighbours (8 files) | **PASS** — 180 passed / 0 failed |
| `npx biome check src/__tests__/canvas-single-writer.test.ts` | **PASS** — 0 findings (new file, formatted) |
| `npx biome check` on the 3 other touched files | 1 whole-file format finding each — the **known CRLF environment red**, pre-existing and unchanged (line 1 of each untouched import block is flagged). Count on touched files not increased |
| `npm run build` | **NOT RUN** — esbuild writes the shared `plugin/main.js`; forbidden for a parallel-WP tree. `tsc -noEmit` covers the compile half |
| `npm test` (full suite) | **NOT RUN** — one case sleeps 33 s; targeted runs only, per WP brief |

Per-file counts (before → after):

```text
background-sync.test.ts          23 → 25   (+2)
canvas-single-writer.test.ts      0 → 19   (+19, NEW file)
canvas-sync.test.ts              40 → 40   (unchanged)
exclusion.test.ts                10 → 10   (unchanged)
manifest.test.ts                 57 → 57   (unchanged)
canvas-matrix.test.ts             6 →  6   (unchanged)
harness/two-peer.test.ts         10 → 10   (unchanged)
regression.test.ts               13 → 13   (unchanged)
```

Projected whole-suite total: **590 / 33 files → 611 passed / 34 files** (+21, +1 file).

Abort criteria checked: `useCanvasBinding` default still `false` in `plugin/src/types.ts`; no new
production import of `canvas-binding.ts` / `canvas-model-bridge.ts`; no previously-passing test fails.

---

## Risk Notes

1. **`onFileAdded` is deliberately untouched.** A `.canvas` *created* mid-session (host `create` event)
   still gets a `Y.Text` doc via `backgroundSync.onFileAdded`. This is the § 6.1 TEXT-OWNED state and
   is correct: CanvasSync does not own it yet, it is **exclusive** (CanvasSync is not on that path),
   and the first `modify` now emits `CANVAS TEXT FALLBACK:`. When the user opens it,
   `syncCanvasPresences` performs the handover and the text observer is detached. WP6's scope named
   `startAll` only; widening it would have changed the create path unnecessarily.
2. **The orphaned `Y.Text` doc is not released after handover** — out of scope by the BUILD_SPEC
   (§ 12 R5, P2). `unsubscribe` detaches the observer and flushes, but does not `releaseDoc`.
3. **The fallback still syncs a canvas through character-merge.** Deliberate and documented
   (§ 6.1 trade-off): it engages only when there is no structured doc at all, and it is never
   concurrent with CanvasSync, which is the actual cause of corruption.
4. **Session-start call sites stay fire-and-forget (`void`).** `connectSync` is `async`, but awaiting
   each canvas handover in the loop would serialize session start ahead of `PresenceManager`
   construction — a behaviour change HEAD does not have. The `await` that AC9 requires happens
   *inside* the helper, which is where the fallback decision is made.
5. **`main.ts` now has a source-level test.** `canvas-single-writer.test.ts` asserts `main.ts` contains
   zero direct `canvasSync.subscribe(` and exactly two `subscribeCanvasWithHandover({`. Any future WP
   that adds or removes a canvas subscribe call site in `main.ts` must route it through the helper or
   update that count. This is intentional — it is the only guard that keeps the handover ordering true
   at *both* sites.
6. **US6 AC6 documentation row** for `CANVAS TEXT FALLBACK:` is still owed in `ARCHITECTURE.md`
   (outside WP6's file set).
7. **For WP7:** the composition test asserts endpoints **as read from the `.canvas` file on disk**. It
   instantiates `BackgroundSync` + `CanvasSync` per peer but **not** `CanvasPersistence`. If WP7 retires
   `CanvasSync.scheduleDiskWrite` → `writeToDisk` for canvas-owned paths, the test will still pass (the
   endpoints it checks are already correct on disk from setup), but it will stop exercising the
   post-edit disk write. WP7 should re-run it and, if it wires `CanvasPersistence` as the writer,
   consider adding it to `makePeer` so the test keeps proving what it claims.
