# Implementation Report — Sleep-as-Wait Sweep (S56)

**Batch:** B39 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Authority:** `ImplementationReport_LivenessSweep.md` §6.2 —
*"**S56** — 116 of 197 waits are a bare sleep standing in for a wait … the mirror image of this
sweep's class: a `SLEEP-ORACLE` always completes, so it can never hang — and it never observes the
state it was standing in for either. Not a defect today, deliberately not repaired … **recorded so
the next sweep does not have to rediscover it.**"*

---

## 0. Summary

| | |
|---|---|
| **Census, regenerated** | **91 `SLEEP-ORACLE` rows in the `H:\tmp\liveshare_*.py` scripts**, not 86 — the population **grew by 5 in the 75 minutes between B37's measurement and mine**, in two files a sibling was editing while I read them (§1.2). Regenerated with the committed tool, not hand-listed. |
| **Classified** | **91 / 91**, with a reason each: **49 converted · 11 kept and documented · 1 documented escape hatch · 30 not mine** (14 sibling-live, 16 in scripts that emit no verdict at all). |
| **Converted** | **49**, in **10 scripts**. Each is a bounded poll on the state the sleep stood in for, with a **timeout equal to the sleep it replaced** and a failure message that **names the condition**. |
| **Failure evidence** | **45 / 45 rows, executed, both bands.** A committed harness imports each converted script's own `await_state` and drives it NEGATIVE (must return `False`, must print `WAIT TIMED OUT`, must name the label verbatim, must terminate inside the budget), POSITIVE (the control — must return `True`, no timeout line), and RAISING (must not propagate). §3. |
| **Verdicts** | **One changed, and it is a finding.** canvas `21/21 → 16/20` — **only when the waits are allowed to end early**. Reproduced twice, byte-identical. wp86 `38/0/4` and wp80 `18/0/1` unchanged in **every** band. §4. |
| **Runtimes** | wp80 **13.1 s → 2.13 s (6.1×)** · wp86 **99.2 s → 80.3 s** · canvas **70.5 s → 26.8 s** — the canvas figure is the one that costs 5 checks. §4. |
| **Census did not grow** | `SLEEP-ORACLE` **91 → 52** (of which **10 are the new instrument's own deliberate hold**, so **42 real**). `WHILE-POLL` 55 → 64, **every new row `bounded-deadline`**. **`UNBOUNDED` non-blocking waits: 0, before and after.** No sleep was traded for a hang. §5. |
| **Are most of them legitimate settle margins?** | **No — and that is the honest headline.** Only **5 of 61** in-scope sleeps are a genuine settle margin or a margin protecting a negative assertion. **49 of 61 stood in for a state the rig could already observe and simply did not ask about.** |
| **Outside the repo** | Ten `H:\tmp\liveshare_*.py` scripts edited in place; originals preserved as `H:\tmp\_b39_before_*.py`. Nothing under `plugin/src/**`, `tools/obsidian_e2e/**` or `server/**` was touched. §8. |

**The one-line finding:** *Every state these sleeps stood in for is reached in **0.0–0.4 s**. The
sleeps were never buying the state — they were buying the **gap between scenarios**, and on the
canvas suite that gap is load-bearing for five checks.*

---

## 1. The census, regenerated

### 1.1 Command, and it is the committed one

```
python workflowArtifacts/canvas-v2/tools/derive_liveness_hangs_py.py $(ls H:/tmp/liveshare_*.py)
```

| | before (12:16) | after (12:44) |
|---|---|---|
| files scanned | 28 | 28 |
| `SLEEP-ORACLE` | **91** | **52** (10 = the instrument, §5.2 → **42 real**) |
| `WHILE-POLL` | 55 | 64 |
| `BLOCKING-CALL` | 8 | 8 |
| `RIG-COMMAND` | 150 | 157 |
| **`UNBOUNDED` non-`BLOCKING-CALL` waits** | **0** | **0** |

### 1.2 The census grew before I touched it — B37's 86 is now 91

B37 measured **86**. I measured **91**, from the same tool, 75 minutes later. The five are in
`liveshare_wp38_e2e.py` (5 rows, file mtime **12:09**) and `liveshare_wp87_e2e.py` (6 rows, mtime
**11:50**) — both **sibling-live**. B37 recorded `wp87` at 6 and did not list `wp38` at all.

**This is not a discrepancy to reconcile; it is the finding restated.** The population is not static
and nobody is responsible for noticing it grow. A census is a measurement of a tree at a time
(rule 5), and this one moved under two batches in a little over an hour.

### 1.3 Distribution, before

| file | rows | disposition |
|---|---|---|
| `liveshare_wp86_e2e.py` | 15 | converted 13 · kept 2 |
| `liveshare_dataloss_e2e.py` | 9 | converted 8 · kept 1 |
| `liveshare_wp80_e2e.py` | 8 | converted 7 · kept 1 |
| `liveshare_wp82.py` | 8 | converted 6 · kept 2 |
| `liveshare_wp36_e2e.py` | 6 | converted 6 |
| `liveshare_wp37_e2e.py` | 5 | converted 3 · kept 2 |
| `liveshare_wp38_e2e.py` | 5 | **NOT MINE — sibling-live** |
| `liveshare_e2e.py` | 4 | converted 2 · kept 1 · +1 documented escape hatch |
| `liveshare_wp83_e2e.py` | 3 | converted 1 · kept 2 |
| `liveshare_wp85_e2e.py` | 2 | converted 2 |
| `liveshare_wp79_e2e.py` | 1 | converted 1 |
| `liveshare_wp87_e2e.py` | 6 | **NOT MINE — sibling-live** |
| `liveshare_wp87_reload_probe.py` | 3 | **NOT MINE — sibling-live** |
| `liveshare_wp36_s3_diag.py` · `_diag2.py` | 5 + 5 | **out of class — emits no verdict** |
| `liveshare_wp37_probe.py` · `_diag.py` | 3 + 2 | **out of class — emits no verdict** |
| `liveshare_launch_vaults.py` | 1 | **out of class — emits no verdict** |
| **total** | **91** | **49 + 11 + 1 + 30** |

---

## 2. The classification, with the reason for each

### 2.0 The rule that makes a conversion verdict-preserving, stated before any of them

> **A converted wait's timeout EQUALS the sleep it replaced.**

So the window in which the state may become true is byte-identical, the predicate is checked inside
that window, and the caller's own `check` still adjudicates. Under that rule a conversion cannot make
a passing check fail *for its own reasons*: it can only end the wait earlier and say what it was
waiting for when it does not. **Everything the sweep changes beyond that is the run's schedule, and
§4.2 measures exactly what that is worth.**

The second rule, from the brief and taken literally: **do not convert a sleep into a poll whose
predicate cannot be produced.** Every predicate below is a field some command already returns, or a
file on disk. **`UNBOUNDED` waits after conversion: 0.**

### 2.1 Bucket A — stood in for an OBSERVABLE condition ⇒ bounded poll. **49.**

Grouped by the observable, with the command that produces it:

| # | family | observable used | sites |
|---|---|---|---|
| A1 | after `session.promoteToHost` / `demoteToGuest` | `session.info.role` | **12** |
| A2 | after a `sweep()` unlinks fixtures | `manifest.info.paths` no longer carries the key | **3** |
| A3 | after a teardown sweep | the shared tree back to the recorded preflight set | **2** |
| A4 | after `manifest.publish` | `manifest.info.publication.publishedAt` **advances** on the other peer, or `freshPublication` flips true | **3** |
| A5 | after a key vanishes from a manifest | `manifest.lastChange` carries a **removal row naming that key** | **3** |
| A6 | after a rename lands | `manifest.lastChange.renames` non-empty | **1** |
| A7 | after a canvas/board write | `canvas.state` answers · the node/edge id appears in the **peer's file on disk** · the two docs converge | **13** |
| A8 | after `link.break{silence}` / `link.restore` | `link.report.links.<link>.silenced` / `.up` | **4** |
| A9 | after an Obsidian relaunch | `session.info` reports a **resumed role AND `connected: true`** on every named instance | **5** |
| A10 | after a file create / delete | the path exists / is gone on the **other** peer's disk | **3** |

Three of these are worth naming individually because they are strictly stronger than the sleep they
replaced, not merely faster:

- **`liveshare_e2e.py::settle`** called `sync.waitQuiescent` on both instances, **threw the
  `{quiescent: bool}` answer away**, and then slept the same budget again. It now reads the answer,
  prints `!! NOT QUIESCENT within Ns` when it is `false`, and spends the residual budget polling the
  caller's own post-condition. *The suite was asking the right question and discarding the reply.*
- **`liveshare_wp80_e2e.py` S2** slept 2 s and then asserted a manifest entry **survives**. Polling
  for the entry's *presence* would have been satisfied at t=0 and made the check unable to fail. It
  now waits for the **publication the entry has to survive** to be observably consumed by the other
  peer (`publishedAt` advancing), and then asserts survival. The check became meaningful, not weaker.
- **`liveshare_wp86_e2e.py` S5** slept 2 s after the host's attestation and then *printed*
  `freshPublication` on the very next line. It now **waits for** `freshPublication is True` — the
  scenario's whole premise, previously assumed and coincidentally displayed.

### 2.2 Bucket B — stood in for something NOTHING exposes ⇒ kept, and now says so. **6.**

Each carries a comment naming what is unobservable and why. These are the ones I was asked to judge
rather than mechanically rewrite.

| site | what is unobservable |
|---|---|
| `wp82.py:476` (4 s of the old 8 s) | **the relay's own election.** After a `close`, what the step needs is the relay noticing a departed socket *with a peer still present* and rewriting `room.hostUserId`. No client command reports it, and `/healthz.clients` counts **mux** sockets only (**S35**), so a control socket's departure is invisible there. **Split:** the client half *is* observable (`link.report...up == false`) and is now polled; only the relay half stays a sleep. |
| `wp86_e2e.py:369` | **Obsidian's vault watcher having ingested two `mkdir`s** before `manifest.publish` scans the tree. `manifest.info` cannot show the folder until the publish this sleep precedes, so a poll here would be polling for the state this step is what produces. |
| `wp83_e2e.py:326`, `:381` | **"the previous file-create has been emitted"** — a 0.4 s ordering margin between two creates, so the control is created before the door. No command reports emission. |
| `wp37_e2e.py:422`, `:487` | **a correctly-deferring reconcile pass leaves no trace.** THE CRITERION is that typed characters *survived* the pass; "the view did not change" is exactly the state a poll cannot distinguish from "the pass has not run yet". Polling the surface for the typed marker would assert the criterion as its own precondition. |

### 2.3 Bucket C — a genuine settle margin, or a margin protecting a NEGATIVE assertion. **5.**

| site | why it is legitimate |
|---|---|
| `liveshare_e2e.py:423` | the next check is *"no resurrection after a further settle"*. A poll for "it is still absent" is satisfied at t=0 and makes the check unable to fail. |
| `dataloss_e2e.py:317` | the next two checks are *"the reconcile destroyed nothing"* and *"the canary survived"*. Same shape. |
| `wp80_e2e.py:328` | the next check is *"the manifest STILL lists a file no peer holds"* — a peer declining to act. Same shape. |
| `wp86_e2e.py:833` | the next check is *"the guest's tree shrank by exactly that path"* — the **and by nothing else** half is the negative. The positive half is already observed by a `wait_for` immediately above. |
| `wp82.py:568` | 2 s **after** an observed reconnection (`wait_connected`), before reading the drain. Polling `offlineQueueDepth == 0` here would make the measurement assert its own precondition. A small margin after an observed condition — the legitimate case. |

**A negative cannot be polled for.** That is the whole of bucket C, and it is only 5 sites. Every one
of them now says so in place, so the next reader does not have to re-derive it.

### 2.4 Not mine — 30, and the split matters

- **14 sibling-live**, untouched: `wp38_e2e.py` (5), `wp87_e2e.py` (6), `wp87_reload_probe.py` (3).
  Not a precaution in principle — **measured.** My first two baselines at 12:21 and 12:22 were both
  polluted by `wp38-122118-*.canvas` fixtures appearing in **both** shared trees mid-run (§4.4).
  Editing a script a sibling is executing is rule 14's shape one directory over. **Carried up, §6.1.**
- **16 out of class**, in five scripts that emit **no verdict at all**: `wp36_s3_diag.py` (5),
  `wp36_s3_diag2.py` (5), `wp37_probe.py` (3), `wp37_diag.py` (2), `launch_vaults.py` (1).
  **Pattern used (rule 15):** `grep -c -F "def check("` → `0` for each of the five, and the same
  literal pattern returns `1` on `liveshare_e2e.py` — so the pattern can match a known-present line
  and the absence is real. Second pattern `grep -c -E "^\s*(check|record)\("` → `0` for all five,
  `20` on `liveshare_e2e.py`. **A sleep in a script that emits no green cannot make a green mean the
  wrong thing.** Recorded as a deliberate deviation from the three buckets, not as a fourth excuse.

---

## 3. Every conversion shown to FAIL — executed, 45/45, in both bands

> *"a poll that cannot time out, or whose failure message does not name the condition, is not an
> improvement."*

`workflowArtifacts/canvas-v2/tools/prove_sleep_polls_fail.py` **imports each converted script's own
`await_state`** — not a copy — and drives three arms per script:

| arm | requirement |
|---|---|
| **NEGATIVE** (`lambda: False`) | returns `False` · prints `WAIT TIMED OUT` · **the label appears verbatim** · states the budget · terminates within budget + 1 s |
| **POSITIVE** (`lambda: True`) — *the control* | returns `True` · prints **no** timeout line · holds the budget in the SCHEDULE band and does **not** in the FAST band |
| **RAISING** (a probe that always throws) | returns `False`, does **not** propagate |

**The POSITIVE arm is why the NEGATIVE arm means anything:** a helper hard-wired to return `False`
would pass every negative row perfectly. That is this project's own vacuity class, one level down.

```
S56 FALSIFICATION HARNESS: 45/45 rows pass across 5 converted scripts   (default band)
S56 FALSIFICATION HARNESS: 45/45 rows pass across 5 converted scripts   (LS_S56_FAST=1)
```

Verbatim, one row:

```
PASS  liveshare_wp86_e2e.py :: NEGATIVE says it TIMED OUT
      '!! WAIT TIMED OUT after 0.6s waiting for: a state NOTHING will ever produce
       (falsification probe)'
```

**And the strongest evidence is not synthetic.** Four converted polls timed out **in live runs, for
real product reasons**, each naming its condition — three in the canvas FAST band (§4.2) and three in
wp86 (§4.3, one of which is a new finding). A poll that has actually fired in anger is worth more
than one proved to fire in a harness; both are here.

---

## 4. Before / after, measured

Both instances live throughout: **A = host, B = guest, `connected: true` on both** (S47 satisfied,
S37 recorded). Build `0.6.1+e2e` on both, unchanged for the whole batch — **nothing was built and
nothing was installed**, so every A/B below is the *same product* with only the driver changed.

### 4.1 The table

| suite | band | verdict | runtime |
|---|---|---|---|
| **canvas** `liveshare_e2e.py` | BEFORE, original — **contaminated**, 12:21 | 19/21 | 70.4 s |
| | BEFORE, original — clean window, 12:26 | **21/21** | 70.5 s |
| | AFTER, **shipped default** (SCHEDULE), 12:42 | **21/21** · 9 observed · 0 timeouts | 70.0 s |
| | AFTER, `LS_S56_FAST=1`, 12:27 | **16/20** · 3 timeouts | **26.8 s** |
| | AFTER, `LS_S56_FAST=1`, 12:33 — **reproduction** | **16/20** · same 3 timeouts · same 4 failures | **26.8 s** |
| **wp86** `liveshare_wp86_e2e.py` | BEFORE, original — **contaminated**, 12:22 | 37 / 1 / 4 | 99.5 s |
| | BEFORE, original — clean window, 12:36 | **38 / 0 / 4** | 99.2 s |
| | AFTER, shipped default (SCHEDULE), 12:38 | **38 / 0 / 4** · 7 observed · 3 timeouts | 98.9 s |
| | AFTER, `LS_S56_FAST=1`, 12:40 | **38 / 0 / 4** | **80.3 s** |
| **wp80** `liveshare_wp80_e2e.py` | BEFORE, original, 12:42 | **18 / 0 / 1** | 13.1 s |
| | AFTER, shipped default (SCHEDULE), 12:42 | **18 / 0 / 1** · 6 observed · 0 timeouts | 13.4 s |
| | AFTER, `LS_S56_FAST=1`, 12:42 | **18 / 0 / 1** | **2.13 s** |

**Not re-run, and why — stated rather than glossed.** `dataloss_e2e.py`, `wp85_e2e.py` and
`wp79_e2e.py` `taskkill /F /IM Obsidian.exe` and relaunch both vaults; `wp82.py` breaks and silences
both peers' control links. Running any of them destroys the instances two sibling batches are live
against, and a sibling's suite was **measurably executing against them during this batch** (§4.4).
`wp36_e2e.py`, `wp37_e2e.py` and `wp83_e2e.py` need fixture states this batch did not establish.
**Their conversions are proved at the helper level (§3) and by AST + import, and are otherwise
unvalidated live. That is a real gap and it is not dressed up as anything else.** §6.3.

### 4.2 THE VERDICT THAT CHANGED — canvas, and it is a finding

**`21/21` in 70 s becomes `16/20` in 27 s, purely by letting each wait end when its own state is
observed.** Reproduced twice with byte-identical failures. Same build, same budgets, same predicates.

The three timeouts, verbatim:

```
!! WAIT TIMED OUT after 6.0s waiting for: the side-less edge edge-sideless-123308 to appear in B's file
!! WAIT TIMED OUT after 6.0s waiting for: the guest's node from-guest-123308 to appear in A's file
!! WAIT TIMED OUT after 8.0s waiting for: the deletion of empty-card-123308 to reach B's file
```

Failures: `B received the side-less edge` · `host received the guest's node` · `B: node gone` ·
`no resurrection after a further settle`. The check count drops 21 → 20 because
`endpoints survived intact` is guarded on the edge having arrived.

**And here is the part that makes it a finding rather than a broken conversion.** In the SCHEDULE
band — same file, same polls, only the residual budget held — **every one of those same nine
conditions is observed, and observed almost instantly**:

```
observed after 0.0s of a 3.0s budget : both replicas free of every id the sweep removed
observed after 0.0s of a 8.0s budget : the two replicas to agree on their node set
observed after 0.2s of a 6.0s budget : B's copy of node 208541a49dc66c4c to carry x=777
observed after 0.2s of a 6.0s budget : the side-less edge edge-sideless-124254 to appear in B's file
observed after 0.2s of a 6.0s budget : the empty card empty-card-124254 to appear in B's file
observed after 0.4s of a 6.0s budget : the guest's node from-guest-124254 to appear in A's file
observed after 0.2s of a 9.0s budget : both replicas to carry BOTH concurrent moves
observed after 0.2s of a 8.0s budget : the deletion of empty-card-124254 to reach B's file
observed after 0.2s of a 12.0s budget: the guest's copy of second-124254.canvas to exist on disk
```

**1.4 s of state, bought with 61 s of budget.** So the product is not slow, and the polls are not
wrong. What differs between the bands is only the **gap between scenarios** — ~6 s under the sleeps,
~0.2 s without them.

**Conclusion, stated exactly and no further:** *five checks of the canvas suite are green because of
elapsed wall-clock time between scenarios, not because the product produced the state within the
budget the scenario itself declares.* A green that requires the schedule is measuring the schedule.

**Leading hypothesis, labelled as one and NOT acted on.** Every failing scenario is a **second
whole-file write to the same `.canvas` shortly after a previous one**. `DEVELOPMENT`/`DISPATCHER`
state records that the live capture path is `vault.on("modify")` → `handleLocalModify`, off
Obsidian's **debounced `requestSave`**, and that *"the shadow-based intent diff already discards
stale saves"*. A save arriving before the shadow has caught up being discarded as stale would produce
exactly this. **I did not verify it** — it needs `plugin/src/**`, where two siblings are live, and it
is not this scope. **Unowned, carried up as §6.2.**

**I did not tune a timeout to make it pass.** Every budget is the one the original sleep used. What I
did instead is make the schedule dependence itself *measurable*, and leave the red band standing.

### 4.3 wp86 — verdict unchanged, and three timeouts that are all correct

`38 / 0 / 4` in every band. Seven of ten converted waits observed their state in **0.0–0.3 s**. Three
timed out, and **all three are right to**:

| timeout | why it is correct |
|---|---|
| `a manifest-change disposition naming …wp86-canary-….bin on either instance` (4 s) | the scenario then **SKIPs** on its own recorded precondition: *"WP80's producing-side gate refused the purge on this build, so no key vanished."* No key vanished ⇒ no disposition can exist. |
| `a manifest-change disposition naming …wp86-unpaired-….bin on the host` (4 s) | same, S3's rename arm. |
| `the guest's manifest.lastChange to report a rename` (3 s) | **NEW — see below.** |

The first two are the sweep working as intended: the sleep silently elapsed and the code proceeded as
if the disposition existed; the SKIP arm then fired four seconds later for its own reason. Now the run
says *what never arrived*, at the moment it did not arrive.

**The third is a new signal.** In **both** bands and in the **BEFORE** run, WP86 S4 (`AC4b`, a real
rename) passes both ORACLEs — the guest's old path is gone, the new path exists, content
byte-identical — while the guest's own receipt reports:

```
"renamed": [], "renames": [],
"removals": [{"path": "_liveshare-test/wp86-ren-….md",
              "verdict": "nothing-to-destroy",
              "reason": "the vault holds nothing at this path, so the disappearance costs nothing here"}]
```

**A rename that demonstrably happened is reported by `manifest.lastChange` as a removal with verdict
`nothing-to-destroy`, and `renames` is empty.** The data was printed by the BEFORE run too and nobody
looked; the named wait is what made it loud. Not repaired here — it is `plugin/src/**` and it is
WP86's, not mine. **Carried up, §6.4.**

### 4.4 A sibling suite was live against the same two instances, and it cost 2 checks + 1 check

My first two baselines overlapped `liveshare_wp38_e2e.py` (mtime **12:09**, its fixtures
`wp38-122118-*.canvas` appeared in **both** shared trees during my 12:22 wp86 run and were gone by
12:24). Measured cost:

| suite | overlapped | clean |
|---|---|---|
| canvas | **19/21** (12:21) | **21/21** (12:26) |
| wp86 | **37 / 1 / 4** (12:22) | **38 / 0 / 4** (12:36) |

Both re-measured in a window proved quiet by a 30-second no-change watch over both shared trees
before starting. **Every number in §4.1 marked "clean" was taken that way.** This is the same lesson
B37 recorded for concurrent `vitest` runs, one level up: **two E2E suites driving the same pair of
Obsidian instances do not compose, and the loser is recorded as a product failure.** §6.1.

---

## 5. The instrument, and the census after it

### 5.1 `await_state(label, predicate, budget)` — one per script, no shared module

```python
deadline = time.monotonic() + budget
while time.monotonic() < deadline:      # a CLOCK against a DEADLINE, deliberately
    ...
print(f"  !! WAIT TIMED OUT after {budget:.1f}s waiting for: {label}")
return False
```

Three properties, each answering a specific instruction in the brief:

- **it is bounded by construction** — the loop test is a clock compared to a deadline, so the
  deriver classifies every one of the nine as `bounded-deadline` and **not one is `UNBOUNDED`**. The
  sweep does not trade a sleep for the hang class.
- **it names the condition on failure** — the label is a sentence, not an expression.
- **it never asserts.** The caller's own `check` still adjudicates, so no verdict moves into the
  wait.

### 5.2 The two bands, and why the shipped default is the slow one

```
default            observe the state, then HOLD the rest of the budget
LS_S56_FAST=1      observe the state, and STOP
```

The SCHEDULE band reproduces the bare sleeps' wall-clock schedule exactly, so verdicts are
unchanged — while reporting **how long each state actually took** and **what it was waiting for**
when it never arrives. The FAST band is the honest one and it is red on the canvas suite.

**Why the default is not the fast one:** redefining the run's canvas regression baseline from 21/21
to 16/20 is a call with consequences for two live sibling batches and for every future comparison,
and it is not one to make silently in autonomous mode. The finding is preserved, reproducible with
one environment variable, and written into every converted file's header. **The decision is the
Dispatcher's, and §6.2 is where it belongs.**

The band's own hold is a `time.sleep(left)`, so it is **correctly counted as a `SLEEP-ORACLE` in the
after-census — 10 of the 52 rows.** It is not hidden from the deriver and it is not excused; it is the
instrument, it is inert unless the band is on, and it is stated here so the 52 can be reconciled to 42.

### 5.3 The census did not grow

| | before | after | Δ |
|---|---|---|---|
| `SLEEP-ORACLE`, all | 91 | 52 | **−39** |
| `SLEEP-ORACLE`, excluding the instrument's own hold | 91 | **42** | **−49** |
| `WHILE-POLL` | 55 | 64 | +9 (the nine helpers, **all `bounded-deadline`**) |
| `BLOCKING-CALL` | 8 | 8 | 0 — **S55, not mine, untouched** |
| **`UNBOUNDED` non-`BLOCKING-CALL` waits** | **0** | **0** | **0** |

The 42 remaining: **11 kept-and-documented + 1 escape hatch + 14 sibling-live + 16 out of class.**

---

## 6. Found, and carried up

### 6.1 Two E2E suites against one pair of instances do not compose — and it is silent

Measured twice today, cost 2 checks and 1 check (§4.4). There is **no lock, no lease and no advisory
marker** on the two control ports; a suite cannot tell that another is mid-run, and the interference
is recorded as a product failure in whichever suite loses. The rig has no notion of exclusivity at
all. **Unowned.** Cheapest honest fix: a lock file next to the ports, or a `session.busy` claim on the
control surface. Until then, **every live E2E number in this run should say whether the tree was
proved quiet first** — mine do.

### 6.2 **S56's own consequence: five canvas checks are bought with wall-clock time**

§4.2, reproduced twice, byte-identical. **This needs an owner and a decision**, and it is the
Dispatcher's, not mine:

1. **Is `21/21` the baseline, or is `16/20`?** The suite declares per-scenario budgets of 6–9 s and
   does not meet them; it meets them only with ~6 s of extra quiet between scenarios that no
   criterion mentions.
2. The **leading hypothesis** (unverified, `plugin/src/**`, two siblings live): consecutive
   whole-file writes to the same `.canvas` inside Obsidian's `requestSave` debounce are discarded as
   stale by the shadow-based intent diff. If true it is a **product** statement — *a user who edits
   the same canvas twice in quick succession may lose the second edit* — and it is adjacent to P4's
   dropped-keystroke family, not a rig artefact.
3. Reproducing it costs one command: `LS_S56_FAST=1 python H:\tmp\liveshare_e2e.py`.

### 6.3 The conversions in five scripts are unvalidated live

`dataloss_e2e.py` (8), `wp36_e2e.py` (6), `wp37_e2e.py` (3), `wp83_e2e.py` (1), `wp85_e2e.py` (2),
`wp79_e2e.py` (1) — **21 conversions** proved by AST, by import, and by the falsification harness for
the two whose helper the harness loads, but **never executed end to end**, because running them means
killing both Obsidian instances or breaking both control links while siblings are live (§4.1).
**Whoever next runs each of those suites is running its first post-conversion execution.** Each is a
mechanical substitution of a predicate the rig already reads elsewhere in the same function, with the
same budget — but that is an argument, not a measurement, and it is filed as one.

### 6.4 A real rename reports `renames: []` and a `nothing-to-destroy` removal

§4.3. Present in the BEFORE run too, so **not caused by this batch**. WP86 AC4b's ORACLEs pass on the
file system; its **receipt does not agree with them**. `manifest.lastChange` is the instrument several
criteria read, so a receipt that reports a rename as a removal is a discriminator quietly returning
the wrong answer. **Unowned. `plugin/src/**`, WP86's.** Needs a signal number from the Dispatcher.

### 6.5 S55 is untouched and unchanged: 8 `BLOCKING-CALL` rows, still no `timeout=`

Including `tools/obsidian_e2e/install.py:527`, the E2E bundle build. Same 8 before and after. Not
mine, not annexed, and the count is stated so the next census can be diffed against it.

### 6.6 The shape, one level up

The liveness sweep closed on *"something changed underneath a check that was correct when it was
written, and nothing in the system is responsible for noticing."* **S56 is the same family with the
tense reversed: nothing ever established that these checks were correct when they were written.** A
bare `sleep(6)` before an assertion never had a moment at which it was *right* — it had a moment at
which it was *enough*, on one machine, under one load, with one set of siblings. The 0.2 s
observations in §4.2 say the number was never chosen against anything measurable, and the FAST band
says five checks have been living off the difference.

---

## 7. Constraints discharged

| constraint | status |
|---|---|
| in scope: the `H:\tmp\liveshare_*.py` E2E scripts only | ✅ — 10 edited; **nothing** under `plugin/src/**`, `tools/obsidian_e2e/**` or the workspace MCP driver |
| `plugin/src/**` not needed and not touched | ✅ — read-only, to learn what `manifest.info` / `link.report` return. `git status` shows no `plugin/` change |
| rule 14 — no revert/restore/stash of a shared path; `git status` re-read immediately before commit | ✅ — §8 |
| rule 15 + cousin — pattern stated and proven able to match, for every absence claim | ✅ — §2.4 (`grep -c -F "def check("`, `grep -c -E "^\s*(check\|record)\("`, both shown returning a non-zero count on a known-present file) |
| regenerate the census with the committed tool, do not hand-list | ✅ — §1.1, one command, before and after |
| every conversion shown to fail when the condition is not met | ✅ — §3, 45/45 executed in both bands, plus 4 live timeouts |
| do not convert a sleep into a poll whose predicate cannot be produced | ✅ — **0 `UNBOUNDED` waits after**, §5.3; every predicate is a command field or a file on disk |
| re-run the suites touched and compare | ⚠️ — **3 of 10 re-run** (canvas, wp86, wp80), 12 runs total. The other 7 are §6.3, stated as a gap |
| a changed verdict is reported, not tuned away | ✅ — §4.2. No budget was altered; the red band ships |
| S46 — digest / marker discipline | ✅ **by not needing it**: nothing was built and nothing was installed. Both instances ran `0.6.1+e2e` unchanged from 12:16 to 12:44, so every A/B is the same bytes |
| S45 — `canvas.open` disables the writer seam; use `canvas.typeInNode{open:true}` | ✅ — the suites already do; no new `canvas.open` call was introduced |
| S47 — both peers `connected: true` before measuring | ✅ — verified at 12:16 and printed by every suite's preflight |
| S37 — record roles resumed as | ✅ — **A = host, B = guest** for every run in §4.1 |
| explicit `session_key` on every `visible-console` `run_command` | ✅ — 7 distinct keys, listed in §8 |
| `data.json` never read, printed, logged or fixtured | ✅ — §9 |
| no `server/**` · `BUILD_SPEC_CanvasV2.md` untouched · `WORKFLOW_ANALYSIS.md` not mine | ✅ — the last left untracked and unstaged |

---

## 8. What changed, where — inside the repo and outside it

**Outside the repo, stated plainly.** Ten files edited in place under `H:\tmp\`:

```
liveshare_e2e.py  liveshare_wp86_e2e.py  liveshare_wp80_e2e.py  liveshare_wp82.py
liveshare_dataloss_e2e.py  liveshare_wp36_e2e.py  liveshare_wp37_e2e.py
liveshare_wp83_e2e.py  liveshare_wp85_e2e.py  liveshare_wp79_e2e.py
```

The pre-conversion originals are preserved beside them as `_b39_before_<name>.py` (nine files), so
any band can be re-measured against the exact bytes this batch started from. Conversion drivers kept
as `_b39_convert_*.py` / `_b39_flip_band.py`; run logs as `b39_*.log`; censuses as
`b39_census_before.json` / `b39_census_after.json`. **No file outside `H:\tmp\` and this repo was
written.**

**Inside the repo,** two files, both new, both under `workflowArtifacts/canvas-v2/`:

- this report
- `tools/prove_sleep_polls_fail.py` — the falsification harness (§3)

The census JSONs are **deliberately not committed**, on B37's own precedent: they embed absolute
`H:\tmp` paths from this machine and are one command away.

**Consoles used** (all `visible-console`, all with an explicit `session_key`, per the brief):
`b39_canvas_before` · `b39_wp86_before` · `b39_canvas_before2` · `b39_canvas_after` ·
`b39_canvas_after_ks` · `b39_canvas_fast2` · `b39_wp86_ab` · `b39_wp86fast_wp80ab` · `b39_final_runs`.

---

## 9. Data-safety statement

No vault file was read for its content, hashed for reporting, or fixtured. **No `data.json` value was
read, printed, logged, echoed or committed** — the port numbers used are the ones already recorded in
`DISPATCHER_STATE.md`. No secret passed through any agent tool. No relay credential was touched; the
relay was not contacted by this batch at all. The E2E suites created and swept only their own
namespaced `wp80-*` / `wp86-*` / `empty-card-*` / `from-guest-*` / `second-*` fixtures inside
`_liveshare-test`, and each suite's own teardown assertion (`both shared trees are back to the
preflight file set`) passed on every clean run. No Obsidian instance was killed or relaunched by this
batch. No build was run and `plugin/main.js` was not written.

---

## 10. One note for whoever touches this next

**The tempting reading of §4.2 is "the polls are too aggressive, raise the timeouts." That is the one
move that destroys the finding.** The budgets are already the sleeps' own; raising them would mean
declaring that a scenario whose criterion says 6 s actually needs 12, which is the same act as
writing the sleep in the first place — a number chosen against nothing, that will be right until the
machine changes.

**The measurement to make instead is the one nobody has:** how long does a canvas change *actually*
take to reach the peer, as a function of how recently the previous one was written? The instrument
for it is now in the tree — `LS_S56_FAST=1` and the `observed after Xs of a Ys budget` lines are a
latency histogram waiting to be read. The answer decides whether §6.2 is a rig-pacing note or a
product defect, and it costs one run either way.

**And the second thing.** The census grew by five between B37's measurement and mine, in files two
siblings were editing, in 75 minutes (§1.2). Whatever number this report leaves, **re-derive it
before you trust it.** The command is at the top of §1.1.
