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
| **S147** *(P0 — the top of the list)* | **the product does not sync in the configuration every user actually runs.** With Chromium background throttling at its default, **16/16** mid-session notes are left **permanently unsubscribed** on guests (0/16 with it off), and after a link break the guests **never** recover while a host edit sits undelivered for 90 s. **All three windows are `hidden` in the ordinary setup** — merely stacking them is enough. | **WP114 in flight.** `docExists:false` on every orphan, so the failure is **before** `subscribe()`. The clamp reaches **9 s/hop** after ten minutes hidden and **grows without bound**, so no timeout is long enough — the fix cannot be a longer wait. Also retro-explains `S120`'s `MUTE OVERRUN` and `S71`'s 60 s. |
| **S148** *(Tier 1, data loss)* | **conflict preservation was never ATTEMPTED** on a rejoin — `conflictCopies` reads `{total:0}` — and the guest's offline work was silently overwritten on **both** branches. | **OPEN.** `S125` was reported *validated live* one round earlier, so this is either a regression in two commits or a **setup-dependent path**; the two setups differ on the record and the validator declined to guess. **Resolve which before fixing.** |
| **S141** *(potentially P0)* | the empty-write floor is **defeated through the front door of its own guard**: `setActiveFile` publishes `updateFile(file, docText)` **unfloored**, so a host can publish `hash("")` for a file that has bytes — and `syncFromManifest`'s evidence test then reads **TRUE**. S119's outcome, reached through the guard built to stop S119. | **OPEN, and the most dangerous thing found this round.** **Traced in code, NOT measured** — WP109 removed the only known producer, which is exactly why it must not be filed as closed: **the path survives its producer.** Needs its own package, and the standard is a demonstrated write. |
| **S143** | `subscribe()` **gives up permanently and silently** — `attachObserver` is the last statement, and `waitForSync`'s `catch { return; }` plus four other early returns leave `observers: false` with no retry, no counter, no log until the next `startAll`. | **OPEN — and it is the live-signature candidate for S134.** WP109's fix does not explain the live `observers:false`; this does. It is also the amplifier that made S134 last a full day. |
| **S134** *(P0)* | a note created **during** a session never completes document sync, and three peers edit three unlinked copies. | **SEEDING CAUSE FIXED** (`39255ee`), demonstrated through production wiring. **NOT CLOSED** — the live reading needs S143. Falsifiable prediction for re-validation: pre-fix, **only host-born notes broke.** |
| **S135** | a rename that changes a file's **parent folder** never propagates, from either role — 4 attempts, 60 s. Same-folder renames: **~0.1 s**. | **TWO SILENT DROPS FIXED** (`6b191d8`) — a poisoned `pendingRename` promise chain that killed **every later rename and delete**, and S120's surviving gate. **NOT CLOSED**: no seam refuses a cross-folder destination, so the live specificity is unexplained. On the rerun, grep for `RENAME FOLLOW-UP FAILED:`. |
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
3. ~~**S134 and S135.**~~ **BOTH FIXED AND CONFIRMED LIVE** (`39255ee`, `6b191d8`; WP111 P1 across eight
   cells, P3 for `.md` both roles both arms).
4. **S147 — this is the current line, and it is now the whole line.** A collaboration plugin that stops
   syncing when its window is not in front is not shippable, and **that is the default state of every
   window**. Everything below is genuinely secondary to it.
5. **S148** — conflict preservation is not running. Until it is, every other repair is working without a
   net: a mistake that overwrites a user's offline edits will not be caught.
6. **S122** — the owner has called it a required capability, and it closes the AC6 residual with it.
   Confirmed still broken in both arms of WP111.
7. **S141** — potential data loss, still only traced.
8. **S136, S137, S143, S149–S152** — one wastes a user's ten minutes, one a diagnostician's afternoon, and
   the rest are recorded because they are true, not because they are next.

**A note on what the last round actually bought.** WP109 and WP110 fixed real defects and both were
confirmed live. But **the largest finding of the day came from the owner asking whether their own use of
the PC could be involved** — a variable nobody in this project had ever controlled for, sitting underneath
every latency number ever recorded here. Worth remembering the next time a measurement is treated as a
property of the code.

**What "done" does not require:** S121's 50 ms rename window, S140's unexplained one-off, and the residual
instrument signals. Those are real and recorded; they are not what stands between this and a working
product.

---

## 5. WP109 and WP110 — landed, and both corrected the charter they were given

Gate re-measured by the Dispatcher on a **quiet** tree, twice: **3057 / 3057 tests, 410 / 410 files,
`tsc` clean, register exit 0.**

| Package | Signals | Commit | Outcome |
|---|---|---|---|
| **WP109** | S134 | `39255ee` | seeding cause **fixed and demonstrated**; live signature **not** explained → S143 |
| **WP110** | S135, S137 | `6b191d8` | two silent drops **fixed**; attribution **fixed**; live specificity **not** explained |

**Neither signal is closed, and both workers said so themselves.** That is the result worth keeping: each
found a real, permanent, silent defect on the signal's own anchors, demonstrated it through production
wiring, and then **declined to claim it was the thing the live vaults hit.** S134's live
`observers:false` cannot come from the seeding defect (an unseeded guest still reaches `attachObserver`);
S135's live cross-folder *specificity* has no seam that refuses a cross-folder destination.

**Three premises I wrote into those charters were wrong**, and being wrong in a falsifiable way is what
made them cheap to correct:

1. *"No peer ever subscribes the document"* — it does. Nobody puts the bytes **into** it.
2. *"A mid-session file differs by its birth time"* — it differs because `startAll` runs **before**
   `onActiveFileChange`, so `activeFile` is `null` for the whole session-start pass.
3. *"The mute is a live hypothesis for S135"* — refuted **structurally**: no mute is ever keyed on a folder.

**S120 was declared fixed while half-fixed.** The census that closed it enumerated one file's gates; the
surviving gate was in the next file down, and **counted nothing** — so S120's own ledger reported zero
drops over the half that was still broken. Now closed (`6b191d8`), with `S145` recording the part
deliberately left.

**S146 — the gate itself was lying, and this run acted on it.** Both workers reported failures (21, then
19-cold/2-warm, then 9) and both attributed them to the project's own registered-flaky classes. **Zero were
real.** They were contamination from two workers sharing one working copy. A gate that reports failures
that do not exist spends worker attention on phantoms and trains everyone to discount RED — and it hid
inside an explanation the project had already written down. **Next parallel round gets separate worktrees,
and the gate figure is the Dispatcher's to measure on a quiet tree.**

Tree clean at `9fae8b4`. **The WP108 rescue at `H:/tmp/wp108_rescue/` is superseded** — that work landed at
`23fdf01` and the backup can be deleted whenever convenient.
