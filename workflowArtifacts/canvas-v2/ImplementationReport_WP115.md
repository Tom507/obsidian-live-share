# WP115 — S148 (the conflict copy that was never attempted) + S151

**Branch:** `fix-bugs-and-raceconditions` · **Base:** `6e76374` · **Worker:** 3f, sole occupant of this tree

**Gate, bracketed:** `3074 tests / 412 files` (Dispatcher baseline) → **`3092 tests / 414 files`, 0 failed**.
`tsc --noEmit` clean at both ends. `check_signal_register.py` **exit 0** ("clean - no NEW violations").
`.pre-v2-smoke` leftovers: **0**. No signal numbers allocated.

---

## PACKAGE A — S148

### A0. The charter's premise is corrected, and the correction is most of the finding

The charter states, from the live reading `conflictCopies = {total: 0, byArm: {}, failed: 0}`:

> *"So `preserveLocalVersion` did not run and fail. It did not run at all."*

**That does not follow, and it is not true.** `preserveLocalVersion`'s DISCARD branch was

```ts
if (verdict.decision === CONFLICT_PRESERVATION.DISCARD) return false;
```

— a `return` that stands **before every counter in `conflict-copy.ts`**. A guard that RAN and decided
"merely stale" therefore produced a reading byte-for-byte identical to a guard that was never called:
`{total: 0, byArm: {}, failed: 0}` in both cases. The zeros could not distinguish the two.

Three readers in a row read them as the second. That silence is itself the instrument defect that made
W4c unable to attribute this — W4c was right not to guess — and it is fixed here (§A4).

### A1. VERDICT: **SETUP-DEPENDENT. Not a regression.** And the regression half is refuted by construction

`conflict-copy.ts` has **exactly one commit in its entire history** — `1f22557` (WP99, the original S125
fix) — and

```
git diff 1f22557 6b191d8 -- plugin/src/files/conflict-copy.ts   →  EMPTY
```

The file that decides preservation is **byte-identical** between the build that validated S125 and the
build that refuted it. The two suspect commits:

| commit | touches the conflict path? |
|---|---|
| `39255ee` (WP109/S134) | **No.** It does not touch `manifest.ts` or `conflict-copy.ts` at all. |
| `6b191d8` (WP110/S135+S137) | `manifest.ts` only: a `logger` field, a `setLogger`, and three log lines (one protected-path, one empty-write, one `CONFLICT COPY FAILED`). **No branch, no predicate, no ordering, nothing inside the decision.** |

The code did not change. The **setup** did.

### A2. The precondition the guard actually depends on — and this is worth more than the patch

> **`preserveLocalVersion` decided a destructive branch from Obsidian's IN-MEMORY INDEX, five lines after
> the same function had established the divergence from a FRESH DISK READ.**

```
syncFromManifest:  normalizeLineEndings(await this.vault.read(localFile))   ← the DISK. uncached.
                   … hash differs → needsSync …
preserveLocalVersion:            localFile.stat?.mtime                       ← Obsidian's INDEX. cached.
```

Two freshness regimes, same file, same function, five lines apart. The consequence:

- **Obsidian CLOSED, file edited, Obsidian REOPENED** — the index is rebuilt from disk at vault load, the
  two agree, the guard is correct. **This is the setup in which S125 was VALIDATED LIVE, and that green
  was real.**
- **Obsidian LEFT RUNNING while the bytes changed underneath it** — the index can still hold the mtime
  from *before* the edit. That value is a moment **inside the last session**, i.e. `< lastSessionEndedAt`,
  so `decideConflictPreservation` returns **DISCARD for a file the user genuinely edited**, and the
  discard was silent. **Setup-dependent, and still data loss.**

**The live data decides this on its own, with no theory about Obsidian's cache required.** W4c varied
**only the file's on-disk mtime** between arms 5a and 5b — and the mtime is the guard's *sole*
discriminator between preserve and discard — and got the **identical outcome in both arms**. Therefore
either the guard never ran, or **it ran on a value that is not the on-disk mtime**. It reads
`TFile.stat.mtime`, which is not the on-disk mtime. The two-way split is then settled by the second
ledger: the "never ran" routes that leave a trace (`S119`'s floor) measured **0 refusals** live, and A5
below is now the row that separates the remaining traceless pair for the next round.

### A3. THE SECOND DOOR — nobody had looked for it, and it is reached by an ordinary ordering

S125 locked `syncFromManifest`'s overwrite. Nobody asked whether that was the only way a guest's divergent
file gets replaced on a join. **It is not.**

`BackgroundSync.subscribe()`'s guest arm:

```ts
const localContent = file ? normalizeLineEndings(await this.vault.read(file)) : "";
if (remoteContent !== localContent) {
  await this.writeToDisk(path, remoteContent);   // ← no preservation, no ledger, no log
}
```

`main.ts` runs `syncFromManifest(...)` and then `backgroundSync.startAll("guest")` at all three guest
entry points. Whenever the manifest arm's text branch **declines** — `getDoc` returns `null`, `waitForSync`
rejects into a bare `catch {}`, or the `S119` floor refuses an empty document — the guest's bytes survive
that pass and **this arm destroys them a moment later**. Two of those three routes leave no trace of any
kind.

**Measured end to end** (row A3, real relay, real everything): `syncFromManifest` returns `0`, the file
still holds the guest's bytes after it, and the write then arrives via `adapter.write` rather than
`Vault.modify`. Before the repair: no copy, ledger all zeros.

### A4. What was fixed

| # | file | change |
|---|---|---|
| **F1** | `conflict-copy.ts` | New pure `observedModificationTime({cached, onDisk})` — the **later of the two** usable timestamps, cached-only when the disk cannot answer, and the raw unusable value through when neither can (so `AC6b`'s "every unknown preserves" keeps owning that reasoning). |
| **F1** | `manifest.ts` | `preserveLocalVersion` now feeds it `localFile.stat?.mtime` **and** `await this.diskModificationTime(localFile.path)` (`vault.adapter.stat`). `diskModificationTime` answers `undefined` for *every* failure mode — no method, a throw, `null`, a non-numeric `mtime` — so an unknown never discards. |
| **F2** | `conflict-copy.ts` | `ConflictCopyLedger.discarded`, `noteConflictDiscard(...)`, and `conflictDiscardMessage(...)` emitting **`CONFLICT COPY SKIPPED: arm=… path=… mtime=… lastSessionEndedAt=… reason=…`** to the debug log and the console. It carries **both clocks** — the only two numbers that could ever have answered S148's own question. Integers, never content. |
| **F3** | `background-sync.ts` | `subscribe()`'s guest arm calls `writeToDisk(..., { preserveLocal: true })`; the flag is consumed at the **bottom of `doWriteToDisk`, after the empty-write floor**, so S125 AC6's ordering ("a refusal writes no copy, because a refusal destroys nothing") holds on the second arm too. It calls **`ManifestManager.preserveLocalVersion`** — one seam, not a second mechanism. |
| **F4** | `background-sync.ts` | The call is **contained** (`try/catch` → `noteConflictCopyFailure()`), and deliberately **not** an optional call. See §A6. |
| — | `main.ts`, `e2e-control.ts` | Ledger return types widened to the real `ConflictCopyLedger`, so `discarded` is part of the e2e contract the live rig reads. |

**S125's discard branch is not weakened** (charter A5). When both clocks say the file predates the last
session end, the verdict is still DISCARD and the overwrite is still silent — row A4, plus break-table
row **W7**, which reddens `test_s125_…`'s own "a MERELY STALE file is overwritten silently, with no copy"
when the discard is disabled. What changed is that the decision is now *counted*, not that it is different.

### A5. The reproduction, and what it costs to run

`plugin/src/__tests__/v2/wp115/` — 14 rows for S148, over the **real in-process NeuralAngels relay**, real
`SyncManager`s, real `ManifestManager`s, real `BackgroundSync`es, the real manifest publication, the real
`syncFromManifest`/`subscribe`/`preserveLocalVersion` and every real floor and ledger.

**What the vault double does not exercise, exhaustively** (charter method rule 1, since this package's
defect is "a function that was never called"):

- Obsidian's file watcher and the moment it refreshes a `TFile.stat`. **This is the S148 precondition, so
  the double does not model it — it parameterises it**: `cachedMtime` is what `TFile.stat.mtime` reports,
  `diskMtime` is what `adapter.stat` reports, and rows set them apart on purpose. A running Obsidian can
  hold the two apart; a restarted one cannot.
- Obsidian's editor and its own save cadence for the active file — that is S151's subject and is
  deliberately outside (§B).
- `Vault.trash`, folder semantics beyond `createFolder`, metadata.

Key rows:

| row | what it shows |
|---|---|
| **A1** (control) | Obsidian *restarted*: the two clocks agree, S125 fires, copy written, host still wins. The earlier live green, reproduced. |
| **🚨 A2** | Obsidian *left running*: **before the fix**, no copy, `GUEST-OFFLINE-WORK` gone from the vault entirely, `{total: 0, byArm: {}, failed: 0, discarded: 1}` — **the live reading, reproduced, with the mechanism named**. |
| **🚨 A3** | The second door: `synced === 0`, guest bytes still on disk after the manifest arm, one `EMPTY WRITE REFUSED: arm=manifest-sync`, then `adapter.write` (never `modify`) destroys them. |
| **A4** | S125's discard branch, unweakened — and now `discarded: 1`. |
| **A5** | **"never called" vs "called, and discarded"**: identical `total`/`failed`, `discarded` `0` vs `1`. This is the row the live rig could not have asked, and it is the one that would have decided S148 in one reading. |
| **A6** | The two doors never both fire — one copy per lost version. |
| **A7** | A vault whose adapter has no `stat`, or whose `stat` throws, still preserves (AC6b). |
| **A9** | A preservation seam that cannot run must never suppress the **sync**. §A6. |
| **B-part** | 5 pure rows on `observedModificationTime`, including "the repaired input flips exactly the verdict S148 is about, and nothing else". |

### A6. A defect this package introduced, caught by a pre-existing test, and what it taught

The first cut awaited `preserveLocalVersion` **bare** inside `doWriteToDisk`. That method's whole body sits
in one `catch` that answers a failure with a `Notice` and **no write** — so a manifest collaborator that
could not answer did not merely skip the *copy*, **it skipped the *sync***. That is precisely the failure
`preserveLocalVersion`'s own doc comment forbids: *"a vault that refuses the copy must still receive the
host's content, because failing the sync would turn a best-effort safety net into a new outage."*

`background-sync.test.ts`'s pre-existing `guest writes remote Y.Text to vault if different from local`
reddened, because its manifest double has no `preserveLocalVersion`. **S146 vindicated: the failure was
real and it was mine.** I did not edit that test. The call is now contained and the failure counted, and
row **A9** plus break row **W12** pin the lesson where this package owns it. The call is deliberately
**not** `?.` — an optional call would make an absent seam a *silent* skip, which is the exact class of
defect this whole package is about.

### A7. Break table — `workflowArtifacts/canvas-v2/wp115_break_table.py`

Baseline **103/103**, final green **103/103**, **0** copy-aside leftovers, **every** row restored
byte-identically (sha256). 12 rows; the set is the two WP115 files plus the four neighbours this package
could re-open (`S125`, `S126`, `S119`, `background-sync.test.ts`).

| row | plant | RED |
|---|---|---|
| W1 | the shipped defect verbatim — cached-only mtime | A2, A8 |
| W2 | `Math.min` instead of `Math.max` on the two clocks | A2, A8 + 3 pure rows |
| W3 | `adapter.stat`'s throw no longer contained | A7 |
| W4 | the guest arm stops asking for preservation | A3, A9 |
| W5 | the flag is accepted and silently dropped | A3, A9 |
| W6 | DISCARD returns before every counter (the shipped silence) | A4 |
| W7 | the discard verdict is never acted on | **`test_s125_…` ×2** + A4 |
| W8 | preservation moved *ahead* of the empty-write floor | A3, A9, `background-sync.test.ts` |
| W9 | the initiator's own local transaction may schedule a write | B2 |
| W10 | the peer's write stops being debounced | B4, `background-sync.test.ts`'s ~300 ms row, A3 |
| W12 | the containment removed | A9, `background-sync.test.ts` |
| **W11** | **NEGATIVE CONTROL** — the log line reworded | **nothing. 103/103** |

Two rows were rewritten after their first run rather than kept: the first **W3** (`return undefined` →
`return 0`) reddened nothing **and correctly so** — both values are equally unusable to `usableTimestamp`,
so the plant was not a behaviour change; and the first **W5**'s anchor drifted when the containment landed.
Both are reported here rather than quietly dropped.

---

## PACKAGE B — S151

### B1/B2. VERDICT: **A PROPERTY, and a deliberate one.** Not a defect. It is the single-writer invariant

**The line.** `background-sync.ts::attachObserver` installs the observer that turns a `Y.Text` change into
a disk write, and its **first statement** is:

```ts
const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
  if (transaction.local) return;
```

The initiator's own emptying **is** a local transaction — that is what yCollab produces for the user's
keystrokes — so on the initiator the observer returns on line one and `scheduleDiskWrite` is **never called
for it**. A second independent gate stands four lines behind it (`if (path === this.activeFile) return;
if (path === this.collabBoundFile) return;`), and the initiator necessarily satisfies both: to empty a note
you have it open.

On every other peer the same change arrives as a **remote** transaction, both gates pass (the live run
verified zero open leaves on the other two before every gesture), and the write lands after the trailing
debounce.

**So it is neither deferred nor debounced on the initiator — it is not scheduled at all.** The active
file's disk copy belongs to Obsidian's editor; the plugin writing it would be the second writer that
invariant exists to forbid. The initiator settles when Obsidian saves the buffer, or when the user switches
away — `setActiveFile` flushes the outgoing file through `writeToDisk`, which is the only plugin-owned
catch-up.

**Demonstrated, not argued** — `test_s151_…`, real relay, two real peers:

| row | measurement |
|---|---|
| B1/B2 | peer's disk `""` + `adapter.write` seen; initiator's disk still `ORIGINAL` and **zero writes issued**; both docs agree. The divergence is between the initiator's CRDT and the initiator's *disk*, nowhere else. |
| B2 (control) | with **both** the active-file and collab-bound gates lifted, the initiator **still** does not write. This rules the active-file gate out as the cause and isolates the local-transaction gate as the primary one. |
| B3 (control) | switching away flushes it immediately — the plugin-owned catch-up exists and works. |

**What is nevertheless true and worth the signal:** anything that asks *"did it land?"* **on the initiator**
is asking the one peer that is, by design, last to know. That is a **rig** correctness statement, not a
product defect. Score convergence on a peer, or force the flush by switching away first.

### B3. The debounce against S147's clamp

`scheduleDiskWrite` arms **one** `setTimeout` of at most `DEBOUNCE_MS = 300`, capped by `MAX_WAIT_MS = 500`
since the first pending update. **One timer, never a hop count** — which is exactly the distinction WP114
drew: the seed loop was `20 ×` the clamp and therefore unbounded; this is `1 ×` the clamp and therefore
bounded by one clamp period.

The honest number: **a debounce that is 12 ms in the foreground is ~907 ms after a minute hidden and
~9 004 ms after ten.** The peers' live "0.00 s" is a foreground figure. It does not compound.

Row **B4** measures this under `support/timer-clamp.ts` at `floorMs: 1200, growthPerFireMs: 200,
jitterMs: 20`, scoped to `background-sync.ts`:

- **the facility is proved able to turn the passing scenario red first**: at +600 ms (2× the unclamped
  settle) the peer's disk still holds the old bytes;
- it then settles inside one clamp period;
- `clamp.assertClamped(1, /background-sync\.ts/)` passes, `maxRequestedMs ≤ 300`, `maxAppliedMs ≥ 1200`;
- and the initiator is unchanged throughout — **there was no timer to clamp**.

Break row **W10** confirms the instrument has teeth from the other side: removing the debounce reddens B4.

---

## Residuals — everything I left

1. **`syncFromManifest`'s `catch {}` around `waitForSync` is a completely silent give-up.** A rejected
   `waitForSync` skips the preserve *and* the write with no counter, no log and no notice, and the file is
   then destroyed by the second door instead. F3 makes the outcome safe; the **silence is not fixed**. It
   is one of the two remaining traceless routes and it is the reason A1's verdict rests on the mtime
   syllogism rather than on a log line.
2. **`getDoc` returning `null` in `syncFromManifest` is the other traceless route** — same shape, same
   `continue`, no trace.
3. **`subscribe()`'s HOST arm has the same unguarded shape** (`else if (remoteContent !== content) await
   this.writeToDisk(path, remoteContent)`). A host whose disk diverged from the relay's stored document
   loses its bytes there with no copy. **Deliberately not widened**: S125's mtime rule is scoped to the
   guest's `lastSessionEndedAt`, and the live 5b control showed host-side overwrite is currently the
   *expected* behaviour. It should be a signal of its own before anyone touches it.
4. **The stale-index precondition is now defended, not eliminated.** If `adapter.stat` and `TFile.stat`
   are *both* stale (a filesystem whose mtime the OS has not flushed), the guard still discards. Both
   clocks agreeing wrongly is not reachable from anything this package can see.
5. **The conflicts folder still has no lifecycle.** Copies accumulate for ever; nothing prunes, and
   nothing tells the user one was written except the join notice's count.
6. **`CONFLICT COPY SKIPPED` is new and has never been seen live.** The next live round should grep for it
   alongside `EMPTY WRITE REFUSED` — on the S148 setup it is the line that turns "the ledger read zero"
   into an attribution.
7. **Not seen live.** Nothing in this package has run on the rig. The rig stays on build
   `1ddad2155341adbd`; **nothing was rebuilt, deployed, or written into any of the three vaults.**
8. **`S153` did not fire.** WP92's `no_collateral` stayed green on the full uncommitted run; noted because
   the charter predicted it might.

---

**Files changed:** `plugin/src/files/conflict-copy.ts`, `plugin/src/files/manifest.ts`,
`plugin/src/files/background-sync.ts`, `plugin/src/main.ts`, `plugin/src/testing/e2e-control.ts`,
`plugin/src/__tests__/v2/wp115/{harness.ts, test_s148_…, test_s151_…}`,
`workflowArtifacts/canvas-v2/wp115_break_table.py`, this report.
