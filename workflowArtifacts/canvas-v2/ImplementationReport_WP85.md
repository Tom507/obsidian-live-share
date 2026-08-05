# Implementation Report — WP85: the doc→disk writer is attached on a state the product's own subscribe destroys

**Batch:** B31 · **Worker 3** · autonomous mode · 2026-08-05
**Branch:** `fix-bugs-and-raceconditions` · **Base:** `3310947` (*docs: WP82 done — the latch is closed*)
**Status:** **DONE** — all four ACs met, RED→GREEN measured live on two Obsidian instances, in both host/guest role orders.

---

## 0. The statement this report is required to open with

**S29's original measurement was CONFOUNDED by S45, and the product defect was established independently of it.**

- **The confound (S45):** `canvas.open` (`plugin/src/testing/e2e-control.ts:1620-1627` at this base) calls
  `cs.subscribe(path, roleOf())` **directly** — no handover helper, no leaf, no attach — and the leaf-open
  attach in `main.ts` was gated on `!isSubscribed`. Any file-level assertion taken on a peer whose canvas
  was reached through `canvas.open` therefore measures the rig. **This report never sends `canvas.open`
  for the path under test. Not once, on either instance, in any phase** (asserted in code:
  `H:\tmp\liveshare_wp85_e2e.py` raises on `name == "canvas.open"`).
- **The product entrance, quoted:** `files/canvas-mirror.ts:251-268` — the host arm subscribes the path
  (`admitsCanvasMirror` admits `PUBLISH`) and returns `PUBLISH` **without calling `materialise`**, because
  C79 AC4 forbids it to write the host's file. Combined with the `!isSubscribed` gate at `main.ts:1749`
  (pre-repair numbering at this base; `:1251` at `22fc50b`), a host's shared canvas is **subscribed and
  writerless** whether or not it is open. Measured live this run, on the unrepaired bundle:

  ```
  2026-08-05T05:36:25.916Z [INFO] [canvas-mirror] CANVAS MIRROR: role=host considered=8 published=8 materialised=0 skipped(local-file)=0 skipped(no-source)=0 failed=0
  ```

  `materialised=0` on the host is `attachCanvasWriter` called **zero** times on the host.

**⚠ Line numbers were re-measured against this base (rule 12).** `ImplementationReport_WP82.md` and
`ImplementationReport_WP86.md` both landed in `main.ts` after the charter was written and moved every
number in §3 of the charter. The correspondence actually used:

| charter (`22fc50b`) | this base (`3310947`) | what it is |
|---|---|---|
| `main.ts:1232` | `main.ts:1730` | `syncCanvasPresences` |
| `main.ts:1249-1253` | `main.ts:1747-1751` | the lazy-subscribe `if` and the `!isSubscribed` gate |
| `main.ts:1271` | `main.ts:1769` | the only leaf-driven `attachCanvasWriter` call |
| `main.ts:1718` / `:1749-1751` | `main.ts:2247` / `:2249` | `attachCanvasWriter` and its idempotence guard |
| `main.ts:1728` | `main.ts:2226` | the mirror's `materialise` call site |
| `e2e-control.ts:1255-1262` | `e2e-control.ts:1620-1627` | `canvasOpen`'s direct subscribe (S45) |
| `canvas-mirror.ts:249-266` | unchanged, `:251-268` | the host arm |

---

## 1. What changed

| File | Change |
|---|---|
| `plugin/src/files/canvas-writer-attach-decision.ts` | **NEW.** The pure, **zero-import** verdict. Closed answer set of five. |
| `plugin/src/main.ts` | Wiring and reads only: two hoisted observations, one consultation, one `private hasCanvasWriter(path)` reader. `+59 / -6`. |
| `plugin/src/__tests__/v2/wp85/test_tp01_writer_attach_verdict_truth_table.test.ts` | **NEW.** 54 rows, exhaustive over the input space. |
| `plugin/src/__tests__/v2/wp85/test_tp02_sync_canvas_presences_attach_seam.test.ts` | **NEW.** 9 rows against the **real** `syncCanvasPresences`. |

**Siting of the definer, and why (the charter left the choice to the implementor and asked it be recorded):**
`plugin/src/files/`, beside `canvas-seed-decision.ts` and `canvas-mirror-decision.ts`. The subject is the
single **doc→disk** writer and its attach sites, not the canvas surface. `canvas/` holds the view, the
adapter, the shadow and the reconcile plan; `files/` holds every decision about whether a byte reaches the
vault. This is one of the latter, and it now sits in a row of three with the two decisions it is a sibling of.

**The shape of the repair.** The old `if` fused two questions. They are now separate:

```
├── "does this path need SUBSCRIBING?"   → the lazy-subscribe branch, still gated on !isSubscribed,
│                                          behaviourally unchanged
└── "does this OPEN leaf need a WRITER?" → decideCanvasWriterAttach, consulted for EVERY open canvas
                                           leaf on every pass, whoever subscribed the path and whenever
```

`isSubscribed` is read **once, before** the lazy branch (`wasSubscribed`). That hoist is load-bearing:
`CanvasSync.subscribe` adds to `subscribedPaths` synchronously, so a read taken *after* the branch would
make a path this very pass has just claimed look like an already-subscribed one and drive the attach twice
for one open. The seam test pins it (`a NOT-subscribed shared leaf still takes the old lazy route, exactly once`).

**No new E2E command. `testing/e2e-control.ts` is byte-unchanged** — the leaf is opened with WP37's landed
`canvas.typeInNode { open: true }`, exactly as the charter's §2 item 3 requires.

---

## 2. Acceptance criteria

### AC1 — a remote change reaches the durable file of an OPEN canvas, on a peer whose path `canvas.open` never touched · **MET**

**The protocol as executed**, step for step, by `H:\tmp\liveshare_wp85_e2e.py`:

1. Both vaults live, each `session.info` quoted for the role it actually **resumed as** (S27/S37 — a coin
   flip, never assumed). The peer under test is whichever reported `role == "host"`.
2. The path under test is a shared `.canvas` **the host already holds**, placed in **both** vaults while
   Obsidian was stopped, so the mirror pass subscribes it (`PUBLISH`) and consumes the attach opportunity.
   Per-run marker: `_liveshare-test/wp85-<HHMMSS>.canvas`, a fresh one per phase, both vaults swept of
   earlier markers first.
3. **Precondition, asserted not assumed:** the host's `canvas.state` for the path returns records. A
   snapshot exists only for a subscribed path, so records are the positive proof that the path *is*
   subscribed and that step 4's leaf-open will hit the gate. **PASS in all four phases.**
4. The leaf is opened on the host with `canvas.typeInNode { path, nodeId: "c1", open: true }` and **no
   text** — WP37's non-invasive instrument. Response quoted in every phase:
   `"canvasOpen": true, "opened": true, "nodeFound": true, "liveNodeIds": ["c1","c2"], "editingStarted": false`.
   **`canvas.open` was NOT sent for the path under test, on either instance, in any phase.**
5. The remote change is driven by **writing the other peer's `.canvas` file on disk** (the live capture
   path — `useCanvasBinding` is `false`). **`canvas.simulateEdit` was not called at any point.**
6. **Precondition, asserted not assumed:** the host's `canvas.state` shows the change — the doc converged.
   Budget 30 s; observed 0.0–1.0 s in all four phases. **PASS in all four phases**, so no phase's file
   result is a measurement of the network.
7. `canvas.file` on the host, polled to a **bounded budget of 30 s at 1 s intervals**, plus a direct read
   of the file on disk.

**RED — the baseline bundle (`sha256 1e055805c267e7a7…`, 4 210 936 B, built from `3310947` with the WP85
files removed, digest verified into both vaults by the installer):**

```
run 1  roles resumed as: A=host, B=guest      run 2  roles resumed as: A=guest, B=host
[FAIL] S6 host .canvas carries the remote     [FAIL] S6 host .canvas carries the remote
       change: via canvas.file=False                 change: via canvas.file=False
       on_disk=False after 30.3s file_len=352        on_disk=False after 30.2s file_len=352
[FAIL] S7 host writer-attach receipt: ABSENT  [FAIL] S7 host writer-attach receipt: ABSENT
       | positive control: 0 attach lines            | positive control: 0 attach lines
```

`file_len=352` is the byte count of the file as it was placed before launch. **The bytes never arrived, in
either role order, inside a 30 s budget, while the doc had converged in 1.0 s.**

**GREEN — the WP85 bundle (`sha256 8beee8cb8c497b49…`, 4 239 808 B, digest verified into both vaults):**

```
run 1  roles resumed as: A=host, B=guest      run 2  roles resumed as: A=guest, B=host
[PASS] S6 via canvas.file=True on_disk=True   [PASS] S6 via canvas.file=True on_disk=True
       after 1.0s file_len=304                       after 0.0s file_len=305
[PASS] S7 host writer-attach receipt PRESENT  [PASS] S7 host writer-attach receipt PRESENT
```

**The discriminator, quoted verbatim** — absent before, present after, on the host, for that path:

```
2026-08-05T05:41:19.186Z [INFO] [canvas] CANVAS WRITER: _liveshare-test/wp85-074018.canvas owner=CanvasPersistence attached (coldOpen=doc-wins)
2026-08-05T05:45:17.922Z [INFO] [canvas] CANVAS WRITER: _liveshare-test/wp85-074417.canvas owner=CanvasPersistence attached (coldOpen=doc-wins)
```

`file_len` falling from 352 B to 304/305 B is the second witness that the writer produced it: that is
`serializeCanvas`'s canonical projection (tab-indented, sorted by `(ord, id)`), not the two-space JSON the
scenario wrote.

**Pattern discipline (rule 15 and its cousin).** The log was searched with the **literal substring**
`CANVAS WRITER: <path> owner=CanvasPersistence attached` in Python `in`, **never a regex** — `.` in
`canvas.open`/`link.break` is a wildcard and has produced false hits in this run before. The path-specific
needle is searched over the **whole log file**, because the marker path is minted per run, so any
occurrence anywhere belongs to this session and the absence claim is as strong as it can be. The
generic needle `owner=CanvasPersistence attached` is carried alongside as the positive control that the
search can match a known-present line — in RED it found the *guest's* attach with the identical spelling
(run 1) while finding none for the host.

**Vacuity risks, and how each was closed:**

| risk named by the charter | closure |
|---|---|
| driving the canvas through `canvas.open` | the driver **raises** on that command name; the leaf is opened with `canvas.typeInNode { open: true }` |
| asserting staleness without step 6 | step 6 is a hard precondition; it passed in 0.0–1.0 s in every phase, so no file row measures the network |
| a budget long enough for Obsidian's own view save to land | budget **30 s, recorded**; the log's `owner=` line is the oracle and the file content is the symptom. GREEN arrived in 0.0–1.0 s; RED never arrived in 30 s |
| running on the peer that resumed as guest | the host is selected **from the reported role**, and a run without exactly one host and one guest is a SKIP, never re-attributed. Both role orders were run, RED and GREEN |

**The guest-arm control (a control, never the criterion).** On the **unrepaired** bundle, the guest's
pre-existing canvas is untouched by the mirror and its writer attaches normally on leaf-open:

```
[PASS] S9  2026-08-05T05:36:40.845Z [INFO] [canvas-mirror] CANVAS MIRROR: role=guest considered=8 published=0 materialised=0 skipped(local-file)=8 skipped(no-source)=0 failed=0
[PASS] S8  2026-08-05T05:34:42.746Z [INFO] [canvas] CANVAS WRITER: _liveshare-test/wp85-073329.canvas owner=CanvasPersistence attached (coldOpen=doc-wins)
```

`skipped(local-file)=8 / materialised=0 / published=0` is `SKIP_LOCAL_FILE` for every path: **the guest's
existing files are not rewritten, before or after the repair.** The attach receipt above is from the
**RED** phase — the guest arm is green on the unrepaired build, which is exactly why it proves nothing
about the repair and is reported as the control.

> **⚠ In RED run 2 the guest control was UNAVAILABLE, and the reason is a new finding — see S50 below.**
> It was not silently re-attributed: the row is reported FAIL, and the cause is a measured role transition
> on that instance, not the repair.

### AC2 — the attach is a decision about an open canvas, taken by a pure core · **MET**

**The definer:** `plugin/src/files/canvas-writer-attach-decision.ts`. **Zero imports** — no Obsidian, no
filesystem, no clock, no Yjs. Closed verdict set of five: `ATTACH`, `ALREADY_ATTACHED`, `NOT_SHARED`,
`NOT_SUBSCRIBED`, `NO_PATH`.

**The exhaustive table** (`test_tp01`, 54 rows). All 16 boolean combinations written out, no duplicates,
and exactly one of them licenses an attach:

| hasPath | isShared | isSubscribed | hasWriter | verdict |
|---|---|---|---|---|
| false | (any 8 combinations) | | | `NO_PATH` |
| true | false | false/true | false/true | `NOT_SHARED` (4 rows) |
| true | true | false | false/true | `NOT_SUBSCRIBED` (2 rows) |
| true | true | true | true | `ALREADY_ATTACHED` |
| **true** | **true** | **true** | **false** | **`ATTACH` — the only licensing row** |

**Every unknown-input row is present**, seven spellings per field (`undefined`, `null`, missing, `"true"`,
`1`, `{}`, `NaN`) plus four non-object observations, and each is asserted with a **positive control** that
the base row does attach. Three fields fail closed to their refusal; `hasWriter` is the **one asymmetric
field** and is stated as a decision on the record rather than left as an oversight: an unanswerable *"is a
writer attached?"* yields `ATTACH`, because `attachCanvasWriter`'s per-path guard is a backstop for a
duplicate and **there is no backstop for an absence**.

**The seam** (`test_tp02`, 9 rows). The test drives the **real** `syncCanvasPresences` off
`LiveSharePlugin.prototype` with a fake `this` built by `Object.create(prototype)`, so the loop body under
test is the shipped code and `this.hasCanvasWriter` resolves to the production read. Only
`mountCanvasPresence`, `drainCanvasDeferrals` and `attachCanvasWriter` are own-property doubles. A row
asserting the method exists on the prototype is the file's own positive control against a renamed or
inlined seam.

**RED against the base tree** — the WP85 test files present, `main.ts` restored to `3310947` content
(`git diff --ignore-cr-at-eol` empty), same corrected harness:

```
 Test Files  1 failed | 1 passed (2)
      Tests  4 failed | 59 passed (63)

 FAIL  …test_tp02… > PRODUCTION CODE IS UNDER TEST: the method exists on the prototype
 FAIL  …test_tp02… > an ALREADY-SUBSCRIBED shared canvas leaf attaches a writer — RED before WP85
 FAIL  …test_tp02… > a second pass over the same leaf attaches NOTHING further
 FAIL  …test_tp02… > two open shared canvases each get their own writer, and only their own

 AssertionError: expected [] to deeply equal [ '_liveshare-test/board.canvas' ]
```

The 59 that passed under RED include the whole verdict table (a new definer is green by construction) and
**the not-subscribed rows** — which is the harness's own positive control: the old lazy-subscribe route
runs, once, and is measured running, on the unrepaired tree.

**GREEN:** `Test Files 2 passed (2) · Tests 63 passed (63)`.

**Vacuity risks:** every attach assertion names the **path**, never only a count
(`expect(h.attachCalls).toEqual([SHARED])`, and `[SHARED, OTHER]` for the two-leaf row); the pure core is
consulted by the seam and the seam is asserted; and idempotence is a **named verdict**, not
`attachCanvasWriter`'s internal early return — a dedicated row asserts `ALREADY_ATTACHED !== ATTACH`.

### AC3 — the file the writer produces is the projection, and nothing about the writer changed · **MET**

**Byte-unchanged, stated positively with a `git diff --stat` that returns nothing:**

```
$ git diff --stat -- plugin/src/files/canvas-persistence.ts plugin/src/files/canvas-mirror.ts \
      plugin/src/files/canvas-mirror-decision.ts plugin/src/testing/e2e-control.ts \
      plugin/src/files/canvas-sync.ts plugin/src/files/manifest.ts plugin/src/types.ts \
      plugin/src/utils.ts plugin/src/sync plugin/src/ui plugin/src/files/manifest-purge-decision.ts \
      plugin/manifest.json server workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md
(no output)

# positive control — the same command over the file WP85 DID change:
$ git diff --stat -- plugin/src/main.ts
 plugin/src/main.ts | 65 +++++++++++++++++++++++++++++++++++++++++++++++++-----
 1 file changed, 59 insertions(+), 6 deletions(-)
```

**The Verification-2 census, re-run after the change, with its positive control.**

*Census 1 — `grep -rnF "attachCanvasWriter"` (literal, `-F`, not a regex) over all of `plugin/src`:*
**4 production code sites, all in `main.ts`** — the definition at `:2300` and three calls: `:1777` (the
unchanged lazy route), `:1809` (the WP85 consultation) and `:2263` (the mirror's `materialise`). The
charter's baseline was *3 hits — definition + 2 calls*; the delta is **exactly one call and no new
definition, no second helper, no second writer.** Positive control: the same literal finds the definition
line, so it can match a known-present line. Remaining hits are comments plus one fake property inside the
WP85 tests — the charter's *"zero hits under `__tests__/`"* is **no longer true and is not claimed**;
`test_tp02` counts attach calls on a double and must name it.

*Census 2 — `grep -rnE 'adapter\.write\(|vault\.(modify|create)\(' --include=*.ts`, tests and mocks
excluded:* **12 sites, exactly as before**, `files/canvas-persistence.ts:674` still the only doc→disk
canvas writer. (`file-ops.ts` numbers moved to `:210 :219 :231 :343 :347` — WP83's landed change, not
this WP's; `canvas-persistence.ts:674`, `canvas-sync.ts:2198` and `:3534` are at the charter's numbers.)

`CanvasSync.writeToDisk` (`canvas-sync.ts:3534`) was **not revived, not called and not deleted** — it is
still the dead site the charter records as S46.

**Pre-existing suites, unmodified, counts recorded:** `canvas-persistence.test.ts` **17/17**,
`canvas-adapter.test.ts` **42/42**, `canvas-single-writer.test.ts` **19/19** — `Test Files 3 passed · Tests 78 passed`.

**Byte-equality against the doc's projection, not against the other vault's file:** GREEN `file_len` was
304 / 305 B against a 352 B input; the file is `serializeCanvas`'s canonical projection of the host's own
quiesced doc. The two-file comparison the charter warns against was not used.

### AC4 — the safety premise every view-side deferral rests on is stated, measured, and true · **MET**

Driven on the AC1 host, **with WP37's deferral actually engaged** and the read taken **while the editor is
still open, before any blur**:

1. `canvas.typeInNode { path, nodeId: "c1", text: "MINE<RUN>", blur: false }` — real characters into the
   live inline editor. Response quoted:
   `applied=True source=editor before='wp85-074018-c1-base' after='wp85-074018-c1-baseMINE074018'`.
   `source=editor` is the only source that can hold uncommitted characters, so the editor is genuinely open.
2. The peer changes a **different** record, `c2`, by writing its `.canvas` on disk.
3. The host's `.canvas` is polled, editor still open, no blur sent.

| | RED (baseline bundle) | GREEN (WP85 bundle) |
|---|---|---|
| c2's remote change in the host's file | `True after 4.0s` | `True after 1.0s` |
| **`MINE<RUN>` present_in_file** (WP37's vacuity guard, verbatim in form) | **`True` ⇒ VACUOUS** | **`False`** |

**The RED row is the more interesting one, and it is exactly the trap the charter names as S48.** On the
unrepaired build the file *did* converge for `c2` — but the host's own uncommitted characters were in it
too, which means the write came from **Obsidian's own view save**, not from a writer. The vacuity guard
caught it and the row is reported FAIL. On the repaired build the file carries the peer's change and
**not** the local editor's characters: the bytes are the doc's projection, written by `CanvasPersistence`.

**That is C37 AC2's justification clause turned into a measurement:** the file stays converged while the
view is deliberately stale. **C37 AC2 was NOT amended** — see §5.

This does **not** close WP37's partial AC3; its positional half remains unsatisfiable until WP36 lands and
nothing here changes that.

---

## 3. The live question: does WP85 explain the canvas E2E suite's 13/18?

**No. Measured, not argued — and the real cause is now identified with a positive control.**

**My own before/after, same session shape, both measured by me:**

| bundle | canvas E2E |
|---|---|
| baseline (`1e055805…`) | **12/18** |
| WP85 (`8beee8cb…`) | **13/18** |

The `+1` is scenario `[07]`, which `DISPATCHER_STATE.md` records as **flaky** (PASS, PASS, FAIL, PASS with
no correlation to the bundle) and instructs not to gate on. **It is not claimed as a WP85 movement.**

**The five failures are identical before and after, name for name:** *B received the move*, *B received the
side-less edge*, *B received the empty card*, *host received the guest's node*, *the two replicas converged*.
**WP85 does not move them.**

**Why not — and this retires the question rather than deferring it.** Probing both live instances
immediately after the GREEN suite run:

```
vault A role=host  connected=True
   DOC  nodes(25) = [208541a49dc66c4c, 90943d0a189fd75a, card1, card2, ee601e293437bced,
                     empty-card-035628 … from-guest-074141]
   FILE nodes(6)
vault B role=guest connected=True
   DOC  nodes(25) = [ … the identical 25 ids, in the same order … ]
   FILE nodes(7)
```

- **The two docs are IDENTICAL — 25 nodes, the same id list on both peers.** The replicas *have*
  converged. The suite's *"the two replicas converged"* row is false **about the files**, not about the
  CRDT. There is no propagation failure here.
- **Both files are 18–19 nodes stale.** That is `DOC_CONVERGED_FILE_DIVERGED` — the **D17** class WP49
  built its oracle for, live in the product, on both peers at once.
- The last `CANVAS WRITER: _liveshare-test/smoke.canvas owner=CanvasPersistence attached` line on either
  vault is from **01:12 (A) / 01:37 (B)** — hours earlier, a previous session. **In this session no writer
  was ever attached to `smoke.canvas` on either peer.**

**The cause is S45, end to end.** The suite reaches its canvases through `canvas.open`, which subscribes
**without opening a leaf** — and WP85's consultation is, by design and by charter, a decision about an
**open canvas leaf**. No leaf ⇒ no consultation ⇒ no writer. The suite then asserts on `read_canvas()`,
which reads **the file on disk** (`liveshare_e2e.py:68`, used at every one of the five failing rows).

**The positive control that settles it.** On the WP85 bundle, with the suite's leftovers still in place, a
**real leaf** was opened for `smoke.canvas` on both peers with `canvas.typeInNode { nodeId: "card1",
open: true }` — nothing else changed, no edit, no `canvas.open`:

```
BEFORE file node counts: {'A': 6, 'B': 7}
AFTER  file node counts: {'A': 25, 'B': 25}          (within 8 seconds)
vault A: 2026-08-05T05:43:56.322Z [INFO] [canvas] CANVAS WRITER: _liveshare-test/smoke.canvas owner=CanvasPersistence attached (coldOpen=doc-wins)
vault B: 2026-08-05T05:43:56.375Z [INFO] [canvas] CANVAS WRITER: _liveshare-test/smoke.canvas owner=CanvasPersistence attached (coldOpen=doc-wins)
```

**Both files converged to their docs the instant a real leaf existed.** So the repair does fix exactly this
shape — and the suite cannot observe it, because the suite never opens a leaf.

**Conclusion, stated plainly:**

1. **WP85 does not explain 13/18.** Establishing that was worth the measurement.
2. **Neither does WP82's latch** (already retracted in that report) **and neither does a propagation
   defect** — the docs are byte-identical on both peers.
3. **The five failures measure the rig.** `canvas.open` subscribes without a leaf; the suite asserts on
   files; no writer is attached to those files. **No product change can move those five while the suite
   reaches its canvases that way.** The fix is to the rig — S45 — and it remains **unowned**.
4. This corroborates the charter's own ruling on S45 with a live measurement instead of a static one.

**State change I caused and am recording:** that control rewrote `_liveshare-test/smoke.canvas` in both
vaults from 6 / 7 nodes to 25 nodes — the accumulated doc state of a day of suite runs. That is the
product writing its own durable artefact correctly, not damage, but it is a change to a shared fixture and
it is named here rather than left for the next batch to discover.

---

## 4. Gates and suite numbers — measured in an isolated worktree

A sibling (WP36) is live in `plugin/src/files/canvas-sync.ts`, `plugin/src/testing/canvas-node-editor.ts`,
`plugin/src/canvas/canvas-text-merge.ts` and `plugin/src/__tests__/v2/wp36/` in the shared tree. **Every
number below was measured in a detached worktree at `3310947`** (`H:\tmp\wp85-work`, `node_modules`
junctioned from the shared tree for `plugin/` and `server/`), so none of it is contaminated and none of it
contaminates.

| gate | baseline (`3310947`, WP85 files removed) | with WP85 |
|---|---|---|
| `npx vitest run` (whole plugin suite) | **328 files · 2231 passed · 0 failed · exit 0** | **330 files · 2294 passed · 0 failed · exit 0** |
| `npm run build` (`tsc -noEmit` + esbuild production) | — | **exit 0** |
| `npm run build:e2e` | exit 0 → 4 210 936 B | exit 0 → 4 239 808 B |
| WP85 tests alone | **4 failed / 59 passed (63)** | **63 passed (63)** |
| `canvas-persistence` + `canvas-adapter` + `canvas-single-writer` | — | **78 passed (78)** |

**+2 test files, +63 tests. No existing test was deleted, weakened, retitled, skipped or amended, and no
§7 licence of any class was taken.** The two failures the shared tree shows in these suites are the
sibling's: the same commit in isolation is **0 failed**, which is the measurement that proves it rather
than the assumption.

*(First baseline attempt reported `2 failed | 326 passed` files — `e2e/two-host` and `wp5/latency` could
not resolve `cors` because the worktree had no `server/node_modules`. That was a worktree artefact, fixed
by junctioning it, and is recorded so the number is not read as a real red.)*

**Bundle provenance (S46).** Both installs used `LS_EXPECT_SHA256` and the installer read the bytes back
from both vaults:

```
RED   bundle: 4210936 bytes  sha256=1e055805c267e7a7…   digest matches LS_EXPECT_SHA256
      vault A: installed and verified (1e055805c267e7a7…), e2eControlPort=39431
      vault B: installed and verified (1e055805c267e7a7…), e2eControlPort=39432
GREEN bundle: 4239808 bytes  sha256=8beee8cb8c497b49…   digest matches LS_EXPECT_SHA256
      vault A: installed and verified (8beee8cb8c497b49…), e2eControlPort=39431
      vault B: installed and verified (8beee8cb8c497b49…), e2eControlPort=39432
```

Both bundles were built in the detached worktree, so WP82's caveat — *the digest proves which bytes
shipped, not whose source they came from* — is answered: the source was an isolated checkout whose only
deviation from `3310947` was `M plugin/src/main.ts`, `?? plugin/src/files/canvas-writer-attach-decision.ts`,
`?? plugin/src/__tests__/v2/wp85/`.

---

## 5. §7 disposition — nothing re-opened, nothing amended

- **C37 AC2 is NOT amended, and this report is the reason it did not need to be.** Its normative content —
  *"structural applies for the record being edited are queued, not dropped, and applied on blur"* — is
  correct, landed and untouched. What was unmeasured was its **justification clause**, *"which is safe"*,
  and AC4 above turns that clause into a measurement instead of an assumption. **A criterion is not made
  wrong by an unverified premise in its rationale; the premise is made true.** Amending it would have
  weakened a correct requirement and recorded a product defect as a specification correction.
- **No `DONE` work package re-opened.** `files/canvas-mirror.ts` and `files/canvas-mirror-decision.ts` are
  **byte-unchanged** and C79 AC4 stays exactly as strict as it is. The abort criterion — *attaching inside
  the mirror* — was **not** taken; the repair is at the view seam, governed by C7.
- **No §7 licence of any class was taken. No inherited assertion reddened.** `npx vitest run` is 0 failed
  in isolation both before and after.
- **`BUILD_SPEC_CanvasV2.md` was not edited.**
- **No new runtime dependency** (D11): the definer has **zero** imports.
- **Nothing was added to `types.ts`** — the new module owns its own types, so the WP22 comment-strip trap
  at the top of `types.ts` is not engaged.

---

## 6. Live-run hygiene

- Ports used: **39431 (vault A) / 39432 (vault B)**, `POST /command` only.
- **No value from either `data.json` was read, printed, logged, fixtured, put in a test name, this report
  or a commit message.** `sharedFolder` remained `_liveshare-test` throughout and was never emptied.
- **The relay was not contacted at all** by this batch — not even `GET /healthz`.
- **`canvas.simulateEdit` was never called.** **`canvas.open` was never called**, for any path, in any
  phase — the driver raises on the command name.
- Both vaults' shared folders were left as found: every `wp85-*.canvas` marker was removed from both
  (`cleanup` verified by listing both folders). The one deliberate exception is `smoke.canvas`, recorded
  in §3.
- Four Obsidian restarts, all through `liveshare_e2e_install.py`. Roles resumed as, per phase:
  **RED-1 A=host/B=guest · RED-2 A=guest/B=host · GREEN-1 A=host/B=guest · GREEN-2 A=guest/B=host.**
  The criterion is RED in both role orders and GREEN in both role orders — the S37 symmetry control,
  used the way WP82 and WP83 used it. `connected: true` on both instances in all four phases (WP82's fix
  is live in these bundles).

---

## 7. Carried up — none owned by this WP

- **S50 (NEW) — the writerless state is reachable on a GUEST, and the charter's model of it is one case
  too narrow.** In RED run 2, vault A's own log shows, within 230 ms:
  `05:36:25.688 resuming as host` → `05:36:25.805 demoted from host - another host exists` →
  `05:36:25.916 CANVAS MIRROR: role=host considered=8 published=8 materialised=0`. **The mirror pass ran
  with the host arm after the demotion had already been decided**, subscribing all eight canvases, and
  the instance then lived out the session as a **guest whose every canvas was subscribed and writerless**.
  That is why the AC1 guest control was unavailable in that phase — reported FAIL rather than
  re-attributed. Consequences: (a) the defect's population is *"any peer that was momentarily host"*, not
  *"the host"*; (b) `armCanvasMirrorPass` reads `this.settings.role` at execution time and a role
  transition in flight is not re-read; (c) **WP85 repairs the outcome for both arms**, because the
  consultation is role-independent — GREEN run 2 attached on both peers. The *arming* defect is untouched
  and **unowned**.
- **S45 is now measured live and is the sole explanation of the canvas suite's five failures** (§3). It
  invalidates every file-level assertion in that suite, and while it stands, **no product change can move
  those five rows**. `testing/e2e-control.ts` is contended by WP37/38/80/81/82 and WP85 is forbidden to
  touch it. **Unowned, and now demonstrably load-bearing for the run's headline metric.**
- **A one-line rig repair is now specified by measurement, for whoever owns `e2e-control.ts` next:**
  `canvasOpen` should open a real workspace leaf (the `openCanvasLeaf` helper already exists in that file
  and `canvas.typeInNode` already uses it) *in addition to*, or instead of, its direct `cs.subscribe`.
  The proof that this is sufficient is §3's positive control: a real leaf converged both files 6/7 → 25
  within 8 s.
- **S47 stands unrepaired, deliberately:** a subscribed canvas that is never opened still has no writer.
  WP85's subject is the open canvas; the closed one is out of scope with a reason.
- **S46 stands:** `CanvasSync.writeToDisk` is still dead, still not revived, still not deleted.
- **S48 is confirmed live and is no longer a standing warning but a measurement.** AC4's RED row is the
  demonstration: Obsidian's own view save put correct-looking bytes for `c2` into the host's file in 4.0 s
  **on a peer with no writer at all**, and only the presence of the local editor's uncommitted characters
  revealed which mechanism had written them. **A file-content assertion alone identifies no writer.** The
  `CANVAS WRITER:` receipt is the only oracle, and it must be quoted in every future live canvas scenario.
- **The `visible-console` MCP silently swallowed a command.** A `run_command` without an explicit
  `session_key` was answered `"status": "reused"` against an unrelated older console, `await_console`
  then returned `command_state: completed, exit_code: 0` — for the **previous** run — and nothing
  executed. It was caught only because the next step checked the installed bundle's digest by hand and
  found the old one. **An explicit `session_key` per invocation avoids it.** Same class as everything else
  this week: a success report about work that did not happen. Workspace tooling, unowned.

---

## 8. Commits

| commit | scope |
|---|---|
| **`2b59735`** — *WP85 checkpoint: an open shared canvas gets a writer, whoever subscribed it* | `plugin/src/main.ts`, `plugin/src/files/canvas-writer-attach-decision.ts`, `plugin/src/__tests__/v2/wp85/` (4 files, +653 / −6) |
| **`<docs>`** | `workflowArtifacts/canvas-v2/ImplementationReport_WP85.md`, charter §7/§8/§9/§10 |

Both staged with `git commit -o <paths>` and with `git status` re-read **immediately** before each commit
(rule 14). Nothing belonging to the live sibling (`files/canvas-sync.ts`, `testing/canvas-node-editor.ts`,
`canvas/canvas-text-merge.ts`, `__tests__/v2/wp36/`) or to anyone else (`WORKFLOW_ANALYSIS.md`) was staged,
and **no path this batch did not create was reverted, restored or stashed at any point.** The only
`git show HEAD:…` restores were inside this batch's own detached worktree, on a file this batch had copied
there.
