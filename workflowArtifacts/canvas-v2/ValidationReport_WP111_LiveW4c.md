# WP111 — Live validation, W4c: the full battery with background throttling controlled

**Worker:** W4c · **Branch:** `fix-bugs-and-raceconditions` · **Charter base:** `397fb4f` (tree clean)
**Date:** 2026-08-08, 02:33 – 04:18 local · **Machine idle, owner away, no human touched a vault.**

---

## The round in six lines

**The throttling arm is not a nuisance variable, it is the variable.** On the same machine, in the same
hour, with the same build and the same gestures: with Chromium background throttling **disabled**, a burst
of eight mid-session notes subscribes on every peer and **zero** files are left orphaned; with it **enabled**
— i.e. what a user actually runs — **all sixteen** file/peer pairs are left permanently unsubscribed, no
retry, no counter, no log, and a later host edit never arrives. `S120`'s unexplained field reading
`MUTE OVERRUN: text held=915ms ceiling=250ms` is a 250 ms `setTimeout` under a 1 s background clamp:
251–262 ms in the clean arm, 877–999 ms in the real one. And in the ordinary three-window configuration
this project has always measured in, **all three renderers report `visibilityState: "hidden"`** — not one
foreground and two behind. Against that, `S123`, `S126` and cross-folder `.md` moves hold in **both** arms,
and `S134`'s four cells converge in 0.3–0.5 s in both.

---

## 0. The build under measurement

Every number in this report was taken against **one** bundle.

| | |
|---|---|
| **New build sha256** | `1ddad2155341adbdf9343212f4292cd16463d5bcfbaa4a65a2010eb270355848` |
| short | **`1ddad2155341adbd`** |
| bytes | 5 152 784 |
| built by | `cd plugin && npm run build:e2e`, exit 0, from a clean tree at `397fb4f` |
| e2e markers in the emitted bytes | `e2eControlPort` ×1, `LIVESHARE_E2E` ×1, `e2e-control` ×2 |
| superseded | `d8f98603ad6ddb1c` (5 156 554 B) — the pinned build, found installed on all three vaults |
| installed to | **A, B and C**, verified by byte-for-byte read-back after the write (`match=True` ×3) |
| `manifest.json` / `styles.css` | already byte-identical to the build output — **not written** |
| `data.json` | never read, never copied, never printed. sha-of-bytes only. |

`pluginBuild` reports `0.6.1+e2e` on all three throughout.

---

## 1. Roles, as actually read (S139)

Read from `session.info` before **every** arm, never assumed.

| when | A (`ObsidianOrga`, 39431) | B (`… - Kopie`, 39432) | C (`… - W4TestC`, 39433) | room |
|---|---|---|---|---|
| pre-run census, 02:33 | guest | guest | **host** | `d7acfb00` |
| Arm CLEAN, 02:38 → 03:22 | guest | **host** | guest | `74ecdd54` |
| Arm REAL, 03:41 → 04:10 | guest | **host** | guest | `c373bde8` |

The host migrated once, at the boundary where the previous session was ended and a new one started
from B. Within each arm the roles were re-read at the start and at the end and did not move.

---

## 2. The throttling arms — and they are real, by two independent measurements

### 2.1 What was launched

| | Arm CLEAN | Arm REAL |
|---|---|---|
| argv | `Obsidian.exe --remote-debugging-port=9222 --remote-allow-origins=* --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows` | `Obsidian.exe --remote-debugging-port=9222 --remote-allow-origins=*` |
| all three vaults answered | 2.1 s after launch | 1.6 s after launch |

**Flag census on the RENDERER processes** (not the browser process): `--disable-background-timer-throttling`
appears on all three renderer command lines in CLEAN and on none in REAL. The other two switches are
consumed by the **browser** process and are not forwarded to renderers — so a command-line check alone
would have been an incomplete instrument. That is why there is a second, functional check.

### 2.2 The functional check — and it is the discriminator

Thirty chained `setTimeout(…, 0)` hops measured inside each renderer. Chromium clamps a **hidden** page's
nested timers to ≥1 s, so ~12 ms/hop is unthrottled and ~1000 ms/hop is the background clamp.

| condition | `document.visibilityState` | ms per hop | a nominal `setTimeout(…, 1000)` |
|---|---|---|---|
| **CLEAN**, all three windows **minimised** | `hidden` on all three | **12 / 12 / 12** | — |
| **REAL**, windows merely occluded (not minimised) | **`hidden` on all three** | — | — |
| **REAL**, minimised, ~1 min in the background (vault A) | `hidden` at probe start | **907** | **1 010 ms** |
| **REAL**, minimised, ~10 min in the background (vault A) | `hidden` at probe start | **9 004** | **27 844 ms** |
| **REAL**, minimised (vault B) | `hidden` | probe **did not return in 120 s**, twice | — |

**Three results follow, and they matter more than any single latency number in this report.**

1. **The flags take effect, and they take effect on the thing that matters.** Under CLEAN, three minimised
   Obsidian windows all report `visibilityState: "visible"`; under REAL, three windows that are merely
   *stacked behind each other* all report `"hidden"`. `--disable-backgrounding-occluded-windows` is what
   suppresses the occlusion signal, and it never appears on a renderer command line — a census that only
   grepped argv would have called this flag inert.
2. **In the ordinary three-window configuration this project has always measured in, ALL THREE renderers
   are backgrounded and timer-throttled.** Not "at most one is foreground and the rest are throttled" —
   *all three*, because the front one is occluded by whatever else is on screen. Every live latency this
   project has recorded was taken under that condition, uncontrolled, and this is the first run that
   states it.
3. **The clamp is not 1 s, it grows.** A `setTimeout(1000)` fired at **27.8 s** after ten minutes in the
   background. `S71`'s "60.00 s ± 0.02" is the same phenomenon at its ceiling, and it is now reproducible
   on demand rather than as a 0.7 % tail.

**Instrument caveat, disclosed:** the probe self-perturbs. In two runs vault A reported
`hasFocus: true` by the time the probe returned, and the trailing part of that same probe ran fast. The
CDP reader is a poke; the numbers above are therefore **lower bounds on the throttling**, never upper ones.
Vault B, which was never poked mid-probe, is the one that did not return at all.

---

## 3. The five predictions

### P1 — `S134`, host-born vs guest-born: **CONFIRMED (both arms), and the prediction's premise was wrong**

Four cells were run per arm, not two. The charter's cells are {host-born, guest-born}; I added
{opened at birth, not opened at birth} because **`app.vault.create` does not make the new file active**,
and `S134`'s whole mechanism turns on the new note being the active file. Both births were driven and
`activeFile` was recorded on every read, so which branch ran is on the record rather than assumed.

Method: create during the live session → wait for bytes on the other two **on disk** → open on all three →
read `observers`/`synced`/`resolution`/`textLen`/`collabBound` on all three → append a distinct marker
`[A]`, `[B]`, `[C]` through each peer's own editor → wait for all three disk copies to be byte-identical
**and** to contain all three markers.

| cell | arm CLEAN | arm REAL |
|---|---|---|
| host-born, opened at birth | converged **0.31 s** | converged **0.52 s** |
| host-born, not opened | converged **0.36 s** | converged **0.50 s** |
| guest-born, opened at birth | converged **0.36 s** | converged **0.50 s** |
| guest-born, not opened | converged **0.36 s** | converged **0.50 s** |

`observers: true`, `synced: true`, `resolution: "peer-state"` on **all three peers in all sixteen readings**,
before and after the edits. Arrival on disk was 0.00–0.05 s in every cell in both arms.

**Verdict: CONFIRMED — after `39255ee` both host-born and guest-born mid-session notes are readable and
convergent on all three peers, and the throttling arm costs about 0.15 s.** The prediction's *pre-fix*
half ("only host-born broke") is **not testable from here** — it is a statement about a build that is no
longer installed, and I did not re-install the old bundle to check it. Recorded as **UNMEASURED**.

### P2 — `S143`, the live signature: **CONFIRMED under REAL, REFUTED under CLEAN — and the mechanism is not the one in `S143`**

This is the largest finding of the round.

**Arm 2a — a burst of eight mid-session notes created on the host, nobody opens them.**

| | arm CLEAN | arm REAL |
|---|---|---|
| bytes reached both guests | 8/8, 0.00–0.05 s | 8/8, 0.00–0.05 s |
| `observers` on the guests, first read | **true** everywhere | **false** on **16 of 16** (8 files × 2 guests) |
| `observers` after a further 45 s | **true** everywhere | **false** on **16 of 16** — no self-healing |
| host's own view | `observers:true`, `synced:true`, `resolution:"no-peers"` | identical |

**Arm 2b — silence the mux on one guest across a subscribe** (`link.break {link:"mux", shape:"silence"}`;
`silenced: true` read back, and `S66`'s warning about `shape:"close"` is why `silence` was used).

| | arm CLEAN | arm REAL |
|---|---|---|
| during the silence | victim A: `observers:false, synced:null, resolution:null, textLen:null`. B and C healthy. | **A *and* C** both `observers:false, synced:null, resolution:null, textLen:null, docExists:false` |
| after `link.restore`, +10 s / +40 s / +90 s | **recovered at +10 s** — `observers:true, synced:true, peer-state` | **still false at +10 s, +40 s and +90 s** |
| host types a marker into the file | reached A in 0.16 s, C in 0.00 s | **never reached A or C in 90 s** — both still hold the 13-byte seed while the host holds 33 bytes |

**What the reading actually is.** On every unsubscribed guest the probe reads `docExists: false` — the
`Y.Doc` for that path **does not exist at all**. `S143` describes `subscribe()` reaching `attachObserver`
and giving up; if that had happened, `getDoc` would already have created the document and `synced` /
`resolution` would carry values. They are `null`. **So the live `observers:false` reading is not
`subscribe()` giving up late — on these peers `subscribe()` never got as far as creating a document.**
The bytes still arrive instantly, over the message-driven file-op path; it is the *document subscription*
that never happens.

**Verdict: P2 CONFIRMED in the sense that matters — under Arm REAL a mid-session file is left permanently
unsubscribed on both guests, with no retry, no counter, no log line and no recovery inside the observation
window, and a subsequent host edit never reaches them. Under Arm CLEAN, in the same session shape and the
same minute of the same night, this does not happen at all.** The *stated mechanism* of `S143` is
**REFUTED as the explanation**: the document is absent, not observer-less.

Control against the obvious confound: **P1 ran in the same REAL session minutes earlier and converged on
all four cells with `observers:true` everywhere.** The difference between P1 and P2a is that P1 *opened*
the file on each peer. So under real backgrounding, opening a note still forces a working subscription;
a note nobody opens is never subscribed and silently stops tracking.

### P3 — `S135`, cross-folder move: **CONFIRMED for `.md` in both arms; the `.canvas` cells are dominated by a different defect**

Method: create in `_liveshare-test/`, confirm it reached the peers on disk, then
`app.fileManager.renameFile` into `_liveshare-test/w4c-<arm>-sub-<stamp>/`, then poll the destination on
the peers' disks.

| mover | ext | arm CLEAN | arm REAL |
|---|---|---|---|
| host | `.md` | destination on both peers **0.00 s** | destination on both peers **0.00 s** |
| guest | `.md` | destination on both peers **0.00 s** | destination on both peers **0.00 s** |
| host | `.canvas` | source reached peers 0.11 s; destination on both peers **0.05 s** | **source never reached either peer in 60 s**; after the rename the destination reached C at **39.97 s** and **never reached A** |
| guest | `.canvas` | **source never reached any peer in 60 s** — so there was nothing to move | same — **source never reached any peer in 60 s** |

**Verdict: CONFIRMED for `.md`, both roles, both arms — cross-folder moves propagate, and the 60 s
non-propagation `S135` was raised for does not reproduce.** `RENAME FOLLOW-UP FAILED:` was grepped for on
all three vaults across both arms, from a recorded byte offset, after a 90–100 s flush wait: **zero hits.**

**The two guest `.canvas` rows are VOID as move tests and must not be read as ones.** The source canvas
never reached a peer, in either arm, so no move could be observed. That is `S122` — *a `.canvas` created on
a guest reaches nobody* — reproducing unchanged on the new build.

The host `.canvas` row is a genuine arm difference and belongs with the first-canvas anomaly in §5.

### P4 — `S137`, attribution: **UNMEASURED — no refusal fired to attribute**

| signature | arm CLEAN | arm REAL |
|---|---|---|
| `EMPTY WRITE REFUSED:` | **0** | **0** |
| `CONFLICT COPY FAILED:` | **0** | **0** |
| `RENAME FOLLOW-UP FAILED:` | **0** | **0** |
| `SEED REFUSED:` | **0** | **0** |
| `PROTECTED PATH REFUSED:` | **0** | **0** |
| `sync timed out` | **0** | **0** |
| `sync.emptyWriteRefusals` ledger | `{total: 0, byArm: {}}` on all three | same |
| `sync.conflictCopies` ledger | `{total: 0, byArm: {}, failed: 0}` | same |

Grepped from a byte offset recorded before each arm, after a 90–100 s wait for the flush lag (`S65`, `S113`).
**The reader was proved able to match first**: over the same window it found `MUTE OVERRUN:` 14/8/26 times
(CLEAN) and 12/8/26 times (REAL), and over a 400 kB historical window it matched `CANVAS WRITER:`,
`LOG SINK:`, `manifest` and `subscribe` on all three vaults. So these zeros are real zeros, not a dead
channel — but they are zeros, so **there was nothing to attribute and the prediction could not be tested.**
Two ordinary rejoins were performed (§4, `S125`) and neither produced a refusal.

### P5 — regression on the new build: **`S123` CONFIRMED, `S126` CONFIRMED, `S125` REFUTED**

**`S123` — a new canvas reaches both guests.** Scored on **disk bytes**, never on `canvas.mirror` (`S138`).

| round | arm CLEAN | arm REAL |
|---|---|---|
| 0 | both guests, A 0.06 s / C 0.00 s, byte-identical | both guests, A 0.09 s / C 0.00 s, byte-identical |
| 1 | both, 0.05 / 0.00 s | both, 0.05 / 0.00 s |
| 2 | both, 0.05 / 0.00 s | both, 0.05 / 0.00 s |
| 3 | both, 0.05 / 0.00 s | both, 0.05 / 0.00 s |

**8/8 rounds reached both guests, byte-identical between the guests, in under 0.1 s. No 78 s first canvas
in either arm.** (But see §5 — the *other* canvas created in this run, in P3, behaved completely
differently in the REAL arm, and I cannot reconcile the two.)

**`S126` — a real emptying of a note closed on the other peers.** The first two attempts at this row were
**VOID and are reported as void, not as negative results**: `app.commands.executeCommandById('editor:select-all')`
returns `false` in this Obsidian build — the command id is not registered — so nothing was selected and
nothing was deleted. The re-run selects the whole document through the Editor API and **verifies
`getSelection().length === getValue().length` (56 of 56 characters) before deleting anything**.

| initiator | arm CLEAN | arm REAL, renderers `visible` at the time | arm REAL, all three renderers `hidden` |
|---|---|---|---|
| host | both peers emptied, **0.00 s** | both peers emptied, **0.00 s** | both peers emptied, **0.00 s** |
| guest | both peers emptied, **0.00 s** | both peers emptied, **0.00 s** | both peers emptied, **0.00 / 0.05 s** |

The other two peers had **zero open leaves**, verified by reading them back, before every gesture. The
empty-write ledger stayed at `total: 0` throughout — the floor did not fire and did not need to. The
throttled column is a genuinely throttled measurement: `visibilityState: "hidden"` on all three at the
start of that run, and the log for that window carries `MUTE OVERRUN: text held=767ms / 775ms / 969ms
ceiling=250ms`, which is the throttled signature and not the 251 ms one.

**`S125` — the offline-divergence branches: REFUTED, and this is a candidate regression.**

Method (Arm CLEAN): host creates a shared note; guest A **leaves the session** through the product's own
`Leave session` command; the host edits its copy; A's copy is diverged by a plain disk write; the mtime is
set **newer** than `lastSessionEndedAt` for branch 5a and **older** for 5b; A rejoins from the clipboard
invite; content and ledgers are read back.

| branch | expected | observed |
|---|---|---|
| 5a, local edit **newer** than `lastSessionEndedAt` | conflict copy preserving the guest's work | **no copy.** All three end at the host's bytes. `sync.conflictCopies` = `{total: 0, byArm: {}, failed: 0}` on all three. The guest's `GUEST-OFFLINE-WORK` line exists nowhere. |
| 5b, local edit **older** | silent overwrite (the discard branch) | same — silent overwrite |

`lastSessionEndedAt` was non-zero and correct on all three throughout (`S127` stays closed: an ordinary
`Leave` / `End session` stamps it; measured again three times tonight).

**I could not attribute this and I am not going to guess.** `conflictCopies.failed` is `0` as well as
`total`, so `preserveLocalVersion` was never *attempted* — this is not a copy that failed, it is a branch
that did not run. **A setup difference from the round that validated `S125` is on the record and may be
the whole story:** that round closed Obsidian, edited on disk, and reopened; mine left Obsidian running,
used `Leave session`, and wrote the file from python. A running plugin sees that write as a vault `modify`
event and Obsidian's own cached `stat` may not be what `syncFromManifest` compares. **Until somebody
reproduces it with a real close/edit/reopen, the honest statement is: on this build, in this setup, a
guest's offline divergence was silently overwritten with no conflict copy and no ledger entry, on both
branches.**

---

## 4. Both arms side by side

| measurement | Arm CLEAN | Arm REAL | ratio |
|---|---|---|---|
| chained timer hops, hidden renderer | 12 ms/hop | 907 → 9 004 ms/hop | **75× → 750×** |
| nominal `setTimeout(1000)` | — | fired at **27 844 ms** | **28×** |
| `visibilityState` of three stacked windows | `visible` ×3 | **`hidden` ×3** | — |
| P1 convergence, mid-session note, 3 peers | 0.31–0.36 s | 0.50–0.52 s | 1.5× |
| P2a mid-session notes left permanently unsubscribed | **0 of 16** | **16 of 16** | — |
| P2b recovery after the link is restored | recovered at +10 s | **never, out to +90 s** | — |
| P3 `.md` cross-folder move, both roles | 0.00 s | 0.00 s | — |
| P3 host `.canvas` reaching peers | 0.11 s | **>60 s / never** | — |
| P5 `S123` new canvas → both guests | 0.00–0.06 s, 4/4 | 0.00–0.09 s, 4/4 | — |
| `MUTE OVERRUN:` held vs 250 ms ceiling | **251–262 ms** | **877–999 ms** | **~3.8×** |
| `EMPTY WRITE REFUSED:` / `SEED REFUSED:` / `RENAME FOLLOW-UP FAILED:` | 0 | 0 | — |

**The `MUTE OVERRUN:` row deserves a sentence of its own.** `S120` recorded
`MUTE OVERRUN: text held=915ms ceiling=250ms` from the field and treated it as an unexplained 3–4× overrun.
Under Arm CLEAN the same ceiling is missed by **1 to 12 ms**; under Arm REAL it is missed by **630 to
750 ms**, with values of 877, 883, 889, 890, 900, 912, 914, 921, 922, 934, 936, 944, 947, 951, 952, 954,
955, 960, 961, 962, 965, 999 ms. **The 915 ms in `S120` is a 250 ms `setTimeout` under Chromium's 1 s
background clamp.** That is a mechanism, measured, with its control.

---

## 5. Anomalies — recorded, not explained

1. **The P3 host `.canvas` and the P5 host canvases disagree, in the same arm, minutes apart.** In Arm REAL
   the P3 canvas never reached either guest in 60 s, and after the rename the destination reached C at
   39.97 s and never reached A at all; four canvases created two minutes later in P5 reached both guests in
   under 0.1 s. In Arm CLEAN the P3 canvas reached both in 0.11 s. This has the shape of `S139`'s
   "the first canvas of a session took 78 s, every subsequent one 0.40–1.22 s" — but the P5 canvases were
   not the first of that session either, so the pattern does not close. **I cannot separate "first canvas
   of a phase", "the session was still recovering from the burst and the severance", and "throttling".**
2. **A file that was deleted and verified absent on all three vaults came back on two of them.**
   `_liveshare-test/w4c-proof-024213.md` was deleted at 02:44 through `app.vault.delete` and read back as
   absent on A, B and C in the same script. At 03:41, after the Arm REAL restart and a fresh session, it is
   present on A and B and absent on C. No gesture of mine touched it in between, and the owner was away.
3. **An emptying gesture leaves the initiator's own disk copy stale while both peers are already at zero.**
   In all four good `S126` rows the two peers reached 0 bytes in 0.00 s while the initiator's own file
   still held the original 56 bytes at the moment of measurement. Most likely Obsidian's own editor-flush
   delay, but I did not wait it out or prove it, so it is recorded rather than dismissed.
4. **A newly created `.canvas` is not byte-identical between host and guests.** Host writes 106 bytes;
   both guests hold 156 bytes of the same content, byte-identical to each other. Consistent across all
   eight rounds in both arms. Presumably receive-side re-serialisation; not investigated.
5. **`link.restore` behaved differently in the two arms.** In CLEAN it returned
   `readyStateAfter: -1 / ABSENT` with `reconnectAttempts: 7` and the session went to `state: "retrying"`;
   in REAL it returned `readyStateAfter: 1 / OPEN` and the session stayed `connected`. The CLEAN case
   recovered the subscription and the REAL case did not — but the link states also differ, so the
   subscription difference is **not cleanly attributable to throttling alone** from these two rows.
6. **`fileop.muteDrops` climbed to 29 / 7 / 35 across the CLEAN arm** (`byKind`: create 25, delete 3,
   rename 1 on A). Per `S132` this counter is dominated by legitimate echo suppression and cannot
   distinguish that from a lost gesture, so no conclusion is drawn from it either way.
7. **Vault B's debug log is 33 MB** against 4.6 MB for A and C. `S30(debuglog)` — unbounded growth — is
   still live and B is an order of magnitude ahead.
8. **Obsidian's index on B listed a file the disk did not have.** The cleanup's `app.vault.delete` on
   `_liveshare-test/w4c-clean-sub-024323/w4c-clean-mv-guest-md-024323.md` threw
   `ENOENT: no such file or directory, unlink`, i.e. `getAbstractFileByPath` returned a `TFile` for a path
   that was already gone from disk. It resolved by itself on the next pass. Not investigated.
9. **A newly emptied note's own vault is the last to see it.** Same as (3) but worth pairing with the
   arm table: the *peers* reach 0 bytes in 0.00 s while the *initiator's* disk still holds the old bytes.
   The propagation is faster than the local save.

---

## 6. Instrument failures in this run, disclosed

Reported because a run that hides these is worth less than one that does not.

1. **`app.commands.executeCommandById('editor:select-all')` returns `false`** in Obsidian 1.13.4 — the id
   is not registered. It selected nothing, and the two `S126` rows built on it were **void, and are
   reported as void**. The replacement selects through the Editor API and asserts the selection length
   equals the document length before deleting.
2. **`link.break`'s grammar is `{link, shape}`.** `S143`/`S66`'s note reads `shape="mux"`; the command
   requires `link: "control"|"mux"` and `shape: "close"|"silence"` (`e2e-control.ts:1063`). The first
   severance attempt was refused with `HTTP 400`, the raw response was printed, and **that row was scored
   as "no severance happened", not as "severance had no effect"** — `link.report` confirmed both links
   `OPEN, silenced:false` at the time.
3. **The clamp probe perturbs its subject.** See §2.2.
4. **`ShowWindow(SW_MINIMIZE)` immediately after launching Obsidian does not take.** The first REAL-arm
   minimise reported the windows minimised while all three renderers still read `visibilityState:
   "visible"`; a second minimise a minute later produced `"hidden"` on all three. Every arm's visibility is
   therefore read back and printed in that arm's own output rather than assumed from the call.
5. **The `S126` REAL rows in §3 were taken while all three renderers read `visible`.** Something restored
   the windows between the battery and that script. It is labelled as such in the table rather than
   presented as a throttled measurement.

Two traps the charter named were avoided and are worth confirming as avoided: `require('obsidian')` was
never used — every gesture goes through `app.vault`, `app.fileManager`, `app.workspace` or the plugin's own
control server; and the `cmd` field was proved by a **negative control** at the start of the run —
`{"command": …}` returns `400` with `{"ok":false,"error":"malformed body: 'cmd' must be a string"}`, and
`{"cmd": …}` returns the session record.

---

## 7. What I did not get to

- **`S125` under Arm REAL.** Both branches were run under CLEAN only. The REAL arm has no offline-rejoin row.
- **`S125` with a real close-edit-reopen.** My arm used `Leave session` with Obsidian still running, which
  is the difference that may explain §3's REFUTED verdict, and I could not close it.
- **The pre-fix half of P1.** Testing "before the fix only host-born broke" needs the *old* bundle
  reinstalled; I did not do that, and no claim about pre-fix behaviour is made here.
- **Attribution of the P2 mechanism.** I established that the guest's `Y.Doc` is absent, which rules out
  `S143`'s stated shape. **I did not find what schedules the guest-side subscribe for a newly announced
  file, and I did not read that code.** That is the next question and it is a code-reading question, not a
  live one.
- **Any relay-side probe.** The relay was not touched at all this run.
- **`S119`'s truncation class, `S115`/`S116`'s reconcile, `S121`'s rename collision.** Out of charter, not
  attempted, no evidence produced either way.

---

## 8. The state the rig was left in

- **Running and connected.** Three Obsidian windows, launched **without** the throttling flags — i.e. the
  configuration a user actually runs, and the same shape the rig was found in — with
  `--remote-debugging-port=9222 --remote-allow-origins=*`.
- Session live, **B host, A and C guests**, one room, `connected: true` on all three.
- `sharedFolder` is `"_liveshare-test"` on all three. Never empty at any point in this run.
- **Build `1ddad2155341adbd` installed on all three vaults**, verified by read-back.
- **Every `w4c-*` artefact this run created was deleted** and the share was compared file-by-file against
  the set recorded at 02:33. See §9 for the exact residue.
- **Zero files remain in our `.pre-v2-smoke` namespace**, as the charter requires. Twelve were removed:
  eleven that pre-dated this run and one per vault that this run created (`main.js.pre-v2-smoke-w4c`).
  The owner's `main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak` and `styles.css.bak` are untouched.
  **Other batches' leftovers are NOT in our namespace and were left exactly as found and are reported
  rather than removed:** `main.js.pre-wp100`, `main.js.pre-wp102`, `main.js.pre-wp107` (all three vaults),
  `data.json.wp88-b34.armed` and `data.json.wp88-b34.pre` (A and B).
- The stray third vault registration in `obsidian.json` (`d171d4db41456e12`, the `.obsidian` subfolder of
  vault B) was **read and not repaired**. `Projects/_external/FinaleAbgabe` was never touched.
- `data.json` was never read, copied, printed or logged on any vault.
- Two files are **deliberately left behind as evidence** and are named in §9.

---

## 9. Cleanup ledger

**Share, after cleanup, read from each vault's own index** — identical to the set recorded at 02:33, with
nothing extra and nothing missing:

- **A (11 entries):** `_liveshare-test (conflicts)/w4b-guestedit (2026-08-07 22-50-33).md`,
  `_liveshare-test/{Properties.md, hello.md, second-011125.canvas, smoke.canvas, wp37probe-031340.canvas,
  wp79-035734-diverged.canvas, wp79-035734-one.canvas, wp79-035734-three.canvas, wp79-035734-two.canvas}`
- **B (9 entries)** and **C (9 entries):** the same, without the conflicts folder.

`EXTRA vs pre-existing` reports only the two folder objects themselves (`_liveshare-test`,
`_liveshare-test (conflicts)`), which the 02:33 census listed by file rather than by folder.
`MISSING vs pre-existing` is **empty on all three**. 175 `w4c-*` artefacts were deleted through
`app.vault.delete`, and deleting on the holder propagated to the peers — the peers' rows read
`already absent`.

**`_liveshare-test (conflicts)/w4b-guestedit (2026-08-07 22-50-33).md` is deliberately left behind.** It is
the predecessor's `S125` 5a evidence, it pre-dates this run, and removing it would destroy the only live
artefact of the branch this report reports as no longer firing.

**Our namespace — 16 files removed, zero remain:**

| vault | removed |
|---|---|
| A | `community-plugins.json.pre-v2-smoke` (36 B); `data.json.pre-v2-smoke` (776 B), `.pre-v2-smoke-b44` (946 B), `.pre-v2-smoke-b56` (974 B), `.pre-v2-smoke-w4wp97` (975 B); `main.js.pre-v2-smoke` (626 711 B), `main.js.pre-v2-smoke-w4c` (5 156 554 B) |
| B | the same seven |
| C | `data.json.pre-v2-smoke-w4wp97` (978 B), `main.js.pre-v2-smoke-w4c` (5 156 554 B) |

`.pre-v2-smoke remaining: []` on all three, read back after the removals.

**Left exactly as found, and reported rather than removed** — these are not in our namespace:

| vault | left in place |
|---|---|
| A, B | `main.js.bak` (596 699 B), `main.js.0.5.9.bak` (581 210 B), `manifest.json.bak`, `styles.css.bak` — **the owner's** |
| A, B | `data.json.wp88-b34.armed`, `data.json.wp88-b34.pre` — another batch's namespace |
| A, B, C | `main.js.pre-wp100` (4 904 632 B), `main.js.pre-wp102` (5 029 152 B), `main.js.pre-wp107` (5 095 473 B) — another batch's namespace |

Note for whoever cleans up next: **vault C has no `main.js.bak`**, so after this run C's only restore point
to a non-e2e bundle is `main.js.pre-wp100/102/107`, which are all e2e-sized. Stated so it is a known fact
rather than a surprise.

**Final read-back, 04:18:**

| | A | B | C |
|---|---|---|---|
| role | guest | **host** | guest |
| room | `c373bde8-e341-4ae8-a642-395a1e561796` | same | same |
| `connected` | `true` | `true` | `true` |
| `sessionManager.isActive` | `true` | `true` | `true` |
| `sharedFolder` | `"_liveshare-test"` | `"_liveshare-test"` | `"_liveshare-test"` |
| `pluginBuild` | `0.6.1+e2e` | `0.6.1+e2e` | `0.6.1+e2e` |
| `main.js` sha | `1ddad2155341adbd` | `1ddad2155341adbd` | `1ddad2155341adbd` |
| `data.json` sha-of-bytes | `bb0fabfcd9555850` | `fc99bccf92bf23a3` | `287ff3fe3a650d78` |
| `debugLogging` | `true` | `true` | `true` |
| empty-write ledger | `{total: 0, byArm: {}}` | same | same |
| conflict-copy ledger | `{total: 0, byArm: {}, failed: 0}` | same | same |

One deletion failed and is recorded: `B delete _liveshare-test/w4c-clean-sub-024323/w4c-clean-mv-guest-md-024323.md`
returned `ENOENT … unlink`. Obsidian's index on B still listed a file the disk no longer had; the entry was
gone on the next pass and B's final share matches the pre-existing set exactly.

---

## Appendix — where the raw evidence is

Console transcripts, complete and unedited, under `tools/_console_runtime/`:

| console | what |
|---|---|
| `6704700d` | pre-run census: process argv, roles, installed shas, share sets, `.pre-v2-smoke` residue |
| `895229d6` | `npm run build:e2e` |
| `da3147b2` / `09ea5b12` | session end through the product's commands; install and read-back |
| `ced8cafb` | Arm CLEAN launch + flag census + clamp probe |
| `ca141087` | Arm CLEAN bring-up, roles read, baseline ledgers |
| `1448ba7e` | instrument proof, including the `cmd`-field negative control |
| `917b1739` | Arm CLEAN battery — P1, P2, P3, P5 |
| `fffeb7dd` | Arm CLEAN battery 2 — `S126` (void), `S143` severance, `S125` both branches |
| `b5feb498` | Arm CLEAN `S126`, gesture verified |
| `636dac2a` | Arm REAL launch + flag census |
| `8f9ab12c` / `65f6a48b` | REAL clamp probes (907 ms/hop; 9 004 ms/hop; 27 844 ms one-second timer) |
| `e404101a` | Arm REAL bring-up |
| `823cf25e` | Arm REAL battery — **the 16-of-16 unsubscribed result** |
| `9318807c` | Arm REAL `S126`, renderers visible |
| `ba92e6bd` | Arm REAL `S126` with all three renderers **hidden**, then the cleanup run |

Machine-readable results: `H:\tmp\w4c_results_clean.json`, `w4c_results_real.json`,
`w4c_results2_clean.json`, `w4c_s126_clean.json`, `w4c_s126_real.json`.
Rig scripts: `H:\tmp\w4c_*.py` (they build on the predecessors' `w4rig.py` / `w4b_lib.py`, which were
reused rather than rewritten).
