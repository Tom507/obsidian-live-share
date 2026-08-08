# ImplementationReport — WP110 · S135 + S137

**Worker:** W3d, fresh context · **Branch:** `fix-bugs-and-raceconditions`
**Charter base:** `26581d2` · **Actual base at start:** `ed0307c`, and the Dispatcher moved it to `8736744`
mid-batch — see §5, residual R6.
**Deliverables:** `plugin/src/__tests__/v2/wp110/` (2 test files, 45 rows, 1 harness) + the production changes below.

> **⚠ THE CHARTER'S PREMISE FOR PACKAGE A IS CORRECTED, AND THE CORRECTION IS MEASURED.**
> The destination folder is not refused at any seam in this code. What *is* a permanent, silent,
> session-wide drop — with S135's exact signature, on S135's own anchor — is the promise chain the rename
> handler serialises on, plus a second type-blind mute gate S120's repair did not reach. Both are fixed.
> Neither is *proved* to be what the live vaults hit. §5 states that plainly.

---

## 1. Package A — S135

### 1.1 What was executed, and what it exonerates

The charter asks one question: is the op **never emitted**, **emitted but never sent**, **sent but refused
on receipt**, or **applied to a path the receiver then rejects**? I answered it by driving each seam rather
than reading it.

| seam driven, with real objects | cross-folder result |
|---|---|
| `vault-events.ts` `"rename"` handler → `FileOpsManager.onFileRename` → `emitOp` → injected sender | **emitted**, `{type:"rename", oldPath, newPath}` with both endpoints verbatim |
| same, `role: "host"` and `role: "guest"` | **identical**, both roles |
| same, `.md` and `.canvas` | **identical**, both extensions |
| same, destination `_liveshare-test/w4b-sub/` and `_liveshare-test/a/b/c/` | **identical**, no truncation to the parent |
| the live SEQUENCE (folder create, then the move) | **both** ops emitted, in order |
| `control-handlers.ts` `file-op` gate → `FileOpsManager.applyRemoteOp` → `applyRemoteOpInner` → recording vault | **admitted and applied**: `createFolder _liveshare-test/w4b-sub` then `rename`, bytes at the new path, old path gone |

`ensureFolder` on the receiver is the **only** folder-dependent branch anywhere in the rename pipeline, and
it succeeds. The three refusals a rename can take on the inbound gate — `isProtectedPath`, `isSidecarPath`,
and S124's `isSharedPath(newPath)` — all answer *admit* for `_liveshare-test/w4b-sub/note.md`; WP108's own
control row (`test_s124_peers_do_not_follow_a_file_out.test.ts:110`) already pinned
`isSharedPath("_liveshare-test/sub/renamed.md") === true`, and I re-drove it through the real gate.

**Conclusion: the cross-folder destination is not the discriminator.** The charter's first live hypothesis —
"a mute keyed on one of the two paths" — is refuted by construction: no mute in this codebase is ever keyed
on a folder, and the destination folder never appears in `mutedPaths` at all.

### 1.2 The drop point I did find — DROP #1

**`plugin/src/files/vault-events.ts`, the `"rename"` vault event's `pendingRename` chain.**
Pre-repair (at `ed0307c`, lines 256–278):

```ts
const prev = pendingRename ?? Promise.resolve();
const task = prev.then(async () => {
  plugin.fileOpsManager.onFileRename(file, oldPath);      // ← the emit
  await plugin.backgroundSync.onFileRenamed(oldPath, file.path);
  …
  await plugin.canvasSync?.handleRename(oldPath, file.path);
  … plugin.onActiveFileChange();
});
pendingRename = task.finally(() => { … });                 // ← no catch, anywhere
```

`prev.then(fn)` **does not run `fn` when `prev` is rejected.** So the first follow-up that throws leaves
`pendingRename` permanently rejected, and every later rename skips `onFileRename` entirely — **the op is
never emitted**, which is the charter's first option. Nothing clears a rejected `pendingRename`: it is only
nulled by the `finally` of the task that owns it, and the rejection is handed forward for the life of the
session. The `delete` handler (`:224`, `void pendingRename.then(run)`) and `active-leaf-change` (`:160`)
chain on the same promise, so deletes and leaf-change work go with it.

**Measured, before the repair:** four gestures (three renames, one delete) → **one op on the wire**. The
only trace was an unhandled rejection on a console nobody was capturing.

Four callees inside that task can reject and none is guarded: `BackgroundSync.onFileRenamed` (two `vault.read`
calls and `attachObserver`), `ManifestManager.renameFile` (a `Y.Doc` transaction), `CanvasSync.handleRename`
(`rekeyPathState`, `stampIdentity`), and `plugin.onActiveFileChange()`.

**Why this matches S135:** permanent, silent, no notice, no counter, no self-healing, both roles, unaffected
by retrying — and once it has happened, *every* later rename fails, which is what "4 attempts, 60 s" looks
like from outside.

**The fix.** The rejection is **contained, not swallowed** — `pendingRename` now holds a settled fulfilled
promise, and the failure is counted on `FileOpsManager` (`noteRenameTaskFailure()` /
`getRenameTaskFailures()`, beside `refusedSidecarRenames` and `refusedEscapingRenames`) and logged as
`RENAME FOLLOW-UP FAILED: <old> -> <new>: <error>`. **No retry and no re-emit** — the op of the failing
rename was already emitted before the first `await`, and adding a retry is a behaviour change this signal
does not license.

### 1.3 The second drop point — DROP #2, and it is S120 unfinished

**`plugin/src/files/file-ops.ts:1127` (pre-repair), `onFileRename`'s own entry check:**

```ts
if (this.isPathMuted(localNew) || this.isPathMuted(localOld) || !this.sendOp) return;
```

WP108's S120 repair converted **the six gates in `vault-events.ts`** from the bare refcount to
`isPathMutedFor(path, kind)`. It did not convert the **second gate on the same gesture**, one function
later. So a user's rename inside a window armed `consumes: ["create","modify"]` passes the outer,
kind-aware gate — correctly — and dies here, emitting nothing. Worse than the gate it duplicates: the outer
one counts its drop and logs `MUTE DROP:`; this one returned in silence, so **S120's own ledger reported the
gesture as never dropped.**

Found by driving the real `registerVaultEvents` handler rather than the predicate. A test written against
`isPathMutedFor` alone — which is what `wp108/test_s120_mute_does_not_swallow_intent.test.ts` is — stays
green over both the fixed gate and this one.

**The fix.** Converted to `isPathMutedFor(localNew, "rename") || isPathMutedFor(localOld, "rename")`, and
the drop counted on the **same** `noteMuteDrop("rename")` ledger as the outer gate. `isPathMutedFor` is
fail-closed where no release is armed, so this is never more permissive than the line it replaces except in
exactly the case S120 identified and WP108 validated.

**Not converted, deliberately:** `onFileCreate` and `onFileDelete` carry the identical blind check.
`onFileCreate` has a second caller that is **not a vault event at all** — `sync-request` in
`sync/control-handlers.ts:484` — so "what kind of event is this" is not a well-posed question at that call
site, and answering it wrongly would re-send a file into a window a remote apply is still holding.
`onFileDelete` is outside this signal. Both are residual R3.

### 1.4 A3 — does `.canvas` share the defect?

**Yes, identically, and it is also a *cause*.** Evidence, not inference:

- The rename pipeline is **extension-agnostic by construction**. `onFileRename` carries no
  `skipsAutoTextSync` guard (unlike `onFileCreate:1015`, which does); the inbound gate consults only
  `isProtectedPath` / `isSidecarPath` / `isSharedPath`; `applyRemoteOpInner`'s `"rename"` case never looks
  at the extension.
- Every outbound row (6 per role) and both inbound rows are **parameterised over `.md` and `.canvas`** and
  behave identically — same op, same endpoints, same journal.
- `CanvasSync.handleRename` is a no-op for a path it holds no guid for (`canvas-sync.ts:3276`), so a `.md`
  rename never enters it.
- **And the canvas half feeds DROP #1**: a rejecting `CanvasSync.handleRename` poisons the same chain, so a
  failed *canvas* rename silently kills the *text* rename and delete channels for the rest of the session.
  That row is in the suite (`a throwing CanvasSync.handleRename is contained on the same chain`).

### 1.5 Break table — Package A

Copy-aside (`cp file file.pre-v2-smoke`), plant, run, restore by copy-back, `rm`. **Zero `.pre-v2-smoke`
files of mine remain** (see R5 for one that is not mine).

| # | plant | expected | RED rows | right reason? |
|---|---|---|---|---|
| A-B1 | `pendingRename = contained.finally(…)` → `task.finally(…)` (i.e. re-poison the chain) | the channel dies after one failure | 3 — *THE DEFECT*, *REPEATED failures*, *throwing CanvasSync* | yes: `["rename"]` instead of `["rename","rename","rename","delete"]` |
| A-B2 | empty the `catch` body (no counter, no log) | the containment goes silent | 3 — *ATTRIBUTION*, *REPEATED failures*, *throwing CanvasSync* | yes: `getRenameTaskFailures()` 0, no `RENAME FOLLOW-UP FAILED:` line |
| A-B3 | `isPathMutedFor(…, "rename")` → `isPathMuted(…)` in `onFileRename` | S120's property is lost at the second gate | 1 — *a user rename inside a mute armed for create/modify* | yes: `sent` empty |
| A-B4 | delete the converted gate entirely (`if (!this.sendOp) return;`) | the census conservation law must catch it | 1 — `wp93` T6 | yes: `expected [] to have a length of 2` — and **`wp93` T1 stayed GREEN**, which is exactly why the conservation law exists |

---

## 2. Package B — S137

### 2.1 Why the firings could not be attributed

Two `console.warn`-only refusal sites:

- `files/manifest.ts:697` — arm `manifest-sync`, **the arm that fired twice live**
- `files/background-sync.ts:579` — arm `doc-write`

The ledger was **not** the gap. `getEmptyWriteRefusals()` already reported
`{ total: 2, byArm: { "manifest-sync": 2 } }` — that is what made the firings visible at all, and it is what
makes S126's "the ledger stayed flat here, and the same ledger had fired twice earlier" admissible. What it
cannot do, by design, is say *which file*: a counter that stored paths would grow without bound and would
put user filenames into every diagnostic that renders it.

**The root cause of the unattributability is one level below the call sites: neither `ManifestManager` nor
`BackgroundSync` held a logger at all.** Not an oversight at the emitter — a missing wire. The same is true
of three of the seven `protected-paths` arms.

### 2.2 What was built

**One shared emitter**, in the pure `files/empty-write-guard.ts`, on the `protected-paths.ts` precedent:

```
EMPTY WRITE REFUSED: arm=<arm> path=<path> reason=<verdict.reason>
```

- `emptyWriteRefusalMessage(arm, path, reason)` — the one spelling, so a live grep is a census over **arms**
  rather than over phrasings.
- `noteEmptyWriteRefusal(arm, path, reason, logger?)` — **counts, logs and consoles in one call**, so
  neither call site owns a private idiom. The `console.warn` stays (B1 permits it); what is added is the
  debug-log entry.
- `EMPTY_WRITE_ARMS` — a named, closed arm set, with a derived row asserting it equals the set of production
  call sites.
- The logger is a **parameter, not a module-level sink**. A module-level sink has to be installed at load,
  and that is precisely S104's shape.

**It names the PATH**, unlike its precedent, and that is deliberate: `protectedRefusalMessage` reports a
protected *root* because the class is what matters there; here the path is the answer to the only question
the line exists to answer. `verdict.reason` states byte **counts** and never bytes, so no file content
reaches the log.

**Wiring**, in `main.ts`, **inside the existing `setLogger` block below the `DebugLogger` assignment** —
never beside the `new`, which is S104 exactly. `ManifestManager.setLogger` and `BackgroundSync.setLogger`
added; both fields `?.`-guarded so every harness that constructs these classes directly is unaffected, and a
row asserts the **order** by source index (not by line number, S88).

### 2.3 The siblings in that family (B2)

| site | arm | before | after |
|---|---|---|---|
| `manifest.ts` `syncFromManifest` empty-write | `manifest-sync` | console only | shared emitter → debug log |
| `background-sync.ts` `doWriteToDisk` empty-write | `doc-write` | console only | shared emitter → debug log |
| `manifest.ts:591` protected path | `manifest-sync` | counted, never said | `protectedRefusalMessage` → debug log |
| `background-sync.ts:509` protected path | `doc-write` | counted, never said | `protectedRefusalMessage` → debug log |
| `canvas-sync.ts:4892` protected path | `canvas-write` | counted, never said (module *had* a logger) | `protectedRefusalMessage` → debug log |
| `manifest.ts:1018` `preserveLocalVersion` failure | — | counted + console | `CONFLICT COPY FAILED: path=…` → debug log |

All seven protected-path arms now emit the shared line; the three that were mute were exactly the three
modules that held no logger.

**Deliberately EXCLUDED, with the reason recorded rather than silently skipped:**
`noteProtectedRefusal("shared-path", path)` inside `passesLocalSafetyFloors`. That predicate is evaluated
per-file on every `publishManifest`, and under a whole-vault share every `.obsidian/**` file hits it on
every pass. A log line there is a **stream, not a signal**, and it already has a counter. It is a membership
answer, not a destructive refusal.

### 2.4 Break table — Package B

| # | plant | expected | RED rows | right reason? |
|---|---|---|---|---|
| B-B1 | remove `logger?.warn(…)` from the shared emitter | no arm reaches the log | 4 — both live-shape rows, the shape-equality row, the emitter row | yes: `logger.refusals()` empty |
| B-B2 | `manifest.ts` passes `null` instead of `this.logger` | only that arm goes quiet | 1 — *THE LIVE SHAPE* | yes: proves the **wiring** is under test, not just the emitter |
| B-B3 | remove `this.manifestManager.setLogger(this.logger)` from `main.ts` | the S104 hazard, re-planted | 1 — the wiring-order row | yes: index lookup returns −1 |

Every row in the B file has a **positive control** — a run with nothing to refuse, a *legitimate* empty
write (select-all-and-delete) that must reach disk and must **not** log, an ordinary non-empty flush, and an
**unwired** manager proving the floor still holds without any sink at all.

**Not attempted:** the cause of the two live firings. That needs a live rerun with a console listener and is
W4's scope. Nothing in the unit evidence bears on it.

---

## 3. Gate

| | test files | tests | failed | `tsc` | register |
|---|---|---|---|---|---|
| **baseline**, this tree, before my first change | **407** | **3000** | 2 | clean | exit 0 |
| **after**, my last change | **410** | **3057** | 9, see below | clean | **exit 1 — not mine**, see below |

**The register check exits 1 on a citation in the SIBLING's committed report**, not on anything in this
package: `UNKNOWN ImplementationReport_WP109.md S141 (line 235)` — a bare "next free is S141" that needs the
`<!-- signal-register: meta -->` marker §5 prescribes. This report's own equivalent line carries the marker
and the checker accepts it. **I did not edit W3c's committed artefact**; the fix is one marker on one line
and belongs to whoever owns that file. It exited **0** immediately before that commit landed.

`+3` files / `+57` tests: **2 files / 45 tests are mine** (`v2/wp110/`); the remainder is the sibling worker
W3c's WP109, which landed at `39255ee` while this batch was running (R6).

**Failures are load-dependent and none is caused by this package.** Every one of them is **green when its
file is run in isolation**, and the classes are already on the register:

| failing row(s) | class | verdict |
|---|---|---|
| `wp101/test_s123_canvas_mirror_race` ×3 | 5 s timeout | **in the baseline run too**; S74/S85 family |
| `wp92/test_tp06` — attributable in a SHARED tree | 5 s timeout on `execFileSync("git", …)` | S88 / S100 |
| `wp93/test_tp01` T6 | 5 s timeout on `git show` | S88 / S100 |
| `w4-canvas-integrity` D6 logger wiring H1/H2 | 5 s timeout | S74 / S85 — **checked specifically**, because these read `main.ts`, which this package edits; the failure mode is a timeout, not an assertion, and both are green in isolation |
| `wp46/test_probe_side_effect_free` — `quiescent: true` vs `false` | scheduling | S85 |
| `wp5/latency.test.ts` US4 AC3/AC4 | fixed sleep used as a settle | **S85, named** |

The baseline itself moved between two runs of the *same unchanged tree*: **19 failures / 9 files** on a cold
run (694 s) and **2 failures** on a warm one (105 s). That is S74/S88 in the open, and it is why the figure
above is bracketed rather than quoted as "clean".

### 3.1 The one pin that reddened, and what was done with it

`v2/wp93/test_tp01_the_census_is_closed_and_derived_visible.test.ts` T1 and T6 pin the `isPathMuted` consumer
census at `files/file-ops.ts×9`. DROP #2's repair converts two calls to `isPathMutedFor`, so the derivation
reads **7**.

**The pin was moved, with a written declaration beside S120's, and the property was extended rather than
restated.** A bare recount of 7 would satisfy the letter and lose the row: "went down by two" is equally
true of the conversion and of somebody *deleting* the gate, which would put every echo of an applied rename
back on the wire. So T6's conservation law is extended — the two calls that left `isPathMuted` are counted
again arriving at `this.isPathMutedFor(`, and the gate is required to count what it drops
(`this.noteMuteDrop(`), both read off disk. **Break A-B4 proves the extension has teeth: deleting the gate
leaves T1 GREEN and reddens T6.** `GATES_CONVERTED_BY_S135 = 2` is named, and T6's arithmetic is written as
`before + 1 − GATES_CONVERTED_BY_S135` so an *undeclared* third movement still reddens.

---

## 4. Rejected, and why

1. **The mute as the cross-folder cause** (the charter's first hypothesis). Refuted structurally: mutes are
   keyed on exact paths, never on a folder, and the destination folder never enters `mutedPaths`.
2. **The S124 destination gate as the cause.** Refuted by execution: `isSharedPath` admits
   `_liveshare-test/w4b-sub/note.md`, and the real gate admits the op.
3. **Converting `onFileCreate` / `onFileDelete`'s blind mute checks.** Declined with a stated reason (§1.3);
   recorded as R3 rather than done unasked.
4. **Retrying or queueing a rename whose follow-up failed.** Declined — the op is already on the wire, and a
   retry is a behaviour change no signal licenses.
5. **"Fixing" `if (pendingRename === contained)`.** It is dead code — `pendingRename` holds
   `contained.finally(…)`, never `contained`, so the comparison is always false and `pendingRename` is never
   nulled. It was equally dead before (`pendingRename === task`). Preserved **byte-equivalently** rather than
   repaired, so this package changes exactly one thing about that chain. Recorded as R2.
6. **A module-level logger sink for `empty-write-guard.ts`.** Rejected: that is S104's shape. The logger is a
   parameter.
7. **Logging `passesLocalSafetyFloors`'s protected refusal.** Rejected as a stream, not a signal (§2.3).

---

## 5. Residual

- **R1 — the live cross-folder specificity is NOT explained.** I found a permanent, silent drop with S135's
  exact signature on S135's own anchor, and a second silent drop on the charter's second anchor. **Neither is
  proved to be what the live vaults hit**, because no unit seam refuses a cross-folder destination. If the rig
  is re-run, the discriminator to grep for is `RENAME FOLLOW-UP FAILED:` in the debug log — a line that did
  not exist when the measurement was taken, which is the other reason the original run could not attribute it.
  The register entry for S135 should not be closed on this report alone.
- **R2 — `if (pendingRename === contained)` is dead**, pre-existing, preserved deliberately (§4.5).
- **R3 — `onFileCreate` and `onFileDelete` still hold the type-blind mute check** in `file-ops.ts`. Same
  shape as DROP #2, un-converted, with the reason stated in §1.3.
- **R4 — `ensureFolder` swallows every `createFolder` error** (`utils.ts:448`). If the destination folder
  cannot be created, `vault.rename` then throws and `APPLY FAILED:` blames the *rename*. That is an
  attribution defect on the one folder-dependent branch in the pipeline, and it is worth a line of its own if
  the live rerun points back here.
- **R5 — a `plugin/src/files/background-sync.ts.pre-v2-smoke` belonging to the sibling worker existed in the
  tree mid-batch.** I did not stage, restore or delete it; it is gone now. **Zero of mine remain.**
- **R6 — two workers in one tree, live** (S100). W3c held uncommitted edits in `files/background-sync.ts`,
  `main.ts`, `editor/collab.ts` and `editor/collab-bind-decision.ts` for most of this batch, reverted part of
  its own `background-sync.ts` change mid-run, and landed at **`39255ee`** while my final gate was executing.
  Consequences, stated rather than hidden: **(a)** the baseline (407/3000) was measured on the tree at
  `ed0307c` *before* the sibling's edits appeared; **(b)** the after figure (410/3057) is over a tree that
  includes WP109; **(c)** at commit time the working tree contained **only my changes**, so no hunk splitting
  was needed after all.
- **R7 — no signal numbers allocated.** DROP #1 (the poisoned rename chain) and DROP #2 (the second
  type-blind mute gate) are new findings described in prose here; the Dispatcher numbers them.
  **Next free is S141, and this package allocated none.** <!-- signal-register: meta -->
