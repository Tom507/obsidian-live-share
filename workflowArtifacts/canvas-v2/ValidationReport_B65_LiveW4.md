# ValidationReport B65 — Worker 4, LIVE, three real vaults

**Batch** `B65` · **Branch** `fix-bugs-and-raceconditions` · **HEAD** `094371c` (unchanged; nothing committed)
**Build under test** `main.js` sha256 **`de48fff4e9f7d58dd1126231a581e6c877acdd682b1557a8af5f5b7250027814`**
(5 675 554 B, `npm run build:e2e` at `094371c`; `npm run build` = `tsc -noEmit -skipLibCheck` exit 0 first)
**Build displaced** `d30f671979efaeb5c22526b1197ccfa56e61e5985766a28b953e08b9dfb5316e` — WP119, none of WP120..WP124
**W4 was the only live actor.** Ports 39431/39432/39433, CDP 9222, throttling arm **CLEAN** (measured 4 ms/hop).

> **The sentence the owner can check:** *on a canvas the host created, with the host's board closed, a guest's
> card move reached the host's own file in **2.03 s** — and the identical gesture on the identical board shape,
> with only the host's bundle swapped back, left the host's file **byte-unchanged after 240.81 s**.*

---

## 1. The five verdicts, one line each

| # | package | does it do what it claims, live? |
|---|---|---|
| 1 | **WP122** — a host-created canvas gets a guest's edit **in the host's file** | **YES.** 2.03 s, host's board closed, no manifest pass. Baseline: never in 240 s. A/B control on the old bundle: **still never, 240.81 s, host file sha unchanged.** |
| 2 | **`S170`** — a guest-created canvas's originator adopts **without** an unrelated manifest change | **YES.** 2.03 s, and the manifest pass counters were **identical before and after the wait** on all three peers. Baseline: 150 s, +90 s, then 0.20 s only when an unrelated note was created. |
| 3 | **WP120** — a presence claim has a lifetime | **YES, and the leak is gone.** 5 claims → **0** on one awareness change after a 22 s idle. 10-minute / 49-round soak on an 11-node board ends at **A=2, B=0, C=3** and peaks at **4**. Baseline: **14 and 15**, 127 % / 136 %, and the count **never fell**. A claim re-touched every 5 s survived **37 s** continuously. |
| 4 | **WP121** — a conflict copy when `doc-wins` would discard | **NOT DEMONSTRATED — and not refuted.** The guard is **wired, reached and evaluated on every canvas cold open** (21 evaluations on B, 23 on C, live), always answering `discarded=0 reason=the document knows every record the local file holds`. **I could not manufacture the state it guards**: on this build `subscribe` publishes the local file's records *before* `coldOpen` runs, so the document learned the file-only record instead of discarding it. See §2.4 — the arm produced a **different** finding instead. |
| 5 | **WP123 + WP124** — the oracle judges by records, and the driver asks it to | **YES, and the `NOT_JUDGED` detector fired for real.** `tools/e2e/ls_records.py`'s first live use: **zero** `NOT_JUDGED` across every round on the build under test; **every** round `NOT_JUDGED` the moment the oracle was asked through a peer running the pre-WP123 bundle. The detector is not decorative. |

**The owner's actual symptom — *"a canvas I created never gets my collaborator's edits"* — is GONE.** Demonstrated,
with a control on the same rig, the same board shape, the same gesture and the same 240 s bound that measured
"never" before.

**Bonus, and it is not a small one:** `S176` has a number (§4), and the run found **three things nobody has
seen before** (§6), one of which is a live divergence that survived a restart.

---

## 2. Per arm — expectation, gesture, result, and what I could not separate

Every expectation below was **written into the driver before the gesture was issued** and never derived from
reading a peer (`S158`). Every canvas verdict is `tools/e2e/ls_records.py::records_converged` — three conjuncts,
`peersAgree` is not one of them. Every round logged `records_line(...)`; the transcripts are on disk (§7).

### 2.0 The instrument, proved before anything was believed

`H:\tmp\b65_p0.py`, board `_liveshare-test/smoke.canvas` (11 nodes, 2 938 B, byte-identical on all three).

| control | expectation, stated first | result |
|---|---|---|
| positive | node `208541a49dc66c4c` is at `(1320, -203)` | `records=SATISFIED green=True peersAgreeOnRecords=True verdict=converged` |
| negative — wrong field | the same node at `y = 4039` | `records=VIOLATED green=False` · `"y: expected 4039, observed -203"` |
| negative — absent node | `b65-no-such-node` at `(1,1)` | `records=VIOLATED green=False` · `"node 'b65-no-such-node' is ABSENT from the board"` |

**A reader that has never been shown failing is not evidence.** This one was shown failing twice, live, before
a single product claim was scored. No geometry read was used as a *product* result here — this arm scores the
instrument only, and says so.

**Could not separate:** nothing. No gesture was issued.

---

### 2.1 ARM 1 — WP122, the headline

`H:\tmp\b65_p1.py` · board `_liveshare-test/b65-hostmade-213413.canvas` · node `b65h0001`

- **Roles at the start of the arm, READ:** `A=guest, B=host, C=guest`, room `21d8aae8`, all `connected:true`.
  **At the end of the arm, READ again:** identical.
- **Build at the start and end of the arm:** `de48fff4…` on all three, both times.
- **Open views before anything was closed** (`open_canvas` replaces the leaf in its pane, so this was recorded
  rather than assumed): all three had `_liveshare-test/smoke.canvas` open. All file views were then detached on
  all three and the result read back (`still: []`).

| step | expectation, recorded BEFORE | gesture | measured |
|---|---|---|---|
| create | `b65h0001` at `(100,200)` `250×60` **on every peer** | **host B** `app.vault.create` | green in **1.01 s**; 174 B, sha `8396cc122132`, identical on A/B/C |
| the edit | **on every peer's FILE**, `b65h0001.x==100` and `y==600` | **guest A**, board open on A only | green in **2.03 s** (bound 240 s) |

- **The host had the board CLOSED — asserted, not assumed, twice.** After the guest opened it:
  `B → {"open": [], "active": null}`. At the end of the 240 s window: `B → {"open": [], "active": null}`.
- **B's file sha `8396cc122132` → `b1125a878c80`, CHANGED=True.** All three end at 174 B, sha `b1125a878c80`,
  `b65h0001 = {x:100, y:600, width:250, height:60}` parsed from each peer's own disk.
- **No manifest pass ran during the wait.** `manifest.lastChange` `pass` was `A=3, B=10, C=11` before the
  gesture and `A=3, B=10, C=11` after it. The baseline's "converged only after four unrelated manifest changes"
  cannot be the mechanism here, because there were none.
- **`records_line` statuses across the whole arm:** `['SATISFIED', 'VIOLATED']`. **`NOT_JUDGED`: never.**

**What I could not separate.**
- The move is issued through the canvas's **own interaction surface** —
  `selectOnly → setDragging(true) → moveAndResize → setDragging(false) → markViewportChanged → requestSave`.
  **It is not a CDP pointer drag, and I am not calling it one.** I chose it deliberately: a pointer drag cannot
  land on an exact coordinate, which would force the expectation to be derived from a post-gesture peer read —
  the exact defect `S158` names. What this arm therefore does **not** cover is the pointer/hit-test path itself.
- The clean (unthrottled) arm was used. I did **not** re-run ARM 1 under the `real` (throttled) arm, so this
  number is for an unthrottled renderer only. The baseline it beats explicitly attributed the failure to
  something other than throttling, but I did not re-measure that.
- Only `x` and `y` were named in the expectation for the edit round, so `text`, `color` and `type` divergence
  would have been invisible to the green (WP124 R2). Edges are invisible to this driver entirely; this board
  had none.

---

### 2.2 ARM 2 — `S170`, the guest-created board and its originator

`H:\tmp\b65_p2.py` · board `_liveshare-test/b65-guestmade-213602.canvas` · node `b65g0001`

- **Roles start / end of arm, READ:** `A=guest, B=host, C=guest` both times. Build `de48fff4…` both times.
- **Originating guest = A. Host = B. Other guest = C.**

| step | expectation, recorded BEFORE | gesture | measured |
|---|---|---|---|
| create | `b65g0001` at `(300,100)` `250×60` on every peer | **guest A** `app.vault.create` | green in **1.00 s** |
| adoption | on every peer's FILE — **the originator A included** — `b65g0001.x==900, y==100` | **host B**, board open on B only, **A closed** | green in **2.03 s** (bound 240 s) |

- **No unrelated file was created, renamed or deleted for the whole of either wait**, and the manifest counters
  say so rather than my word: `pass = A:6, B:13, C:14` immediately after the create and **the identical values**
  at the end of the adoption wait.
- A's file sha `8d40609ce410 → ec15b27bcb03`; all three end at 175 B / `ec15b27bcb03`, `b65g0001 = (900,100)`.
- `getCanvasCreateStats` on the originator: `requested:1, results:1, accepted:1, adoptionsArmed:1,
  adoptionsCleared:1`; host `received:1, decided.materialise:1, materialised:1`; other guest
  `received:1, decided.refuse-not-host:1`. The handshake ran exactly once and the adoption was armed and cleared.
- **A live sighting of the reason the record oracle exists.** One second after the create, the three peers held
  the same board in **two different spellings**: `A=175 B / 8d40609ce410`, `C=175 B / 8d40609ce410`,
  `B=141 B / 50d770cf6330`. The round came back `peersAgreeOnBytes=False`, `peersAgreeOnRecords=True`,
  `green=True`. A byte oracle would have called that board diverged. It was not.
- **`NOT_JUDGED`: never.**

**What I could not separate.** Both halves converged in ~1–2 s, which is far inside the noise floor of anything
I varied, so this arm cannot say *which* of WP122's two seams (the create-result `armCanvasMirrorPass()` or the
host writer bind) carried it — only that neither a manifest write nor an unrelated file was needed. Unthrottled
arm only, as above.

---

### 2.3 ARM 3 — WP120, a claim's lifetime

`H:\tmp\b65_p3.py` · board `_liveshare-test/b65-locks-213816.canvas`, **11 nodes — the baseline's board size**,
opened on all three peers. Roles start/end `A=guest, B=host, C=guest`; build `de48fff4…` start and end.

**The arm was built from the product source, not from the charter, because the two do not say the same thing.**
`acquireLock(nodeId)` defaults to origin `"gesture"` and a `"gesture"` claim is **never** an expiry candidate
(A3). Only `"inferred"` claims expire; they are minted by `main.ts setOnLocalNodeChange → onDiffInferredChange`,
i.e. by a **local node change**, after `INFERRED_LOCK_IDLE_MS = 15 000 ms` without a re-touch. And the sweep runs
**inside the awareness `change` listener and nowhere else** — so a rig with no awareness traffic never sweeps.
§3.1 of the workflow already named this shape; the arm is designed around it instead of tripping over it.

| phase | expectation, recorded BEFORE | measured |
|---|---|---|
| 1 · accumulate | repeated moves of distinct nodes make the claim count **RISE** | A reached **5** claims (`b65l0000,0001,0002,0006,0007`) — exactly its own two rounds' nodes |
| 2 · **the discriminator** | after > 15 s idle **and one awareness change**, the count **FALLS** | idle 22 s → still **5** (no sweep without traffic, as the source says). One cursor update from B → **A: 5 → 0**, `lockedNodes: []` |
| 3 · A3 | a node re-touched every 5 s **survives** the whole window | held on **every** sample from t+5.6 s to t+42.6 s — **37 s continuous**, > 2× the 15 s budget |
| 4 · soak | 10 minutes, the baseline's shape, on 11 nodes | **49 rounds / 590 s.** End `A=2, B=0, C=3`. Max `A=4, B=0, C=3`. Mean `A=2.1, C=2.8`. **The count fell between consecutive rounds on both A and C.** |

**Against the baseline: 14 and 15 claims on 11 nodes (127 % / 136 %), never falling → max 4 (36 %), falling
repeatedly, and reaching 0 on a single awareness event.**

**What I could not separate, and one thing I got wrong.**
- **My phase-3 aggregate boolean is wrong and I am not hiding it.** The script printed
  `a re-touched claim survived 45 s : False`. That is a **driver bug, not a product result**: the first sample
  was taken 0.3 s after the first nudge, before the claim existed, so the `all(...)` was false by construction.
  The nine per-sample rows are in `H:\tmp\b65_p3.json` and show the claim present on every sample from t+5.6 s
  onwards. **Read the rows, not my boolean.**
- **B (the host) held 0 claims throughout**, and in phase 1 **C also showed 0 while it was nudging.** C did
  accumulate (steady 3) during the 590 s soak. I did not chase this down; whether the phase-1 zero is a census
  timing lag, a presence controller not yet mounted, or a real asymmetry between the two guests is
  **unmeasured**, and the phase-1 peak figure should be read with that attached.
- The 22 s idle and the "one awareness change" are separated in time but not in mechanism — I cannot exclude
  that some *other* awareness traffic arrived in the same 2 s window and drove the sweep. What is solid is that
  the count did not move during 22 s of silence and reached 0 within 2 s of traffic.
- No card was **deleted** during the soak, so the baseline's "claims on deleted cards" property was **not**
  re-tested.

---

### 2.4 ARM 4 — WP121, and the finding it produced instead

`H:\tmp\b65_p5.py` / `b65_p5b.py` / `b65_p5c.py` · board `_liveshare-test/b65-conflict-215148.canvas`

**The setup, which worked exactly as designed.** Host B created a one-node board (`b65c0001`); all three
converged (records oracle, green). Obsidian was stopped — verified `alive: False` — and python added
`b65orphan01` to **C's copy only**, with the plugin not running, so the file watcher could not publish it. The
rig was relaunched and a fresh session brought up. Roles were **re-read** at that point (`S139`): `A=guest,
B=host, C=guest`, new room `c3499dd5`. Disk before the attach, verified:

```text
A  [b65c0001]                     173 B
B  [b65c0001]                     173 B
C  [b65c0001, b65orphan01]        339 B   ← the manufactured divergence
```

**Expectation, recorded before the attach:** (a) C's canvas ends up holding the document's records because who
wins is unchanged; (b) a conflict copy appears under `_liveshare-test (conflicts)/` on C holding `b65orphan01`;
(c) C's `sync.conflictCopies` total rises by ≥ 1. **An outcome where the document instead LEARNS the record was
declared in advance to be a different behaviour, not a pass.**

**Measured: (b) and (c) did not happen, and (a) did not happen either — the third outcome did.**

- No conflict copy after **120.19 s**; the conflicts root on C stayed `[]`.
- `sync.conflictCopies` on C: `discarded 11 → 12`, `discardedByArm {canvas: 12}`. The door **was reached**.
- C's debug log names the reason verbatim:
  `CONFLICT COPY SKIPPED: arm=canvas path=…b65-conflict-215148.canvas fileRecords=2 discarded=0
  reason=the document knows every record the local file holds`
  followed by `CANVAS WRITER: … attached (coldOpen=doc-wins)`.
- The document had **learned** `b65orphan01`: C kept both records **and the host B adopted them too**
  (`173 B → 339 B`, `[b65c0001, b65orphan01]`).

**So WP121's guard is live, wired, and evaluated on every canvas cold open** — in the final ~400 KB window of
each peer's debug log, **21** `CONFLICT COPY SKIPPED` lines on B and **23** on C, **every one of them
`discarded=0`** (that is the count in the window read, not a whole-session total). Across a whole live session
there was never a record the document did not know. The copy was not written because the condition never arose,
**not** because the guard is missing. I could not construct the condition from outside the product: `subscribe`
publishes the local file's records *before* `coldOpen` runs, so an offline divergence becomes a **publish**, not
a discard.

**What I could not separate.** Whether the state WP121 guards is reachable at all on a live vault, or only from
inside the code. Producing it live would need either a peer that cannot publish (a durable refusal standing on
that path, i.e. `S176`'s territory) or an instrumented build. **This arm neither confirms nor refutes WP121's
headline; it confirms the guard runs and answers, and that its answer was always "nothing to preserve".**

**Rig defect, disclosed as such.** Part 1 of this arm died on a `HTTP 500` websocket handshake:
`w4rig._resolve_targets` caches `label → ws` per process, the relaunch happened in a **subprocess**, and the
cached url pointed at a renderer that no longer existed. The state was intact and was re-verified from disk
before part 2 ran; nothing was re-manufactured. `_resolve_targets(force=True)` after any subprocess relaunch is
the fix and it is already applied in `b65_p6.py` / `b65_p7.py`.

---

### 2.5 ARM 5 — the A/B control, the one that makes the rest mean something

`H:\tmp\b65_p6.py`. Rule 7: *ask what a passing arm would have shown on the OLD build.* So the identical
gestures were re-issued with the displaced bundle installed on the peers each arm is about.

```text
A  de48fff4e9f7d58d…   ← build under test  (the peer that issues the edit)
B  d30f671979efaeb5…   ← OLD bundle        (the HOST — the peer WP122 changed)
C  d30f671979efaeb5…   ← OLD bundle        (the ATTACHING GUEST — the peer WP121 changed)
```

Roles after the swap and at the end, READ: `A=guest, B=host, C=guest`, room `faa8be1a`.

**ARM 1 CONTROL.** Host B (old bundle) created `b65-ctl-hostmade-215732.canvas` with `b65m0001` at `(100,200)`;
guest A (new bundle) moved it to `(100,600)` through the identical surface; B kept the board **closed**.
Expectation recorded before the gesture: *on the old build the guest's edit does NOT reach the host's file
inside 240 s.*

```text
after 240.81 s          A  b65m0001 = (100, 600)      177 B
                        C  b65m0001 = (100, 600)      177 B
                        B  b65m0001 = (100, 200)      143 B      ← the host, never updated
B's file sha  d2e20e851139 -> d2e20e851139            CHANGED = False
```

**The owner's symptom, reproduced on demand.** Both guests exchanged the edit; only the host's file was left
behind — exactly the baseline's description. The single variable between this and ARM 1's 2.03 s is the bundle
on the host.

**ARM 5 CONTROL.** Same offline-divergence setup, attaching guest on the old bundle: **no conflict copy**
either. Given ARM 4 showed the new build also wrote none *because the condition never arose*, this control is
**uninformative for WP121** and is reported as such rather than counted as a difference.

**The `NOT_JUDGED` detector fired, live, for real.** With the oracle reached through B (old bundle), **every
single round** in this arm returned
`records=NOT_JUDGED … the judgement carries NO 'records' clause row at all … a pre-WP123 bundle, a stale deploy,
or a regression. This is not a failure of the board; it is the absence of a measurement.`
Statuses seen across the control: `['NOT_JUDGED']` and nothing else. On the build under test, across ARMs 0–4,
`NOT_JUDGED` appeared **zero** times. That is WP124's headline defect class caught in the wild, and it is the
strongest positive control the oracle has ever had.

**What I could not separate, stated plainly.**
- **This is a BUILD A/B, not a PACKAGE A/B.** Swapping the bundle swaps WP120, WP121, WP122, WP123 and WP124
  together on that peer. Only WP122 has a mechanism that touches ARM 1 — but this experiment does not by itself
  exclude the other four.
- **A confound I created and then worked around.** `post_via` asks the first peer that answers `ok`, which was
  B — now on the pre-WP123 bundle. So the control's *records* verdicts are all `NOT_JUDGED` and the control's
  convergence claim rests on **parsed disk records read in python**, not on the product oracle. The disk reading
  is unambiguous (`B = y 200`, both guests `y 600`, B's sha unchanged), and `peersAgreeOnBytes` was `false`
  throughout, but the *record* oracle did not adjudicate the control. Ask the new-build peer first next time.

---

### 2.6 ARM 6 — the reverse A/B, and a residual worth the owner's attention

`H:\tmp\b65_p7.py`. The new bundle went back on all three, the rig restarted, and the board ARM 5 left stuck was
re-judged **through A (new bundle)**. Two expectations were stated in advance, deliberately, because a restart
re-seeds the shared document from the host's file: (i) the guests' `y=600` survives, or (ii) the host's stale
`y=200` wins back.

```text
as ARM 5 left it        A (100,200)   B (100,200)   C (100,600)
after 180 s             A (100,200)   B (100,200)   C (100,600)
records verdict         y=600 -> VIOLATED     y=200 -> SATISFIED on the reference reading
                        peersAgreeOnRecords = FALSE        verdict = 'diverged'
                        "record divergence against A: C — b65m0001.y: 600 != 200"
```

**A board left divergent by the old build did not self-heal after the upgrade.** The restart re-seeded the
document from the host's stale value and A adopted it; C kept `y=600` and had not converged 180 s later. The new
build converges *new* edits promptly (ARMs 1–2) and did **not** reconcile this *pre-existing* divergence.
The board was deleted in cleanup, so this residue is gone from the vaults — but the behaviour is not.

**What I could not separate.** Whether C would have converged on a longer bound, or on an open/close, or on the
next edit. I bounded it at 180 s and stopped; the deletion in §7 ended the observation.

---

## 3. Builds and roles — the ledger

### 3.1 `main.js` sha256 on all three vaults

| when | A | B | C |
|---|---|---|---|
| **before this run installed anything** | `d30f671979efaeb5…` | `d30f671979efaeb5…` | `d30f671979efaeb5…` |
| **start of the run (build under test, installed, read back)** | `de48fff4e9f7d58d…` | `de48fff4e9f7d58d…` | `de48fff4e9f7d58d…` |
| ARM 1 start / end · ARM 2 start / end · ARM 3 start / end · ARM 4 | `de48fff4…` | `de48fff4…` | `de48fff4…` |
| **ARM 5, the A/B control (deliberate)** | `de48fff4…` | **`d30f671979efaeb5…`** | **`d30f671979efaeb5…`** |
| **END OF RUN** | `de48fff4e9f7d58d…` | `de48fff4e9f7d58d…` | `de48fff4e9f7d58d…` |

**The end-of-run sha equals the build under test on all three.** The only deviation is ARM 5's control, which is
the experiment itself and is stated as such. `pluginBuild` read `0.6.1+e2e` at every single reading, on both
bundles, and identified nothing — as expected.

Bundle markers verified in the installed bytes before install: `e2eControlPort` 1 · `LIVESHARE_E2E` 1 ·
`e2e-control` 2 · `convergence.judge` 1 · `peersAgreeOnRecords` 5 · `readCanvasRecords` 5 · `bindHostWriter` 4 ·
`preserveRecordsTheDocDoesNotKnow` 2 · `expireIdleInferredLocks` 2 · `armCanvasMirrorPass` 13.

### 3.2 `session.info` roles, read at the start and the end of every arm (`S139`)

| arm | start | end |
|---|---|---|
| P0 instrument | A guest · **B host** · C guest — room `21d8aae8` | — |
| ARM 1 WP122 | A guest · **B host** · C guest | A guest · **B host** · C guest |
| ARM 2 `S170` | A guest · **B host** · C guest | A guest · **B host** · C guest |
| ARM 3 WP120 | A guest · **B host** · C guest | A guest · **B host** · C guest |
| ARM 4 WP121 | A guest · **B host** · C guest (room `21d8aae8`) | after restart: A guest · **B host** · C guest (room `c3499dd5`); at end identical |
| ARM 5 control | A guest · **B host** · C guest (room `faa8be1a`) | A guest · **B host** · C guest |
| ARM 6 restore | A guest · **B host** · C guest (room `02786f68`) | A guest · **B host** · C guest |

Roles did **not** migrate in this run. They were read every time anyway.

At bring-up, before any session existed, the stale settings on disk reported **two hosts** (A and C both
`role: host`, both `connected:false`, all three carrying a dead room id). Every session was ended through the
product's own `end-session` / `leave-session` commands with a real click on its confirm modal before a fresh room
was started. Worth knowing for anyone who reads `session.info` on a cold rig and believes it.

---

## 4. `S176` — the number

**Question:** how often does `getCanvasGuid` answer `null` on a live vault? When it does,
`main.ts:3730`'s `refusalIdentity` is `null`, `CanvasPersistence` degrades to WP63, and WP121's durable-refusal
protection becomes in-memory only.

`H:\tmp\b65_p4.py` · 10 shared canvases × 3 peers = **30 samples per census**.

| census | `canvasSync.getCanvasGuid == null` | `manifest.getCanvasGuid == null` |
|---|---|---|
| resting — every view closed, nothing touched this session | **12 / 30 = 40 %** | **0 / 30 = 0 %** |
| **immediately after an ATTACH — the moment `main.ts:3730` reads it** | **0 / 30 = 0 %** | **0 / 30 = 0 %** |
| every canvas open | 0 / 30 = 0 % | 0 / 30 = 0 % |

**The answer at the call site is 0 of 30.** The null is real but it is a **cold-cache** state, and it has a
clean shape: on the two **guests** the six canvases not exercised this session read `null` from `canvasSync`
while the manifest always held a guid; on the **host** it was never null. A seventh sample of the same shape
turned up independently in ARM 4's diagnosis — peer A's `canvasSync.getCanvasGuid` for the diverged board was
`null` while `manifestGuid` was `0aef19e346fab06fd98814515197d6f1`.

**What I could not separate, said next to the number and not after it.** Nothing in the product records the
value that was actually passed at each historical attach. This is a census of *the same expression*, taken at a
time of my choosing, including immediately after an attach — it is **not** a log of the call site. A build that
recorded `refusalIdentity` at each attach would turn 0/30 into a fact about the call site instead of a strong
proxy for it. I also could not read the doc-handle precondition: my probe read
`syncManager.docs.get(path)`, which returned `false` for every canvas including ones actively attached, so that
accessor is the wrong map for the canvas arm and its `false` means nothing.

---

## 5. Demonstrated vs argued

### Demonstrated — the rig did this

- A guest's card move reached the **host's own file** on a **host-created** canvas in **2.03 s** with the host's
  board closed and no manifest pass (ARM 1).
- The identical gesture with only the host's bundle swapped left the host's file **byte-unchanged after
  240.81 s** while both guests held the new value (ARM 5).
- A guest-created board's **originator** adopted the host's edit in **2.03 s** with no unrelated file created
  and identical manifest pass counters before and after (ARM 2).
- A presence claim count went **5 → 0** on one awareness change after a 22 s idle, and a 10-minute / 49-round
  soak on 11 nodes ended at **A=2, B=0, C=3** with a maximum of **4** (ARM 3).
- A claim re-touched every 5 s was **still held after 37 s** of continuous re-touching (ARM 3, per-sample rows).
- WP121's conflict-copy predicate ran on live canvas cold opens — **21 `CONFLICT COPY SKIPPED` lines on B and
  23 on C** in the final ~400 KB of each debug log — and answered
  `discarded=0 reason=the document knows every record the local file holds` every time (ARM 4).
- The live oracle judged a records clause, passed a true expectation and **failed two false ones** (P0).
- `ls_records.py` returned **`NOT_JUDGED` on every round against a pre-WP123 bundle** and on **no round** against
  the build under test (ARM 5 vs ARMs 0–4).
- Two peers held **one board in two byte spellings** (175 B vs 141 B) with `peersAgreeOnRecords=True` and
  `peersAgreeOnBytes=False` — the byte oracle was wrong and the record oracle was right, live (ARM 2).
- A board diverged offline was **learned by the document**, propagated to the host, and left a **third peer
  behind** for over ten minutes (ARM 4 / §6).
- A board left divergent by the old build **did not self-heal** across an upgrade and a restart (ARM 6).

### Argued — implied, not measured here

- That WP122's create-result `armCanvasMirrorPass()` rather than the writer bind is what carries `S170`. Both
  landed in the same package and both arms converged in ~2 s; this run cannot attribute between them.
- That the ARM 5 control isolates **WP122**. It isolates **the bundle**. WP122 is the only one of the five with a
  mechanism on that path, which is an argument from the source, not a measurement.
- That WP121's guard would write a copy if the discard state occurred. Its predicate demonstrably runs and
  answers; the branch that writes has not been seen firing on a live vault.
- That the 40 % resting `null` rate is harmless. It is harmless **at the attach**, measured; whether some other
  caller reads it cold is not something this run examined.
- That throttling is irrelevant to ARM 1. The baseline says so; I ran the clean arm only.

---

## 6. New findings, described in prose — **no numbers allocated**

1. **A record published by one guest during a cold open reached the host but left the other guest behind, and
   stayed there.** After C's diverged file was published at attach, B and C held `[b65c0001, b65orphan01]` while
   A held `[b65c0001]` — for more than ten minutes, verdict `diverged`, `peersAgreeOnRecords=false` from the
   product's own oracle. A had attached to that board **90 seconds earlier** and written `nodes=1`; nothing
   reached it afterwards. A had the board closed, and `canvasSync.getCanvasGuid` for that path on A was `null`
   while the manifest had a guid. This is the mirror image of the defect WP122 just fixed, on the **guest** side,
   and it is not the same thing as ARM 1's result — in ARM 1 a guest with the board closed *did* receive the edit
   in 2.03 s. Something about a cold-open publish does not reach a peer that already attached.

2. **A divergence created under the old build survives the upgrade.** Restoring the build under test on all three
   vaults and restarting did not reconcile a board whose peers disagreed; the restart re-seeded the document from
   the host's stale value, one guest adopted it, the other kept its own, and 180 s later they still disagreed.
   The new build fixes the *flow*; it does not appear to repair a board that is already split. Any rollout onto a
   vault that has been diverging for weeks should expect this.

3. **The offline-divergence recipe cannot produce a `doc-wins` discard on this build.** `subscribe` publishes the
   local file's records before `coldOpen` evaluates, so a file-only record becomes a publish rather than a
   discard. Every live conflict-copy evaluation visible in the logs reported `discarded=0`. This is good product
   behaviour and a bad testing situation: WP121's write branch has no live route from outside the product.

4. **A cold rig reports two hosts.** Before any session was started, `session.info` on A and C both read
   `role: host` with a dead room id and `connected:false`, while B read `guest`. Nothing was wrong — the
   settings are the last session's — but a reader that trusts `session.info` on a freshly launched rig gets a
   two-host answer.

5. **The `visible-console` log silently stopped capturing mid-run and the process kept going.** ARM 3's log
   froze at line 17 for eleven minutes while the script created a board, opened it on three peers and ran four
   phases; the full 247 lines appeared only after the process exited. Anything relying on a live tail of that
   log would have concluded the run had hung. Every script after ARM 3 tees its own transcript to
   `H:\tmp\b65_p*.log`.

6. **`_resolve_targets` caches CDP websocket urls per process and a subprocess relaunch invalidates them
   silently.** The next `ev()` fails with `InvalidStatus: HTTP 500` on the websocket handshake, which reads like
   a dead renderer. One arm was lost to it. `_resolve_targets(force=True)` after any relaunch is the fix.

7. **The old bundle is identifiable from its ledger shape as well as its sha.** `sync.conflictCopies` on
   `d30f671979efaeb5…` returns `{total, byArm, failed, discarded}` with **no `discardedByArm`**, which the build
   under test always includes. A cheap second deploy check that does not need a file hash.

---

## 7. Cleanup ledger, and the state the rig was left in

**Created by this run, in the vaults (6 canvases, all in `_liveshare-test/`):**

```text
b65-hostmade-213413.canvas       ARM 1   host-created board
b65-guestmade-213602.canvas      ARM 2   guest-created board
b65-locks-213816.canvas          ARM 3   11-node lock board
b65-conflict-215148.canvas       ARM 4   conflict board + b65orphan01
b65-ctl-conflict-215732.canvas   ARM 5   control conflict board
b65-ctl-hostmade-215732.canvas   ARM 5   control host-created board
```

**All six deleted** through the product's own `app.vault.delete` from the host, each read back
`deleted: true`. **End-of-run census: `b65-*` remaining = `[]` on all three vaults.**

**Share census:**

| | start | end | delta |
|---|---|---|---|
| A | 25 | 25 | none |
| B | 25 | 25 | none |
| C | 23 | **25** | **+2**: `w4d-clean-s126-guest-093252.md`, `w4d-clean-s126-host-093252.md` — a previous round's `.md` files that C was missing and picked up during this run's sessions. Not mine, not created here; disclosed because the count changed. |

**`.pre-v2-smoke` residue: `[]` on A, `[]` on B, `[]` on C.** No aside file was written into any vault — the
displaced bundle was copied to `H:\tmp\b65_old_main.js`, outside the vaults, deliberately.

**Plugin directories, end of run** — identical file *names* to the start on all three; only `main.js` content
changed, and it changed back:

```text
A, B   data.json · data.json.wp88-b34.armed · data.json.wp88-b34.pre · main.js ·
       main.js.0.5.9.bak · main.js.bak · main.js.pre-wp100 · main.js.pre-wp102 ·
       main.js.pre-wp107 · manifest.json · manifest.json.bak · styles.css · styles.css.bak
C      data.json · main.js · main.js.pre-wp100 · main.js.pre-wp102 · main.js.pre-wp107 ·
       manifest.json · styles.css
```

`manifest.json` and `styles.css` were already byte-identical to the source on all three and were **not written**.

### 🔴 Changed and not intended — full disclosure, unsoftened

**I changed the bytes of seven pre-existing canvases on vault A.** ARM 4 (`S176`) opens every shared canvas on
every peer to sample `getCanvasGuid` at attach time. An attach runs the `doc-wins` cold open, which rewrites the
file in the serialiser's spelling. On vault A, seven boards were rewritten:

| board | A: start → end | B and C |
|---|---|---|
| `smoke.canvas` | **2 938 B → 2 345 B** | 2 938 B, unchanged |
| `second-011125.canvas` | 165 → 125 B | 165 B |
| `wp37probe-031340.canvas` | 270 → 192 B | 270 B |
| `wp79-035734-one.canvas` | 345 → 249 B | 345 B |
| `wp79-035734-two.canvas` | 159 → 119 B | 159 B |
| `wp79-035734-three.canvas` | 159 → 119 B | 159 B |
| `wp79-035734-diverged.canvas` | 306 → 228 B | 306 B |

**No data was lost, and that is measured rather than assumed.** Every one of the seven was re-parsed on all
three peers and compared field by field, every field, not only the four the records clause names:

```text
smoke.canvas                  nodes A=11 B=11 C=11    A-vs-B recordsEqual TRUE    B-vs-C recordsEqual TRUE
second-011125.canvas          nodes 1/1/1             TRUE                        TRUE
wp37probe-031340.canvas       nodes 2/2/2             TRUE                        TRUE
wp79-035734-one.canvas        nodes 2/2/2             TRUE                        TRUE
wp79-035734-two.canvas        nodes 1/1/1             TRUE                        TRUE
wp79-035734-three.canvas      nodes 1/1/1             TRUE                        TRUE
wp79-035734-diverged.canvas   nodes 2/2/2             TRUE                        TRUE
```

The difference is **whitespace only** — the third spelling this project has been tripping over since `S174`,
produced live, on the owner's boards, by nothing more than opening them. Per the owner's ruling the vaults are a
playground and **nothing was restored**. I am naming it because a byte-level reader looking at vault A tomorrow
will see seven changed boards and should know why, and because it is a clean live confirmation that
byte-identity is not a reachable target for `.canvas` on this build.

**`smoke.canvas` is healthy: 11 nodes, records identical on all three peers.** This is *not* the withdrawn
318-node claim from `DISPATCHER_STATE` §6 and I am not restating it.

**Not touched, verified:** `ARCHITECTURE.md`, `README.md`, `docs/security.md`, the `.bak` files, the third
`obsidian.json` registration (vault C was already registered; the registry was not opened), the `FinaleAbgabe`
symlink, and the relay host — no compose command was issued and nothing was deployed.

**Secrets:** `data.json` was never read as content, never printed, never logged, never copied into a fixture.
The only thing recorded is sha256-of-bytes: A `5f35d4b78877f711…`, B `28567eac7201263b…`, C `a20c56285f91c65b…`.
The session invite carries live credentials and was never read into python — the host copied it to the clipboard
through its own product behaviour and each guest read the clipboard inside its own renderer; python saw a 12-hex
sha prefix and a length. No secret passed through any agent tool.

**Repository:** `git status` is byte-identical to how I found it — one untracked
`workflowArtifacts/canvas-v2/temp.md` that was already there and is **not mine**. **Nothing was staged, nothing
was committed, no branch was changed.** `plugin/main.js` is gitignored, so both builds left no repo change.

**The rig was left running:** three Obsidian instances on the build under test, one live session
(room `02786f68`, A guest / **B host** / C guest, all `connected:true`), the throttling-off flags in force, CDP
on 9222, and the share back to 25 files on all three.

---

## 8. Handoff (Rule 13)

**Established, with file and path:**

- `tools/e2e/ls_records.py` has now **run live** and R1 is closed. The two-line import from WP124 §8 works
  unchanged against a real control port; `H:\tmp\b65_lib.py` is the whole of the glue (transport + a
  `logged_wait` that emits `records_line` on a cadence so a transcript can be grepped afterwards). It imports
  the repo module by path and re-implements none of it.
- `H:\tmp\b65_p0.py` is the instrument proof and should run first in **every** future round: positive control,
  wrong-field negative, absent-node negative, three lines of verdict.
- `H:\tmp\b65_install.py` installs by sha256 and **writes no aside file into any vault** — the displaced bundle
  goes to `H:\tmp\b65_old_main.js`. This is why `.pre-v2-smoke` is `[]`.
- `H:\tmp\b65_launch.py clean|real` opens **all three** vaults by URI with the CDP + throttling flags on the
  first invocation and proves the arm with a chained-`setTimeout` clamp probe. `w4c_launch.py` only brings up
  whichever vault windows Obsidian happens to restore — in this run that was vault C alone, and it cost four
  minutes before anyone noticed.
- Transcripts: `H:\tmp\b65_p4.log`, `b65_p5.log`, `b65_p5b.log`, `b65_p5c.log`, `b65_p6.log`, `b65_p7.log`.
  Machine-readable: `b65_p0.json` … `b65_p7.json`, `b65_install.json`, `b65_arm.json`.
  **ARM 1, ARM 2 and ARM 3 have no self-written transcript** — they predate finding 5 — and live only in
  `b65_p1.json` / `b65_p2.json` / `b65_p3.json` and the console logs under
  `tools/_console_runtime/{84326cfc,f7984f62,26385764}/console.log`.

**Rejected, and why:**

- **Re-typing a driver.** `S179`'s whole lesson. The rig chain `w4rig → w4c_lib → w4d_lib → w4e_lib →
  wp119_lib` already had CDP, disk readings, gestures, the presence census and the bounded polls. Only the
  repo-tracked oracle transport is new.
- **Scoring any canvas on bytes.** ARM 2 produced a live 175 B vs 141 B split on an agreeing board within one
  second of a create. A byte verdict would have been wrong there and wrong again on the seven boards in §7.
- **A CDP pointer drag as the primary gesture.** It cannot land on an exact coordinate, so the expectation would
  have had to be read back off a peer — `S158` wearing a better costume. The canvas's own interaction surface
  was used instead and the report says so in every place the result appears.
- **`canvas.simulateEdit`.** Permanent do-not-use list; never called.
- **Restoring anything in the vaults.** Owner's ruling. Disclosed instead (§7).
- **Running the headless vitest suite as a verdict.** Not run at all. `S181` makes it intermittently red and it
  is the Dispatcher's to measure on a quiet tree.

**Residuals left deliberately, for whoever takes the next round:**

- **WP121 has no live route.** Reaching its write branch needs either a standing durable refusal on the path
  (which is `S176`'s territory) or an instrumented build that can suppress the subscribe-time publish. A package
  that adds a `canvas.setFlag`-style seam to suppress that publish would make the guard testable from outside.
- **Finding 1 (the guest left behind) is the most important thing in this report after the headline** and it is
  one observation, not a reproduction. It wants a dedicated arm: attach peer X, then have peer Y publish a
  file-only record at its own attach, and watch X.
- **Throttled arm not run.** Every number here is from the `clean` arm. ARM 1 and ARM 2 should be repeated under
  `real` before anyone writes "converges in 2 s" without a qualifier.
- **Edges and unnamed fields are invisible** to the records driver (WP124 R2). No arm in this run used edges, and
  no arm named `text`, `color` or `type`. Quote `peersAgreeOnRecords` with that attached.
- **WP120's "claims on deleted cards"** property was not re-tested — no card was deleted during the soak.
- **My ARM 3 phase-3 aggregate boolean is wrong** (§2.3). The per-sample rows are right. Fix the predicate to
  skip the sample taken before the first claim exists.
- **Ask the oracle through a peer running the build under test.** `post_via(("B","A","C"))` picked the old-bundle
  host in ARM 5 and turned every control verdict into `NOT_JUDGED`. Useful by accident; a trap by design.

---

**Return:** `VALIDATION_PASS` for WP122, `S170`, WP120 and WP123/WP124 — each with a control on the same rig that
could have failed, and WP122 with a full old-bundle A/B that **did** fail. **WP121 is `NOT DEMONSTRATED`**: its
predicate is live, wired and answering on every canvas cold open, and the state it guards could not be
manufactured from outside the product. Three new findings are described in §6 and **no signal number was
allocated**.
