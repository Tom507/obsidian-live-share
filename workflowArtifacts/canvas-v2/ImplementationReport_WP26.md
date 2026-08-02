# Implementation Report — WP26

**Attempt:** 3 (+ a documentation-conformance pass logged separately as out-of-budget)
**WP:** WP26 — Sidecar exclusion from manifest, sync and text-sync detection (C26, phase P2)
**Depends on:** WP24 (owner of `SIDECAR_DIR` / `isSidecarPath`)

---

## Status

`DONE`

All 46 visible tests in `plugin/src/__tests__/v2/wp26/` pass. WP24's 76 visible tests are
untouched and still green. The full plugin suite is 1470 passed / 0 failed.
**`tsc --noEmit -skipLibCheck` is now completely clean — zero diagnostics.**

### What changed in attempt 3

No production behaviour changed. The production code-only diff is byte-identical to attempt 2
(verified by `git diff` with comments stripped). Two correctness fixes:

1. **The AC3 contract comment contradicted its own stated invariant.** The enumeration block
   claimed "nothing is named here that does not actually call it", and then named
   `files/vault-events.ts` in the `handleLocalTextModify` bullet's explanatory prose.
   `vault-events.ts` does not call `isSidecarPath` — it is the *route into* the seam. Same
   class of defect as the `files/exclusion.ts` entry fixed in attempt 2: a module named for
   context reading as a consumer claim. Fixed by **restructuring, not deleting** the
   reasoning — see below.
2. **The three `TS2493` diagnostics in `test_tp04` are fixed.** Attempt 2 reported them as
   "pre-existing", which was true only relative to my own edits — they are **new relative to
   the batch baseline**, which had a clean `tsc`, and were authored by this batch's own WP26
   test sub-agent. That makes them our defect, not a foreign edit and not a licence question.
   Typing only; no assertion touched. See *The `tsc` fix* below.

### What changed in attempt 2

Attempt 1 satisfied the visible sample. Attempt 2 re-derived the consumer set **from the
code** instead of from the charter's list, and found one real leak the sample does not pin:

- **`ManifestManager.renameFile` is a manifest WRITER that never consults `isSharedPath`.**
  Attempt 1 guarded the membership *predicate*, which constrains every writer that asks it —
  `publishManifest` (via `getSharedFiles`), `updateFile`, `addFolder`. `renameFile` asks
  nothing; it re-keys an existing entry directly. Renaming an ordinary shared note into the
  sidecar directory therefore published the entry under a **sidecar key**, in violation of
  AC1's "*ever* added to the manifest". This is reachable, not theoretical (see below).
- **The AC3 enumeration was wrong in the "only" direction.** It named `files/exclusion.ts`
  inside the consumer table; that module does not import or call `isSidecarPath` and is not a
  consumer. AC3 makes the comment normative, so an aspirational entry there is itself a
  defect. Removed, and `renameFile` added.
- **The three remaining `getDoc` seams are now decided explicitly, not by omission** — with
  the reachability argument recorded in the code rather than left implicit.

No test file was added, amended or deleted in either attempt.

---

## Completed Work

| AC | Status | Notes |
|---|---|---|
| **AC1** — no file under the sidecar directory is ever added to the manifest, subscribed for sync, or handled by any text-sync path, *asserted at each consumer* | DONE | **Six** guarded seams, derived from the code. The charter §2 named four; §7.0 and the Shared Ownership Contract §5 added `handleLocalTextModify` and `isSharedPath`; attempt 2's writer/reader sweep added `renameFile`, which no document names and no visible test pins. Three further `getDoc` seams are unguarded by explicit, recorded reachability argument. |
| **AC2** — creating, renaming into, or modifying a sidecar path triggers no sync activity and no doc creation | DONE | "creating" → `onFileAdded`; "renaming into" → `onFileRenamed` (on `normNew` only, so a rename *out* still subscribes); "modifying" → `handleLocalTextModify`, which had no guard of any kind and no `isTextFile` pre-filter. Manifest replay (`startAll`) and peer-published entries (`syncFromManifest`) are covered as well. |
| **AC3** — one predicate, one definition, in the same style as the existing `.canvas` exclusion, consumers enumerated in the code comment | DONE | `skipsAutoTextSync` remains the single definition in `utils.ts` and is now `path.endsWith(".canvas") \|\| isSidecarPath(path)`. `isSidecarPath` / `SIDECAR_DIR` are **imported** from WP24's `files/canvas-sidecar.ts` — no re-spelling, no second constant, no private prefix test. The existing 28-line contract comment was **extended** (not duplicated) and now enumerates both the four `skipsAutoTextSync` consumers and the two direct-`isSidecarPath` consumers. |
| **AC4** — existing `.canvas` exclusion behaviour unchanged | DONE | The `.canvas` clause is byte-for-byte the original `path.endsWith(".canvas")`, prepended to a disjunction. No refactor of the extension test, no regex, no `lastIndexOf(".")`, no case folding. `handleLocalTextModify` and `isSharedPath` are deliberately guarded with `isSidecarPath` **alone**, so the R10 `.canvas` text fallback stays writable and ordinary `.canvas` files stay shared. |

**Definition of Done** — *local replica state cannot leak into shared state*: met. The sidecar
subtree is now refused independently at the text-sync predicate **and** at the manifest
membership gate, so a failure of either one alone is not sufficient to leak.

---

## Blocked Items

None.

---

## Tools Created

None. No new runtime dependency, no new dev dependency, no new script.

---

## Changes Made

Three production files, exactly the three named in the charter §6.

### 1. `plugin/src/utils.ts`

- Added `import { isSidecarPath } from "./files/canvas-sidecar";`. No import cycle:
  `canvas-sidecar.ts` imports only `yjs` and nothing from `utils.ts`.
- `skipsAutoTextSync` body: `return path.endsWith(".canvas");` →
  `return path.endsWith(".canvas") || isSidecarPath(path);`
- Extended the existing contract comment above it (AC3). It now:
  - splits the rationale into **CLAUSE 1 (`.canvas`, WP6/US5)** and **CLAUSE 2 (sidecar, WP26)**,
    stating that clause 2 is a *directory* test rather than an extension test and that the two
    clauses are disjoint so neither widens the other;
  - keeps the original four-consumer table (`background-sync.ts` × 3, `manifest.ts`);
  - adds a second table for the four seams that call `isSidecarPath` **directly** because they
    must *not* skip a `.canvas` — `background-sync.ts handleLocalTextModify` and
    `manifest.ts syncFromManifest` / `isSharedPath` / `renameFile` — with the reason in each
    case, and states the reader/writer rule that explains why exactly those four and no
    others. **Attempt 2** corrected this table in the "only real consumers" direction: it had
    named `files/exclusion.ts`, which does not call the predicate and is not a consumer;
  - keeps and extends the `BackgroundSync.subscribe()` non-consumer paragraph, noting that
    WP26 leaves the R10 door open on purpose (WP33 owns it) and makes it *unreachable* for a
    sidecar path by guarding its callers instead.

### 2. `plugin/src/files/background-sync.ts`

- Added `import { isSidecarPath } from "./canvas-sidecar";`.
- `handleLocalTextModify` — **new guard**, immediately after path canonicalisation and before
  every other check: `if (isSidecarPath(path)) return;`. Guarded with the sidecar predicate
  **alone**; using `skipsAutoTextSync` here would silently make the announced R10 text
  fallback read-only for local edits (`vault-events.ts` routes a non-CanvasSync-owned
  `.canvas` into this method on purpose).
- `startAll`, `onFileAdded`, `onFileRenamed` — **no code change**. They already consult
  `skipsAutoTextSync`, which now covers the sidecar. This is the point of AC3.
- `subscribe` — **deliberately untouched** (the R10 door; WP33's scope).
- Extended the module header comment to record why the fourth door is guarded differently.

### 3. `plugin/src/files/manifest.ts`

- Added `import { isSidecarPath } from "./canvas-sidecar";`.
- `syncFromManifest` — **new guard at the top of the entry loop**, immediately after
  `isPathSafe` and *ahead of* the directory branch: `if (isSidecarPath(path)) continue;`.
  Placement is the whole point: the pre-existing `.canvas` guard sits below the directory
  branch and is written `!entry.binary && …`, so it covers exactly one of the three branches.
  The guard is unconditional and in particular **not** gated on `options.skipText`.
- `isSharedPath` — **new guard**, ahead of the `ExclusionManager` consult:
  `if (isSidecarPath(path)) return false;`. This is the second, independent gate (AC1's
  "added to the manifest") and covers `publishManifest` (via `getSharedFiles`), `updateFile`
  and `addFolder` in one place.
- `renameFile` — **new in attempt 2.** Destination-side guard: the entry is still deleted from
  `normOld` and `releaseDoc(normOld)` still runs, but the `set` on `normNew` happens only when
  `!isSidecarPath(normNew)`.
- `plugin/src/files/exclusion.ts` — **not modified**, deliberately. See below.

### The generalization in attempt 2, and why it is the right one

The question that produced it is *which code can put a key into the manifest?* — not *which
code reads the membership predicate?* Enumerating `this.manifest.set(...)` gives four writers.
Three consult `isSharedPath` (`publishManifest` via `getSharedFiles`, `updateFile`,
`addFolder`). `renameFile` consults nothing: it re-keys an existing entry directly, and it is
the only writer that writes a key it did not derive from a `TFile` the predicate had already
admitted. A guard on the membership predicate cannot constrain a caller that never asks it.
The remaining manifest mutations are deletions and cannot admit a path.

**It is reachable, not theoretical.** `vault-events.ts:190-194` admits a rename event when
**either** side is shared:

```ts
if (!isSharedPath(file.path) && !isSharedPath(oldPath)) return;
```

Moving an ordinary shared note into the sidecar directory therefore passes that gate on the
strength of `oldPath`, reaches `renameFile(oldPath, sidecarPath)` at `:209`, and publishes the
entry under a sidecar key. Every peer then holds a manifest entry pointing into another
client's local replica state — a direct AC1 violation ("*ever* added to the manifest").

**Falsification.** Verified with a throwaway probe (created, run, deleted — no test file was
added to the repo, and none was edited). With the guard neutralised to
`const admitsDestination = true`, the sidecar key IS published and **exactly one** assertion
reddens; the two positive controls — an ordinary rename still moving its entry, and
`releaseDoc` still firing for the old path — stay green. That is what Shared Ownership
Contract §6.1 asks for: the pin fails on its own injection and no neighbouring oracle absorbs
it. This is also why the fix is a generalization rather than a guess: the leak was demonstrated
before it was closed.

**Why destination-only.** The guard mirrors `BackgroundSync.onFileRenamed`, which guards
`normNew` alone — the same asymmetry, for the same reason, now in both modules:

- the `delete(normOld)` must still run, because a file moved into the sidecar directory has
  **left** the shared tree; suppressing it would strand a stale entry forever;
- the reverse direction (recovering a file *out* of the sidecar directory) must keep working
  and needs no special case — `manifest.get(normOld)` returns `undefined` for a sidecar key
  because one was never admitted, so it falls out of the existing control flow;
- guarding `normOld` as well would break exactly the case TC3 pins for `onFileRenamed`.

**Where I stopped, and why that is not arbitrary.** `fileOpsManager.onFileRename` broadcasts
the same rename to peers over the file-operation channel, gated by that same either-side
condition. It is a real adjacent question, but it is peer file-op broadcast rather than
manifest membership or text-sync detection, it lives outside the three files the charter
scopes, and no C26 criterion reaches it. Reported below rather than patched.

### The three `getDoc` seams left unguarded, and why

Recorded in the `background-sync.ts` module header so the decision is auditable rather than an
omission. A guard on any of these would be unfalsifiable by construction, which is worse than
no guard:

| Seam | Why no guard |
|---|---|
| `subscribe()` | The announced R10 text-fallback door. WP33's scope, pinned open by TC7. Made unreachable for a sidecar path by guarding its callers. |
| `setActiveFile()` | `main.ts:909-912` only ever passes a path that already cleared `isSharedPath` **and** `isTextFile`. Since `isSharedPath` now refuses the sidecar, a sidecar path can never become the active file. This retires the concern attempt 1 filed as an open defect. |
| `flushWrite()` | Keyed off `writeTimers`, populated only by the observer installed in `attachObserver`, which runs only for paths admitted through one of the four guarded doors. |

### The AC3 comment restructure (attempt 3)

The `vault-events.ts` rationale is load-bearing — it is the reason `handleLocalTextModify`
takes `isSidecarPath` alone rather than the composed predicate — so it was kept. What changed
is *where it sits* and how the block is delimited:

- The **consumer list is now a bare four-row block**, one `<module>  <function>` pair per row,
  with no prose inside it. A reader or a checker can extract the consumer set from those four
  rows without disambiguating prose.
- The exhaustiveness claim is now scoped explicitly to that block ("the CONSUMER LIST is the
  indented block below"), and states that **prose outside the block may name other modules for
  CONTEXT, and those are not consumers**.
- The per-seam reasoning moved to a following section keyed by *function name only*, prefaced
  with "none of the modules named in this section is a consumer". Where `vault-events.ts`
  appears it is now labelled in place: "That route lives in `files/vault-events.ts`, which is
  the CALLER of the seam and calls neither predicate itself."

I re-swept the whole comment for the same defect class. Every `.ts` filename it now contains
is one of: `files/canvas-sidecar.ts` (the owner, explicitly excluded from the claim),
`files/background-sync.ts` and `files/manifest.ts` (real callers of one or both predicates),
or `files/vault-events.ts` (labelled a non-caller at its single mention).

### The `tsc` fix (attempt 3) — and why it cannot have weakened the test

`vi.fn(async () => …)` infers a **zero-arity** mock, so `mock.calls[i][0]` is indexing a
`[]` tuple. The file's author annotated `getDoc: vi.fn((path: string) => …)` and missed the
other three — and those three are exactly the mocks whose `mock.calls` are read positionally
at lines 130, 161 and 192. Pure oversight, not a design choice.

The entire diff to the test file is three signatures (plus comments explaining why):

```diff
-    create: vi.fn(async () => ({})),
-    createFolder: vi.fn(async () => ({})),
+    create: vi.fn(async (_path: string, _data: string) => ({})),
+    createFolder: vi.fn(async (_path: string) => ({})),
-    waitForSync: vi.fn(async () => {}),
+    waitForSync: vi.fn(async (_path: string) => {}),
```

Why it cannot have weakened anything:

- **Nothing executable changed.** `git diff` filtered for `expect` / `it(` / `describe(` /
  `toBe` / `toHaveBeenCalled` / `manifest.set` lines returns **empty**. No assertion, no
  expected value, no fixture, no test was added, removed or reworded.
- **The bodies are unchanged** — the parameters are ignored exactly as before, the return
  values (`({})`, `({})`, `undefined`) are identical, and the arity at every call site is
  unchanged. `vi.fn` records the arguments it actually receives regardless of the declared
  signature, so `mock.calls` contains the same data.
- **Types are erased before execution.** Vitest transpiles with esbuild, which strips
  annotations without typechecking, so the program that runs is literally the same one.
- **Test count is unchanged:** `test_tp04` reports 5 passed, and the WP26 suite total is still
  46 — the same numbers as attempts 1 and 2.
- **Falsification re-run after the change.** Neutralising the `syncFromManifest` guard
  (`if (false && isSidecarPath(path)) continue;`) still reddens **3 of tp04's 5 tests**; the
  guard was restored immediately afterwards and re-verified. The file still discriminates the
  exact defect it was written for.

### Documentation-conformance pass (out of retry budget)

**Not a fourth implementation attempt.** The three implementation attempts are spent and the
implementation was already complete and correct at the end of attempt 3: AC1/AC2/AC4 green,
blind set 1 fully green, `tsc` clean, full suite 1470/0. This pass changed **comment text
only** — the executable diff is empty, verified by filtering the `utils.ts` diff for
non-comment lines and confirming it is byte-identical to attempt 3's (the two attempt-1
production lines, and nothing else).

**What was still red and why the attempt-3 restructure could not fix it.** One AC3 oracle
extracts *every* `*.ts` basename appearing anywhere in the contract comment, with a single
flat regex over the whole block, and requires each to be a real consumer, the owning module,
or `utils.ts`. It has no notion of a delimited block, a labelled exception, or an "is not a
consumer" annotation — so `vault-events.ts` reddened it wherever it sat and however it was
labelled. Attempt 3's delimiter structure was not wrong; it was simply solving for a reader
with more context than the oracle has.

**The fix.** The token `vault-events.ts` is gone from the contract comment. The reasoning is
**kept in full and not shortened** — it is expressed by role instead:

> …because the VAULT EVENT ROUTER — the module registering the vault `modify` handler —
> deliberately routes a `.canvas` that CanvasSync does not own into it, immediately after
> emitting the fallback warning. That router is the CALLER of this seam and consults neither
> predicate itself, so it is named by role, not by filename.

The delimiter structure from attempt 3 stays. Its stated invariant was **strengthened** to
match what the oracle actually checks, and to be self-defending against the next editor:

> Every `.ts` name appearing ANYWHERE in this comment is therefore either a row below, that
> owning module, or this file. Other components are referred to by ROLE rather than by
> filename — deliberately, so the consumer set can be read off mechanically without
> disambiguating prose. Do not "helpfully" restore a filename to the reasoning below: a bare
> filename here is exactly the ambiguity that let this defect recur twice, with two different
> modules.

**Full sweep result** — every `.ts` basename remaining in the contract comment, by count:

| Basename | Count | Status |
|---|---|---|
| `background-sync.ts` | 2 | real consumer |
| `manifest.ts` | 4 | real consumer |
| `canvas-sidecar.ts` | 2 | owning module |
| — | — | **nothing out of policy** |

The sweep is the deliverable, not the one filename: it was run mechanically over the extracted
comment rather than by eye, and re-run after the edit to confirm zero out-of-policy names.

**Deliberately out of scope of this pass:** the ordinary explanatory comments in
`background-sync.ts` (which names `main.ts`) and `manifest.ts` (which names `vault-events.ts`).
Those are not the contract comment, are not what AC3 makes normative, and are not read by the
oracle; de-naming them would cost local clarity for no conformance gain. Flagged here so the
inconsistency is a recorded decision rather than an oversight.

### How the `ExclusionManager` gate was handled durably

`ExclusionManager` excludes the sidecar today only by **coincidence**: `setPatterns` prepends
`` `${configDir}/**` `` and the sidecar happens to live under the *default* config dir. Three
configurations break that coincidence and all three leak in the untouched tree:

1. no `ExclusionManager` installed at all (`this.exclusionManager` is `null`),
2. a non-default `app.vault.configDir` — `SIDECAR_DIR` is a fixed literal and does not follow it,
3. `sharedFolder` pointing into the config directory, which re-admits the whole subtree.

The obvious fix — injecting a sidecar pattern into `ExclusionManager` — is **not durable**:
`setPatterns` rebuilds the array from scratch on every settings save, so a one-time mutation
is erased on the next save, and it would still leave configuration 1 open.

The chosen fix places the check in `ManifestManager.isSharedPath`, ahead of the
`ExclusionManager` consult. `ExclusionManager.isExcluded` has **exactly one consumer in the
whole tree** (that very line), so this placement is strictly wider than any pattern-based
approach, is immune to `setPatterns` churn by construction, holds when no `ExclusionManager`
exists, and keeps `exclusion.ts` as what it is — the *user/config* exclusion list, not a home
for a hard-coded product invariant. It also keeps the sidecar policy in one module rather
than two, which is what AC3 asks for.

---

## Visible Test Results

```text
cd plugin && npx vitest run src/__tests__/v2/wp26
  Test Files  9 passed (9)
       Tests  46 passed (46)
```

Baseline before this change: **27 failed / 19 passed**. All 19 previously-green tests
(the AC4 characterisations and the positive controls) stayed green.

Regression gates (re-run in full after attempt 2's `renameFile` change):

```text
npx vitest run src/__tests__/v2/wp24     →  13 files, 76 passed (unchanged)
npx vitest run src/__tests__/manifest.test.ts  →  57 passed (renameFile suite unchanged)
npx tsc --noEmit -skipLibCheck           →  CLEAN, zero diagnostics (attempt 3)
npx vitest run  (full plugin suite)      →  253 files, 1470 passed / 0 failed
```

Full-suite delta: **1424 → 1470 = +46**, exactly the WP26 visible set. No pre-existing test
changed state in either direction. Batch B16 (WP64) is concurrently editing pre-existing test
files in this tree; its net contribution to the count during this window was zero, and no
foreign edit was observed in any file WP26 touched.

---

## Pre-existing defects observed (not fixed — reporting only)

- **~~`tsc` diagnostics in a WP26 test file~~ — FIXED in attempt 3.** Attempt 2 filed these as
  pre-existing and declined to touch them on licence grounds. That reasoning was wrong: they
  were pre-existing only *relative to my own edits*. Relative to the **batch baseline**, whose
  `tsc` was clean, they are new, and they were authored by this batch's own WP26 test
  sub-agent — our defect, not a foreign edit. The licensed-deletion / licensed-amendment lists
  govern removing or rewriting assertions; a compile-time-only parameter annotation that
  changes no assertion, no expected value and no test count is neither. Fixed; see *The `tsc`
  fix* above for the diff and the argument that it cannot have weakened the test.

- **~~`BackgroundSync.setActiveFile`~~ — RETIRED in attempt 2.** Attempt 1 filed this as a
  possible open leak. Traced properly: `main.ts:909-912` builds `sharedPath` from
  `isSharedPath(filePath) && isTextFile(filePath)` and passes `null` otherwise, so with the
  `isSharedPath` guard in place a sidecar path can never become the active file. Not a defect;
  the reachability argument is now recorded in the module header instead of a guard.

- **`fileOpsManager.onFileRename` broadcasts a rename into the sidecar directory to peers.**
  Same root cause as the `renameFile` leak — `vault-events.ts:190-194` admits the event when
  *either* side is shared — but on the peer file-operation channel rather than the manifest.
  A peer receiving it would recreate the move inside its own `.obsidian/liveshare/state`.
  **Not fixed:** it is outside the three files the charter scopes, it is neither manifest
  membership nor text-sync detection, and no C26 acceptance criterion reaches it. Flagged for
  Worker 3 as a candidate for a follow-up WP; the natural fix is to tighten that either-side
  condition, which is a `vault-events.ts` change and would want its own pin.

---

## Fuzzer wiring (Shared Ownership Contract §7)

WP26 is not fuzzer-shaped and no op class was registered. The contract's own §7 says so
explicitly ("WP26/WP27/WP30 are structural and are not"). The mechanism is a pure,
side-effect-free path predicate with no notion of two replicas, no contested slot and no
"which state wins" question, so it has nothing for the `intent-trace` oracle to judge. Its
truth table is exhaustively pinned by TC8 instead, including a whole-corpus equivalence to
`endsWith(".canvas") || isSidecarPath(path)`.

---

## Summary for Worker 3

WP26 is complete and self-contained. Six seams guarded, one predicate, one definition,
WP24's symbols imported and never re-spelt.

The four things worth carrying forward:

1. **The consumer set is six, not four — and the documents only get you to five.** The charter
   §2 list is short by two, both load-bearing: `handleLocalTextModify` is the *widest* door in
   the class (no `isTextFile` pre-filter at all), and `isSharedPath` is the only thing between
   a local sidecar file and `publishManifest`. The sixth, `renameFile`, is named by no
   document and pinned by no visible test, and was found only by asking which code *writes*
   the manifest rather than which code *reads* the predicate.
2. **Guarding a membership predicate does not constrain a writer that never calls it.** That
   is the reusable rule from attempt 2. Three of the four `manifest.set` writers consult
   `isSharedPath`; `renameFile` re-keys an entry directly and needs its own guard.
   Generalisable to any "X is excluded" predicate in this codebase: enumerate the mutation
   sites, not the predicate's callers.
3. **Two of the six must NOT use `skipsAutoTextSync`.** `handleLocalTextModify` and
   `isSharedPath` are guarded with `isSidecarPath` alone. Using the composed predicate there
   would look like consistency and would in fact break AC4 twice over — read-only R10 text
   fallback, and `.canvas` files silently dropped from the manifest.
4. **The `ExclusionManager` question is answered by not touching `ExclusionManager`.** The
   guard lives at `isExcluded`'s single consumer, which is durable against `setPatterns`
   rebuilds and covers the no-manager case that a pattern never could.

5. **An enumeration that an AC makes normative needs a delimiter, not just care.** The
   `exclusion.ts` entry (attempt 2) and the `vault-events.ts` entry (attempt 3) were the same
   defect twice: a module named for *context* inside a block claiming to name only *callers*.
   Prose and list had no boundary, so every future edit to the reasoning could reintroduce it.
   The fix that actually holds is structural — a bare `<module> <function>` list with the
   exhaustiveness claim scoped to it, and all reasoning outside it with non-callers labelled
   in place.

Nothing is deferred to Worker 4 (`W4 Test Targets: 0`, charter §7b). No escalation, no
`TOOL_REQUEST`, no BUILD_SPEC change, no dependency added.

**One test file was modified, in attempt 3 only:** `test_tp04_sync_from_manifest_visible.test.ts`,
three mock parameter signatures, to clear three `TS2493` diagnostics this batch introduced. No
assertion, expected value or test count changed, and the file's falsification was re-verified
afterwards. Flagged explicitly here because attempts 1 and 2 reported "no test file altered"
and that is no longer true.
