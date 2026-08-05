# Implementation Report — WP79: a shared folder mirrors completely, canvases included

**Batch:** B19 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** `TaskCharter_WP79_SharedCanvasMirrorMaterialisation.md` (5 ACs)

---

## 0. Summary

| | |
|---|---|
| **Reproduced first?** | **Yes.** Run `022022`, on the unmodified tree: **0 of 3** canvases reached the guest. |
| **Fixed** | Yes. Run `024526`, same rig, same scenario: **3 of 3**, content intact, the guest's own diverged canvas byte-unchanged. |
| **AC status** | AC1 ✅ · AC2 ✅ · AC3 ✅ · AC4 ✅ · AC5 ✅ |
| **Unit suite** | **1976 / 1976 pass, 306 files** (was 1865 / 304). 111 new tests, mutation-checked. |
| **E2E — WP79 (new)** | **18 passed, 0 failed, 0 skipped** (was 11 / 4 / 0 on the unfixed tree) |
| **E2E — canvas suite** | **19 / 19** — unchanged from the pre-WP79 baseline |
| **E2E — data-loss suite** | **12 passed, 0 failed, 1 skipped** — same pass count as its baseline; the skip is the suite's own role-lottery skip in S2, and S2's secondary claim passed |
| **§7 licences taken** | **One, and it must be ratified.** See §7. It is an amendment to one assertion in one inherited test, forced by S22. Nothing else was deleted, weakened, retitled or skipped. |

**Method note.** The charter (§5) specifies a headless-only verification and forbids naming a live
Obsidian instance in this report. The Dispatcher's B19 brief supersedes that: *"validation is against
the two live Obsidian instances … reproduce first … RED before, GREEN after."* Both were done. The
headless suite is complete and is the primary regression net; the live rig is the primary evidence
that the product does the thing. Where the two conflict, this report follows the newer instruction
and says so here rather than silently.

---

## 1. S22 — re-measured, and it is worse than "dead"

The charter recorded S22 as *"the manifest-driven canvas loop at `main.ts:858-877` has never run."*
The data-loss batch moved that code, so it was re-measured from scratch against the current tree.

**CONFIRMED, and the line numbers have moved to `main.ts:1013-1032`.**

| measured | value |
|---|---|
| the loop | `main.ts:1013` `const entries = this.manifestManager.getEntries();` inside `connectSync()` (`main.ts:890`) |
| `connectSync()` awaited before `manifestManager.connect(...)` | `resumeSession` `:535`/`:536` · `startSession` `:769`/`:770` · `joinSession` `:800`/`:801` · `joinWithInvite` `:835`/`:836` — **all four** |
| what assigns the manifest | `ManifestManager.connect` (`manifest.ts:137-141`) → `this.manifest = this.docHandle.doc.getMap("files")` |
| what the loop reads | `getEntries()` (`manifest.ts:537-540`) → `if (!this.manifest) return new Map();` |
| reset | `cleanupSession()` → `manifestManager.destroy()` → `this.manifest = null` (`manifest.ts:585`) |

**The loop iterated zero entries, in every session, for both roles, always.** It was not racy; it had
never run once.

**One thing S22 as written did not say, and it changes the disposition:** the loop drove
`subscribeCanvasWithHandover`, whose unowned branch installs the R10 raw-text fallback
(`vault-events.ts:113-114`). Over a whole shared folder that is a mass-install of the second CRDT the
`.canvas` skips exist to prevent. So the loop was not merely dead — reviving it by moving it after
`manifestManager.connect(...)`, the "obvious" repair the charter's §5 warns about, would have been
*actively destructive*. **It was removed, not moved.** Its replacement is the mirror pass, armed at
six sites where the manifest is actually populated.

**S22's downstream consequence stands:** no production evidence existed for anything below that loop.
The host's guid minting, the writer attach and `coldOpen`'s doc-wins branch had only ever been
reached through the on-open path. As of this WP they are reached from the manifest for the first
time, and §4 below is the first production trace of that.

---

## 2. A second finding, unowned, that the reproduction depended on

Scenario `[07]` in `H:\tmp\liveshare_e2e.py` was flagged flaky. **It is not flaky — it measures a
different door, and that door is real.**

`FileOpsManager.onFileCreate` (`plugin/src/files/file-ops.ts:375-405`) reads a newly created shared
file and pushes its **content over the control channel** to peers, for **every role**, with **no
`skipsAutoTextSync` guard**. Measured live: a `.canvas` written into the host's shared folder
mid-session appears in the guest's vault **within 3 seconds**, with LF line endings (a plugin write),
while `canvas.state` reports no records on either side — i.e. `CanvasSync` was not involved at all.

Consequences:

1. **`[07]` can pass without WP79 being fixed**, because it creates its canvas mid-session. It is the
   file-ops push it measures, not the mirror. Its apparent flakiness is the push needing the peer
   connected at that instant.
2. **The defect's real precondition is "present before the session starts"** — a canvas on disk while
   the plugin is not running fires no vault event, so no push happens. That is what the new suite
   creates, by writing the fixtures while Obsidian is down.
3. This is a **fifth door** onto a canvas path, not covered by the four the `skipsAutoTextSync`
   docstring enumerates. It is a one-shot content copy rather than a CRDT, so it is not the
   edge-endpoint-destroying merge — but it *does* put a canvas on disk without an identity, without a
   doc and without the single writer. **Recorded as S25 (§8). Not fixed here; out of WP79's scope.**

---

## 3. What was implemented

Two new files in `plugin/src/files/`, plus wiring in `main.ts`. Nothing else in `plugin/src/`
changed except the one test assertion in §7.

### 3.1 `files/canvas-mirror-decision.ts` — the pure core (AC1)

Zero imports. No Obsidian, no filesystem, no clock, no Yjs — the precedent is
`files/canvas-seed-decision.ts`, stated in its header.

```
decideCanvasMirror({ role, localFileExists, identityResolves, docHasRecords }) -> MirrorVerdict
```

Closed verdict set:

| verdict | meaning |
|---|---|
| `publish` | HOST: this client holds the file, so it is the one that can give the path a published identity. **A subscribe, never a write.** |
| `materialise` | GUEST: no local file, an identity resolves, the doc holds records. The only verdict that ends in a file. |
| `skip-local-file` | a `.canvas` already exists there. No write of any kind, not even a byte-identical one. |
| `skip-no-source` | no resolvable identity (the guest never mints), or a doc with no records. |

Fail-closed, spelled `=== true` / `!== false`, never truthiness. `localFileExists` is read as
`!== false`: a probe that could not answer is treated as *"the user has a file there"*, because the
cost of being wrong that way is a skipped mirror and the cost of being wrong the other way is a
destroyed board.

`admitsCanvasMirror(pre)` is **derived from `decideCanvasMirror`** rather than restating its rules —
it asks the same function what the answer would be if the doc held records. A path it refuses is
skipped without a `getDoc`, a `waitForSync` or a sidecar attach.

### 3.2 `files/canvas-mirror.ts` — the headless wiring module (AC2–AC5)

`mirrorSharedCanvases(deps)` walks the manifest's `.canvas` entries and returns a **counted receipt**
(`considered / published / materialised / skippedLocalFile / skippedNoSource / failed` + per-path
entries). Sequential, each path individually wrapped, so a failure degrades that canvas alone (I5).

Per path:

1. pre-observe `localFileExists` (through the vault **adapter**) and `guidForPath`
2. `admitsCanvasMirror` → if not, record the verdict and skip **without touching the doc**
3. `canvasSync.subscribe(path, role)` — **DIRECT**, never `subscribeCanvasWithHandover`
4. host → `publish`, and **nothing else**: no writer attach, no cold open, no write
5. guest → **re-measure** the local file and the doc after the subscribe, decide again, and only on
   `materialise` call `attachCanvasWriter`, which is the existing single writer

`CanvasSync` is forwarded as **one injected object** (`CanvasMirrorSync`), which is what keeps
`main.ts` free of any canvas operation of its own — see §7.

### 3.3 `main.ts` — calls only

- the dead loop in `connectSync()` **removed**, with the S22 measurement written into the comment
  that replaces it
- `armCanvasMirrorPass()` — constructs, injects, forwards. **Not awaited** by any caller (a slow
  relay must not hold up the join), and serialised against itself through `canvasMirrorQueue`.
- armed at **six** sites: `startSession`, `resumeSession` (both role arms), `joinSession`,
  `joinWithInvite`, `promoteToHost`, `demoteToGuest`, `reloadFromHost`, **and the manifest-change
  handler**.

Every arming point is placed **after** the pre-existing call order, so nothing moved. That is
deliberate: the previous batch's `[06]` regression came from reordering
`registerManifestChangeHandler`.

**The manifest-change arming is not optional.** The guest's mirror needs a **published guid**, and
only the host can mint one (C27). At a simultaneous start the guest's own pass runs before the host's
guid lands and correctly skips — permanently, if nothing re-asks. The guid arrives as a manifest
entry change, so the decision is re-asked on exactly the event that creates the evidence, in the
precedent of `armStaleReconcileRetry`. **The production trace in §4 shows this firing.**

---

## 4. RED → GREEN, on two live Obsidian instances

New suite: **`H:\tmp\liveshare_wp79_e2e.py`**. Idempotent — per-run ids (`wp79-<RUN>-*`), a sweep of
both vaults before every attempt, and a SKIP recorded as a SKIP and never folded into the pass count.
The fixtures are written **while Obsidian is down**, which is what makes the precondition
"present before the session starts" rather than "created mid-session" (§2).

### 4.1 RED — run `022022`, unmodified tree

```
[W1] THE DEFECT — a canvas present in the shared folder BEFORE the session starts
  attempt: seeding vault B while Obsidian is down
    swept 2 leftover wp79 artefact(s)
    seeded 3 mirror canvas(es) + 1 diverged pair, Obsidian down (0 processes)
  host=B guest=A
  PASS  W1 precondition: host B holds wp79-022022-one.canvas
  PASS  W1 precondition: host B holds wp79-022022-two.canvas
  PASS  W1 precondition: host B holds wp79-022022-three.canvas
  PASS  W1 precondition: the guest's manifest lists wp79-022022-one.canvas
        manifest paths=['…-two.canvas', '…-three.canvas', '…-one.canvas', '…-diverged.canvas']
  PASS  W1 precondition: the guest's manifest lists wp79-022022-two.canvas
  PASS  W1 precondition: the guest's manifest lists wp79-022022-three.canvas
  >>> FAIL  W1: the guest received wp79-022022-one.canvas (it never had it)
  >>> FAIL  W1: the guest received wp79-022022-two.canvas (it never had it)
  >>> FAIL  W1: the guest received wp79-022022-three.canvas (it never had it)
  >>> FAIL  W1: the mirror is COMPLETE — all 3 canvases arrived        0/3

RESULT: 11 passed, 4 failed, 0 skipped   (run 022022)
```

The manifest preconditions passing is what makes this a WP79 verdict and not a plumbing failure: the
guest **had the entries** and still got **none** of the files.

### 4.2 GREEN — run `024526`, corrected bundle, same rig, same scenario

```
  host=A guest=B
  PASS  W1 precondition: host A holds wp79-024526-one.canvas
  PASS  W1 precondition: host A holds wp79-024526-two.canvas
  PASS  W1 precondition: host A holds wp79-024526-three.canvas
  PASS  W1 precondition: the guest's manifest lists wp79-024526-one.canvas
  PASS  W1 precondition: the guest's manifest lists wp79-024526-two.canvas
  PASS  W1 precondition: the guest's manifest lists wp79-024526-three.canvas
  PASS  W1: the guest received wp79-024526-one.canvas (it never had it)
  PASS  W1: wp79-024526-one.canvas arrived with its content intact
        guest={"nodes": [{"id": "m1", …, "text": "mirror one"}, {"id": "m2", …, "text": "mirror two"}], "edges": [{…}]}
  PASS  W1: the guest received wp79-024526-two.canvas (it never had it)
  PASS  W1: wp79-024526-two.canvas arrived with its content intact
  PASS  W1: the guest received wp79-024526-three.canvas (it never had it)
  PASS  W1: wp79-024526-three.canvas arrived with its content intact
  PASS  W1: the mirror is COMPLETE — all 3 canvases arrived            3/3

[W2] CREATE-ONLY — a guest .canvas that DIVERGES from the host's
  PASS  W2 precondition: the guest's copy differed from the host's before the session
  PASS  W2: the guest's diverged canvas still exists
  PASS  W2: its BYTES are unchanged                                    before=381B after=381B

RESULT: 18 passed, 0 failed, 0 skipped   (run 024526)
```

### 4.3 The production receipt — the mechanism, in its own words

From the **guest's** debug log during run `024526` (timestamps UTC; the rig runs at +02:00):

```
00:45:48.056 [INFO] [canvas-mirror] CANVAS MIRROR: role=guest considered=3 published=0 materialised=0 skipped(local-file)=3 skipped(no-source)=0 failed=0
00:49:17.027 [INFO] [canvas-mirror] CANVAS MIRROR: role=guest considered=3 published=0 materialised=0 skipped(local-file)=3 skipped(no-source)=0 failed=0
00:49:56.526 [DEBUG] [canvas-persistence] CANVAS WRITER: _liveshare-test/wp79-024526-three.canvas owner=CanvasPersistence nodes=1 edges=0
00:49:56.527 [INFO]  [canvas] CANVAS WRITER: _liveshare-test/wp79-024526-three.canvas owner=CanvasPersistence attached (coldOpen=doc-wins)
00:49:56.568 [DEBUG] [canvas-persistence] CANVAS WRITER: _liveshare-test/wp79-024526-one.canvas   owner=CanvasPersistence nodes=2 edges=1
00:49:56.569 [INFO]  [canvas] CANVAS WRITER: _liveshare-test/wp79-024526-one.canvas   owner=CanvasPersistence attached (coldOpen=doc-wins)
00:49:56.612 [DEBUG] [canvas-persistence] CANVAS WRITER: _liveshare-test/wp79-024526-two.canvas   owner=CanvasPersistence nodes=1 edges=0
00:49:56.613 [INFO]  [canvas] CANVAS WRITER: _liveshare-test/wp79-024526-two.canvas   owner=CanvasPersistence attached (coldOpen=doc-wins)
00:49:56.620 [INFO]  [canvas-mirror] CANVAS MIRROR: role=guest considered=6 published=0 materialised=3 skipped(local-file)=3 skipped(no-source)=0 failed=0
```

Four things are readable off that, in production, and none of them is an inference:

1. **`owner=CanvasPersistence`** — the writes came from the single existing writer. There is no other
   writer on this path. (AC2)
2. **`coldOpen=doc-wins`, three times, never `seeded-from-file`** — a materialisation is a doc→file
   act and was not a seed. (AC3)
3. **`skipped(local-file)=3` alongside `materialised=3`** — the three canvases the guest already held
   were skipped by their own named verdict while the three it lacked arrived. (AC4, AC5)
4. **The earlier passes at 00:45 and 00:49:17 saw `considered=3` and materialised nothing**; the
   materialisation happened at 00:49:56 once the manifest carried the new entries *and their guids*.
   That is the manifest-change retry (§3.3) doing exactly the job it was added for.

The **host's** log for the same run shows the other arm:
`CANVAS MIRROR: role=host considered=6 published=6 materialised=0 skipped(local-file)=0 failed=0` —
six canvases published, **zero writes**, so the host's own files were not rewritten.

### 4.4 Regression — the other two live suites

| suite | result | baseline |
|---|---|---|
| `liveshare_e2e.py` (canvas) | **19 / 19** | 19 / 19 — unchanged, including `[06]`, the scenario the previous batch's reordering broke |
| `liveshare_dataloss_e2e.py` | **12 passed, 0 failed, 1 skipped** | 12 passed, 0 failed, 0 skipped |

The data-loss skip is the suite's **own** role-lottery skip in S2 (*"roles swapped across the
restart … re-run to land the other assignment"*), self-declared, with S2's secondary claim passing
(`with the host still listing it, the file is NOT deleted`). S1 and S3 passed in full. It is not a
WP79 regression: the pass count is identical and nothing failed.

---

## 5. AC-by-AC

### AC1 — the verdict is a pure core, a closed set, and fail-closed ✅

`decideCanvasMirror`, zero imports, exported, stateless, non-mutating, never throws.

**The truth table, as executed — every row asserted individually, `test_tp01_mirror_verdict_truth_table.test.ts`:**

| role | localFileExists | identityResolves | docHasRecords | verdict |
|---|---|---|---|---|
| guest | false | true | true | **materialise** |
| guest | false | true | false | skip-no-source |
| guest | false | false | true | skip-no-source |
| guest | false | false | false | skip-no-source |
| guest | true | true | true | skip-local-file |
| guest | true | true | false | skip-local-file |
| guest | true | false | true | skip-local-file |
| guest | true | false | false | skip-local-file |
| host | true | true | true | **publish** |
| host | true | false | false | **publish** (the mint case) |
| host | false | true | true | skip-no-source |
| host | false | false | false | skip-no-source |

**Every unknown-input row, also individually.** For each of
`undefined, null, 0, 1, "", "true", "false", {}, []` (9 values × 4 fields = 36 rows) plus `null`,
a non-object, and `{}`:

| field carrying the unknown | verdict |
|---|---|
| `role` | skip-no-source (never guesses a role) |
| guest `localFileExists` | **skip-local-file** — never a write |
| guest `identityResolves` | skip-no-source |
| guest `docHasRecords` | skip-no-source — no empty file |
| host `localFileExists` | skip-no-source — never publishes what it may not hold |

Plus: closure over 5 × 5 × 5 × 5 = 625 shapes (every answer is one of the four constants), purity,
non-mutation, never-throws, and `admitsCanvasMirror` agreeing with `decideCanvasMirror` on all 8
combinations it can be asked.

**Mutation-checked, not assumed** (each mutation applied, measured, reverted):

| mutation | result |
|---|---|
| guest `localFileExists !== false` → `=== true` | **9 of 111 fail** |
| guest `docHasRecords !== true` → `=== false` | **9 of 111 fail** |
| guest `identityResolves !== true` → `=== false` | **9 of 111 fail** |
| `if (!admitsCanvasMirror(pre))` → `if (false)` | **3 of 111 fail** |

### AC2 — one projection, one writer, positive control ✅

The harness's `materialise` **is** `attachCanvasPersistence` — the real one. No second serialiser
exists anywhere in the test, which is the point: a byte comparison against a test-local serialiser is
the failure C28's archive argument names, reproduced in the oracle.

**Positive control, all four parts:**

| requirement | how it is discharged |
|---|---|
| asserted **absent** before | `expect(world.disk(BOARD)).toBeUndefined()` — with the message *"the fixture pre-created the file"* |
| write attributed by a receipt the mechanism emits | `report.entries[0]` = `{path, verdict: materialise, outcome: materialised}`, and `world.writes` = `[BOARD]` (the single writer's IO, nothing else) |
| bytes **change** when the doc changes | two worlds with different peer content produce different bytes — the oracle cannot be satisfied by a constant |
| pass disabled at its seam ⇒ file **absent** | injection (i): `materialiseOverride: async () => {}` leaves the file undefined and reports `outcome: "failed"`, `materialised: 0` |

Plus: the guest's bytes are asserted equal to **what the host's own `CanvasPersistence` produces from
the same doc**, obtained by running that writer — one definer used twice, not two serialisers.

Live confirmation: `owner=CanvasPersistence` on all three materialisations (§4.3).

**No second serialiser, no second CRDT→disk writer, no `Y.Text`.** Scanned:
`grep -n "vault.create\|adapter.write\|vault.modify\|Y.Text\|getText(" canvas-mirror*.ts` → matches
in **comments only**. `subscribeCanvasWithHandover` appears in the mirror module in **comments only**;
the pass calls `canvasSync.subscribe` directly, asserted by
`expect(world.subscribeCalls).toEqual(["guest:…"])`.

### AC3 — four entry points, separately; never a seed, never a mint ✅

Asserted per entry point, each starting from a **different state**, not by one representative:

| entry point | starting state | mints | second doc | cold-open outcome | second pass writes |
|---|---|---|---|---|---|
| join | nothing local, nothing subscribed | 0 | none | doc-wins | 0 |
| rejoin/resume | a sidecar replica already in the local doc | 0 | none | doc-wins | 0 |
| reconnect | mid-session, already subscribed, live doc | 0 | none | doc-wins | 0 |
| reload-from-host | converged session, the pass has already run once | 0 | none | doc-wins | 0 |

12 assertions (3 per entry point). `world.mintCalls` is `[]` in all four; `world.peerDocs.size` is
unchanged; `world.guids.get(BOARD)` still equals the originally published guid.

**The injected-re-seed falsification is present and is a separate test:** the same harness, a doc
nobody knows and a file on disk, produces `coldOpen === "seeded-from-file"`. The absence assertion
above is therefore capable of the other value — an absence with no positive control is not evidence.

Live confirmation: `coldOpen=doc-wins` ×3 (§4.3). `coldOpen` keeps its three outcomes, its branch
order and its position — `canvas-persistence.ts` is **byte-unchanged**.

### AC4 — nothing destroys, and an empty doc produces no file ✅

**The collision case, byte-compared, with the pre-existing file explicitly DIFFERENT from the
projection:** the fixture is a guest-authored board (`local-1`, x=999) while the host's doc holds
`p-1`/`p-2`+edge, and a separate test asserts `DIVERGED !== hostProjection` **before** the byte
assertion, so *"unchanged"* cannot be satisfied by an overwrite. After the pass: bytes identical,
`world.writes` empty, verdict `skip-local-file`, and **no doc was even opened** (`subscribeCalls`
empty).

**Without the withhold:** `seedRefusals` is never passed by this pass. The create-only property comes
from the verdict alone, and there is a test that says so.

**Injection (ii) — forcing `materialise` for a path whose file exists:** the `localFileExists` probe
is made to lie (exactly as a broken probe would), and the **same byte comparison goes red** — the
test asserts `.not.toBe(before)` under the injection, so the comparison is proven to be measuring
bytes rather than passing regardless.

**Empty doc ⇒ no file:** identity resolves, doc holds no records → nothing written, verdict
`skip-no-source`, `materialised: 0`. **Positive control:** the *same* fixture with **one** record
added produces a file — so "no file" is not "no mechanism". The record-map names are a named
constant (`CANVAS_RECORD_MAPS`) precisely because a wrong name makes the emptiness probe
unfalsifiable.

**Injection (iii) — emptying every doc in an N=3 folder:** `materialised: 0`, `writes: []`, all three
files absent.

Live confirmation: W2, `before=381B after=381B` (§4.2).

### AC5 — complete, counted, falsifiable ✅

N=5 canvases considered (3 to mirror, 1 the guest already holds, 1 whose subscribe rejects) plus one
`.md` that must not be considered at all:

| assertion | measured |
|---|---|
| all three missing canvases arrive | `materialised === 3`, all three files present |
| the `.md` is not considered | `entries` does not contain it; `considered === 5` |
| a skipped canvas is skipped **by its own named verdict** and is **reported** | `entries` contains it with `verdict: skip-local-file`, `outcome: skipped` |
| a failing canvas degrades **alone** | `failed === 1` with `reason` naming the refusal, `materialised === 3`, the other four unaffected, its file absent |
| the guest's own canvas is untouched while its neighbours mirror | bytes identical |

**Injection (iv) — the positive control for the count.** An empty manifest gives
`considered: 0, materialised: 0, entries: []`, and the test asserts `materialised !== 3`. So the
`materialised === 3` above cannot be passing on an empty lookup — which is the exact vacuity the
Dispatcher named.

Live: **3/3**, headless: **3/3 with one skip and one failure correctly classified**.

**Neighbouring behaviour under each injection:** (i) and (iii) leave every other assertion green —
only the file-presence and count assertions move. (ii) is scoped to one fixture. (iv) is a separate
world entirely. No injection was left in the tree; `git status` shows only the intended files.

---

## 6. Test counts

| | before | after |
|---|---|---|
| unit tests | 1865 | **1976** (+111) |
| unit test files | 304 | **306** (+2) |
| failures | 0 | **0** |

Measured by `npm test` from `plugin/`. `npm run build` (tsc + esbuild) **passes**.
`npm run build:e2e` produces a 3 732 199-byte bundle.

**No existing test was deleted, weakened, retitled or skipped.** One assertion in one inherited test
was amended — §7.

---

## 7. The one §7 licence taken, and it needs ratification

**File:** `plugin/src/__tests__/canvas-single-writer.test.ts`
**Test:** *"AC8: BOTH main.ts canvasSync.subscribe call sites route through the handover helper"* (WP6 / US5 AC8)

```diff
- expect(source.match(/subscribeCanvasWithHandover\(\{/g)).toHaveLength(2);
+ expect(source.match(/subscribeCanvasWithHandover\(\{/g)).toHaveLength(1);
```

The test's **first** assertion — `expect(source).not.toMatch(/canvasSync\??\.subscribe\(/)`, the
load-bearing half — is **unchanged and still passes**. That is not an accident: `CanvasSync` is
forwarded to the mirror module as one injected object specifically so `main.ts` states no canvas
subscribe of its own and the assertion stays both true and meaningful.

**Why the count had to move.** It was 2 because of the manifest-replay loop in `connectSync()`. That
loop is S22 — structurally dead, never executed once, for either role, in any session. It was
therefore never counting two live handovers; it was counting one live handover and one dead one.
WP79 removed the dead one, and removing it is not optional housekeeping: the helper it drove installs
the R10 raw-text fallback, so a future "fix" that merely moved the loop after
`manifestManager.connect(...)` would mass-install the second CRDT across a shared folder.

**The charter forbids this**, in §7 disposition clause 2 and again in §5. The charter also (§2)
forbids the mirror pass from using `subscribeCanvasWithHandover`. With the dead loop removed, those
two requirements cannot both be satisfied by a count of 2. The charter did not anticipate the
removal because it recorded S22 as a note rather than as work.

**The alternatives, and why they were rejected:**

| option | why not |
|---|---|
| keep the dead loop so the count stays 2 | ships a landmine to satisfy a regex count; the loop's only possible future is the destructive one |
| spell the seam so the regex misses it | regex-gaming — satisfies the letter and defeats the purpose |
| **amend the count, keep the first assertion, document both** | **chosen.** The reason is written into the test file above the line, in full. |

**Dispatcher: this is the one item that needs a ruling.** Everything else in this WP is inside the
charter.

---

## 8. Found and NOT fixed

| # | Finding | Why not fixed here |
|---|---|---|
| **S25 (new)** | **`FileOpsManager.onFileCreate` is a fifth, unguarded door onto a `.canvas` path** (`file-ops.ts:375-405`). It pushes the raw file content over the control channel to peers, for every role, with no `skipsAutoTextSync` guard — measured live, mid-session, arriving in <3 s. Not a CRDT, so not the edge-destroying merge; but it puts a canvas on disk with no identity, no doc and not through the single writer, and it is why scenario `[07]` was thought flaky (§2). | Out of WP79's scope — WP79 owns the manifest→canvas path. It is adjacent and should be chartered: the `skipsAutoTextSync` docstring's consumer list is **not exhaustive**, and that docstring claims it is. |
| **S26 (new)** | **The plugin debug log stops writing mid-session, silently, while `debugLogging: true`.** Observed directly: two consecutive 8-second windows produced zero bytes in **both** vaults' logs while awareness pulses (logged every ~8 s) were certainly still firing. It resumed later on its own. It was writing again for run `024526`, which is why §4.3 exists at all. | Previously recorded as finding #5 of the D1/D2/D3 batch and still unowned. It was not chased far, per the brief. A logger that silently stops is the same defect class as a delete that reports nothing. |
| **S27 (new)** | **The relay's host election makes the role assignment across a restart a coin flip.** Measured across five restart cycles in this batch: B→A→B→A→B with no pattern tied to anything under our control. Non-destructive (D1's promotion fix holds; S3 still passes), but it makes any restart-based E2E scenario a lottery — the new suite needs up to four attempts, and the data-loss suite's S2 skipped for the same reason. | `server/src/control-handler.ts:588` — `server/**` is out of scope. Already recorded as finding #1 of the previous batch; this batch adds the measurement that it is a *lottery*, not an *alternation*. |
| **S21** | C29 AC1 is enforced at only one of the two file→doc boundaries. | Unchanged, still unowned; WP79 explicitly does not take it. **WP79 does not widen it** — see the note below. |
| **S23** | `plugin/manifest.json` is a broken symlink. | Known, no owner, worked around. |
| **S24** | The `isSharedPath` prefix-match suspicion. | CLOSED, negative, by the charter's §3 Verification 5. Nothing owed. |

### The S21 amplification, addressed rather than glossed

The charter's one genuinely new hazard: the host seed in `CanvasSync.subscribe` runs on **every**
`subscribe(path, "host")`, and after WP79 that is every shared canvas at session start instead of
only the ones the host opens.

**WP79 does not make it worse, and the reason is structural rather than argued.** The host arm's
verdict is `publish`, and `publish` performs **a subscribe and nothing else** — no writer attach, no
cold open, no write. The host's own `.canvas` files are never touched by this pass, which the live
run confirms (`role=host … published=6 materialised=0`, zero writes) and a headless test asserts
directly (`world.writes` empty, `world.coldOpens` empty, the file byte-identical). The seed itself is
upsert-only at the record level since WP29 AC2, so no record is removed. **No new route to record
loss is created.** Closing S21 properly is still S21's own charter.

---

## 9. Files changed

| File | Change |
|---|---|
| `plugin/src/files/canvas-mirror-decision.ts` | **new** — the pure verdict core (zero imports) |
| `plugin/src/files/canvas-mirror.ts` | **new** — the headless mirror pass + receipt |
| `plugin/src/main.ts` | wiring only: `armCanvasMirrorPass()`, six arming sites, the dead loop removed |
| `plugin/src/__tests__/v2/wp79/test_tp01_mirror_verdict_truth_table.test.ts` | **new** — 70 tests |
| `plugin/src/__tests__/v2/wp79/test_tp02_mirror_pass_materialises_and_never_destroys.test.ts` | **new** — 41 tests |
| `plugin/src/__tests__/v2/wp79/harness.ts` | **new** — the in-memory world; `materialise` is the real writer |
| `plugin/src/__tests__/canvas-single-writer.test.ts` | one assertion amended, documented — §7 |
| `H:\tmp\liveshare_wp79_e2e.py` | **new** — the deterministic pre-session reproduction, idempotent |

**Byte-unchanged, verified with `git diff --exit-code`:** `plugin/src/utils.ts`,
`plugin/src/files/background-sync.ts`, `plugin/src/files/manifest.ts`,
`plugin/src/files/vault-events.ts`, `plugin/src/files/canvas-sync.ts`,
`plugin/src/files/canvas-persistence.ts`, `plugin/src/types.ts`, `server/`.

Both `.canvas` skips are byte-unchanged and quoted from the current tree:

```ts
// files/background-sync.ts:97   (startAll, the manifest replay)
      if (skipsAutoTextSync(path)) continue;

// files/manifest.ts:323         (syncFromManifest, the text branch)
      if (!entry.binary && skipsAutoTextSync(path)) continue;
```

Every call site of `skipsAutoTextSync` survives. `useCanvasBinding` is still `false`. The plugin
version is not bumped. No new runtime dependency.

---

## 10. Data-safety statement

`data.json` values were never read, printed, logged, fixtured or committed — only key **names**
appear anywhere in this batch, and only in this report's absence of them. `sharedFolder` remained
`_liveshare-test` in both vaults throughout and was never set empty. No `.bak` file was touched;
this batch's namespace is `wp79-*` under `_liveshare-test/` and every artefact it created was swept.
`obsidian-git` was left disabled. No `server/**` edit. `tools/obsidian_e2e/**` was not entered.

---

## 11. One note for whoever touches this next

**The mirror pass must stay armed on the manifest-change handler.** It looks redundant next to the
six session-entry arms, and it is not: the guest's verdict depends on a guid that only the host can
publish, and at a simultaneous start the guest's entry-point pass runs *before* that guid exists.
Removing the manifest-change arming makes WP79 pass every headless test and fail on the rig
intermittently — the guest would mirror only when it happened to lose the race. The trace in §4.3
shows the entry-point passes reporting `considered=3 materialised=0` and the manifest-change pass, 39
seconds later, reporting `considered=6 materialised=3`. That gap is the whole reason the retry exists.
