# WP114 — Sync that depends on timer punctuality does not work in a background window

**Signal:** S147 (P0) · **Worker:** fresh context · **Branch:** `fix-bugs-and-raceconditions` ·
**Base:** `e29e9ce`

---

## 1. The measurement — read this before forming any hypothesis

Measured live on build `1ddad2155341adbd`, three real vaults, two arms differing **only** in Chromium's
background-throttling flags, which were **verified on the renderer command lines and by a functional
probe**, not assumed.

| | throttling OFF | throttling ON *(the default — what users run)* |
|---|---|---|
| host-created mid-session notes left **unsubscribed** on guests | **0 / 16** | **16 / 16**, still false 45 s later |
| after a link break + restore | recovers at **+10 s**, host edit lands in **0.16 s** | **never** recovers at +10/+40/+90 s; **a host edit never arrives in 90 s** |
| guest state when orphaned | — | `observers:false, synced:null, resolution:null, textLen:null` |
| **`docExists`** | — | **`false`** |

**The clamp, measured directly** (30 chained `setTimeout(…, 0)` hops inside each renderer):

| condition | per-hop |
|---|---|
| foreground | **12 ms** |
| ~1 min backgrounded | **907 ms** |
| ~10 min backgrounded | **9 004 ms**, and a nominal `setTimeout(1000)` fired at **27 844 ms** |

**Two facts that make this a product defect rather than a rig artefact:**

1. **In the ordinary three-window configuration, ALL THREE renderers report `visibilityState: hidden`** —
   not one foreground and two behind. Merely *stacking* the windows is enough. This is the normal state of
   a user's Obsidian, not an edge case.
2. **`docExists: false`.** The `Y.Doc` was never created, so `subscribe()` never reached `getDoc`. Whatever
   fails, it fails **before** the subscribe body — which is why `S143`, which I asserted was the cause, is
   **refuted** as the live mechanism. Do not go looking inside `subscribe()`'s exits for this.

---

## 2. The question this package exists to answer

**What schedules the guest-side subscribe for a file the host announces mid-session, and why does it never
create the document when the renderer's timers are clamped to seconds?**

The live validator stopped exactly here and said so: *"it is a code-reading question now, not a live one."*
Nothing about the answer has been established — treat everything below as a lead, not a finding.

Leads, in the order I would try them:

- The manifest/announce → guest subscribe path. Find the **actual** scheduler: a `setTimeout`, a debounce, a
  poll interval, an `await` chained behind one, a queue drained on a timer.
- **Ordering assumptions between two timers.** Under a uniform clamp, two timers set 50 ms apart can fire in
  the same tick or in the wrong order. Code that is correct only because A's timer is shorter than B's is
  broken here, and it will look correct in every reading.
- **Timeouts shorter than the clamp.** A 10 s timeout against a 9 s/hop clamp is a coin flip; a 250 ms one
  (`S120`'s mute ceiling) is already lost. Census the fixed durations on this path and compare each against
  9 000 ms.
- Anything keyed on `visibilitychange`, `requestIdleCallback`, `requestAnimationFrame`, or an event that
  Chromium pauses outright when hidden.

**Report what actually schedules it, with the file and line, before proposing a repair.** Three workers in
a row have corrected the premise they were handed; the premise here is deliberately thin because I do not
know the answer.

---

## 3. The task

**AC1 — Name the mechanism.** The scheduling path, and the specific reason it fails under a clamp, with
the line. If the answer is "several things fail", rank them by which one produces `docExists: false`.

**AC2 — A THROTTLED-TIMER TEST FACILITY, and this may outlive the fix.** The suite cannot currently express
this class at all: its timers are punctual, exactly as `S130` found its latency to be zero. Build a way to
run a scenario under a clamp — timers coerced to a floor, ordering perturbed — and demonstrate the defect
under it. **A fix for this class that cannot be tested under a clamp will regress unnoticed**, because the
only instrument that catches it is a ten-minute live run with the windows hidden. Keep it usable by later
packages: this is a facility, not a fixture.

**AC3 — The fix, and the principle it must satisfy: correctness may not depend on a timer being punctual.**
Event-driven where an event exists; deadline-based rather than duration-based where a wait is unavoidable;
and idempotent retry where neither is possible. **A fix that merely lengthens a timeout is not a fix** — it
moves the cliff, and the clamp grows without bound the longer a window stays hidden.

**AC4 — Recovery is part of the defect, not a separate feature.** After a link break and restore, a
throttled guest must converge without a session restart. The measured behaviour is *never*, out to 90 s,
while a host edit sits undelivered. **Respect I11: refusal never destroys.** A recovery path that seeds or
overwrites a file the user has been editing offline is a worse defect than the one you are fixing —
`S148` is open precisely because conflict preservation is not currently working.

**AC5 — Do not reintroduce `S134` or `S143`'s surface.** The seeding path now runs for the active file
(`39255ee`); any retry or re-arm must not seed over a document the editor owns, must not resurrect an
emptied note (`yTextHeldContent` is the existing predicate — use it), and must not retry a **deliberate**
cancellation (`cancelledSubscribes`, `isDestroyed`) into a resurrection.

**AC6 — Falsifiability (Dispatcher Rule 11).** A break table: plant, RED **for the right reason**, restore
byte-identically by copy-aside, GREEN. Zero `.pre-v2-smoke` files at the end.

**AC7 — Gate.** Full `vitest` + `tsc` clean, bracketed, and `check_signal_register.py` exit 0. Baseline is
**3057 tests / 410 files**, measured by the Dispatcher on a quiet tree — **you are the only worker in this
tree, so a failure you see is real** (`S146`: the last two workers' failures were all contamination from
running concurrently; yours are not, so do not dismiss one as flaky without evidence).
⚠ `NEXT_FREE` is hardcoded at `check_signal_register.py:53` as well as in the register; that coupling is
recorded and is not yours to fix.

---

## 4. Method rules

1. **No partial test doubles.** Five packages lost to them. Drive the real object, or state exactly which
   paths your double does not exercise.
2. **Demonstrated beats argued.** The scheduled call that never fires, the document that is never created.
3. Every new test gets a positive control — including the clamp facility itself: **prove it can make a
   passing scenario fail** before trusting a failure it reports.
4. **Correct this charter where it is wrong.** §2 is leads, not findings.
5. **Signal numbers: next free is S153, and you allocate none.** <!-- signal-register: meta -->

## 5. Hard constraints

- **Do not rebuild or deploy, and do not touch the three vaults.** The rig is left running and connected
  for the next live round; a rebuild would invalidate the build sha every WP111 measurement names.
- **Never run `npx biome check --write`** — it corrupts this tree.
- Never commit to a default branch. **Explicit path staging only — never `git add -A`.**
  `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted `USER_STORIES.md` are the **owner's**.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value.
- **Commit before you report.**

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP114.md` — the mechanism with its
evidence, the clamp facility and how to use it, the break table, bracketed gate figures, what you rejected
and why, and every residual you leave.
