# Implementation Report — WP7: Wire `CanvasPersistence` (US5 AC13–AC18, US6 `CANVAS WRITER:`)

**Batch C, fourth and last.** Depends on WP6 (landed). This is the last code change before the
dispatcher's authoritative merged gates.

**Result:** DONE, with **one deliberate scope extension that must be read**: three cases in
`plugin/src/__tests__/canvas-sync.test.ts` asserted the behaviour this WP retires. That file was not
in the WP's declared file set. They are corrected in place rather than left red — see
*Corrected Tests* and *Risk Notes 1*.

`CanvasPersistence` is now the **single** CRDT→disk writer for every canvas-owned path. Two dormant
bugs in it were fixed **before** it was wired, each with its own confirmed-RED test.

---

## ACs Satisfied

### BUILD_SPEC § 9 WP7 acceptance criteria

| # | AC | How verified |
|---|---|---|
| 1 | US5 AC13–AC18 hold | Table below; 10 new tests in `canvas-persistence.test.ts` (7 → 17) |
| 2 | Single-writer test, **confirmed RED first** | `AC13: with CanvasPersistence attached, ONE remote delta = exactly ONE disk write`. Both writers share one `vault.adapter.write` spy, so it is a writer-count assertion, not a content assertion. RED verbatim below |
| 3 | Stale-flush property (US5 AC14), **confirmed RED first** | `AC14: an in-flight write can never leave PRE-delta bytes on disk`. Fake timers, an IO whose bytes land on *resolve*, write #1 slow (300 ms) / later writes fast (10 ms). RED verbatim below |
| 4 | US5 AC15 echo-breaker | `AC15: after a persistence write, an unchanged-content modify is a no-op (echo-breaker)` asserts the `no-op (disk == shared state)` line, **plus** a stronger case proving the baseline is not merely present but *correct* — see AC15 row below |
| 5 | Mute refcount leak fixed, **confirmed RED first** | `AC18a: two flushes inside one settle window leave the mute count at ZERO`, over a fake IO with `FileOpsManager`-shaped refcount semantics. RED verbatim below. A second new case covers the same leak on the **teardown** path |
| 6 | Write serialization + path guards | `writeQueue` chain (§ *Dormant Bugs Fixed*); `AC16: createVaultPersistenceIO gates on isPathSafe and ensures the parent folder` asserts both guards, including that an `..` path is rejected and never reaches the adapter |
| 7 | Echo suppression end to end | `AC7: the persistence write opens CanvasSync's echo window, then closes it` — calls exactly `canvasSync.isRecentDiskWrite(path)`, the **unchanged** `vault-events.ts:121` check. True inside the settle window, false after. `vault-events.ts` was not touched |
| 8 | `coldOpen` semantics | `AC17: coldOpen runs BEFORE start — a file→CRDT seed is never written straight back out`. See § *coldOpen Semantics Change* |
| 9 | No CRDT-observer-driven caller of `writeToDisk` | `grep -n "scheduleDiskWrite" plugin/src/files/canvas-sync.ts` → **one hit, in a comment**, no call. The observer now calls `scheduleCanvasAudit` (telemetry only) |
| 10 | `CanvasPersistence` still emits ZERO CRDT writes | The SPEC_03 assertion is untouched and green: `P1 originates ZERO CRDT transactions` (transaction spy + `CANVAS_BINDING_ORIGIN` update spy) |
| 11 | `canvas-persistence.test.ts` stays green | 7 → 17, all pass. **No pre-existing case was modified**; none of the 7 asserted the leaky mute (see § *Corrected Tests*) |

### US5 AC13–AC18

- **AC13** CRDT→disk has exactly one implementation for a canvas-owned path. `CanvasSync`'s
  remote-flush scheduling is retired; `CanvasPersistence` is constructed per subscribed path in
  `main.ts`. ✔
- **AC14** a flush never writes content older than the newest integrated remote delta. ✔ (proved,
  not asserted — the RED shows the pre-delta bytes actually surviving at HEAD)
- **AC15** `lastWrittenContent` never goes stale. ✔ Two tests: the echo-breaker line, and the
  decisive one — after a persistence write the local user edits **one** key on top of it while a
  **newer, not-yet-flushed** remote delta sits in the doc. With the fed-back baseline only the
  edited key is pushed and the un-flushed remote value survives; with a stale baseline the diff
  would replay the already-persisted remote change as a local edit and clobber it.
- **AC16** `isPathSafe` + `ensureFolder` parity. ✔ Both applied inside `createVaultPersistenceIO`,
  as **required** constructor arguments so a caller cannot silently drop them.
- **AC17** `coldOpen()` after `waitForSync`, before `start()`. ✔ Enforced by the exported
  `attachCanvasPersistence` helper, which is the only thing `main.ts` calls.
- **AC18** both dormant defects fixed, each with its own test. ✔ See § *Dormant Bugs Fixed*.

### US6 — `CANVAS WRITER:`

Production emitter: `plugin/src/files/canvas-persistence.ts` → one line per **actual disk write**,
through the existing injected `DebugLogger` seam. A second emitter in `main.ts` records the attach.
Format: `CANVAS WRITER: <path> owner=CanvasPersistence nodes=<n> edges=<n>`. Asserted by a
logger-spy test which also asserts the line does **not** contain node text (US6 AC7 — the fixture
node carries `text: "SECRET-NOTE"`). Once per write, not once per delta (US6 AC5).

All ten US6 signatures now have a production emitter:

```text
src/canvas/canvas-adapter.ts   → ADAPTER PATCH:      DRAG WATCHDOG:
src/files/canvas-persistence.ts→ CANVAS WRITER:
src/files/canvas-sync.ts       → SCATTER signature:  DETACH signature:  NO TYPE signature:  LOCK DENIED:
src/files/vault-events.ts      → CANVAS TEXT FALLBACK:
src/main.ts                    → LOCK REVERT:        CANVAS WRITER:     CANVAS TEXT FALLBACK:
src/sync/sync.ts               → AWARENESS GAP:
```

---

## ACs Not Satisfied

- **US6 AC6** — appending the new signature rows to the `ARCHITECTURE.md` § Appendix table. Same
  status as WP6 left it: `ARCHITECTURE.md` is outside this WP's file set, and US6 is explicitly
  shared across WP2–WP7. The `CANVAS WRITER:` row (and WP6's `CANVAS TEXT FALLBACK:` row) still
  need appending by whoever closes US6 documentation.

Nothing else. Every WP7 AC in the BUILD_SPEC and every US5 AC13–AC18 is satisfied.

---

## RED-First Observations

All three were written **first**, run against **unmodified** production code, and observed failing.
No git command was used at any point. Run `w3-wp7-r1`:

```text
npx vitest run src/__tests__/canvas-persistence.test.ts
   (cwd: plugin/,  production code untouched)

 ❯ src/__tests__/canvas-persistence.test.ts (10 tests | 3 failed)
 Test Files  1 failed (1)
      Tests  3 failed | 7 passed (10)
```

### AC2 — single writer

```text
FAIL  src/__tests__/canvas-persistence.test.ts > WP7 / US5 AC13 — single writer per canvas path
      > AC13: with CanvasPersistence attached, ONE remote delta = exactly ONE disk write
AssertionError: expected exactly one writer for board.canvas, saw 2 disk writes: expected 2 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 2
```

This is the single-writer assertion the AC demands: a real `CanvasSync` subscribed to
`board.canvas` and a `CanvasPersistence` over the same doc, both writing through one
`vault.adapter.write` spy. It fails **because** `CanvasSync.scheduleDiskWrite` is still wired in
parallel — the content of both writes is identical, so a content assertion would have passed.

**GREEN after** (`w3-wp7-r2`): 1 write, and `JSON.parse(writes[0][1]).nodes[0].x === 42`.

### AC3 — stale flush

```text
FAIL  src/__tests__/canvas-persistence.test.ts > WP7 / US5 AC13 — single writer per canvas path
      > AC14: an in-flight write can never leave PRE-delta bytes on disk
AssertionError: expected '{\n\t"nodes": [\n\t\t{\n\t\t\t"id": "…' to be '{\n\t"nodes": [\n\t\t{\n\t\t\t"id": "…' // Object.is equality

- Expected
+ Received

@@ -1,11 +1,11 @@
  {
  	"nodes": [
  		{
  			"id": "n1",
  			"type": "text",
- 			"x": 999,
+ 			"x": 1,
  			"y": 0,
  			"width": 100,
  			"height": 50
  		}
  	],
```

The doc ends at `x: 999`; the file ends at `x: 1`. The slow first write resolved **after** the
newer one and overwrote it — exactly the residual window the BUILD_SPEC's Architecture notes said
must be *proved*, not asserted. The structural argument (snapshot taken synchronously at flush time)
is correct and by itself insufficient: it does not order the `await io.write` calls.

**GREEN after**: disk bytes `=== serializeCanvas(post-delta doc)`.

### AC5 — mute refcount leak

```text
FAIL  src/__tests__/canvas-persistence.test.ts > WP7 / US5 AC13 — single writer per canvas path
      > AC18a: two flushes inside one settle window leave the mute count at ZERO
AssertionError: mute refcount never returned to zero: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1
```

Timeline (fake timers, `DEBOUNCE_MS = 200`, `settleMs = 250`): flush #1 at t=200 mutes and arms a
settle release for t=450; flush #2 at t=400 — **inside** that window — mutes again, and the old
`finally` cleared the pending settle timer before arming a new one, so only one release ever ran.
Residual depth 1, forever.

**GREEN after**: depth 0, and `unmutePathEvents` call count `===` `mutePathEvents` call count.

---

## coldOpen Semantics Change

**Called out explicitly per AC8.** The **guest** seed branch was removed from `CanvasSync.subscribe`
and replaced by `CanvasPersistence.coldOpen()`:

```text
GUEST, doc NON-empty
├── before  CanvasSync: serializeCanvas → writeToDisk → records the diff baseline
└── after   coldOpen "doc-wins" → flush() → the file is written from the doc
            BEHAVIOUR-EQUIVALENT, minus the second writer. The baseline is now
            recorded via onWritten → noteExternalDiskWrite.

GUEST, doc EMPTY
├── before  read the local file and record it ONLY as the diff baseline.
│           The file's content NEVER entered the shared doc.
└── after   coldOpen "seeded-from-file" → the file is parsed ONCE and SEEDED into
            the doc through `applyToYMap` (geometry/structural key guard retained).
            *** THIS IS A DELIBERATE IMPROVEMENT, NOT A REFACTOR. ***
```

Why it is an improvement: a guest that joins before any peer has published canvas data previously
had its local `.canvas` content silently excluded from the session — the doc stayed empty and the
first remote delta would overwrite the local file. It now contributes its content once, before any
concurrent editing, which is the same one-shot file→CRDT read the host performs.

**The HOST seed is unchanged and was deliberately not substituted** (BUILD_SPEC out-of-scope):
`applyCanvasToYMaps` **deletes** doc entries absent from the host's local file
(`canvas-sync.ts:786-788`, `:800-802`), and `coldOpen`'s doc-wins branch does not. Swapping it would
silently change host-rejoin semantics. Recorded as follow-up § 12 R9.

One consequence, recorded honestly: in the `seeded-from-file` case no write occurs, so
`CanvasSync.lastWrittenContent` is not set at subscribe time. The first `handleLocalModify` then
hits the echo-breaker (the doc was just seeded **from** that file, so disk == shared state
semantically), which is a no-op **and sets the baseline**. Verified by the AC15 test above. This is
correct, but it is a behavioural path worth knowing about.

---

## Dormant Bugs Fixed

`CanvasPersistence` had **zero** production callers before this WP, so neither bug had ever run.
Wiring it without fixing them would have traded a two-writer race for a permanently-muted path.

### 1. Mute refcount leak (US5 AC18a)

- **Evidence:** the AC5 RED above (`expected 1 to be +0`), plus a second new test proving the same
  leak on teardown — `destroy()` cancelled the settle timer that was the *only* thing that would
  have released the mute (`AC18a: destroy() mid-settle also releases the mute`).
- **Why it mattered:** `FileOpsManager` mutes are refcounted (`file-ops.ts:112-125`). A count that
  never returns to zero means **every** vault `modify` event for that canvas is dropped for the rest
  of the session — the user's own edits stop syncing, silently. With `DEBOUNCE_MS = 200`,
  `MAX_WAIT_MS = 500` and `settleMs = 250`, overlapping settle windows are the **normal** case
  under a continuous remote stream, not a corner case.
- **Fix:** an explicit `muteDepth` counter with `acquireMute()` / `releaseMute()`. The mute is taken
  at most once per open settle window and released exactly once when it closes; `destroy()` releases
  any held mute instead of dropping it.

### 2. Unserialized writes (US5 AC18b / AC16)

- **Evidence:** the AC3 RED above — the file ended at `x: 1` while the doc held `x: 999`.
- **Why it mattered:** `flushToDisk` awaited `io.write` with no queue, and `lastWrittenContent` was
  assigned *after* the await, so two overlapping flushes both passed the redundant-write check and
  could resolve in either order.
- **Fix:** a `writeQueue` promise chain in the style of `background-sync.ts:43`/`:391`, plus a new
  `lastQueuedContent` assigned **synchronously** at flush time (the redundant-write skip must test
  what is queued, not what has landed). On a failed write the marker rolls back so a later identical
  snapshot is retried rather than deduplicated away.

### 3. (bonus) Missing path guards

`createVaultPersistenceIO.write` called `adapter.write` directly with neither `isPathSafe` nor
`ensureFolder` — both of which the retired `CanvasSync.writeToDisk` provided. Both are now applied
inside the factory, injected as **required** arguments (the module keeps its headless discipline;
`utils.ts` imports the Obsidian runtime).

---

## Corrected Tests

### `canvas-persistence.test.ts` — none

All 7 pre-existing cases were reviewed. **None asserted the leaky mute**: the only mute assertion is
`expect(io.mutePathEvents).toHaveBeenCalledWith("board.canvas")`, which is direction-agnostic and
still passes. No pre-existing case was modified, weakened or deleted. The file goes 7 → 17.

That absence is itself the finding: the leak was invisible to a suite that never counted the
refcount, in a module that had never run in production.

### `canvas-sync.test.ts` — three cases corrected (**scope extension, flagged**)

These asserted that **`CanvasSync` writes `.canvas` bytes** — precisely the behaviour this WP
retires. They are not weakened: each is **re-pointed at the component that owns those writes now**,
so the property stays under test and now runs against the real production composition.
`canvas-sync.test.ts` stays at **40 tests**.

| Case | Why it failed | Correction |
|---|---|---|
| `subscribe as guest writes Y.Map content to disk when data exists` | The guest seed write moved to `coldOpen()` (AC8) | Renamed `…(via coldOpen)`. Now also asserts `vault.adapter.write` is **not** called by `CanvasSync`, then attaches the writer and asserts `coldOpen === "doc-wins"` and the same bytes. Strictly stronger |
| `max-wait cap flushes remote stream to disk under ~500ms of churn` | The debounce+cap moved to the single writer | Attaches the writer; assertions unchanged. `CanvasPersistence` imports the **same** `DEBOUNCE_MS`/`MAX_WAIT_MS` from `canvas-sync.ts`, so the cap property genuinely transfers rather than being re-implemented |
| `never serializes a dangling edge to disk (US5 AC3)` | Same | Attaches the writer; assertions unchanged. The delta now also moves the node, because the pruned snapshot was otherwise byte-identical to the cold-open write and the (correct) redundant-write skip fired, leaving no bytes to inspect |

Verbatim failures before correction (run `w3-wp7-r3`), all three identical in shape:

```text
FAIL src/__tests__/canvas-sync.test.ts > CanvasSync > subscribe as guest writes Y.Map content to disk when data exists
AssertionError: expected "vi.fn()" to be called at least once
FAIL src/__tests__/canvas-sync.test.ts > CanvasSync > max-wait cap flushes remote stream to disk under ~500ms of churn
AssertionError: expected "vi.fn()" to be called at least once
FAIL src/__tests__/canvas-sync.test.ts > CanvasSync > never serializes a dangling edge to disk (US5 AC3)
AssertionError: expected "vi.fn()" to be called at least once
```

**Nothing else in `canvas-sync.test.ts` broke** — notably the WP4 sequence-gate case
(`a stale canvas flush yields to an in-flight remote delta`) and the WP5 audit cases
(`NO TYPE signature:`) are untouched and green, because `writeToDisk` and the debounced audit were
both deliberately retained. See *Risk Notes 2*.

### `canvas-single-writer.test.ts` — augmented, nothing weakened

Per WP6's handover note, `CanvasPersistence` is now attached in `makePeer` (via `attachWriter()`,
called after each `subscribe` exactly as `main.ts` does). Without it the headline regression would
still pass but would no longer exercise the post-edit disk write. **No existing assertion was
changed.** Stays at 19 tests.

---

## Files Changed

```text
plugin/src/files/canvas-persistence.ts        ← the writer itself (activated + repaired)
├── CanvasPersistenceOpts   + onWritten                       ← § 6.2 baseline feedback
├── CanvasPersistenceOpts   logger gains optional warn
├── flushToDisk()           split → flushToDisk (enqueue) + writeSnapshot (perform)
├── NEW  writeQueue         serialized chain                  ← US5 AC16 / AC18b
├── NEW  lastQueuedContent  sync dedupe marker                ← US5 AC14
├── NEW  acquireMute / armSettleRelease / releaseMute / muteDepth  ← US5 AC18a
├── destroy()               now releases a held mute          ← teardown leak
├── writeSnapshot()         emits `CANVAS WRITER:`            ← US6
├── PersistenceGuards       NEW required 3rd arg of createVaultPersistenceIO
├── createVaultPersistenceIO  now applies isPathSafe + ensureFolder ← US5 AC16
└── NEW export attachCanvasPersistence(doc, io, diskPath, opts) ← the ordering contract, tested

plugin/src/files/canvas-sync.ts               ← writer retired, baseline seam added
├── doc observer            scheduleDiskWrite call REMOVED    ← US5 AC13 / AC9
├── scheduleDiskWrite       renamed scheduleCanvasAudit, audit-only (same debounce+cap)
├── subscribe()             GUEST seed branch removed         ← US5 AC17 (host branch UNCHANGED)
├── NEW  noteExternalDiskWrite(rawPath, content)              ← § 6.2 / US5 AC15 + AC7
├── NEW  externalWriteSettleTimers (+ cleared in unsubscribe/destroy)
└── writeToDisk + the remoteSeq gate RETAINED, no observer-driven caller (AC9)

plugin/src/main.ts                            ← WIRING ONLY (5 edits, no logic)
├── import { type CanvasPersistence, attachCanvasPersistence, createVaultPersistenceIO }
├── fields  canvasWriters / canvasWriterAttaching
├── NEW private attachCanvasWriter(rawPath)   ← thin wrapper over the tested helper
├── connectSync() manifest loop      → .then((owned) => { if (owned) attach })
├── syncCanvasPresences() lazy site  → .then((owned) => { if (owned) attach })
└── teardownCanvasPresences()        → destroys every writer (both destroy paths)

plugin/src/__tests__/canvas-persistence.test.ts     ← 7 → 17 (+10), none modified
plugin/src/__tests__/canvas-sync.test.ts            ← 40 → 40, 3 corrected (see above)
plugin/src/__tests__/canvas-single-writer.test.ts   ← 19 → 19, makePeer gains the writer
```

Not touched: **`vault-events.ts`** (its `isRecentDiskWrite` echo check at `:121` is unchanged, as
AC7 requires), `background-sync.ts`, `file-ops.ts`, `utils.ts`, `types.ts`, `canvas-binding.ts`,
`reconcile-plan.ts`, `manifest.json`, `server/`, `docker/`, deploy files, `plugin/main.js`.
Version stays `0.6.0`. `useCanvasBinding` default still `false`. No new dependency.

---

## Quality Gates

| Command | Result |
|---|---|
| `npx tsc -noEmit -skipLibCheck` | **PASS** (`TSC_CLEAN`) |
| `npx vitest run` over 11 files (WP7 files + regression neighbours) | **PASS** — 250 passed / 0 failed |
| `npx biome check` on the 6 touched files | **No increase.** 4 findings: 3 × whole-file `format` on `canvas-sync.ts` / `main.ts` / `canvas-sync.test.ts` (the known CRLF environment red) + 1 × `lint/style/useTemplate` at `canvas-sync.ts:600`, **pre-existing** — verified outside every changed hunk via `git diff -U0`. `canvas-persistence.ts`, `canvas-persistence.test.ts` and `canvas-single-writer.test.ts`: **0 findings** |
| `npm run build` | **NOT RUN** — its esbuild step writes the shared `plugin/main.js`; the dispatcher owns the authoritative build. `tsc -noEmit` covers the compile half |
| `npm test` (full suite) | **NOT RUN** — targeted runs only, per WP brief (one case sleeps 33 s) |

Per-file counts (before → after):

```text
canvas-persistence.test.ts       7 → 17   (+10)
canvas-sync.test.ts             40 → 40   (3 corrected in place)
canvas-single-writer.test.ts    19 → 19   (makePeer augmented)
background-sync.test.ts         25 → 25
file-ops.test.ts                37 → 37
canvas-matrix.test.ts            6 →  6
harness/two-peer.test.ts        10 → 10
regression.test.ts              13 → 13
manifest.test.ts                57 → 57
exclusion.test.ts               10 → 10
reconcile-plan.test.ts          16 → 16
```

Projected whole suite: **611 / 34 files → 621 passed / 34 files** (+10, no new file).

Definition of Done checks:

```text
grep -rn "CanvasPersistence" plugin/src --include=*.ts | grep -v __tests__ | grep -v canvas-persistence.ts
  → main.ts:129  private canvasWriters = new Map<string, CanvasPersistence>();
  → main.ts:1206 const { persistence, coldOpen } = await attachCanvasPersistence(   ← real call site
  (was ZERO at HEAD)

grep -n "scheduleDiskWrite" plugin/src/files/canvas-sync.ts
  → 810:  // WP7: formerly `scheduleDiskWrite`. …        ← comment only, no call

useCanvasBinding default  → false (plugin/src/types.ts:65)   version → 0.6.0
```

Abort criteria checked: no `useCanvasBinding` change; no new production import of
`canvas-binding.ts` / `canvas-model-bridge.ts`; no previously-passing test left failing.

---

## Risk Notes

1. **Scope extension — `canvas-sync.test.ts` was edited.** It is not in the WP's declared file set.
   Three of its cases assert the disk-writer role this WP removes from `CanvasSync`; they cannot
   survive the retirement, and leaving them red would have failed the dispatcher's authoritative
   merged gate and dropped the suite count. They are corrected in place, each re-pointed at the new
   writer so no coverage is lost. **The dispatcher should confirm this was the right call.** The
   alternative designs were considered and rejected: a per-path "external writer" flag inside
   `CanvasSync` would leave two components that both believe they schedule canvas writes — exactly
   what the BUILD_SPEC's Architecture notes rejected — and would violate AC9.
2. **`CanvasSync.writeToDisk` and the `remoteSeq` gate are retained with no production caller.**
   AC9 explicitly permits this ("may be retained as a private helper"). Retaining rather than
   deleting keeps the WP4 sequence-gate test green and avoids removing a mechanism a future seed
   path may want. It is dead code in the strict sense — a deliberate, recorded trade.
3. **The observer keeps a debounced `scheduleCanvasAudit`.** Removing the write but not the audit is
   a judgement call: `auditCanvasState` is the **only** production emitter of `SCATTER signature:`,
   `DETACH signature:` and WP5's `NO TYPE signature:`. Deleting the debounce with the write would
   have silently removed three of US6's ten signatures. It writes nothing.
4. **Writer lifetime is the subscription, not the open view.** The WP block hinted at teardown
   "alongside the presence/adapter (`:965-976`)". That is the *view-close* path, and tying the
   writer to it would stop persisting a canvas the moment the user closes the tab — the exact case
   the writer exists for ("closed canvases and cold opens stay correct"). Writers are destroyed in
   `teardownCanvasPresences()`, which runs in **both** destroy paths and nowhere else.
   `CanvasSync.unsubscribe` has no production caller, so no mid-session path is missed.
5. **Session-start attach stays fire-and-forget.** `.then((owned) => …)` is chained onto the
   existing `void subscribeCanvasWithHandover(...)`; session start is not serialized behind canvas
   cold opens. A `canvasWriterAttaching` guard makes a double attach impossible if both call sites
   ever race.
6. **A gap of one debounce exists between subscribe and attach.** A remote delta landing between
   `subscribe` resolving and `coldOpen` running is not written by anyone at that instant — but
   `coldOpen`'s doc-wins branch flushes the current doc immediately, so it is covered on the very
   next tick.
7. **An unsafe path now throws instead of silently skipping.** `createVaultPersistenceIO.write`
   rejects an `isPathSafe` failure; `writeSnapshot` catches it, leaves both content markers
   untouched and emits a `CANVAS WRITER: … write FAILED` warn. `CanvasSync.subscribe` already
   rejects unsafe paths before a writer can be attached, so this is defense in depth.
8. **US6 AC6 documentation rows** for `CANVAS WRITER:` and `CANVAS TEXT FALLBACK:` are still owed in
   `ARCHITECTURE.md` (outside both WP6's and WP7's file sets).
9. **No behavioural E2E was run.** Gates are typecheck + unit/composition tests only; no two-vault
   manual verification, per the WP brief (no deploy, no vault install).
