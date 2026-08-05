# Implementation Report — WP83: the raw-content door onto a shared `.canvas`

**Charter:** `TaskCharter_WP83_RawContentDoorOntoSharedCanvas.md` · **Status:** `DONE`, all 4 ACs met
**Baseline commit:** `b874d39` · **Branch:** `fix-bugs-and-raceconditions` · **Batch:** B26, autonomous mode

---

## 0. THE DEFECT IS A RAW-BYTES DOOR. IT IS NOT A SECOND `Y.Text`.

Stated first and in full, because a wrong version of it has already propagated through this
run's briefs.

`FileOpsManager.onFileCreate` read the whole file and pushed it as
**`{ type: "create", path, content }`** over the control channel, for **every role**, with no
`skipsAutoTextSync` guard. The receiver applies that frame with:

```ts
files/file-ops.ts:184     for (const path of paths) this.mutePathEvents(path);
files/file-ops.ts:194       await this.vault.modify(exists, op.content);      // file exists
files/file-ops.ts:203       await this.vault.create(op.path, op.content);     // file absent
```

So for a path `CanvasSync` owns this is a **raw, unmerged, last-writer-wins overwrite**, and the
**mute taken at `:184`** means the resulting vault `modify` never reaches `handleLocalModify`
(`vault-events.ts:236-247`) — **the bytes land on disk and the doc is never told.** No CRDT is
created by this path and no second `Y.Text` is installed anywhere. The two-owner corruption the
ownership state machine exists to prevent is *character-level interleaving*; this is *wholesale
replacement*, and only this one leaves the doc still believing the old content.

**Measured live, both directions, in 1.0 s** (§2). The Dispatcher's "under three seconds" is
confirmed and was, if anything, generous.

### And it is why `[07]` could not fail

The live RED run measured the mechanism directly and the chain is exact:

| t | what happened |
|---|---|
| +1.0 s | the door delivered the host's `.canvas` **byte-for-byte** onto the guest |
| +n s | the guest's mirror pass ran, saw `localFileExists === true`, and answered `skip-local-file` — **correctly** |
| — | `CANVAS MIRROR: role=guest considered=8→9 … materialised=0 skipped(local-file)=8→9` |
| — | **zero** `CANVAS WRITER: <path> owner=CanvasPersistence attached` lines for that path |

The file was on the guest. Nothing had merged, no writer had attached, and the mirror had
deliberately declined. **A file-existence assertion cannot tell those two mechanisms apart**, which
is the whole of `[07]`'s PASS / PASS / FAIL / PASS with no correlation to the bundle.

---

## 1. What changed

| File | Change | Lines |
|---|---|---|
| `plugin/src/files/file-ops.ts` | import `skipsAutoTextSync`; guard the create-content emission | **+32 / −0** |
| `plugin/src/utils.ts` | the contract comment only — predicate body byte-unchanged | **+50 / −2** |
| `plugin/src/__tests__/v2/wp83/` | 3 suites + 1 shared derivation helper (new) | +32 tests |

`git diff --stat` over the two production files: **80 insertions, 2 deletions.** The two deleted
lines are the old block-A heading (§3). **`file-ops.ts` has zero deletions**, which is the proof
that `onFileModify`, `onFileDelete`, `onFileRename`, `sendFileContent`, `sendChunked` and
`applyRemoteOpInner` are byte-unchanged.

### The guard (`files/file-ops.ts:414`)

```ts
    if (!(file instanceof TFile)) {
      this.emitOp({ type: "folder-create", path: wirePath });
      return;
    }
    // …30 lines of contract comment…
    if (skipsAutoTextSync(wirePath)) return;
```

It sits **after** the folder branch and **before** the read. Three things follow, and each is a
row in the headless suite:

- the **folder** arm still runs, including for a folder whose name ends in `.canvas`;
- the file is **never read** — the refusal is of the content push, not of a payload already built;
- it is the **shared predicate, imported**, so the sidecar clause is covered by the same line.
  `files/file-ops.ts` contains no `endsWith(".canvas")` of its own, and AC3 pins that as a census.

---

## 2. AC1 — a shared `.canvas` never leaves this peer as raw content · **MET**

### 2a. Live, two Obsidian instances — RED → GREEN

Rig: `H:\tmp\liveshare_wp83_e2e.py`, ports **39431 (A) / 39432 (B)**, `POST /command`.
Idempotent: every artefact is namespaced `wp83-<RUN>-*`, both vaults swept at preflight and at
teardown. `canvas.simulateEdit` was **not** called — every edit is a file written on disk.

| | RED (run `052209`) | GREEN (run `053931`) |
|---|---|---|
| bundle | `b874d39`, unmodified, built and installed for this measurement | `b874d39` **+ WP83's two files only**, built in a detached worktree, sha256 `1a4c161e…`, size 4 034 142, **read back out of both vaults and verified** |
| vault A **resumed as** | `03:20:55.402Z resuming as guest` → role `guest` | `03:38:45.500Z resuming as host` → role `host` |
| vault B **resumed as** | `03:21:09.891Z resuming as host` → role `host` | `03:39:01.071Z resuming as guest` → role `guest` |
| both `connected` | `true` / `true` (asserted, see 2c) | `true` / `true` (asserted) |
| **result** | **10 passed, 4 failed, 0 skipped** | **13 passed, 0 failed, 0 skipped** |

**The roles are OPPOSITE between the two runs.** S37's host lottery is therefore not a confound
here — it is a free role-symmetry control.

### 2b. `[P1]` GUEST → HOST: the door is the only route, so the measurement is unambiguous

WP79's mirror publishes host → guest. In the guest → host direction the raw-bytes door is the
**only** way a `.canvas` travels, so an arrival *is* the door and its absence *is* the door's
closure.

```
RED    P1 CONTROL  an ordinary .md created on the guest reached the host     — arrived after 0.0s
RED >>>FAIL  the shared `.canvas` did NOT cross the file-op channel
             host file exists=True (after 1.0s) · canvas.file exists=True
             byte-identical to the guest's bytes=True
RED    P1 MECHANISM  the host's copy is BYTE-IDENTICAL — guest=338B host=338B

GREEN  P1 CONTROL  an ordinary .md created on the guest reached the host     — arrived after 0.0s
GREEN  PASS  the shared `.canvas` did NOT cross the file-op channel
             host file exists=False (after 45.0s) · canvas.file exists=False
```

**The positive control is in the same run, on the same peer, at the same second** — the `.md`
arrives in both runs, so "the canvas did not arrive" is not a statement about a dead channel, a
wrong folder, or a peer that never joined. The canvas body is serialised with a **7-space indent**,
which no serialiser in the plugin produces, so `byte-identical=True` under RED is a signature of
`vault.create(op.path, op.content)` and of nothing else.

### 2c. The vacuity that would have made this run worthless, and the guard against it

`session.info`'s `connected` is exactly `muxConnected && controlConnected`
(`e2e-control.ts:1266`), and that same conjunction is what `updateOnlineState` (`main.ts:192-195`)
hands to `FileOpsManager.setOnline`. **A peer reporting `connected: false` has `isOnline === false`
and enqueues every file op into the `OfflineQueue` instead of sending it** (`file-ops.ts:103-110`).

Measured: immediately after the first install, vault A was `role: host, connected: false` — the
WP82 latch, chartered and not implemented. **On that peer, "the `.canvas` did not cross" would have
been true with or without the guard.** `H:\tmp\liveshare_wp83_relaunch.py` exists solely to restart
until both peers report `connected: true`, and `[P0]` asserts it before anything is created. It
took two attempts on the RED run.

### 2d. Headless, deterministic — RED at `b874d39`, GREEN on the fix

Run in a **detached worktree** at `b874d39` (rule 14 — no `stash`, `checkout --` or `restore` was
used on any path this batch did not create):

```
BASELINE  Test Files  3 failed (3)     Tests  12 failed | 20 passed (32)
FIXED     Test Files  3 passed (3)     Tests  32 passed (32)
```

The AC1 rows that were RED, verbatim:

```
AssertionError: onFileCreate emitted an op for a `.canvas`. The `create` op carries the whole file…
AssertionError: the canvas was read off disk before the refusal…
AssertionError: a sidecar file was pushed as shared content…
```

**Carried up — the charter was wrong about one row, in our favour.** C83 AC1 says a sidecar path
"emits nothing, as it must have already." It did **not**. At this seam nothing was guarded at all,
so the sidecar row was RED too. Sidecar paths live under `.obsidian/`, which `isSharedPath` excludes
and which fires no vault event, so the door was unreachable *in practice* — but the seam itself had
no guard of any kind, and the one line added closes both clauses at once.

---

## 3. AC2 — the contract comment states only what a test can hold · **MET**

### 3a. The three changes, and only these three

**(a) The missing row, plus WP83's own.** `files/background-sync.ts setActiveFile` and
`files/file-ops.ts onFileCreate` are now rows.

**(b) The heading is demoted from a claim about the world to a claim about the tree.**

Removed (the only two lines deleted from `utils.ts`):

```
 * Every caller that would AUTOMATICALLY install or consume a bare-path
 * `Y.Text` must consult this predicate:
```

Replaced by:

```
 * PRODUCTION CALL SITES OF THIS PREDICATE (WP83 AC2). The block below
 * enumerates every call to `skipsAutoTextSync` in `plugin/src/`, other than this
 * definition, as `<module>  <function>`. That is a claim about THE TREE, and
 * WP83 AC2's coherence derivation walks the tree and fails when the two
 * disagree. The block is delimited by the two `==== ... BLOCK` rules below
 * because that derivation reads it: the delimiters are load-bearing, not
 * decoration, and a row moved outside them stops being checked. …
 *
 * It is deliberately NOT the claim this heading used to make — "every caller
 * that would AUTOMATICALLY install or consume a bare-path `Y.Text` must consult
 * this predicate". That was a claim about the world written in the grammar of a
 * list. No test can hold it, it was quoted by several work packages as an
 * authoritative map, and it was already one row stale on the day it was quoted:
 * `background-sync.ts setActiveFile` has been a guarded consumer, with a test
 * naming it, since WP27 — and the list did not have it.
```

**(c) An explicitly non-exhaustive note naming the other mechanism**, with
`files/file-ops.ts onFileCreate` as its first row:

```
 * THIS COMMENT IS NOT A DOOR CENSUS, and no enumeration of this predicate's
 * callers can ever be one. A derivation over CONSUMERS finds only sites that
 * already consult the predicate; a door is by definition a site that does not.
 * The block above is a coherence check between the comment and the tree, and it
 * buys exactly that and nothing more.
 *
 * So, explicitly NON-EXHAUSTIVE and not derivable from anything: the mechanisms
 * OTHER than a bare-path `Y.Text` by which a `.canvas` has been observed to
 * reach a peer. …
 *
 *   files/file-ops.ts  onFileCreate  the file-op CONTENT channel. The whole file
 *                                    as `{type:"create", path, content}`,
 *                                    applied by the receiver with `vault.modify`
 *                                    / `vault.create` under a path mute — a raw,
 *                                    unmerged, last-writer-wins overwrite of a
 *                                    path `CanvasSync` owns, invisible to the
 *                                    doc. Guarded by this predicate since WP83;
 *                                    listed here because closing one door is not
 *                                    evidence that there is no other.
 *
 * If you need to know how a `.canvas` can travel, measure the tree. Do not read
 * this comment and conclude.
```

### 3b. BLOCK B AND `test_tp09` ARE BYTE-UNCHANGED — proven, not asserted

`git diff -U0 plugin/src/utils.ts` produces four hunks, the last of which is
`@@ -267,0 +287,27 @@`. **Every change is at or before old line 267.** Block B — the
`isSidecarPath` enumeration, its four rows, and the *"exhaustive in both directions"* sentence —
begins after that and is not touched by a single hunk.
`__tests__/v2/wp26/test_tp09_one_predicate_one_definition_visible.test.ts` does not appear in
`git status` at all.

**The charter's ruling is upheld and this report does not repeat the Dispatcher's earlier framing.**
The *"exhaustive in both directions"* sentence is **TRUE**. It governs block B, which is 4-for-4
against the tree and already derived from it by `test_tp09`. It was mis-attributed to block A. A
report recording *"the docstring was false"* would have replaced one wrong claim with another.

### 3c. The derivation, and its RED — measured under the *most generous* reading

The landed test reads only the delimited block. At baseline there are no delimiters, so the block is
empty and **every** call site is reported — a true RED, but not the specific claim the charter
makes. A separate probe (`H:\tmp\wp83_ac2_baseline_probe.mjs`) therefore reads the **whole**
pre-WP83 comment, the strongest reading it can possibly get:

```
########## BASELINE b874d39 (pre-WP83) ##########
PATTERN:  /\bskipsAutoTextSync\s*\(/g over comment-stripped production .ts
derived call sites (6):
   editor/collab.ts::activateForFile
   files/background-sync.ts::onFileAdded
   files/background-sync.ts::onFileRenamed
   files/background-sync.ts::setActiveFile
   files/background-sync.ts::startAll
   files/manifest.ts::syncFromManifest

  call sites whose MODULE the comment does not name: []
  call sites whose FUNCTION the comment does not name: [ 'files/background-sync.ts::setActiveFile' ]
  positive control - the comment does name `onFileAdded`: true
  negative control - it does not name a fabricated name: false

########## WORKING TREE (post-WP83) ##########
derived call sites (7):   … + files/file-ops.ts::onFileCreate
  call sites whose MODULE the comment does not name: []
  call sites whose FUNCTION the comment does not name: []
```

Two things are measured there, not argued:

1. **The charter's claim is exact.** Under the most generous reading the pre-WP83 comment fails on
   exactly one row: `files/background-sync.ts::setActiveFile`.
2. **The named vacuity is real.** At **module** granularity the stale comment was **GREEN, 0 missing
   out of 6.** A module-granularity derivation would have proven nothing. That is why the landed
   test derives at function granularity and reads only the delimited block — `syncFromManifest`
   also appears as a row of block B, so a whole-comment `includes` would go green on a row
   documenting a *different* predicate.

The derivation's own positive controls are landed tests, not prose: it reddens on a synthetic module
carrying a call site the block does not name; it reports **zero** sites for a module that mentions
the predicate only in comments (the strip is real); and `enclosingFunction` is exercised against a
class method, a top-level function and an arrow const.

**One measured bug in the derivation, found and fixed before it could lie.** The class-member
pattern was first written `(?:async\s+)?\*?\s*(name)\(` — the `\s*` swallowed further indentation,
so `      unobserve();` at six spaces resolved as a class member and
`background-sync.ts::onFileRenamed` came back as `::unobserve`. Tightened to `(?:\*\s*)?`. It is
recorded in the helper, at the line, because a mis-attributing derivation is a census that lies
quietly.

---

## 4. AC3 — the invariant as a property, with a pinned residue · **MET**

`test_wp83_tp03_content_emission_census_visible.test.ts`. Two pins that fail on different things.

**PIN 1 — the census.** Every call to an emission seam (`emitOp`, `sendOp`, `sendFileContent`,
`sendChunked`) in comment-stripped production source, keyed `<module>::<fn>::<callee>::<opType>`.
`toEqual` over the enumerated set — **16 distinct keys** — plus the **raw occurrence count pinned as
the number 17** (two arms of one ternary share a key, so only the count moves when a third is added;
a `>=` would have admitted it silently).

```
files/file-ops.ts::applyRemoteOpInner::sendOp::chunk-data      files/file-ops.ts::onFileRename::emitOp::rename
files/file-ops.ts::applyRemoteOpInner::sendOp::chunk-end       files/file-ops.ts::sendChunked::emitOp::chunk-data
files/file-ops.ts::applyRemoteOpInner::sendOp::chunk-resume    files/file-ops.ts::sendChunked::emitOp::chunk-end
files/file-ops.ts::emitOp::sendOp::-                           files/file-ops.ts::sendChunked::emitOp::chunk-start
files/file-ops.ts::onFileCreate::emitOp::folder-create         files/file-ops.ts::sendFileContent::emitOp::create
files/file-ops.ts::onFileCreate::sendFileContent::-            files/file-ops.ts::sendFileContent::sendChunked::-
files/file-ops.ts::onFileDelete::emitOp::delete                files/file-ops.ts::setOnline::sendOp::-
files/file-ops.ts::onFileModify::emitOp::modify
files/file-ops.ts::onFileModify::sendChunked::-
```

**PIN 2 — the unguarded residue, 7 members, each with a written reason.** Coverage is **structural
and by fixpoint**, never an allowlist of module names: a function is covered when it consults the
predicate, or when it has in-module callers and **every** one of them is covered.

| covered | why |
|---|---|
| `onFileCreate` | consults the predicate (AC1's guard) |
| `sendFileContent` | private; its only in-module caller is `onFileCreate`, which is covered |

| residue | reason (abridged; in full in the test file) |
|---|---|
| `applyRemoteOpInner` | the `chunk-resume` responder — re-sends chunks of an already-authorised transfer keyed by `transferId`, originates nothing |
| `emitOp` | the shared exit; forwards an op another function built and cannot see a path class |
| `onFileDelete` | path-only, no content. C83 §2 out of scope, S43 |
| `onFileModify` | unreachable for a `.canvas` twice over — the router returns first, and `if (!binary) return;` |
| `onFileRename` | path-only, no content. C83 §2 out of scope, S43 |
| `sendChunked` | reached only from `sendFileContent` (covered) and `onFileModify` (binary only). C83 §2 forbids a second private guard here in as many words |
| `setOnline` | the offline-queue drain; replays ops that passed every gate when enqueued |

**The two observables the charter demands:**

- **Removing AC1's guard reddens PIN 2 on its own**, distinct from AC1's behavioural rows. Measured
  at baseline: `expected [ …(9) ] to deeply equal [ …(7) ]` and
  `expected [ …(9) ] to not include 'files/file-ops.ts::onFileCreate'` — `onFileCreate` and
  `sendFileContent` both fall out of coverage.
- **A new unguarded content-emitting site reddens PIN 1 naming it**, and a new emitting function
  reddens PIN 2 naming it. Both are exercised against synthetic modules, including the two-hop case
  where adding a second unguarded caller removes a helper's coverage.

**The positive control, which is the WP82 diagnostic failure in test form.** Before any absence is
reported, the suite asserts that **each seam name it keys on is still a real declaration in
`files/file-ops.ts`** — so renaming `emitOp` fails the test loudly instead of silently emptying the
census. It further shows the detector finds a known-present emission (the `create` op carrying the
whole file, with `content` in its arguments) and shows the same detector returning **zero** on a
synthetic module using a different method name — i.e. it can match, and it can decline to match.

**A census recorded, not repaired.** Three production modules already spell `.canvas` privately, and
they are **not** WP83's to change: `files/canvas-mirror.ts` (`:144`), `files/vault-events.ts`
(`:57`, `:259`), and `utils.ts` (the one sanctioned spelling). They are pinned with `toEqual`, so a
**fourth** — in `file-ops.ts` or anywhere else — reddens by name. `files/file-ops.ts` is asserted
*not* to be among them, and asserted to import the shared predicate from `../utils`.

---

## 5. AC4 — the sanctioned path still delivers a mid-session canvas, and the evidence names the mechanism · **MET**

No code. The precondition is **asserted, not assumed**: `[P0]` requires both peers to report a live
session **before** anything is created, and it passed in both runs. The canvas is created **after**
that, mid-session, by writing the file on disk on the host.

**GREEN — the guest's own log, verbatim:**

```
2026-08-05T03:40:17.764Z [INFO] [canvas] CANVAS WRITER: _liveshare-test/wp83-053931-h2g.canvas
                                owner=CanvasPersistence attached (coldOpen=doc-wins)
```

**GREEN — the guest's mirror receipts across the window** (`role, considered, published,
materialised, skipped(local-file)`):

```
('guest', '7', '0', '0', '7')      ← before the create
('guest', '8', '0', '0', '7')      ← the new path is considered, not yet materialisable
('guest', '8', '0', '1', '7')      ← materialised=1, and skipped(local-file) did NOT move
```

**GREEN — the host arm, unchanged, S21 not widened:**

```
('host', '7', '7', '0', '0')   ('host', '8', '8', '0', '0')   ('host', '8', '8', '0', '0')
```

`materialised=0` on every host row. **The host publishes and writes nothing.**

**RED, the same measurement on the unrepaired bundle:**

```
('guest', '8', '0', '0', '8')   ('guest', '9', '0', '0', '9')   ('guest', '9', '0', '0', '9')
CANVAS WRITER … attached lines matching this path: 0
```

`materialised=0`, and `skipped(local-file)` climbed **8 → 9** — the door had already put the file
there, so the mirror declined. That is the same file on the guest by a different mechanism, and it
is exactly why file existence may not be this AC's oracle.

**The third discriminator, independent of any log string:** the guest's bytes.

```
RED    byte-identical to the host's on-disk bytes = True    guest=338B  host=338B
GREEN  byte-identical to the host's on-disk bytes = False   guest=169B  host=338B
```

169 B is `CanvasPersistence` re-serialising from the doc. 338 B is the host's 7-space-indent file
copied verbatim. **The receipt is read from the guest, never from the host** — a host receipt would
read `materialised=0` and would have been reported as a failure of the guest.

---

## 6. Gates

| gate | measured | command actually run |
|---|---|---|
| `npm run build` — isolated worktree (`b874d39` + WP83 only) | **exit 0** | `npm run build` in `H:\tmp\wp83-green\plugin` |
| `npm run build` — shared repo (also carries a sibling batch's WIP) | **exit 0** | `npm run build` in `plugin/` |
| `npm test` — shared repo | **321 files, 2151 tests, 0 failed** | `npm test` in `plugin/` |
| `npm test` — isolated worktree (`b874d39` + WP83 only) | **321 files, 2151 tests, 0 failed** | `npx vitest run` in `H:\tmp\wp83-green\plugin` |
| executed test count **before** WP83 | **318 files, 2119 tests** | derived: 2151 − 32 added. Independently, the `b874d39` worktree with the WP83 suites removed read **316 passed / 318 files, 2104 tests**, with 2 files unable to load for a *worktree-local* missing `server/node_modules` (`Cannot find package 'cors'`); 2104 + 15 = 2119 |
| WP83 headless suites | **RED 12 failed / 20 passed (32) → GREEN 32 passed (32)** | `npx vitest run src/__tests__/v2/wp83` |
| WP83 live E2E | **RED 10 pass / 4 fail → GREEN 13 pass / 0 fail / 0 skip** | `python H:\tmp\liveshare_wp83_e2e.py --settle=45` |
| canvas E2E suite (`liveshare_e2e.py`) | **13/18** — a measurement, **not** asserted as 19/19 | `python H:\tmp\liveshare_e2e.py` |

**No existing test was deleted, weakened, retitled, skipped or amended. No §7 licence of any class
was taken.** `git diff --stat` touches exactly two production files and adds one test directory.

### The two named `w4-canvas-integrity` hazards: **UNAFFECTED. No escalation.**

`__tests__/w4-canvas-integrity.test.ts:1673-1678` (`setActiveFile`) and `:1756-1761`
(`activateForFile`) — the `expect(guardConsults…).toEqual([true])` consult-array assertions — are
**green**, in a full-suite run with 0 failures. Neither test drives `FileOpsManager.onFileCreate`, so
WP83's new consultation never enters their scope. The file is untouched.

### The canvas E2E reading, and why its 5 failures are not attributable to WP83

13/18 is the same reading the Dispatcher records for the current, WP82-latch-affected tree. The five
failures are all **modify-path propagation on the pre-existing diverged `smoke.canvas`**
(`[01]` move, `[02]` side-less edge, `[03]` empty card, `[04]` reverse direction, `[05]`
convergence). WP83's diff is **+32 / −0 in `file-ops.ts`, entirely inside `onFileCreate` between the
folder branch and the send queue** — it contains no deletion and touches no modify path, so it
cannot reach those scenarios. **This is a structural argument, and it is labelled as one:** the
suite was not run on the RED bundle, so "unchanged at 13/18" is inference from the diff plus the
Dispatcher's record, not a before/after measurement I took.

**`[07]` PASSED on the repaired bundle — and this is the first time that pass has meant anything.**
The guest received the canvas through the mirror, with a writer attached, rather than through the
door.

---

## 7. Data safety and rig discipline

- `data.json` — **never read for any value, never printed, never logged, never fixtured.** The only
  key any script of this batch writes is `e2eControlPort`, which the rig owns, exactly as
  `liveshare_e2e_install.py` already does.
- The **relay was not contacted at all** — not even `GET /healthz`.
- `canvas.simulateEdit` was **never called.** Every edit is a file written on disk.
- `sharedFolder` was left at `_liveshare-test` in both vaults and never touched.
- The shared folder was **left as found**: `[P3]` removes every `wp83-*` artefact from both vaults,
  and both runs reported the sweep (`removed 8`, `removed 7`). Preflight sweeps too, so the suite is
  idempotent.
- **Rule 14 honoured.** No `git checkout --`, `git restore` or `git stash` on any path. Parked
  baselines are two **detached worktrees**, `H:\tmp\wp83-baseline` and `H:\tmp\wp83-green`, both at
  `b874d39`. `git status` was re-read immediately before each commit.
- **Rule 15 honoured.** Every absence reported here names its pattern and carries a control:
  `/\bskipsAutoTextSync\s*\(/g` (positive control: it finds `onFileAdded`; negative control: it does
  not find a fabricated name); the emission-seam detector (positive control: it finds the `create`
  op; and each seam name is asserted to still be a declaration in the module); and the live absence
  in `[P1]` (positive control: the `.md` arrived in the same second).
- No `server/**` edit. `useCanvasBinding` not flipped. Plugin version not bumped.
  `plugin/manifest.json` untouched. `BUILD_SPEC_CanvasV2.md` untouched.
  `WORKFLOW_ANALYSIS.md` left untracked and unstaged.

---

## 8. Carried up — recorded, not repaired

**S46 — `plugin/main.js` is a shared build artefact and an install can silently ship another
batch's bundle. Measured, 05:37.** WP83 copied its own 4 034 142-byte bundle to `plugin/main.js` and
ran `liveshare_e2e_install.py`; the installer reported `bundle: 4 040 223 bytes` and shipped that
instead — a sibling had rebuilt the file in the gap. **Nothing failed and nothing warned**, and the
live run that followed would have been attributed to WP83 while executing someone else's code. This
is rule 14's lesson one level down, at the artefact instead of the source.
Mitigated for this batch by `H:\tmp\liveshare_wp83_install_verified.py`, which copies and installs in
one step and then reads the bytes back **out of both vaults** and requires the sha256 to match, both
before and after the relaunch. **The shared installer still has the hole. Unowned.**

**S47 — a peer with `connected: false` cannot send a single file op, and no rig surface says so.**
`connected` is `muxConnected && controlConnected` (`e2e-control.ts:1266`), the same conjunction
`updateOnlineState` (`main.ts:192-195`) hands to `setOnline`, so the WP82 latch does not merely
mislabel a role — it routes **every** file op into an unbounded `OfflineQueue`. Any E2E scenario
that reads an absence on such a peer is a green that cannot fail. Observed on vault A immediately
after an install. **WP82 owns the latch; nothing owns the fact that the rig will happily measure
through it.** `H:\tmp\liveshare_wp83_relaunch.py` is the workaround, not the fix.

**S48 — C83 AC1's sidecar row was wrong in the charter's favour.** The charter says a sidecar path
"emits nothing, as it must have already." It did not: at this seam nothing was guarded at all and
the sidecar row was RED alongside the `.canvas` row. Unreachable in practice (`.obsidian/` is
excluded by `isSharedPath` and fires no vault event), so no defect follows — but the charter's
parenthetical was an assumption stated as a measurement, and it is recorded as such.

**S43 confirmed and unchanged.** `onFileDelete` and `onFileRename` still carry a shared `.canvas`
path across the file-op channel and the delete arm still trashes a peer's `.canvas` outside the
CRDT and outside the tombstone design. Carrying **no content**, they are correctly out of WP83's
scope, and they are now *pinned by name* in AC3's residue with that reason written down — so
annexing them later is a deliberate act against a failing test rather than a drift. **Still unowned.**

**S42, S44, S45 — unchanged, not touched by this WP.** In particular S45: `canvas.open` subscribes
directly and permanently disables the writer-attach seam. WP83's live evidence **never calls
`canvas.open`**, which is why the guest could still be given a writer at `03:40:17.764Z`. WP85 owns it.

---

## 9. Artefacts

| path | what |
|---|---|
| `plugin/src/files/file-ops.ts` | the guard + the import |
| `plugin/src/utils.ts` | the contract comment |
| `plugin/src/__tests__/v2/wp83/wp83-source-derivation.ts` | shared tree derivation (call sites, emission census, coverage fixpoint) |
| `plugin/src/__tests__/v2/wp83/test_wp83_tp01_no_raw_canvas_content_push_visible.test.ts` | AC1 behaviour, 6 tests |
| `plugin/src/__tests__/v2/wp83/test_wp83_tp02_callsite_coherence_visible.test.ts` | AC2 coherence, 12 tests |
| `plugin/src/__tests__/v2/wp83/test_wp83_tp03_content_emission_census_visible.test.ts` | AC3 census, 14 tests |
| `H:\tmp\liveshare_wp83_e2e.py` | the live suite, idempotent, self-cleaning |
| `H:\tmp\liveshare_wp83_relaunch.py` | restart until both peers are genuinely online (S47 guard) |
| `H:\tmp\liveshare_wp83_install_verified.py` | copy + install + read-back verification (S46 guard) |
| `H:\tmp\wp83_ac2_baseline_probe.mjs` | the whole-comment AC2 baseline measurement |
| `H:\tmp\wp83-baseline`, `H:\tmp\wp83-green` | detached worktrees at `b874d39` (rule 14) |
