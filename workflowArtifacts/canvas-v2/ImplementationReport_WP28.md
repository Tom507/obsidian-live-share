# Implementation Report — WP28

**Attempt:** 2
**WP:** WP28 — Epoch rule + conflict archive
**Phase:** P2

> **Attempt 2 changes nothing about the mechanism and everything about its argument
> domain.** All four ACs, the wiring and the call site are as attempt 1 shipped them; what was
> added is a single validation rule applied uniformly to every export, because two of them
> construct a filesystem path that becomes the only surviving copy of work being overwritten.
> See **Generalization (attempt 2)**.

---

## Status

`DONE` — 104/104 visible green, `tsc --noEmit -skipLibCheck` clean, WP24/WP25/WP26/WP27 all
still green, full plugin suite **1687 passed / 0 failed** (reference 1583/0; delta **+104**,
exactly this WP's visible set). No test file was edited, added or deleted.

One architectural finding is attached and it is not cosmetic: `resolveEpochConflict`'s
**complete** adoption (AC1) is reachable only from the replica that MATERIALISES the winner,
which is WP30's import. It is wired as `CanvasSync.adoptEpochWinner`. The **archive + notify +
signature** half (AC2/AC4) is wired to a live production caller today. Both are spelled out in
**Call Site** below, with the reason the loser side cannot do a complete adoption after the fact.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — `meta.epoch` monotonic + host-incremented; higher epoch wins completely on every replica | DONE at the module boundary; PARTIAL in the shipped plugin | `nextEpoch` normalises FIRST, so it is strictly greater for every input including corrupt cells. `bumpEpoch` is ONE transaction touching only `meta` and returns what it wrote. `adoptWinner` REPLACES `nodes` / `edges` / `deleted` wholesale in one `CANVAS_EPOCH_ADOPT_ORIGIN` transaction — not `Y.applyUpdate` (a union), not a tombstone sweep. The shipped-plugin caveat is the winner-materialisation problem, see **Call Site**. |
| **AC2** — loser writes `<name>.conflict-<date>.canvas` BEFORE adopting; user notified with a message naming the file | DONE | Serialise → path → `await write` → notify → adopt, in that order, sequenced not raced. A rejecting write propagates and adopts nothing: no transaction, no notice, no log. `epochConflictNotice` carries the path verbatim inside a sentence. |
| **AC3** — equal epochs merge normally; the archive path does not trigger | DONE | `verdict !== "remote-wins"` returns before the first side effect: no serialise, no write, no notify, no log, and not one transaction on the doc. The **local-wins** side is on the same branch, so a replica that is AHEAD does not archive a copy of the state it is about to keep. |
| **AC4** — a distinct log signature records every epoch conflict with both epoch values | DONE | `EPOCH CONFLICT signature: <path> local=<n> remote=<m> -> <verdict>, archived to <path>`; both numbers labelled, verdict named, archive named, and the opening marker is distinct from `INGEST REJECTED` / `QUARANTINE RAISED` / `QUARANTINE LIFTED`. Throws on an equal pair. Emitted once on `logger.warn("canvas-epoch", …)` and returned in the outcome; a missing logger is not an error. |

### The six traps, and what was done about each

1. **Archive BEFORE adopt.** `env.serializeDoc(doc)` and `await env.writeConflictCopy(...)` are
   both sequenced ahead of the single `doc.transact(...)`, and the write is AWAITED rather than
   issued alongside it — an archive racing the adoption is the same defect as one following it,
   only harder to see. Fail-closed falls out of the same shape: the rejection propagates out of
   `resolveEpochConflict` before `env.notify` and before `adoptWinner` are ever reached, so the
   doc is provably untouched (no transaction is opened at all, which is stronger than "no net
   change").
2. **Not on every merge.** The equal / local-wins branch returns the outcome object and nothing
   else. It never calls `serializeDoc`, so even the *projection* is not computed — which matters,
   because a serialise on the ordinary path would be a per-merge cost as well as a wrong signal.
3. **Complete, not partial.** `adoptWinner` deletes every existing key in each container before
   inserting the winner's, so the loser's node id set becomes EXACTLY the winner's and a
   loser-only record is absent AS A KEY, not tombstoned. Records are copied with `Y.Map.clone()`
   (nested shared types survive — P4 moves node `text` to a `Y.Text` within the same major), so a
   shared id takes the winner's record WHOLE rather than a field-wise blend. The `deleted`
   container is replaced with the same rule, and a winner with an empty board empties the loser.
   `winner` is read-only throughout.
4. **No `Number(value)`.** `normalizeEpoch` is `typeof value === "number" && Number.isInteger(value)
   && value >= 0`, else 0. `Number.isInteger` already rejects `NaN` and both infinities; a numeric
   string, a boolean, an object and an array all fail the `typeof` gate before any arithmetic. A
   corrupt `"9"` cell therefore reads as 0 and loses every conflict it enters.
5. **`conflictCopyPath` REPLACES the extension.** `path.slice(0, -".canvas".length)` + the suffix,
   so only the trailing occurrence moves and `plan.canvas.canvas` / a `my.canvas.folder/` parent
   both survive — `String.replace(".canvas", …)` replaces the FIRST occurrence and breaks on both.
   The directory is preserved at every depth. Refuses a non-`.canvas` path (case-sensitively), a
   stem-less path, a blank date, a date carrying a separator or `..`, and a non-string argument —
   throwing rather than coercing, because a stringified `undefined` produces a real file
   containing real work under a name nobody will look for.
6. **Notice names the file, signature carries both epochs.** `epochConflictNotice` interpolates
   the conflict path into a sentence that also says what happened. `epochConflictSignature`
   labels `local=` / `remote=` so the pair cannot be read backwards, and is not a delta.

---

## Generalization (attempt 2)

Attempt 1 was measured against the visible set and passed it. The visible set is a **sample**:
it exercises `conflictCopyPath` with nine well-formed paths and six well-formed dates, and it
never calls any export with an argument a *different caller* might supply. `canvas-epoch.ts` is a
library — `canvas-sync.ts` calls it today, WP30 calls it tomorrow, and neither is inside my
diff — so "the tests supply good arguments" is not a property of the module.

### The rule, stated once and applied to the whole surface

> **Every exported function validates the full domain of every parameter, before the first
> irreversible action, and refuses loudly rather than returning a plausible wrong answer.
> Everything that names a location goes through the SAME two predicates.**

That last clause is what makes it a generalization rather than a wider patch. There is one
`assertVaultPath` and one `assertPathComponent`, and every path-shaped or name-shaped argument in
the module is routed through them, so the set of rejected inputs is *identical* at every
export. A traversal guard bolted onto `conflictCopyPath` alone would have left
`epochConflictSignature` and `epochConflictNotice` free to print `../../elsewhere` and
`undefined` — the same class, one function to the left.

### Why the path is a data-integrity property, not hygiene

The conflict copy is the **only** surviving record of work that is about to be overwritten. Every
member of the class below returns a `string` that looks exactly like a correct answer, so the
caller cannot detect it, and the damage is a real file, containing real work, in a place nobody
will look:

| Class | Inputs that produced it before attempt 2 | What the user loses |
|---|---|---|
| **Escape** | `../../elsewhere/plan.canvas`, `/etc/plan.canvas`, `C:/x/plan.canvas`, `boards\plan.canvas`, and — the one I had *documented as rejected and was not* — a `date` of `..` or `.`, both of which match a name charset | The archive lands outside the board's folder or outside the vault |
| **Collision / silent mis-naming** | a NUL or control character (`a\0b.canvas` truncates at the syscall boundary), `a//b`, `a/./b`, a segment padded with whitespace (Windows strips a trailing space, so two different strings name one file) | The archive overwrites, or *is* overwritten by, an unrelated file |
| **Coercion** | a non-string reaching a template literal → `undefined.conflict-2026-08-02.canvas`; `archivedTo: undefined` → a log line reading "archived to undefined"; `env.serializeDoc` returning `undefined` → a four-byte "archive" | A file the user cannot find, or a notice/log pointing at nothing |

**The `date` hole is the honest one to call out**: attempt 1's comment claimed the date could not
carry a `..`, and its regex `[A-Za-z0-9._-]+` admitted `..` and `.` outright. The stated
guarantee was false. It is now enforced, and enforced by the shared predicate rather than by a
second bespoke check.

### The same question asked of the non-path exports

Applying the rule uniformly turned up a defect that has nothing to do with paths:

- **`normalizeEpoch` used `Number.isInteger`.** `2 ** 53` is an integer, so it was admitted — and
  at that magnitude `n + 1 === n`, so `nextEpoch`'s pinned guarantee ("strictly greater, for every
  input") was false there. A single corrupt cell holding one would have frozen the board's epoch
  **permanently**, and the only symptom would be that imports quietly stop winning conflicts. The
  domain is now `Number.isSafeInteger`, which makes the guarantee total; `nextEpoch` throws a
  `RangeError` at the ceiling rather than returning a value that reads back as unbeatable, and
  `bumpEpoch` computes it **before** opening its transaction so the refusal cannot half-write
  `meta`. (`-0` now normalises to `+0` on the way past.)
- **`readEpoch` / `bumpEpoch`** duck-type their `doc` (not `instanceof`, which breaks on a second
  copy of Yjs in the module graph) so a `null` argument names the parameter instead of throwing
  `Cannot read properties of undefined (reading 'getMap')`.
- **`epochConflictSignature`** now type-checks both epochs and treats `undefined !== null` for
  `archivedTo`; `null` stays the one way to say "no archive", spelled out rather than inferred
  from falsiness, so `""` cannot mean it too.
- **`resolveEpochConflict`** validates `args`, both docs, `canvasPath` and all four `env`
  callables **up front, on every verdict — including the equal-epoch path that does nothing**.
  That ordering is the point: validating lazily meant a missing `env.notify` threw at step 4 with
  the archive already on disk and no outcome object mentioning it, and it meant a caller's bad
  argument was first exercised at the first *real* conflict in the field. The equal-epoch merge
  runs thousands of times a day and is where a wiring mistake should surface. It also rejects
  `doc === winner`, which is always "equal" and therefore an invisible wiring bug, and it rejects
  a non-string from `env.serializeDoc` **before** the write.

### The write side, where the last collision lives

`conflictCopyPath` is deterministic and day-granular, which the tests pin ("distinct dates give
distinct copies") — so a second conflict on the same board on the same day names the **same
file**, and the file already there is another loser's only copy. A pure function cannot see that.
`CanvasSync.writeConflictCopy` therefore **never clobbers**: an identical body is an idempotent
re-run and succeeds, anything else throws — and because the mechanism is fail-closed, the refusal
also cancels the adoption, so nothing is lost at all rather than one copy being traded for
another.

### Verification

The refusals were exercised by a throwaway probe (17 rejected path/date pairs, the safe-integer
ceiling, the doc guards, the notice/signature guards, and a check that a rejected argument never
reaches the write channel), confirmed green, then **deleted**. The full-suite total is unchanged
at 1687, which independently confirms the probe is gone and that no test file was added.

---

## Blocked Items

None blocking. One scoped limitation, recorded rather than worked around — see **Call Site**.

---

## Tools Created

None. No `TOOL_REQUEST` was needed.

---

## Changes Made

### `plugin/src/canvas/canvas-epoch.ts` — NEW

The §7.0 surface, **verbatim and unchanged in attempt 2** — no export renamed, removed or
re-signed; only refusal behaviour was added — plus module-private `RECORD_SPACES`,
`TOMBSTONE_SPACE`, `CANVAS_EXT`, `MAX_EPOCH`, `SAFE_COMPONENT`, `CONTROL_CHARS`, `DRIVE_PREFIX`,
`EPOCH_LOG_CATEGORY`, the shared validators (`assertNonBlankString`, `assertVaultPath`,
`assertPathComponent`, `assertCanvasPath`, `assertYDoc`, `assertEpochNumber`, `assertFunction`),
`copyValue` and `adoptWinner`.

Three decisions worth naming:

- **It imports `yjs` and `canvas-schema.ts` and nothing else.** `EPOCH_KEY` and `META_MAP_NAME`
  come from WP27's module (contract §2); the string `"epoch"` appears at no call site in this WP.
- **`DELETED_MAP_NAME` is spelt locally as `TOMBSTONE_SPACE`, deliberately.** `canvas-sync.ts`
  owns that name, but `canvas-sync.ts` now imports THIS module on its merge path, so a value
  import back the other way closes exactly the runtime cycle §7.0 placed this module in `canvas/`
  to avoid (and that WP25 had to defuse with a type-only import). A type-only import cannot carry
  a value, and re-homing the constant would move a name away from its owner — a worse contract
  violation than the literal. The literal is commented in place with this reasoning. `"nodes"` /
  `"edges"` have no owning constant at all; the literals are this codebase's convention.
- **`INITIAL_CANVAS_EPOCH` was NOT imported or exported.** It stays module-private in
  `canvas-sync.ts` per §7.0.a; `normalizeEpoch` returning 0 for an absent cell is WP28's spelling
  of the same fact.

### `plugin/src/files/canvas-sync.ts` — the wiring (+191 lines, no deletions)

- **`epochConflictEnv()`** — the one builder both call sites use, so they cannot disagree.
  `serializeDoc` is `serializeCanvas(nodes, edges, deleted)`: the SAME single projection
  `CanvasPersistence` writes with. An archive produced by a second serializer could agree with a
  broken one.
- **`writeConflictCopy(path, content)`** — `exists` → `read`-and-compare → `ensureFolder` +
  `vault.adapter.write`, and deliberately NOT `writeToDisk`. `writeToDisk` swallows its error into
  a `Notice`, applies the WP4 sequence gate and mutes vault events; all three are correct for the
  CRDT→disk projection of a live board and all three are wrong here. The fail-closed rule only
  works if the rejection reaches `resolveEpochConflict`. **Attempt 2: it never clobbers.** An
  identical body is an idempotent re-run; a differing body throws, because the file already there
  is another loser's only surviving copy and the day-granular name means a second conflict on the
  same board on the same day targets it exactly.
- **`reconcileEpochOnSubscribe(path, guid, doc)`** — the live caller. See below.
- **`adoptEpochWinner(rawPath, winner)`** — WP30's seam, public, returns `EpochConflictOutcome`
  or `null` when this client has no doc for the path (never a synthesised "equal", which a caller
  could not tell from a real one).
- **`setEpochConflictHooks({ notify?, today? })`** — the two impure halves, defaulting to
  `new Notice(...)` and `isoCalendarDate(new Date())`. Defaults are the real world, so the archive
  works with zero wiring; the setter exists so a harness can drive it without Obsidian and without
  freezing time.
- **`isoCalendarDate(now)`** (module-private) — `YYYY-MM-DD` in LOCAL time, not
  `toISOString()`. A board archived at 23:30 must not be named with tomorrow's date in the folder
  the user is looking at.

### Not changed, on purpose

`plugin/src/files/file-ops.ts` (charter §6 makes it conditional — "only if a new vault operation
is needed", and none was), `canvas-schema.ts`, `canvas-persistence.ts`, `canvas-sidecar*.ts`,
`main.ts`, `canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `server/`,
`docker/`, `deploy/`, `plugin/main.js`, `manifest.json`, `package.json`, `_run_blind.py`,
`BUILD_SPEC_CanvasV2.md`, and **every test file in the tree**.

---

## Visible Test Results

```text
cd plugin && npx vitest run src/__tests__/v2/wp28
  Test Files  9 passed (9)
       Tests  104 passed (104)
```

| Check | Result |
|---|---|
| `src/__tests__/v2/wp28` | **104 / 104 green** (baseline: 104 red, `Cannot find module`) |
| `wp24` + `wp25` + `wp26` + `wp27` | **235 / 235 green** (76 / 59 / 46 / 54, unchanged) |
| `npx tsc --noEmit -skipLibCheck` | **clean, zero diagnostics** |
| full plugin suite (`npx vitest run`) | **283 files, 1687 passed / 0 failed** |

**Delta vs the attempt-1 reference (1687 / 0): 0.** Attempt 2 added no test and removed none, and
every new refusal is on an input no existing caller supplies. Against the pre-WP28 batch baseline
of 1583 / 0 the delta is **+104 collected, +104 passing, 0 failing** — exactly this WP's visible
set, which independently rules out an addition or a deletion anywhere else in the tree.

**Biome:** `canvas-epoch.ts` is clean (`Checked 1 file … no errors`). `canvas-sync.ts` reports
three findings — `organizeImports`, whole-file `format`, and one `lint/style/useTemplate` at the
`local modify` debug line — and **all three were verified pre-existing**: the identical three
appear when the file is stashed back to its committed state. No new biome diagnostic is mine.

**Foreign edits observed, not touched:** `workflowArtifacts/canvas-v2/_blind_records/*` carries
modified and untracked WP25/WP26/WP27/WP28 measurement records, and
`tests/blind_set1|2/WP28/` are untracked. None were read or written by this WP. No Batch B16
activity was observed in either file WP28 touches.

### Fuzzer wiring (Shared Ownership Contract §7)

**Not registered, and the reason is specific rather than a shrug.** §7 says the epoch rule is
fuzzer-shaped because it expresses "which of two states wins, and what happens to the loser", and
that is true of `resolveEpochConflict` as a function. It is not true of anything the fuzzer can
drive: the harness mutates ONE replica per op through `ctx.replica`, and an epoch conflict is a
relation between two whole documents plus an injected write channel that has to be observable in
ORDER. An op class that bumped an epoch would exercise `bumpEpoch` (already pinned by tp02 as one
transaction over `meta`) and would then be judged by the intent-trace oracle on record slots that
the adoption legitimately DELETES — the oracle would read a correct wholesale replacement as
lost intent, every run. Forcing the fit would produce a permanently red op class that says
nothing. Recorded here per §7's own "records why rather than forcing a bad fit" clause. The
mechanism that IS worth fuzzing in P2 is WP29's seed decision.

---

## Call Site

**This section is the deliverable, not a note.** WP27 shipped `setIdentityStore` with no
production caller and WP25 had to land the wiring afterwards; that is not repeated here.

### 1. The live caller — `CanvasSync.subscribe` → `reconcileEpochOnSubscribe`

**File:** `plugin/src/files/canvas-sync.ts`
**Function:** `CanvasSync.subscribe`, immediately after `await this.syncManager.waitForSync(docId)`
resolves and the re-entrancy check passes, and **before** the `role === "host"` file seed.

```text
resolveGuidForSubscribe → getDoc(canvasDocId(guid))
  → sidecar.attach + await sidecar.load(guid, doc)      ← WP25 AC1, unchanged
  → await waitForSync(docId)                            ← the peers' state is now IN
  → await reconcileEpochOnSubscribe(path, guid, doc)    ← WP28. THIS IS THE SEAM.
  → host file seed → stampIdentity → observers
```

**Why this seam and not another.** Two facts pick it, and they are independent:

- **The loser's replica is materialisable HERE and nowhere else.** The sidecar is a second,
  independent replay of exactly this guid, so staging it into a scratch `Y.Doc` reconstructs this
  client's pre-merge state byte for byte — which is precisely what AC2 says must be archived.
  Once `subscribe` returns, that state exists only inside the union with the peers and can no
  longer be separated from it. There is no later moment at which the pre-adoption state can be
  recovered, which is why an `afterTransaction` / `meta`-observer variant was rejected: by the
  time an observer sees `meta.epoch` rise, the state it would need to archive has already merged.
- **Before the host seed, not after.** The question the epoch rule answers is "was the history I
  ARRIVED with superseded?" — it must be asked about the state this client brought, not about the
  state it is one statement away from pushing into the doc.

**What it does.** Guarded on `sidecar !== null && identityStore !== null`, then short-circuited on
`readEpoch(doc) === 0` — epoch 0 means nobody has ever deliberately re-seeded this board, so no
replica can be behind it. It then stages the sidecar into a scratch doc, skips when that replica
is empty (a missing/corrupt sidecar is WP24 AC3's defined degradation: behave like a fresh peer,
and never hand the user an archive with none of their work in it), and calls
`resolveEpochConflict({ doc: staged, winner: liveDoc, … })`. It never throws — a subscribe must
not die because a conflict copy could not be written — and the scratch doc is destroyed in
`finally`.

**Cost today: one integer comparison per subscribe.** Nothing in the shipped plugin calls
`bumpEpoch` yet, so `readEpoch(doc)` is always 0 and the branch returns before any I/O. It goes
live the moment WP30 lands, with no further wiring.

**Why the scratch-doc adoption is not a wasted transaction.** `resolveEpochConflict` adopts the
winner into the staged doc, and that is what makes the archive provably a snapshot taken BEFORE
anything replaced it; it also leaves the staged replica holding the winner's state, so the two
can never be confused if the scratch doc outlives the call. The LIVE doc is untouched by this
path.

### 2. The complete-adoption seam — `CanvasSync.adoptEpochWinner(rawPath, winner)`

Public, builds the same `epochConflictEnv()`, and calls `resolveEpochConflict` on the path's
**live** doc against a materialised winner. WP30's "import from file" is its caller: parse the
`.canvas` into a staged doc, `bumpEpoch` it, call this. The wholesale container replacement then
propagates to every peer as ordinary Yjs deletes and sets.

### The limitation, stated plainly

**A replica cannot perform a COMPLETE adoption after it has already unioned the winner, and no
implementation can.** For one guid, Yjs replication converges into a single `Y.Doc`
(`SyncManager.getDoc` creates exactly one per doc id and every peer's state arrives as updates
into it). After the merge the doc holds `winner ∪ loser`, and `winner` is not recoverable from
that union: shared record ids are in both sides, so `union \ loser` is not the winner's set and
no subtraction over the ids available locally yields it. The information needed to prune is on
the winner's side, not the loser's.

This is why the epoch rule's complete half belongs to the side that HOLDS the winner as its own
document — the importer — and why its result reaches the other replicas as the winner's own
wholesale replacement rather than as each replica re-deriving it. CONCEPT_V2 Teil 7 says the same
thing in one line: *"epoch++, Datei seeden, Peers folgen der Epoch-Regel"*. Charter §2 puts that
import out of WP28's scope in as many words, and Shared Ownership Contract §1 has WP30 importing
`compareEpoch`, `conflictCopyPath` and the signature from here.

So WP28 ships: the whole rule, the archive path wired to a live caller, and the complete-adoption
entry point one call away for WP30. What it does **not** ship is a loser-side prune, because that
would have to be guessed, and a guessed prune deletes real work.

---

## Summary for Worker 3

WP28 is complete against its four ACs and its 104 visible tests; `tsc` is clean, WP24–WP27 are
undisturbed, and the full suite is 1687/1687. No test was touched.

Four things you should carry forward.

0. **Attempt 2 hardened the argument domain of the whole exported surface, not one function.**
   One `assertVaultPath` / `assertPathComponent` pair is applied to every path- or name-shaped
   argument in the module, so escape, collision and coercion are rejected identically at every
   export; `resolveEpochConflict` validates everything up front on every verdict; the epoch
   domain is now safe integers (`Number.isInteger` admitted `2 ** 53`, where `n + 1 === n` would
   have frozen a board's epoch permanently and silently); and `writeConflictCopy` refuses to
   overwrite an existing conflict copy. The §7.0 surface is byte-identical — nothing renamed,
   removed or re-signed — so WP30's imports are unaffected.

1. **`resolveEpochConflict` HAS a production caller** — `CanvasSync.subscribe` →
   `reconcileEpochOnSubscribe`, after `waitForSync`, before the host seed. It is inert until an
   epoch actually differs (one comparison per subscribe today) and needs no further wiring to go
   live. WP27's Escalation-2 shape is not repeated.
2. **WP30's entry point already exists**: `CanvasSync.adoptEpochWinner(rawPath, winner)`. WP30
   builds the winner (parse file → staged doc → `bumpEpoch`) and calls it; it must not spell a
   conflict name, a verdict or a signature of its own — all three are exported from
   `canvas/canvas-epoch.ts`.
3. **The one honest gap, for the record**: a replica that has already merged the winner cannot
   derive the winner's exact record set and therefore cannot complete the adoption locally. That
   is a property of single-doc Yjs replication, not of this implementation, and it is the reason
   the import (WP30) must publish the adoption as a wholesale replacement. If a later WP asserts
   "every replica prunes independently after the merge", that assertion is unsatisfiable and
   should be escalated rather than implemented.

No suspect test was found. No licence was needed, requested or assumed.
