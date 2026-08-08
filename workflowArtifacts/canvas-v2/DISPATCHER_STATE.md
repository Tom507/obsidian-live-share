# Dispatcher State — Obsidian Live Share

**Rewritten from scratch 2026-08-08.** The previous 3,651-line file is in git at `0734b91` if anyone needs
it. Nothing was carried over that could not be re-verified.

> **Organised by CONFIDENCE, not by topic.** This project's recurring failure is a true-sounding claim
> repeated until it becomes background fact — a spec, a register and a charter once all said the same wrong
> thing because they were copies of one unchecked reading (`S166`), and a "destroyed board" turned out to be
> our own test spam (§6). **If you move a line up a tier, say what measured it.**

---

## 1. Where the code is

| | |
|---|---|
| Branch | `fix-bugs-and-raceconditions` |
| **Gate** (Dispatcher-measured, **quiet tree**, at WP124 / `68debdc`) | **3375 tests · 444 files · `tsc` 0 · `npm run build` 0 · `pytest tools/e2e/test_ls_records.py` 38 passed · register exit 0 with its control proved.** Re-measured after each worker left, never quoted. **Read the caveat in the next row — this figure is not "0 failed" unconditionally.** |
| ⚠ **The gate is INTERMITTENT, and it is now attributed — `S181`** | Two consecutive Dispatcher runs on a byte-identical quiet tree: **run 1 = 444/3375/0, run 2 = `1 failed \| 443 passed`.** The failure is `wp101/test_s123_canvas_mirror_race.test.ts:313`, *"re-arms exactly once… over 60 runs"* — **`Error: Test timed out in 5000ms`, not an assertion failure** — and the same test **passes in 1.4 s run alone**. It fails on contention. **This is very probably the earlier UNATTRIBUTED failure at `488cf3a`**, which was recorded but never named. **Do not read a single green run as proof, and never pipe a gate run through `tail` before you know it passed** — that is exactly how WP124's implementor lost the name. |
| Deployed rig build | `d30f671979efaeb5` — **contains WP119**, verified live in all three renderers by code inspection (`pluginBuild` reads `0.6.1+e2e` on every build and proves nothing) |
| Relay | redeployed 2026-08-08 for `S169`; `canvas-create-request` accepted |

**A gate figure is only valid if it was taken on a quiet tree.** Worker figures taken while a sibling was
live are worthless — see §7.

---

## 2. Confirmed LIVE, in three real vaults

The first five on build `93c65f06a347e6cc`, both throttling arms; **WP119 on `d30f671979efaeb5`**. In every case the oracle's expectations were recorded **before** the gesture, and never by reading a peer.

- **`S147`** — sync no longer dies in a background window. **0 of 12** guest×file pairs left unsubscribed,
  against **16 of 16** before, measured under a *deeper* clamp than the one that caused the original
  failure. Link break → restore recovers at +10 s and the host's edit lands.
- **`S148`** — a guest's offline note edit survives rejoin, under **both** setups (close-and-reopen, and
  Leave-session-while-running). A guest left divergent **17 minutes** kept its bytes.
- **`S141`** — the attestation guard holds: 29/30 decisions, 0 refusals, **and the zero is meaningful
  because the total is not**.
- **`S122`** — a **guest can create a canvas**, new *and* imported, byte-identical on all three peers, with
  the originator on the host's document. Owner-required capability, delivered.
- **WP119 — the owner's selection defect.** Proved by **A/B on one variable**: the tester built WP119's *parent*, installed it into **vault B only**, and re-ran the identical arm on the same board with the same gesture. Pre-WP119: the log shows `initial structural reload ok (nodes 11->11)` and **2 uncontested cards jumped**. WP119: `geometry=unchanged`, **0 cards moved**. The clicked card was the one that did not move — the owner's own detail, reproduced. Contested edits still resolve (all three converge, loser's live view included) and the editor guard holds with a positive control.
- **`S134`, `S135`, `S126`, `S123`** — mid-session notes converge; cross-folder `.md` moves propagate from
  both roles; a real delete reaches peers that never opened the note; a new canvas reaches both guests.

---

## 3. Measured, unfixed — the real work queue

- **A guest's edit does NOT reach a HOST-CREATED canvas's file until a human opens it.** Host's file
  unchanged after **240 s** and after four unrelated manifest changes; the host **opens** the board and it
  converges in **0.00 s**. The deciding variable is **who created the canvas** — a guest-created board
  attaches the writer during the create handshake and takes **0.25 s**. Not throttling, not the cursor, not
  whether guests have it open. **`.md` is unaffected** (first poll, 0.00 s).
  → **Top of the queue: it violates the owner's priority-1 ruling (§5).**
- **Byte-identity is not a reachable target for `.canvas` on this build.** Three spellings exist: the
  host's authored form, the canonical serialiser's, and **Obsidian's own**. Records match, whitespace does
  not — and after a guest edit the files diverge in **records** too.
- **`S170`** — a guest-created canvas's originator adopts the host's document only when a **mirror pass** is
  armed, and only a manifest change arms one. Observed 150 s, then +90 s, then **0.20 s** when an unrelated
  note was created. **Not the cursor.**
- **`S164`** — five `subscribe()` exits leave the observer **attached** with the reconciliation unrun. The
  path reads healthy (`observers: true`) while on a host the bytes never reached the shared document.
  **19 `subscribe/no-doc` outcomes under throttling, 0 without.**
- **`S165`** — subscribe recovery is reachable only from the user's rearm gesture, never on reconnect
  (`main.ts`'s `onReconnect` is an inline closure). **Still UNMEASURED live** — `link.restore` performs its
  own resubscribe, so the two cannot be separated without a break released *without* one.
- **`S163`** — `disconnect()` then `connect()` orphans a socket. Reproduced against the real manager.
- **`S167`** — canvases over **512 KB** are refused, not chunked. The bound is *derived* from the relay's
  2 MB `maxPayload`, not guessed.
- **`S168`** — an *empty* guest-created canvas reaches the host but not a third peer until it holds a card.
- **The presence-lock leak, now with numbers.** After 10 minutes / 41 rounds: **vault A holds 14 claims and B holds 15, on an 11-node board** (127 % and 136 %). Some are on **deleted** cards, so the claim set is not even bounded by board size, and the count **never fell**. WP119 bounded the *cost* — a stale claim now buys one per-node revert, `geometry=unchanged`, zero cards moved — but the cause is untouched. **These are WP120's baseline numbers.**
- **`S173`** — a **plugin reload appears to resurrect files onto a guest**: 16 `.md` files carrying a *previous* worker's timestamps appeared on vault B only, and B is the peer that was reloaded three times. **First candidate mechanism for `S149`.** Observed once, not reproduced on demand.
- **`S174`** — the convergence oracle **cannot judge canvas geometry**: `ExpectedContent` has no geometry clause, so a positional expectation returns `unjudgeable`. Node position is exactly what the canvas defects are about, and byte-identity is not a usable substitute (three stable spellings).

---

## 4. Traced in code, NOT measured — do not cite these as facts

- ~~**`coldOpen` → `doc-wins` overwrites a canvas file with no conflict copy.**~~ **MOVED OUT OF THIS
  SECTION BY WP121 — it is now DEMONSTRATED, and then guarded.** The demonstration the project never had
  exists: real `CanvasPersistence`, real `Y.Doc`, real `attachCanvasPersistence`, no double for `flush` or
  the serializer — a record present in the file before is **gone from disk after, and gone from the whole
  fake vault**. It was **green on unmodified HEAD before any WP121 code**, which is what makes it a
  demonstration rather than a test of the fix. Same for a file-only edge, with a positive control.
  **The withdrawn 318-node figure is NOT what moved it** — that claim stays withdrawn (§6) and was
  deliberately not restated. See §3-CLOSED.
- **`S160`** — publication is unconditional while the write that would make it true is conditional.
- **`S156`** — `subscribe()`'s **host** arm carries the overwrite shape that was closed on the guest arm.
  WP115 declined to widen it because live evidence suggested host-side overwrite is currently *expected*.
- **`S161`** — the **doc** projection still judges convergence peer-to-peer; `convergence.judge` is not yet
  wired into `tools/e2e/*.py`.
- **`S154`** — the pong watchdog is ~25 s of pure timer, a second `S147` mechanism, uncovered.

---

## 5. Owner rulings — these override any inference

- **FULL CONVERGENCE IS PRIORITY 1.** Every peer's file always in sync. **A guest's edit must reach the
  host's file.** Host preference is a **tie-break for true same-place-same-time conflict only**, never a
  general precedence. **Divergence is never an acceptable steady state, including serialisation-only
  divergence.** → `BUILD_SPEC` §*Full convergence*.
- **Sequencing:** prove functionality → **then** large-canvas support → **then** sweep the remainder into a
  **known-issues catalogue** rather than fixing item by item.
- **`canvas-presence.ts`'s byte-unchanged pin is LIFTED for the lock-lifetime repair only.** The pin must
  be **re-established with a new digest, not deleted**.
- **Guest canvas creation is a required capability** (delivered, §2). Host-mediated; the content-free
  variant was declined twice.
- **The three test vaults are a playground.** Contents do not matter; do not restore anything.
- **Process:** at most two workers; **never run tests in parallel**; **stop before deciding and prompt the
  owner**.

---

## 6. Corrections on record — claims that were wrong

Kept because each was believed and acted on.

- **"Opening a canvas destroyed 318 nodes of the owner's board."** **WITHDRAWN.** The board is healthy —
  **9 nodes, 2,247 B, identical on all three vaults**. The 327-node snapshot was **our own test spam**
  (`b50-032007-ac4-USER`, `card one pren dudes…`). The change is **not attributable** to `doc-wins`; a
  cleanup action is at least as likely, and the owner said so first.
- **`S143` was NOT the live cause** of the unsubscribed-file signature. `docExists:false` proved
  `subscribe()` was never reached. The claim was the Dispatcher's.
- **The selection defect was NOT caused by the recent packages.** `plugin/src/canvas/**` is untouched since
  `9249746`, and a grep of all eight commits for every symbol on the chain returns zero hits. The
  Dispatcher agreed with the owner's suspicion too quickly.
- **Selecting a card does NOT rewrite the `.canvas` file** on the selecting client — measured
  `setDataCount 0`, `requestSaveCount 0`.
- **`S166`** — the manifest write gate is **not** in `updateFile` (it has no role test); it is at the
  `vault-events.ts` call sites. The spec, the register and a charter all said otherwise.
- **The loser-revert's justification has been false since WP21**, which *removed* the lock gate rather than
  rewriting it. `canWriteNode`/`canDeleteNode` have no production consumer.

---

## 7. Process rules that cost something to learn

- **One worker, one batch — ≤3 small related packages, chartered UP FRONT, never accumulated by resuming.**
  Measured: 161k→529k tokens across seven packages, and one worker died on work a fresh agent finished.
- **Concurrent workers in one working copy manufacture FALSE RED.** Two workers reported **21, 19 and 9**
  failures on a tree that was **100% green**, and both blamed a known-flaky class — it did not look like
  noise, it looked like the known problem. **The gate is the Dispatcher's to measure, on a quiet tree,
  after everyone is done.**
- **No partial test doubles.** Six packages lost to them.
- **A counter must increment on EVERY branch, including do-nothing** (`S155`) — otherwise *"declined"* and
  *"never ran"* are the same reading. That cost a full round and misled three readers.
- **A test can pin a defect** (`S162`) — the inverse of a green that cannot fail: a red that fires only on
  the repair.
- **`S153`** — WP92's `no_collateral` asserts a file is absent from `git diff HEAD`, so it is red while
  uncommitted and green once committed. Confirmed three times. **Not a real failure.**
- **Author process rules in `templates/*.template.md`** — the workflow `.md` files are generated and are
  overwritten on every config-panel save.
- **Workers correcting their charter is the norm** — eight in a row did, and every one was right.
- **A junctioned `node_modules` inside a git worktree is destroyed by `git worktree remove --force`** — it deletes *through* the junction. WP119's tester emptied `plugin/node_modules` this way and repaired it with `npm ci` from the committed lockfile (no drift). This is why parallel workers here run **serially in one tree** rather than in worktrees.
- **A green battery can be VACUOUS.** WP119's tester ran a passing battery, then declared it worthless: the loser already agreed with shared truth, so the *old* build would also have moved nothing, and 3 of 4 arms had no contest at all. It rebuilt the battery with a real discriminator. **Ask what a passing test would have done on the broken build** — if the answer is "passed", it measured nothing.

---

## 8. Environment

```text
Vaults (owner's real ones, playground-authorised)
├── H:\Developement\_NeuralAngels\ObsidianOrga            ← A, e2e port 39431
├── ...\ObsidianOrga - Kopie                              ← B, 39432
└── ...\ObsidianOrga - W4TestC                            ← C, 39433
```

- **E2E:** `POST http://127.0.0.1:<port>/command`, body field **`cmd`** — not `command`. **Print the raw
  response**; a wrong field returns a 400 that a careless parser reads as *"no answer"*.
- **Roles migrate between runs.** Read `session.info` at the start and end of every arm.
- `sharedFolder` = `_liveshare-test` on all three, **never empty** (empty shares the whole vault).
- **Never `npx biome check --write`** — it corrupts this tree.
- **`data.json` holds live credentials** — never printed, logged, echoed or fixtured. sha256-of-bytes only.
- Owner's files, never touched: `ARCHITECTURE.md`, `README.md`, `docs/security.md`, deleted
  `USER_STORIES.md`, `.bak` files, the third `obsidian.json` registration, the `FinaleAbgabe` symlink.
- **Relay:** compose must set `name: liveshare`; **never** `--remove-orphans`; `neural-angels-access` is
  protected (verified `RestartCount=0` after the deploy). `n8n` is **not on that host**.
- **`S171`** — that host already runs a compose project literally named **`stack`** spanning
  `neural-angels-access` plus six others. **Owner's infrastructure; we touched nothing.**
- **`S172`** — `neural-angels` went `Exited 8 days` → `Up 16 minutes` near our deploy. No command named it.
  Unexplained, disclosed.

**Instrument traps that have voided runs:** `require('obsidian')` is not resolvable in the renderer;
`executeCommandById('editor:select-all')` returns `false`; `canvas.mirror` reports the **last completed
pass**, so score canvases on disk bytes; `link.break`'s grammar is `{link, shape}`; a symmetric delay is not
a latency test.

---

## 9. The plan

**In flight**

- Nothing. The tree is quiet and the rig is idle.

**Headless-done, NOT live-validated — W4 has not exercised any of this**

- **WP120 — a presence lock needs a lifetime. LANDED** in `3befded` / `aee4bb7`. WP119 §4's reverted design
  recovered and agreed with, plus four A3-protective additions; the load-bearing one is that
  `onReconnect`/`reclaimStillFreeNodes` now carry each claim's **origin** across the withhold — without it a
  claim the user is physically holding comes back expirable. Only `canvas-presence.ts` changed in production;
  `main.ts` byte-unchanged. **Pin re-established, not deleted**, and the Dispatcher verified the digest
  against the committed blob rather than quoting it: 29 831 LF bytes, sha256 `2cefc9a8…16c9`, proved
  discriminating by a one-byte plant (caught on size) and a byte-length-**identical** plant (caught on SHA).
  11-row break table including the charter's mandated mid-gesture plant.
  → **Per §7, a green headless suite is a precondition, not a completion. WP120 is not done until W4 runs it.**

- **WP121 — winning is not a licence to discard. LANDED** in `a546d54` / `723058e`. The `doc-wins` cold open
  now preserves the local `.canvas` beside the share when the projection about to land is missing records the
  file holds. **Who wins does not change** — the copy is additive and the flush stays unconditional.
  **The predicate is record-level and it is NOT `decideConflictPreservation`'s** (that one asks a
  session-boundary question, `mtime` vs `lastSessionEndedAt`). It asks about doc **knowledge**: record keys
  ∪ tombstones. **The charter's own wording was wrong and the implementor corrected it** — a *projection*
  predicate would have fired a conflict copy on **every ordinary delete**, because `buildCanvasData`
  suppresses tombstoned records and deletion in V2 is a value, not an absence (WP19).
  **`main.ts` gained 12 lines of wiring** (an options block through `baseIo`, predicate in its own module) —
  the Dispatcher read the diff against §7's *"logic, not wiring, is an ESCALATE"* criterion and it is wiring.
  → **Headless only. Not live-validated.**
- **A6 settled by measurement, and it inverted the charter's worry**: a standing durable refusal withholds
  the **entire** flush, so the guard needed a **branch skip, not an id exclusion** — an exclusion would have
  been a second rule free to drift. **Its residual is now `S176`** and it is the important half.

- **WP122 — a file with no writer cannot converge. LANDED** in `4a03ac7` / `93c079f`. The host now binds a
  writer for the boards it created. **`S170` is CLOSED** — `armCanvasMirrorPass()` at the create result, with
  `manifestWrites` exactly `["publish:…"]` before and after, so it arms without a manifest write.
  **Arm (a) was built, and the choice is measured rather than asserted:** `coldOpen` is the **only** caller of
  both `hydrateDurableRefusals` (WP90) and `preserveRecordsTheDocDoesNotKnow` (WP121), and `start()` installs
  the observer regardless — so **(b) does not avoid the overwrite, it postpones it to the first remote delta
  and strips both guards off it.** `test_tp05` composes arm (b) out of the real `CanvasPersistence` purely to
  price it: same bytes land, `door.read` never called, **zero** conflict copies, the record gone.
  **Safety demonstration measured, not assumed** (`tp03c`): doc `["g1","h1"]` vs disk `["f9","h1"]` → after
  the bind the canvas holds `["g1","h1"]` and exactly one conflict copy holds `["f9","h1"]`; the control with
  the door unwired loses `f9` with zero copies.
  → **Headless only. Not live-validated. Nothing has been near the three vaults.**
- **⚠ WP122 found that BOTH `main.ts` wiring hunks could be DELETED with the entire suite green** — the fix
  absent from the product and every gate reporting success. Closed inside the package by a `tp06` source
  census with `S53`'s two-half control. Recorded here because it is another instance of the run's dominant
  defect class, and because it landed on *wiring*, which nothing else covers.
- **The charter's own §5 plant does not fail the way it claimed**, and the implementor said so:
  `attachCanvasWriter` early-returns without a doc handle and only the subscribe creates one, so a hoisted
  attach attaches *nothing* rather than flushing. The destruction is real only on the mid-session
  `isSubscribed` path — which is where WP121's guard was demonstrated firing, with a positive control.

- **WP123 — a board is judged by its records, not its spelling. LANDED** in `91afc3f`. **`S178` is CLOSED**
  and the oracle can now judge a canvas by **records** — ids and positions — instead of by bytes.
  **Arm (a) built** (amend both pin families with ledger entries), and arm (b) was **priced by construction**
  rather than argued: a correct record oracle in a separate module produced **0** geometry rows in the object
  the live tester actually reads, `converged:true` over the wire on a board whose card had moved 199 px, and
  a 400 from `convergence.judgeRecords`. So *"no pin touched"* was false — arm (b) needed a `routeCommand`
  edit anyway and bought a split ledger for it.
  **Five §7 amendment-ledger rows entered**, 182 tests before and after, no matcher weakened.
  **Two corrections to the charter's arithmetic, both by measurement:** the import freeze is **two**
  allow-lists (`wp49` as well as `wp72` — WP122's report missed `wp49`), and the `wp116` amendment reddens
  **six** tests, not five.
  **The oracle's own discriminator** is `tp05d`: two peers holding **byte-identical unparseable** content —
  where the byte oracle says they agree perfectly — must come back `peersAgreeOnRecords: false`.
  **Reported subsumption, and it is the honest kind:** on the *clause* side the degraded check is subsumed,
  so a clause-only row **would have passed on the broken build**; `degraded` is load-bearing on the
  *agreement* side only.

- **WP124 — the live driver sends a records expectation. LANDED** in `ecad013` / `68debdc`. **`S179` is
  closed at the driver.** `tools/e2e/ls_records.py` builds the clause, posts it over `convergence.judge`, and
  returns green **only** when the row came back `stated:true/satisfied:true` **and** `peersAgreeOnRecords` is
  true. Measured against the shipped oracle: three spellings of one board (132/102/118 B) → `peersAgree`
  **false**, `peersAgreeOnRecords` **true**, green. **Purely additive — 5 new files, nothing modified.**
  **It corrected my premise and did not need an escalation to do it:** `grep -rn "convergence|peersAgree|judge"
  tools/ --include=*.py` returns **zero** — no repo-tracked driver has *ever* called `convergence.judge`. The
  one that does is `H:\tmp\w4d_lib.py`, **untracked and re-typed every round**. So *"teach the drivers"* could
  not mean editing the closed round scripts; it meant landing the capability in the repo, tested.
  **The load-bearing break (BK1):** with the rig ignoring a stated `records` expectation, it **still returns
  `converged: true`** — so a driver that merely *sent* the clause and read `converged` would have passed and
  measured nothing. 18 of 38 rows red under that plant.

**B65 — LIVE VALIDATION, owner-authorised, three real vaults. VALIDATION_PASS on four of five.**

Build under test `de48fff4e9f7d58d`, installed on A, B and C. **Start sha `d30f671979efaeb5` → end sha
`de48fff4e9f7d58d` on all three, and the Dispatcher re-read all three itself** rather than quoting the
tester. No drift, so the run is valid.

- **WP122 — CONFIRMED LIVE, and the owner's symptom is GONE.** Host-created canvas, host's board **closed**,
  guest moves a card → **the host's own file at 2.03 s.** Baseline was **never**.
  **Proved by A/B on one variable:** the same board, same gesture, host's bundle swapped back to
  `d30f671979efaeb5` → host's file **byte-unchanged after 240.81 s** while both guests held the new value.
  No manifest pass ran during either wait — `manifest.lastChange` counters identical before and after, so
  this is not the old manifest-poke path in disguise.
- **`S170` — CLOSED LIVE.** Originator adopted in **2.03 s** with **no unrelated file created**.
- **WP120 — CONFIRMED LIVE.** Claims **5 → 0** on a single awareness change after 22 s idle. 10-minute /
  49-round soak on an 11-node board ends **A=2 B=0 C=3, max 4, and the count falls repeatedly.**
  Baseline: **14 and 15, never fell.** A re-touched claim survived **37 s** — A3 holds, nothing was expired
  out from under a working user.
- **WP123 + WP124 — CONFIRMED LIVE**, first real use of `ls_records.py`. **Zero `NOT_JUDGED` on the build
  under test; EVERY round `NOT_JUDGED` through a pre-WP123 peer.** The deploy detector fired in the wild,
  which is the only way to know it was ever load-bearing.
- **WP121 — NOT DEMONSTRATED LIVE, and not refuted → `S184`.** The guard is wired and ran on every canvas
  cold open, always `discarded=0`. The discard state could not be manufactured from outside the product.
  **Recorded as untested live, not as safe.**

**`S176` now has a number.** `getCanvasGuid == null` in **12/30 (40 %)** at rest on a cold cache — guests
only, canvases untouched that session, manifest never null — and **0/30 (0 %) immediately after an attach**,
which is where `main.ts:3730` actually reads it. **Tester's own caveat, kept:** nothing logs the value passed
at each historical attach, so this is a census of the same expression, not a call-site log.

**Five new signals from B65: `S182`–`S186`.** `S182` is the one that matters — the guest→guest mirror of the
defect WP122 just fixed, and it was **invisible until the record oracle existed**.

**Disclosed, unsoftened, and NOT the withdrawn 318-node claim:** ARM 4 opened every shared canvas on every
peer, and the attach's `doc-wins` cold open **rewrote seven pre-existing boards on vault A** (`smoke.canvas`
2 938 → 2 345 B, plus six). Re-parsed field by field on all three peers: **records identical on every one** —
whitespace only, the third spelling, produced live by nothing but opening a board. Nothing restored, per the
playground ruling. Filed as `S185`.

**Rig left clean:** all 6 artefacts deleted (`b65-*` → `[]`), `.pre-v2-smoke` residue `[]` on all three,
`data.json` never read as content.
- **WP79 AC4 re-wording is WRITTEN AND AWAITING THE OWNER** — `ImplementationReport_WP122.md` §1.3. The
  in-source comment was rewritten (it lives in the file WP122 owns); **the charter's and the `BUILD_SPEC`'s
  copies are the owner's and were deliberately left untouched.**

**Owner decisions taken 2026-08-08, and they override any inference**

- **The canvas convergence remodel: the NARROW option.** Bind the writer on the host's own creates. The broad
  *"the host's file follows like any peer"* reading was **declined**, as was canonicalise-everywhere.
- **Canvas only.** The second question — canvas-only vs the general file-sync model — was **deferred**, so
  both charters are scoped to `.canvas`. `.md` is measured unaffected (first poll, 0.00 s).
- **WP122's cold-open fork is delegated to the implementer, on condition.** (a) attach-and-flush vs
  (b) attach with the cold open suppressed: W3 picks, but the decision must arrive **argued and broken** —
  the reason, a break table for the arm built, and what it expects would have gone wrong had it built the
  other. If (a), the exact WP79 AC4 re-wording comes back for the **owner** to approve at handover.

**Two corrections the Dispatcher had to make against its own claims (see §6)**

- **The investigation's §5 R1 safety argument is WRONG.** *"`PUBLISH` already seeds the doc from the host's
  file, so an attach is a no-op and WP79 AC4 survives literally"* — verified false in the product source:
  `attachCanvasPersistence` (`canvas-persistence.ts:974`) calls `coldOpen()` **unconditionally**, and
  `coldOpen` on `docNonEmpty` runs `flush()` (`:613-620`, *"overwrite the (possibly stale) file so disk
  matches shared truth"*). The host arm only runs when `localFileExists`, so `docNonEmpty` is true
  essentially always. **A plain attach rewrites the host's file.** The host seed is also a **merge, not a
  replace** (`canvas-sync.ts:4495-4499`), so `doc == file` is a special case, not the general one.
- **The Dispatcher briefed both workers on the WITHDRAWN 318-node destruction** as *"the only demonstrated
  data-loss route in the project"*, having read §6's retraction earlier in the same session. The
  investigation predates the retraction; the Dispatcher did not. WP121's justification is now the honest one:
  WP122 makes an **unmeasured** loss path reachable **by design**, on every already-divergent board at once.

**Then, in order**

1. The §3 queue — the host-created-canvas writer first, then `S164` / `S165` / `S163`.
2. **`S149`** — a deleted file reappeared on two vaults with the owner verifiably away. **Unexplained**,
   never reproduced, and the only open item that might be data integrity rather than convergence.
3. **Large-canvas support / chunking** (`S167`) — owner-sequenced **last**, after functionality is proven.
4. **Known-issues catalogue** — the final step; sweep the remainder in rather than picking them off.

**Signal register:** `SIGNAL_REGISTER.md` is the allocation authority; the Dispatcher allocates.

**The next free number lives in ONE place: `NEXT_FREE` in `check_signal_register.py`. Read it there.**
<!-- signal-register: meta -->

**This file and `SIGNAL_REGISTER.md` §1 both used to carry a copy, and between them the copy went stale
six times** — every one a Dispatcher error, and the last two caught by workers rather than by the
Dispatcher. Both copies are now deleted rather than corrected. That is this run's own rule turned on
itself: *anything that has broken twice under a written rule should get an instrument, not a firmer
sentence.* The instrument already existed and already held the number; the paragraph warning about the
duplicate was itself part of the duplicate.

**When allocating:** append the row to `SIGNAL_REGISTER.md` §3a, bump `NEXT_FREE` in the checker, run the
checker. There is no second number to keep in step.
