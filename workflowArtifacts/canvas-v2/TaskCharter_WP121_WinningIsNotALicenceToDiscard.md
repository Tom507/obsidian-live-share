# WP121 — Winning is not a licence to discard

**Source:** `Investigation_CanvasConvergence.md` §5 **R7** · **Owner decision 2026-08-08** (the narrow remodel) ·
**Branch:** `fix-bugs-and-raceconditions` · **Lands BEFORE WP122, and WP122 depends on it.**

---

## 0. The premise you were probably handed is WRONG — read this before anything else

**WP121 is not chartered on a demonstrated data loss.** The dispatch conversation that produced this package
described the canvas `doc-wins` arm as *"the only demonstrated data-loss route in the project"* and cited
Investigation §6 — 318 nodes and 74 edges of the owner's `smoke.canvas` destroyed, 45 603 B → 1 730 B.

**That claim has been withdrawn.** `DISPATCHER_STATE.md` §6:

> *"Opening a canvas destroyed 318 nodes of the owner's board." **WITHDRAWN.** The board is healthy — 9 nodes,
> 2 247 B, identical on all three vaults. The 327-node snapshot was **our own test spam**. The change is **not
> attributable** to `doc-wins`; a cleanup action is at least as likely, and the owner said so first.*

And `DISPATCHER_STATE.md` §4 files this path under **"Traced in code, NOT measured — do not cite these as
facts"**: *"The path exists and the equivalent guard exists for notes. **There is no demonstrated instance.**
Worth closing on principle; **not** a blocker, **not** a proven data-loss defect."*

**Investigation §6 is superseded on this point. Do not repeat the 318-node figure in your report, in a test
name, or in a comment.** If you find it already written into the tree somewhere, say where.

**So why is this package worth doing, and worth doing first?** Because the honest justification is stronger
than the withdrawn one:

> WP122 attaches a CRDT→disk writer on the host's own creates. **An attach cold-opens, and a cold open on a
> non-empty doc flushes** (`main.ts` `attachCanvasWriter` → `attachCanvasPersistence` → `coldOpen()` →
> `docNonEmpty` → `doc-wins` → `flush()`). WP122 therefore converts a path that is today reachable only when a
> human opens a board into one that fires **automatically, on every host-held canvas in the manifest, at the
> next mirror pass**. On boards that are *already divergent today*, that is all of them at once.

**A code-derived risk that a sibling package is about to make reachable-by-construction is exactly the thing to
close before that package lands.** That is the charter's warrant. Nothing else is.

**Consequence for your first acceptance criterion:** the project does not have a demonstrated instance of this
loss. **A1 is that demonstration.** If you cannot build it, that is a *result* — see A1.

---

## 1. The defect, with the lines verified against the tree on 2026-08-08

| what | where | verified |
|---|---|---|
| `coldOpen()` | `plugin/src/files/canvas-persistence.ts:608` | ✓ |
| `docNonEmpty` = `nodesMap.size > 0 \|\| edgesMap.size > 0` | `canvas-persistence.ts:612` | ✓ |
| `doc-wins` → `migrateRecordBearingDoc()` → `await this.flush()` → `return "doc-wins"` | `canvas-persistence.ts:613-620` | ✓ |
| *"Doc NON-EMPTY → the doc wins: **the file is NOT read**… the stale file is overwritten from the doc"* | `canvas-persistence.ts:583-584` (its own docstring) | ✓ |
| the conflict-copy machinery | `plugin/src/files/conflict-copy.ts` | ✓ |
| its only production caller | `ManifestManager.preserveLocalVersion`, `manifest.ts:1205`, arms **`"text" \| "binary"`** (`:1208`), called at `manifest.ts:687` (binary) and `:792` (text) | ✓ |
| the live ledger read | `sync.conflictCopies` → `e2e-control.ts:1645` | ✓ |

**There is no canvas caller. There is no canvas arm.** When `doc-wins` overwrites a `.canvas`, nothing is
copied, nothing is refused, and — because the ledger has no canvas arm — **`sync.conflictCopies` reads exactly
the same on a vault that just lost a board as on one that did not.** The loss is unprevented *and*
unobservable, and the second half is what would make the next live round unable to attribute it.

---

## 2. 🔴 READ THE PREDICATE BEFORE YOU WRITE IT INTO AN ACCEPTANCE CRITERION

This run has already accepted *"Tier 1 closed — `.obsidian/**` is protected"* when the predicate behind it was
`.obsidian/liveshare/state` (`S94`, workflow §3.3). **A scope claim is only as good as the predicate that
implements it.** So, before you reuse anything:

**`decideConflictPreservation` is the WRONG predicate for this package, and it is the one you will reach for.**
`conflict-copy.ts:313-338` decides on `mtime` versus `settings.lastSessionEndedAt`. That answers a
**session-boundary** question — *"did this peer change the file while it was away?"* — for a guest rejoining a
share. The `doc-wins` question is a **mid-session, record-level** one: *"is the projection about to land on this
file missing records the file currently holds?"* The two are not the same question and the first cannot answer
the second.

**Reuse the placement and the ledger. Do not reuse the predicate.**

- Reusable, and you should: `conflictsRootFor` (`:39`), `conflictCopyPath` (`:82`), `conflictStamp` (`:65`),
  `isConflictsPath` (`:61`), `noteConflictCopy` / `noteConflictDiscard`, `ConflictCopyLedger` (`:110-137`).
- **`isConflictsPath` matters more than it looks.** It is an *owned* exclusion consulted directly by
  `isSharedPath`, and `conflict-copy.ts:46-58` explains why: a conflicts folder that ever counted as shared
  would be published, re-conflicted on the next join, and multiply without bound. Your canvas copies inherit
  that property for free **only if you put them under the same root.** Anywhere else and you have invented an
  unbounded republication loop.

**The predicate this package needs, stated once:** *the set of record ids (nodes and edges) that the file holds
and that the post-migration doc projection does not.* Named ids. Not bytes, not file size, not a record count.

**State that predicate in one sentence in your report, and name the test that pins it.**

---

## 3. Acceptance

### A1 — DEMONSTRATE THE LOSS BEFORE YOU REPAIR IT

A test in which `coldOpen` takes the `doc-wins` branch over a file holding records the doc does not, and those
records are **gone from disk afterwards**. Named ids in the file before; the same named ids absent after.

This is the demonstrated instance the project does not have, and producing it is the more valuable half of the
package. Drive the real `CanvasPersistence` over a real `Y.Doc` — **no partial test doubles** (six packages lost
to them; a double standing in for `flush` will hide this perfectly, because the defect *is* what `flush` writes).

**If you cannot build it — if every route you try turns out to be already guarded — STOP AND SAY SO.** That
finding is worth more than the fix: it would mean `DISPATCHER_STATE.md` §4 is wrong in the other direction and
the path is unreachable, which changes WP122's risk profile entirely. Report it with the guard that blocked you
and its line.

**Discriminator (workflow §"a green battery can be vacuous"):** ask what this test does on the *repaired*
build. It must go green **because the guard ran**, not because the flush happened to change shape. If a
no-op refactor of `flush` would also turn it green, it is not measuring your repair.

### A2 — The predicate is record-level, and it is proved in BOTH directions

🔴 **No acceptance criterion in this package may score a canvas on `sha256`, on byte-identity, or on file
size.** `S174` and Investigation §2.2: a `.canvas` has **three** stable byte forms on this build —

- the author's / whatever wrote the file,
- the plugin's canonical `serializeCanvas` = `JSON.stringify(buildCanvasData(…), null, "\t")`
  (`canvas-sync.ts:1253`, the `stringify` at `:1258`),
- and **Obsidian's own** one-record-per-line form,

— measured live at 235 B / 296 B / 218 B for **identical records, zero field differences**. A byte oracle
produces red for boards that are perfectly in sync, and green for boards that are not, whenever two spellings
happen to coincide. **Score on parsed records.**

Two rows, both required, both with a positive control:

- **fires:** the file holds a record the doc lacks → the guard acts.
- **stays silent:** the file and the projection hold **identical records in different spellings** → **no copy,
  no refusal, nothing in the ledger.** Build this row out of two of the three real spellings above, not out of
  a whitespace tweak you invented.

The second row is the one that decides whether this package is usable. A guard that fires on spelling puts a
conflict copy beside every board on this build, which trains the user to ignore the folder — functionally the
same as having no net at all, with extra clutter.

### A3 — Copy, refuse, or both — YOU decide, and you justify it

The charter does not pick for you. It fences you:

- **`I11` — refusal never destroys.** If you refuse the flush, the file keeps its bytes; fine. But then say what
  makes the board converge afterwards, because **`DISPATCHER_STATE.md` §5 rules that divergence is never an
  acceptable steady state, including serialisation-only divergence.** A refusal that leaves a board permanently
  split has traded a data loss for a priority-1 violation.
- **A refusal that leaves the board writerless forever re-creates exactly the defect WP122 exists to remove.**
- **Recommended shape, and say why if you reject it: copy, then flush.** The copy is strictly additive, the
  doc's records still land so convergence is unaffected, and the precedent is already in the tree —
  `preserveLocalVersion`'s contract is *"NEVER THROWS… a vault that refuses the copy must still receive the
  host's content, because failing the sync would turn a best-effort safety net into a new outage"*
  (`manifest.ts:1196-1204`). Refusal-alone is the option that collides with priority 1.

### A4 — The ledger says what happened, on every branch

`S155`, and this module already learned it the expensive way: `ConflictCopyLedger.discarded` exists
(`conflict-copy.ts:110-137`) because *"a guard that RAN and decided 'merely stale' was indistinguishable from a
guard that was NEVER CALLED: both read `{total: 0, byArm: {}, failed: 0}`"* — and a live round measured exactly
that reading on three vaults, and **a report and a charter were both written from it concluding the wrong
thing.**

So: a **canvas arm** in `byArm`, incrementing on the acted branch; the do-nothing branch counted too; and
`sync.conflictCopies` (`e2e-control.ts:1645`) able to show a canvas event live. **Without this, the next W4
round cannot attribute a canvas loss even if it sees one.**

### A5 — Do not widen

- **Do not change who wins.** `doc-wins` still wins. `conflict-copy.ts`'s own header rule — *"THIS MODULE DOES
  NOT CHANGE WHO WINS"* — is what makes WP121 landable ahead of WP122 without re-opening the seed decision
  (`canvas-seed-decision.ts`), and re-opening that is a different package with a different blast radius.
- **`.canvas` only.** The owner **deferred** the canvas-only-versus-general-file-sync question. `.md` is
  measured unaffected — a guest's editor edit reaches the host's disk at the first poll, 0.00 s
  (Investigation §1.3). **Do not touch `background-sync.ts` or the text conflict path.**
- **Do not touch `file-ops.ts` or `vault-events.ts`** — `S88`: `v2/wp93/`'s census tests read the **live working
  copy** of those two files, so the gate goes transiently red while they are being edited, and the redness is
  not attributable to you.

### A6 — Establish, do not assume, what the refusal ledger already protects

`coldOpen` runs `hydrateDurableRefusals()` **first**, ahead of the `docNonEmpty` branch (`:610`), and the reason
is stated at `:599-606`: *"`doc-wins` flushes and that flush is where a refused record is deleted from the
user's file one restart after it was protected."* WP63/WP90/WP92 built that machinery for a neighbouring case.

**Find out whether a refused record is already protected from this flush, and say which.**

- If it **is**, your predicate must exclude those ids, or you will emit a spurious conflict copy on every cold
  open of every board that ever refused a record.
- If it **is not**, say so plainly — that is a second live instance of the same class and the Dispatcher needs
  it as a finding, not as a footnote.

---

## 4. Method — the break table (Dispatcher Rule 11 / workflow §3.1)

For **every** acceptance criterion: break the thing it protects, run the test, show it **RED for the right
reason**, restore the break **byte-identically by copy-aside**, show it **GREEN**. Report the break and what it
reddened. **A break that reddens nothing is a finding, not a cleanup item** — report it and explain why.

**The specific plant most likely to expose the failure mode THIS package can introduce:**

> **Weaken the predicate from a record-set difference to a byte or size comparison** — e.g. make the guard fire
> when `serializedFile.length !== projection.length`, which is the shape any reviewer would accept at a glance.
>
> **A2's identical-records-different-spellings row must go RED. A1 must stay GREEN.** That combination is the
> whole discriminator: a byte predicate still catches the real loss, so A1 alone cannot detect the mistake.

Two more, both required:

- **Make the copy throw.** The flush must still happen (A3 / the never-throws contract) and `failed` must
  increment. If nothing reddens, the never-throws property is untested.
- **Delete the `discarded`/do-nothing counter increment.** A4 must go red. If it does not, A4 is being asserted
  by something other than the counter and the S155 lesson has not actually been applied.

⚠ **Restore by copy-aside only.** A sibling worker shares this checkout. **Never `git checkout` or `git stash`
to undo a break** — it takes the sibling's uncommitted work with it.

---

## 5. Gate

From `plugin/`, in this order:

```sh
./node_modules/.bin/tsc -noEmit -skipLibCheck
./node_modules/.bin/vitest run
npm run build
```

then `check_signal_register.py`, exit 0.

- **Plain `vitest run`.** `--reporter=basic` **does not exist in this version and fails to load**, which looks
  exactly like a suite failure and is not.
- **Baseline: `[Dispatcher to insert]`.** There is **no confirmed count at HEAD** — the gate run started at
  `e974fdd` died on a console launcher fault before reporting a total, and the older **3260 / 428** at `d188b0e`
  is stale. **Do not write a number you did not measure yourself, and do not copy 3260/428.**
- **Caveat `S153`:** WP92's `no_collateral` asserts a file is absent from `git diff HEAD` — **red while your
  work is uncommitted, green once committed.** Confirmed three times. Not a real failure. **Do not edit another
  package's test.**
- **Caveat `S88`:** as A5 says — stay out of `file-ops.ts` and `vault-events.ts`.
- **Never `npx biome check --write`** — it corrupts this tree.

**Hard constraints**

- **Sibling in the tree.** Batch B58 / WP120 owns `canvas-presence.ts`, `canvas-sync.ts` and `main.ts` —
  **do not touch, stage, revert or checkout any of them.** You may read anything.
- **Explicit path staging only.** `git commit -o <paths>`; `git add -N <path>` first for a new file.
  **Never `git add -A`.** Never commit to a default branch.
- **`M` with an empty `git diff` is ambiguous** — CRLF artefact, or a mode/symlink flip diff structurally cannot
  show. Distinguish with `git ls-files -s` + `git hash-object`, never by reading the diff.
- **`data.json` holds live credentials** — never print, log, echo or fixture a value. sha256-of-bytes only.
- **Do not rebuild, redeploy, or drive the three live vaults.** This is a headless package.
- **Commit before you report.**

---

## 6. Report

**Deliverable:** `workflowArtifacts/canvas-v2/ImplementationReport_WP121.md`.

1. **Split every finding into DEMONSTRATED and ARGUED** (workflow §3.7). Only the first counts as closed. Given
   §0, this package's headline claim is precisely a demonstration that did not previously exist — if it ends up
   in the "argued" column, say so in the first line of the report.
2. **The predicate, in one sentence**, and the test that pins it.
3. **The break table**, one row per AC.
4. **The gate figure you measured yourself**, with the tree state it was taken on.
5. **Correct this charter if it is wrong.** Eight workers in a row have corrected the premise handed to them and
   every one of them was right. §0 is itself a correction of the brief that produced this file.
6. **Signal numbers: next free is S175, and you allocate none.** <!-- signal-register: meta -->
   Describe findings in prose; the Dispatcher numbers them in `SIGNAL_REGISTER.md`.
</content>
</invoke>
