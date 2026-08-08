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
| **Gate** (Dispatcher-measured, **quiet tree**, at `d188b0e`) | **3260 tests · 428 files · 0 failed · `tsc` clean · `npm run build` clean · register exit 0** |
| Deployed rig build | `93c65f06a347e6cc` — **does NOT contain WP119**; a tester is rebuilding |
| Relay | redeployed 2026-08-08 for `S169`; `canvas-create-request` accepted |

**A gate figure is only valid if it was taken on a quiet tree.** Worker figures taken while a sibling was
live are worthless — see §7.

---

## 2. Confirmed LIVE, in three real vaults

Build `93c65f06a347e6cc`, both throttling arms, oracle with expectations recorded **before** each gesture.

- **`S147`** — sync no longer dies in a background window. **0 of 12** guest×file pairs left unsubscribed,
  against **16 of 16** before, measured under a *deeper* clamp than the one that caused the original
  failure. Link break → restore recovers at +10 s and the host's edit lands.
- **`S148`** — a guest's offline note edit survives rejoin, under **both** setups (close-and-reopen, and
  Leave-session-while-running). A guest left divergent **17 minutes** kept its bytes.
- **`S141`** — the attestation guard holds: 29/30 decisions, 0 refusals, **and the zero is meaningful
  because the total is not**.
- **`S122`** — a **guest can create a canvas**, new *and* imported, byte-identical on all three peers, with
  the originator on the host's document. Owner-required capability, delivered.
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

---

## 4. Traced in code, NOT measured — do not cite these as facts

- **`coldOpen` → `doc-wins` overwrites a canvas file with no conflict copy.** The path exists and the
  equivalent guard exists for notes. **There is no demonstrated instance** — the one claimed case was
  withdrawn (§6). Worth closing on principle; **not** a blocker, **not** a proven data-loss defect.
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

- **WP119 live test** — the owner's exact gesture (select on one client, watch the others), both sides of
  the clientID tiebreak, contested edits still resolving, and the cost of the unrepaired lock leak.

**Chartered, held**

- **WP120 — a presence lock needs a lifetime.** Owner-authorised. **Held until the tester finishes**, to
  honour *never run tests in parallel*. The design exists and measured green in WP119 §4.

**Needs an owner decision before it can be chartered**

- **The canvas convergence remodel.** `WP79`'s *"a host's file is never rewritten by a pass"* collides head
  on with the priority-1 ruling. At least three ways out: let the host's file follow like any peer; keep
  the pass hands-off and guarantee convergence through the live writer; or canonicalise serialisation
  everywhere so all copies match at birth. **Different blast radii — the owner picks.**
  Second question with it: **canvas only, or the general file-sync model.**
  Sequencing note: **a conflict copy for the canvas `doc-wins` path should land with or before the writer
  attach**, since attaching writers to already-divergent boards exercises that path on all of them at once.

**Then, in order**

1. The §3 queue — the host-created-canvas writer first, then `S164` / `S165` / `S163`.
2. **`S149`** — a deleted file reappeared on two vaults with the owner verifiably away. **Unexplained**,
   never reproduced, and the only open item that might be data integrity rather than convergence.
3. **Large-canvas support / chunking** (`S167`) — owner-sequenced **last**, after functionality is proven.
4. **Known-issues catalogue** — the final step; sweep the remainder in rather than picking them off.

**Signal register:** `SIGNAL_REGISTER.md` is the allocation authority. **Next free is S173; the Dispatcher
allocates.** <!-- signal-register: meta --> `NEXT_FREE` is hardcoded in `check_signal_register.py` **as well
as** in the register — bump both or the checker fails every new allocation.

*(That line needs the `signal-register: meta` marker because declaring the next free number is, by
definition, citing an unallocated one. The Dispatcher has now been caught by this four times, which is
precisely why the register has an instrument instead of a paragraph.)*
