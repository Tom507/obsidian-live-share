# Stop-line triage — what is done, what is open, and what "done" would mean

**Written by the Dispatcher, 2026-08-07.** Ranked by *what a user loses*, not by how interesting the defect is.

Gate at the last clean commit (`93936ef`): **2975 tests, 405 files, `tsc` clean, register checker exit 0.**

---

## 1. The headline

**Every defect that could silently destroy a user's notes and was found this run is now fixed.** Ten signals
closed today, four of them data-loss:

| | What it did to a user | Evidence |
|---|---|---|
| **S119** | every `.md` in the share truncated to **0 bytes** on restart, `.canvas` untouched | reproduced in a harness + 18 live zero-byte files, 14 inside 75 ms |
| **S129** | **opening a note** could bind an empty doc over the editor and Obsidian would persist it | trigger demonstrated through a real subscribe race, with a control that binds normally |
| **S115** | a guest joining had **its own vault** handed to `trashFile` | candidate set demonstrated: 5 of a 6-file vault |
| **S116** | same, when the host shared whole-vault | fixed with a pre-join baseline; the trash loop actually executed in test |
| **S126** | *(our own regression)* legitimate deletes refused on peers that never opened the note | found live, fixed by asking the document instead of the peer |

Plus **S114** (a whitespace shared-folder shared *nothing*, silently), **S125** (offline edits overwritten with
no conflict copy), **S123** (a new canvas never reaching a peer), **S118**, and **S128** — the generator behind
four of the above.

**S128 is the one that matters structurally.** `waitForSync` resolved on a signal meaning *"the relay has
nothing more to say"*, and six call sites read it as *"the data has arrived"*. Fixing instances one at a time
is how this run got four of them. It is now fixed at the source and all six consumers are audited.

---

## 2. Open, ranked by user cost

### Tier 1 — a user loses work or sees permanent divergence

| Signal | What happens | Notes |
|---|---|---|
| **S120** | a rename/move/delete issued within **~1 s** of that file arriving from a peer is **silently and permanently dropped** — no retry, no notice, no self-healing. Three clients held three different names 5 min later. | **A fix is in flight and uncommitted** (see §5). The mute exists to break echoes and is swallowing user intent; an exact content-based discriminator already exists elsewhere in the codebase. |
| **AC6 residual** | a guest holding a **stale** canvas that wins the subscribe race seeds it; the host's later subscribe sees a non-empty doc, `doc-wins`, and **the host's canvas is overwritten**. | Narrow reachability, real data loss. **Closes for free** if guests never seed — i.e. with S122's host-mediated design. |
| **S124** | dragging a file **out** of the share makes peers **follow it out** and write it **outside** `sharedFolder`. In one run two peers disagreed — one removed its copy, one kept it. | Fix in flight and uncommitted. |

### Tier 2 — a capability is missing or a guarantee is decorative

| Signal | What happens |
|---|---|
| **S122** | a `.canvas` created on a **guest** reaches nobody and enters no manifest. Owner has ruled this a required capability; host-mediated design sanctioned in `BUILD_SPEC` §7. |
| **S127** | `lastSessionEndedAt` was `0` in all three live vaults after a full day, so **S125's discard branch has never once run in the field**. Either an ordinary quit does not stamp — making the clutter-prevention decorative — or it does and nothing has tested it. |
| **S117** | the whole-vault reconcile refusal is announced through a channel the user can switch off. Correct-by-design, never destructive, but a user with notifications off gets a silently non-reconciling session. |

### Tier 3 — instrument and process

**S130** (the suite's default is zero latency, which is exactly what hides S128 — partly addressed),
**S121** (concurrent rename never converges, but only inside a **50 ms** window, so near-unreachable by
humans), **S112/S113** (rig readers more permissive or shorter-lived than their subjects), and the
**partial-test-double** trap, which has now silently skipped whole code paths in **four** packages and is the
single most productive process fix available.

---

## 3. What is NOT validated, stated exactly

**None of S123, S126, S128 or S129 has run in a real vault.** All are unit- and harness-proven. Two live runs
were attempted; the first stalled on a poller that neither succeeded nor timed out, the second died on the
account spend limit during Phase 0.

**And a structural limit that no amount of effort removes:** all three Obsidian instances run on **one
machine**, so every client is the same distance from the relay. A *symmetric* delay cannot open the
first-arrival window at all — measured: the window shut at a **10 ms** subscribe gap under **40 ms** of
one-way delay. **The S128 family's trigger is unreachable in this rig.** Reproducing it needs two peers at
genuinely different distances. This is capability, not laziness.

The field trigger, in closed form (**S131**): `NO_PEERS ⟺ seederDelay > subscribeGap + readerDelay`. In plain
terms — **a peer on a slower link than yours loses the race to seed, and you are told the document is new.**
Any mixed-latency session (mobile or another continent vs fibre) sits on the wrong side of that cliff.

---

## 4. The stop line — what "done" should mean

Ranked, and the first two are the honest minimum:

1. **One clean live run** of the existing battery on a fresh build: the ordinary path unbroken, **S126's
   delete reaching peers that never opened the note**, S123's canvas reaching *both* guests repeatedly, and
   S125's discard branch reachable at last. This is the only item that converts today's ten fixes from
   *proven* to *proven in the product*.
2. **S120 and S124 landed** — both fixes are already written and uncommitted.
3. **S122** — the owner has called it a required capability, and it closes the AC6 residual with it.
4. Everything else is Tier 3 and is a judgement call about how much instrument debt to carry.

**What "done" does not require:** S121's 50 ms rename window, and the residual instrument signals. Those are
real and recorded; they are not what stands between this and a working product.

---

## 5. In-flight work at risk

W3 died **immediately before committing** WP108 (S120 + S124). The tree carries uncommitted changes to
`file-ops.ts`, `vault-events.ts`, `control-handlers.ts`, `e2e-control.ts` and a new `__tests__/v2/wp108/`.

**The suite is RED with it: 15 failures across 5 files.** They are *not* product breakage — WP93's census
test deliberately pins the exact set of `isPathMuted` consumers and reddens when it changes, which is
precisely what S120's fix does (`file-ops.ts` 8→9 calls, the second file's call gone). Updating that pin,
with justification, is part of the package and W3 never got there.

**Preserved at `H:/tmp/wp108_rescue/` — a 415-line patch plus the new test directory.** The working tree is
left exactly as W3 left it; nothing was committed and nothing was reverted. Its break-table copy-asides were
all restored (zero `.pre-v2-smoke` files remain), so the interruption was clean apart from the missing commit.
