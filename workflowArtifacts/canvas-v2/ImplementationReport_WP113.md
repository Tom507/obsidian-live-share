# ImplementationReport WP113 — a failure that reports nothing lasts forever

**Signals:** S143 (A) · S144 (B) · S157 (C) · **Branch:** `fix-bugs-and-raceconditions`
**Base:** `7c029f2`, clean tree · **Commit:** `31f7e26` · **Worker:** 3i, sole occupant of this tree
**Signals allocated:** none. Every finding below is prose.

---

## 0. The answer in three paragraphs

**A — `S143` is real, it is SMALLER than the register says, and it is not the same defect.** The charter's own
premise (*"`attachObserver` is the last statement, and six early returns ahead of it leave `observers: false`"*)
was true and is no longer: **WP114 moved `attachObserver` to before `waitForSync`.** Enumerated from source on
`7c029f2`, `subscribe()` has **eight** exits, and **exactly one** — `!docHandle` — still returns with the path
genuinely unobserved. Five return with the observer already installed, so what they cost is **the one-off
reconciliation**, which on a HOST means *this file's bytes were never seeded into the shared document.* That is a
different failure with the same signature — a file that quietly stops participating while everything reports
healthy — so S143 **shrank; it did not close.** All eight exits are now counted, six of them logged, and the two
that are temporary are re-driven on the re-arm gesture.

**B — `S144` is exactly as described, and the repair is one question the code never asked.** The `catch` was
written for a concurrent create and absorbed permission errors, full disks and name collisions with it. It now
asks the vault, *after* the throw, whether the folder is there — positive evidence rather than an error-string
test — and reports `create-raced` or `create-failed` naming the FOLDER. Driven end to end through
`FileOpsManager.applyRemoteOp`, the log now carries the folder line **and** `APPLY FAILED: rename …`, and they
name different things. **The caller's behaviour is byte-identical** (B3).

**C — `S157` is real, and this row's own description of it is wrong in a way that matters.** The bare `catch` is
**not** around `waitForSync`; it wraps the entire text branch — `decideEmptyWrite`, `preserveLocalVersion`,
`ensureFolder`, and the `vault.modify` / `vault.create` themselves. So *"this path threw"* could equally mean a
sync timeout **or a failed write to the user's disk**, and nothing distinguished them. Attributed with a PHASE
label rather than by narrowing the `try`, because narrowing it would move control flow and **C3 forbids that.**
Neither branch decides anything differently.

---

## 1. PACKAGE A — S143, and what it actually is now

### 1.1 The exits, enumerated from source, on `7c029f2`

`plugin/src/files/background-sync.ts`, `subscribe()`. The derivation is a test
(`test_s143…` → *"the shape of `subscribe()` on this HEAD, enumerated from source"*), not this table; the table
is its readable form.

| # | exit | observed at exit? | reconciled? | disposition | changed by WP114? |
|---|---|---|---|---|---|
| E1 | `!isPathSafe(path)` | no | no | **TERMINAL** | — |
| E2 | `observers.has(path)` | **yes** | n/a | do-nothing | — |
| E3 | `subscribing.has(path)` | pending | n/a | do-nothing | — |
| E4 | **`!docHandle`** | **no** | no | **RETRYABLE** | — |
| E5 | `catch` on `waitForSync` | **yes** | **no** | **RETRYABLE** | ✅ was unobserved |
| E6 | `cancelledSubscribes` (post-wait) | yes → `finally` detaches | no | **TERMINAL** | ✅ |
| E7 | `docHandle.doc.isDestroyed` (post-wait) | yes | no | **TERMINAL** | ✅ |
| E8 | `cancelledSubscribes` (post host disk read) | yes → detached | no | **TERMINAL** | ✅ |
| E9 | `cancelledSubscribes` (post guest seed wait) | yes → detached | no | **TERMINAL** | ✅ |
| E10 | `docHandle.doc.isDestroyed` (post seed wait) | yes | no | **TERMINAL** | ✅ |
| E11 | fall-through | yes | **yes** | completed | — |

E2 and E3 were one condition (`observers.has(path) || subscribing.has(path)`); splitting them is
behaviour-preserving and is what lets *"already watched"* be told apart from *"another call owns it"* (`S155`).

**The charter's sixth exit — "the guest arm's 20 × 100 ms wait, which falls through" — no longer exists.**
WP114 replaced it with `awaitSeed`, an event-driven wait bounded by one deadline. It does not return; it falls
through into the guest reconciliation.

**So: five of the six exits the register names are no longer unobserved give-ups.** What survives is
(a) `!docHandle`, the only remaining truly-unobserved exit, and (b) a *new* reading of `sync-failed`: the path is
watched but never reconciled, which on a host means the file's bytes never entered the CRDT at all. Both were
silent, uncounted and permanent until the next `startAll`. That is what was repaired.

### 1.2 The fix

- **`plugin/src/files/path-outcome.ts`** (new, pure, no imports) — one shared emitter, three arms, a named closed
  outcome set per arm with a facts table (`disposition`, `logged`, `why`), `notePathOutcome(…, logger?)`,
  `getPathOutcomes()`, `resetPathOutcomes()`. Modelled line-for-line on `empty-write-guard.ts` and
  `single-writer.ts`: one spelling of the line, the arm on the line, the path on the line, **the logger as a
  parameter and never a module sink** (`S104`).
  **One module for all three packages rather than three**, deliberately: `empty-write-guard.ts` already serves
  two arms in two files, so three arms in three files is the same idiom rather than a wider one — and a second
  emitter module would have been the third idiom the charter forbids.
- **`background-sync.ts`** — every `return` in `subscribe()` goes through `endSubscribe(path, outcome, detail?)`,
  including the fall-through. `abandonedSubscribes: Map<path, outcome>` records **only** RETRYABLE outcomes,
  reading that classification off the facts table so there is no second list to drift.
  `retryAbandonedSubscribes()` re-drives them. Cleared on `onFileRemoved`, `onFileRenamed` (old path) and
  `destroy()`.
- **`main.ts`** — `rearmSharing()` calls it after re-arming both links and carries the result up as
  `resubscribed`. New read-only surfaces `getPathOutcomes()` / `getAbandonedSubscribes()`, exposed through
  `e2e-control.ts` as `sync.pathOutcomes` / `sync.abandonedSubscribes`.

### 1.3 A3 — the recovery, and the two shapes I rejected

| shape | verdict |
|---|---|
| **A timer that reconciles periodically** | **Rejected.** `S147` is this project's own proof that a clamped renderer decides how long any timer takes; WP114 removed the last such loop from this very function. A recovery whose period the platform chooses is the defect one layer up. |
| **An immediate retry at the exit** | **Rejected.** Both retryable exits mean *"the link is not usable right now"* — `getDoc` answers `null` precisely when the manager is neither connected nor connecting, and `waitForSync` rejected on a timeout. Retrying on the spot re-asks a question whose answer cannot have changed, and burns the caller's serial loop (`S147` again). |
| **Re-drive on the gesture that already means "try again"** | **Chosen.** `rearmSharing` / `restoreLink` is that gesture and WP88/WP114 already established it as the seam for an idempotent recovery. |

**A4 is satisfied by construction, and that is the point of the shape.** The retry re-enters `subscribe()` —
the same production function, with every floor still in front of it: the `S134`/`S129` seeding guard
(`yTextHeldContent`, **the existing evidence predicate, not a second one**), the single-writer declines, and the
`S119` empty-write floor. No new write path exists, so there is no new way to seed over a document the editor
owns or to resurrect an emptied note.

**One thing the retry needs, and it is not obvious.** `sync-failed` happens with the observer *already
attached*. Re-entering `subscribe()` would meet its own `observers.has(path)` guard, return `already-observed`,
and the reconciliation would still never run — a silent no-op introduced by the repair itself. So
`retryAbandonedSubscribes` detaches first, **and only when `getDoc` answers right now** (tearing down a working
observer to replace it with nothing is worse than leaving the reconciliation undone). The detach window contains
**not one `await`**: from `detachObserver` to `attachObserver` inside `subscribe()` every statement —
`isPathSafe`, the two set tests, `getDoc`, `attachObserver` — is synchronous, so no delta can be integrated in
it because JavaScript cannot run one there. Break row **W4** is that claim's falsifier.

### 1.4 Exits I concluded must stay TERMINAL, and why

- **`cancelled`** — `cancelSubscribe` is somebody deliberately stopping this path, and the `finally` already
  undoes the attach. A retry would resurrect exactly what was asked to be stopped. **I11.**
- **`doc-destroyed`** — the document was released (`onFileRemoved`, `releaseDoc`, teardown). A retry would
  re-create a document for a file that is going away.
- **`unsafe-path`** — a peer-supplied manifest key that escapes the vault. Retrying a traversal *is* the attack.

They never enter `abandonedSubscribes` at all, so no re-arm can reach them. Break row **W5** flips
`cancelled` to RETRYABLE and reddens two rows.

---

## 2. PACKAGE B — S144

`plugin/src/utils.ts::ensureFolder(vault, path, logger?)`.

**The repair is one question:** after a `createFolder` throw, ask `vault.getAbstractFileByPath(current)`. Folder
there ⇒ `create-raced` (the benign concurrent create the `catch` was written for). Folder absent ⇒
`create-failed`, logged with **the folder segment**, the requested path, and the adapter's message. **No error
string is parsed**, so no adapter's phrasing is depended on — the same discipline `I11` applies to a destructive
decision, applied to a diagnosis.

**One outcome per CALL, not per segment**, reporting the worst: a call that created two segments and failed on
the third is a failed call. Five outcomes, all counted, two audible.

**B3 held exactly.** `ensureFolder` still returns `void`, still never throws, and all twelve call sites are
behaviourally unchanged — the only edit to them is an extra optional `logger` argument. A test asserts the
non-throw on both the with-logger and the no-logger paths.

**B2's evidence is the integration row**, not an argument: a real `FileOpsManager.applyRemoteOp` rename whose
destination parent cannot be created now produces two log lines that name different things, with a positive
control proving the folder line does not appear when the create succeeds.

### What I found and did NOT fold in (B3's escape hatch)

**The caller's behaviour is arguably wrong, and it is not mine to change.** `file-ops.ts`'s rename arm calls
`ensureFolder` and then proceeds to `vault.rename` regardless — so on a folder failure it attempts a rename into
a directory it has just been told does not exist, and the user is told the rename failed. Now that the folder
failure is legible, the question *"should the caller abort here"* is answerable; it is a behaviour change across
five op types and belongs in its own package. Reported, not folded in.

---

## 3. PACKAGE C — S157

`plugin/src/files/manifest.ts::syncFromManifest`, text branch. Four exits, all counted, two logged:

| exit | line | disposition | logged |
|---|---|---|---|
| `!tempHandle` (`getDoc → null`) | the first give-up | RETRYABLE | ✅ |
| the `S119` empty-write refusal | — | TERMINAL | ✅ |
| the bare `catch` | the second give-up | RETRYABLE | ✅ |
| `synced++` | — | completed | — (counted only) |

**The correction to the signal.** `S157` says *"its bare `catch` around `waitForSync`"*. The `try` wraps the
whole body. The test *"the `catch` is WIDER than S157 says"* asserts, from source, that `waitForSync`,
`decideEmptyWrite`, `preserveLocalVersion`, `ensureFolder`, `vault.modify` and `vault.create` are all inside it.
That is why the phase label exists: it attributes the throw **without moving a single branch**, which narrowing
the `try` would not have done.

**The empty-write refusal is recorded on BOTH ledgers, deliberately.** `empty-write-guard.ts` counts a census
across *writer arms*; this one counts a census across *this function's exits*. A census over one function's exits
must be closed inside that function or it cannot answer *"which door did this path leave by"*. The two counters
are independent and a test asserts they agree.

**C3 held.** A source test pins that `!tempHandle` still `continue`s and that nothing in the `catch` throws.
The `getDoc → null` row also asserts the guest's bytes are byte-unchanged on disk — WP115's outcome, untouched.

---

## 4. S155 — every branch, including the do-nothing one

Counted on all three arms: `subscribe/completed`, `subscribe/already-observed`, `subscribe/subscribe-in-flight`,
`manifest-sync/synced`, `ensure-folder/created`, `ensure-folder/nothing-to-create`,
`ensure-folder/already-a-folder`. **A zero cell now means one thing: this arm did not run for that path.**

The ordinary successes and do-nothings are **counted but not logged**, controlled by a `logged` field in the
facts table rather than by an `if` at each call site — so *"which exits are audible"* is one table a reader and a
test can both point at. On a hundred-file vault, logging them would be a hundred lines per join burying the four
that matter; `S155`'s rule is about the ledger, and the ledger has them.

Break rows **W7** and **W13** remove the two success counters; each reddens more than one row, including the
`already-observed` row that has nothing to do with success — which is the ambiguity itself, showing up.

---

## 5. Break table (Rule 11)

`workflowArtifacts/canvas-v2/wp113_break_table.py` — copy-aside, exact string replacement, restore in a
`finally`, sha256 equality, `S133`-anchored failure parser. Targets: `path-outcome.ts`, `background-sync.ts`,
`manifest.ts`, `utils.ts`. Suite: the three WP113 files **plus** the neighbours this package could re-open —
WP114's `S147`, WP115's `S148`, `S119`, `S126`, `background-sync.test.ts`, `utils.test.ts`, `manifest.test.ts`.
Baseline **223 passed (223)**.

| # | what is planted | result | restored |
|---|---|---|---|
| **W1** | the silent `no-doc` return (the surviving defect, verbatim) | **6 RED** | byte-identical |
| **W2** | the bare `catch { return; }` around `waitForSync` | **3 RED** | byte-identical |
| **W3** | the re-arm reads no abandoned set | **3 RED** | byte-identical |
| **W4** | the detach before a `sync-failed` re-drive is removed | **1 RED** | byte-identical |
| **W5** | `cancelled` becomes RETRYABLE (I11) | **2 RED** | byte-identical |
| **W6** | `onFileRemoved` stops clearing the retry set | **1 RED** | byte-identical |
| **W7** | `subscribe()` stops counting its own completion (S155) | **4 RED** | byte-identical |
| **W8** | the swallowing `catch` in `ensureFolder`, verbatim | **5 RED** | byte-identical |
| **W9** | every throw classified as the benign race | **5 RED** | byte-identical |
| **W10** | the silent `getDoc → null` continue | **2 RED** | byte-identical |
| **W11** | the bare `catch` in `syncFromManifest` | **1 RED** | byte-identical |
| **W12** | the phase never advances (a failed WRITE reads as a failed WAIT) | **1 RED** | byte-identical |
| **W13** | `syncFromManifest` stops counting what it wrote (S155) | **2 RED** | byte-identical |
| **W14** | the closed set silently accepts an unknown outcome | **1 RED** | byte-identical |
| **W15** | **NEGATIVE CONTROL** — the log *category* is reworded | **0 RED**, as required | byte-identical |

**`.pre-v2-smoke` files at the end: 0.**

**W14 reddened NOTHING on its first run** and that was a real hole: the guard existed and no test could see it.
A row was added (*"an outcome that is not an exit of its arm is REFUSED"*) and W14 is red. Recorded rather than
quietly fixed, because a break that reddens nothing is the report's most useful line.

---

## 6. Gate

| | figure |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run`, pre-commit | **3183 passed / 1 failed · 421 files** — the single failure is **`S153`** |
| `npx vitest run`, post-commit | **[3184 / 3184 tests · 421 / 421 files · 0 failed]** — measured at `31f7e26` |
| baseline (Dispatcher, `7c029f2`) | 3156 / 418 |
| net | **+28 tests, +3 files** (all WP113) |
| `check_signal_register.py` | **exit 0** — `clean - no NEW violations` |

**`S153`, confirmed for the third time and in both directions.** WP92's `no_collateral` asserts
`plugin/src/utils.ts` is absent from `git diff HEAD`. Package B edits `utils.ts` by necessity — it is where
`ensureFolder` lives — so the row is RED while the work is uncommitted and green the moment it is committed,
unchanged. **I did not edit another package's test.** The pre- and post-commit figures above are the same tree.

`npx biome check` is **not** a gate on this tree: it already reports findings in `single-writer.ts` and
`empty-write-guard.ts` at `7c029f2`. `--write` was never run.

---

## 7. Corrections to the charter and the register

1. **A's premise is refuted by the code.** `attachObserver` is not the last statement; WP114 moved it. Five of
   the six exits the charter lists are no longer unobserved give-ups, and the sixth (the 20 × 100 ms wait) does
   not exist. A source test asserts the ordering, so a future re-inversion is RED.
2. **The charter's "`if (!docHandle) return;`" is listed AFTER `isDestroyed`.** In the code it is first, before
   the observer attach — which is why it is the one exit that still leaves the path unwatched.
3. **`S157`'s `catch` is far wider than "around `waitForSync`"** — §3.
4. **`S143` is a give-up of RECONCILIATION more than of OBSERVATION now.** On a host, `sync-failed` means the
   file's bytes never reach the shared document; the path is watched, and stays wrong.
5. The three register rows are amended in place. **No signal number allocated; `NEXT_FREE` untouched.**

---

## 8. Residuals — everything I left

1. **`disconnect()` then `connect()` on a live `SyncManager` orphans a socket.** Found while building the rig:
   `disconnect()` nulls `this.ws` while the old socket's `onclose` is still pending; `connect()` then sets
   `shouldConnect = true`, and the *old* socket's `onclose` fires afterwards and schedules a reconnect, leaving
   the socket `connect()` opened unreferenced and unclosed. The in-process relay's `server.close()` then never
   resolves. **Reproduced against the real manager**, not inferred. Out of this package's scope; the harness
   avoids the sequence and says why. **Worth a signal by somebody who owns `sync.ts`'s lifecycle.**
2. **`file-ops.ts` proceeds with the rename after a failed `ensureFolder`** — §2, deliberately not folded in.
3. **`retryAbandonedSubscribes` is reachable only from `rearmSharing`.** A socket-level reconnect (`ws.onopen`)
   does *not* call it, because `main.ts`'s `onReconnect` handler is an inline closure inside `connectSync` and
   WP88 established that such closures are unreachable for a test. So a path abandoned during an outage recovers
   on the **user's** re-arm (command, settings button, or the rig's `restoreLink`) and not automatically on
   reconnect. A defensible boundary, and a gap: naming that handler would close it.
4. **The `main.ts` wiring is pinned by a source read, not by behaviour** — labelled as such in the test (`S99`).
   Booting the plugin was out of reach; `retryAbandonedSubscribes` itself is driven against real objects.
5. **`getPathOutcomes()` is process-global and never reset in production**, exactly like the three ledgers it
   copies. Across a leave/rejoin the totals accumulate; `getAbandonedSubscribes()` is the per-session view and
   *is* cleared by `destroy()`.
6. **`subscribe/unsafe-path` logs the rejected path.** It is a path, never content, and it is the only thing
   that makes the refusal diagnosable — but it is a peer-supplied string reaching the debug log, stated here so
   nobody has to rediscover it.
7. **The `S147` clamp facility was not used.** Nothing in this package is timer-scheduled: the recovery is
   event-driven by design, and the one real timeout exercised (`waitForSync`'s 10 s) is driven at its real
   duration over a real silenced link. A clamp would have measured nothing.
8. **`ensureFolder`'s ledger is per call, so a caller that asks for the same folder twice counts twice.** That is
   correct for *"how often did this fail"* and wrong for *"how many folders are missing"*. Nothing reads it as
   the latter today.
