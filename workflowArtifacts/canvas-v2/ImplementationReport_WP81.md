# Implementation Report — WP81: the log sink says what it did

**Worker:** Worker 3 (Implementation), batch **B22**, autonomous mode
**Repo / branch:** `obsidian-live-share` @ `fix-bugs-and-raceconditions`
**Charter:** `TaskCharter_WP81_TheLogSinkSaysWhatItDid.md` (6 ACs, `task_mode: standard`)
**Status:** **5 of 6 ACs DONE. AC1 PARTIAL — the E2E control command is DEFERRED** (see §"Deferred").
**Blind sets:** none owed (discontinued 2026-08-05).

---

## 0. First, the correction that must not be lost

> **The reported 2026-08-04T23:56 silence did not occur.** The debug logger did not stop.

Re-confirmed independently by this batch, read-only, at implementation time (2026-08-05T03:26 local):

| vault | log file | size | mtime at read | last line |
|---|---|---|---|---|
| A | `H:\Developement\_NeuralAngels\ObsidianOrga\.obsidian\live-share-debug.md` | 783 194 B | `2026-08-05 03:26:23` | `2026-08-05T01:26:23.070Z [DEBUG] [sync] awareness pulse: gap 8004ms (source=tick)` |
| B | `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie\.obsidian\live-share-debug.md` | 736 647 B | `2026-08-05 03:26:23` | `2026-08-05T01:26:23.083Z [DEBUG] [sync] awareness pulse: gap 8004ms (source=message)` |

Both files were being appended to *in the same second the measurement was taken*, a day after the
alleged stop. The charter's Verification 1 holds. **No criterion in this WP asserts that a historical
silence was repaired**, no test is named after that timestamp, and nothing here treats `7754ac6` as a
cause. What was actually implemented is what is measurably in the tree.

Two further live facts fell out of that read and are carried up, not repaired:

- **S30 confirmed and worsening.** The two logs were 749 960 B / 708 014 B at charter time and are
  783 194 B / 736 647 B now — **+33 234 B / +28 633 B in one day**, with no cap and no rotation.
  Rotation is explicitly out of WP81 scope (§2 of the charter). **Still unowned. Carried up.**
- **S31 not touched.** The duplicated historical blocks in both files are a file-move artefact. No
  existing log file was read beyond `stat`, `tail -1` and a `grep -c` for the new signature, and
  none was modified or repaired.

---

## 1. Re-verification of the three cited defects (rule 12), before any change

All three were **still present** in the tree at `8d09fe1`. None had been fixed by another batch.

| # | Cited site | Present? | What was actually there |
|---|---|---|---|
| **1** | `debug-logger.ts:153-156` | **YES, verbatim** | `this.buffer = [];` on `:153`, *above* `this.vault.adapter.append(...).catch(() => { /* Best-effort logging, discard write failures */ });` on `:154-156`. Lines dropped from the buffer before the outcome was known; the rejection discarded; no counter, no state, no announcement. A permanently unwritable path lost every line, forever, at `FLUSH_DELAY_MS = 500 ms`. |
| **2** | `log-view.ts:71` | **YES, at `:72`** (one line off the charter's citation, same handler) | `select.addEventListener("change", …)` → `this.logger?.setLevel(this.filterLevel);`. `setLevel` moved `minLevel`, and `record()`'s early return at `:120` sat *above* the file-sink push at `:136-139`. A **view** dropdown therefore muted the **file**. |
| **3** | `ui/settings.ts:306` | **YES, verbatim** | `settings.debugLogPath = value.trim() \|\| "live-share-debug.md";` — a second literal, not `DEFAULT_SETTINGS.debugLogPath`, plus the same literal again as the placeholder on `:309`. Clearing the field moved the log back to the vault root, the location `7754ac6` moved it out of. |

---

## 2. Per-AC status and evidence

### AC1 — the sink can be asked what it is doing · **PARTIAL (headless DONE, live DEFERRED)**

**Delivered:** `DebugLogger.getSinkState(): DebugSinkState` — the full sink state, every field read at
call time from the sink's own fields:

`path` · `enabled` · `fileLevel` · `ringLevel` · `linesWritten` · `linesPending` · `linesDropped` ·
`lastWritePath` · `lastWriteOk` · `failureCount` · `lastError {message, ts}` · `failureAnnounced` ·
`locationAnnounced`.

**Not an echo of the setting — the discriminating row is asserted.** With an append held open to
`old-path.md`, `updateSettings(true, "new-path.md")` is applied and the write then released:
`state.path === "new-path.md"` while `state.lastWritePath === "old-path.md"`. An implementation that
echoed `settings.debugLogPath` would report the same value for both. **No field is hardcoded**;
`linesWritten` is asserted equal to the number of lines the fake adapter actually received, on every
iteration of a ten-cycle alternating fail/succeed loop.

**Disabled is distinguishable from failing:** with `enabled === false`, `failureCount === 0`,
`lastError === null`, `lastWriteOk === null` — nothing was attempted, so nothing failed.

**Deferred:** the additive `routeCommand` case that exposes this over `POST /command`. See §"Deferred".

### AC2 — a write failure is recorded, announced once, and not announced again · **DONE**

Injected at the adapter seam (a fake `adapter.append` that rejects). **No vault path was made
unwritable.**

| act | `failureCount` | ring `error` entries in `log-sink` | `Notice` calls |
|---|---|---|---|
| first failure | 1 | 1 | 1 |
| six more failures | **7** | **1** | **1** |
| recovery (one success) | **0**, `lastError = null`, `failureAnnounced = false` | 1 | 1 |
| fails again | 1 | **2** | **2** |

The counter advanced from 1 to 7 while the announcement did not — which is what distinguishes
"announces once" from "announces always". At `FLUSH_DELAY_MS = 500 ms` the "always" variant would be
two toasts a second forever, and that is the failure mode the charter named as most likely.
Recovery re-arms, so "once" does not mean "once ever, then never again even after it heals".

The announcement is a `Notice` supplied by `main.ts` (**wiring only**) plus one ring-buffer entry.
A notifier that **throws** is caught and does not break logging (asserted).

### AC3 — no line discarded on the strength of an unresolved write; the retained set is bounded · **DONE**

Every assertion is made **after the rejection has settled** (`await` over queued microtasks), which
is the difference between a real assertion and the vacuous one: read synchronously, the naive
"the lines are still buffered" check passes against the **unrepaired** `flush()` too.

- After a rejected flush: `linesWritten = 0`, `linesPending = 3` (the two lines + the location
  statement), `linesDropped = 0`, nothing in the file.
- On recovery the previously failed lines **are written**, and **in order** — `alpha` before `beta`
  before `gamma`; the retry goes back to the **front** of the buffer.
- `linesWritten` is asserted equal to the lines the adapter actually received, on every one of ten
  alternating cycles. **The sink never believes it wrote more than it wrote.**
- **Bound, driven not read:** a 600-line burst against a failing sink (601 emitted incl. the location
  statement) leaves `linesPending` capped and `linesPending + linesDropped === 601` — nothing
  vanishes unaccounted for. A **second** 600-line burst does not grow the retained set at all
  (`linesPending` identical), and `linesPending + linesDropped === 1201`. On recovery the oldest
  (`burst 0`) is confirmed absent and the newest (`burst2 599`) confirmed present. The bound is
  `PENDING_CAP = 500`, mirroring `RING_CAP`.
- **No spin:** a permanently failing sink makes **one** append attempt per flush. 30 000 ms of
  advanced fake clock with no new log lines produces **no** further attempts. A failure never
  reschedules itself; the next log line carries the retry.

**The announcement does not depend on the failing sink:** with the adapter rejecting, `written` is
empty and the ring entry + the `Notice` are both present (asserted).

### AC4 — a view filter never mutes the file sink · **DONE, all four levels**

Two independent repairs, because one alone leaves the hazard reachable:

1. `log-view.ts` no longer pushes the dropdown level into the logger at all. Its own display filter
   (`appendEntry`, `LOG_LEVEL_ORDER[entry.level] < LOG_LEVEL_ORDER[this.filterLevel]`) is **correct
   and unchanged** — that one is the view filtering the view.
2. `DebugLogger` now has a **separate** `fileMinLevel` for the file sink. `setLevel()` (the
   view-reachable one) moves only the ring/subscriber gate. Default `fileMinLevel = "debug"` equals
   the previous default `minLevel`, so **with no view action the volume written to the file is
   unchanged**.

Asserted for **all four** `LOG_LEVELS`, not just the permissive one: with the view level at
`debug`, `info`, `warn` and `error`, a `debug` line and an `info` line both still reach the file, and
`getSinkState().fileLevel` stays `"debug"` in every case. **The `debug` row passes against the
unrepaired build** — it is the dropdown's default and is exactly the vacuous row the charter warned
about. **The `info`, `warn` and `error` rows fail against the pre-WP81 build** (measured, §3).

The ring buffer still honours `setLevel` — the inherited assertion is re-stated in the new suite and
the inherited test in `debug-logger.test.ts` is untouched and green.

### AC5 — a cleared path field cannot silently move the log back to the vault root · **DONE**

`ui/settings.ts` gained `resolveDebugLogPath(value)`, extracted so the relationship can be asserted
**as a relationship**: `value.trim() || DEFAULT_SETTINGS.debugLogPath`, read at call time.

**Perturbation, which is the whole point of the criterion:** with
`DEFAULT_SETTINGS.debugLogPath` temporarily set to `some/other/location.md`, the cleared field
resolves to `some/other/location.md`; set to `.obsidian/elsewhere.md`, it resolves to
`.obsidian/elsewhere.md`. The test **never hardcodes** `.obsidian/live-share-debug.md` — doing so
would reproduce the defect (two literals that agree today) inside the oracle. The default is
restored in `afterEach`.

The `ui/settings.ts` source is additionally asserted to contain **no** `"live-share-debug.md"`
literal at all (the placeholder now also references the default).

**`plugin/src/__tests__/types.test.ts` was NOT modified** and its default assertion
(`DEFAULT_SETTINGS.debugLogPath === ".obsidian/live-share-debug.md"`) is **green**. `DEFAULT_SETTINGS`
was **not edited**. `7754ac6` was **not reverted**. The log stays in `.obsidian/`.

### AC6 — the location is stated once per session · **DONE headless; live restart DEFERRED**

The sink emits `LOG SINK: writing to <resolved path>` under category `log-sink`, at `info`,
**once**, to **both** channels — the file *and* the ring buffer — bypassing both level gates,
because a statement that exists for the reader who cannot find the file is useless if it only
reaches the file.

- It is the **first** line in the file (asserted as `landed[0]`), and there is exactly **one** across
  two flushes and three entries.
- With the adapter rejecting, the file gets nothing and the ring statement is still there — the
  reader can still learn which file was meant.
- **Not per flush:** eight separate flush cycles produce **one** statement.
- **Disabled says nothing.** `locationAnnounced === false` when the sink is off. Disabled is not a
  location.
- **Relocation re-arms it.** `updateSettings` to a new path produces a **second** statement naming
  the new path, and the ring holds both — so a reader of the *old* file is not stranded. This is the
  failure that actually cost this project a day and it is now a one-line answer.
- Turning logging on mid-session also produces the statement.

**Live evidence after a rig-driven restart is deferred** — see below. Read-only confirmation that the
statement is *not* in either vault today (the pre-WP81 build is installed): `grep -c 'LOG SINK'` = **0**
in both files.

---

## 3. RED → GREEN, measured

The six new test files were run against a **temporarily reverted, pre-WP81 build** of the three
production files (old `flush()` body with the buffer cleared before the append and the rejection
swallowed; `record()` gating the file sink on the ring level; `log-view` pushing the dropdown level
into the logger; the settings fallback back to its own literal; the location statement removed).
The public API was left in place so the suite still compiled — i.e. the RED is behavioural, not a
compile error.

| run | result |
|---|---|
| **RED** — pre-WP81 behaviour | **24 failed \| 8 passed (32)** |
| **GREEN** — WP81 behaviour | **32 passed (32)** |

The **8** that passed under RED are exactly the rows that are level-invariant or already true, and
each is a row the charter itself flags as non-discriminating:

- AC1 `reports … a zeroed ledger before anything is written` (nothing has happened yet)
- AC1 `distinguishes DISABLED from FAILING` (disabled path was already inert)
- AC1 `carries the log path and no other settings value` (shape, not behaviour)
- AC3 `does not spin` (the old code did not spin either — it lost the lines instead)
- AC4 `view level at "debug"` — **the vacuous row, named as such in the charter**
- AC4 `the ring buffer still honours setLevel` (an invariant that had to stay true)
- AC5 `a non-empty value is used verbatim, trimmed` (unaffected by the fallback)
- AC6 `says nothing while the sink is disabled` (nothing was ever said)

Everything that discriminates went red. The production files were restored from a byte-copy backup
and verified free of the RED markers before any commit.

---

## 4. Suite numbers

| | test files | tests |
|---|---|---|
| **Before** (`8d09fe1`, WP81 untouched) | 303 passed / **3 failed** (306) | 1973 passed / **3 failed** (1976) |
| **After** | 309 passed / **3 failed** (312) | **2005 passed** / **3 failed** (2008) |
| **Delta** | +6 files (all `v2/wp81/`) | **+32 tests, all new, all passing** |

Measured by: `npm test` (`vitest run`) from `plugin/`.

**The 3 failures are identical before and after and are not WP81's.** All three assert the import
allow-list of `plugin/src/testing/e2e-control.ts`:

- `wp49/test_tp12_existing_protocol_no_new_dependency_visible.test.ts`
- `wp72/test_tp4_no_production_branch_and_no_new_transport_visible.test.ts`
- `t3/wp44/test_tp12_no_server_no_port_visible.test.ts`

They fail because of an **uncommitted sibling-batch edit** to `e2e-control.ts` (a new import of the
untracked `plugin/src/testing/canvas-node-editor.ts`) — WP37's file, which WP81 is barred from
touching. The three were already red at batch start, before a single WP81 character was written.
**Carried up; not WP81's to fix.**

**No existing test was deleted, weakened, retitled, skipped or amended.** No `.skip`, no `.only`, no
edit to `debug-logger.test.ts` or `types.test.ts`. **No §7 licence of any class was taken and no
`DONE` work package was re-opened.**

**Gates:** `npm run build` (`tsc -noEmit -skipLibCheck && esbuild production`) — **PASS**.
`npm run lint` — the only findings on WP81's touched files are the two **pre-existing** ones
(`log-view.ts:23 noUselessConstructor`, present before this WP; `ui/settings.ts` whole-file `format`,
the known CRLF environment artefact). **No mass reformat was performed.** The new test files were
formatted by `biome check --write` scoped to `src/__tests__/v2/wp81/` only, and their one real
finding (`noForEach`) was fixed.

---

## 5. Invariants — positively stated

- **No log signature, category, level or volume changed.** `DRAG WATCHDOG:`, `LOCK REVERT:`,
  `AWARENESS GAP:`, `CANVAS MIRROR:` and every other uppercase contract are untouched. Not one
  existing call site was re-levelled or re-categorised. The only new emissions are the sink's own:
  **at most one** location line per session per resolved path, and **at most one** failure line per
  failure run, both under the new `log-sink` category, which no consumer parses.
- **`RING_CAP` and the subscriber fan-out are behaviourally unchanged.** The ring push and fan-out
  were extracted verbatim into `pushRing()`; the cap is still 500, oldest-dropped; the inherited
  cap and fan-out tests are green and unmodified.
- **`DEFAULT_SETTINGS` was not edited.** `types.ts` was not modified at all — not one byte. The new
  `DebugSinkState` interface lives at the top of `debug-logger.ts`, not in `types.ts`: it describes
  the logger, not the persisted settings schema, and keeping `types.ts` untouched means the WP22
  comment-strip trap below `DEFAULT_SETTINGS` **cannot fire**. (Judgement call against the letter of
  the "new types go in `types.ts`" instruction, taken because that instruction's stated purpose is
  avoiding that trap, and not touching the file avoids it absolutely. `wp22` dormancy tests: green.)
- **`7754ac6` was not reverted.** The log stays in `.obsidian/`.
- **No rotation, no size cap, no second sink, no logging framework, no new runtime dependency.**
  `package.json` untouched.
- **`useCanvasBinding` is still `false`.** No `server/**` edit. `plugin/manifest.json` untouched.
  Plugin version not bumped. `BUILD_SPEC_CanvasV2.md` not edited.
- **`main.ts` gained wiring only:** a fourth constructor argument `(message) => { new Notice(message); }`.
  No decision about the sink is made in `main.ts` — the logger decides *whether* and *how often*.
- **No secret can reach the log.** `DebugSinkState` carries the **log path** and nothing else from
  settings; its key set is asserted exhaustively by test. The failure announcement contains the path
  and the adapter's error message, truncated to 200 chars. No settings **value** is written to the
  log, the state, a test name, a fixture or this report. No `data.json` value was read or printed at
  any point in this WP.

---

## 6. M3 — explicitly NOT repaired

**`taskkill /F` discards up to `FLUSH_DELAY_MS` = 500 ms of buffered entries.** `destroy()` still
calls `flush()`, which is still asynchronous, so a hard kill loses whatever has not been appended.
**This WP did not repair it**, and AC3 does **not** cover it: AC3 is about a write that *rejected*,
M3 is about a process that never got to observe the write at all. A synchronous or shutdown-hook
flush is a different problem with different risks (blocking Obsidian's unload) and would need its own
criterion and its own evidence.

**One thing did improve incidentally and is stated for accuracy:** because the buffer is no longer
cleared before the append resolves, a hard kill during an in-flight append no longer *also* loses the
in-flight batch's accounting — but the lines are still gone from the file. **M3 stands open.
Carried up.**

---

## 7. Deferred

### AC1's E2E control command — DEFERRED, not skipped

The charter's AC1 deliverable includes **one additive `routeCommand` case** in
`plugin/src/testing/e2e-control.ts` exposing the sink state over `POST /command`, plus AC1's and
AC6's live observables driven through it.

**`plugin/src/testing/e2e-control.ts` is owned by WP37 this batch and WP81 is barred from editing
it.** The file is currently modified and uncommitted by that batch. Editing it would collide, and
installing a WP81 build would `taskkill /F` both live Obsidian instances mid-run — both control
ports answered `session.info` while this WP was being implemented (A: `703aa794cc73a117`, role
`host`; B: `55a4253eb7a90dde`, role `guest`, both `pluginBuild 0.6.1+e2e`), and
`H:\tmp\liveshare_wp37_e2e.py` / `liveshare_wp37_probe.py` exist, so the rig is in active use.

**Everything the command needs is built and public.** Adding it is a one-case, purely additive change
whose whole body is:

```ts
case "plugin.sinkState":
  return { ok: true, result: host.logger?.getSinkState() ?? null };
```

on the optional-host-method precedent (`canvasFile`, `e2e-control.ts:513-518`), so pre-existing fake
hosts stay valid and no existing command changes shape.

**What is consequently not yet evidenced live, and is owed by whoever lands the command:**

- **AC1 live:** the reported path on both vaults matching the file that is actually growing — take
  the reported path, read its length, emit a log-producing action, observe the length increase **at
  that path**, and `linesWritten` advancing by the same act.
- **AC6 live:** the once-per-session statement present in the file **and** the ring buffer on both
  vaults after a rig-driven restart.

Both are **fully covered headlessly** (32 tests, RED→GREEN) — the mechanism is proven, only the
live attribution on the two owner vaults is outstanding. **Recommendation: hand AC1's command to
W4 as a WP81 revision once WP37 releases `e2e-control.ts`.**

### Live-run disclosures

- Ports contacted: `39431` and `39432`, **read-only**, `session.info` only, twice.
- **`canvas.simulateEdit` was NOT called.** `plugin.settings` was not called (it does not exist — S33).
- **No `data.json` value was read or printed.** `data.json` was not opened at all.
- **No vault path was made unwritable.** Every write failure was injected at the adapter seam,
  headless. No vault file was written, moved, repaired or deleted. No Obsidian was launched, killed
  or reinstalled. No relay was contacted. `sharedFolder` untouched.
- The two vault log files were read only via `stat`, `tail -1` and `grep -c`.
- `H:\tmp` suites: none run, none modified — still idempotent.

---

## 8. Carried up

| id | item | owner |
|---|---|---|
| **S30** | The debug log grows without bound in `.obsidian/`. **+33 234 B / +28 633 B measured in one day**, now 783 194 B / 736 647 B. Rotation is out of WP81 scope by charter. | **none** |
| **S31** | Duplicated historical blocks in both log files — a file-move artefact, not a logger defect. Not repaired. A reader bisecting by timestamp will be misled. | **none** |
| **M3** | `taskkill /F` discards up to 500 ms of buffer. Named, not repaired, no criterion claims otherwise. | **none** |
| **new** | Three inherited tests are RED on `e2e-control.ts`'s import allow-list, caused by an uncommitted sibling-batch (WP37) edit. Red **before** WP81 started; WP81 is barred from the file. | **WP37** |
| **new** | AC1's E2E command, deferred for the `e2e-control.ts` ownership constraint. Body given above. | **W4 revision** |

---

## 9. Changed files

| file | change |
|---|---|
| `plugin/src/debug-logger.ts` | `DebugSinkState` + `getSinkState()`; separate `fileMinLevel` with `setFileLevel`/`getFileLevel`; non-discarding `flush()` with a settled outcome, a bounded retry set (`PENDING_CAP = 500`) and counted overflow; announce-once-then-count failure reporting on an injected notifier + the ring buffer; once-per-session location statement, re-armed on relocation and on enable; `pushRing`/`pushFile` extracted. |
| `plugin/src/session/log-view.ts` | the level dropdown no longer pushes its level into the logger. Its own display filter unchanged. |
| `plugin/src/ui/settings.ts` | `resolveDebugLogPath()` — the fallback IS `DEFAULT_SETTINGS.debugLogPath`, by reference; placeholder likewise. No path literal left in the file. |
| `plugin/src/main.ts` | **wiring only** — a `(message) => { new Notice(message); }` notifier passed to the `DebugLogger` constructor. |
| `plugin/src/__tests__/v2/wp81/harness.ts` | new — fake adapter that can reject or hold an append open, plus a microtask `settle()`. |
| `plugin/src/__tests__/v2/wp81/test_tp01…tp06…test.ts` | new — 32 tests, one file per AC. |

**Not touched:** `plugin/src/types.ts`, `plugin/src/testing/e2e-control.ts`, `server/**`,
`canvas-binding.ts`, `canvas-model-bridge.ts`, `files/manifest.ts`, `plugin/manifest.json`,
`BUILD_SPEC_CanvasV2.md`, `debug-logger.test.ts`, `types.test.ts`.
