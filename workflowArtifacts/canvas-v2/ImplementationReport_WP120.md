# ImplementationReport — WP120: a presence lock needs a lifetime

**Branch:** `fix-bugs-and-raceconditions` · **Base:** `e974fdd` (clean, quiet tree) · **Worker:** W3, sole worker
**Touched production code:** `plugin/src/canvas/canvas-presence.ts` only.
**Touched tests:** the WP21 digest pin (re-established), one NEW file `v2/wp120/`, and a **comment-only**
edit to WP119's `v2/selmove/` banner (zero assertion lines changed — verified by diff, below).
**Rig:** NOT used. Nothing rebuilt into a vault, redeployed, installed or driven. The three vaults are untouched.
**Signals allocated:** none. Findings are described in §6 and numbered by the Dispatcher.
**`data.json`:** never read, printed, logged or fixtured. No credential value appears in this report or in any test.

---

## 0. Verdict in one line

**The claim now carries where it came from, and only the kind with no gesture to end it can be retired by
idleness.** `LockOrigin` + a private `lockMeta` map beside `lockedNodes` (the awareness wire shape is
byte-identical), an injected clock, and one sweep at the head of the awareness `change` listener —
**before** `reconcileClaims`, which is the load-bearing half. **The pin was re-established at the new
digest, not deleted.**

**WP119's §4 design was recovered, not reinvented, and I agree with all of it.** Four additions, §2.3.

---

## 1. Charter corrections — five, and the first one matters to the Dispatcher

### 1.1 The authorisation is NOT in `BUILD_SPEC`, and `BUILD_SPEC` still forbids this change

The charter §2 cites `BUILD_SPEC` §*"`canvas-presence.ts` — the byte-unchanged pin is LIFTED for one
repair"*. **That section does not exist.** `grep -n "LIFTED\|lifted" BUILD_SPEC_CanvasV2.md` returns four
hits, none of them about this file.

The authorisation is real and I proceeded on it, but it lives in **`DISPATCHER_STATE.md` §5 "Owner
rulings"**, verbatim:

> *"**`canvas-presence.ts`'s byte-unchanged pin is LIFTED for the lock-lifetime repair only.** The pin must
> be **re-established with a new digest, not deleted**."*

**`BUILD_SPEC_CanvasV2.md:2357` is unamended and still reads:**

> `canvas-presence.ts` is modified (WP21 AC2 requires it byte-unchanged) — ESCALATE.

So the tree now contains a §7 **abort criterion that this authorised change violates on its face**. I did
not edit `BUILD_SPEC` — it is the Dispatcher's artefact and quietly amending an abort criterion to fit my
own commit is the shape the whole §7 ledger exists to prevent. **This needs a Dispatcher amendment, and
until it lands the next worker who reads §7 will correctly conclude my commit is an abort.**

### 1.2 A5's stated justification was withdrawn two days ago

The charter's A5 says the `coldOpen` / `doc-wins` path *"destroyed 318 nodes of a real board yesterday"*.
**`DISPATCHER_STATE.md` §6 records that claim as WITHDRAWN**: the board is healthy — 9 nodes, 2 247 B,
identical on all three vaults — and the 327-node snapshot was our own test spam. **The fence is still
right and I honoured it** (nothing here alters how often a canvas file is written); only its stated reason
is stale. Flagged so it is not re-quoted as live evidence a third time.

### 1.3 `emitHeld` is not in `canvas-presence.ts`

The charter's one-sentence defect is correct in substance and the mechanism is worth naming precisely:
`emitHeld` is at **`canvas/canvas-adapter.ts:845`**, and its `held` set is the adapter's, not the
presence controller's. `emitHeld` issues `onNodeInteractionEnd` only for ids it previously added to
`held` (`:851-856`), which happens only via `updateSelection` (`:874`) and `setDragging` (`:893/:896`).
A diff-inferred claim never enters `held`, so **no release is even attempted for it** — that is the leak,
verified against the tree rather than taken from the charter.

### 1.4 Line numbers verified against the tree, both exact

| Charter anchor | Verified | Actual |
|---|---|---|
| `canvas-sync.ts:4130` | ✅ exact | `src/files/canvas-sync.ts:4130` — `if (kind === "node") this.onLocalNodeChange?.(path, id);` |
| `main.ts:2505` | ✅ exact | `setOnLocalNodeChange` opens at `:2504`; the `onDiffInferredChange(nodeId)` call is `:2505` |

Note the charter writes `canvas-sync.ts`; the file is at **`src/files/canvas-sync.ts`**, not `src/canvas/`.

### 1.5 Signal numbering

Brief said next free `S173`; corrected mid-run by the Dispatcher to **`S175`**. <!-- signal-register: meta --> I allocated none and cite
none as mine. The only signal numbers in my prose or in any file I touched are **`S162`** (in the pin's new
comment, as the named shape of "a pin deleted to make a change pass"), and `S146`/`S153` here in prose —
all pre-existing allocations referenced, not claimed.

---

## 2. The repair

### 2.1 What changed, in `canvas-presence.ts` and nowhere else

| Element | What it is |
|---|---|
| `export type LockOrigin = "gesture" \| "inferred"` | provenance. `"gesture"` = the real `emitHeld` seam reported a selection or drag; `"inferred"` = the capture path noticed the diff touched the node |
| `export const INFERRED_LOCK_IDLE_MS = 15_000` | the idle window, **derived** (§2.2) |
| `CanvasPresenceOptions.now?` / `.inferredLockIdleMs?` | injected clock + budget, on the `CanvasAdapterOpts.now` precedent (`canvas-adapter.ts:401-409`). Every release in the suite is asserted by **advancing a number** |
| `private lockMeta: Map<string, {origin, touchedAt}>` | **beside** `lockedNodes`, never inside `LockEntry`, so the awareness field shape peers read is byte-identical (WP27 AC3 pins its six keys; a row of mine re-pins them plus `LockEntry`'s own two) |
| `acquireLock(nodeId, origin = "gesture")` | the default is deliberate: an unqualified acquisition is a real hold, and the safe default is the one that is never expired out from under a user |
| `onDiffInferredChange` | acquires as `"inferred"`; **when already held as `"inferred"`, refreshes `touchedAt`.** This is what makes the window mean *"the user stopped"* rather than *"15 s elapsed"* |
| `expireIdleInferredLocks(): string[]` | the sweep. Skips `"gesture"` **and unknown provenance**; one broadcast per sweep; **none at all when nothing expired** |
| `start()`'s awareness listener | `expireIdleInferredLocks()` → `reconcileClaims()` → `refresh()` |
| `releaseLock` / `reconcileClaims` / `onRemoteNodeDeleted` / `onReconnect` / `destroy` | keep `lockMeta` in step |
| `onReconnect` / `reclaimStillFreeNodes` | **carry the origin across the withhold** (§2.3) |

### 2.2 Why the sweep needs no timer, and why 15 s

**No timer.** A stale claim is inert until the moment it becomes a *contest*, and the event that makes it
one is the awareness `change` this very callback receives. The claim is therefore retired by the same
event that would otherwise have cost the user a card. **Ordering is load-bearing** and is a falsifiable
claim, not a comment: plant **B9** moves the sweep one line down, after `reconcileClaims()`, and A2's
headline row goes red on `expected [ 'n2' ] to deeply equal []` — the revert has already fired.

**15 s, derived rather than picked.** Capture runs on a `DEBOUNCE_MS = 200` trailing debounce capped at
`MAX_WAIT_MS = 500` (`files/canvas-sync.ts:318-319`), so a user still working on a card re-touches its
claim at least twice a second. `INFERRED_LOCK_IDLE_MS` is **30 × the worst-case cap** and comfortably
inside y-protocols' `outdatedTimeout` (30 s), so a claim is retired by its own idleness before the
transport would drop the state carrying it. **The justification is executable**: a row imports
`DEBOUNCE_MS`, `MAX_WAIT_MS` and `outdatedTimeout` from the modules that own them and asserts
`INFERRED_LOCK_IDLE_MS >= 30 * MAX_WAIT_MS` and `< outdatedTimeout`, so it moves if the cadence moves.

### 2.3 Where I extended WP119's design, and why

I agree with WP119 §4 in full. Four additions, all of them A3-protective:

1. **The origin survives a reconnect.** WP119's sketch did not say what `reclaimStillFreeNodes` re-acquires
   with. Left at the default it would re-acquire as `"gesture"` — fine — but re-acquiring the *pending*
   list without its origins loses the distinction either way. I carry `{nodeId, origin}` pairs across the
   withhold. **Without this, a claim the user is physically holding across a blip returns as expirable, and
   A3's failure mode arrives by the back door.**
2. **Unknown provenance never expires.** `if (!meta || meta.origin !== "inferred") continue;` — the
   fall-through is "do not expire", so a bookkeeping gap can only ever cost us the old leak, never a card
   out of a user's hand.
3. **`expireIdleInferredLocks` is public.** It is a fact about the object, not a private detail of one
   listener, and a test must be able to drive it without going through the wire.
4. **One broadcast per sweep, zero when nothing expired.** An idle client must not turn housekeeping into
   an awareness heartbeat of its own. Both halves are pinned (plants B7/B7b).

### 2.4 What I rejected

| Rejected | Why |
|---|---|
| A `setInterval` sweep | needs a timer nobody releases, and buys nothing: the only moment a stale claim can harm is a moment the listener already runs (§2.2). It would also add a timer to the census `S75` counts |
| Putting `origin`/`touchedAt` into `LockEntry` | it is broadcast. WP27 AC3 pins the field shape, peers would carry state they cannot verify, and a peer could forge a `touchedAt`. Plant **B8** shows the row that catches it |
| Expiring `"gesture"` claims too ("simpler, one rule") | it is exactly A3's failure mode. Plant **B3** is this, and it reddens three A3 rows including *"the drag lost its card 15000 ms in"* |
| Stop claiming diff-inferred locks altogether | it is the ONLY acquisition path when the private Canvas API is unavailable (US3 AC2). WP119 rejected it for the same reason; plant **B5** is this and A4's acquisition row catches it |
| Firing `onRevert` for each expired node ("reconcileClaims does, so why not") | housekeeping must never snap a card back. It would turn an expiry into N canvas applies. Plant **B6**; A5's row catches it |
| Editing `BUILD_SPEC` §7's abort criterion so my commit reads as legal | §1.1. That is the Dispatcher's, and quietly amending an abort criterion to fit your own commit is the thing §7 exists to stop |
| Editing `wp5/latency`'s idle-lock row after finding it cannot witness A3 (§6, F1) | another package's test. Reported instead |
| Touching the rig, the vaults or `main.ts` | forbidden / not needed. `main.ts` is byte-unchanged — no new wiring was required |

---

## 3. Break table (Dispatcher Rule 11)

**Method.** Copy-aside to `H:\tmp\wp120\canvas-presence.ts.orig` (deliberately **outside** the repo, so no
plant artefact can ever be committed) → plant → measure → `cp` back → `sha256sum`. **Never `git checkout`,
never `git stash`.** Restore hash, verified after **every** row:
`6223e7c85a1a57b66c87f6ff27c7f71fdb9012423fa38033a0f486cbef76b8bf` (raw bytes, CRLF as checked out).

Measured over `v2/wp120/` + `v2/wp21/test_tp04` + `v2/selmove/` + `v2/wp27/test_tp08` +
`canvas-presence.test.ts` — **56 rows, all green on the unplanted tree.**

| # | AC | Plant | RED — and why that is the right reason | Restored | GREEN |
|---|---|---|---|---|---|
| **B1** | A1, A2 | the sweep call is removed from the `start()` listener — i.e. the exact pre-WP120 shape | **8 product rows + the pin.** `the diff-inferred claim outlived its idle window — the leak is still there`; `the window boundary is not where it says`; `n1 kept a stale ring`; **`B's card was yanked back by a claim it had abandoned — the owner's symptom`** (`['n2']` vs `[]`); and all three A3 vacuity controls (`the clock did not move`, `nothing expired at all in 60 s`, `a refreshed claim became permanent`). This is the defect itself, reproduced | ✅ hash match | 56/56 |
| **B2** | A1 boundary | `cutoff = this.now()` — the idle window becomes zero | **14 product rows + the pin**, headed by `the sweep fired INSIDE the window — it is dropping claims by event, not by idleness`. The positive control is what fails first: A1's release row alone would have passed this build perfectly | ✅ hash match | 56/56 |
| **B3** | **A3 — the charter's mandated plant** | the `origin !== "inferred"` guard is deleted, so a **gesture claim becomes expirable**: an expiry can now fire mid-gesture | **4 product rows + the pin.** `a card the user is HOLDING was handed to someone else — worse than the leak`; **`the drag lost its card 15000 ms in — an expiry fired mid-gesture`**; `the gesture claim expired after all`; `the surviving gesture claim is not on the wire`. Exactly the failure mode this package can introduce, caught at 15 s of a 60 s drag | ✅ hash match | 56/56 |
| **B4** | A3 refresh | the `touchedAt` refresh in `onDiffInferredChange` is removed (back to the plain early return) | **1 product row + the pin:** `active work lost its claim after 15000 ms`. A user typing continuously loses the card at exactly one window. Nothing else moves — correctly, because every other row idles | ✅ hash match | 56/56 |
| **B5** | A4 | `onDiffInferredChange` returns immediately — the *"just stop claiming"* non-fix, which passes "no stale claims" trivially | **14 product rows + the pin**, the discriminating one being `the diff-inferred acquisition path is gone — peers without the private API now have no per-card presence at all`, plus `the loser-revert stopped firing — this build would pass A1 and A2 and be broken` | ✅ hash match | 56/56 |
| **B6** | A5 | the sweep calls `this.onRevert?.(nodeId)` per expired node | **2 product rows + the pin:** `the sweep routed into onRevert -> revertCanvasNode: an expiry became three canvas applies nobody asked for` (`['n1','n2','n3']` vs `[]`), and A2's headline, because housekeeping now *is* the owner's symptom | ✅ hash match | 56/56 |
| **B7** | A5 emit | `emitLocalState()` moved **inside** the sweep loop | **1 product row + the pin — BUT NOT THE ROW I AIMED AT.** It reddened on the return value (`['n1']` vs `['n1','n2','n3']`), not on the emit count: the mid-loop emit re-enters the listener, the re-entrant sweep takes n2/n3, and the outer call reports one. Honest note — this plant proves the sweep is re-entrancy-sensitive, not that the emit count is pinned. **B7b was added because of it** | ✅ hash match | 56/56 |
| **B7b** | A5 emit | `if (expired.length > 0)` dropped — the sweep broadcasts on every awareness change | **17 product rows + the pin**, headed by the row I aimed at: `an idle client turned the sweep into an awareness heartbeat of its own` (`expected 1 to be +0`). The other 16 are the storm that follows | ✅ hash match | 56/56 |
| **B8** | A5 wire | `origin` + `touchedAt` added to `LockEntry`, i.e. onto the awareness wire | **1 product row + the pin:** `the idle clock is being broadcast`. ⚠ note WP27's own `test_tp08` stayed **green** — it pins the six *top-level* keys and says nothing about `LockEntry`'s. My row is what discriminates | ✅ hash match | 56/56 |
| **B9** | A2 ordering | the sweep moved **after** `reconcileClaims()` — one line down | **1 product row + the pin:** `B's card was yanked back by a claim it had abandoned — the owner's symptom`. The tightest plant in the table: one statement moved, one row red, and it is the owner's own criterion. ⚠ note the pin caught this on the **SHA** and not the size — the file is byte-length identical — which is why the pin has both halves | ✅ hash match | 56/56 |
| **B10** | the pin itself | `15_000` → `15000`. One byte, zero behaviour change | **the pin alone**, on size: `expected 29830 to be 29831`. The re-established pin still guards | ✅ hash match | 56/56 |

**A break that reddened NOTHING — reported, not cleaned up:**

| # | AC | Plant | What stayed green, and why |
|---|---|---|---|
| **B3 × `wp5/latency`** | A3 | same plant as B3 (gesture claims expirable), run against `wp5/latency.test.ts`'s **real-clock** row *"static caret and idle lock survive a >30 s idle window on the peer"* — 33.5 s of genuine wall clock over a real lock | **GREEN. 11/11.** See §6 **F1** — this is a finding, and it is the reason my A3 rows drive a peer's awareness churn instead of only advancing a clock |

`find .. -name "*.pre-v2-smoke" -o -name "*.orig" -o -name "*.bak.wp120" | grep -v node_modules` → **0**.

---

## 4. Demonstrated vs argued — stated separately (§3.7)

### Demonstrated

| Claim | How |
|---|---|
| **A1** a capture-made claim is released with **no gesture, no restart, no teardown** | 3 rows. The only thing that happens between "held" and "released" is `clock.t += INFERRED_LOCK_IDLE_MS` and a *peer's* cursor move over a real awareness update. Falsified by B1, B2 |
| **A1 boundary** the release is by idleness, not by event | the ±1 ms positive control: still held at `window − 1` over five churns, gone at `window`. Falsified by B2 |
| **A2** self-healing, the owner's criterion | a peer holding all three cards for 20 s does **not** revert when the lower-id peer picks one up, and clears its own board. Falsified by B1, B6, B9 |
| **A2 is not "reverts stopped"** | the paired fresh-contest row still reverts, `['n2']`, with `n1`/`n3` untouched. This is WP119 plant B3's shape at this layer. Falsified by B2, B5 |
| **A3** a gesture claim survives ten idle windows and a 60 s drag; the drag END still releases it | 3 rows, each with an inferred claim on the **same clock** that does *not* survive, so a frozen clock cannot pass. **Falsified by B3 — the charter's mandated mid-gesture plant** |
| **A3** continuing work refreshes indefinitely, and stopping expires | 120 iterations at the real `MAX_WAIT_MS` cadence, then one window of silence. Falsified by B4 |
| **A3** the window is derived from the capture cadence | `DEBOUNCE_MS`/`MAX_WAIT_MS`/`outdatedTimeout` imported from their owning modules and asserted against |
| **A4** two clients on one card resolve; the loser converges; both peers agree who holds it | driven through the **real** `updateSelection` patch on both peers. Falsified by B2, B5 |
| **A4** a gesture claim still **loses** the tiebreak | expiry-immunity is not contest-immunity |
| **A4** the capture path still claims | the row a "stop claiming" fix cannot pass. Falsified by B5 |
| **A5** an expiry issues **no** revert, with a control in which a revert does fire | Falsified by B6 |
| **A5** one broadcast per sweep, none when nothing expired | Falsified by B7b |
| **A5** the awareness wire shape is unchanged — six keys, `LockEntry` still `{color,name}`, no `origin`, no `touchedAt` | Falsified by B8 |
| **the pin still guards** | B10 (one byte, size) and B9 (byte-length identical, SHA) |
| **`main.ts` and every other canvas module are byte-unchanged** | `git status --porcelain` shows three modified files, one of them production |

### Argued — the Dispatcher does not accept these as closed

1. **"Nothing may make `coldOpen`/`doc-wins` reachable more often" (A5's second half).** The demonstrated
   part is that the sweep never calls `onRevert` — and `onRevert` is `CanvasPresence`'s **only** outward
   edge to the canvas/file layer. The remaining step is an *enumeration by reading the class*:
   `expireIdleInferredLocks`'s outward calls are `this.now()`, `Map`/`Object` operations and
   `this.emitLocalState()` (awareness only). No test asserts that enumeration. Since WP21 a lock carries no
   write authority (`files/canvas-sync.ts:4127-4130`), so releasing one **cannot** cause a doc write, a file
   write or a `coldOpen` — but that sentence is WP119's reading of the tree, re-read and agreed, not measured
   here. **Strictly fewer writes, argued.**
2. **The 15 s window against a *real* typing session.** The constants are pinned from the tree and the
   arithmetic is executable; whether real Obsidian typing actually yields a capture per `MAX_WAIT_MS` in a
   live vault is the rig's to say.
3. **Everything live.** This package is headless end to end. A2 is the owner's own criterion and the owner's
   own report is the only thing that closes it.

---

## 5. What I could not separate (§3.6)

1. **The pin reddens on every plant, so no break-table run is a clean product-only measurement.** Any edit
   to `canvas-presence.ts` changes its digest, so the pin row is red in all eleven rows. I report the
   product rows and the pin row separately in every row of §3, and the product-row counts exclude it — but
   the *suite* figures in those runs mix the two, and I could not avoid that without disabling the pin,
   which is the one thing this package must not do.
2. **B2 and B5 are indistinguishable to this test file.** Both produce the same 14 red rows. "Expire
   everything immediately" and "never claim at all" leave `isLockedByMe` false at every observation point
   my file has. The rows discriminate each wrong build from the **correct** one, which is what falsifiability
   asks; they do **not** discriminate the two wrong builds from each other, and I did not build a row that
   does. Named rather than hidden.
3. **B7 reddened for a reason I did not predict** (re-entrancy, not emit count). I could not separate
   "the emit count is pinned" from "the return value is pinned" using B7 alone, which is exactly why B7b
   exists. B7's row in §3 records the confound rather than the intent.
4. **The gate figure carries no confirmed predecessor at my base commit.** The Dispatcher's own run at
   `e974fdd` died writing its status file, so the arithmetic in §7 reconciles against the charter's
   `3260 / 428` measured at `d188b0e`, one commit older. It is exact — but it is exact against a number
   measured on a different commit, and I say so rather than presenting it as a same-commit delta.

---

## 6. Findings — described, not numbered (I allocate none)

**F1 — `wp5/latency`'s ">30 s idle window" row cannot witness a lock lifetime, and this is demonstrated.**
Under plant **B3** — gesture claims made expirable, i.e. the worst outcome this package can produce — the
row *"static caret and idle lock survive a >30 s idle window on the peer"* stayed **green over 33.5 s of
real clock**. Mechanism, verified in source: the row idles *"with NO local movement"* (its own comment,
`wp5/latency.test.ts:562`); the keep-alive re-emits an **identical** state; y-protocols emits `change`
only when a state **deep-changed**; so the holder's awareness listener never runs and the sweep is never
entered. The row measures the awareness **prune**, which is what it was written for — it simply cannot be
cited as evidence about expiry. Left untouched (another package's test).

**F2 — the sweep is event-driven, and that is a stated bound, not an unconditional guarantee.** In a room
where no peer's awareness state deep-changes, a stale claim survives indefinitely. This is deliberate (an
uncontested claim harms nobody, and the harmful moment is the one that triggers the sweep), and in practice
any peer moving a mouse over a canvas emits a fresh cursor position — but *"15 s and it is gone"* is not
what the build does. *"15 s, and gone the next time anything happens"* is.

**F3 — the real `Awareness` caught a vacuity in my own harness that a shared-`Map` double would have
hidden.** My churn helper first shipped with fixed cursor coordinates. Repeated identical states are not
`change`s, so two A3 rows silently measured nothing — and failed loudly, in the first run, only because the
wire is real y-protocols. This is the class the run keeps finding, and the deciding factor was refusing the
convenient double. Recorded in the test file at the helper.

**F4 — `BUILD_SPEC` §7's abort criterion is stale against an owner ruling.** §1.1. Dispatcher's to fix.

**F5 — WP27's `test_tp08` pins the awareness field's six top-level keys but nothing about `LockEntry`.**
Plant B8 put `origin`/`touchedAt` on the wire and `test_tp08` stayed green. My A5 row covers this one
entry type; the class (nested shapes under a pinned top level) is not swept.

---

## 7. Gate — measured by me, in this session, on this tree

From `plugin/`:

| Command | Result |
|---|---|
| `./node_modules/.bin/tsc -noEmit -skipLibCheck` | exit **0** |
| `./node_modules/.bin/vitest run` (plain — `--reporter=basic` does not exist in this version) | **429 files · 3275 tests · 3275 passed · 0 failed** |
| `npm run build` | exit **0** |
| `python workflowArtifacts/canvas-v2/check_signal_register.py` | **exit 0 for everything I own** — see the caveat immediately below. Control: all classes proved, every run |

**⚠ Checker caveat, and it is not mine.** Three measurements, in order, same session:

| run | files | verdict |
|---|---|---|
| after the code + tests, before this report | 243 | **exit 0** — *"clean - no NEW violations"* |
| after adding this report | 246 | exit 1, **3** keys: `ImplementationReport_WP120.md` **(mine)** + `TaskCharter_WP121_…` + `TaskCharter_WP122_…` |
| after marking my line `<!-- signal-register: meta -->` | 246 | exit 1, **2** keys — **`TaskCharter_WP121_WinningIsNotALicenceToDiscard.md:267` and `TaskCharter_WP122_AFileWithNoWriterCannotConverge.md:326`, both bare `S175`** |

Those two charters are **untracked files the Dispatcher wrote into the shared tree while I was working**
(`git status`: `?? …WP121…`, `?? …WP122…`). Neither is mine, neither is staged by me, and both are the
exact recurring form `SIGNAL_REGISTER.md` §5 documents — *"next free is S<n>"* without the meta marker,
which §5 records as having caught the Dispatcher three times already. **Attribution is by the instrument's
own per-file output, not by assumption:** zero violation keys name any file I touched. Adding the marker
to each of those two lines returns the checker to exit 0.

**Arithmetic.** Charter baseline `3260 / 428` (measured by the Dispatcher at `d188b0e`; WP119's report
measures the same). WP120 adds **one** file with **15** rows and changes no other row's count ⇒
**3275 / 429**. Exact, no unexplained delta, nothing added or lost elsewhere.

**Caveats attached to that figure — a worker's caveat is part of its result:**

- **No confirmed predecessor at `e974fdd`.** The Dispatcher's pre-dispatch run died writing its status file,
  so the delta above is against a figure from one commit earlier (§5.4).
- **`S153` did not fire.** WP92's `no_collateral` was green both uncommitted and after commit; my touched
  set does not include the file it watches.
- **`S88` did not fire.** `v2/wp93`'s census reads the live working copy of `file-ops.ts` and
  `vault-events.ts`; I touched neither.
- **`S146` discipline.** Every red in this run was produced by a plant of mine and disappeared on the
  byte-identical restore. No red was attributed to anything else; there was nothing else in the tree.
- The `.mtime`-sensitive `wp5/latency.test.ts` takes ~38 s of real clock on its own; the 41 s suite duration
  is almost entirely that file.

---

## 8. The re-established pin

**File:** `plugin/src/__tests__/v2/wp21/test_tp04_awareness_liveness_unchanged_visible.test.ts`

| | value |
|---|---|
| `PRESENCE_SHA256_LF` | `2cefc9a88bb407bfd4a28b432ad901c20be6cc1f8a6e0c936e61b86f07ff16c9` |
| `PRESENCE_BYTES_LF` | `29831` |
| previous (WP21 charter) | `40528ad8083a0f706dc045e64d0039887cbbaacc4d0db2e7246ccba22db29dd9`, `22551` |

**The pin was NOT deleted, NOT weakened and NOT loosened.** Both halves — byte length and SHA-256 over the
LF-normalised text — are still asserted, the three behavioural pins beside it (deadline pulse, reconnect
reclaim defer, lowest-clientID tiebreak over three holders) are untouched and still green, and an
**amendment ledger** naming the owner ruling was added above the constants so the next reader can see the
authority without leaving the file. Both halves were proved still live: **B10** (one byte, caught on size)
and **B9** (byte-length identical, caught on SHA).

**Commit:** `__COMMIT_SHA__` — the digest change lands in the same commit as the source change it covers.

---

## 9. Files changed

```text
plugin/src/canvas/canvas-presence.ts                            +136 −? (the authorised repair)
  ├── header             the diff-inferred half now has a lifetime, and why
  ├── LockOrigin         NEW exported type + the provenance rationale
  ├── INFERRED_LOCK_IDLE_MS  NEW exported constant, derived from the capture cadence
  ├── CanvasPresenceOptions  + now?, + inferredLockIdleMs?
  ├── lockMeta           NEW private map, BESIDE lockedNodes (wire shape unchanged)
  ├── start()            + expireIdleInferredLocks() BEFORE reconcileClaims()
  ├── onDiffInferredChange   acquires as "inferred"; REFRESHES an existing inferred claim
  ├── acquireLock        + origin param, default "gesture"
  ├── expireIdleInferredLocks   NEW public sweep
  └── releaseLock / reconcileClaims / onReconnect / reclaimStillFreeNodes / destroy
                         keep lockMeta in step; onReconnect carries origins across the withhold

plugin/src/__tests__/v2/wp21/test_tp04_awareness_liveness_unchanged_visible.test.ts
  └── the pin, RE-ESTABLISHED at the new digest + an amendment ledger. No assertion removed.

plugin/src/__tests__/v2/wp120/test_tp01_a_presence_lock_has_a_lifetime_visible.test.ts   NEW, 15 rows
  └── real y-protocols Awareness over real Y.Docs, real wire, real CanvasAdapter over the
      CanvasDouble driven through InteractionDriver, injected clock. A1×3 A2×2 A3×4 A4×3 A5×3.

plugin/src/__tests__/v2/selmove/test_selection_moves_nodes.test.ts   COMMENT-ONLY
  └── T3's "STILL RED IN SUBSTANCE / ESCALATE" banner now records that WP120 closed it and
      why the two rows still pass unchanged (they are a GESTURE bound, not a time bound).
      Verified comment-only: `git diff <file> | grep '^[+-]' | grep -v '^[+-]//'` → empty.
```

`main.ts`, `files/canvas-sync.ts`, `reconcile-plan.ts`, `canvas-adapter.ts`, `canvas-persistence.ts`,
`canvas-mirror*.ts`, `server/**` are **byte-unchanged**. `ARCHITECTURE.md`, `README.md`,
`docs/security.md`, `USER_STORIES.md` were not touched. `DISPATCHER_STATE.md` and `temp.md` were modified
by the Dispatcher during my run and are **not** staged by me. `npx biome check --write` was never run.

---

## 10. Residuals

| # | Residual | Severity | Owner |
|---|---|---|---|
| **R1** | **`BUILD_SPEC` §7:2357 still lists a modified `canvas-presence.ts` as an ESCALATE**, contradicting the owner ruling this package was built on (§1.1). Until amended, the next reader of §7 will correctly read my commit as an abort | **high (process)** | Dispatcher |
| **R2** | **`wp5/latency`'s 30 s idle-lock row cannot witness lock lifetime** (F1). Not edited — another package's test | medium | whoever owns `wp5/` |
| **R3** | **The sweep is event-driven** (F2): in a completely quiet room a stale claim persists. Deliberate, but it bounds A1's guarantee | low | — |
| **R4** | **No live verification.** Headless throughout, against `CanvasPresence` and a real awareness wire, not against Obsidian. A2 is the **owner's** criterion and only the owner's report closes it | — | W4 / the tester |
| **R5** | **`computeCanDeleteNode` becomes permissive after the window.** A peer may delete a card whose claim expired. Currently unreachable — both per-node gates have no live consumer (`canvas-binding.ts`, behind `useCanvasBinding`, default `false`) — but it is a semantic change that arrives the day WP40 flips that flag | low | WP40 |
| **R6** | **Nested shapes under a pinned top-level key are unpinned** (F5). WP27's `test_tp08` would not have caught `LockEntry` growing a field | low | reported |
| **R7** | **WP119's R2, R3, R5, R6 are untouched** and still stand. Its **R1 (the A3 escalate) is CLOSED by this package** | — | convergence remodel |

---

## 11. Handoff (Rule 13) — for a newcomer, because my transcript is not carried forward

**Everything I established, by file and line** (`plugin/src/canvas/canvas-presence.ts` unless stated):

| What | Where |
|---|---|
| `LockOrigin` — the whole design hinges on this one distinction | `:19-38` (type at `:38`) |
| `INFERRED_LOCK_IDLE_MS = 15_000` + its derivation | `:40-53` |
| `now` / `inferredLockIdleMs` options | `CanvasPresenceOptions`, `~:263-271` |
| `lockMeta` — deliberately **beside** `lockedNodes`, never on the wire | `~:305-310` |
| the sweep call, **before** `reconcileClaims()` — the load-bearing order | `start()`'s listener |
| `onDiffInferredChange`'s **refresh** — what makes the window mean "the user stopped" | `onDiffInferredChange` |
| `expireIdleInferredLocks()` — public, gesture-safe, unknown-provenance-safe, one emit | its own method |
| origins carried across a reconnect | `onReconnect` + `reclaimStillFreeNodes` |
| the leak's source, for the next person who asks "where does a claim come from?" | `files/canvas-sync.ts:4130` → `main.ts:2505`; `canvas-adapter.ts:845` `emitHeld` is the *other* path and the only one with a release |
| the pin + its amendment ledger | `v2/wp21/test_tp04_…:56-78` |
| the evidence | `v2/wp120/test_tp01_a_presence_lock_has_a_lifetime_visible.test.ts`, 15 rows |

**Designs I rejected and why:** §2.4 — read it before "simplifying" this. The three that will look most
tempting are (a) one uniform expiry for all claims, which is A3's failure mode; (b) a `setInterval` sweep,
which buys nothing the listener does not already give you; (c) putting the origin into `LockEntry`, which
puts unverifiable local bookkeeping on the awareness wire.

**Things a newcomer will otherwise rediscover the hard way:**

1. **y-protocols emits `change` only when a state DEEP-CHANGED.** Not on every `setLocalState`. Every
   "it survived N seconds" assertion in this area is vacuous unless something actually differs. This cost
   me two rows on the first run (F3) and it is why `peerChurn` uses a monotonic counter.
2. **`canvas-presence.ts` is CRLF on disk with `core.autocrlf=true`**, and the pin hashes the **LF-normalised**
   text. On-disk bytes (30 547) ≠ pinned bytes (29 831). If you edit it, normalise the whole file to CRLF
   afterwards or you will get a mixed-ending file and a confusing diff.
3. **`git status` showing `M` with an empty diff** on this repo is a CRLF or mode artefact — distinguish
   with `git ls-files -s` + `git hash-object`, never by reading the diff.
4. **Restore a plant by copy-aside from outside the repo.** Never `git checkout`, never `git stash`.

**Residuals I deliberately left:** §10. **R1 is the one that needs action and is not mine.**
