# Implementation Report — WP91 / C91: a mute that cannot tell who wrote is not an echo breaker

**Batch:** B48 · **Worker:** 3 (Execution) · **Branch:** `fix-bugs-and-raceconditions`
**Commits:** `267d5b2` (product + one enumerated test amendment) · `54e50ce` (six visible test files)
**Charter:** `TaskCharter_WP91_TheMuteCannotTellWhoWrote.md` (`71968da`) · **BUILD_SPEC rows:** `c971474`
**Base at start of work:** `e2f6358` — **B46/WP68 had already landed** while this batch was reading the charter. Every `file-ops.ts` line number in the charter is superseded again; `isPathMuted` is at **`file-ops.ts:219`** in the tree, re-measured, and that file is **not in this WP's diff**.

> Every line number below was re-measured against the committed tree at `54e50ce` (rule 5). None is transcribed from the charter, from B44's report or from `DISPATCHER_STATE.md`.

---

## 1. What changed, and where

Three production files, exactly the three the charter names. `file-ops.ts`, `control-handlers.ts`, `utils.ts` and `main.ts` are untouched.

### 1.1 `plugin/src/files/vault-events.ts` (+30 / −2)

The `modify` handler's gate ordering, for **canvas-owned shared paths only**.

| before (`e2f6358`) | after (`54e50ce`) |
|---|---|
| `:231` `isSharedPath` | `:231` `isSharedPath` — unchanged |
| `:232` `if (isPathMuted(file.path)) return;` — **an unconditional early return before any content is examined, with no log line** | **gone from this position.** The refcount is not removed: it moves to `:282` (text branch) and `:292` (binary branch) |
| `:235` `backgroundSync.isRecentDiskWrite` | `:242` — unchanged position relative to the canvas branch; see §6 |
| `:242` `if (canvasSync && canvasOwned(...))` | `:249` — the **one** ownership predicate, still evaluated **once** per event |
| `:244` `!canvasSync.isRecentDiskWrite(file.path) &&` inside the condition | **removed.** The condition is now `!plugin.settings.useCanvasBinding` alone |
| `:252` `void canvasSync.handleLocalModify(file.path)` | `:278` — reached whenever the path is canvas-owned and the flag is off, **whatever any timer says** |

The `return;` that makes the text path structurally unreachable for a canvas-owned path is intact (`:280`). A canvas-owned path never reaches `:289` `handleLocalTextModify`, muted or not — driven and asserted, not read off the diff (tp06 T6).

### 1.2 `plugin/src/files/canvas-sync.ts` (+167 / −11)

- **`:3175` `handleLocalModify`** — the opening `if (this.recentDiskWrites.has(path)) return;` is gone. `recentDiskWrites` is still maintained and `isRecentDiskWrite` (`:3874`) is still a public fact about this client's own writes; it is simply no longer consulted to decide **whose** bytes an event carries.
- **`:3239` the byte echo breaker** — `if (content === this.lastWrittenContent.get(path))`. **Promoted, not modified.** The comparison is byte equality exactly as WP4 left it; the only change is the line that follows it, which now names the decline.
- **`:353` `CaptureDeclineReason` / `:363` `CAPTURE_DECLINE_REASONS`** — the closed reason set.
- **`:3156` `declineCapture`** — the single production emitter of `CAPTURE DECLINED:` and the only writer of the counters.
- **`:3171` `captureDeclineCounts()`** — a snapshot of the per-reason counts. State, on the precedent WP68/WP88 set in `file-ops.ts`: *"the counter is the observable; it is state, not a log line, so a test can be an oracle over it."*
- **`:326` `MAX_ECHO_WINDOW_MS`** and **`:4117`** — the S68 twin window, bounded.

### 1.3 `plugin/src/files/canvas-persistence.ts` (+60 / −5)

- **`:50-62`** — the comment is rewritten. It no longer says *"NOT a correctness mechanism"*. It has been one for the life of the V2 capture path, and that sentence is the finding rather than a comment to soften.
- **`:79` `MAX_MUTE_MS = MAX_WAIT_MS + DISK_WRITE_SETTLE_MS`** — one derived constant, from two the module already imports.
- **`:491` `acquireMute`** — records `muteOpenedAt` when `muteDepth` goes 0 → 1, i.e. the **first** write of the burst.
- **`:515` `armSettleRelease`** — the trailing window is still `settleMs` from this write but never past `maxMuteMs` from the first. `acquireMute`/`releaseMute`'s pairing, the write queue, the debounce, `writeSnapshot`, the single-writer invariant, WP85's attach seam and WP63/WP90's withhold gate are untouched.
- **`:141` `maxMuteMs?`** — one option, whose only purpose is AC5's control fixture.

**`canvas-persistence.ts` line-by-line, on WP90's precedent:** 60 insertions, 5 deletions. The five deletions are the three-line comment at the old `:50-53` and the two lines of `armSettleRelease`'s body that computed an unbounded delay. Nothing else in the file was removed.

---

## 2. The journey, link by link, against the charter's §3 table

| # | charter's site | after WP91 |
|---|---|---|
| 1 | `vault-events.ts:231` `isSharedPath` | unchanged |
| **2** | **`:232` `isPathMuted` — the drop with no log line** | **not on the canvas path.** Moved to `:282` / `:292`, where it still governs the text, create, delete, rename, file-op and manifest consumers |
| 3 | `file-ops.ts` `isPathMuted` (`:219`, re-measured) | **byte-identical.** The refcount keeps its meaning for its five other consumers, none of which has a content baseline |
| **4** | **`:244` `!canvasSync.isRecentDiskWrite`** | **removed** |
| 5 | `:252` → now `:278` `handleLocalModify` | reached for every canvas-owned modify with the flag off |
| **6** | **`canvas-sync.ts:3065` `recentDiskWrites.has`** | **removed** |
| 7 | `:3099` → now `:3224` `vault.read` | unchanged — **the bytes arrive, and now they always arrive** |
| **8** | **`:3107` → now `:3239` the byte breaker** | **the sole authority.** No timer stands in front of it for a canvas-owned path |

**Every drop is now a fact about the bytes, or it is one of the five structural preconditions, and each of those names itself.**

---

## 3. Acceptance criteria — evidence, and how each vacuity risk was discharged

### AC1 — a differing local write is CAPTURED at delta zero with the mute provably held

**Evidence:** `wp91/test_tp01_a_real_save_survives_the_mute_visible.test.ts`, T1/T2/T4.
The mute is opened by a **real remote delta** reaching a **real `CanvasPersistence`**, which flushes and takes a **real `FileOpsManager`** refcount. At that instant the test asserts `fileOps.isPathMuted(PATH) === true`, `persistence.isRecentDiskWrite() === true` and `canvasSync.isRecentDiskWrite(PATH) === true` — the refcount and **both** settle windows. The user's differing bytes are then placed on the shared `files` map, read back, and the event is delivered. The oracle is **doc state**: `nodes` contains the user's record, and the mute is asserted still held afterwards.

**Vacuity (a) — the killer, "a test that calls `handleLocalModify` directly".** Discharged structurally: every row in tp01 dispatches through `rig.emitModify`, the handler the **real** `registerVaultEvents` registered on `vault.on("modify")`. The string `handleLocalModify` does not appear anywhere in tp01. Proof it reaches the gate: break **B1** (restore `isPathMuted` at the head of the handler) turns T1, T2 and T4 red — *"expected [ 'remote-1', 'seed' ] to include 'user'"*. A test that bypassed the router could not do that.

**Vacuity (b) — "a test in which no mute was ever taken".** T3 is the dedicated control: the same fixture with no write-back taken reports the refcount at **zero**, so T1's `true` is an advance and not a reading. And T3 itself is falsifiable: break **B18** (take the mute in `start()`) turns T3 red — *"expected true to be false"*.

**Vacuity (c) — "the marker write never landed".** `expect(rig.files.get(PATH)).toBe(userSave)` before the doc is inspected.

**Vacuity (d)** is a live-rig idempotence risk. Not applicable headless; per-run ids are used anyway (`ladder-0..4`, `peer-0..4`).

**The ladder.** T4 runs 0 / 100 / 300 / 500 / 800 ms, every rung with a freshly re-armed window, every rung captured. Under B1 the first rung already fails. **The live ladder (`liveshare_b41_observe_then_write.py`) is W4's and is not run here.**

### AC2 — the echo is suppressed by identity, at every delta

**Evidence:** `test_tp02_the_echo_is_suppressed_by_identity_visible.test.ts`, T1–T4.

**Vacuity (a) — "zero writes because one of four unrelated gates declined first".** T1 asserts `isSubscribed` true, the doc handle present and `isSchemaMajorMismatch` false **before** reading the echo assertion, and then settles the `canWrite` question the only way that cannot lie: the **same fixture, same run**, one field changed, produces writes (`x` moves to 111, the state vector changes). Four early returns cannot produce a capture.

**Vacuity (b) — "the 10 s row on a real clock".** One virtual clock (`vi.useFakeTimers()`); `CanvasPersistence` is left on its default scheduler precisely because that scheduler routes to the globals fake timers intercept. No wall-clock sleep anywhere in the batch.

**Vacuity (c) — "byte-identical produced by re-serialising".** The echo rows replay `rig.written.at(-1)` — the exact string `onWritten` reported — and assert it equals what is on the disk map. A serialisation drift that disarmed the breaker would redden this file rather than hide in it.

**The charter's §5 load-bearing ordering risk** (*"the `lastWrittenContent` advance must not be able to lag the event"*) is T4: flush, then deliver the echo **without advancing the clock or running a single timer**. Zero writes, `reason=echo`.

### AC3 — every decline is COUNTED, ATTRIBUTED and NAMED

**Evidence:** `test_tp03_every_decline_is_counted_and_named_visible.test.ts`, T1–T9.

Reason set: `echo`, `not-subscribed`, `read-only`, `schema-major`, `no-doc`, **`no-file`**. Signature, one emitter:
`CAPTURE DECLINED: <path> reason=<...> (declines=<n>)`, where `n` is that reason's running count.

**Vacuity (a) — the trap this AC sets for itself.** No zero is a primary observable anywhere in the file. T1 asserts **positively** that `echo` advances 0 → 1 through the **registered** handler and is `> 0`. Every other row uses `expectExactlyOneDecline`, which asserts the whole six-key record in one `toEqual`: the named reason `+1`, every other reason unchanged. That is the opposite shape from *"assert a zero"*.

**Vacuity (b) — "a counter on a branch no test reaches".** T7 drives all six on one instance and requires **every** counter non-zero, with the failure message naming the reason (*"no fixture ever reached reason=no-file"*). It also asserts the accessor's key set equals `CAPTURE_DECLINE_REASONS`, so a reason added without a fixture fails here rather than sitting as decoration.

**Vacuity (c) — S65, absence from the log.** No assertion in this batch is an absence claim about a log. The `toHaveLength(0)` assertions are over an in-memory sink the harness owns synchronously and each is paired with a non-zero counter in the same block. The counters exist so no log-absence claim is needed anywhere.

T8 asserts the line carries the path and the reason and nothing else — the fixture deliberately puts the string `SENSITIVE` into a node's text, confirms it is in the written bytes, and asserts it is not in the signature. T9 asserts the accessor is a snapshot.

**Direct calls, stated rather than hidden.** `echo` is driven through the registered handler. The other five are **unreachable from that handler by construction** — `canvasOwned` *is* `isSubscribed`, so a not-subscribed path never routes to the canvas branch at all — and are driven by calling the method directly. That is a named exception for AC3 only; AC1 never does it.

### AC4 — I11, a declined capture never destroys the user's bytes

**Evidence:** `test_tp05_a_decline_never_destroys_bytes_visible.test.ts`.

- **T1, the charter's headless companion:** with four declines counted in the same run, `vault.modify`, `vault.create`, `vault.delete` and `vault.trash` have zero calls and the file's bytes are unchanged.
- **T2, the two-step chain, SURVIVED:** a remote change opens the mute; the user saves inside the window and it is captured (the writer's **own** doc learns about it); one further **non-geometry** remote change lands and is projected — `written.length > 1`, so the write really was attempted (vacuity (a)) — and the user's record is still on disk.
- **T3, the same chain with the swallow RE-ARMED, and this is the finding B44 could not measure:** with the event not delivered — exactly what the mute check used to do — the user's bytes survive step 1 and are **destroyed at step 2**. `expect(idsOnDisk(...)).not.toContain("user")` passes. **The second step is real. "Your edit did not sync" was in fact "your edit is gone from your disk", one further remote change later.**

**Vacuity (b) — the substring trap WP87 got wrong.** `idsOnDisk` parses each record's own `id` field. No substring search over the `.canvas` anywhere in the batch.
**Vacuity (c) — geometry-only step 2.** Step 2 adds a new record; it is not geometry-only.
**Vacuity (d) — "a swallow that did not happen has not been survived."** T3 asserts the swallow (`nodeIdsIn(doc)` does **not** contain the user's record) before it asserts the destruction.

**The live two-instance AC4 row remains owed to W4, and its verdict is owed either way.** T2/T3 are a labelled headless surrogate, not a substitute.

### AC5 — the settle window has a stated ceiling

**Evidence:** `test_tp04_the_settle_window_has_a_stated_ceiling_visible.test.ts`.

**MEASURED CEILING: 750 ms, against the charter's 750 ms prediction. It closes exactly.** No third timer.
The S68 twin measures **700 ms** at 100 ms sampling granularity, i.e. ≤ 750 and consistent with the same bound.

The drive is a **landed write every 100 ms for 10 s of simulated time** — the charter's own wording. `flush()` rather than the debounce, deliberately and documented in the file: left to `scheduleWrite`'s trailing+cap debounce a stream of remote deltas lands a write roughly every `MAX_WAIT_MS` = 500 ms, which is **wider** than the 250 ms settle, so the window would expire between writes for a reason that has nothing to do with a cap and the control would be green against any implementation. (This is a correction to the charter's picture worth recording: the re-arm is only unbounded when writes are closer together than the settle window. Under the debounce alone, the two windows alternate rather than compose — which is consistent with B44 measuring ~0.8 s rather than an unbounded loss.)

**Vacuity (a) — the C73/WP75 class.** Nothing here reads a settle constant. The observable is the recorded `mutePathEvents` / `unmutePathEvents` **call sequence**, stamped on the clock, reduced by `longestMutedInterval`.
**Vacuity (b) — "a fixture in which the re-arm never fires".** T2 is the control: the same fixture with `maxMuteMs: Infinity` holds **one** mute, **zero** unmutes, for the full 10 s. Its own red is break **B16** (ignore the option) — *"expected [...] to have a length of 1 but got 13"*.
**Vacuity (c) — "the twin left unbounded".** T3 measures the S68 window on its own observable and is reddened by **B7** alone.

T4 proves the cap is measured from the **first** write of a burst, not the last. T5 proves a single quiet write still gets its full 250 ms — the cap bounds a burst, it does not shorten anything.

### AC6 — no collateral

**Evidence:** `test_tp06_no_collateral_visible.test.ts`, T1–T6. Every row is **behavioural**, in the same run, over the **real** refcount, and every row carries its own discrimination pair (the same call with the mute lifted must produce the opposite outcome).

| behaviour | row | its own red |
|---|---|---|
| a muted `.md` write does not reach `handleLocalTextModify` | T1 | B8 |
| the binary/manifest arm | T2 | B9 |
| muted `create` / `delete` / `rename` still suppressed | T3 | B14 |
| `applyRemoteOp`'s mute stops the outbound re-broadcast | T4 | B20b (see §4) |
| every mute has its unmute; the refcount returns to 0 | T5 | B15 |
| WP6/US5: a canvas-owned path is unreachable from the text path | T6 | B13 |

**Structural half, asserted by running the diff rather than by prose:**

```
$ git show --stat 267d5b2 54e50ce --name-only
plugin/src/files/vault-events.ts
plugin/src/files/canvas-sync.ts
plugin/src/files/canvas-persistence.ts
plugin/src/__tests__/canvas-single-writer.test.ts
plugin/src/__tests__/v2/wp91/*
```

`plugin/src/files/file-ops.ts` and `plugin/src/sync/control-handlers.ts` are **not in this WP's diff at all**. `file-ops.ts` is byte-verified: `git hash-object` = `e97266e865116048185baf4125dec163433e8d3e` before and after the whole batch, including after the temporary break in §4.

**Vacuity (a) — "'unchanged' asserted from reading the diff".** Discharged: the five behaviours are driven and each has a named break that reddens it.
**Vacuity (b) — "a full-suite green quoted in place of naming the files".** The affected files are named in §5.

---

## 4. Falsification — every row, its deliberate break, and the red observed

Twenty-one product breaks, applied one at a time to the committed tree, each run against the whole `wp91` suite and then restored. **Every one of the 32 rows has been seen red under at least one break.**

| # | break | rows reddened | red message observed |
|---|---|---|---|
| B1 | `vault-events`: restore `isPathMuted` in front of the canvas branch | 12 | `expected [ 'remote-1', 'seed' ] to include 'user'` |
| B2 | `vault-events`: restore `!canvasSync.isRecentDiskWrite` | 12 | `expected [ 'remote-1', 'seed' ] to include 'user'` |
| B3 | `canvas-sync`: restore the `recentDiskWrites` gate in `handleLocalModify` | 12 | `expected [ 'peer-0', 'seed' ] to include 'ladder-0'` |
| B4 | the `echo` decline stops counting and naming itself | 9 | `expected [] to have a length of 10 but got +0` |
| B5 | the byte breaker declines **everything** (a blanket return) | 5 | `expected '2,189,222,…' not to be '2,189,222,…'` |
| B6 | `canvas-persistence`: the mute re-arm is unbounded again | 2 | **`expected 1050 to be less than or equal to 750`**; `expected 1 to be greater than 1` |
| B7 | `canvas-sync`: the **S68 twin** is unbounded again | 1 | `expected false to be true` (the window never closed) |
| B8 | the **text** branch stops consulting the mute | 1 | `expected "vi.fn()" to be called +0 times, but got 1 times` |
| B9 | the **binary/manifest** branch stops consulting the mute | 1 | `expected "vi.fn()" to be called +0 times, but got 1 times` |
| B10 | the `no-file` branch goes back to a silent return | 2 | `no fixture ever reached reason=no-file: expected 0 to be greater than 0` |
| B11 | the decline counter never advances (the log line still fires) | 11 | `expected { … } to deeply equal { echo: 1, 'not-subscribed': +0, …(4) }` |
| B12 | the `useCanvasBinding` condition is dropped | 1 | `expected [ 'bound', 'remote-5', 'seed' ] to not include 'bound'` |
| B13 | a canvas-owned path falls through to the **text** path | 1 | `expected "vi.fn()" to be called +0 times, but got 1 times` |
| B14 | the `create` handler stops consulting the mute | 1 | `expected "vi.fn()" to be called +0 times, but got 1 times` |
| B15 | the settle release stops releasing the mute (stranded refcount) | 6 | `expected true to be false`; `expected 'undefined' to be 'number'` |
| B16 | `opts.maxMuteMs` is ignored, so AC5's control cannot disable the cap | 1 | `expected [ … ] to have a length of 1 but got 13` |
| B17 | the cap clamps every window to 0 | 2 | `expected [ … ] to have a length of 1 but got 100`; `expected false to be true` |
| B18 | the mute is taken at `start()`, so the refcount is never zero | 1 | `expected true to be false` |
| B19 | the projection never writes | 6 | `expected 1 to be greater than 5`; `expected false to be true` |
| B20 | `file-ops`: the **outer** `onFileModify` mute check removed | **0** | *(see below)* |
| B20b | `file-ops`: **both** `onFileModify` mute checks removed | 1 | `expected [ { type: 'modify', …(3) } ] to have a length of +0 but got 1` |

**B20 is worth recording rather than discarding: it is a green that could not fail, caught by running it.** Removing the outer mute check at `onFileModify`'s head reddened nothing, because a **second** `isPathMuted` check inside the queued send task still caught it. Had I stopped at B20 I would have concluded tp06 T4 was unfalsifiable; instead it turned out the mute is checked twice on that path and only removing both reddens it (B20b). `file-ops.ts` was restored and its hash verified byte-identical immediately afterwards; the file is not in this WP's diff.

**The pre-existing test amendment was also falsified.** Before amending it, the untouched `canvas-single-writer.test.ts` "AC6 case 2" was observed red against the new product with `AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times` — i.e. the amendment was made against a measured red, not a guessed one.

---

## 5. Gate

| | figure |
|---|---|
| `npx tsc -noEmit -skipLibCheck` | **clean** |
| Dispatcher's stated baseline | 2493 passed / 353 files |
| Baseline at `e2f6358` (**after B46/WP68 landed**) | **2571 passed / 358 files** — B46 raised it by 78 tests / 5 files |
| After WP91 | **2603 passed / 364 files**, 0 failed — reproduced on 4 of 8 full-suite runs; see the flake below |
| `npx vitest run src/__tests__/v2/wp91` | **32 passed / 6 files**, on every run |
| Biome on the six new files | clean (`organizeImports` + `format` applied to this batch's own files only; the pre-existing whole-file CRLF finding on the three production files is untouched, per the charter) |

**Attribution.** The delta from 2493 → 2571 is entirely B46/WP68 (`58aff0a`, `156eef5`, `e2f6358`), which committed between the Dispatcher's measurement and the start of this batch. The delta from 2571 → 2603 is exactly this WP's 32 rows. **No pre-existing test was deleted, skipped, retitled or weakened.** One assertion was amended, enumerated in §7.

`npm run build` was **not** run and `plugin/main.js` was **not** rebuilt or staged.

**Affected pre-existing test files, named rather than hidden behind a suite green:** `src/__tests__/canvas-single-writer.test.ts` is the only pre-existing file this batch edited, and the only pre-existing file whose behaviour changed. Every other file that exercises `handleLocalModify` (38 files, per `grep -rl handleLocalModify src/__tests__`) passes byte-unmodified.

### 5.1 A load-sensitive flake in `wp5/latency.test.ts`, measured and attributed away from this batch

`src/__tests__/wp5/latency.test.ts` → *"harness injects a measurable RTT inside the 50–150 ms band (US6 AC1)"* fails intermittently under full-suite parallel load:

```
AssertionError: expected 440 to be less than or equal to 150   (latency.test.ts:141)
AssertionError: expected 402 to be less than or equal to 150
```

**Observed rate on this host at `390df2a`: 4 red / 8 full-suite runs.** The same file run alone passes **11/11** every time (38.5 s, dominated by the deliberate 33.5 s sleeper).

**It is not this batch's.** The decisive measurement is a full-suite run with WP91's six files excluded:

```
$ npx vitest run --exclude "src/__tests__/v2/wp91/**"
  Test Files  1 failed | 357 passed (358)
      Tests   1 failed | 2570 passed (2571)     ← the same row, the same assertion
```

At the **pre-WP91 file set**, on the same host, at the same moment. The batch adds ~0.5 s of CPU in `wp91/tp04` and does not add the failure.

**What it actually is, and it is the same class as the finding in §6.1:** `:141` asserts a **wall-clock** round-trip inside a 50–150 ms band. A host that defers a timer by 300 ms breaks it, and the observed values (402 ms, 440 ms) are consistent with ordinary scheduling pressure rather than with anything in the product. It is a timer-shaped assertion about a machine, described in `WP5/US6 AC1` as a property of the harness. **Not fixed, not amended, not skipped, not numbered** — described here so the next batch that sees a red on this row looks at its load before it looks at its diff. It needs a signal number; I do not allocate one.

---

## 6. The measured ceiling against the 750 ms prediction

**750 ms measured, 750 ms predicted. `MAX_WAIT_MS` (500) + the 250 ms settle. The arithmetic closes and there is no third timer.**

The S68 twin measures 700 ms at 100 ms sampling granularity — the same bound, one sample short of it.

**But the charter's picture of *why* the window reached ~0.8 s needs one correction, and it is recorded here rather than repaired.** The re-arm only holds a window open indefinitely when landed writes are closer together than the settle window. Under the ordinary debounce (`DEBOUNCE_MS` 200 capped by `MAX_WAIT_MS` 500) a stream of remote deltas lands a write roughly every 500 ms, which is **wider** than the 250 ms settle — so before this WP the mute alternated open/closed rather than staying open, and the *coverage* was partial rather than total. That is consistent with B44 measuring LOST 11/12 rather than 12/12 in the 0.5–0.8 s block, and it is why AC5's control fixture had to drive `flush()` directly: with the debounce alone the window closes between writes for a reason that has nothing to do with a cap, and the control would have been green against any implementation. This does not change the mechanism, the severity or the fix; it changes one sentence about the shape of the window, and the sentence was in the charter.

### 6.1 THE CEILING HOLDS ONLY WHILE THE HOST IS NOT CLAMPING, and that is a property of the shape, not a tuning problem

Handed to this batch by the Dispatcher from **B49's S65 audit**, taken as a given and **not re-measured here** (confirming it needs a window-focus change on a shared rig, which is not this batch's to take):

> `setTimeout` / `setInterval` in the renderer are clamped to **60.00 s ± 0.02**. Measured over 84 logger flush batches across both live vaults: min 0.011 s, median 0.988 s, **p90 59.986 s**, max 60.823 s — 44.0 % in the 0.50–0.60 s band (matching `FLUSH_DELAY_MS = 500` to the millisecond) and **26.2 % in the 40–61 s band**. The mechanism is not the logger: `SyncManager`'s independent `setInterval(4000)` awareness tick stretches to the same whole minute at the same moments and says so — `AWARENESS GAP: 59998ms … source=tick`. Two unrelated timers clamped simultaneously to 60.00 s is a **host wake-up clamp on the renderer**. Historically ~0.7 % of 18 600 pulses: a fat tail, not the steady state.

Three consequences, stated plainly rather than tuned around.

**1. The 750 ms I measured is a statement about the UNCLAMPED regime, and my instrument cannot see the other one.** AC5's measurement runs on `vi.useFakeTimers()`, where a timer fires exactly when the virtual clock says so — by construction there is no host in it to clamp anything. So "750 ms measured against 750 ms predicted" is an exact statement about **the mechanism's arithmetic** (`MAX_WAIT_MS` 500 + settle 250), and it is the regime B44's 0.8 s / 0.9 s boundary was measured in. It is **not** a statement about the longest wall-clock mute a user can experience. Nothing in this batch measured that, and nothing in this batch could have.

**2. A ceiling enforced by a `setTimeout` cannot be honoured on a platform that clamps `setTimeout`.** This is worth being blunt about because it is a limitation of what I built. `armSettleRelease` computes a *shorter delay* under the cap — but the release still only happens when the host fires the timer. Under a clamp the host does not fire it for up to ~60 s, so **the longest continuous muted interval becomes the clamp, not the cap**, in roughly 0.7 % of pulses. The same is true of the S68 twin, which uses a bare `setTimeout`. **AC5's bound holds while the host is not clamping; when it clamps, the window is whatever the clamp is.** I did not widen the cap, re-time anything, or arrange the measurement to hide this.

**3. And this is the strongest argument for the shape the charter asked for, so it belongs in the record rather than in a footnote.** *A byte-identity decision is unaffected by a clamp; a timer-shaped one is not.*

| | pre-WP91 | after WP91 |
|---|---|---|
| what decides whether a local save is our echo | a mute held open by a `setTimeout` | the bytes, at `canvas-sync.ts:3239` |
| unclamped | ~750 ms in which every local canvas save is silently destroyed | nothing is destroyed; the mute is not consulted on the capture path at all |
| **clamped (~0.7 % of pulses)** | **~60 s in which every local canvas save is silently destroyed** | **nothing is destroyed.** The mute stays held for a minute and it costs *nothing on the capture path* |
| what the clamp costs after WP91 | — | **latency, not data.** The projection write and the mute release are late; the user's save is still read, still captured, still on the peer |

So the clamp does not merely fail to threaten this fix — **it is the case that makes the fix's shape necessary.** Had WP91 been delivered as a smaller constant, a 60 s clamp would have re-opened the defect at eighty times the measured width, intermittently, on a schedule nobody controls, and the ladder would still have gone green. That is exactly the outcome the charter forbade when it said *"an implementation that changes only timing constants FAILS, whatever the ladder measures."*

**A consequence for AC5's own honesty rule, recorded, not repaired:** the rewritten comment at `canvas-persistence.ts:50-79` now lets a reader compute 750 ms from the module's own constants, which is true of the mechanism and true of the wall clock only while the host is not clamping. A cap that is robust to the clamp would have to be enforced at the *next event*, not by a timer — e.g. releasing the mute lazily when a write or a query finds the window already older than `MAX_MUTE_MS`. That is a different design, it was not chartered, and it is not what I built. **It needs a signal number and a decision; I do not allocate one.** Under WP91's shape it is a latency improvement rather than a correctness one, which is why I did not take it unasked.

---

## 7. The one enumerated test amendment

`src/__tests__/canvas-single-writer.test.ts`, `WP6 / US5 AC3+AC4+AC6` → **"AC6 case 2 — subscribed, CanvasSync's own disk-write echo → NEITHER"**, one assertion:

```
-    expect(r.handleLocalModify).toHaveBeenCalledTimes(0);
+    expect(r.handleLocalModify).toHaveBeenCalledTimes(1);
```

**Why this is not a weakening.** That assertion is the router half of the defect: it asserted that a canvas-owned modify is dropped while `CanvasSync.isRecentDiskWrite` answers true, which is exactly the timer WP91 removes. B44 found three greens in the E2E suite hiding this defect; this is a fourth, in the unit suite. The row's remaining assertion — the trap the AC actually exists for, *"a naive `else` would send the echo here"* — is **unchanged and still green**: `handleLocalTextModify` is still asserted at zero. The title is unchanged, the test is not skipped, and no other assertion in the file was touched. The amendment was made against an observed red (§4).

`WP91 holds no §7 licence of any class` and none was taken: nothing was deleted, and this is the only assertion rewritten.

---

## 8. Out of scope — described, not fixed, and not numbered

1. **A fourth timer stands in front of the canvas byte breaker, and it is not in any document of this run.** `vault-events.ts:242` `plugin.backgroundSync.isRecentDiskWrite(file.path)` — `BackgroundSync`'s own 250 ms disk-write window (`background-sync.ts:479` / `:501`) — is evaluated **before** the ownership predicate, so it can still drop a canvas-owned modify. It is not in the charter's §3 journey table, not in the BUILD_SPEC §9 row and not in B44's mechanism table, so it was left exactly where WP6 put it and documented in place. **Reachability:** a path is in that set only while `BackgroundSync` is its writer, which the ownership discipline forbids for a canvas-owned path — so the only window in which it can fire is the ≤ 250 ms handover in which a text-owned path becomes canvas-owned (`subscribeCanvasWithHandover`: `backgroundSync.unsubscribe` then `canvasSync.subscribe`). Narrow, once per path per session, and the same failure mode: a user save dropped with no receipt. **This needs a signal number; I do not allocate one.**

2. **The registered `CAPTURE DECLINED:` format string is one member short.** BUILD_SPEC §10 (`c971474`) registers `reason=<echo|not-subscribed|read-only|schema-major|no-doc>`. The implementation emits a sixth, `no-file`, for a `modify` event whose `TFile` the vault cannot resolve. The charter's AC3 says *"Reasons, **at minimum**: …"* and its vacuity risk (b) makes the enum the implementor's call based on drivability, so the branch was counted rather than left as the one silent discard in a work package about silent discards. The §10 row needs `|no-file`. **That is the Dispatcher's edit; this WP does not touch BUILD_SPEC.**

3. **`canvas-sync.ts:4276` `writeToDisk`, whose `finally` (`:4302`) still arms a raw 250 ms `setTimeout` that both deletes from `recentDiskWrites` and calls `unmutePathEvents`.** It is the retired seed-path writer with no CRDT-observer-driven caller, it is not on the capture path, and it is uncapped. Left alone: bounding it would have touched a fourth mechanism for no measured benefit.

4. **`CanvasSync.isRecentDiskWrite` now has no production consumer.** It is still correct, still maintained, still bounded (AC5) and still used by tests as a window observable. Removing a public accessor is not this WP's business.

5. **A timer-enforced ceiling is not clamp-proof, and a lazy one would be.** See §6.1. Releasing the mute at the next event that finds the window older than `MAX_MUTE_MS`, rather than on a `setTimeout`, would hold the stated ceiling through a renderer wake-up clamp. Not chartered, not built, and after WP91 it buys latency rather than correctness. **Needs a signal number and a decision.**

6. **`wp5/latency.test.ts:141` asserts a wall-clock RTT band and reds under load.** See §5.1. 4 red / 8 full-suite runs on this host, reproduced with WP91's files excluded, green 11/11 in isolation. **Needs a signal number.**

---

## 9. Anything in the tree I did not write

- **`plugin/src/files/canvas-sidecar.ts` shows ` M` in `git status` with an empty `git diff` and an empty `--numstat`.** It is a stale index stat entry, not a content change, and it is B46's file. Untouched, unstaged, uncommitted, and reported rather than "cleaned up" (RULE 14).
- **B46/WP68 landed during this batch** (`58aff0a`, `156eef5`, `e2f6358`), which is why `file-ops.ts`, `control-handlers.ts` and `utils.ts` no longer appear as working-tree modifications and why `wp68/` is now tracked. Nothing of theirs was reverted, stashed or checked out over.
- `H:\tmp\wp91_falsify.py` and `H:\tmp\wp91_falsify2.py` are this batch's falsification harnesses. They live outside the repo and are not committed.

---

## 10. Not run, and owed

- **The live B41 ladder (`liveshare_b41_observe_then_write.py`, `LS_B41_DELTAS=0.0,0.1,0.3,0.5,0.8`)** — W4's, AC1's live row. No Obsidian was launched, no bundle was installed, no relay was contacted, no `data.json` was opened, no secret passed through any tool, and `npm run build` was not run. The bundle hash is therefore not stated because no bundle was measured; S67 and `S57(installer)` apply to W4's rows.
- **The live `echo`-counter observation on a real instance** — W4 target 2.
- **The live two-step AC4 scenario** — W4 target 3, **verdict owed either way**. §3's T3 shows the destruction is real in the harness; whether it reproduces on two live instances is not something this batch measured.
