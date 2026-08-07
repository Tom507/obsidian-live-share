# Stop-line triage — what is done, what is open, and what "done" would mean

**Written by the Dispatcher, 2026-08-07. Revised 2026-08-08 after the first full live validation.**
Ranked by *what a user loses*, not by how interesting the defect is.

Gate at `26581d2`: **3000 tests, 407 files, `tsc` clean, register checker exit 0.**

---

## 1. The headline

**Every defect found this run that could silently destroy a user's notes is fixed, and the four that
mattered most are now proven in the product rather than only in a harness.** Twelve signals closed:

| | What it did to a user | Evidence |
|---|---|---|
| **S119** | every `.md` in the share truncated to **0 bytes** on restart, `.canvas` untouched | harness + 18 live zero-byte files, 14 inside 75 ms |
| **S129** | **opening a note** could bind an empty doc over the editor and Obsidian would persist it | real subscribe race, with a control that binds normally |
| **S115** | a guest joining had **its own vault** handed to `trashFile` | candidate set demonstrated: 5 of a 6-file vault |
| **S116** | same, when the host shared whole-vault | pre-join baseline; the trash loop actually executed in test |
| **S126** | *(our own regression)* legitimate deletes refused on peers that never opened the note | **VALIDATED LIVE** — see below |

Plus **S114** (a whitespace shared-folder shared *nothing*, silently), **S125** (offline edits overwritten
with no conflict copy), **S123** (a new canvas never reaching a peer), **S118**, **S120**, **S124**, and
**S128** — the generator behind four of the above.

**S128 is the one that matters structurally.** `waitForSync` resolved on a signal meaning *"the relay has
nothing more to say"*, and six call sites read it as *"the data has arrived"*. Fixing instances one at a
time is how this run got four of them. It is fixed at the source and all six consumers are audited.

### What the live run proved (2026-08-07, three real vaults, build `d8f98603ad6ddb1c`)

- **S126** — a real `Ctrl+A`+`Delete`, with the gesture verified to have selected all 56 characters
  *before* it was sent, on a note **closed on both other peers**, reached both: **0.70 / 1.08 / 9.05 s**.
  The empty-write ledger stayed flat — and it had **fired twice earlier in the same session**, so its
  silence here is a measurement rather than a dead instrument.
- **S125** — both branches, including the discard branch that had **never once been reachable in the
  field**. It correctly did *not* fire on the untouched guest **while the same rejoin produced a copy on
  the other peer**. That control is what makes it a result.
- **S123** — reached **both** guests, **4 of 4** rounds.
- **S127 — CLOSED.** The stamp works. The zeros came from sessions ended by killing the process, never by
  the command.

---

## 2. Open, ranked by user cost

### Tier 1 — a user loses work or sees permanent divergence

| Signal | What happens | Status |
|---|---|---|
| **S134** *(P0)* | a note created **during** a session never completes document sync. Bytes and path propagate; **no peer subscribes the document**. `waitForSync` rejects at 10 s, the catch reconfigures the editor to **empty**, `collabBoundFile` is still set — so **everything internal says "bound"** while three peers edit three unlinked copies. **Nothing counts a refusal.** | **WP109 in flight.** Creating a note mid-session is the ordinary case — this is the most reachable defect in the product. Control: a Leave/Start/Join cycle makes them session-start files and the identical arm converges in **0.54 s**. |
| **S135** | a rename that changes a file's **parent folder** never propagates, from either role — 4 attempts, 60 s. Same-folder renames: **~0.1 s**. The subfolder propagates; the file does not. | **WP110 in flight.** No data lost, but the shares diverge **permanently and silently**. |
| **AC6 residual** | a guest holding a **stale** canvas that wins the subscribe race seeds it; the host's later subscribe sees a non-empty doc, `doc-wins`, and **the host's canvas is overwritten**. | Narrow reachability, real data loss. **Closes for free** with S122's host-mediated design. |

### Tier 2 — a capability is missing or a guarantee is decorative

| Signal | What happens |
|---|---|
| **S122** | a `.canvas` created on a **guest** reaches nobody and enters no manifest. Owner has ruled this a **required capability**; host-mediated design sanctioned in `BUILD_SPEC` §7. Next package after the Tier 1 pair. |
| **S137** | the empty-write floor fired **twice on an ordinary rejoin** — the S119 shape, on a plain join. The guard held and is the only reason those bytes survived, but the refusal goes to `console.warn`, so **the paths cannot be attributed**. A floor whose firings cannot be diagnosed is half an instrument. **WP110 package B.** |
| **S136** | *"the room no longer exists"* is shown to the user as an **authentication failure** for ~10 minutes. The credentials are valid; the room was reaped at 24 h. Proved by relay probe with a negative control — two different 403s from one route. Low severity, high annoyance, and it cost a whole validation round. |
| **S117** | the whole-vault reconcile refusal is announced through a channel the user can switch off. Correct-by-design, never destructive, but a user with notifications off gets a silently non-reconciling session. |

### Tier 3 — instrument and process

**S138** (`canvas.mirror` reports the last completed pass, not current state — it **misled a live validator
mid-run**, and is why AC4 had to be scored on disk bytes), **S139** (an unrequested host-role migration
across a restart, and a **78 s first canvas** against 0.40–1.22 s for every subsequent one), **S140** (an
identical unattributed 9→13 byte mutation on all three peers, once, **recorded rather than explained** —
the same discipline that withdrew S105), **S130** (the suite's default is zero latency, which is exactly
what hides S128 — partly addressed), **S121** (concurrent rename never converges, but only inside a **50 ms**
window), **S132** (the mute-drop ledger counts but does not attribute), **S112/S113** (rig readers more
permissive or shorter-lived than their subjects), and the **partial-test-double** trap — which has now
silently skipped whole code paths in **four** packages and is the single most productive process fix
available.

---

## 3. What is NOT validated, stated exactly

**S123, S125, S126 and S127 have now run in real vaults.** S128 and S129 have not, and cannot here — see
below. Everything else Tier 1 and Tier 2 is unit- or harness-proven only.

**The structural limit that no amount of effort removes:** all three Obsidian instances run on **one
machine**, so every client is the same distance from the relay. A *symmetric* delay cannot open the
first-arrival window at all — measured: the window shut at a **10 ms** subscribe gap under **40 ms** of
one-way delay. **The S128 family's trigger is unreachable in this rig.** Reproducing it needs two peers at
genuinely different distances. This is capability, not laziness.

The field trigger, in closed form (**S131**): `NO_PEERS ⟺ seederDelay > subscribeGap + readerDelay`. In
plain terms — **a peer on a slower link than yours loses the race to seed, and you are told the document is
new.** Any mixed-latency session (mobile or another continent vs fibre) sits on the wrong side of that
cliff. Recorded in `BUILD_SPEC` §8 as a user-facing debugging step.

**One methodological result worth keeping:** the live validator **voided its own first run** —
`require('obsidian')` is not resolvable in the renderer, so every editor op threw and cascaded into a bogus
"rename failed" chain — and discarded the finding it had produced. The instrument being wrong is the
ordinary case, not the exception.

---

## 4. The stop line — what "done" should mean

1. ~~**One clean live run** of the existing battery on a fresh build.~~ **MET, 2026-08-07.** The ordinary
   path held, S126's delete reached peers that never opened the note, S123's canvas reached both guests
   4/4, and S125's discard branch was reachable at last. This converted the run's fixes from *proven* to
   *proven in the product* — and, as first runs do, it produced seven new signals.
2. ~~**S120 and S124 landed.**~~ **DONE** (`23fdf01`, `dcf9cd2`).
3. **S134 and S135** — both found by that live run, both Tier 1, both now outrank everything that was left.
   **This is the current line.**
4. **S122** — the owner has called it a required capability, and it closes the AC6 residual with it.
5. **S136 and S137** — one wastes a user's ten minutes, the other wastes a diagnostician's afternoon.
6. Everything else is Tier 3 and is a judgement call about how much instrument debt to carry.

**What "done" does not require:** S121's 50 ms rename window, S140's unexplained one-off, and the residual
instrument signals. Those are real and recorded; they are not what stands between this and a working
product.

---

## 5. In flight

| Package | Signals | Worker |
|---|---|---|
| **WP109** | S134 (P0) | W3c, fresh context |
| **WP110** | S135, S137 | W3d, fresh context |

Tree is clean at `ed0307c`; nothing uncommitted, no rescue state outstanding. **The WP108 rescue at
`H:/tmp/wp108_rescue/` is now superseded** — that work landed at `23fdf01` and the backup can be deleted
whenever convenient.
