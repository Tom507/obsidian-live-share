# ImplementationReport WP114 — S147, sync that depends on a timer being punctual

**Signal:** S147 (P0) · **Branch:** `fix-bugs-and-raceconditions` · **Base:** `12426d2`
(`b29fa5d`, a Dispatcher docs-only commit, landed in the tree mid-run; it touches no plugin source)
**Commit:** `0be2227` · **Gate:** `3074/3074` tests, `412/412` files, `tsc` exit 0,
`check_signal_register.py` exit 0

---

## 0. The answer in one paragraph

**The guest's subscribe was not scheduled by anything exotic. It was scheduled by a `for` loop, and the
loop's cost per path was a FIXED COUNT OF TIMER HOPS.** `BackgroundSync.subscribe()`'s guest arm waited for
the host's seed with `for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 100))` — nominally
2 s, actually **20 × the clamp**: 18 s after a minute hidden, 180 s after ten, growing without bound. And
every caller of it iterates announced paths **serially and awaits each one** — `startAll`, and
`main.ts::processManifestChange`'s `actuallyAdded` loop, which itself sits on the single
`manifestHandlerQueue`. So the settle of one path was paid **before the next path's document was created at
all**. That product is the live signature exactly: the stalled path has a `Y.Doc`, and **every path
announced behind it has none** — `docExists: false`, `synced: null`, `resolution: null`. The charter is
right that the failure is *before* the subscribe body, and it is before it **for the victims**: `getDoc` is
`subscribe()`'s first statement, and `subscribe()` had not been called for them yet.

---

## 1. AC1 — the mechanism, with lines

### 1.1 The two lines, as they stood

| # | file:line (pre-fix) | what it is |
|---|---|---|
| **A** | `plugin/src/files/background-sync.ts:236-241` | `for (let i = 0; i < 20; i++) { await new Promise((resolve) => setTimeout(resolve, 100)); … }` — the guest's wait for the host's seed. A **poll** for a fact that arrives as a **message**. |
| **B1** | `plugin/src/files/background-sync.ts:138-147` | `startAll` — `for (const [path, entry] of entries) { … await this.subscribe(path); }` |
| **B2** | `plugin/src/main.ts:1214-1218` | `for (const path of actuallyAdded) { if (isTextFile(path)) await this.backgroundSync.onFileAdded(path); }`, inside the handler queued on `main.ts:1036` (`this.manifestHandlerQueue = this.manifestHandlerQueue.then(...)`). |

**A alone is a slow file. B alone is a slow pass. A × B is `docExists: false`, forever.**

The full guest-side chain for a note the host makes mid-session, for the record, because no document in this
run had written it down:

```text
host  vault "create"  → vault-events.ts:169
      └── vault-events.ts:191  backgroundSync.onFileAdded(path)      ← seeds the doc
      └── vault-events.ts:194  manifestManager.updateFile(file, ...) ← publishes the entry
guest __manifest__ Y.Map update arrives over the mux (a MESSAGE — never throttled)
      └── manifest.ts:783      the Y.Map observer fires synchronously
      └── main.ts:1036         queued on manifestHandlerQueue  ← SERIAL, one pass at a time
      └── main.ts:1081         processManifestChange
      └── main.ts:1207         syncFromManifest({skipText:true})  ← text files are SKIPPED here
      └── main.ts:1214         for (…) await backgroundSync.onFileAdded(path)   ← B2
      └── background-sync.ts:322 onFileAdded → subscribe()
      └── background-sync.ts:166 syncManager.getDoc(path)   ← THE ONLY DOOR that creates the Y.Doc
```

`syncFromManifest` skips text files under `skipText` (`manifest.ts:636`), so for an ordinary `.md` that
nobody opens, **`subscribe()` is the only production site that ever calls `getDoc`**. If the loop has not
reached the path, `docExists` is `false` and stays `false`. Opening the note takes an entirely different
route (`collab.ts::activateForFile`), which is why WP111's P1 cells — where every note was opened —
converged on all three peers in the same throttled session in which P2a's unopened notes did not. That
control was already in the validation report; this is its mechanism.

### 1.2 Why a path stalls at all — and it is not an edge case

Three ordinary ways the guest reaches the wait with an empty document:

1. **The host has not subscribed the path yet.** The relay answers `MUX_SUBSCRIBED` with `peerCount 0`,
   `handleSubscribed` sets `NO_PEERS` (`sync.ts:1024`), the text is empty, and the guest waits. This is
   `S131`'s cliff in its most common form.
2. **The note is EMPTY on the host.** `applyMinimalYTextUpdate` returns immediately when the content is
   unchanged (`utils.ts:77`), so seeding `""` is a no-op and the document is empty **forever**. The guest
   pays the full poll for that path on **every pass, for the life of the session**. `S119` left **eighteen
   zero-byte `.md` files in one live vault** — eighteen full polls, serialised, ahead of anything else the
   session wanted to do.
3. **A peer that is not the host answers first.** `PEER_STATE` from another guest whose copy is also empty.

### 1.3 Ranking, as AC1 asks

| rank | mechanism | produces `docExists: false`? |
|---|---|---|
| **1** | **B (serial settle in front of document creation)** | **Yes, directly.** This is the one that makes a path invisible rather than merely late. |
| **2** | **A (fixed hop count × clamp)** | Only via B — but A is what makes B's per-path cost unbounded, so without A, B is a 2 s nuisance and with A it is a permanent one. |
| 3 | `attachObserver` as the **last** statement of `subscribe()` | Produces `observers: false` with the document present. This is `S143`'s surface, and it is what the *stalled* path itself reads. It is **not** what the orphans read. |
| 4 | `waitForSync`'s 10 s timeout (`sync.ts:510`) | A duration on the blocking path. Under a clamp it is minutes, and its `catch { return; }` then abandoned the path with no observer and no retry. It is why the link-break arm never recovered. |

### 1.4 A correction to the charter, and one to the record

- **§2's leads were leads, and three of the four do not apply.** There is no `requestIdleCallback`, no
  `requestAnimationFrame` and nothing keyed on `visibilitychange` anywhere in `plugin/src`. There is no
  ordering assumption between two timers on this path. The census of fixed durations *was* the productive
  lead, but the constant that matters is not a timeout at all — it is a **hop count**, and a hop count is
  invisible to a census that greps for durations.
- **The live `docExists: false` on peer C in arm 2b is explained, and it is not a link-break effect.**
  C was never silenced, and `haltSharing` (`main.ts:770`) releases no documents — nothing on the break path
  releases a `Y.Doc` at all. C's reading is arm 2a's state still standing: the guest's pass was still stuck
  behind a path from earlier in the session. The validation report flagged the C reading as the surprise; it
  is the same mechanism, and it is the strongest single piece of evidence for it.
- **`S143` was refuted as *the live mechanism* and is now also partly repaired** as a side effect of AC4's
  requirement (§4). I allocate no signal for that; the register's `S143` row can be amended by the
  Dispatcher.

---

## 2. AC2 — the throttled-timer facility

`plugin/src/__tests__/support/timer-clamp.ts` (266 lines, no `*.test.ts` suffix so vitest does not collect
it). Self-test and positive controls: `plugin/src/__tests__/v2/wp114/test_ac2_the_clamp_facility.test.ts`.

### 2.1 What it does

```ts
await underTimerClamp({ floorMs: 907, growthPerFireMs: 200, jitterMs: 40, seed: 7 }, async (clamp) => {
  …drive the real objects…
  clamp.assertClamped(1, /background-sync\.ts/);   // Rule 15 — prove the instrument first
});
```

| knob | models |
|---|---|
| `floorMs` | Chromium's nested-timer clamp. Every in-scope `setTimeout`/`setInterval` delay is raised to at least this. Delays already above the floor are untouched, so a 15 s heartbeat is not silently rewritten. |
| `growthPerFireMs` / `maxFloorMs` | **the clamp GROWS.** This is the knob that makes "use a longer timeout" fail in a test rather than in a user's vault. |
| `jitterMs` / `seed` | ordering perturbation. Under a uniform floor two timers armed 50 ms apart land in the same tick; code that is correct only because A's delay is shorter than B's is broken there and reads as correct. Seeded, so a failure is reproducible. |
| `scope` | **the call-site filter, and it is not optional.** The patch is on the global, so an unscoped clamp would throttle vitest's scheduler, undici's WebSocket internals and the in-process relay — the test would measure the harness. Every arm is attributed to its caller from a captured stack and clamped only if that frame matches. Default: the plugin's production source. |

**It deliberately does not touch microtasks, promise resolution or socket delivery.** Chromium does not
throttle inbound frames, and *that asymmetry is the defect class*: message-driven work keeps running while
timer-driven work stops. A facility that slowed both would hide what it exists to show. There is an
assertion for this, not a note.

### 2.2 How a later package uses it

```ts
import { underTimerClamp } from "../../support/timer-clamp";
```

Three rules, all enforced by the facility itself:

1. **Always through `underTimerClamp`.** It uninstalls on a throw; a leaked clamp poisons every later file in
   the same vitest worker.
2. **Prove it was live before reading anything from the window.** `clamp.assertClamped(minimum, sitePattern)`
   throws `DEAD INSTRUMENT` when nothing was clamped, or when nothing matching `sitePattern` was. `stats()`
   returns a per-call-site breakdown (`site`, `count`, `maxRequestedMs`, `maxAppliedMs`) so a scoping mistake
   is visible rather than silent.
3. **Assert on the RATIO, not on a wall-clock band.** `S74` is a live example of the alternative. Every
   timing row in this package is a ceiling derived from the clamp floor or from the product's own budget.

**A note for whoever writes the next one.** After a repair of this class, the honest liveness proof is
*not* "the subject's own timer was clamped" — a repaired path arms no clampable timer, so demanding one pins
the defect as the specification. `test_s147_…`'s `proveClampIsLive` arms a probe from the **test file**
instead, and separately asserts that no `background-sync.ts` call site was clamped at all. Copy that shape.

### 2.3 Proved able to fail, before it was trusted

Break rows T11–T13 (§6) remove the floor, the dead-instrument guard and the scope filter in turn; each
reddens, and T11 reddens the product rows too. The suite's own first row is the positive control the
charter asks for: **the same scenario, same budget, same call — passes with punctual timers, fails under the
clamp.**

---

## 3. AC3 — the repair

`background-sync.ts`, `main.ts`, `sync.ts`. **Nothing here lengthens a timeout.** Five changes:

### R1 — the seed wait is event-driven (`background-sync.ts:429`, `awaitSeed`)

The twenty hops are gone. The wait now races the **arrival itself** — a `Y.Text` observer that fires on the
mux frame carrying the host's seed — against **one** timer holding the same 2 s budget. In the ordinary case
no timer is consulted at all, so the clamp cannot touch it. `background-sync.ts:363-364`.

It is also **wakeable**: `cancelSubscribe`, `onFileRemoved`, `onFileRenamed` and `destroy` all release
parked waiters (`wakeSeedWaiters`, `:232`), because a wait that can only be ended by a timer is a wait whose
length the platform decides.

*Correction, disclosed:* the first version of `awaitSeed` re-armed its timer against the wall clock on every
fire. Under a floor-only clamp a timer can only fire **late**, never early, so that branch was unreachable
by any test this facility can build — `S101`'s own rule — and it was removed in favour of one timer armed
once from the deadline. The "deadline not duration" property is real but it lives in the **budget covering
the whole wait rather than each hop of it**, not in a re-arm loop.

### R2 — a question already answered is not asked again (`background-sync.ts:363`)

`subscribe()` now reads `waitForSync`'s resolution instead of discarding it. `PEER_STATE` means a peer
replied and its state was applied, so an empty text after that is the peer's actual content, not an absence
in flight — **the wait is skipped entirely.** `NO_PEERS` / `ALREADY_SYNCED` / unknown still wait, because
those really can be seeded a moment later. This is the first consumer of `S128`'s resolution API for a
*wait* rather than for a write, and it is what collapses the empty-note case from 2 s per note per pass to
zero.

### R3 — subscription is observation (`background-sync.ts:276`)

`attachObserver` moved from the **last** statement of `subscribe()` to immediately after `getDoc`, before
`waitForSync` and before both role arms. Hearing a document's remote deltas does not depend on the initial
sync having completed, and WP42's replay gate already guarantees the doc is never observed half-replayed.
The arms below are now what they always were — a one-off reconciliation of what was on disk when we arrived
— and anything that arrives afterwards reaches disk through `scheduleDiskWrite`. **The file converges by the
CRDT rather than by `subscribe()` having been quick enough.** It cannot echo this peer's own work: the
observer returns immediately for `transaction.local`, which is what the host's seed is.

### R4 — every announced path gets its document first (`background-sync.ts:208` / `:175`, `main.ts:1225`)

`registerAnnounced(paths)` is synchronous, consults no timer, and does exactly what `subscribe()`'s first
statement does — only where a neighbour cannot prevent it. It restates the three filters its callers already
apply (`isPathSafe`, `isTextFile`, `skipsAutoTextSync`) rather than trusting them, so no `.canvas` or
sidecar path acquires a raw `Y.Text`. The settle loops below it are otherwise byte-unchanged.

### R5 — an idempotent re-assert on re-arm (`sync.ts:334`)

`SyncManager.rearm()` re-sends `MUX_SUBSCRIBE` for every held document when the socket is open. `ws.onopen`
already does this after a socket **drop**; an outage that never closes the socket leaves the relay believing
this client subscribed to nothing, and `onopen` never fires again to correct it. There is no event to hang
that on and no deadline that helps, so this is AC3's third clause — an idempotent retry on the one gesture
that means "try again" (`rearmSharing`, and the rig's `restoreLink`). Idempotent on both sides: the relay's
`state.clients` is a `Set`; the peer count it answers with already includes this client, so it cannot
manufacture a spurious `NO_PEERS`; and the replay it re-sends is Yjs updates. `synced` is deliberately not
reset — unlike `onopen`, nothing became unknown.

### Measured effect (real relay, real peers, clamp floor 150 ms)

| scenario | before | after |
|---|---|---|
| a path announced behind a stalled one has a document | **never** | **immediately** |
| the wait for a seed that then arrives | 6 376 ms | **< 1 000 ms**, on the arrival |
| a note that is EMPTY on the host | 9 325 ms | **< 210 ms** (the wait is not entered) |
| a clamped guest after a link break + restore | **never in 30 s** | **< 8 s**, disk included |

---

## 4. AC4 — recovery, and the second S147 mechanism nobody had named

**The live CLEAN arm's "+10 s recovery" was the pong watchdog, and that is why the REAL arm had none.**
`startHeartbeat` is a `setInterval(15 000)` which arms a `setTimeout(10 000)` pong deadline
(`sync.ts:899-915`); when it expires the socket is force-closed, the reconnect chain runs, and `ws.onopen`
re-subscribes every held document. That is ~25 s of **pure timer** — the last thing that will help in a
window that has been hidden for ten minutes. It is a genuine second S147 mechanism, it is recorded rather
than repaired (a half-dead-socket detector fundamentally needs a timer), and the AC4 test asserts inside an
8 s window specifically so the watchdog cannot silently be the thing under test.

What makes recovery work now, in order: the document **exists** (R4) and is **observed** (R3) even though
the link carried nothing, so `onopen`'s re-subscribe has something to re-subscribe and the arriving state
has somewhere to land; and `restoreLink` **says** how many subscribes it re-asserted (`resubscribed`)
instead of leaving it to be inferred from a later arrival — `S152`'s lesson.

**I11 held throughout.** Nothing in this repair writes a file. The seeding decision, the
`yTextHeldContent` tombstone gate and the `decideEmptyWrite` floors are byte-unchanged and still stand in
front of every write; R3 only means they are consulted from the observer as well as from the arm. The AC5
rows drive both shapes and T10 reddens them.

---

## 5. AC5 — what was NOT reopened

| risk | how it is held |
|---|---|
| `S134` — seeding over a document the editor owns | The host arm is untouched. `isActive` + `yTextHeldContent` still decide it. Break **T10** reddens both this package's row and WP109's own. |
| `S143` — a permanent silent give-up | Partly *closed* by R3: four of its five early returns can no longer produce `observers: false`. The `!docHandle` return still can, and that is stated, not hidden. |
| resurrecting an emptied note | Same gate, same test, plus a dedicated row here. |
| retrying a **deliberate** cancellation | `cancelSubscribe` now *wakes* the waiter so a cancel is acted on promptly under a clamp — it does not turn it into a completion. Because the observer is attached earlier, the `finally` at `:387` **detaches** it on a cancelled subscribe, so a refusal leaves nothing behind. Break **T9** reddens. |
| a burst of subscribes tripping a rate limit | Checked, not assumed: the rate limit is on the **control** channel (`server/src/control-handler.ts:43-44`). `ws-handler.ts` (the mux, which carries `MUX_SUBSCRIBE`) has none. |

---

## 6. AC6 — the break table

`workflowArtifacts/canvas-v2/wp114_break_table.py`. Copy-aside, exact string replacement, restore in a
`finally`, sha256 equality, `^\s*[x×]` anchored parser. **14 rows; 13 red for the stated reason; the
negative control green; every restore byte-identical; zero `.pre-v2-smoke` leftovers; final green check
98/98.**

| id | break | RED |
|---|---|---|
| T1 | restore the twenty-hop poll (the shipped code, verbatim) | THE SIGNATURE |
| T2 | `startAll` loses phase 1 | THE SIGNATURE |
| T3 | the manifest arm loses phase 1 | the `main.ts` wiring row |
| T4 | `attachObserver` back to the tail | AC4 recovery |
| T5 | the budget ×20 — *"a longer timeout"* | 11 rows, incl. the whole of `background-sync.test.ts` |
| T6 | the arrival stops ending the wait | AC3 event |
| T7 | `PEER_STATE` no longer short-circuits | the ARM SPLIT control |
| T8 | `rearm` stops re-asserting | AC4 recovery |
| T9 | a cancellation no longer detaches | AC5 cancellation |
| T10 | the tombstone gate | AC5 seed **and WP109's own row** |
| T11 | the clamp's floor | 9 rows — 5 facility, 4 product |
| T12 | the dead-instrument guard | the facility's own control |
| T13 | the scope filter | 2 facility rows |
| T14 | **negative control** — a comment reworded | **nothing, correctly** |

**Four rows reddened nothing on the first pass (T2, T5, T6, T8) and I did not report around them.** Each
was a test that could not see its subject, and each was corrected:

- T2/T6/T8 all had the same defect: the rig's guest manifest held three paths, so the row measured
  whichever path happened to park first rather than the one it named. Fixed by scoping each row's manifest
  to the path under test, and by starting the clock **at the park** rather than at rig set-up.
- T8 additionally needed the restore to happen **before** the ~25 s pong watchdog could rescue it — which is
  how §4's second mechanism was found.
- T5's original break (removing the deadline re-arm) reddened nothing because a floor-only clamp cannot make
  a timer fire early. That was a fact about the **code**, not about the test, and the unreachable branch was
  deleted (§3 R1). T5 now breaks the thing the charter actually forbids.

---

## 7. AC7 — the gate, bracketed

```text
BEFORE (12426d2, quiet tree, my own measurement)
  Test Files  410 passed (410)
  Tests       3057 passed (3057)          — matches the Dispatcher's baseline exactly

AFTER (0be2227)
  Test Files  412 passed (412)
  Tests       3074 passed (3074)          — +17, all in v2/wp114/
  tsc --noEmit -p tsconfig.json           — exit 0
  check_signal_register.py                — exit 0, "clean - no NEW violations"
  *.pre-v2-smoke leftovers                — 0
```

**One real failure was met and it was not flaky.** `v2/wp83/test_wp83_tp02_callsite_coherence_visible`
reddened the moment `registerAnnounced` became a new production call site of `skipsAutoTextSync`: the
census requires the documented call-site block in `utils.ts` to name the module **and the function**. The
block was amended (`utils.ts:275`). The census worked exactly as designed and is the reason this repair's
new door is documented at all.

**A second real failure, and it is a finding about our instruments, not about this repair.**
`v2/wp92/test_tp06_no_collateral_visible` asserts `plugin/src/utils.ts` is not in its change set — and its
change set is `WP92's own commit ∪ git diff --name-only HEAD`, i.e. **the entire uncommitted working tree**.
So *any* later worker's uncommitted `utils.ts` edit reddens WP92. It went green when I committed, which
means the figure was a function of whether I had committed yet. That is `S88`/`S100`'s family — a census over
a moving tree — and the file's own comment eleven lines above already prescribes the remedy it does not
apply to this one line: **attribution, not absence** (does an ADDED line carry a WP92 marker?), exactly as
the loop above it does for six other files. **I did not change another package's test.** Recorded for the
Dispatcher.

---

## 8. What I rejected, and why

| rejected | why |
|---|---|
| **Lengthening the 2 s budget / the 10 s `waitForSync` timeout** | The charter forbids it and the measurement proves it: the clamp reached 9 004 ms per hop and a nominal `setTimeout(1000)` fired at 27 844 ms, and it grows with time hidden. There is no number. Break T5 exists so a future package cannot quietly take this route. |
| **Settling the announced batch with `Promise.all`** | It makes the cost the max instead of the sum, which is attractive — and it also makes a 1 000-file vault issue 1 000 concurrent `vault.read`s. Phase-1 registration gets the property that matters (`docExists`) at zero concurrency cost, so the settle stays serial. |
| **Dropping the guest's seed wait entirely** | The floors would have held (an unseeded doc has no tombstones, so the empty write is refused), but it changes the contract every existing caller of `subscribe()` relies on — *"after this resolves, the guest has the host's bytes"* — and several suites assert it directly. Bounded and event-driven, not removed. |
| **Making `waitForSync`'s timeout deadline-shaped** | It is the right shape and it is a `sync.ts` API change affecting all six consumers. R3 removes its power to decide whether a file is subscribed, which is what AC4 needed. Left as a residual rather than taken unasked. |
| **Fixing the pong watchdog's ~25 s of timer** | A half-dead-socket detector needs a timer; there is no event that means "nothing is arriving". R5 gives the user a working manual lever instead. Recorded in §4. |
| **Amending WP92's `utils.ts` assertion** | It is another package's pin, it guards a genuinely high-blast-radius file, and rewriting a predecessor's test to make my own run green is precisely the move this project keeps filing as a defect. Reported instead. |
| **Allocating a signal for the pong-watchdog mechanism or for the WP92 census** | Not mine to allocate. Described in prose. |

---

## 9. Residuals I am deliberately leaving

1. **`waitForSync`'s 10 s timeout is still a duration on the blocking path** (`sync.ts:510`). Under a clamp
   the guest's bring-up pass can still sit on it for minutes. It no longer decides whether a file is
   subscribed (R3) or whether its document exists (R4), so the user-visible consequence is a slow pass
   rather than a dead one — but the pass is still serial and still O(N × clamp) in the worst case.
2. **The pong watchdog is ~25 s of pure timer** (§4). It is the only automatic recovery from a link that
   goes half-dead without closing, and it is the slowest thing on the recovery path in exactly the
   conditions where recovery is needed.
3. **`subscribe()`'s `if (!docHandle) return;` can still leave a path unsubscribed with no retry.**
   `getDoc` returns `null` when the manager is neither connected nor trying (`sync.ts:383`) — which is the
   state `haltSharing` leaves after the mux exhausts its ceiling. A file announced in that window is
   permanently unsubscribed until the user re-arms. This is the last surviving limb of `S143`'s shape and
   the one R3 does not reach.
4. **`startAll`'s settle loop and `processManifestChange`'s are still serial.** Deliberate (see §8), but it
   means a vault with many empty or unseeded notes still has a slow bring-up under a clamp — bounded now,
   at roughly the seed budget per such note.
5. **The clamp facility models a FLOOR, not Chromium.** It does not model timer coalescing, the exact growth
   curve, or the interaction with `requestAnimationFrame` (which this plugin does not use). Its numbers are
   a lower bound on the throttling, exactly as WP111's live probe was.
6. **`registerAnnounced` is verified in `main.ts` by a source read**, not by driving the plugin. Labelled as
   a wiring check in the test itself; `S99`'s caveat applies to it.
7. **The `.canvas` paths are untouched by all of this.** `S122`/`S123`'s canvas arms have their own
   scheduler (`armCanvasMirrorPass`, a separate queue) and were not examined. The WP111 host-`.canvas` arm
   difference is not explained by anything here.
8. **Not rebuilt, not deployed, no vault touched.** The build sha every WP111 measurement names is intact.
   **This repair has not been seen live**, and the live re-validation is the thing that should follow it:
   the falsifiable prediction is that under the REAL arm, a burst of mid-session host-created notes now
   reads `docExists: true` and `observers: true` on both guests within the observation window, and that a
   `link.break{shape:"silence"}` + `link.restore` on a guest reports `resubscribed > 0` and delivers a
   subsequent host edit.
