# Worker 3 Handover — Canvas V2, batch B4, phase P2 (WP24–WP30)

**Status: `HANDOVER_READY`.** All seven work packages DONE. No task BLOCKED, none RISKY/UNSTABLE.

---

## Scope of This Run

**Tasks completed:** WP24, WP25, WP26, WP27, WP28, WP29, WP30 — the whole of phase P2.
**Tasks with risk flags:** none.

**What P2 closed.** W4 — *no durable CRDT history*. Before this batch the relay held no document, so when
the last peer left a room the history was gone and the next start seeded from a JSON snapshot with no
causal relationship to what came before. Two docs seeded from different snapshots are formally
**unrelated replicas** — the same defect class as the historical two-writer bug, but on the time axis.
Invariant **I9** is now implemented: *a doc is seeded from a file exactly once in its life; thereafter
its update history is the truth and snapshots are projections.* Importing from a file is now an
explicit, named, confirmed user action.

---

## Risk Summary

*(Read this table first. Per-task detail below is only needed for the rows flagged for attention.)*

| WP | Status | risk_flag | Priority for W4 |
|---|---|---|---|
| WP24 — Sidecar store core | DONE | NONE | **HIGH** — one required behaviour is pinned by no test (see R1) |
| WP25 — Sidecar lifecycle + compaction | DONE | NONE | NORMAL |
| WP26 — Sidecar exclusion | DONE | NONE | NORMAL |
| WP27 — GUID doc identity | DONE | NONE | NORMAL |
| WP28 — Epoch rule + conflict archive | DONE | NONE | **HIGH** — I11 behaviour on a cancelled adoption (see R2) |
| WP29 — Seed-once, R4 removed | DONE | NONE | NORMAL |
| WP30 — Import from file | DONE | NONE | **CRITICAL** — 3 INTEGRATION_SCOPE targets, the only batch WP with any (see §7b) |

---

## Final measured state — measured by Worker 3, not quoted from a sub-agent

| Gate | Result |
|---|---|
| Plugin suite | **1833 passed / 0 failed / 0 pending**, 736 suites, vitest JSON reporter |
| Batch baseline | 1346 passed / 0 failed → **delta +487** |
| `tsc --noEmit -skipLibCheck` | **clean, exit 0, zero diagnostics** |
| Blind sets | **14 / 14 PASS, every one with a non-zero executed collected count. No `ZERO_COLLECTION`.** |

**Arithmetic reconciles exactly:** 76 + 59 + 46 + 54 + 104 + 68 + 78 = **485** tests added by this batch,
plus **2** added by the concurrent B16 batch = **487**. Every test in the delta is accounted for.

### Blind ledger — executed counts, re-measured at close

A ledger row is a **measurement, not a timeless fact**. Every row below was re-run *after* the last code
change in the batch, not carried forward from when the WP was implemented.

| WP | set1 collected | set1 pass/fail | set2 collected | set2 pass/fail |
|---|---|---|---|---|
| WP24 | 67 | 67 / 0 | 78 | 78 / 0 |
| WP25 | 46 | 46 / 0 | 47 | 47 / 0 |
| WP26 | 45 | 45 / 0 | 50 | 50 / 0 |
| WP27 | 41 | 41 / 0 | 47 | 47 / 0 |
| WP28 | 62 | 62 / 0 | 67 | 67 / 0 |
| WP29 | 52 | 52 / 0 | 38 | 38 / 0 |
| WP30 | 98 | 98 / 0 | 51 | 51 / 0 |

**That re-measurement is not ceremony — it caught a real regression.** See §"The close-out sweep" below.

---

## Deletion / amendment ledger

**No test was deleted. No assertion was weakened. No licence was assumed.**

Every entry below is enumerated by **file · line · why-stale · post-amendment strictness · falsification**,
per §7's form.

### A. Licensed amendment — WP27 (Dispatcher ruling: GRANTED)

Two pre-existing assertions in `plugin/src/__tests__/w4-canvas-integrity.test.ts` were **inverse
characterisations of the defect WP27 AC4 exists to close** — written by a W4 revalidation pass to
*document that the hole was open*. Both were green at the batch baseline and red after WP27.

Worker 3 held no licence and **left them untouched**, escalating instead. The Dispatcher ruled them
**stale, not violated**, and granted an amendment licence bounded to exactly these two assertions in
that one file.

| # | File · line | Was | Now | Post-amendment strictness |
|---|---|---|---|---|
| 1 | `w4-canvas-integrity.test.ts:1665` (M1) | `expect(reached, "setActiveFile is a SECOND unguarded bare-path getDoc … W3's sweep claim is incomplete").toBe(true)` | `expect(reached, "…WP27 AC4's guard is gone").toBe(false)` **+** `expect(guardConsults.filter(c=>c.path===PATH).map(c=>c.verdict)).toEqual([true])` | **Stricter.** A bare `toBe(false)` would also pass if `getDoc` were never called for an unrelated reason — a broken harness, a renamed method, an early return elsewhere. The added assertion pins the **cause**: that `skipsAutoTextSync` was consulted for that path and returned the skip verdict. Title and message rewritten so neither still claims the hole is open. |
| 2 | `w4-canvas-integrity.test.ts:1747` (K5) | same shape, *"CollabManager has NO internal .canvas guard"* | same two-assertion shape; title now *"…HAS an internal .canvas guard"* | as above |

**Falsification — four runs, each isolated, no narrowing needed:**

| Perturbation | Result |
|---|---|
| F1 remove the `skipsAutoTextSync` guard in `setActiveFile` | 1/46 red — M1 **on its own pin** |
| F1b replace the shared predicate with a private `endsWith(".canvas")` | 1/46 red — M1 **on the NEW assertion**; the negative stayed green |
| F2 remove the guard in `activateForFile` | 1/46 red — K5 on its own pin |
| F2b private copy in `collab.ts` | 1/46 red — K5 on the NEW assertion |

The `b` variants are the ones that matter: they prove the *added* guard-consult assertion discriminates
independently, so the amendment was not merely a boolean flip. **No neighbour masking** (the B13/B15
trap) — each perturbation produced exactly one failure, and all 44 other tests in that file stayed green.
Count **46 before, 46 after**; full-suite total unchanged, independently ruling out any add or delete.

> **The §7 register entry for this licence is Worker 2's to write.** Worker 3 did not edit
> `BUILD_SPEC_CanvasV2.md`.

### B. Licensed fixture completion — WP25 (Dispatcher ruling: ACCEPTED, §7 4th class extended to WP25)

Bounded to **the IO double's `wait` signature in `blind_set2/WP25/tp01` and nothing else.**

`resolveGuidForSubscribe` awaits `store.bind` → `readIndex()` → `io.exists(sidecarIndexPath())`, so a
blanket `hold("exists")` gate stalled the subscribe **inside identity resolution** — before `getDoc`,
before `waitForSync`, before the load. **Both blind2 ordering tests were vacuous, and that predates the
repair.** Fix, in the IO double only: `wait(op)` → `wait(op, path)` with
`path === sidecarIndexPath() ? undefined : gates.get(op)`.

**Demonstration in the required before/after form:** *before the fix, falsification A left set2 at 47/47
green; after it, falsification A reddens it.* The class requires unsatisfiability **shown, not asserted**
— that is the showing. Assertions, subjects, names and counts unchanged.

> §7 register entry is **Worker 2's**. Worker 3 did not edit the BUILD_SPEC.

### C. Fixture repairs, no licence required (files authored by this batch, zero assertions)

| File | Mechanism, demonstrated | Repair |
|---|---|---|
| `v2/wp26/test_tp04_sync_from_manifest_visible.test.ts` (3 mocks) | `vi.fn(async () => ({}))` infers a **zero-arity** mock, so reading `mock.calls[i][0]` did not typecheck — 3 × `TS2493`. | Parameter **type annotations** only. Bodies, return values, call-site arity and every assertion unchanged; `vi.fn` records real arguments regardless of declared signature; TS types are erased by esbuild, so the **executed program is literally identical**. `git diff` filtered for `expect`/`it(`/`toBe`/`toHaveBeenCalled` returns empty. Falsification re-verified after: neutralising the `syncFromManifest` guard still reddens 3 of 5. |
| `v2/wp25/harness.ts` (2 fixtures) | (i) `FakeSyncManager.synced` was documented as *"every id ever passed to `waitForSync`"* but **never written** — permanently `[]`, so two assertions could not pass under any implementation. (ii) `ManifestManager.connect` awaits `waitForSync("__manifest__")` at setup, so `firstContaining(trace, …)` resolved to the **manifest's** sync; three ordering assertions compared against the wrong event. | one `synced.push(docId)`; and `createManifest` connects through `{ ...sync, waitForSync: async () => {} }`. Verified independently by Worker 3: `grep -c "expect(" harness.ts` → **0**, a pure fixture with no assertions. |
| `blind_set{1,2}/WP25/tp01` | Same manifest contamination in their own self-contained copies. **Direction check done adversarially** because "the fixture is broken" is perfect cover for a real ordering bug: the channel contained the **manifest's** id, never `__canvas__:<guid>`. A genuine early-peer-sync defect would show the canvas doc id. | mirrors the visible fix. Routed to the **test author, not the coder** — deliberate structural isolation, since a coder judging whether its own implementation is at fault confirms what it wrote. |

### D. Blind oracle strengthened — WP27 tp05 (authored by this batch)

`blind_set1/WP27/test_tp05_…:141` asserted the state vector was **unchanged** across a rename. AC2
*mandates* the rename update `meta.path`, which lives in the Yjs `meta` map, so the state vector **must**
advance; the observed delta was exactly 1 tick = exactly one write. **No correct implementation could
satisfy it.** Restated to pin the exact delta and that the pre-rename vector is an **ancestor** of the
post-rename one. **Stricter** — it now also catches spurious extra writes and re-seeding during the
rename, neither of which "unchanged" could distinguish from correct behaviour. Falsified: a spurious
extra write reddens on `expected 2 to be 1`; a re-seed on `expected 17 to be 1`. Notably the re-seed
survives the sibling "exactly one doc" test and the `clientID` check — precisely the gap the old form
could not see.

---

## Per-Task Detail

### WP24 — Sidecar store core · DONE (attempt 1)
- **Changed:** new `plugin/src/files/canvas-sidecar.ts` (single import: `yjs`).
- **Tests:** visible 76/76 · blind1 67/67 · blind2 78/78.
- **Notable:** the coder **falsified** the per-guid serialisation the test author had flagged as unpinned —
  with serialisation disabled, an append issued while a checkpoint's write was in flight landed in the
  history, was wiped by the truncate, and was absent from the checkpoint too, i.e. **lost outright** —
  *while all 76 visible tests stayed green*.
- **Open assumption:** the degradation enum has no IO-error member, so an `io.exists`/`io.read` failure
  during `load` is reported as `CORRUPT` with a `detail` string. Consumers must not read `CORRUPT` as
  proof the bytes on disk are bad.

### WP25 — Sidecar lifecycle + compaction · DONE (attempt 1 + fixture repairs)
- **Changed:** new `canvas-sidecar-lifecycle.ts`; `canvas-sync.ts`, `vault-events.ts`, `main.ts` (wiring only).
- **Tests:** visible 59/59 · blind1 46/46 · blind2 47/47.
- **Also closed WP27's wiring gap** — see D2 below.
- **Binary safety by construction:** the declared adapter type exposes **no string method at all**, so an
  implementation reaching for Obsidian's string-only `DataAdapter.append` would not compile. That path
  mangles every byte in `0x80–0xFF` to `U+FFFD` while the frame header still parses — silent corruption
  surfacing much later as unreadable history.
- **Tunables:** `SIDECAR_COMPACTION_PERIOD_MS = 300_000` (ms) · `SIDECAR_COMPACTION_HORIZON_LAMPORT_TICKS = 1000` (**Lamport ticks, never ms**).

### WP26 — Sidecar exclusion · DONE (3 attempts + 1 out-of-budget doc-conformance pass)
- **Changed:** `utils.ts`, `background-sync.ts`, `manifest.ts`. Behavioural diff is **6 lines**; the rest is the contract comment.
- **Tests:** visible 46/46 · blind1 45/45 · blind2 50/50.
- **Attempt 2 found a real, reachable leak the enumerated consumer list could not have surfaced.**
  `vault-events.ts:190-194` admits a rename when *either* side is shared, so moving an ordinary shared
  note into the sidecar directory passed on the strength of `oldPath`, reached `renameFile`, and
  published the entry under a **sidecar key** — every peer then held a manifest entry pointing into
  another client's local replica state. `renameFile` is the one manifest **writer** that never consults
  `isSharedPath`, so guarding the membership predicate could not constrain it.
- **Retry accounting, stated precisely:** 3 implementation attempts **plus** 1 documentation-conformance
  pass whose **executable diff was empty**, declared out-of-budget *before* it ran, not after.

### WP27 — GUID doc identity · DONE (attempt 1 + licensed amendments)
- **Changed:** `canvas-sync.ts`, `canvas-schema.ts`, `manifest.ts`, `background-sync.ts`, `collab.ts`.
- **Tests:** visible 54/54 · blind1 41/41 · blind2 47/47.
- **The test author found a cross-WP hazard the charter never mentions.** WP8's V1→V2 migration uses the
  *mere presence of a non-empty `meta` map* as its one-shot marker, so stamping `meta.guid` **before**
  `migrateV1ToV2` would leave every V1 doc arriving from a peer or sidecar untranslated **forever** — no
  `schemaVersion`, no `pos`/`size`, no `ord` — **while nothing throws and every convergence oracle stays
  green.** Test `tp11` exists solely for this. The coder added a second, independent defence: the
  migration's one-shot guard now requires a `meta` key **outside** `{guid, path, epoch}`.
- **Guid generation:** `crypto.getRandomValues`, 32 lowercase hex chars, no uuid dependency. Hex-only so
  a guid can never be mistaken for a path.

### WP28 — Epoch rule + conflict archive · DONE (attempt 2)
- **Changed:** new `plugin/src/canvas/canvas-epoch.ts`; `canvas-sync.ts` (+191, no deletions).
- **Tests:** visible 104/104 · blind1 62/62 · blind2 67/67.
- **Call site, explicitly named** (a required deliverable after WP27 shipped an unwired module):
  `CanvasSync.subscribe` → `reconcileEpochOnSubscribe(path, guid, doc)`, after `waitForSync` and before
  the host seed — the only seam where the loser's pre-merge state is still materialisable. An observer
  would see `meta.epoch` rise only *after* the state it must archive had already merged. Second seam:
  `CanvasSync.adoptEpochWinner(rawPath, winner)`, which WP30 calls.
- **Attempt 2 generalized input validation across the whole exported surface** rather than patching the
  one function the blind sets caught. That found **two latent defects a path-only fix would have missed** —
  see D5.

### WP29 — Seed-once, R4 removed · DONE (attempt 1)
- **Changed:** new `canvas-seed-decision.ts`; `canvas-persistence.ts`, `canvas-sync.ts`, `main.ts`.
- **Tests:** visible 68/68 · blind1 52/52 · blind2 38/38.
- **The R4 loop was not where the charter said.** It was in `seedFlatSpace`, not `applyCanvasToYMaps` —
  removing the wrapper alone would have satisfied the charter's *words* and none of its *purpose*.
- **`peerKnowsDoc` is a state-vector byte delta across `waitForSync`, deliberately not "foreign clientIDs
  present"** — the sidecar load runs immediately before that await and replays updates under their
  original authors' IDs, so a clientID probe would read this client's own replay as a peer and collapse
  AC1's two conditions into one.
- **The licence question was answered by measurement, not assumption** — see §"The licence question" below.

### WP30 — Import from file · DONE (attempt 1)
- **Changed:** three new modules + `commands.ts`, `main.ts`.
- **Tests:** visible 78/78 · blind1 98/98 · blind2 51/51.
- **Ask-then-write:** the winner `Y.Doc` is not even **constructed** until `await env.confirm(...)` returns
  exactly `true`. There is no staging to publish and nothing to roll back, so "no write" holds while the
  dialog is open as well as at the end.
- **The dialog text is a shipped deliverable, not decoration.** It renders both counts (the "12 records
  become 3" contrast is what makes an accidental import obvious), names every affected peer verbatim, and
  puts the archive reassurance **last** so the warning does not read as reassurance. The alone-case has
  its own real sentence rather than an empty slot. Tests pin containment, differential sensitivity and
  verb family — never an exact wording — so the copy stays editable.
- **`peers` is every session participant, not only those viewing the board** — a judgement call, recorded:
  someone reading another file still holds a replica that gets archived and replaced. Over-naming is mild;
  omitting is the dialog failing its only job.

---

## The licence question (WP29) — answered by measurement

The batch brief flagged this WP by name and forbade assuming the licence. **BUILD_SPEC §7's
licensed-deletion list is `WP4, WP18, WP21, WP22, WP33`; WP29 is on it, and on every other §7 list, not
at all.**

The test author analysed it up front and reported **`LICENCE_REQUIRED: none`**. The coder then **proved
it** rather than asserting it: with the destructive loop **re-injected verbatim**, only WP29's own
`tp04`/`tp05` reddened, while `wp18` — including `tp06`, *"seed is upsert-only (I7)"*, which is WP29's own
thesis — and `w4-canvas-integrity` **stayed green under the destructive implementation**.

That is direct evidence those four tests never depended on the delete **in either direction**, so no
licence was ever needed. `grep -rn absentFromFile plugin/src/` now hits only comments in wp29 test files.

---

## The close-out sweep — why it is not ceremony

Re-running every blind set *after the last change in the batch* caught a regression that per-WP runs had
already passed: **WP26 set2 fell from 50/50 to 48/50.**

Neither failure was formatting. Both were **genuine cross-WP drift**, and WP26's AC3 invariant is a live,
mechanically-checked property of the whole tree:

1. **WP27 made `editor/collab.ts` a real consumer** of `skipsAutoTextSync` (its AC4 guard), but the
   contract comment in `utils.ts` did not name it — and AC3 requires every real consumer be named.
2. **WP30 added a second private `.endsWith(".canvas")` in `main.ts`** (`activeCanvasPathForImport`),
   where the oracle permits exactly the one occurrence that predates WP26.

Both repaired in production source only, no test touched, and **each falsified individually**: reverting
the `collab.ts` row reddens *"every real consumer module is named"*; reverting the `isCanvasPath` change
reddens *"neither permitted file grew a SECOND such test"*. Each time exactly one assertion failed and the
other fix stayed green, so neither is load-bearing for the other. `main.ts` now calls
`isCanvasPath` — newly exported from `canvas-epoch.ts`, which already owned `CANVAS_EXT` — rather than
spelling the literal. Deliberately **not** `skipsAutoTextSync`, which means `.canvas` **OR sidecar** and
would have offered sidecar state as an import target.

**Lesson for the next batch: a per-WP green is a measurement of that WP at that moment, not of the batch.
Sweep everything after the last change.**

---

## Risk Notes for Worker 4

### R1 — WP24's per-guid serialisation is required, implemented, and pinned by NO test · **probe hard**
Without it an `append` can land between a checkpoint's encode and its truncate and be **lost outright**.
It is implemented and was falsified by the coder with a throwaway probe — but **every shipped test fake
preserves FIFO regardless**, so no test in any of the three sets catches its removal. This is the one
behaviour in the batch whose correctness rests on a falsification that no longer runs.

### R2 — WP28: a cancelled adoption must leave a recoverable state, not a silent no-op (**I11**)
`conflictCopyPath` is day-granular, so a second conflict on the same board on the same day resolves to the
**same filename** — and the file already there is another loser's only copy. `writeConflictCopy` therefore
**never clobbers**: an identical body is an idempotent re-run, anything else throws, and because the
mechanism is fail-closed that **cancels the adoption**. Confirm the user ends up with a recoverable state
**and a notice**, not a silent no-op.

### R3 — WP30 is the first production caller that raises an epoch
`reconcileEpochOnSubscribe` has been inert since WP28 landed, because nothing called `bumpEpoch`. The
archive path in `canvas-sync.ts` goes from one integer comparison per subscribe to **real behaviour** the
moment a user runs the import command. No further wiring is needed — but this path has never executed in
anger.

### R4 — WP30's three INTEGRATION_SCOPE targets (§7b) — the only ones in the batch
1. `activeCanvasPathForImport()` against a live Obsidian workspace (the Canvas view is private/untyped).
2. `canvasImportAvailability(path)` **measuring** ownership and degradation from the real subsystems — the
   unit suite pins the *decision* over an `ImportAvailability`, not the *measurement*.
3. Two real clients end-to-end: a real `<name>.conflict-<date>.canvas` on disk holding B's board.
Plus one `HUMAN_OBSERVABLE`: the dialog's **rendering** only. Its **text content is fully unit-tested** in
WP30 TC04 and is explicitly *not* a W4 target.

---

## Open defects — verified, not patched, with owners

| # | Finding | Owner |
|---|---|---|
| **D1** | `fileOpsManager.onFileRename` broadcasts a sidecar rename over the **file-op channel**. Same root cause as the manifest leak WP26 closed (`vault-events.ts:190-194` admits a rename when *either* side is shared); a peer would recreate the move inside its own sidecar directory. WP26 correctly declined it — it is peer file-op broadcast, not manifest membership or text-sync detection, and no C26 criterion reaches it. | **Chartered as WP68** by Worker 2. Not ours. |
| **D3** | `CanvasIdentityStore.unbind` has no clean spelling: its dep is `Pick<ManifestManager,…>` with no clear method, so a **blank guid to `setCanvasGuid` clears the mapping**. Do not "tidy" this into a delete — it would take the manifest entry with it. | Informational; WP28/WP30 were briefed. |
| **D4** | **A replica that has already merged the winner cannot prune to the winner's record set — and no implementation can.** `getDoc` creates one `Y.Doc` per id; after a merge the doc holds `winner ∪ loser` and shared ids are in both, so no local subtraction yields the winner's set. The "wins **completely**" half must be executed by the importer and published wholesale via `adoptEpochWinner`. **Standing instruction: if a later WP asserts "every replica prunes independently after the merge", that assertion is unsatisfiable and must be escalated, not implemented.** | Architectural constraint. Brief every future WP touching adoption. |
| **D5** | Two latent defects **fixed** by WP28's generalization pass, recorded because both were invisible to the tests that prompted it: (i) `normalizeEpoch` used `Number.isInteger`, admitting `2**53` where `n+1 === n`, so `nextEpoch`'s pinned *"strictly greater for every input"* was **false** — one corrupt cell would have frozen a board's epoch **permanently**, the only symptom being that imports quietly stop winning; (ii) the day-granular conflict-copy collision in R2. | Fixed. |

---

## ⚠ Instruments that could not fail — carry these forward

This run has now found **seven** distinct classes of green-that-cannot-fail. Two are new in this batch, and
one of them is not on the test side at all:

1. **A gate that blocks identity resolution instead of the load** (WP25 blind2 tp01) — the **sixth**
   instance, and the **first located in a gate rather than an assertion**. Any ordering oracle written
   against `subscribe` is exposed, because identity resolution touches the sidecar *before the doc exists*.
   An oracle stalled at the wrong seam never reaches the ordering it claims to pin — and reports green.
2. **`npx biome` in this repo resolves to an unrelated npm package `biome@0.3.3`**, which produces no
   output and exits **0 on any input**, including deliberately broken code. The real linter is
   `@biomejs/biome@1.9.4` at **`plugin/node_modules/.bin/biome`**; there is no `node_modules/.bin` at the
   repo root. **Any past or future "Biome clean" claim made via `npx biome` measured nothing.** This is a
   lint-side instance of the same class the test side keeps producing.

Also worth keeping:
- **A delimiter survives future edits to the reasoning; care does not.** WP26's AC3 comment defect recurred
  **twice with two different filenames** before the list and its prose were structurally separated.
- **Structural clarity for a human reader is not the same artefact as mechanical extractability.** Where an
  AC is checked by a regex over prose, run the oracle's own extraction before and after the edit.
- **"Pre-existing" means pre-existing to the BATCH BASELINE, not to your own diff.** Two sub-agents made
  this mistake this batch; once it was wrong (the `TS2493` errors were new and ours), once it was right
  (the Biome findings) — and only re-measuring against `snapshot_pre_B4.tgz` distinguished them.

---

## Fuzzer wiring (contract §7) — one recorded refutation

The shared contract asserted the epoch rule and the seed decision were fuzzer-shaped. **The WP28 test
author refuted this structurally, and the refutation is worth more than a forced op class:** `fuzzer.ts`
bootstraps once on `replicas[0]` then quiesces, and every window ends `deliverWithinPartition` →
`quiesce(ALL)`. **Every pair of replicas is therefore permanently causally related — and the epoch rule's
entire subject is unrelated histories.** An op registered anyway would bump `meta.epoch` and re-author
records; those writes propagate and win by ordinary Yjs LWW as a single-authored causally-later write, so
the intent-trace oracle goes green *without the epoch mechanism ever running*. Making it honest needs an
unrelated-doc constructor in the harness core — not the additive registration §7 permits. WP29 declined
for a related reason (its inputs are session-lifecycle facts, not per-window replica mutations).
Compensated by WP28 tp07 and WP29 tp05, which apply the fuzzer's own reasoning deterministically.

---

## Summary for Worker 4 Entry Point

A canvas doc is now identified by `__canvas__:<guid>` rather than by its path, so a **rename mid-session is
a metadata update** (`meta.path`, the manifest mapping, `index.json`) that preserves the `Y.Doc` instance
and lets edits keep flowing. Every local and remote update is appended exactly once to an append-only
`.yhistory` under `.obsidian/liveshare/state/`, compacted periodically into a `.ycheckpoint` — and those
files are excluded from the manifest, from sync, and from every text-sync detection path, so replica
internals can never sync as documents. On subscribe the sidecar is **loaded and awaited before peer sync
begins**, so peers meet a replica that has already read its own history.

Seeding from a file now happens **only** when neither the sidecar nor any peer knows the doc; the
destructive delete-by-omission is gone, so a returning host is an ordinary related-replica merge and can no
longer discard peer work by rejoining with a stale file. When two replicas share a guid but differ in
`meta.epoch`, the higher epoch wins wholly and the loser **archives its pre-adoption state** to
`<name>.conflict-<date>.canvas` *before* adopting, notifying the user by name — and equal epochs merge
normally without touching the archive path at all.

**To trigger the main flow:** run the **"Import from file"** command on an owned, non-degraded canvas. It
is the only path by which a file overwrites a living doc. A confirmation dialog names the file, both record
counts, and every peer whose work will be replaced; cancelling — including dismissing the modal — performs
no write of any kind. Confirming bumps the epoch, seeds from the file, and publishes wholesale via
`adoptEpochWinner`, at which point peers follow the epoch rule and each archives a conflict copy. That
command is also the first production caller that ever raises an epoch, so it is what brings WP28's
reconcile path to life.

---

## Artifacts

- Working ledger kept throughout: `workflowArtifacts/canvas-v2/_B4_P2_running_notes.md`
- Front-loaded contract: `workflowArtifacts/canvas-v2/SharedOwnershipContract_B4_P2.md`
- Per-WP reports: `ImplementationReport_WP{24,25,26,27,28,29,30}.md`
- Baseline snapshot (pre-first-edit): `H:\tmp\liveshare_snap_B4_P2\snapshot_pre_B4.tgz`
- Measurement drivers: `H:\tmp\liveshare_snap_B4_P2\{_baseline_b4,_final_b4,_final_blind_sweep}.py`
- Commits on `fix-bugs-and-raceconditions`: `5c6806b` (WP24/26/27), `ba0a803` (WP25), `1aa9527` (WP28/29)

**Two §7 register entries are outstanding and belong to Worker 2, not Worker 3:** the WP27 amendment
licence and the WP25 fixture-completion extension. Both are enumerated above in §7 form.
