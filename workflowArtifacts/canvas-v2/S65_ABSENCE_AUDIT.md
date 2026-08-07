# S65 — the absence audit

> **Read this beside the historical reports, not instead of them.** Nothing in the corpus has been
> rewritten. This file records what the flush-lag finding does and does not invalidate, and what the
> instrument now does instead.
>
> **Batch:** B49 (Worker 3, execution). **Measured:** 2026-08-06T23:51Z – 2026-08-07T00:20Z UTC, live rig.
> **Product code touched:** none.

---

## 0. The one-line answer

The instrument is condemned; **no landed conclusion falls.** The two claims referred for adjudication
were both re-decided against a now-flushed log and both **survive** — but they survived by luck, not by
method, and one of them was recorded with a positive control it did not have.

The lag is also **not what the finding said it was.** It is not "~58 s". It is **bimodal — 0.50 s or
60.0 s** — and the mechanism is not in the logger at all.

---

## 1. The flush policy, from source and from disk

### 1.1 From source

`plugin/src/debug-logger.ts`. One constant, one timer, no size threshold, no idle flush, nothing
load-dependent:

| | |
|---|---|
| `FLUSH_DELAY_MS` | **500** (`:3`) |
| Trigger | `record()` → `pushFile()` → `scheduleFlush()` (`:268-271`) |
| Timer | `scheduleFlush()` arms a **single** `setTimeout(…, 500)` and is a no-op while one is armed (`:334-340`) |
| Write | `flush()` takes the **entire** buffer as one batch, one `vault.adapter.append`, one write in flight (`:342-363`) |
| Re-arm | success path re-arms if the buffer refilled (`:378`); **the failure path deliberately does not** (`:389`) |

**So the predicted stamp-to-flush lag is 500 ms + the append's own duration**, and the only unbounded
case in the source is a *failing* sink, where lines wait for the next log line to retry them.

### 1.2 From disk

Passive probe (`H:\tmp\s65_flush_probe.py`), both vaults, 0.2 s polling, reading only newly appended
bytes and comparing each line's own stamp against the file's `st_mtime` at the moment the append
landed. `st_mtime` is set by the OS at write time, so this figure carries no polling error.

```
n = 84 batches (vault A 48, vault B 36), 25 minutes
min 0.011 s   median 0.988 s   p90 59.986 s   max 60.823 s

  0.50-0.60 s  (= FLUSH_DELAY_MS exactly)      37   44.0 %
  0.60-1.00 s                                  15   17.9 %
  1.00-2.50 s  (inside the old margin)          6    7.1 %
  2.50-10 s    (OLD MARGIN ALREADY FAILS)       1    1.2 %
  10-40 s                                       3    3.6 %
  40-61 s      (one-minute clamp)              22   26.2 %
```

**The smallest lag measured on the *first* line of a batch was 0.502 s (A) / 0.506 s (B)** —
`FLUSH_DELAY_MS` to the millisecond. (The 0.011 s minimum overall is a *later* line in a batch whose
flush was already armed by an earlier one, which is the same 500 ms timer seen from the other end.)

### 1.3 Do they agree?

**Yes in one regime and no in the other, and that is the finding.**

- Unthrottled, the disk reproduces the source constant exactly: 0.50 s.
- Clamped, the same code path takes **60.0 s ± 0.02 s** — a factor of 120 the source cannot explain,
  because `FLUSH_DELAY_MS` never changes.

**31.0 % of measured batches (26/84) exceeded the 2.5 s margin every reader used.** That is the size
of the defect: roughly one read in three returned zero lines for reasons that had nothing to do with
whether the signature fired.

### 1.4 The mechanism is not in the logger — and it needs a signal number

The lag is not a property of `DebugLogger`. It is the host stretching the timer `DebugLogger` sleeps on.

The proof is in a different module. `SyncManager` pulses awareness on
`setInterval(AWARENESS_TICK_INTERVAL_MS = 4_000)` (`plugin/src/sync/sync.ts:66`, `:859-861`) and logs the
measured gap on **every** pulse (`:920-926`). During the clamped regime the live log reads:

```
AWARENESS GAP: 59998ms since the previous awareness pulse
    (source=tick, warn threshold 20000ms, prune window 30000ms)
```

`source=tick` means it came from the interval timer. **Two independent timers in two independent
modules — a 500 ms `setTimeout` and a 4 000 ms `setInterval` — are simultaneously stretched to exactly
60.00 s.** No I/O explanation covers that. It is a host-level wake-up clamp on the renderer, of the
shape Chromium applies to a hidden or occluded page, and the alignment to a whole minute is its
signature.

**This is a finding well beyond logging, and it is not S65. It needs its own number — I do not allocate
one.** Described for the Dispatcher:

> *Every timer-derived guarantee in the plugin is subject to the same clamp.* `MAX_WAIT_MS = 500`,
> `DISK_WRITE_SETTLE_MS = 250`, the two `VAULT_EVENT_SETTLE_MS = 250` windows of **S68**, `PONG_TIMEOUT_MS`
> and `AWARENESS_OUTDATED_TIMEOUT_MS = 30_000` are all wall-clock promises made with `setTimeout`.
> **The awareness case is already self-refuting in the log:** the prune window is 30 000 ms and the
> measured pulse gap is 60 000 ms, so for half of every minute in this regime a perfectly live peer is
> older than its own prune horizon. The 750 ms arithmetic S68 offers as a falsifiable prediction holds
> only while the renderer is unclamped, and nothing in the rig records which regime a run was in.

Historical incidence, self-recorded by the pulse gaps across the whole retained log
(`H:\tmp\s65_throttle_history.py`, 18 608 / 18 496 pulses):

| band | vault A | vault B |
|---|---|---|
| ≤ 8 s (the designed floor) | 5.6 % | 5.3 % |
| 8–20 s | 93.5 % | 93.8 % |
| 20–40 s | 0.2 % | 0.2 % |
| **40–70 s (clamped)** | **0.7 %** | **0.7 %** |

So the clamp is a **tail regime, not the steady state** — but the tail is fat enough to have been live
during measurements, and **which regime a given past run was in was never recorded.**

---

## 2. The readers — census and repair

### 2.1 Census

Ten offset-based debug-log readers under `H:\tmp`. Every one had the same shape: remember
`stat().st_size`, act, sleep a fixed margin, `seek(offset)`, read, and treat the result as evidence.

| script | helper | margin used |
|---|---|---|
| `liveshare_b41_ladder.py` | `log_since` | `FLUSH_MARGIN_S = 2.0` |
| `liveshare_b41_observe_then_write.py` | `log_since` | `FLUSH_MARGIN_S = 2.0` |
| `liveshare_b41_shapes.py` | `log_since` | fixed sleeps |
| `liveshare_b41_schedule_dependence.py` | `log_since` | fixed sleeps |
| `liveshare_b41_suite_with_receipts.py` | `since` | `FLUSH_MARGIN_S = 2.5` |
| `liveshare_b44_mute_burst.py` | `log_since` | fixed sleeps |
| `liveshare_wp82.py` | `log_delta` | fixed sleeps |
| `liveshare_wp83_e2e.py` | `log_since` | fixed sleeps |
| `liveshare_wp85_e2e.py` | `log_tail` | fixed sleeps |
| `liveshare_wp87_e2e.py` | `log_since` | fixed sleeps |

`workflowArtifacts/canvas-v2/tools/` and `*.py` were swept: `prove_sleep_polls_fail.py`,
`derive_liveness_hangs_py.py`, `check_signal_register.py`, `_run_blind.py`, `_sweep_blind.py` and the
rest read **source and test files**, not runtime logs. None is affected.

### 2.2 The rule encoded

> **An empty read must be indistinguishable from nothing, and may never be reported as "the signature
> did not fire" unless the reader has positively established that the log is flushed past the action.**

**Mechanism: the log's own newest stamp as a flush watermark.** `W := the timestamp of the newest
parseable line on disk`. An absence over `[t_start, t_end]` is admissible only when `W ≥ t_end`.

**Why a watermark and not an injected marker line.** A stamped marker the reader waits for is the
obvious design and it was rejected: the debug log is appended by the plugin through
`vault.adapter.append`, and a second writer appending into the same file races the sink and corrupts
the stream being measured. An externally injected marker is not available without a product change.
The watermark needs no cooperation from anything.

**Why the watermark is sound**, argued from the sink rather than assumed: `record()` appends to
`this.buffer` in call order; `flush()` takes the **entire** buffer as one ordered batch, one write in
flight at a time. So if a line stamped `W` is on disk, every line recorded before it is on disk too —
in the same batch or an earlier one.

**Three holes, guarded rather than assumed away:**

1. **A failing sink can drop lines and still advance `W`.** The error path re-queues at the *front* of
   the buffer and `splice`s the **oldest** away on `PENDING_CAP = 500` overflow
   (`debug-logger.ts:390-395`), so `W` could pass a line that never lands. The reader scans the window
   for WP81's own `LOG SINK: cannot write` announcement and refuses an absence if it is present.
2. **A pattern that cannot match proves nothing** (rule 15). Every signature carries its count over the
   retained history. Zero historical hits yields `UNINFORMATIVE`, never `ABSENT`. This is not
   hypothetical — **`SEED REFUSED:` has 0 occurrences in the entire retained history of both vaults**,
   so any past or future absence claim on that literal is uninformative by construction.
3. **Clock identity.** Log stamps are the plugin's `new Date()`; the watermark is compared against the
   reader's `time.time()`. Both UTC, both assumed the same host clock. Recorded as a decision.

On timeout the reader **raises `FlushNotProven`**. There is no code path that returns a bare empty list.
The timeout default is 180 s, which must exceed *flush lag + the period of the slowest line producer*,
because on an idle rig the watermark only advances when the next awareness pulse lands.

### 2.3 What was changed

- **New:** `tools/e2e/ls_logwait.py` — `LogWaiter` (`mark` / `collect` / `verdict` / `assert_absent`)
  and `wait_for_flush()`, a drop-in for `time.sleep(FLUSH_MARGIN_S)`.
- **Retrofitted:** all ten readers. The guard went **inside** the reader helper rather than at the call
  sites, so a future call site cannot forget it.

### 2.4 The positive controls — each one proves it can see a signature that *did* fire

**Control A — the reader (`python ls_logwait.py selftest`, 17/17):**

| | |
|---|---|
| **P1** | A receipt is emitted behind a 6 s flush lag. **The old `sleep(2.0)` reader misses it; the new reader finds it** (waited 4.0 s, `flush_proven=True`). P1a asserts the old arm *fails* — if it ever starts passing, the control has gone vacuous and the suite says so. |
| **P2** | Nothing is ever written after the action → `FlushNotProven` raised; `verdict()` and `assert_absent()` both refuse. **It never says ABSENT.** |
| **P3** | The signature truly did not fire but an unrelated line advances the watermark → `ABSENT`, admissible. |
| **P4** | `LOG SINK: cannot write` inside the window → `UNINFORMATIVE`, absence refused. |
| **P5** | A signature with zero historical hits → `UNINFORMATIVE`, not `ABSENT`. |
| **P6** | The matcher self-test is itself falsifiable (an empty pattern must fail it). |

*This suite caught two real defects in its own subject during construction* — the watermark guard
initially made `P3` unprovable, and `P1` timed out because no post-action line advanced `W`. Both were
the instrument failing honestly rather than silently, which is the behaviour being bought.

**Control B — the retrofit (`python s65_verify_readers.py`, 10/10):** an AST check that the guard is
called inside the reader helper **and before the `seek`**. Its positive control runs the identical check
against the ten pre-patch backups in `H:\tmp\_s65_backup\` and **requires all ten to fail**; they do.

**Control C — the re-adjudication (`python s65_readjudicate.py`):** before scanning any window for an
absence, the same scanner is pointed at a window where the signature is known to occur and must find
it. `CANVAS WRITE HELD:` → 16 (A) / 19 (B); `SHADOW STALE:` → 2 (A) / 2 (B). Green before any zero is
reported.

---

## 3. The audit

### 3.1 The principle that decides most cases

**S65 corrupts a read taken shortly after an action. It does not corrupt the log's eventual content.**
Two consequences, and they do most of the work:

- **A window containing at least one matched line from the same log is self-proving.** If any receipt
  landed in the window, the sink was flushed for that window, and an absence measured over it is not
  exposed to the flush lag. Call this the *co-located receipt* test.
- **A past window still inside the retained log can be re-decided outright**, because that file is now
  hours or days flushed. This rescues answers; it does not rehabilitate instruments.

### 3.2 SOUND — 6 clusters, 17 recorded sites

| # | claim | why it holds |
|---|---|---|
| 1 | **WP85** — the host writer-attach receipt is ABSENT (`ImplementationReport_WP85.md:116-117`, `:346-348`, `:26-29`, `:165-172`) | the load-bearing read is a **whole-file** scan ("the last `CANVAS WRITER:` line on either vault is from 01:12 / 01:37 — hours earlier"), not a window read; plus an in-run positive control at `:360-364` where node counts go 6/7 → 25/25 in 8 s **with the attach lines quoted**; plus an independent file-content cross-check (`file_len=352`, bytes never arrived in a 30 s budget while the doc converged in 1.0 s) |
| 2 | **WP87** — no `reconcile <path>:` line in the entire window (`:51`), the mount line never emitted (`:94`), AC4 receipt counts (`:219-223`), `DRAG WATCHDOG:` zero (`:230`, `:345`) | **co-located receipts**: the same windows contain matched lines (`CANVAS WRITER: … nodes=2 edges=0` at `09:05:58.301Z`; `detected canvas leaf … viewType=canvas`), so flush is proven for those windows; plus an independent instrument (`canvas.editingSignal`, `hasAdapter=False`, 3/3) and a static trace |
| 3 | **WP81** — `grep -c 'LOG SINK'` = 0 in both vaults (`:177-179`) and the falsification of the reported 23:56 silence (`:13-25`) | the absence follows from the **code**: the installed build is pre-WP81 and has no such emitter. The read is whole-file, and both files are shown being appended to *in the same second* the measurement was taken |
| 4 | **WP82 AC4** — `mux link ` / `control link ` zero in the before-window (`:315-326`) | **the best-controlled absence claim in the corpus.** Explicit control: the same pass finds 117 (A) / 126 (B) `control channel connected` lines in the same before-window. The window is a before/after split at a bundle install — hours of history, not seconds |
| 5 | **WP83** — zero `CANVAS WRITER: <path> … attached` lines for that path (`:42`) | co-located `CANVAS MIRROR:` line quoted from the same log in the adjacent row; cross-checked by the mirror pass's own `skip-local-file` verdict counters and a same-second, same-peer control for the file claim |
| 6 | **WP79** — `materialised=0`, `skipped(local-file)=0` (`:224-252`) | read off **present** receipt lines. A counter read from a line that is there is not an absence claim |

### 3.3 UNSOUND — 3 clusters, 8 recorded sites

> Every one rests on an absence read inside a window shorter than the measured flush lag.

**U1 — the `CANVAS WRITE HELD:` / `SHADOW STALE:` zero-hit result (4 sites).**
`ImplementationReport_B44_ScheduleDependence.md:220-221`, `DISPATCHER_STATE.md:2483-2486`,
`TaskCharter_WP91_TheMuteCannotTellWhoWrote.md:117` and `:245`.
Read by `liveshare_b41_observe_then_write.py` with `FLUSH_MARGIN_S = 2.0` **and** a 3-second
per-rung timestamp band — both far inside the 60 s clamped lag. **Adjudicated in §4.1; the conclusion
survives.**

**U2 — "the debug logger went silent at 2026-08-04T23:56" (3 sites).**
`DISPATCHER_STATE.md:230-232`, `:324-326`, `ImplementationReport_DataLossChain.md:366`.
Already falsified and burned as `S29(logger)` — the file had been moved. **This audit adds a second,
independent reason it was never valid:** the measurement was *"two consecutive 8-second windows, zero
bytes, both vaults"*, and an 8 s window cannot distinguish a dead sink from a clamped one. Had the file
not moved, the same reading would have been produced anyway. That is worth recording, because it means
the claim would have survived the correction that was actually applied.

**U3 — "38 connection lines, newest 2026-08-01; `autoReconnect` never fired" (1 site).**
`DISPATCHER_STATE.md:574-577`. Already falsified and already the origin of rule 15; its primary defect
is a pattern that could not match its target. Listed here because the read was *also* window-scoped and
carried no wait at all — two independent defects in one claim.

### 3.4 UNDECIDABLE — 3 items

**D1 — WP85's RED-band in-run positive control.** The transcript prints `positive control: 0 attach
lines` on **both** RED runs, while the prose at `:143-150` claims the generic needle matched the
*guest's* attach in run 1; `:174-176` records the run-2 guest control as UNAVAILABLE. **A control that
prints 0 is not a control.** The artefact does not record enough to tell whether it ever fired. *The
headline conclusion is unaffected* — it is SOUND via the whole-file scan and the file-content
cross-check (§3.2 row 1) — but this specific control cannot be relied on by a later reader.

**D2 — WP87 R-D's three patterns** (`draining N deferred record(s)`, `EDIT WATCHDOG:`, `DRAG WATCHDOG:`,
`ImplementationReport_WP87.md:52`). Flush is proven for that window by co-located receipts, so **S65
does not reach them**; what is missing is a per-pattern rule-15 control. The artefact does not record
one, and these three literals were not covered by this audit's history census. A residue, not a defect
in the conclusion.

**D3 — the throttle regime of every past run is unrecorded, and is unrecoverable except through the
pulse-gap telltale.** For claims resolved by the co-located-receipt test this does not matter. For any
claim whose only defence is *"we waited 2 s"*, it is undecidable **in principle**: the clamp occupied
0.7 % of pulses overall but is bursty, and nothing in the rig sampled it at measurement time. **No past
claim may be certified sound on the strength of its margin alone.**

### 3.5 Out of scope — 46 claims, unaffected

Forty-six absence claims in the corpus are **static greps over the git tree, the test corpus, charters,
diffs or a built bundle**. They read files nobody is appending to and no flush lag applies. They are
recorded as considered and excluded. The model of the class is
`ImplementationReport_WP87.md:181` — Node `RegExp` over comment-stripped source, four files at 0, two
positive controls above 5.

Three further sites (`ImplementationReport_B44_ScheduleDependence.md:244-247`,
`DISPATCHER_STATE.md:2490-2493`, `SIGNAL_REGISTER.md:106`) are statements *about* S65 rather than
absence claims. They are **corroborated in direction and corrected in magnitude**: the peak is real and
is 60.0 s, but the lag is bimodal rather than a constant, and the mechanism is a host timer clamp
rather than anything in `FLUSH_DELAY_MS`.

---

## 4. The two referred claims

### 4.1 `CANVAS WRITE HELD:` / `SHADOW STALE:` — the WP37 busy-gate clearance

**The Rule 15 control is genuinely not in the artefact, and the report's wording overstates what the
script did.** `ImplementationReport_B44_ScheduleDependence.md:221` says the signatures were *"each
proved matchable against a present line first (Rule 15)"*. The script's rule-15 block
(`liveshare_b41_observe_then_write.py:470-479`) does not do that: it reports **each signature's own hit
count in the window** and prints `<< NO HIT in this window — an absence claim here would be UNSOUND`
when the count is zero. That is a self-referential control — it reports the very zero it is meant to
qualify — and its output for these two signatures appears nowhere in the corpus.

**Re-adjudicated against the now-flushed log.** B44's three ladder runs are dated from their artefacts
(`H:\tmp\b41_observe_004534.json` / `_005427` / `_005542`, written 2026-08-07 00:45–00:59 local, +02:00)
= **2026-08-06 22:45–22:59 UTC**. Scanned with a literal substring, positive control green first:

```
POSITIVE CONTROL   'CANVAS WRITE HELD:'  08-05T09:30..10:20  -> A=16 B=19  OK
                   'SHADOW STALE:'       08-05T09:00..10:00  -> A=2  B=2   OK

WINDOW  2026-08-06T22:40Z .. 23:05Z   (B44's three runs)
  log spans 2026-07-17T17:18Z .. 2026-08-07T00:00Z on both vaults; window covered
  425 (A) / 4390 (B) stamped lines inside the window — the log was demonstrably being written
  'CANVAS WRITE HELD:'  A=0  B=0  -> ABSENT (confirmed)
  'SHADOW STALE:'       A=0  B=0  -> ABSENT (confirmed)
```

The same holds for B41's earlier ladder run `130817` (2026-08-05T11:00–11:35Z): both zero, 658 / 724
lines in the window. Over the **entire** retained history `CANVAS WRITE HELD:` occurs only within
2026-08-05T09:34–10:12Z and `SHADOW STALE:` only within 2026-08-05T01:56–09:43Z; neither is anywhere
near either measurement window.

**Verdict.** The read as taken was **UNSOUND**. The **conclusion is CONFIRMED** — no busy-gate hold was
implicated, and now that is known rather than assumed. **Nothing depends on the log half**:
`TaskCharter_WP91…:245` had already recorded that the conclusion is independently true from the static
trace in its §3, and that note was correct. The corpus caught this itself before this batch existed;
what it could not do was settle it. It is settled now.

### 4.2 Zero-hit claims in WP81 / WP82 / WP85 / WP87

**All four survive, and for four different reasons — none of them "we waited long enough".**

| | verdict | the reason it holds |
|---|---|---|
| **WP81** | **SOUND** | the absence is a consequence of the installed build having no emitter. The log read is corroborating, not load-bearing |
| **WP82** | **SOUND** | a real positive control in the same pass and the same window (117 / 126 matched lines), over a window hours wide |
| **WP85** | **SOUND**, with **D1** flagged | whole-file scan + a genuine in-run control at `:360-364` + a file-content cross-check. Its *RED-band* control is the undecidable part, and it is not what the conclusion rests on |
| **WP87** | **SOUND**, with **D2** flagged | co-located matched receipts prove flush for every window; two independent instruments besides |

**No landed conclusion in any of the four is overturned.**

---

## 5. Stated as undetermined

1. **Whether the clamp is Chromium's hidden-page intensive wake-up throttling specifically.** The
   evidence — two independent timers stretched simultaneously to exactly 60.00 s, aligned to the minute
   — fits it and fits nothing else considered. It was **not confirmed**, because confirming it means
   focusing or hiding the Obsidian window and re-measuring, and the rig is shared with B48. **Not
   taken. Undetermined, not resolved by assumption.**
2. **The unclamped ceiling on the flush lag.** 0.502 s was the floor. The pulse-gap telltale cannot
   resolve a clamp period below about 4 s, so a lag of up to ~4 s is possible in the "healthy" band
   without the telltale showing it. **The 2–2.5 s margin was therefore never *provably* adequate, even
   on a good day** — it was usually lucky. This is why §3.4 D3 refuses to certify any claim on its
   margin alone.
3. **Whether the clamp is load-dependent.** The probe ran on an idle-to-lightly-loaded rig. No
   controlled load sweep was taken; it would have meant driving the E2E suite, which is forbidden here.
4. **Whether any pre-2026-08-04 absence claim is affected.** The retained log carries only 36 lines from
   2026-07-17 and 8 from 2026-08-01. Dense coverage begins 2026-08-04. Windows before that **cannot** be
   re-adjudicated by the §3.1 method, and none in the corpus was found needing it — but that is a
   negative finding about my sweep, not a proof.
5. **`SEED REFUSED:` has never appeared in the retained history of either vault** (0 hits, both files,
   all 7 days). It is watched as a receipt by the b41 suite. Whether it is unreachable, mis-spelled in
   the watcher, or simply never provoked is **not determined here** — but no absence claim on it can be
   admitted until it is.

---

## 6. Files

| path | what |
|---|---|
| `tools/e2e/ls_logwait.py` | the reader — `LogWaiter`, `wait_for_flush`, and the 17-check control suite (`selftest`) |
| `tools/e2e/s65_flush_probe.py` | passive on-disk lag probe |
| `tools/e2e/s65_throttle_history.py` | the pulse-gap telltale over the whole retained log |
| `tools/e2e/s65_readjudicate.py` | re-decides a past window against the flushed log, control-first |
| `tools/e2e/s65_verify_readers.py` | AST check that the guard is before the seek, controlled against the unpatched backups |
| `H:\tmp\_s65_backup\` | the ten pre-patch readers, kept so the control in §2.4 B stays runnable |
