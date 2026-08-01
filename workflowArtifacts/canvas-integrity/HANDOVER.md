# Handover — Obsidian Live Share, Canvas Integrity Round

W3 run: 2026-07-26 · Dispatcher mode, 7 WPs, three file-disjoint batches
Project key: `obsidian-live-share` · Repo: `H:\Developement\_NeuralAngels\liveshareCollab\obsidian-live-share`
Round folder: `workflowArtifacts/canvas-integrity/`

---

## Scope of This Run

- **Tasks completed:** WP1, WP2, WP3, WP4, WP5, WP6, WP7 — all seven DONE.
- **Tasks with risk flags:** WP5 (authorised scope addition), WP7 (out-of-set test edit + deliberate lifetime deviation), plus the dispatcher's own untested `main.ts` logger wiring.
- **Nothing was deployed and nothing was installed into either vault.** Both test vaults still run 0.6.0 as shipped. Version was not bumped. `server/`, the deploy stack and `docker/.env` were never touched.

---

## Authoritative Gate Results

Measured by the **dispatcher on the merged tree**, after every WP landed and after the
dispatcher's own carry-over edits. These are not copied from sub-agent reports.

| Gate | Baseline (measured before dispatch) | Merged tree | Verdict |
|---|---|---|---|
| `npm run build` (tsc + esbuild) | PASS, exit 0 | **PASS, exit 0** | PASS |
| `npm test` (vitest) | 526 passed / 32 files / 0 failed | **621 passed / 34 files / 0 failed** | PASS (+95 tests, +2 files) |
| `npx biome check plugin/src` | ~93 findings claimed by spec | 70 errors + 2 warnings | advisory; no WP increased findings on files it touched |

Suite duration 41.4 s (one latency case deliberately sleeps 33 s — not a hang).

### §7 abort criteria — all clear

```text
├── npm run build fails ......................................... NO  (exit 0)
├── previously-passing test fails without justification ......... NO  (0 failed; see "Corrected Tests")
├── test count below 526 ........................................ NO  (621)
├── useCanvasBinding default no longer false .................... NO  (types.ts:65 `useCanvasBinding: false`)
└── new production import of canvas-binding/canvas-model-bridge
    outside the existing flag-gated branch ...................... NO  (main.ts:6/:10 are baseline;
                                                                      construction gated at main.ts:1262)
```

### Definition-of-Done greps

```text
├── CanvasPersistence production call site ...... main.ts:24 attachCanvasPersistence, :129 canvasWriters
│                                                 (ZERO at HEAD → satisfied)
├── scheduleDiskWrite from the doc observer ..... none; canvas-sync.ts:810 is a comment only
├── focus / visibilitychange / document.hidden .. 0 hits (unchanged)
├── US6 signatures with a production emitter .... 10 / 10
└── version ..................................... 0.6.0 unchanged (manifest.json + package.json)
```

---

## WP Status Summary

| WP | Title | Status | Tests added | Reds observed | Risk Flag | Priority for W4 |
|---|---|---|---|---|---|---|
| WP1 | Cursor transform (S4) | DONE | +11 | 2 | NONE | NORMAL |
| WP2 | Awareness survival (S2-A) | DONE | +8 | 2 | LOW | HIGH |
| WP3 | Adapter robustness (S2-B/C) | DONE | +16 | 2 | LOW | HIGH |
| WP4 | Node + edge locking (S1) | DONE | +6 | 4 | MEDIUM | CRITICAL |
| WP5 | Reconcile completeness + key protection (S3) | DONE | +23 (+1 file) | 6 | **HIGH** | **CRITICAL** |
| WP6 | Single-writer precondition | DONE | +21 (+1 file) | 6 | MEDIUM | **CRITICAL** |
| WP7 | Wire `CanvasPersistence` | DONE | +10 | 3 | **HIGH** | **CRITICAL** |

**25 red-first observations were recorded across the round.** Every defect fix was
observed failing before it was made to pass. Verbatim failure output for each is in the
per-WP `ImplementationReport_WP<N>.md`.

No WP was made to fail red artificially, and one WP (WP4) reported that a red the
BUILD_SPEC predicted **was already green** rather than manufacturing one — see below.

---

## Deviations from the BUILD_SPEC — read before validating

### D1 — A BUILD_SPEC red claim was factually wrong (WP4)

The spec asserts US2 AC2 (concurrent `color` vs `toSide` on one edge) was RED at HEAD.
**It was not.** The destructive `new Y.Map()` edge re-create sat in an `else if` chain
*after* `} else if (existing) { applyKeyDiff(...) }`, so it was reachable **only** when the
edge was absent from the CRDT — i.e. the remote-delete case, which is AC3. A
changed-and-present edge already merged per key at HEAD. WP4 verified this rather than
assuming it, kept the AC2 test as a regression guard, and took its fourth red from
US2 AC1 (which it genuinely owns) instead. **No red was faked.**

### D2 — Dispatcher-authorised scope addition: an unnamed HIGH edge-endpoint deletion path (WP4 → WP5)

Not in the BUILD_SPEC. Found by WP4, fixed by WP5 under my explicit authorisation.

- `applyLocalDiffToYMaps`' `!baseObj && existing` branch full-merges via `applyToYMap`,
  which **deletes every key the local record lacks**. The `GEOMETRY_KEYS` exemption is
  node-shaped, so for an **edge** every key was deletable — including `fromNode`/`toNode`.
- It escapes the safety net: `buildCanvasData`'s dangling-edge guard requires a `string`,
  so an edge that *lost* the key entirely passes straight through to disk. The BUILD_SPEC
  records this as a "Known hole" in § 4 but never assigns it.
- **WP5 found the same loss is ALSO reachable through `applyKeyDiff`**, not just
  `applyToYMap` — a second branch the hand-off had not identified. Both now have their own red.
- Fixed via a new exported `PROTECTED_KEYS` set consulted by both delete guards.
  `fromSide`/`toSide` were included — a judgment call, rationale in `ImplementationReport_WP5.md`.
- `GEOMETRY_KEYS` membership and export are unchanged, as US3 AC10 requires.

**W2 should ratify this. W4 should probe it hard — it is the round's largest unplanned change.**

### D3 — WP7 edited a file outside its declared set

`plugin/src/__tests__/canvas-sync.test.ts`. Three cases asserted that *`CanvasSync` writes
`.canvas` bytes* — the exact behaviour WP7 AC9 retires. They cannot survive the retirement.
Each was corrected in place and **re-pointed at the new writer**, so no coverage is lost and
the file stays at 40 tests. The rejected alternative (a per-path "external writer" flag in
`CanvasSync`) would have left two components that both believe they schedule canvas writes —
precisely what the spec's architecture notes rejected. **Acknowledged and accepted by the dispatcher.**

### D4 — WP7 changed the persistence writer's lifetime

The WP block hinted at teardown alongside the presence/adapter. That is the **view-close**
path, and it would stop persisting a canvas the moment its tab closes — the exact case the
writer exists for. WP7 instead ties writer lifetime to the **subscription**, torn down in
`teardownCanvasPresences()` on both destroy paths. Deliberate, and better than the spec's letter.

### D5 — WP5's AC2 red is only half-verifiable

The "module absent" half is a genuine red (`Cannot find module '../canvas/reconcile-plan'`).
The other half — "today's equivalent decision yields the geometry branch" — cannot be
reproduced empirically, because at HEAD it was an inline expression inside a private method
of a class with **no test file**. Verified by code reading and reported as such. Same class
of overstatement as D1.

### D6 — Dispatcher-owned carry-over edits (NOT covered by any WP's tests)

Three items no WP owned, completed by the dispatcher after Batch C released `main.ts`:

1. `main.ts` — `this.syncManager.setLogger(this.logger);`. WP2 discovered `SyncManager`
   had **no** production logger caller, so `AWARENESS GAP:` was measured but written to a
   null logger. `SyncManager` is constructed before the `DebugLogger`, so the attach sits
   immediately after the logger is created.
2. `main.ts` — `createCanvasAdapter(view, { logger: … })`, so `ADAPTER PATCH:` and
   `DRAG WATCHDOG:` are recorded rather than dropped. **WP3's suggested one-liner would not
   have compiled:** `CanvasAdapterLogger` declares `log(...)` while `DebugLogger` (like
   `CanvasSyncLogger` and `SyncLogger`) exposes `debug(...)`. The two names are bridged at
   the call site rather than churning WP3's 42 verified tests. The interfaces are still not unified.
3. `ARCHITECTURE.md` § Appendix — the ten-signature table (US6 AC6), which no WP owned and
   which sat outside every WP's file set. Includes the audit grep and both logger caveats.

> **`plugin/src/main.ts` has no test file (R6).** Items 1 and 2 are therefore **verified only
> by `tsc` and the build** — no test asserts them. This is the single most important thing
> for W4 to confirm at runtime.

---

## Risk Notes for W4

### CRITICAL — probe hardest

- **`PROTECTED_KEYS` (D2).** The unplanned fix. Confirm an edge cannot lose `fromNode`/`toNode`
  through *either* `applyToYMap` or `applyKeyDiff`, and confirm that protecting
  `fromSide`/`toSide` did not make a legitimate side change unwritable. Adversarial case:
  a peer genuinely deleting an optional key that is now protected.
- **WP7 activated a dormant module (R4).** `CanvasPersistence` had **zero** production callers
  before this round, so its mute refcount leak and its unserialized writes had never run in
  production. Both are now fixed with their own reds, but everything about this module is
  newly live. The failure mode if the leak fix is wrong is severe and silent: a
  **permanently muted canvas path** where every vault `modify` event is dropped forever.
  Verify `isPathMuted(path) === false` after overlapping flushes under a continuous remote stream.
- **Single-writer end to end (WP6 + WP7).** The composition test proves convergence at the
  CRDT level; confirm the *disk* really has one writer under a live two-peer edit, and that
  `noteExternalDiskWrite` keeps `vault-events.ts:121`'s echo check correct.
- **`coldOpen` guest semantics changed deliberately.** The doc-empty case now **seeds the doc
  from the file** instead of only recording a baseline. Host seed untouched. Exercise a guest
  joining an empty room with a non-empty local file.

### HIGH

- **S2 is still unproven (R2, accepted going in).** WP2 and WP3 are defensive guards plus
  instrumentation, not a diagnosis. No AC, comment, log line or report in either WP claims
  otherwise — the phrasing gate held in both. If the decay symptom recurs, `AWARENESS GAP:`,
  `DRAG WATCHDOG:` and `ADAPTER PATCH:` are the three discriminators, which is why D6 items
  1 and 2 matter: **without them all three signatures are silently suppressed.**
- **Confirm the log signatures actually appear at runtime.** All ten have a production emitter
  and a logger-spy assertion, but the two adapter/sync ones depend on untested `main.ts` wiring.
- **`main.ts` has no test file (R6).** WP4, WP5, WP6, WP7 and the dispatcher all added wiring
  there. WP6 mitigated with a source-level test asserting zero direct `canvasSync.subscribe(`
  and exactly two `subscribeCanvasWithHandover({` — **any new canvas subscribe site must route
  through the helper or that count must be updated deliberately.**

### MEDIUM / accepted

- **R1 ROLLOUT BLOCKER unchanged.** `useCanvasBinding` stays `false` and its `{id}`-edge-capture
  data-loss defect is untouched by design. It must not be enabled on any canvas that matters
  until a future round fixes the bridge's edge capture to carry endpoints *and* sides.
- **R10 — the WP6 text fallback** syncs a canvas as raw `Y.Text`, the same character-merge
  mechanism that corrupts edges. Accepted because it is *exclusive* (never concurrent with
  `CanvasSync`, and concurrency is what causes the corruption) and it announces itself with
  `CANVAS TEXT FALLBACK:`.
- **R9 — the destructive host re-seed** (`applyCanvasToYMaps` deletes doc entries absent from
  the host's local file) is deliberately untouched, so WP7 was not also a semantics change.
  Top follow-up candidate.
- **P2 items not done:** GAP-7 lock epoch (P2-1) and releasing the orphaned `Y.Text` doc after a
  fallback→owned handover (P2-2). Both remain as documented, accepted risks.
- **`CanvasSync.writeToDisk` and the `remoteSeq` gate are retained with no caller** (permitted by
  AC9), which keeps WP4's seq-gate test green. Dead-ish code to clean up later.

### Verification that does NOT exist

**No behavioural or manual verification was performed.** Everything above is unit- and
integration-level with deterministic fixtures. There was **no two-vault E2E run, no real-vault
spike, and no install**. The E2E rig exists and was deliberately left to W4 (see entry points).

---

## Summary for W4 Entry Point

What is now observable: a `.canvas` file has exactly one owner per modify event
(`canvasOwned` in `vault-events.ts`) and exactly one CRDT→disk writer
(`CanvasPersistence`, attached from `main.ts` via `attachCanvasPersistence`);
`BackgroundSync` no longer creates a `Y.Text` document for a canvas at all. Edge writes and
deletes now pass the same lock seam as nodes, a denied pass holds `lastWrittenContent` back
instead of silently diverging, and `onRevert` finally rolls a losing client's view back to
shared truth. Remote non-geometry changes reach the open view through the new pure
`reconcile-plan.ts` classifier (`structural | geometry | noop`) while the geometry fast path
survives for drags. `type`, `fromNode`, `toNode`, `fromSide` and `toSide` are undeletable in
the CRDT via `PROTECTED_KEYS`. Remote cursors use the linear scale factor, so they land where
the peer's pointer is at every zoom level. Ten greppable log signatures cover every failure
mode this round touched.

How to trigger the main flows:

```text
Fast regression sweep (deterministic, ~41 s)
└── npm --prefix <repo>\plugin test        → expect 621 passed / 34 files / 0 failed

The round's headline proof — read this test first
└── plugin/src/__tests__/canvas-single-writer.test.ts   (19 tests)
    both subsystems on one .canvas path, two peers, concurrent EDGE edits.
    Its RED at HEAD produced byte-identical unparseable JSON on both peers:
    edge e1 held the unterminated token "color": "1900,  ← character-merge of
    peer A's "1" with peer B's n3.x = 900; node n3's tail was spliced INSIDE
    edge e1's object; "edges" appeared TWICE with e2 orphaned. All 3 cards and
    BOTH arrows lost. That is the defect this round exists to kill.

Live two-instance rig (NOT run this round — W4 owns it)
├── tools/launch_liveshare_e2e.py            two hosts + one relay (39421/39422)
├── tools/MCPserver/liveshare_e2e_mcp_server.py   `liveshare-e2e` MCP, 7 tools
├── plugin/src/testing/e2e-control.ts        flag-gated 127.0.0.1 http+SSE control server
└── workflowArtifacts/e2e-infra/E2E_USAGE.md usage; launch via visible-console run_python

Log-driven diagnosis
└── grep -rnE "SCATTER signature:|DETACH signature:|AWARENESS GAP:|DRAG WATCHDOG:|ADAPTER PATCH:|LOCK DENIED:|LOCK REVERT:|NO TYPE signature:|CANVAS TEXT FALLBACK:|CANVAS WRITER:" plugin/src --include=*.ts | grep -v __tests__
    Table + caveats: ARCHITECTURE.md § Appendix → "Log signature table (US6)"
```

New and changed production surface:

```text
plugin/src/
├── canvas/
│   ├── reconcile-plan.ts ......... NEW, pure, zero imports — structural|geometry|noop
│   ├── canvas-adapter.ts ......... viewportScale(), scale on CanvasViewport, drag watchdog,
│   │                               patch adoption, DRAG WATCHDOG: / ADAPTER PATCH:
│   └── canvas-presence.ts ........ UNCHANGED (read-only all round, as specified)
├── files/
│   ├── canvas-sync.ts ............ kind-aware lock gating, canWriteEntity, conditional
│   │                               baseline advance, PROTECTED_KEYS, NO TYPE signature:,
│   │                               disk write retired from the doc observer,
│   │                               noteExternalDiskWrite
│   ├── canvas-persistence.ts ..... onWritten, writeQueue, muteDepth, PersistenceGuards,
│   │                               attachCanvasPersistence, CANVAS WRITER:
│   ├── vault-events.ts ........... canvasOwned, subscribeCanvasWithHandover,
│   │                               warnCanvasTextFallback, resetCanvasTextFallbackWarnings
│   └── background-sync.ts ........ startAll skips .canvas
├── sync/sync.ts .................. deadline-driven awareness keep-alive + AWARENESS GAP:
└── main.ts ....................... WIRING ONLY (no test file — see R6)
```

Per-WP detail, including every verbatim RED observation, is in
`workflowArtifacts/canvas-integrity/ImplementationReport_WP1.md` … `_WP7.md`.

---
---

# Rework Cycle 1 — WP6

W3 re-entry: 2026-07-26 · single-task mode, one WP, one defect class
Authority artifact: `workflowArtifacts/canvas-integrity/Worker4FixRequest_WP6.md`
Nothing was deployed. Nothing was installed into any vault. Version still 0.6.0.

## 1. The reds I observed myself

Not copied from W4. Measured on the tree as I received it, before any edit:

```text
npx vitest run src/__tests__/w4-canvas-integrity.test.ts
  Test Files  1 failed (1)
       Tests  4 failed | 35 passed (39)
    Duration  3.10s
```

Verbatim, all four:

```text
FAIL  W4 L4-J … > J1 CREATE of a .canvas on the host still builds a raw Y.Text document for it
AssertionError: US5 AC1 violated on the CREATE path: a second raw-Y.Text CRDT exists for a
.canvas: expected true to be false // Object.is equality
  - Expected: false
  + Received: true
  ❯ src/__tests__/w4-canvas-integrity.test.ts:892:7

FAIL  W4 L4-J … > J2 RENAME to a .canvas builds a raw Y.Text document, and is NOT role-gated
AssertionError: US5 AC1 violated on the RENAME path: a second raw-Y.Text CRDT exists for a
.canvas: expected true to be false // Object.is equality
  - Expected: false
  + Received: true
  ❯ src/__tests__/w4-canvas-integrity.test.ts:906:7

FAIL  W4 L4-J … > J3 the exclusivity invariant: a canvas-owned path must have NO Y.Text document
AssertionError: BOTH subsystems hold the same .canvas: this is the exact two-writer state US5
removes: expected true to be false // Object.is equality
  - Expected: false
  + Received: true
  ❯ src/__tests__/w4-canvas-integrity.test.ts:926:7

FAIL  W4 L4-J … > J4 BLAST RADIUS: the leaked Y.Text doc is a SECOND CRDT→disk writer for the
same .canvas
AssertionError: BackgroundSync wrote the .canvas while CanvasPersistence owned it — TWO disk
writers: expected 1 to be +0 // Object.is equality
  - Expected: 0
  + Received: 1
  ❯ src/__tests__/w4-canvas-integrity.test.ts:969:7
```

W4's fix request is accurate in every particular. Confirmed independently.

## 2. Option A vs Option B — chosen: A, and why

**Chosen: Option A** — a per-entry-point guard, expressed as one shared named
predicate `skipsAutoTextSync(path)` at the top of `background-sync.ts`, consulted
by all three event-driven entry points. `subscribe()` stays the single unguarded
explicit door of the R10 fallback.

The decision turned on a fact the fix request did not have, which materially
changes the trade-off:

- **`onFileRenamed` does not call `subscribe()`.** It reimplements the flow
  inline — its own `syncManager.getDoc(normNew)` at `background-sync.ts:236`
  (pre-fix numbering), its own `waitForSync`, its own `attachObserver`. So Option
  B's headline benefit, "all three entry points inherit the guard from
  `subscribe`", is **false in this codebase**. Option B reaches `startAll` and
  `onFileAdded` only; the rename path needs its own explicit guard either way.
  Option B therefore buys 2 of 3 chokepoints, not 3 of 3, while paying its full
  price.

Option B's price, measured rather than estimated:

```text
├── public API change on BackgroundSync.subscribe + the exported
│   CanvasHandoverOptions.backgroundSync interface in vault-events.ts
├── call-site change in subscribeCanvasWithHandover (vault-events.ts:114)
├── background-sync.test.ts:134 would need its call rewritten — the one test the
│   dispatcher flagged as load-bearing
└── canvas-single-writer.test.ts:774 asserts
      expect(h.backgroundSync.subscribe).toHaveBeenCalledWith(PATH)
    — an exact single-argument assertion that BREAKS the moment the handover
    helper passes an options object. A previously-passing test, failing for a
    reason unrelated to the defect.
```

Against that, Option A costs three lines and zero test churn, and it puts the
guard where the callers cannot get it wrong: `onFileAdded` and `onFileRenamed`
are each reached from **three** separate call sites, not the one W4 found —

```text
onFileAdded    ├── files/vault-events.ts:152      (create, host-gated)
               ├── main.ts:229 / :240 / :261      (manifest-driven add + rename halves)
               └── sync/control-handlers.ts:65
onFileRenamed  ├── files/vault-events.ts:207      (NOT role-gated — F2)
               └── sync/control-handlers.ts:83
```

Guarding the methods rather than their callers is what makes this robust; a guard
placed per-caller is precisely how the original defect shipped.

What Option A does not buy: the invariant is still by-convention across three
methods rather than structurally enforced at one chokepoint. That is honest and
it is the residual. It is mitigated, not eliminated, by the single named
predicate with the rationale on it, and by the fact that **every one of the three
entry points now has both a guard and a test** (see § 4).

## 3. Files touched

```text
plugin/src/files/background-sync.ts ............... production, 3 guards + 1 predicate
├── new module-level `skipsAutoTextSync(path)` with the full US5 AC1/AC2
│   rationale, incl. why `subscribe()` is deliberately NOT guarded
├── startAll ......... existing inline check replaced by the shared predicate
├── onFileAdded ...... NEW guard, after `isTextFile`, before `subscribe`
└── onFileRenamed .... NEW guard, after `isPathSafe`/`isTextFile`, i.e. AFTER the
                       old path's full teardown (timers, remoteSeq, observer,
                       releaseDoc) and BEFORE `getDoc(normNew)`

plugin/src/__tests__/background-sync.test.ts ...... +3 unit tests (see § 4)
plugin/src/__tests__/w4-canvas-integrity.test.ts .. J4 precondition repaired (see § 5)
```

No other file was modified. No dependency added. `useCanvasBinding` untouched.

## 4. Tests added

Three unit tests in `background-sync.test.ts`, placed beside the existing
`WP6/US5-AC2` `startAll` case so all three entry points are asserted in one place:

- `WP6/US5-AC1: onFileAdded creates no Y.Text document for a .canvas` — with a
  markdown positive control on the same instance.
- `WP6/US5-AC1: onFileRenamed creates no Y.Text doc for a .canvas NEW path, and
  still tears the OLD path down` — asserts the new path has no doc **and** that
  `releaseDoc(old)` ran, the old doc is gone and `observers.has(old) === false`.
  This is W4's explicit trap: an early return placed before the teardown would
  leak the old observer. It is now pinned by a test.
- `WP6/US5-AC1: the guard is not over-broad — renaming a .canvas to a .md still
  installs text sync` — proves the guard does not swallow legitimate renames.

`background-sync.test.ts:134` (`WP6/US5-AC9`, the R10 fallback pin) was **not**
touched, not weakened, not deleted.

## 5. DECLARED TEST EDIT — J4 was unsatisfiable as written

**J1, J2 and J3 went green with no test change at all**, exactly as W4 predicted.
**J4 could not.** It is self-contradictory by construction:

```text
line 952 (pre-edit)  expect(textHandle, "precondition: the leak did not occur").toBeDefined();
line 969 (pre-edit)  expect(bgWrites.length, "…TWO disk writers").toBe(0);
```

Line 952 **requires the leak to have happened** in order to proceed. On a correct
fix there is no leaked doc, so the probe fails on its own precondition:

```text
FAIL  … > J4 BLAST RADIUS: …
AssertionError: precondition: the leak did not occur: expected undefined to be defined
  ❯ src/__tests__/w4-canvas-integrity.test.ts:952:64
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 85 passed (86)
```

No production change can satisfy both line 952 and line 969 simultaneously. The
fix request's claim "no test change should be needed" holds for J1–J3 and does
not hold for J4.

**What I changed, and what I did not.** The disk-write assertion — the point of
the probe — is byte-for-byte unchanged and still runs **first**. The
`toBeDefined` precondition was **inverted to `toBeUndefined` and moved to after**
the write assertion, and the remote-delta push became conditional on the doc
existing. J4 now asserts **both** "no second writer" **and** "no second CRDT",
where it previously asserted a contradiction. It is explicitly *not* the softening
W4 warned against — it does not say "the doc exists but is unused"; it says the
doc must not exist *and* nothing may write.

**Discrimination re-verified, because a changed probe is worthless unproven.** I
removed the `onFileAdded` guard only (leaving the rename guard in place) and re-ran:

```text
FAIL  … > J4 BLAST RADIUS: the leaked Y.Text doc is a SECOND CRDT→disk writer for the
same .canvas
AssertionError: BackgroundSync wrote the .canvas while CanvasPersistence owned it — TWO disk
writers: expected 1 to be +0 // Object.is equality
  - Expected: 0
  + Received: 1
  ❯ src/__tests__/w4-canvas-integrity.test.ts:986:7
 Test Files  1 failed (1)
      Tests  3 failed | 36 passed (39)
```

Repaired J4 still fails with **F4's exact original signature, `expected 1 to be
+0`**. Its teeth are intact. J1 and J3 went red with it; J2 correctly stayed
green, since only the create-path guard was removed — clean isolation. The guard
was then restored and the tree verified free of the temporary edit.

The edit is documented in-place in the test with the same reasoning, so a future
reader cannot mistake it for a quiet softening.

## 6. R10's rationale — restored

R10 was accepted on the grounds that the raw-text canvas fallback is *exclusive*,
never concurrent with `CanvasSync`. F3 proved that false on the create/rename
path. **It holds again.** `BackgroundSync.subscribe` has exactly one production
caller —

```text
files/vault-events.ts:114   subscribeCanvasWithHandover → backgroundSync.subscribe(path)
```

— reached only after `canvasSync.isSubscribed(path)` has returned `false`, i.e.
only when `CanvasSync` genuinely does not own the path. Every other route into
text sync (`startAll`, `onFileAdded`, `onFileRenamed`) now refuses a `.canvas`
outright. The fallback is once again the sole, announced, exclusive door.

## 7. Gates — re-measured on the final tree

```text
npm --prefix …\plugin run build ....... PASS, exit 0
npm --prefix …\plugin test ............ 35 files passed (35)
                                        663 tests passed (663), 0 failed
                                        Duration 40.99s
```

Arithmetic against the entry state: 660 tests with 4 failing → the 4 J probes go
green (+0 tests) and 3 unit tests are added → **663 / 663**. No test was removed,
skipped or lost. File count unchanged at 35.

### §7 abort criteria — all clear

```text
├── build fails ................................................. NO  (exit 0)
├── previously-passing test fails ............................... NO  (0 failed)
├── useCanvasBinding default no longer false .................... NO  (types.ts:65 `useCanvasBinding: false`)
├── new production import of canvas-binding / canvas-model-bridge
│   outside the flag-gated branch ............................... NO  (main.ts:6/:10 only — baseline)
└── version bumped .............................................. NO  (0.6.0 in manifest.json + plugin/package.json)
```

`biome check` on the three touched files: 1 `format` finding per file plus one
pre-existing `organizeImports` on `w4-canvas-integrity.test.ts`. The `format`
findings are the **known whole-file CRLF env artifact** — biome reports the diff
from line 1 (the import block, which I never touched) with `␍` on every line.
Findings were not increased by these edits. Biome is advisory.

## 8. Found but deliberately NOT fixed

Reported per the rework-cycle scope rule. Neither was proven by execution — both
are read-only observations, and I did not manufacture evidence for them.

- **`manifest.ts:182` is a possible FOURTH entry point in the same defect class.**
  `syncFromManifest` calls `this.syncManager.getDoc(path)` on a bare path and
  then writes `tempHandle.text.toString()` to disk. Text entries are skipped only
  when the caller passes `{ skipText: true }` (`manifest.ts:155`), and of the six
  `syncFromManifest` call sites in `main.ts` (`:252`, `:472`, `:625`, `:658`,
  `:1629`, `:1643`) only some do. `"canvas"` is in `TEXT_EXTENSIONS`, so a
  `.canvas` manifest entry can reach it. Two things make it materially different
  from F1/F2 and are why I did not touch it: it attaches **no observer**, so it is
  a one-shot doc creation plus a one-shot write rather than a standing second
  writer; and it is an initial-sync/bootstrap path where `CanvasSync` is not yet
  subscribed, so the write may well be load-bearing for a guest's first canvas
  fetch. **Deciding that needs a spec judgement and a red, not a reflex guard.**
  Recommend W4 probes it directly.
- **`editor/collab.ts:62`** also calls `getDoc(filePath)` on a bare path, for the
  CM6/yCollab editor binding. A `.canvas` opens in Obsidian's Canvas view, not a
  `MarkdownView`, so this should be unreachable for a canvas — but "should be" is
  reading, not execution. Noted only.

Both are outside `Worker4FixRequest_WP6.md`, which named `onFileAdded` and
`onFileRenamed` and proved exactly those by execution.

## 9. What is still not verified

Unchanged from the main round: **no behavioural or manual verification, no
two-vault E2E run, no install.** This cycle is unit- and integration-level with
deterministic fixtures only. The create and rename flows are now proven at the
`registerVaultEvents` → `BackgroundSync` seam with real objects on both sides,
which is the level at which W4 found the defect — but a live two-instance
mid-session canvas create is still an unrun test.

---
---

# Rework Cycle 2 — WP6

W3 re-entry: 2026-07-26 · single-task mode, cycle 2 of a maximum 2
Authority artifact: `workflowArtifacts/canvas-integrity/Worker4FixRequest_WP6_Cycle2.md`
Cycle 1's fix request and this handover's cycle 1 section are untouched as the audit trail.
Nothing deployed. Nothing installed into any vault. Version still 0.6.0.

## 1. The reds I observed myself

Measured on the tree as I received it, before any edit:

```text
npx vitest run src/__tests__/w4-canvas-integrity.test.ts
  Test Files  1 failed (1)
       Tests  2 failed | 45 passed (47)
    Duration  5.30s
```

Verbatim:

```text
FAIL  W4 REVALIDATION K — manifest.syncFromManifest, the 4th entry point >
      K1 does a .canvas manifest entry reach getDoc(bare path) when skipText is NOT passed?
AssertionError: syncFromManifest created a raw-Y.Text doc for a .canvas (4th entry point):
expected 1 to be +0 // Object.is equality
  - Expected: 0
  + Received: 1
  ❯ src/__tests__/w4-canvas-integrity.test.ts:1505:7

FAIL  W4 REVALIDATION K — manifest.syncFromManifest, the 4th entry point >
      K2 DATA LOSS CHECK: an unpopulated bare-path Y.Text must not be written over the canvas
AssertionError: an EMPTY .canvas was written to disk from an unpopulated Y.Text:
expected [ [ 'board.canvas', '' ] ] to have a length of +0 but got 1
  - Expected: 0
  + Received: 1
  ❯ src/__tests__/w4-canvas-integrity.test.ts:1523:7
```

The `[ [ 'board.canvas', '' ] ]` is the empty write landing on a canvas whose
on-disk content was `{"nodes":[{"id":"n1","type":"text"}],"edges":[]}`. F5 and F6
confirmed independently. W4's regression diagnosis is accepted.

## 2. The fix

One line of behaviour, in `syncFromManifest`'s text branch, **unconditional**:

```text
files/manifest.ts:174   if (!entry.binary && skipsAutoTextSync(path)) continue;
```

Placed immediately after the existing `skipText` filter, so a `.canvas` is
skipped whether or not the caller opts in. Not gated per-caller, exactly as the
fix request directs: only `main.ts:252` of the six call sites passes
`{ skipText: true }`, and adding it to the other five would also stop markdown
syncing on join, which is load-bearing. `K3` and `K4` pin both halves and both
stayed green.

### The predicate is now shared, not copied

`skipsAutoTextSync` was **lifted from `background-sync.ts` to `utils.ts`**, beside
`isTextFile`, and exported. `manifest.ts` consults the same one.

`utils.ts` was chosen over exporting from `background-sync.ts` because it is the
predicate's natural home — it is the *exception to* `isTextFile`, which lives
there, and `TEXT_EXTENSIONS` (which contains `"canvas"`) is the reason the
exception is needed at all. Both `manifest.ts` and `background-sync.ts` already
import from `utils.ts`, so this adds **zero new coupling**; importing from
`background-sync.ts` would have made a peer file-manager module depend on another
for a path predicate.

```text
src/utils.ts:258 ................. export function skipsAutoTextSync(path)   ← ONE definition
├── files/background-sync.ts:72 .. startAll         (manifest replay)
├── files/background-sync.ts:195 . onFileAdded      (create)
├── files/background-sync.ts:248 . onFileRenamed    (rename INTO a .canvas)
└── files/manifest.ts:174 ........ syncFromManifest (join / resume / reconnect /
                                                     reload-from-host)
```

The full rationale now lives on the predicate, including the list of consumers
and the explicit statement that `BackgroundSync.subscribe()` is the one caller
that must NOT consult it (the R10 fallback door). A fourth private copy of
`path.endsWith(".canvas")` is how this defect class propagated twice; there is
now nothing to copy.

## 3. The self-heal question — ANSWERED BY EXECUTION

W4 could not establish whether F6's damage was transient or permanent, because
the ordering lives in `main.ts`, which has no test file. **It is permanent on the
worst-case ordering, and I established that by running it, not by reading it.**

New probe `L1` composes the two halves that were previously only testable apart:
the **real** `syncFromManifest` (guest, no `skipText`, local canvas holding node
`n1`), then the **real** `attachCanvasPersistence` with an **empty** shared canvas
doc — the ordering in which `doc-wins` cannot rescue anything.

With the fix reverted, `L1` fails:

```text
FAIL  … > L1 SELF-HEAL: guest join sync then an EMPTY shared doc still seeds from file —
      no permanent loss
AssertionError: the join sync erased the canvas before coldOpen could publish it —
PERMANENT loss: expected 'empty' to be 'seeded-from-file' // Object.is equality
  Expected: "seeded-from-file"
  Received: "empty"
  ❯ src/__tests__/w4-canvas-integrity.test.ts:1588:7
```

The guard was then restored and the tree verified free of the temporary edit.

**The answer, stated precisely:**

```text
shared canvas doc NON-EMPTY  → coldOpen `doc-wins` → flush() rewrites real bytes
                               → damage TRANSIENT.  (mechanism already pinned by E2)
shared canvas doc EMPTY      → coldOpen falls through to the file, finds the ""
                               that syncFromManifest just wrote, isCanvasDataEmpty
                               → returns "empty" → nothing restores anything
                               → PERMANENT LOSS, and the round's own
                                 "seeded-from-file" improvement (E1) is defeated
                                 because F6 destroyed the very file it seeds from.
                               (now pinned by L1)
```

W4's hypothesis was right in both branches.

**What I could still not execute, stated plainly.** Which of the two orderings
actually occurs in a real session — i.e. whether the shared canvas doc is
populated at the moment a guest first opens the canvas — remains **unexecuted**.
It depends on `main.ts` (`connectSync()` before `manifestManager.connect()`, the
session-start subscribe loop at `:825` vs the lazy on-open subscribe at `:995`),
and `main.ts` has no test file. I did not manufacture a fixture that would let me
claim otherwise.

That residual is **materially reduced rather than resolved**, and this is the
important part: the fix removes the empty write entirely, so **both** orderings
are now safe and the question no longer gates correctness. It still matters for
one thing only — estimating whether any already-run session damaged a real vault.
That cannot be answered from this repo.

## 4. Files touched

```text
plugin/src/utils.ts .............................. NEW exported `skipsAutoTextSync`
                                                    + full rationale, beside isTextFile
plugin/src/files/manifest.ts ..................... import + the F5/F6 guard (:174)
plugin/src/files/background-sync.ts .............. local predicate REMOVED, now imported;
                                                    the three cycle-1 guards unchanged
plugin/src/__tests__/w4-canvas-integrity.test.ts .. +1 probe (L1)
```

No other file modified. No dependency added. No call site in `main.ts` touched.

## 5. Gates — re-measured on the final tree

```text
npm --prefix …\plugin run build ....... PASS, exit 0
npm --prefix …\plugin test ............ 35 files passed (35)
                                        672 tests passed (672), 0 failed
                                        Duration 40.76s
```

Arithmetic: cycle 1 closed at 663. W4's revalidation added `K1`–`K8` (+8) = 671,
of which `K1`/`K2` were red. This cycle adds `L1` (+1) = **672 / 672**, 0 failed.
Nothing removed or skipped. File count unchanged at 35.

Probe status, verified individually: `J1`–`J4` green, `K1`–`K8` green, `L1` green.

### §7 abort criteria — all clear

```text
├── build fails ................................................. NO  (exit 0)
├── previously-passing test fails ............................... NO  (0 failed)
├── useCanvasBinding default no longer false .................... NO  (types.ts:65)
├── new production import of canvas-binding / canvas-model-bridge
│   outside the flag-gated branch ............................... NO  (main.ts:6/:10 only)
└── version bumped .............................................. NO  (0.6.0, both files)
```

`biome check` on the four touched files: 4 `format` findings (one per file) plus
the pre-existing `organizeImports` on `w4-canvas-integrity.test.ts`. The `format`
findings are the **known whole-file CRLF env artifact** — verified on `utils.ts`
by inspecting the diff, which starts at line 1 with `␍` on the untouched import.
Same profile as cycle 1. Not increased. Biome is advisory.

## 6. Found but deliberately NOT fixed

- **`editor/collab.ts:62`** — carried forward unchanged, per the dispatcher's
  explicit instruction. W4 proved by execution (`K5`) that
  `CollabManager.activateForFile` has **no internal `.canvas` guard** and will
  acquire a bare-path `Y.Text` if called with one. It is unreachable for a canvas
  today **only** because `main.ts` gates on `getActiveViewOfType(MarkdownView)`
  and a canvas opens in a Canvas view. That gate is in the file with no test file.
  Recorded as residual risk, not as safe. It is the one remaining unguarded
  bare-path `getDoc` in the codebase — a natural first item for a follow-up round,
  where `skipsAutoTextSync` is now sitting in `utils.ts` ready to be consulted.
- Nothing else was found this cycle. The `getDoc` sweep from cycle 1 § 8 is now
  fully accounted for: `manifest.ts:182` is fixed, `collab.ts:62` is recorded, and
  the remaining `background-sync.ts` sites (`:195` `setActiveFile`, `:319`
  `handleLocalTextModify`, `:392` `flushWrite`) all operate on paths that are
  already subscribed, so they cannot originate a canvas doc.

## 7. What is still not verified

- **No behavioural or manual verification, no two-vault E2E run, no install** —
  unchanged for the third time. Every claim in this cycle is unit/integration
  level with deterministic fixtures.
- **The `main.ts` ordering behind the self-heal question** (§ 3) is reasoned, not
  executed, and is labelled as such.
- **Whether any real vault was already damaged** by F6 in a prior session is
  outside what this repo can answer. If any guest joined a session with a shared
  `.canvas` while running this round's build, its local canvas may have been
  emptied. Worth a human check before the next install.
