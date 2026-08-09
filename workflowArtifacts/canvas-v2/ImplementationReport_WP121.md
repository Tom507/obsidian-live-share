# ImplementationReport — WP121, Winning is not a licence to discard

**Batch:** B60 · **Worker:** W3 (Implementation) · **Branch:** `fix-bugs-and-raceconditions`
**Landing commit:** `a546d54` — *"WP121 checkpoint: winning is not a licence to discard"*
**Baseline handed to me:** `5b1a25e`, 429 files / 3275 tests / 0 failed (Dispatcher-measured).

---

## 0. The headline, in the first line, as §6.1 requires

**A1 is DEMONSTRATED, not argued.** The project's missing demonstration now exists: the `doc-wins` cold
open, driven through the real `attachCanvasPersistence` over a real `Y.Doc` with no double for `flush`
and none for the serializer, **deletes named records from the user's `.canvas`** — `n-local` present in
the file before, absent from disk after, and absent from the vault entirely. It was **green on the first
run against unmodified HEAD**, before a line of WP121 code existed.

`DISPATCHER_STATE.md` §4 files this path under *"traced in code, NOT measured — do not cite these as
facts"*. **That entry can move.** The path is measured.

Per charter §0: the withdrawn node-count figure is **not** the justification for anything here, and it
appears nowhere in this report, in a test name, or in a comment. **I caught myself restating it once**, in
`test_tp01`'s file header — written there while explaining the withdrawal — and removed it before the
report commit. The only surviving occurrence of that digit string in `plugin/src` is an unrelated line
reference (`canvas-presence.ts:52` cites `canvas-sync.ts:318-319`); the withdrawn claim itself lives only
in the artifact prose under `workflowArtifacts/canvas-v2/`, where §0 already retracts it.

---

## 1. The predicate, in one sentence, and the test that pins it

> **The set of record ids (nodes and edges) the file holds that the document has NO KNOWLEDGE OF AT
> ALL — neither as a key in `nodes`/`edges` nor as an entry in the `deleted` tombstone container.**

Named ids. Not bytes, not `sha256`, not file size, not a record count.

- **Pinned by:** `plugin/src/__tests__/v2/wp121/test_tp03_the_predicate_is_record_level_in_both_directions.test.ts`
  — the FIRES direction, the two STAYS-SILENT spelling rows, the two delete rows, and four positive controls.
- **Implemented by:** `decideCanvasDiscard` in `plugin/src/files/canvas-discard-guard.ts` (pure; the
  document is consulted through one injected membership question) and `CanvasPersistence.docKnowsRecord`.
- **`decideConflictPreservation` was NOT reused as the predicate**, and I read it before writing anything
  (`conflict-copy.ts:313-350`): it compares `mtime` against `settings.lastSessionEndedAt`, which is a
  session-boundary question about a guest rejoining a share. It cannot answer a mid-session, record-level
  one. **The placement and the ledger ARE reused**: `conflictsRootFor`, `conflictCopyPath`, `conflictStamp`,
  `isConflictsPath`, `noteConflictCopy`, `noteConflictCopyFailure`, and the `CONFLICT COPY SKIPPED:` line's
  single spelling.

### 🔴 THE CHARTER IS WRONG ON THE PREDICATE, and this is the correction

Charter §2 states the predicate as *"the set of record ids that the file holds and that the
**post-migration doc projection** does not."* **Projection is the wrong noun and it would have made the
feature unusable.** `buildCanvasData` **suppresses tombstoned records** (`canvas-sync.ts:1217`,
`:1230`), so a projection-difference predicate fires on **every ordinary delete** — a conflict copy beside
the board every time a user removes a card. That is A2's own stated failure mode ("a guard that fires on
spelling … trains the user to ignore the folder") wearing a different coat.

Deletion in V2 is a **value, not an absence** (WP19), so a tombstone is *knowledge*, and knowledge is what
the predicate asks for. Demonstrated: `test_tp03` → *"an ordinary delete produces no copy"* and its
positive control; and break `BK2`, which is the projection-shaped predicate, reddens exactly the rows the
correction protects.

---

## 2. A1's demonstration — produced, not cited

**Charter §0's instruction was to PRODUCE the demonstration, not inherit the withdrawn one. Produced.**

`test_tp01_the_discard_is_demonstrated.test.ts`, four rows, run against **unmodified HEAD** before any
WP121 change (3/3 green at that point; the fourth row is the post-repair discriminator, added later):

| row | what it shows |
|---|---|
| DEMONSTRATION (node) | file holds `n-shared-a`, `n-shared-b`, `n-local`; doc holds the first two. `coldOpen` → `"doc-wins"`. After: disk holds `["n-shared-a","n-shared-b"]`; `n-local` is gone from the file **and from every other file in the fake vault**. |
| DEMONSTRATION (edge) | the same for a file-only **edge** — the record kind most likely to exist locally and nowhere else, being nothing but two references. |
| POSITIVE CONTROL | identical fixture, identical branch, identical flush, with `n-local` **in the document** → nothing is discarded. Without it the two rows above would be scoring *"a flush happened"*. |
| THE DISCRIMINATOR | the charter's own question — *what does this do on the repaired build?* — asked directly. Same fixture, the only difference being the preservation door. It goes green **because the guard ran**: the assertion is that `n-local` is findable **by name inside a file the guard created**. A no-op refactor of `flush` cannot produce that file. |

**Nothing was already guarding it.** No route I tried turned out to be blocked, so the "I could not build
it" result does not apply here. The one thing that *does* guard a subset of this loss is the durable
refusal ledger — see §3, which is a separate answer and a narrower one.

**Reachability, stated honestly:** this is a headless demonstration through the real production entry
point (`attachCanvasPersistence`, which `main.ts:3696` calls). It is **not** a live-vault reproduction —
I am headless by charter, and live validation is W4's alone. What is demonstrated is that the composition
discards named records; what is **not** demonstrated is a user-visible instance on the three vaults.

---

## 3. A6's verdict — SETTLED BY MEASUREMENT

**Question:** does the durable-refusal ledger (`hydrateDurableRefusals`, placed ahead of the `docNonEmpty`
branch by WP90/I11) already protect refused records from this flush?

**Answer: YES, and the protection is WHOLE-FILE, not per-record — and it exists only when a durable store
is wired with a stable identity.** Four measured rows in
`test_tp02_what_the_refusal_ledger_already_protects.test.ts`, all run against unmodified product code
before any WP121 change:

| measurement | result |
|---|---|
| standing durable refusal for `n-bad`, doc non-empty | `coldOpen` → `"doc-wins"`, `isWriteWithheld()` → `true`, **`io.write` never called**, file still holds `["n-bad","n-shared"]`. `writeIsWithheld()` returns before `serializeCanvas`, so the **entire** projection is withheld. |
| POSITIVE CONTROL — same fixture, empty store | withhold `false`, file ends at `["n-shared"]`. The card is lost. |
| a **third, never-refused** card on the same withheld path | also spared — the protection has no record granularity at all. |
| no durable store wired (WP63's session-scoped ledger) | withhold `false`, the card is lost. The protection does not exist at all without WP90's store. |

**Consequence for the predicate, and it is the opposite of what the charter feared.** The charter warned
that if refused records are protected, *"your predicate must exclude those ids, or you will emit a
spurious conflict copy on every cold open of every board that ever refused a record."* Because the
protection is **whole-file**, the correct implementation is not an id exclusion but a **branch skip**: on
a withheld path the flush does not happen, so there is nothing to preserve against and a copy there would
be pure noise. `coldOpen` therefore asks **the same predicate the flush will ask** (`writeIsWithheld()`,
not a second one that could drift) and skips preservation when it answers `true`.

Pinned by `test_tp02` → *"CONSEQUENCE: a withheld path emits NO conflict copy"* + its positive control;
falsified by break `BK9`.

**A second finding inside A6, and the Dispatcher should have it as a finding rather than a footnote:**
the protection is contingent on three things the charter did not separate — a `durableRefusals` store
being wired, a **non-null `refusalIdentity`**, and `hasSeededThisSession` being false. Production supplies
all three (`main.ts:3711-3719`), but `refusalIdentity` is `getCanvasGuid(canonical) ?? null`, and a `null`
there is an I5 DEGRADE that silently returns the path to WP63's in-memory-only ledger. On such a path a
refused record **is** destroyed by the next session's `doc-wins` flush. I did not measure how often
`getCanvasGuid` answers `null` in production — that is a live question and it is W4's.

---

## 4. The break table (Dispatcher Rule 11 / workflow §3.1)

Method: **copy-aside only.** The four touched files were copied to `H:/tmp/wp121-aside/` before the first
break; every break was a single anchored edit applied by script; every restore was a byte copy back,
verified by `sha256` of the whole file against the aside copy. **No `git checkout`, no `git stash`, no
`git restore` was run at any point in this batch.** All eleven restores verified byte-identical.
Post-restore `git ls-files -s` showed mode `100644` on all four files (§5 rule 3 — mode checked, not
inferred from an empty diff).

Scope of each run: `vitest run src/__tests__/v2/wp121` (35 tests). Green baseline: **35/35**.

| # | AC | The break | File | RED — and why that is the right reason | Restore |
|---|---|---|---|---|---|
| **BK1** | A1 | Delete `await this.flush()` from the `doc-wins` branch | `canvas-persistence.ts` | **11 red.** Both A1 DEMONSTRATION rows go red *because the records are no longer discarded* — the file keeps `n-local`. That is the right reason: the demonstration's subject is the discard, and removing the flush removes the discard. It also reddens every guard row, because with no flush there is nothing to preserve against. | byte-identical ✔ |
| **BK2** | A2 — **the charter's mandated discriminator** | Weaken the predicate to `serializedFile.length !== projection.length` | `canvas-discard-guard.ts` | **4 red, and exactly the right 4.** Both STAYS-SILENT spelling rows (Obsidian's one-record-per-line and the author's compact form), the delete row, and the do-nothing ledger row. **A1 stayed GREEN** — which is the whole point of this plant: a byte predicate still catches the real loss, so A1 alone cannot detect the mistake. The discriminator is A2's silent direction and nothing else. | byte-identical ✔ |
| **BK3** | A2 (tombstone) | Delete the `this.deletedMap.has(ref.id)` conjunct from `docKnowsRecord` | `canvas-persistence.ts` | **First run: reddened NOTHING — see §5, this is a finding.** After adding the row that can reach it: **1 red**, *"a TOMBSTONE ALONE is knowledge"*, and nothing else. | byte-identical ✔ |
| **BK4** | A3 (ordering) | Move the preservation call to **after** `flush()` | `canvas-persistence.ts` | **11 red.** Every FIRES row, because the copy then carries the post-flush projection — i.e. exactly the content that was never at risk — so the discarded ids are absent from the copy too. Right reason: the ordering *is* the contract. | byte-identical ✔ |
| **BK5** | A3 — **charter's "make the copy throw"** | Replace the copy's `noteConflictCopyFailure()` with `throw err` (the fixture already makes the copy throw; this removes the **product's** never-throws protection) | `canvas-persistence.ts` | **1 red:** *"FAILED branch: `failed` increments AND the document's content still lands"* — it fails on the throw escaping `coldOpen`, before the flush. Right reason: the never-throws contract is precisely "the cold open completes and the document's content still lands". | byte-identical ✔ |
| **BK5b** | A3 | Delete `noteConflictCopyFailure()` from the copy's catch (keep the log) | `canvas-persistence.ts` | **1 red:** the same row, now on `failed === 1`. The two halves of the row — *counted* and *the flush still happened* — are separately falsifiable. | byte-identical ✔ |
| **BK6** | A4 — **charter's "delete the discarded counter"** | Make the `noteConflictSkipped(...)` call unreachable | `canvas-persistence.ts` | **1 red:** *"DO-NOTHING branch: counted, attributed to the canvas arm, and said"*. Right reason: A4 is asserted **by the counter**, not by something else — the S155 lesson is actually applied. | byte-identical ✔ |
| **BK7** | A4 | Delete `noteConflictCopy(CANVAS_CONFLICT_ARM)` on the acted branch | `canvas-persistence.ts` | **4 red**, all on `byArm.canvas`. | byte-identical ✔ |
| **BK8** | A5 | Delete the `isConflictsPath(...)` early return | `canvas-persistence.ts` | **1 red:** *"a canvas that already lives INSIDE the conflicts root never seeds another copy"* — a second file appears under the conflicts root. Right reason: this is the unbounded-republication loop `conflict-copy.ts:46-58` exists to prevent, one level in. | byte-identical ✔ |
| **BK9** | A6 | Delete the `if (!this.writeIsWithheld())` consultation | `canvas-persistence.ts` | **1 red:** *"CONSEQUENCE: a withheld path emits NO conflict copy"* — a copy is emitted beside a board whose file was never overwritten. Right reason: that is the spurious copy A6 exists to prevent. | byte-identical ✔ |
| **BK10** | production wiring | Rename `preserveDiscarded:` at the `main.ts` call site | `main.ts` | **3 red**, all in `test_tp05`. Right reason: the guard is optional on the type, so only a structural census can assert the product wires it. | byte-identical ✔ |

### The break that reddened NOTHING — explained to WP120's standard

**BK3, first run: 35/35 still green.** Removing the tombstone conjunct from `docKnowsRecord` changed
nothing.

**Why.** WP19 made deletion a **value, not an absence**: every delete path writes `deleted[id] := {…}` and
touches `nodes`/`edges` **not at all** (`canvas-sync.ts:1283-1290`). I verified by search that
`canvas-sync.ts` contains **no `nodesMap.delete(id)` / `edgesMap.delete(edgeId)` on the record path** —
the only surviving `.delete(` calls are on bookkeeping maps (`subscribedPaths`, `guidByPath`, timers). So
on every delete path the product has today, a tombstoned record's key is **still in the record map**, and
`nodesMap.has(id)` already answers `true`. **The tombstone conjunct is subsumed by the record-map
conjunct.** That is a legitimate reason for a break to redden nothing — one conjunct subsumed by another —
and it is exactly the case workflow §3.1 says to report rather than clean up.

**It also caught a defect in my own test.** The row was named *"a tombstoned id is knowledge, so an
ordinary delete produces no copy"*, and it was **not measuring the tombstone at all** — it was measuring
the record map. The name overpromised in precisely the way this run keeps finding. Two actions:

1. The row is **renamed to its real subject** (*"…carried by the RECORD-MAP conjunct"*) and keeps its
   comment saying which conjunct carries it and how that was found out. The property it pins — "an
   ordinary delete produces no conflict copy" — is worth pinning whichever conjunct carries it.
2. A **new row** drives the state the conjunct is the only answer to: `deleted` holds the id and the
   record map does not. BK3 now reddens that row and nothing else.

**Is that state reachable?** Stated rather than implied: **not by any path the product has today.** The
conjunct is defence against a change elsewhere, and I kept it because the cost of such a change landing
without it is a conflict copy beside the board on **every ordinary delete** — the usability failure this
whole direction exists to prevent. It is now falsifiable and its reachability is written down in the test
body. **A Dispatcher may reasonably call this a residual rather than a closure.**

---

## 5. DEMONSTRATED vs ARGUED (workflow §3.7)

### DEMONSTRATED

1. **The `doc-wins` cold open discards records the file holds and the document does not** — named ids,
   real `CanvasPersistence`, real `Y.Doc`, real `attachCanvasPersistence`, green on unmodified HEAD.
   *(This is the demonstration `DISPATCHER_STATE.md` §4 says the project does not have.)*
2. **A standing durable seed refusal withholds the ENTIRE `doc-wins` flush**, spares unrelated file-only
   records incidentally, and does not exist at all without WP90's store — four measured rows, each with a
   control.
3. **The predicate is record-level in both directions**, including the two real byte spellings (Obsidian's
   one-record-per-line and the author's compact form), each shown to differ in bytes so a byte predicate
   would have fired, and each producing **no copy and nothing in the ledger**.
4. **An ordinary delete produces no conflict copy**, and the charter's projection-shaped predicate would
   have broken that (BK2 reddens the delete row).
5. **Copy-then-flush**: the copy is written **before** the flush (ordering asserted on the call sequence),
   the flush is unconditional, and a copy that throws leaves `coldOpen` returning `"doc-wins"` with the
   document's content on disk and `failed` incremented.
6. **Every branch is counted and attributable**: `byArm.canvas`, `discardedByArm.canvas`, `failed`, and a
   never-called reading that differs from all three.
7. **The product wires the door**, asserted structurally over `main.ts` with a two-half positive control.
8. **The gate**, re-measured by me on this tree, post-commit (§7).

### ARGUED — not closed

- **That this loss happens on the three live vaults.** I am headless; the demonstration is at the module
  boundary through the production entry point. **W4's arm.**
- **That the copy is the right *user-facing* remedy.** I followed the charter's recommended shape
  (copy-then-flush) and its justification (`preserveLocalVersion`'s never-throws precedent, and
  `DISPATCHER_STATE.md` §5's rule that divergence is never an acceptable steady state, which a
  refusal-alone would violate). Whether users find the copies is a live question.
- **That `getCanvasGuid` is non-null in practice**, i.e. that WP90's protection is actually armed on real
  boards. Traced, not measured. §3's second finding.
- **That the tombstone conjunct will ever run.** Argued only — see §4's BK3 explanation.
- **That the conflicts root is correctly *excluded from sharing* for canvas copies.** I reuse
  `conflictCopyPath`, so the copies land under the same owned root `isSharedPath` consults
  (`manifest.ts:1165`), and I read that predicate. But I did not drive `isSharedPath` over a canvas
  conflict copy end-to-end; `test_tp04` asserts the **path** is under the root, not that the manifest
  refuses to publish it.

---

## 6. What I could not separate (workflow §3.6)

- **The `writeIsWithheld()` double call.** `coldOpen` now calls it once for the preservation decision and
  `flushToDisk` calls it again. It is idempotent in outcome, but it **prunes** and it **narrates**, so on a
  path where the lift fires the `SEED RESTORED:` line is emitted by the first call and the second returns
  early. I could not separate "the narration count changed" from "nothing changed" without adding a
  narration-count assertion that would pin log volume as a specification — which is a shape this run has
  been burned by. **Named, not measured.** The alternative (a cached verdict) would put a second piece of
  state between the two, which is worse.
- **BK1's 11 reds are not 11 independent signals.** Nine of them are downstream of the same fact (no
  flush ⇒ nothing to preserve against). I did not try to isolate which rows would still redden under a
  narrower break, and I am not claiming BK1 as evidence for anything but A1.
- **`test_tp05` reads the live working copy of `main.ts`** — the same shape as `S88`'s caveat for
  `file-ops.ts`/`vault-events.ts`. A batch editing `main.ts` makes those three rows transiently red, and
  the redness would not be attributable to WP121. Stated so the next batch does not mis-attribute it.
- **The `toLocalPath` path-form caveat.** `conflictCopyPath` and `isConflictsPath` receive `this.diskPath`,
  which production fills from `toLocalPath(canonical)` — a Windows-only mapping of vault-illegal ASCII to
  fullwidth. If a `sharedFolder` name contains such a character, the prefix strip fails and the copy lands
  under the conflicts root with a flattened name. It is still **inside** the root (so the owned exclusion
  still covers it) and still stamped, so the failure is cosmetic, not a loss. I did not test it — no
  fixture in this suite exercises fullwidth mapping, and inventing one would have been a test with no
  production subject.

---

## 7. Gate — measured by me, on this tree, in this session

Run from `plugin/` **after** the landing commit `a546d54`, on a tree whose only other change is an
untracked `workflowArtifacts/canvas-v2/temp.md` that is not mine:

```
./node_modules/.bin/tsc -noEmit -skipLibCheck      → exit 0
./node_modules/.bin/vitest run                     → 434 files / 3310 tests / 0 failed
npm run build                                      → exit 0
(from workflowArtifacts/canvas-v2/) check_signal_register.py → exit 0
    "scanned 246 files … (control: all classes proved) … clean - no NEW violations"
```

**Delta against the Dispatcher's baseline (429 / 3275):** +5 files, +35 tests, all of them
`__tests__/v2/wp121/`. Every one of the 3275 pre-existing tests still passes.

### Caveats I attach to that figure — a worker's caveat is part of its result

- **`S153` DID NOT FIRE.** WP92's `no_collateral` was green **while my work was uncommitted**, which the
  brief predicted would be red. Not a contradiction of the caveat: that test asserts a *specific* file is
  absent from `git diff HEAD`, and my change set does not include it. **Do not read my green as evidence
  that `S153` is resolved** — it was never exercised by this batch.
- **`S88` did not apply.** I touched neither `file-ops.ts` nor `vault-events.ts`. Verified in
  `git show --stat a546d54`.
- **`wp5/latency.test.ts` took 38.4 s**, of which one row idles 33.5 s by design. Not hung.
- **Plain `vitest run` throughout.** No `--reporter` flag was passed at any point.
- **`npx biome check --write` was never run.**
- **The suite was measured with no sibling worker in the tree.** `git status` was clean of foreign
  modifications on every run.

---

## 8. Corrections to the charter (§6.5 — nine in a row, and this is the tenth)

1. **§2's predicate wording is wrong.** *"records the post-migration doc **projection** does not"* fires on
   every ordinary delete. The predicate must ask about **document knowledge** (record keys ∪ tombstones),
   not about the projection. Demonstrated in §1 and by break BK2. **This is the substantive correction.**
2. **§5's sibling constraint is stale.** *"Batch B58 / WP120 owns `canvas-presence.ts`, `canvas-sync.ts`
   and `main.ts` — do not touch."* WP120 landed at `5b1a25e` and the Dispatcher's brief states I am the
   only worker in this tree. **I edited `main.ts`** (one options block at `:3760`, 12 lines) because
   without it the guard has no production caller and A4's *"`sync.conflictCopies` able to show a canvas
   event live"* is unreachable. I did **not** touch `canvas-presence.ts` or `canvas-sync.ts`.
   **WP120's presence pin re-verified by me, not quoted:** `canvas-presence.ts` LF-normalised sha256 is
   `2cefc9a88bb407bfd4a28b432ad901c20be6cc1f8a6e0c936e61b86f07ff16c9`, matching `PRESENCE_SHA256_LF`
   (`__tests__/v2/wp21/test_tp04_…:77`) exactly, and `git diff 5b1a25e HEAD -- plugin/src/canvas/canvas-presence.ts`
   is empty. **Note for the next reader:** the pin is over **LF-normalised** bytes; the working copy is
   CRLF and hashes to `6223e7c8…`, so a naive `sha256sum` of the file on disk does **not** match the pin
   and is not evidence that it moved. Flagging the `main.ts` edit explicitly so the Dispatcher can rule.
3. **A6's premise is inverted.** The charter assumed protection ⇒ the predicate must exclude refused ids.
   Because the protection is **whole-file**, the right answer is a branch skip, and an id exclusion would
   have been a second, redundant rule free to drift from the first.
4. **The charter file itself is malformed.** `TaskCharter_WP121_WinningIsNotALicenceToDiscard.md` ends at
   lines 269-270 with `</content>` and `</invoke>` — leaked tool-call closing tags from whatever wrote it.
   Harmless to read, but it means the file was truncated or appended to by a failed write, and a
   Dispatcher who diffs charters will see it.
5. **§5's baseline placeholder** (`[Dispatcher to insert]`) was filled by the dispatch brief with
   429 / 3275 at `5b1a25e`. Confirmed consistent: my +35 lands exactly on 3310.

---

## 9. Handoff (Rule 13) — what a newcomer takes longest to rediscover

### Established, with file and line

| what | where |
|---|---|
| The pure predicate + its three "deliberately not" clauses | `plugin/src/files/canvas-discard-guard.ts` — `decideCanvasDiscard` |
| Document **knowledge** vs **visibility** (the tombstone rule) | `canvas-persistence.ts` — `docKnowsRecord` |
| The preservation call, its position between migrate and flush, and the A6 skip | `canvas-persistence.ts` — `coldOpen`, `docNonEmpty` branch |
| The never-throws copy, all four counted branches | `canvas-persistence.ts` — `preserveRecordsTheDocDoesNotKnow` |
| Why the door is **not** `PersistenceIO` (two reasons, both load-bearing) | `canvas-persistence.ts` — `CanvasDiscardPreservation` doc comment |
| `discardedByArm` + the one shared `CONFLICT COPY SKIPPED:` spelling | `conflict-copy.ts` — `conflictSkippedMessage`, `noteConflictSkipped`, `countDiscard` |
| The production wiring, through `baseIo`, parameter named `copyPath` | `main.ts:3753-3766` |
| A6's four measurements | `__tests__/v2/wp121/test_tp02_…` |
| The two-half positive control for the wiring census | `__tests__/v2/wp121/test_tp05_…` — `PRE_WP121_ATTACH` |

### Designs I REJECTED, and why

1. **Reusing `decideConflictPreservation`.** Wrong question (session boundary vs record level). Charter
   §2 predicted I would reach for it; I read it first and did not.
2. **Any byte / `sha256` / size oracle**, in the predicate *or* in a test. `S174`: three stable byte forms
   for identical records. Break BK2 is that design, planted deliberately, and it reddens the rows that
   matter.
3. **Refusal instead of a copy.** It leaves the board split, which `DISPATCHER_STATE.md` §5 rules is never
   an acceptable steady state, and a refusal that leaves the board writerless re-creates the defect WP122
   exists to remove. Took the charter's recommended shape.
4. **Routing the copy through `PersistenceIO`.** Two reasons: (a) in production `io.write` is decorated by
   WP87's editing-aware hold, which would queue a conflicts-root copy under the *canvas* path's key; and
   (b) `PersistenceIO.read` is asserted **absent** on the `doc-wins` branch by two existing packages
   (`canvas-persistence.test.ts:424`, `v2/wp25/tp08:188`) — a proxy for "no file→CRDT input" that my read
   does not violate but *would* have tripped. A separate door keeps both true and **no other package's
   test was edited.**
5. **Making `preserveDiscarded` a required option.** Would have broken every pre-WP121 caller and every
   headless fixture. Replaced by a structural census over `main.ts`, which is the same trade `wp92/`
   already makes.
6. **Adding a refused-id exclusion to the predicate.** Redundant once A6 was measured — see §3.
7. **Editing `wp87/surface-route-census.ts` or its test.** See the next section.

### Residuals I deliberately left

- **The WP87 census has a spurious-unit parse, and my change was the first to make it bite.**
  `surface-route-census.ts`'s `UNIT_SIGNATURE` matches any line of the form `name(`, so the **argument**
  `toLocalPath(canonical),` inside `main.ts`'s `attachCanvasPersistence(...)` call is parsed as a unit
  named `toLocalPath` whose "body" is the following options object. That pseudo-unit was harmless until my
  options object contained a `write(diskPath` call, at which point it became a sink, was reported
  **UNGUARDED**, and *additionally* reclassified the real `main.ts#attachCanvasWriter` as
  `DEFINER-FACTORY` (because it now enclosed another sink) — so `byDisposition.get("GUARDED")` went
  `undefined` and **two rows of WP87's criterion failed for a route that does not exist.**
  **I did not edit WP87's package.** Instead I named the copy's parameter `copyPath`, which is what the
  census's own vocabulary asks for: `deriveFileWriters` discriminates on the first parameter's name
  precisely because `write(` alone also matches *"a markdown sink, a sidecar checkpoint and **a conflict
  archive**"* (its words). This **is** the conflict archive. Pinned by a `test_tp05` row so a future
  rename is a red row rather than a puzzle in somebody else's package. **The parser defect remains, and a
  Dispatcher may want it signalled.**
- **Field-level divergence is out of scope.** A record the document holds under the same id with different
  values is a convergence question, not a discard. Stated in `canvas-discard-guard.ts`'s header rather
  than half-implemented.
- **An edge pruned because its endpoint is invisible is not counted separately.** If the endpoint node was
  discarded, the node itself is counted and the copy is written anyway; if the endpoint was tombstoned,
  the prune is a deliberate delete's cascade. Either way the edge's own key is in `edgesMap`, so it is
  never a discard on its own. Deliberate, and stated here rather than discovered later.
- **`temp.md`** in `workflowArtifacts/canvas-v2/` was untracked when I arrived and is untracked now. Not
  mine, not staged.
- **WP122-shaped work I saw and left:** `main.ts`'s `attachCanvasWriter` is reached from
  `armCanvasMirrorPass` / `processManifestChange` and from the leaf-driven site at `:2710`/`:2766`.
  WP122's fork of the cold-open decision belongs there and I touched none of it. **What WP121 gives WP122
  is exactly the safety net its §0 says it needs:** when WP122 makes this branch fire automatically on
  every host-held canvas in the manifest, each of those cold opens now leaves a recoverable copy of any
  board the document is missing records from, and each one is counted and attributable in
  `sync.conflictCopies`.

---

**Status: HANDOVER_READY.**
