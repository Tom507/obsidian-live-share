# Implementation Report — Liveness Sweep (waits that cannot complete)

**Batch:** B37 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Authority:** `ImplementationReport_RepresentationBlindnessSweep.md` §6.5 — *"a member this derivation
CANNOT reach … sink = a **wait**; question = is there **any path** that sets the awaited predicate
true? … The two are complementary and the second is unowned. **It deserves a WP.**"*
Plus `ImplementationReport_WP88.md` §11.1, which found the confirmed member and could not own it.

---

## 0. Summary

| | |
|---|---|
| **Is the class limited to the one known member?** | **NO — but very nearly.** It has **exactly one twin**, and the twin is one file over: the **mux** link has the identical defect and nobody had named it. **2 members, both LIVE, both repaired.** |
| **Derivation** | **AST over both languages.** TypeScript compiler API over `plugin/tsconfig.json`; Python `ast` over `tools/obsidian_e2e/**`, `H:\tmp\liveshare_*.py` and the workspace MCP driver. Committed as `workflowArtifacts/canvas-v2/tools/derive_liveness_hangs.mjs` + `derive_liveness_hangs_py.py`. Not a hand list. |
| **Candidates derived** | **197 waits** — 54 TypeScript (10 product, 44 test/harness) + 143 Python (1 in-repo rig module, 142 in the `H:\tmp` scenario scripts). Plus a **147-row command join table** and **11 polled response keys**, used by two further rules. |
| **CANNOT COMPLETE** | **2.** Both **LIVE** (the instrument is landed and its only consumer is a criterion). **0 latent. 0 harmless.** |
| **Blocks forever vs times out** | Both members **BLOCK FOREVER in the sense that matters**: the predicate is never produced, so an *unbounded* waiter never returns and the one *bounded* waiter that exists (`wait_for_ceiling`, 320 s) burns its entire budget and reports `reached: False`. Separately: **21 waits in the census are unbounded** (13 TS, 8 PY) — all of them can complete; see §5. |
| **Positive control** | **PASSES, both halves, executed.** Against the pre-repair tree (`b7a61d6`, detached worktree) the deriver finds the waiter **and** the defect, by name and line. Against the repaired tree it reports `REPAIRED ON THIS TREE` **with positive evidence of the gate** — "not found" and "repaired" are never the same observation. |
| **Second control** | Stage A **exits 3 without emitting a census** when its own input set is empty. **Executed** against a synthetic empty project: `EXIT=3`, no census file written. |
| **Repairs** | **2**, each with an **executed hang** on the unrepaired tree and controls that pass in **both** bands. |
| **Unit suite** | **2398 / 2398 pass, 342 files, 0 fail** — `npx vitest run` from `plugin/`, **2026-08-05 11:18:29**, run alone. Baseline `b7a61d6` in a clean detached worktree, 11:15:09: **2372 / 2372**. |
| **Typecheck** | `npx tsc -noEmit -skipLibCheck` **exit 0**. `npm run build` deliberately NOT run (§7.3). |
| **§7 licences** | **NONE.** No test deleted, skipped, weakened, retitled or amended. Nothing escalated. No `main.ts`, no `e2e-control.ts`, no `server/**`. |

**The one-line finding:** *WP82 gated `onmessage`, `send`, `encryptAndSend` and the ping on `silenced`
and left ungated the one handler that winds the retry chain BACK — on **both** links. So neither link
could be driven to its ceiling by the shape built to drive it there, and the instrument's failure mode
was not a wrong answer but no answer at all.*

---

## 1. Why this derivation, and why it is a different one

The representation sweep asked *"can these operands still discriminate?"*. No amount of type or taint
information about a comparison answers *"can the state this criterion waits for ever be produced?"*.
So the sink changes and the question changes:

| representation sweep | this sweep |
|---|---|
| sink = a comparison | sink = a **wait** |
| question = can the operands differ? | question = can the awaited predicate be **set**, by whom, and is that producer reachable from the **waiter's own preconditions**? |
| evidence = make the check **fail** | evidence = make the wait **hang**, then make it **return** |

And the reason it matters is the asymmetry the run has now met twice:

> A test that cannot fail at least returns an answer. **A criterion that hangs returns nothing at
> all** — and in a batch under time pressure that reads as "slow", or gets killed and re-run.

Three things had to be true of the deriver, each answering a specific past failure of this run:

| requirement | the failure it answers |
|---|---|
| derived from the tree, not authored | a hand list is a memory of the tree, not a measurement (rule 5) |
| **provably able to find the known member** | WP86's census deriver returned EMPTY and both of its *"every site is pinned"* assertions passed on it |
| refuses to run on an empty input set | the same failure, made impossible rather than merely unlikely |

A fourth was added because this sweep repairs its own positive control's subject: **"the defect is gone"
must be distinguishable from "the deriver went blind."** The control therefore has a `repaired()` arm
that demands positive evidence of the gate, and the tool exits **4** if it can produce neither.

---

## 2. The derivation

Two files, one tool. `derive_liveness_hangs.mjs` owns the TypeScript tree and the adjudication and
shells out to `derive_liveness_hangs_py.py` for every Python surface; the Python half is also runnable
standalone.

```
node workflowArtifacts/canvas-v2/tools/derive_liveness_hangs.mjs [<plugin dir>] [<out.json>]
```

### 2.1 Stage A — the vocabulary, derived rather than declared

| # | source | result |
|---|---|---|
| **A1** | functions whose body is **nothing but** a promise resolved by a timer | the sleep vocabulary — **1** helper (`__tests__/wp5/harness.ts:206 sleep`) |
| **A2** | per class: a boolean field assigned `true` somewhere and read as a **bare early-return guard** (`if (this.F) return;`) in **≥2** distinct functions | the **suppression flags** — 6, in 5 classes |
| **A3** | the Python probe's own row count | 38 files, 290 rows |

**8 evidence lines.** The A2 derivation is the load-bearing one and it is worth stating why it is a
derivation and not a synonym for `silenced`: it finds `CanvasBinding.destroyed`,
`CanvasPersistence.destroyed`, `ControlChannel.isDestroyed`, `LiveSharePlugin.isEndingSession` and
**both** `silenced` fields, on the same rule, with no name matching anywhere. *One guard is a
condition; several guards spread through a class are a policy — and a policy with a hole in it is this
sweep's subject.*

**A1 deliberately refuses to call a timer-plus-listener executor a "sleep".** An earlier version did,
and it silently excluded `SyncManager.waitForSync` — a real, bounded, event-driven wait — from the
census entirely. A deriver that quietly drops a whole family is the failure this class is made of, so
the distinction is written into the tool with the reason.

**Stage A self-check:** fewer than 1 sleep helper, or 0 classes with a suppression flag, or fewer than
3 evidence lines ⇒ **`exit 3`, no census.** Executed against a synthetic minimal project:

```
STAGE A SELF-CHECK FAILED: 0 sleep helper(s), 0 class(es) with a suppression flag,
1 evidence line(s). A census derived from nothing proves nothing.
EXIT=3          (and no census file was written)
```

### 2.2 Stage B — what counts as a wait

Classified **by shape**, never by name: `wait_for_ceiling` is found because it is a loop that sleeps,
not because it is spelled `wait_`.

| kind | TS | PY | meaning |
|---|---|---|---|
| `WHILE-POLL` | 8 | 49 | a loop whose body sleeps. Its **exit conditions are the awaited predicate**. |
| `EVENT-PROMISE` | 16 | — | a promise settled by a **callback** or by a settler that **escapes** the executor — never by the executor itself |
| `BLOCKING-CALL` | — | 8 | a call that returns only when something else happens and was given **no timeout** |
| `SLEEP-ORACLE` | 30 | 86 | a bare sleep standing in for a wait. It always completes, which is exactly why it certifies nothing. |
| | **54** | **143** | **197 candidates** |

**Key polymorphism, the analogue of the model tool's `@pN`.** A rig helper `wait_for(predicate, …)`
collapses to the useless atom `predicate` unless the caller's actual lambda is substituted at each call
site. The Python half records `deferredAtoms` and resolves them per call site, so
`wait_for(lambda: paths(GUEST)…)` yields real atoms instead of one meaningless row. Five such helpers
(`wp36`, `wp80`, `wp82`, `wp83`, `wp86`) with 3–12 call sites each.

**Boundedness is reported separately from completability, because they are different defects.**
`bounded-deadline` (a clock against a deadline) → **times out**; `bounded-count` (a counter against a
ceiling) → **times out**; `UNBOUNDED` → **blocks forever**. A bounded wait that can never complete
burns its whole budget and then lies by omission; an unbounded one never returns at all.

### 2.3 Stage C — producers, destroyers, and the guard set of every write

For each of the **116 awaited atoms**, every assignment in the TypeScript tree that writes it: **200
writes**, each carrying its class, its enclosing function, **whether it lives inside an event handler**,
its value, and its **lexical guard set** (the suppression flags tested in conditions enclosing it inside
its own function, plus a top-of-function early-return guard).

Gating is judged **on the write itself and lexically only** — deliberately, and it changes the answer.
`ControlChannel.onopen` calls `this.startPing()`, and `sendPing` *does* consult `silenced`; a one-hop
interprocedural expansion would therefore have declared `onopen` "gated" and the sweep would have found
nothing. What matters is whether the *write* is gated, not whether the handler eventually touches the
flag somewhere.

A write is a **DESTROYER** when its value is `false`, `0`, `null` or `undefined` — it winds the atom
back to its initial value — and a **PRODUCER** otherwise.

### 2.4 Stage D — the three defect rules

**D1 — the ungated destroyer.** A destroyer inside an event handler that does **not** consult its
class's suppression flag, in a class where **at least one sibling handler does**. The sibling clause is
what makes it a derivation of an *inconsistency* rather than an opinion about what ought to be gated.
⇒ **4 rows / 2 sites** (§3).

**D2 — a polled key nothing produces.** Every string key a Python waiter reads out of another
component's response (`control["retryChainEnded"]`), joined against every property name any object
literal, property signature, property declaration or method in `plugin/src` produces.
⇒ **11 distinct polled keys, 0 orphans.**

**D3 — a polled command with no case.** Every rig command name a script asks for, joined against the
`case "…":` labels of `routeCommand`. **This is the S33 shape** — `plugin.settings` reached several
agent briefs as a working command and `routeCommand` has no such case; a criterion polling it would
have waited for a reply that could never come.
⇒ **23 distinct commands polled, 27 router cases, 0 missing.**

**Both absences carry their own control, per rule 15 and its cousin.** For D3: the router set really
contains `session.info` (**true**) and `link.report` (**true**) and really does **not** contain
`plugin.settings` (**false**) — so the set is populated, the join can match, and a nonexistent command
would be flagged. For D2: 11 keys were extracted and matched, including `retryChainEnded`,
`reconnectAttempts`, `fileOpsOnline`, `sharing`, `clientId` — so the extractor is not returning an
empty set that trivially satisfies "no orphans".

### 2.5 THE POSITIVE CONTROL — executed, both halves

```
git worktree add --detach H:/tmp/liveness-red b7a61d6
node workflowArtifacts/canvas-v2/tools/derive_liveness_hangs.mjs /h/tmp/liveness-red/plugin /h/tmp/b37_red_census.json
```

```
--- POSITIVE CONTROL (KNOWN_HANG) ---
  FOUND  WAITER  wait_for_ceiling polls for retryChainEnded
         H:/tmp/liveshare_wp88_e2e.py:209  wait_for_ceiling  [bounded-deadline]
         atoms=control,deadline,get,ok,reconnectAttempts,rep,retryChainEnded,time
  FOUND  DEFECT  onopen destroys retryChainEnded, ungated by `silenced`
         sync/sync.ts:544        SyncManager.onopen    retryChainEnded = false  flags=silenced
         sync/control-ws.ts:281  ControlChannel.onopen retryChainEnded = false  flags=isDestroyed,silenced
```

Both halves found **by name and line**, and the second half found the twin nobody had reported.
On the repaired tree the same command prints:

```
  REPAIRED ON THIS TREE  DEFECT  onopen destroys retryChainEnded, ungated by `silenced`
         sync/sync.ts:539        SyncManager.onopen now consults silenced
         sync/control-ws.ts:278  ControlChannel.onopen now consults silenced
         (re-run against a pre-repair tree to see the control fire)
```

and **exits 4** if it can show neither the defect nor the gate. `KNOWN_HANG` is baked into the tool and
printed on every run, so it cannot be forgotten by whoever runs it next.

---

## 3. The census, and a verdict for every candidate

### 3.1 The two members — waits that CANNOT COMPLETE

| # | site | the wait it breaks | verdict | disposition |
|---|---|---|---|---|
| **1** | `sync/control-ws.ts:278` `ControlChannel.onopen` | any wait for the **control** link's retry ceiling — e.g. `liveshare_wp88_e2e.py:209 wait_for_ceiling` | **LIVE** | **REPAIRED** — §4.1 |
| **2** | `sync/sync.ts:539` `SyncManager.onopen` | the same for the **mux** link | **LIVE** | **REPAIRED** — §4.2 |

**Cannot complete — harmless (unreachable): none. Latent: none.** Both members are reachable by the
landed, chartered `link.break` command, from any rig script, today.

**Why "LIVE" and not "rig-only, therefore latent".** The instrument's *only* purpose is to be the
precondition of a criterion. WP88 hit it while trying to satisfy AC4, and the criterion as written was
unsatisfiable — the highest-cost outcome this defect can have, already paid once. A defect in an
instrument that has already invalidated one acceptance criterion is not latent.

### 3.2 The mechanism, stated once

```ts
this.ws.onopen = () => {
  this.reconnectAttempts = 0;      // ← DESTROYER, ungated
  this.everConnected = true;
  this.retryChainEnded = false;    // ← DESTROYER, ungated
  …
  this.startPing();
};
```

Under `silence` the socket is left OPEN and traffic is suppressed in both directions; the peer's own
pong deadline force-closes it; `scheduleReconnect` fires; the next socket **opens successfully** —
*the relay is reachable, it is this peer that is deaf and mute* — and both counters are wound back. The
chain oscillates on a ~25 s period and never exhausts. A criterion polling `retryChainEnded` gets
`false` forever.

`onmessage` (`control-ws.ts:316`, `sync.ts:592`), `send` (`:380`), `encryptAndSend` (`:480`), `sendMux`
(`sync.ts:1065`) and both pings (`:444`, `sync.ts:822`) all consult `silenced`. **`onopen` was the one
path in each class without the gate, and it is the only one that touches the retry chain.**

### 3.3 The other 195 candidates — verdicts

| family | n | verdict | bound |
|---|---|---|---|
| **Python `WHILE-POLL`** — every poll loop in the rig and in all 30 `H:\tmp` scenario scripts | **49** | **can complete** | **35 bounded-count · 14 bounded-deadline · 0 unbounded** |
| **Python `BLOCKING-CALL`** — 7 × `subprocess.run(taskkill …)`, 1 × the E2E build runner | **8** | **can complete** (the child exits) | **UNBOUNDED — blocks forever if the child does.** Carried up, §6.1 |
| **Python `SLEEP-ORACLE`** | **86** | **always completes**, and certifies nothing | bounded by construction |
| **TS `WHILE-POLL`** — `waitQuiescent`, two product seed-waits, `sendChunked`, 4 harness/test loops | **8** | **can complete** | 3 bounded-deadline · 5 bounded-count |
| **TS `EVENT-PROMISE`** — 4 product (3 modal-backed, 1 sync-listener), 12 test/harness | **16** | **can complete** | 3 bounded-deadline · **13 unbounded** |
| **TS `SLEEP-ORACLE`** | **30** | **always completes**, certifies nothing | bounded |

Each unbounded row was adjudicated individually rather than by family, because "unbounded" is exactly
where a member would hide:

- **`session/auth.ts:28 authenticate`** and **`main.ts` `promptText` / `confirm`** and
  **`ui/import-canvas-modal.ts:56`** — settled by a modal. `PromptModal.onClose` resolves
  **unconditionally** (`ui/modals.ts:44-45`) and `ConfirmModal.onClose` resolves `false` when
  `hasDecided` is false (`:109-110`). **The producer is on every exit path, including dismissal.** This
  is the shape that would be a member if `onClose` had been the decision path — it is not, and the
  distinction is recorded rather than assumed.
- **`__tests__/v2/wp24/harness.ts:77` / `wp25/harness.ts:226` `block(op)`** and
  **`wp81/harness.ts:46`** — deliberate gates whose releaser is **returned to the caller**, so the
  producer is held by the waiter's own frame.
- **`collab.test.ts:268`, `wp28/test_tp04:212`** — `resolveWait = resolve` / `release = resolve`,
  both invoked unconditionally in the test body a few lines later.
- **`wp5/harness.ts:122/126`** (`server.listen` / `server.close` callbacks) and
  **`t3/wp44/test_tp11:62/93`** (`net` socket callbacks) — settled by the runtime; `startAndAwaitBind`
  and `isRefused` additionally carry their own `PROBE_TIMEOUT_MS`.
- **`sync/sync.ts:454 waitForSync`** — a listener-settled promise with a `setTimeout(reject)` in the
  same executor. **Bounded, and it is the one that an over-eager sleep classifier had hidden** (§2.1).
- **The two product poll loops** — `editor/collab.ts:114` (10 × 100 ms, guest waiting for the host to
  seed a `Y.Text`) and `files/background-sync.ts:156` (20 × 100 ms, same) — both fall through when the
  count runs out. They **time out**; they never block.

### 3.4 The `SLEEP-ORACLE` tier — 116 rows, recorded, not in class

Neither a member nor nothing. A bare `sleep(n)` before an assertion always completes, so it can never
hang — but it also never observes the state it was standing in for, which makes it the *other* way to
get an answer that means nothing. **116 of the 197 candidates are this shape**, 86 of them in the
`H:\tmp` scenario scripts (`wp86` 15, `dataloss` 9, `wp80` 8, `wp82` 8, `wp36` 6, `wp87` 6 …). Not a
defect today and explicitly not repaired here — but it is the largest single family in the census and
nobody has decided about it. §6.2.

---

## 4. The repairs — each with an executed HANG and controls

**Method, applied literally: no liveness repair is claimed without the wait having been made to hang.**
The RED band is the unrepaired tree at `b7a61d6` in a **detached worktree** (`H:/tmp/liveness-red`, with
a `node_modules` junction — rule 14, no shared path was reverted, restored or stashed), with the test
file copied in and removed again afterwards.

```
RED  (unrepaired, detached worktree @ b7a61d6) : 7 failed / 4 passed  (11)
GREEN(repaired,   shared tree)                 : 0 failed / 11 passed (11)
```

The **4 that pass in both bands** are the controls. They are why this repair cannot be "end the chain on
every open": *a wait that always completes and a wait that never completes are the same defect in
different clothes.*

The waiter in the test is `liveshare_wp88_e2e.py::wait_for_ceiling` transposed onto virtual time — it
polls the peer's own counter and never the clock, which is the discipline WP88's live row used.
**The mock relay ACCEPTS every reconnection**, and that precondition is itself asserted, because a mock
that refused connections would drive the chain to its ceiling *for the wrong reason* and go green on the
broken tree.

### 4.1 Member 1 — the control link. **LIVE.**

**THE HANG, EXECUTED** (verbatim, RED band):

```
× a silenced control link REACHES `retryChainEnded` — the wait completes
    AssertionError: the wait for the retry ceiling NEVER COMPLETED: after 600000 ms of
    virtual time the chain still reports retryChainEnded=false attempts=0. This is the
    hang, executed: a criterion polling for this state returns no answer at all.
× every suppressed open is ANNOUNCED — the chain does not advance in silence
    AssertionError: a socket was opened and thrown away with no lifecycle event —
    WP82's own rule: expected 0 to be greater than 0
```

`attempts=0` after ten simulated minutes is the whole defect in one number: the counter is not stuck,
it is being **reset**, over and over.

**AFTER** — the same wait completes: `reached: true`, `reconnectAttempts: 10`, exactly one `gave-up`
event with `{link:"control", cause:"exhausted", max:10}`.

**The repair** adds the gate its four sibling paths already had, at the top of the handler:

```ts
if (this.silenced) {
  this.emit({ kind:"abandoned", link:"control", at:"onopen",
              reason:"link silenced: a socket that carries no traffic is not a recovery" });
  this.ws?.close();
  return;
}
```

Three deliberate choices, each with a reason:

- **it closes rather than merely declining to reset.** Leaving the socket open would leave the chain
  stalled on a socket that carries nothing — a *different* hang, and one that also never reaches the
  ceiling. Closing lets `onclose` → `scheduleReconnect` do exactly what it already does.
- **it announces.** WP82's own rule is that no exit from a link's lifecycle is silent. `abandoned` is an
  existing event kind with existing fields; **no type in `link-state.ts` changed.**
- **`forcedClose` is NOT set.** That flag means *"a pong deadline forced this close"* and is AC4's
  discriminator between the two break shapes. A silenced-open abandon is not a pong deadline, and
  borrowing the flag would have corrupted the one signal that tells the shapes apart.

`everConnected` is untouched (S39), and `silenced` is untouched (it belongs to the rig's seam).

### 4.2 Member 2 — the mux link. **LIVE. Derived, not reported.**

Byte-for-byte the same shape at `sync/sync.ts:539`, and it carries an extra consequence the control link
does not:

```
× a silenced mux link REACHES `retryChainEnded` — the wait completes
    AssertionError: the mux wait NEVER COMPLETED: after 900000 ms the chain still reports
    retryChainEnded=false attempts=0
× a silenced mux open does NOT tell the plugin the mux is up
    AssertionError: a silenced mux reported itself CONNECTED while suppressing every frame:
    expected [ true, true, true, true, true, …(30) ] to deeply equal []
```

**Thirty-plus `onConnectionChange(true)` callbacks during one silenced outage.** That is WP82's own
defect — the latch that says "connected" while nothing crosses the wire — **rebuilt inside the
instrument WP82 landed to detect it.** The silenced mux also re-subscribed every document and restarted
its heartbeat on each of those opens.

After the repair: ceiling reached, `reconnectAttempts: 15`, `gave-up {link:"mux", cause:"exhausted"}`,
and **zero** `true` connection callbacks.

### 4.3 The controls — all four pass in BOTH bands

| control | what it forbids |
|---|---|
| **the fixture's precondition: the relay ACCEPTS reconnections** | a fixture that proves the ceiling for the wrong reason. Asserted, not assumed. |
| **an UNSILENCED link that keeps reconnecting NEVER ends its chain** | the repair ending chains it must not end |
| **the `close` shape against an UNREACHABLE relay still reaches the ceiling** | disturbing the path WP88's live row actually used |
| **TP03's POSITIVE CONTROL: the handler slicer sees a gate known to be present** | a structural pin that is vacuous because its scanner reads nothing |

Two further rows are **anti-lobotomy** controls that necessarily fail in the RED band because they
require the ceiling first: `restoreLink()` after a silenced ceiling brings the link back — suppression
lifted, chain re-armed, socket OPEN, and a `send` demonstrably reaching the wire again — on **both**
links. A repair that merely made a silenced link unrecoverable would have passed every row in §4.1/§4.2
and destroyed the instrument.

### 4.4 TP03 — the class pinned structurally

Derived from the two source files **at test time**, never from a memory of them: in both
`ControlChannel` and `SyncManager`, `onopen` must consult `silenced` **before** it touches
`retryChainEnded`. Its positive control asserts first that the handler slicer extracts a non-empty
`onmessage` body **and sees `silenced` there** — a gate known to have been present since WP82. Without
that, a slicer that returned `""` would satisfy the pin perfectly, which is the WP86 failure one level
down.

---

## 5. Numbers, with the time they were measured

| | |
|---|---|
| **Full plugin suite, shared tree, repaired** | **2398 tests, 2398 pass, 0 fail, 342 files** — `npx vitest run` from `plugin/`, **2026-08-05 11:18:29**, run alone |
| **Baseline `b7a61d6`, clean detached worktree** | **2372 tests, 2372 pass, 0 fail, 339 files** — same command, **11:15:09**. 2 suites unloadable (`Cannot find package 'cors'`; no `server/node_modules` in a worktree — the identical artefact WP36 §5.1 and the representation sweep both recorded), contributing 0 tests |
| **Delta attributable to this batch** | **+11 tests, +1 file.** `2372 + 15 = 2387` (the shared tree additionally loads the two worktree-unloadable suites: `wp5/latency` 11 + `e2e/two-host` 4), and `2387 + 11 = 2398`. **The arithmetic closes exactly.** |
| **Sweep suite alone** | `src/__tests__/v2/liveness/` — **11/11** green; **7 failed / 4 passed** on the unrepaired tree |
| **Typecheck** | `npx tsc -noEmit -skipLibCheck` **exit 0** (run immediately after the test file was created, and again at the end) |
| **Census** | **197 waits** { TS 54 · PY 143 } + 147 command rows + 11 polled keys. Positive control passes on the same run. |

**One failure was seen and attributed rather than filed.** The first full run (11:15:19) reported
`1 failed | 2397 passed` — `wp5/latency.test.ts > harness injects a measurable RTT inside the
50–150 ms band`, `expected 210 to be less than or equal to 150`. That run was **concurrent with the
baseline suite in the other worktree**, which I had launched myself. Re-run alone at 11:17: **11/11
pass, measured RTT inside the band.** It is a wall-clock band assertion under machine load, it is not
reachable from anything this batch changed, and it is recorded here rather than quietly dropped — the
clean 2398/2398 above is the run with nothing else on the machine.

**Shared-tree caveat, stated rather than glossed.** A sibling batch (WP87) has uncommitted work in
`plugin/src/main.ts`, `plugin/src/canvas/canvas-adapter.ts`, `plugin/src/canvas/canvas-editing-deferral.ts`,
`plugin/src/testing/e2e-control.ts` and `plugin/src/__tests__/v2/wp87/` **at the time of measurement**.
Every shared-tree number above is measured against a tree that contains their work in progress; the
baseline is taken at `b7a61d6` in a detached worktree precisely so the delta is mine and nobody else's.
Their file set was **re-measured directly from `git status`**, not inherited from a brief, and **none of
it overlaps this batch's two files.**

---

## 6. Found, and carried up

### 6.1 **S55 — eight `subprocess.run` calls with no `timeout`, and one of them is the build**

Derived by rule B, not by inspection. All eight block forever if the child does:

| site | call |
|---|---|
| `tools/obsidian_e2e/install.py:527` `spawning_subprocess_runner` | **the E2E bundle build** |
| `H:\tmp\liveshare_dataloss_e2e.py:137`, `liveshare_e2e_install.py:53`, `liveshare_wp79_e2e.py:115`, `liveshare_wp83_install_verified.py:53`, `liveshare_wp83_relaunch.py:52`, `liveshare_wp85_e2e.py:88` | `taskkill /F` |
| `H:\tmp\liveshare_prefix_probe.py:21` | a one-off probe |

**None is a member of this class** — the producer (the child exiting) is reachable, so they *can*
complete. They are carried up because the consequence of the exception is this sweep's subject: an
`npm run build:e2e` that stalls on a prompt or a lock takes the whole rig with it, with **no timeout, no
output and no way to tell it from a slow build**. The `taskkill` ones are lower risk and higher
frequency. `install.py` is **WP78's file** and the `H:\tmp` scripts belong to other batches, so nothing
here was touched. **Unowned. One `timeout=` argument each.**

### 6.2 **S56 — 116 of 197 waits are a bare sleep standing in for a wait**

The mirror image of this sweep's class: a `SLEEP-ORACLE` always completes, so it can never hang — and it
never observes the state it was standing in for either. 86 of them are in the `H:\tmp` scenario scripts,
concentrated in `wp86` (15), `dataloss` (9), `wp80` (8) and `wp82` (8). Not a defect today, deliberately
not repaired (it is a different class and the scripts are other batches'), and **recorded so the next
sweep does not have to rediscover it.** The census is one command away.

### 6.3 The rig's poll loops are all bounded, and that is worth stating positively

**0 of 49 Python poll loops is unbounded.** Every one either compares a clock against a deadline (14) or
runs a bounded count (35). So the rig cannot hang on a poll — it can only **time out**, which is the
lesser defect, and which is why WP88's `wait_for_ceiling` reported `reached: False` after 320 s rather
than never returning at all. **That the class's one confirmed member happened to be polled by a bounded
waiter is luck, not design**, and the repaired instrument now removes the need for it.

### 6.4 Two rules that found nothing, and the controls that make that meaningful

- **D2, orphaned response keys: 0 of 11.** Every field a rig waiter polls is produced somewhere in
  `plugin/src`.
- **D3, commands with no router case: 0 of 23** polled, against **27** cases.

Both are real absences with a stated pattern and a proven-matching control (§2.4). The S33 shape
(`plugin.settings`, a command that never existed and was listed as working in `DISPATCHER_STATE.md`
until WP82 corrected it) is **exactly** what D3 catches, and it is now a one-command check instead of a
thing somebody has to remember.

### 6.5 The seventh-surface count is now eight, and the shape has repeated

The representation-blindness sweep closed with *"the run has now found this family on seven surfaces …
the common factor is never the check — it is that **something changed underneath a check that was
correct when it was written, and nothing in the system is responsible for noticing.**"*

This batch adds an eighth, and it is a variation worth naming: **the mux member is not something that
changed underneath a correct check — it is a policy that was applied to four of five paths in a class
and to the fifth only by inspection.** `silenced` was added to `onmessage`, `send`, `encryptAndSend` and
the ping in the same commit; `onopen` was not, in either class, in the same commit. Nothing detected the
hole because nothing in the system knows that a suppression flag is supposed to be exhaustive. **The A2
derivation in this tool is that check, and it now exists.**

### 6.6 Process

- **`npm run build` was NOT run**, per the standing warning: it overwrites the shared gitignored
  `plugin/main.js`, and a sibling batch is live in the tree right now. `npx tsc -noEmit -skipLibCheck`
  (exit 0) is the gate used instead.
- **`tsc` was run immediately after the test file was created**, not at the end — the lesson the
  representation sweep paid for twice. Exit 0 at creation and exit 0 at the end.
- **No live E2E.** The repair is in an E2E-only seam; validating it live means driving a real instance
  to a retry ceiling, which needs a build into a `plugin/main.js` a sibling batch is currently using.
  The unit band is decisive here (the whole defect is a state machine over fake timers) and the live row
  is cheap for whoever next runs the rig: `link.break{control|mux, shape:"silence"}`, then poll
  `link.report` — the ceiling now arrives at ~128 s (control) / ~231 s (mux) by the peer's own counter.
- **One detached worktree** was used and left in place for re-measurement: `H:/tmp/liveness-red`
  (`b7a61d6`, the RED band and the deriver's positive control), with a `node_modules` **junction** to the
  main plugin's.
- **No shared path was reverted, restored or stashed** at any point. `git status` was re-read
  immediately before the commit, not earlier in the turn.
- **`liveness-census.json` is deliberately NOT committed.** It embeds absolute `H:\tmp` paths from this
  machine and is regenerated by one command; committing it would pin a snapshot of somebody else's
  scratch directory into the repository.

---

## 7. Constraints discharged

| constraint | status |
|---|---|
| do not repair beyond the class | ✅ — 2 members repaired; S55 and S56 carried up untouched |
| `main.ts` is a sibling's (WP87) | ✅ — re-measured from `git status`, not from the brief; **not touched.** Its two modal promises are adjudicated in §3.3 and left alone |
| `e2e-control.ts:1256` is the *other* class's latent member and not mine | ✅ — not annexed, not edited, not mentioned as mine |
| `npm run build` not used as a gate in a shared tree | ✅ — §6.6 |
| `tsc` on creation of a new test file, not at the end | ✅ — §6.6 |
| detached worktree for the RED band | ✅ — `H:/tmp/liveness-red` |
| rule 14 — no revert/restore/stash of a shared path; `git status` re-read immediately before commit | ✅ |
| rule 15 + cousin — pattern stated and proven able to match, for every absence *and* presence claim | ✅ — §2.4, §2.5, §4.4 |
| no `server/**` | ✅ |
| `BUILD_SPEC_CanvasV2.md` untouched · `WORKFLOW_ANALYSIS.md` not mine | ✅ — left untracked and unstaged |
| `data.json` never read, printed, logged or fixtured | ✅ — §8 |
| no test deleted, skipped, weakened, retitled or amended | ✅ — 11 added, 0 touched |
| every repair has an executed HANG **and** controls proving the wait still ends correctly | ✅ — §4 |

---

## 8. Data-safety statement

No vault file was read, hashed or fixtured. No `data.json` value was read, printed, logged or committed.
No Obsidian instance was launched, no relay contacted, no E2E script run, no vault port opened. No
secret passed through any agent tool. The two product changes are inside `plugin/src/sync/`; the only
other artefacts are this report, one test file and the two deriver files under
`workflowArtifacts/canvas-v2/`. The fixtures use `room`, `tok` and `u1` — the same placeholders WP82's
own tests use, and no user content of any kind. The deriver **reads** the `H:\tmp\liveshare_*.py`
scripts and reports file names, line numbers and identifier names from them; it never reads, copies or
reports a value, and it does not touch `data.json` or any vault path.

---

## 9. One note for whoever touches this next

**The tempting repair is "don't reset the counters while silenced", and it is half a repair.** It leaves
an OPEN socket that carries nothing, with the chain neither advancing nor ended — a *different* wait
that also never completes, and one that would have passed a test asserting only "the counters did not
reset". The repair has to make the chain **progress**, which is why it closes the socket, and why the
test asserts `reconnectAttempts === 10` / `=== 15` rather than merely `retryChainEnded === true`.

**And the second thing.** The reason this sweep found two and not one is the same reason the last one
found five and not zero: the positive control. But there is a wrinkle specific to a *liveness* sweep,
and it is worth carrying: **the repair deletes the deriver's own positive control from the tree.** Once
`onopen` is gated, "the class is empty" and "the deriver went blind" become the same output. That is why
the control has a `repaired()` arm demanding positive evidence of the gate, and why the tool exits 4
when it can show neither. **Run it against `b7a61d6` before you believe any census it gives you** —
including this one.
