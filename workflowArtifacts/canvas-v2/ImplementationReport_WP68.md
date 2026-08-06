# Implementation Report — WP68 / C68: Sidecar exclusion at the file-op rename boundary

**Batch:** B46 (Worker 3, Execution) · **Branch:** `fix-bugs-and-raceconditions`
**Commits:** `58aff0a` (production) · `156eef5` (tests) · this report
**Gate:** `tsc -noEmit -skipLibCheck` clean · full suite **358 files / 2571 tests, 0 failures**

---

## 1. Guard placement, at each of the two boundaries

| boundary | module :: function | where exactly | why there |
|---|---|---|---|
| outbound | `files/file-ops.ts::onFileRename` | after the two `isPathMuted` checks and the sender check, **above** the `sendQueues.get` acquisition | a refusal takes no `sendQueues` slot, schedules no task and issues no mute, so it leaves the per-path bookkeeping exactly as the ordinary muted early-return one line above it does (AC4). It makes no vault call, because `onFileRename` never has (AC3). |
| inbound | `sync/control-handlers.ts::registerControlHandlers`, inside the `if (isRename)` branch | **before** `plugin.fileOpsManager.applyRemoteOp(...)`, ahead of the existing `paths.some(isSharedPath)` admission test | refusing here means no `opQueues` slot is taken, no `mutePathEvents` is issued and therefore none can be stranded, and **not one vault call is made** — no `rename`, no `ensureFolder`/`createFolder` under the sidecar directory, no `create`, no `modify`, no `trashFile` (AC2, AC3). |

Both consult `isSidecarPath` imported from `files/canvas-sidecar.ts`. Neither
re-spells `SIDECAR_DIR`, writes its own prefix or suffix test, or introduces a
second constant. The outbound guard tests **four** values — `localOld`,
`localNew` and their canonical forms — rather than two. Today those collapse to
two, because the seven characters `toLocalPath` substitutes on Windows
(`? * < > " | :`) do not occur in the sidecar directory prefix; they are written
out anyway because that argument rests on a character map in another module, and
a test resting on it would go quiet if the map ever grew a `.` or a `/`.

**The refusal is named, not a silent drop.** Outbound:
`FileOpsManager.getSidecarRenameRefusals()`, a monotone counter — *state*, so a
test can be an oracle over it, following the WP88 `refusedWhileSealed`
precedent directly above it in the same class. It carries no path: a path here
would put local replica-state filenames into a value other components render.
Inbound: a `logger.warn` on the `file-op` category. State is the oracle in every
test; the log line is for humans.

### A third file changed, comment-only, and why it was not optional

`plugin/src/utils.ts` — **no behaviour change.** `skipsAutoTextSync`'s contract
comment holds the `isSidecarPath` CONSUMER LIST, which states it is "exhaustive
in both directions", and `wp26/test_tp09` **derives that from the tree**: for
every production module referencing `isSidecarPath`, the comment must name it.
Adding the inbound consumer without adding its row reddens that landed test.
Verified by running tp09 against the un-updated comment:

```
AssertionError: undocumented consumer: sync/control-handlers.ts:
  expected '/**\n * WP6 / US5 AC1+AC2 and WP26 AC…' to contain 'control-handlers.ts'
```

Two rows were added (`files/file-ops.ts onFileRename`,
`sync/control-handlers.ts registerControlHandlers`), and the comment's count was
corrected from FOUR seams to SIX. `skipsAutoTextSync`'s body is byte-identical;
`wp83/test_tp02`'s "the predicate's body is unchanged" and "block B's *exhaustive
in both directions* sentence is still present" rows both stay green.

### Not touched

`files/vault-events.ts`'s either-side rename gate; `ManifestManager.renameFile`
and `isSharedPath`; `BackgroundSync.onFileRenamed`; `skipsAutoTextSync` as a
predicate; every other `FileOp` type; all relay/server source; everything under
`plugin/src/testing/` and `tools/`. The manifest arm and the disk arm keep
**deliberately different** answers to the same event — the manifest entry goes,
the peer's file stays — and are not merged.

---

## 2. Per-AC evidence, and the falsification that backs it

Tests: `plugin/src/__tests__/v2/wp68/`, five visible files, **78 rows**.
No blind sets, no ledger rows.

| AC | rows | oracle |
|---|---|---|
| **AC1** | tp01, 16 rows | the injected op sink **and** `getOfflineState().queueDepth`, plus the refusal counter. Six direction/kind pairs, each asserted online and offline, and re-asserted after `setOnline(true)` so a queued op cannot be delivered on reconnect. |
| **AC2** | tp02, 11 rows | hand-built `FileOp`s handed straight to the `file-op` handler. Two independent oracles: the ops that reached `applyRemoteOp` (empty) and the vault journal of **every** mutating call (empty), plus the nine named `not.toHaveBeenCalled()` rows AC2 enumerates. |
| **AC3** | tp03, 16 rows | bytes. A copy of the pre-image compared against the post-image; the whole disk's key set and every file's bytes; and an explicit "no destructive verb was issued" row over the journal. |
| **AC4** | tp04, 22 rows | the emitted op compared field-for-field with what it was; the moved bytes inbound; the mute lifecycle with fake timers; the send queue; and the near miss `…/stateful/…` driven through the real predicate. |
| **AC5** | tp05, 13 rows | a derivation over the source, reusing WP83's tree-walking helpers rather than a second private copy of them. |

### 2.1 The break table

Eighteen deliberate breaks, applied to the **product** one at a time, each run,
each red observed, each restored byte-for-byte (verified: `canvas-sidecar.ts`
and `types.ts` blob hashes identical to `HEAD` afterwards).

| # | the break | rows red | the named assertion, as observed |
|---|---|---|---|
| B1 | outbound guard deleted | 18 | `a rename op reached the wire for _liveshare-test/hello.md -> .obsidian/liveshare/state/index.json: expected [ { type: 'rename', …(2) } ] to deeply equal []` |
| B2 | inbound guard deleted | 25 | `the op was admitted for _liveshare-test/hello.md -> .obsidian/liveshare/state/index.json: expected [ { type: 'rename', …(2) } ] to deeply equal []` |
| B3 | **refuse-then-delete**: the inbound refusal trashes the peer's own old file | 24 (14 of tp03's 16) | `the refusal degraded into a destructive operation — this is the refuse-then-delete trap AC3 exists to forbid: expected [ Array(1) ] to deeply equal []` and `_liveshare-test/hello.md was unlinked by the refusal: expected undefined to be defined` |
| B4 | guard widened to `startsWith` with no `/` boundary | 11 | `.obsidian/liveshare/stateful/board.canvas -> …bak was refused: expected [] to have a length of 1 but got +0` |
| B5 | guard widened to `skipsAutoTextSync` | 5 | `ADMITTED (a shared .canvas): expected [] to deeply equal [ { type: 'rename', …(2) } ]` + `expected [ 'files/file-ops.ts::onFileRename' ] to deeply equal []` |
| B6 | outbound guard covers only the ONLINE send | 6 | `the op is queued for delivery on reconnect: expected 1 to be +0` |
| B7 | guard covers the DESTINATION only | 18 | `a rename op reached the wire for .obsidian/liveshare/state/index.json -> _liveshare-test/hello.md` |
| B8 | outbound guard hoisted out of its boundary into `emitOp` | 1 | `the outbound guard is not at the boundary the charter names: expected [ 'files/file-ops.ts::emitOp' ] to deeply equal [ 'files/file-ops.ts::onFileRename' ]` |
| B9 | the directory re-spelt at the inbound guard | 5 | `expected [ 'files/canvas-sidecar.ts', …(1) ] to deeply equal [ 'files/canvas-sidecar.ts' ]` |
| B10 | a new `FileOp` variant added to `types.ts` | 1 | `expected [ 'chunk-data', 'chunk-end', …(8) ] to deeply equal [ …(7) ]` |
| B11 | the guard refuses EVERY rename | 25 | `the fixture emits nothing at all — every refusal case below is vacuous: expected [] to have a length of 1 but got +0` |
| B12 | the outbound refusal takes a mute and never releases it | 5 | `BOOKKEEPING — a refusal strands no mute: expected true to be false` |
| B13 | the admitted apply stops releasing its mute | 1 | `the mute was stranded: expected true to be false` |
| B14 | `isSidecarPath` loses its `/` boundary | 6 | the near-miss premise row: `expected true to be false` |
| B15 | a sidecar guard hoisted into `emitOp` for every op type | 2 | `a delete op changed shape — WP68 touches no op type other than \`rename\`` |
| B16 | the inbound module inlines the predicate and drops the import | 3 | `sync/control-handlers.ts does not import the predicate` |
| B17 | the non-rename all-paths gate deleted | 3 | `EVERY OTHER OP TYPE STILL USES THE STRICT ALL-PATHS GATE: expected [ { type: 'create', …(2) } ] to deeply equal []` |
| B18 | a second definition of `isSidecarPath` in a guard module | 20 | `expected [ 'files/canvas-sidecar.ts', …(1) ] to deeply equal [ 'files/canvas-sidecar.ts' ]` |

### 2.2 The complement — which rows can NOT fail

The break set was then run as a census: for each break, the set of red row names
was collected and unioned, and the complement against all 78 rows printed.

**73 of 78 rows go red under at least one break.** The five that never do are
declared positive controls and premise rows, and each carries its own proof that
it can find something:

- tp02 `THE PREMISE — today's gate would admit on the shared endpoint alone` — models the gate's precondition; falsifiable only by changing the fixture.
- tp03 `POSITIVE CONTROL — this fixture CAN record a destruction` — a fixture-capability check; it is what makes the other tp03 rows non-vacuous.
- tp05 `both boundary modules are in the walked tree`, `a predicate named only in a COMMENT is not a call site`, `reddens on a synthetic module` — the derivation's own Rule-15 controls, which plant the violation and require the same functions to report it.

### 2.3 Neighbouring pre-existing oracles that also reddened

- **B3** (refuse-then-delete) also reddens six of tp02's rows, because the substituted `delete` op reaches `applyRemoteOp`. It is reported here rather than folded in: the AC3 rows are the ones that name the defect.
- **B4** and **B5** also redden tp05's `the outbound guard is in onFileRename` row, because the derivation sees the call site vanish.
- **B10** and **B17** redden only their own named rows; no other suite in the tree noticed either break, which is the point of tp05 carrying them.
- No pre-existing suite outside `wp68/` reddened under any of the 18 breaks.

---

## 3. AC1 — what was observed at the seam, and what remains unobserved

**Observed today, at the seam, in both directions:** `onFileRename` emits
nothing — on the injected sink and on the offline queue — for a rename whose
source or destination is a sidecar path, and refuses to deliver it on reconnect.
That is a measured property of `FileOpsManager`.

**NOT observed, and not claimed:** that Obsidian emits a vault `rename` event
whose destination lies under `.obsidian/`. The charter is explicit that this
cannot be established until the T3 gate (WP7/WP50/WP51) runs, and tp01's header
comment says so in the file itself. Nothing in this suite depends on Obsidian's
event behaviour, and **the outbound direction must not be reported as observed
end-to-end.**

**The inbound arm needs no such caveat.** It is reachable by construction: any
peer — an older build, a differently-configured vault, or a hostile one — can
put such an op on the wire, and tp02 does exactly that with no sender-side guard
in the picture.

---

## 4. Full-suite counts, with foreign edits attributed

| | files | tests |
|---|---|---|
| baseline, measured by this batch before any edit | 353 | 2493 |
| after WP68 | **358** | **2571** |
| delta | +5 (this WP's five test files) | +78 (this WP's rows) |

`2493 + 78 = 2571` and `353 + 5 = 358` exactly. No pre-existing test changed
status.

**Foreign edits present in the shared working tree during this batch, none of
them made by B46 and none staged or committed by it:**

- `plugin/src/files/vault-events.ts` — uncommitted WP91 work (the mute and the disk-write window moved off the canvas branch). Present during the "after" measurement; it adds no tests and breaks none, which is why the arithmetic above still closes exactly.
- `plugin/src/files/canvas-persistence.ts` — uncommitted, appeared during the final commit sequence.
- Five commits landed on the branch mid-batch (`2debb41` … `c971474`). None touches any file under `plugin/src`.

**One flake, pre-existing and not caused by this WP:**
`src/__tests__/wp5/latency.test.ts > harness injects a measurable RTT inside the
50–150 ms band` failed once in a full parallel run and passed in the two runs
either side. Run in isolation it passes 3/3 on this tree **and** 3/3 on the
pre-change tree. It is load-dependent, and the charter already flags this file's
timing sensitivity.

`check_signal_register.py`: `clean - no NEW violations` with its positive
control proved. This report cites no signal numbers.

---

## 5. Out of scope, found and deliberately not fixed

Described, not numbered — the Dispatcher allocates.

1. **`FileOpsManager.onFileCreate` announces a sidecar FOLDER on the wire.** The
   folder branch (`emitOp({type:"folder-create", path})`) sits **above** the
   `skipsAutoTextSync` guard, so a folder created under the sidecar directory is
   emitted verbatim. Measured accidentally while building tp04. It does **not**
   compose into a write: the inbound `folder-create` is refused by the strict
   all-paths gate, because `isSharedPath` answers `false` for the path. What it
   does do is publish the existence and name of a local replica-state directory
   to every peer. Out of scope by the charter ("every other `FileOp` type").
2. **`wp88/test_ac1_route_census_derived_visible.test.ts` pins a whole-TEST-TREE
   property.** Its rule-15 row asserts that exactly one file in the entire test
   tree contains the literal `endSession`. Any new test file carrying an inert
   teardown stub on a fake plugin reddens it — which is what happened here, and
   the stub was removed rather than the pin amended. It will bite the next batch
   that copies a fake-plugin fixture, and the failure names WP88 rather than the
   new suite.

### 4a. Addendum, taken after the WP68 commits landed

The tree kept moving. Minutes after `e2f6358`, `plugin/src/files/canvas-sync.ts`
also appeared as modified — the sibling's WP91 work advancing — and a full-suite
run then reported **1 failed / 2570 passed (358 files)**:

```
FAIL src/__tests__/canvas-single-writer.test.ts
  > AC6 case 2 — subscribed, CanvasSync's own disk-write echo → NEITHER
AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times
  ❯ src/__tests__/canvas-single-writer.test.ts:579
```

**It is not WP68's, and the attribution is exact rather than circumstantial.**
That file drives the REAL `registerVaultEvents` modify handler; line 579 asserts
`handleLocalModify` is NOT called for a `CanvasSync` disk-write echo. The
uncommitted WP91 edit to `vault-events.ts` in the tree right now removes exactly
`!canvasSync.isRecentDiskWrite(file.path) &&` from that branch's condition, which
makes the capture run for the echo — the assertion and the removed term are the
same fact. Its imports are `background-sync.ts`, `canvas-persistence.ts`,
`canvas-sync.ts`, `vault-events.ts` and a two-peer harness; **WP68 touches none
of them.** Three of those four are currently modified in the shared tree by the
sibling batch.

The 358/2571/0-failures figure in the table above was measured twice on a tree in
which `canvas-sync.ts` was still clean, and the WP68 suite is 78/78 green now,
before and after.

`plugin/src/files/canvas-sidecar.ts` also shows as modified throughout. Its blob
hash is identical to `HEAD` (`019571d8…`); that is a stat-cache artefact of
`core.autocrlf`, not a change.

## 6. Method note — one risk taken that should not have been

To decide whether the `wp5/latency.test.ts` flake was mine, a scoped
`git stash push -- <this batch's four paths>` was used for roughly ninety
seconds and popped immediately. It was scoped to explicit paths and the sibling's
`vault-events.ts` change was verified intact afterwards (and is still in the tree
above), but RULE 14 warns against `stash` in a shared tree for exactly this
reason and the same question could have been answered by running the flaking file
in isolation, which it later was. Recorded so the next batch does not repeat it.
