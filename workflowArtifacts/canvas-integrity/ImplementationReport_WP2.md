# ImplementationReport — WP2 — Awareness survival (S2-A)

- **Batch:** B (only member)
- **Owned scope:** `plugin/src/sync/sync.ts` (production), `plugin/src/__tests__/sync.test.ts` (tests)
- **User stories owned:** US4 AC1–AC8, US6 (`AWARENESS GAP:` row only)
- **Structural grounding:** degraded mode (`graphify_enabled: false`, no `graph.json`) — the `file:line`
  anchors in the WP block were the map; all three were re-verified against source before editing.

---

## ACs Satisfied

### US4 (WP2 owns AC1–AC8)

| AC | How verified |
|---|---|
| AC1 — keep-alive no longer depends on a fixed-period timer; driven by an absolute-time deadline (`now - lastPulseAt >= AWARENESS_PULSE_DEADLINE_MS`), evaluated on every tick | Code: `startHeartbeat()` now arms a `AWARENESS_TICK_INTERVAL_MS` (4 000 ms) interval that calls `tickAwarenessKeepAlive("tick")`, which compares the wall clock against `lastPulseAt` instead of pulsing per fire. Test `US4 AC1: a tick before the deadline does not pulse, the tick at the deadline does` — the 4 000 ms tick produces 0 pulses, the tick that lands on the 8 000 ms deadline produces exactly 1. |
| AC2 — the tick is a directly callable method; `pulseAwarenessHeartbeat()` keeps its unconditional behaviour | New public `tickAwarenessKeepAlive(source?)` returns `boolean`. Test `US4 AC2: tickAwarenessKeepAlive is directly callable and pulses once per deadline` — direct call returns `false` before the deadline, `true` at the deadline, `false` immediately after (deadline reset), with exactly 1 pulse logged. `pulseAwarenessHeartbeat()` still pulses on **every** call (see AC5 row below). |
| AC3 — worst-case gap `T + D < 30_000`, with the spec-level claim limited to "a pulse is emitted at the first opportunity after the deadline expires, and the gap is always measured and logged" | Test `US4 AC3: T + D stays under the 30 s prune window and the warn threshold sits below it` asserts `T < D`, `T + D < 30_000`, `AWARENESS_HEARTBEAT_INTERVAL_MS === T + D`, `AWARENESS_GAP_WARN_MS < 30_000`, `AWARENESS_GAP_WARN_MS > T + D`. Arithmetic in *Chosen Constants*. The **structural** claim made in code and here is exactly the AC3-permitted one; the stronger claim is not made. |
| AC4 — an inbound MUX message evaluates the deadline and pulses if expired; deadline expired + no interval tick + one inbound message → exactly one pulse | `handleMessage()` calls `tickAwarenessKeepAlive("message")` for **every** decoded frame, before the type switch. Three tests: `US4 AC4: one inbound MUX message with the deadline expired emits exactly one pulse` (1 pulse log + exactly 1 awareness frame); `US4 AC4: a clock jump plus one inbound message re-emits awareness with no timer firing` (frame-level, uses no new API — this is the behavioural RED, see below); `US4 AC4: an inbound MUX message before the deadline does not pulse` (0 pulses, 0 frames at `D - 1` ms). All three drive the clock with `vi.setSystemTime`, which moves the wall clock **without firing any timer**. |
| AC5 — every pulse logs the measured gap; a gap above `AWARENESS_GAP_WARN_MS` emits a `warn` with a stable greppable prefix naming the gap in ms | `emitAwarenessPulse()` logs exactly one line per pulse: `awareness pulse: gap <n>ms (source=…)` at `debug`, or `AWARENESS GAP: <n>ms since the previous awareness pulse (source=…, warn threshold 20000ms, prune window 30000ms)` at `warn` above the threshold. Asserted in the AC1 test (debug line names `gap 8000ms`, **no** warn) and the AC6 test (warn naming `70000ms`). |
| AC6 — 70 000 ms clock jump with the interval suppressed, then exactly one tick → one pulse **and** one gap `warn` naming ~70 000 ms; confirmed RED against HEAD | Test `US4 AC6: a 70 s clock jump then one tick emits one pulse and one AWARENESS GAP warn`: `vi.setSystemTime(+ (70_000 - T))` (no timer fires) then `vi.advanceTimersByTime(T)` (exactly one tick) → `pulses().length === 1`, `gapWarns().length === 1`, warn message contains `70000ms`, and the re-emitted awareness frames still carry the held `lockedNodes.nodeA`. RED transcript below. |
| AC7 — the pulse is a no-op while the socket is not `OPEN` | The pre-existing guard `if (this.ws?.readyState !== WebSocket.OPEN) return;` is untouched in `pulseAwarenessHeartbeat()`, and the same guard opens `tickAwarenessKeepAlive()`. Test `US4 AC7: neither the deadline tick nor a manual pulse emits while the socket is not OPEN` — with the socket still `CONNECTING` and the clock jumped 70 000 ms, the tick returns `false`, the manual pulse emits nothing, 0 pulse logs and 0 frames. |
| AC8 — no focus / `blur` / `visibilitychange` / `document.hidden` handler | `grep -rniE "visibilitychange\|document\.hidden\|'blur'" plugin/src` → **0 hits** (re-run after the change; recorded in *Quality Gates*). Nothing in this WP subscribes to any window/document event; the two opportunities are a timer and the socket. |

### US6 (WP2 owns the `AWARENESS GAP:` row)

| AC | How verified |
|---|---|
| US6 AC1 — emitted through the existing `DebugLogger` seam, no new logging framework, no new production dependency | New `SyncLogger` interface (`debug`/`warn`) mirrors the existing `CanvasSyncLogger` pattern in `canvas-sync.ts:33-36` and is structurally satisfied by `DebugLogger`. `SyncManager.setLogger()` mirrors `CanvasSync.setLogger()`. Zero new imports, zero new dependencies. **Wiring caveat in *Risk Notes*.** |
| US6 AC2 — fixed uppercase greppable prefix, asserted by at least one test through an injected logger spy | Prefix `AWARENESS GAP:`. `grep -rn "AWARENESS GAP:" plugin/src --include=*.ts \| grep -v __tests__` → one production emitter, `plugin/src/sync/sync.ts:515`. Asserted through the injected `makeLoggerSpy()` in the AC6 test. |
| US6 AC5 — not emitted more than once per occurrence; `AWARENESS GAP:` fires only above `AWARENESS_GAP_WARN_MS` | One log line per pulse, and the `AWARENESS GAP:` branch is exclusive with the debug branch. The AC1 test asserts `gapWarns().length === 0` for a healthy 8 000 ms gap. The deadline itself rate-limits pulses to one per `D`, so the message-driven path cannot flood despite firing on every frame. |
| US6 AC7 — no file contents, node text or user data in the log line | The line carries only integers and the `source` enum (`tick` / `message` / `manual`). No path, no docId, no node id, no state payload. |

---

## ACs Not Satisfied

- **US6 AC6** — "every signature is documented in a table in `ARCHITECTURE.md` § Appendix".
  Not done, **deliberately**: `ARCHITECTURE.md` is outside this WP's writable set (WP block AC7 —
  `plugin/src/sync/sync.ts` is the only production file this WP may change — and the dispatcher's
  hard rule 3). The `AWARENESS GAP:` row still needs appending to that appendix table by whoever owns
  `ARCHITECTURE.md` this round. Everything else about the signature (prefix, emitter, spy assertion) is in place.
- All other owned ACs (US4 AC1–AC8, US6 AC1/AC2/AC5/AC7 for this row): **satisfied**.
- US4 AC9–AC17 are WP3's and were not touched.

---

## RED-First Observations

Achieved by writing the test first and running it **before** any production edit. No `git stash`,
`checkout`, `reset`, `restore`, `commit` or `clean` was run at any point; the working tree's
uncommitted 0.6.0 baseline is intact.

**Command (all runs):**

```
npx vitest run src/__tests__/sync.test.ts     (cwd: …/obsidian-live-share/plugin)
```

### RED run 1 — AC6 + AC4 tests added, `sync.ts` untouched

`Tests  3 failed | 18 passed (21)` — verbatim:

```
 FAIL  src/__tests__/sync.test.ts > SyncManager > US4 AC6: a 70 s clock jump then one tick emits one pulse and one AWARENESS GAP warn
TypeError: sm.setLogger is not a function
 ❯ src/__tests__/sync.test.ts:617:10
    615|       const sm = new SyncManager(makeSettings());
    616|       const logs = makeLoggerSpy();
    617|       sm.setLogger(logs);
       |          ^
    618|       sm.connect();
    619|       const handle = sm.getDoc("notes/test.md")!;
```

The same `TypeError: sm.setLogger is not a function` failed the two AC4 tests
(`sync.test.ts:661:10` and `sync.test.ts:695:10`). At HEAD there is no gap instrumentation seam at
all, therefore no pulse and no `AWARENESS GAP:` line can be produced — but this is a *missing-API*
red, so a second, purely **behavioural** red was added before touching production code.

### RED run 2 — plus a frame-level AC4 test that uses no new API, `sync.ts` still untouched

`Tests  4 failed | 18 passed (22)` — verbatim, the behavioural red:

```
 FAIL  src/__tests__/sync.test.ts > SyncManager > US4 AC4: a clock jump plus one inbound message re-emits awareness with no timer firing
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ src/__tests__/sync.test.ts:714:52
    712|       });
    713|
    714|       expect(awarenessFrames(ws, "notes/test.md")).toHaveLength(1);
       |                                                    ^
    715|
    716|       sm.destroy();
```

That is HEAD's behaviour stated exactly: a suppressed-timer clock jump means the bare
`setInterval` at `sync.ts:380-382` never fires, the inbound frame is not an evaluation opportunity,
and **zero** awareness frames are re-emitted.

### GREEN run — after the `sync.ts` change

```
 ✓ src/__tests__/sync.test.ts (26 tests) 42ms
 Test Files  1 passed (1)
      Tests  26 passed (26)
```

Re-confirmed after a final comment-only tightening: `26 passed (26)`.

**Delta:** `sync.test.ts` 18 → 26 tests (+8), 0 pre-existing tests changed or removed.

*(Note on the test text between RED and GREEN: the RED runs used numeric literals for `T` and `D`
because those constants do not exist at HEAD — importing them would have failed the whole module and
taken the 18 passing tests down with it, destroying the baseline evidence. After the production
change the same tests were re-pointed at the exported `AWARENESS_TICK_INTERVAL_MS` /
`AWARENESS_PULSE_DEADLINE_MS`; the values, the clock manipulation and every assertion are unchanged.)*

---

## Chosen Constants

| Constant | Value | Role |
|---|---|---|
| `AWARENESS_TICK_INTERVAL_MS` | `4_000` | **T** — deadline-evaluation tick period. Fires often, pulses rarely. |
| `AWARENESS_PULSE_DEADLINE_MS` | `8_000` | **D** — absolute deadline; a pulse is due once `now - lastPulseAt >= D`. |
| `AWARENESS_GAP_WARN_MS` | `20_000` | warn threshold for a measured gap. |
| `AWARENESS_HEARTBEAT_INTERVAL_MS` | `12_000` (computed `T + D`) | **unchanged value**, still exported. Re-documented: it is now the worst-case *bound*, not the timer period. |
| `AWARENESS_OUTDATED_TIMEOUT_MS` | `30_000` (module-private) | y-protocols' prune window, named so the log line can quote it. |

**Arithmetic (WP block AC4 / US4 AC3):**

```
T + D            = 4 000 + 8 000 = 12 000 ms
12 000 < 30 000                              ✔  worst-case gap while ticks fire on schedule
AWARENESS_HEARTBEAT_INTERVAL_MS = T + D = 12 000 ms   (previous literal value: 12 000 ms → UNCHANGED)
T + D  <  AWARENESS_GAP_WARN_MS  <  30 000
12 000 <  20 000                 <  30 000   ✔  the warn cannot fire in healthy operation, and
                                                fires with 10 000 ms of headroom before the prune window
```

Rationale for `T = 4 000`: `T < D` means the deadline is always detected within one tick of expiring,
and the effective steady-state cadence (a pulse every `D` = 8 000 ms) is *more* frequent than HEAD's
12 000 ms, so nothing that depended on the old cadence gets slower. Rationale for `D = 8 000`: keeps
`T + D` exactly at the old 12 000 ms bound, so no existing importer's assumption about the cadence
bound changes. Rationale for `AWARENESS_GAP_WARN_MS = 20 000`: strictly above the healthy worst case
(no false positives) and strictly below the 30 s prune window (the warn is on record *before* peers
could have pruned).

---

## Files Changed

```
plugin/
├── src/
│   ├── sync/
│   │   └── sync.ts                 ← production (the ONLY production file changed)
│   └── __tests__/
│       └── sync.test.ts            ← +8 tests, +1 logger-spy helper
└── (nothing else)
```

`git diff --stat` for the two files this WP owns:

```
 plugin/src/__tests__/sync.test.ts | 289 +++++++++++++++++++++++++++++++++++++-
 plugin/src/sync/sync.ts           | 136 ++++++++++++++++--
 2 files changed, 413 insertions(+), 12 deletions(-)
```

**`plugin/src/sync/sync.ts` — what changed**

- New exports: `AWARENESS_TICK_INTERVAL_MS`, `AWARENESS_PULSE_DEADLINE_MS`, `AWARENESS_GAP_WARN_MS`,
  `SyncLogger`, `AwarenessPulseSource`. `AWARENESS_HEARTBEAT_INTERVAL_MS` stays exported at 12 000 ms.
- New private state: `lastPulseAt: number | null`, `logger: SyncLogger | null`.
- New methods: `setLogger()`, public `tickAwarenessKeepAlive(source?): boolean`, private
  `emitAwarenessPulse(now, source)`.
- `startHeartbeat()`: baselines `lastPulseAt`, and the awareness interval now runs at `T` and calls
  the *conditional* tick instead of pulsing unconditionally.
- `stopHeartbeat()`: also clears `lastPulseAt` (both timers are still cleared exactly as before).
- `handleMessage()`: one added line — `this.tickAwarenessKeepAlive("message")` before the type switch.
- `pulseAwarenessHeartbeat()`: same guard, same unconditional contract; body now delegates to
  `emitAwarenessPulse(..., "manual")` so the gap accounting is shared.
- No reformatting of untouched code. No new import. No new dependency.

**Not touched:** `server/`, `docker/`, deploy files, `plugin/manifest.json`, repo-root `manifest.json`,
`plugin/main.js`, `server/dist/`, `plugin/src/main.ts`, `ARCHITECTURE.md`, version (still `0.6.0`),
`useCanvasBinding` (still `false` at `plugin/src/types.ts:65`).

---

## Quality Gates

| Command | Result |
|---|---|
| `npx vitest run src/__tests__/sync.test.ts` | **PASS** — 26 passed (26). Baseline 18 → 26 (+8), 0 regressions. |
| `npx tsc -noEmit -skipLibCheck` | **PASS** — exit 0, no diagnostics. |
| `npx vitest run src/__tests__/wp5/latency.test.ts` (mandatory, protects the unconditional-pulse contract) | **PASS** — 11 passed (11), 39.39 s, including `static caret and idle lock survive a >30 s idle window on the peer` (33 526 ms, real relay, real elapsed time). |
| `npx vitest run` over the six other files that import `sync/sync`: `background-sync` · `manifest` · `regression` · `collab` · `e2e/two-host` · `canvas-sync` | **PASS on five** — background-sync 23, manifest 57, regression 13, collab 14, e2e/two-host 4. **canvas-sync.test.ts: 4 failed / 33** — *not caused by this WP*, see below. |
| `grep -rniE "visibilitychange\|document\.hidden\|'blur'" plugin/src` | **0 hits** (US4 AC8 / Definition of Done). |
| `grep -rn "AWARENESS GAP:" plugin/src --include=*.ts \| grep -v __tests__` | 1 production emitter: `plugin/src/sync/sync.ts:515`. |
| `npx biome check src/sync/sync.ts src/__tests__/sync.test.ts` | **PASS** — `Checked 2 files in 23ms. No fixes applied.` 0 findings on the touched files (gate 3: no increase). |
| `npm run build` / full `npm test` | **NOT RUN — by dispatcher instruction.** The esbuild step writes `plugin/main.js` and three batches are running concurrently. Whole-suite and build gates belong to the merged tree. |

### The four `canvas-sync.test.ts` failures are another batch's in-flight work

Failing: `edge write is denied while a peer holds one of its endpoint nodes (US2 AC1)`,
`does NOT resurrect a remote-deleted EDGE when the local user edits it (US2 AC3)`,
`a denied write does NOT advance lastWrittenContent and stays observable (US2 AC4/AC5)`,
`the tiebreak loser is denied, holds its baseline, reverts once, and lands on the winner's coords`.

Evidence that they are structurally unrelated to WP2:

- `canvas-sync.test.ts` never instantiates the real `SyncManager` — it builds a local
  `createMockSyncManager()` (`canvas-sync.test.ts:31`). No code path of this WP is reachable from it.
- All four names are **US2 lock-seam / `LOCK DENIED:` territory**, i.e. WP4 — a different batch.
- `plugin/src/files/canvas-sync.ts` was being written 4 s before the check (mtime 16:55:14 vs. wall
  clock 16:55:18) while my run was in flight; `canvas-sync.test.ts` mtime 16:53:18.

No remediation attempted (out of scope, and the file belongs to another batch mid-flight). Flagged
for the dispatcher so it is not attributed to WP2.

---

## Phrasing Gate

**No line in this report, in `plugin/src/sync/sync.ts`, or in `plugin/src/__tests__/sync.test.ts`
claims that the S2 decay bug is diagnosed, root-caused or fixed.** S2's cause remains **unproven**
and this WP does not narrow it.

The two claim shapes actually used:

- *Structurally impossible* — precisely and only in the AC3-permitted form: **a pulse is emitted at
  the first opportunity after the deadline expires, and the gap is always measured and logged.**
  What is structurally impossible is the *silent* variant: the keep-alive can no longer skip a
  pulse without that skip being measured, because the trigger is an absolute-time comparison rather
  than a count of timer fires, and because the socket — which is not timer-throttled — is itself an
  evaluation opportunity.
- *Observable in the log* — a keep-alive gap larger than 20 000 ms produces the greppable
  `AWARENESS GAP:` warn naming the gap in ms and the pulse `source`, so the next incident is provable
  from a user's log dump instead of by luck.

Explicitly **not** claimed anywhere: that Chromium timer throttling is the cause of the reported
symptom; that the lock/presence decay is fixed; that this WP makes the symptom go away. The code
comment describing the throttling mechanism is written conditionally ("IF a tick were to slip past
the 30 s outdated-timeout…") and is followed by "No claim is made here about which mechanism causes a
real-world gap". Per the US4 diagnosis boundary, if the symptom still occurs with every AC satisfied,
that is a pass and the instrumentation is the diagnosis path for the follow-up round.

---

## Risk Notes

1. **The logger seam has no production caller yet — the one line that makes `AWARENESS GAP:` visible
   to a real user lives in a file this WP may not touch.** `main.ts` wires
   `this.canvasSync.setLogger(this.logger)` (`plugin/src/main.ts:757`) but nothing calls
   `syncManager.setLogger(...)`. Until someone adds
   `this.syncManager.setLogger(this.logger);` next to `main.ts:757`, the gap is measured and the
   branch is taken, but the warn goes to a `null` logger and never reaches the ring buffer or the log
   file. The production emitter, the prefix and the spy assertion all exist (US6 DoD grep passes);
   only the injection is missing. **This is the one thing in WP2 that a follow-up must finish**, and
   it contradicts the WP's "sync.ts only" scope — see *Contradictions* below.
2. **Diagnostic value of `source=`.** The warn names whether the recovering pulse came from a `tick`
   or a `message`. A gap recovered by `message` is evidence that no tick fired during the window; a
   gap recovered by `tick` is evidence the tick itself was late. This is an observation channel, not
   a conclusion.
3. **A socket outage is deliberately not reported as a gap.** `startHeartbeat()` re-baselines
   `lastPulseAt` and `stopHeartbeat()` nulls it, so a 5-minute disconnect does not produce a
   300 000 ms `AWARENESS GAP:` warn. The metric measures pulse liveness **on an OPEN socket** —
   which is the regime the reported symptom lives in (window unfocused, socket up). Downtime-driven
   pruning is the reconnect path's business (`ws.onopen` → `onReconnectCallback` → clock tick), and
   that path is unchanged. If a future round wants outage gaps surfaced too, it needs a separate
   counter — do not remove the re-baseline, or every reconnect will emit a false warn.
4. **`handleMessage` now does an `O(1)` clock comparison per inbound frame.** On a busy socket that is
   one `Date.now()` and one integer subtraction per message; the pulse itself is deadline-limited to
   one per 8 000 ms, so message volume cannot amplify awareness traffic.
5. **`null` `lastPulseAt` counts as "deadline expired".** If a frame arrives while the socket is OPEN
   but the heartbeat is not running (not reachable today — `stopHeartbeat()` is only called on close
   and disconnect), the first frame pulses. That is the liveness-safe direction, and the first pulse
   after a `null` emits no gap line because there is no previous pulse to measure against.
6. **Stale comment in a file this WP may not edit.** `plugin/src/__tests__/wp5/latency.test.ts:465,496`
   still says "the 12 s awareness heartbeat". It remains *true as a bound* (`T + D = 12 000 ms`) but
   the steady-state cadence is now 8 000 ms. Harmless; worth a sentence when someone next edits that file.
7. **Concurrency.** Two other batches were editing `canvas-adapter.ts` / `canvas-sync.ts` during this
   WP. Only `plugin/src/sync/sync.ts` and `plugin/src/__tests__/sync.test.ts` were written here, so
   there is no file-level conflict; the four `canvas-sync.test.ts` reds above are theirs.

### Contradictions with the BUILD_SPEC

- **US6 AC1/AC6 vs. WP2 AC7.** US6 requires every signature to be emitted *through the `DebugLogger`
  seam* and documented in the `ARCHITECTURE.md` appendix, but WP2 AC7 restricts this WP to
  `plugin/src/sync/sync.ts`. The seam can be *offered* from `sync.ts`; it cannot be *attached*
  (that needs `main.ts`) and the appendix row cannot be written (that needs `ARCHITECTURE.md`).
  Both are left undone on purpose and listed above. Neither is a code defect; both are one-line
  follow-ups for whoever owns those two files this round.
- Nothing else in the WP2 block, US4 AC1–AC8 or the US6 `AWARENESS GAP:` row was found to be wrong:
  all three `file:line` anchors in the WP block matched source exactly (`:380-382` bare interval,
  `:403` `pulseAwarenessHeartbeat`, `:404` OPEN guard), and the y-protocols 30 s / Chromium throttling
  architecture notes are consistent with the observed `_checkInterval` behaviour seen while testing.
