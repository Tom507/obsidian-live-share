# ImplementationReport WP124 — the driver sends the records expectation, and refuses to score a round it did not get judged

**Dispatched from** `ImplementationReport_WP123.md` residual **R2** (no charter) · **Batch B64** ·
**Branch:** `fix-bugs-and-raceconditions` · **HEAD at start:** `15868ac`
**Status:** DONE. Test/driver surface only; **no production behaviour changed, no production file edited.**
**Scope verdict:** the premise held. R2 is small and fully specified, and **no escalation was needed** — but
one word in it is wrong and §2 says which.

**The sentence the next reader can check:** *`tools/e2e/ls_records.py` builds `records: {nodes:[…]}`, posts it
over `convergence.judge`, and returns green **only** when the `records` clause row came back
`stated:true / satisfied:true` **and** `peersAgreeOnRecords` is `true` — and `test_tp03a` proves that a rig
which ignores the clause and answers `converged: true` reads as `NOT_JUDGED`, not as a pass.*

---

## 1. Is `S179` closed?

**Yes at the driver, with one adoption sentence that only a live round can write.** Stated plainly so nobody
reads more into it than is there:

| what `S179` asked for | state |
|---|---|
| a driver that **sends** a `records` expectation | **DONE** — `ls_records.records_expectation` / `judge_canvas_round`, exercised against the shipped oracle in 38 rows |
| a driver that **consumes** `peersAgreeOnRecords` | **DONE** — `records_converged` will not return `True` without it (`BK4`) |
| a driver that **cannot be fooled** by a rig that ignores the clause | **DONE** — `assess_records` -> `NOT_JUDGED` (`BK1`, `BK3`, `tp03a`) |
| the **next live battery** actually importing it | **ONE IMPORT LINE, not yet written** — §8 |

**The driver actually sends and consumes it — measured, not asserted.** Here is a real judgement returned by
the real `routeCommand` in this package's `tp01a`, for three peers holding **one board in three spellings**
(3 digests, 3 sizes):

```
peersAgree            false      <- the BYTE oracle calls this board diverged
peersAgreeOnRecords   true       <- the RECORD oracle calls it one board
converged             true
clauses[4]            {clause: "records", stated: true, satisfied: true,
                       detail: "compared n1.x, n1.y against the board's 1 record(s) and every named field holds"}
records_converged()   (True, "records satisfied … and all peers agree on the records")
```

and here is the same driver, unchanged, against a rig that ignores the clause (`BK1` planted, `tp01c`):

```
records=NOT_JUDGED green=False peersAgreeOnRecords=True peersAgreeOnBytes=False
verdict='unjudgeable' … "the rig did not read what we asked. 'Not asked' and 'asked and passed'
must never read alike and here they would"
```

---

## 2. The one correction to R2's wording, and why it is not an escalation

R2 says *"`tools/e2e/*.py` is unchanged"*, which reads as *"the drivers send the wrong expectation"*.
**Measured: `grep -rn "convergence\|peersAgree\|judge" tools/ --include=*.py` returns ZERO.** No file under
`tools/e2e/` has ever called `convergence.judge` at all. The driver that does is
`H:\tmp\w4d_lib.py::judge()` — written per validation round, outside the repo, untracked, and rebuilt for each
round (`w4c_lib` -> `w4d_lib` -> `w4e_lib`, each importing the last).

So *"teach the drivers"* has two possible readings and only one of them is a package:

- **rewriting `ls_b56.py` / `ls_b59.py` / the `liveshare_b5*` arms** — those are the closed evidence of closed
  rounds. Editing them would falsify history, and they never had a records question to get wrong. **Rejected.**
- **landing the capability in the repo, tested, so the next round imports it instead of re-deriving it** —
  done. `w4d_lib.judge()` is 18 lines that were re-typed each round; **the part nobody re-typed is the
  consumption**, because until WP123 there was nothing to consume.

This did **not** require redesigning the expectation model, touching the rig's judgement path, or widening a
pin. **`e2e-control.ts` is byte-identical to `15868ac`** (`bf5988250312454bfbcfd9c540be3a73de5ee2541276f86d9e682962dc0ae345`, and `git status` shows it unmodified).
No pin was amended, no §7 ledger entry is owed, **and I allocated no signal numbers.**

---

## 3. What was built

### 3.1 `tools/e2e/ls_records.py` — the driver side (new)

| symbol | what |
|---|---|
| `records_expectation(origin, nodes, …)` | builds `{origin, records:{nodes:[{id,x?,y?,width?,height?}]}}`; refuses **locally** every shape WP123's R4 says the rig would refuse |
| `disk_reading` / `readings` | `canvas.file`-shaped readings taken from **disk bytes**; structurally refuses `data.json` (§4) |
| `judge(post, readings, expected)` | posts `convergence.judge` over the driver's own transport; a non-`ok` answer **raises**, never becomes a verdict |
| `assess_records(expected, judgement)` | **the S179 detector.** `NOT_ASKED` / `NOT_JUDGED` / `VIOLATED` / `SATISFIED` |
| `records_converged(expected, judgement)` | `(green, why)` — three conjuncts, none of them `peersAgree` |
| `judge_canvas_round` / `wait_records_converged` | the two calls a live battery makes; the expectation is built **once, before the first read** |
| `records_line` | one battery log line carrying **both** agreements, so `peersAgree: false` can never sit next to an unqualified *"the peers agree"* |

**Why `assess_records` takes the expectation and not only the judgement.** `stated: false` is a correct,
honest answer for a caller who asked nothing and a silent lie for a caller who asked, and **only the caller
knows which it is**. `BK9` is the plant that proves this is load-bearing rather than decorative.

**The order inside `assess_records` is deliberate** and is documented on the code: the clause row's own verdict
is read **before** `peersAgreeOnRecords`, because a rig that read our expectation and *refused* it
(`satisfied:false`, `"CANNOT BE APPLIED"`) legitimately has no record agreement to report —
`peersAgreeOnRecords` is `null` for a malformed expectation **by design**. Reading the agreement first files
that under *"the rig ignored us"*, which points at the wrong side of the wire. Both are red either way; only
the sentence differs. **This was found by `tp03d` going red on the first run, not by inspection.**

### 3.2 `tools/e2e/judge_bridge.py` + `plugin/src/__tests__/e2e/judge-entry.ts` — the real oracle, headless (new)

A python test that asserts a python driver against a **python fake of the rig** proves the author's idea of
the rig is self-consistent, which is not the question. So the bridge bundles the entry with the plugin's own
esbuild — **the same devDependency and the same `--alias:obsidian=` trick `tools/launch_liveshare_e2e.py`
already uses, no new dep** — and runs `createControlServer` on an **ephemeral 127.0.0.1 port**. Every
judgement in `test_ls_records.py` therefore comes out of the shipped
`parseAndRoute -> routeCommand -> judgeConvergence -> parseCanvasReport`, over real HTTP.

**The one double, stated rather than hidden (§3.1's "no partial test doubles"): the `host` object is empty.**
`convergence.judge` is a pure case that reads no host member, so that one command answers exactly as a live
instance does — and **every other command answers with a structured failure**, which `tp06a` asserts as a
positive control on the instrument. `BK10` gives the host a `sessionInfo` and `tp06a` goes red: *a bridge that
answered `session.info` would be a general-purpose fake and every row in the file would be worthless.*

**No live port was touched.** The bridge binds `port: 0`; 39431/39432/39433 were never opened, no vault was
started, nothing was rebuilt or deployed.

### 3.3 `tools/e2e/test_ls_records.py` — 38 rows (new)

`tp01` sends and is judged · `tp02` says no · `tp03` **the discrimination** · `tp04` never on bytes ·
`tp05` refused at construction · `tp06` controls · `tp07` secrets · `tp08` the two calls a battery makes.

---

## 4. The break table — 11 plants, the mandated one first

Every plant was applied to the working copy, measured, and restored **by copy-aside from
`H:/tmp/wp124-aside`**, each restore verified by **whole-file sha256**. **No `git checkout`, no `git stash`,
no `git restore`, at any point.** Driven by `H:/tmp/wp124_breaks.py`, which asserts the anchor is unique
before planting and asserts byte-identity after restoring, so a silent half-restore cannot pass. All numbers
below are from **one run against the final 38-row suite** (`0 failed / 38 passed` before and after).

| # | side | plant | RED | right reason? |
|---|---|---|---|---|
| **BK1** | **rig** | **THE MANDATED PLANT.** `judgeFileAgainstExpectation`'s `const rawRecords = expected.records` -> `undefined`: the rig accepts a `records` expectation, answers `ok:true`, and **silently does not judge it** | **18 of 38** | ✅ and the discriminator is `tp01c` / `tp03e`: `records=NOT_JUDGED` while `peersAgreeOnRecords=True`. The driver's green went `True -> False` **with no change to the driver**. See §4.1 |
| **BK2** | rig | `peersAgreeOnRecords` forced to `null` while the clause ledger keeps working | **17** | ✅ the *other* half of "did not judge". `tp06c` also fires — a one-peer round must not read `null` |
| **BK3** | driver | `assess_records` reads a **missing** `records` clause row as `SATISFIED` | **2** — `tp03a`, `tp03b` | ✅ exactly the pre-WP123-bundle case, and nothing else. §4.2 |
| **BK4** | driver | `records_converged` reads `judgement["peersAgree"]` (**bytes**) instead of `peersAgreeOnRecords` | **7** | ✅ *"never score a canvas on bytes"*, executed: every row whose peers hold one board in two spellings goes red |
| **BK5** | rig | `readCanvasRecords`'s `unreadable()` returns `readable: true` | **1** — `tp04a` | ✅ WP123's BK1 discriminator, now visible **from the driver**: two peers holding byte-identical **unparseable** content came back `peersAgreeOnRecords: true`. The vacuous green, executed |
| **BK6** | driver | the builder accepts a node naming no comparable field | **1** parametrised case of `tp05a` | ✅ narrow **and it should be** — §4.3 |
| **BK7** | driver | `records_converged` drops the **verdict** conjunct | **0**, then **1** | 🔴 **a finding.** §4.4 |
| **BK8** | rig | `compareExpectedRecords` stops comparing `y` | **1** — `tp02a` | ✅ the clause reads *satisfied* for a board whose card moved 199 px |
| **BK9** | driver | `assess_records` ignores what we asked (`asked = True`) | **2** — `tp03b`, `tp03c` | ✅ the design decision in §3.1 is guarded, not merely written down |
| **BK10** | bridge | the bridge's empty host gains `sessionInfo` | **1** — `tp06a` | ✅ **the positive control on the instrument can fail.** §3.2 |
| **BK11** | driver | the bounded wait returns `True` when the bound expires | **1** — `tp08b` | ✅ a green read off the clock, refused |

**Final restore, verified byte-identical on all three planted files:**

```
bf5988250312454bfbcfd9c540be3a73de5ee2541276f86d9e682962dc0ae345  plugin/src/testing/e2e-control.ts
0df901093317ebde380908c478e3b10c9465b7b23e65c0321207b6e65996e871  plugin/src/__tests__/e2e/judge-entry.ts
99af01d006c9b23935978f57f763bd41298709b2894db939d62896d251607166  tools/e2e/ls_records.py
```

`e2e-control.ts` matches the digest `ImplementationReport_WP123.md` §5 recorded, and **`git status` does not
list it as modified** — an independent second witness to the restore that does not rely on my own hashing.

### 4.1 BK1 — what a passing test would have done on the broken build

**This is the question the brief asks and it has a sharp answer here.** Under BK1 the rig still returns
`ok: true`, still returns a full six-row clause ledger, still returns `peersAgreeOnRecords: true` (the
agreement half was untouched by this plant), and for the three-spelling board **still returns
`converged: true`**. A driver that had merely *sent* the clause and then read `converged` — which is what
every live round before this package did with `peersAgree` — **would have passed.** It would have measured
nothing.

What actually happens is that `verdict` degrades to `unjudgeable` (no clause is stated any more) and, more to
the point, `assess_records` reports `NOT_JUDGED` **from the clause row alone**, before the verdict is looked
at. The 18 red rows are not 18 assertions of the same thing: `tp02b` reddens on the *verdict* changing,
`tp03d` on `VIOLATED -> NOT_JUDGED`, `tp03e`/`tp04b` on their **positive controls** failing, and `tp08a`-`c`
on the end-to-end call. The one that is the package is `tp03a` — and **`tp03a` stayed GREEN under BK1**,
correctly, because it does not use the real records path at all (§4.2).

### 4.2 BK3 and `tp03a` — the two halves are measured by different plants, and neither covers both

`tp03a` feeds the driver a **pre-WP123-shaped answer**, obtained from the real oracle by asking the same
question with the records clause removed and then dropping `peersAgreeOnRecords` (a field that did not exist
before WP123). That answer carries `converged: true` and `violations: []` **for a board whose card moved 199
px** — the trap, produced by the shipped code rather than by me. BK3 is the only plant that reddens it,
because BK1/BK2 change what the *rig* does and `tp03a` never asks the rig about records.

Conversely BK3 reddens **only** `tp03a`/`tp03b` — the rest of the file always gets a real clause row.
**Neither plant alone covers the property**, and a report claiming otherwise would be describing one of them.

### 4.3 BK6 — narrow on purpose, and the reason is worth writing down

The builder's local validation is a **UX guard, not a correctness guard**: the rig refuses the same shapes
(WP123's `readExpectedRecords`), so a driver that skipped the builder gets a judged `VIOLATED` rather than a
false green — which `tp03d` proves against the real rig, with the builder deliberately bypassed. The value of
failing at construction is that the author learns at line 3 of the battery instead of forty minutes into a
live round. **A plant here should redden exactly one row, and it does.**

### 4.4 BK7 — the break that reddened nothing, and what I did about it

Deleting the `converged` conjunct from `records_converged` left **all 34 rows green**. Reason, and it is the
legitimate kind: in every row that existed, a false verdict already coincided with either a non-`SATISFIED`
records clause or `peersAgreeOnRecords is not True`, so conjuncts 1 and 2 **subsumed** conjunct 3.

But the conjunct is not redundant, and the case it covers is one a live round will hit: **the geometry is
exactly right, the peers agree on the records, and a *different* stated clause is violated.** Per §3.1 the
answer to an empty break is not deletion — **`tp02d` was written because the plant found nothing**
(`records` satisfied + `peersAgreeOnRecords: true` + `atLeastBytes` violated -> `converged: false`), and with
`tp02d` in place the same plant reddens. Row count for this package went 34 -> 35 (and later -> 38 with
`tp08`). It is the only row here written *because* a plant found nothing.

---

## 5. Demonstrated vs argued (§3.7)

### Demonstrated — a test was written and run, and the number is from that run

- **The driver sends a records expectation and the shipped oracle judges it** — `tp01a`/`tp01b`, over real
  HTTP to `createControlServer`. Three spellings, three digests, three sizes, one verdict; `peersAgree false`
  and `peersAgreeOnRecords true` in the same object.
- **The driver consumes `peersAgreeOnRecords` and nothing else** — `BK4`: substituting the byte field reddens
  7 rows.
- **A silently-ignored expectation cannot read as a pass** — `tp03a` (a real pre-WP123-shaped answer with
  `converged: true`), `BK1` (18 rows), `BK3` (2 rows).
- **`NOT_ASKED` and `NOT_JUDGED` are different answers to the same rig response** — `tp03b`, guarded by `BK9`.
- **The rig's own half of the discrimination** — `tp03c`: `stated:false / satisfied:null /
  peersAgreeOnRecords:null` when nobody asked; `tp03d`: `stated:true / satisfied:false` when the question was
  unreadable.
- **`contains` is not a geometry clause** — `tp04c`: `'"x": 100'` is `CONVERGED` for the author's spelling and
  **not** for the canonical spelling of the same `x`, while the records clause is green for all three.
- **The unreadable-board vacuous green is refused** — `tp04a`, guarded by `BK5`.
- **The bridge is not a general-purpose fake** — `tp06a`, guarded by `BK10`.
- **The production bundle is unaffected**: `npm run build` exit 0, then `grep -c` over `plugin/main.js` —
  `e2e-control` 0, `LIVESHARE_E2E` 0, `e2eControlPort` 0, `peersAgreeOnRecords` 0, `judge-entry` 0,
  `JUDGE_BRIDGE_PORT` 0.
- **Nothing under `plugin/src/` that ships was edited**: `git status` lists four untracked files and no
  modified one.

### Argued — no test was run for this, and the Dispatcher should not treat it as closed

- **That the next live battery will import this module.** It is one import line and §8 writes it out, but
  **no live round has run**, and *"the driver can do it"* is not *"the driver did it"* — which is the exact
  distinction `S179` was raised to make. **This is the residual, not the deliverable.**
- **That the empty host is a complete account of the double.** I read the `convergence.judge` case and it
  touches no host member; I did not prove by construction that no *other* code path in `createControlServer`
  reaches the host for this command. `tp06a` measures the consequence (only that one command answers) rather
  than the cause.
- **That the flaked vitest row in §7 was `wp5/latency`.** Named as a suspect, not identified. See §6.
- **That the three byte spellings are 235 / 296 / 218 B live.** Quoted from `S174`/`S177`; my fixtures are
  three spellings of my own (**132 / 102 / 118 B, measured**), and what I measured is that three distinct
  spellings of one board exist and parse identically — not those three sizes.
- **Edges.** WP123's R1 stands: `ExpectedRecords` names nodes only, so this driver cannot ask an edge
  question. Not attempted here.

---

## 6. What I could not separate (§3.6)

1. **One vitest run out of four came back `1 failed / 3374 passed` and I lost the name.** I had piped that
   run through `tail -8`, so the failure block was never captured — my own error, and it cost the
   attribution. The two runs immediately after it, on a byte-identical tree, were `444 files / 3375 tests /
   0 failed`, and that run took **78.9 s against a 41 s baseline**, so machine contention is the likely cause
   and a timing-banded row (`wp5/latency` asserts an RTT inside a 50-150 ms band) is the likely subject.
   **Likely is not measured.** It is recorded here as an unattributed transient, and the gate figure in §7 is
   from a run whose full output I kept.
2. **`BK1` and `BK2` overlap on 15 rows.** Both make the rig stop answering a records question, from two
   different places, so those rows cannot attribute their red to one of the two. The rows that *do* separate
   them are `tp02c` and `tp03d` (BK1 only) and `tp06c` (BK2 only).
3. **`tp01a` measures reachability and spelling-independence in one row.** A failure there does not by itself
   say whether the transport or the comparison broke; `tp01b` isolates the clause row in the same process.
4. **The bundle cache.** `plugin/node_modules/.cache/ls-judge-bridge.mjs` is deleted before every measured
   run in the break script, so no row was scored against a stale bundle. I did **not** prove the staleness
   check in `build_bundle()` is correct by planting against it — the deletion makes it moot for these numbers
   and leaves it unmeasured for a caller who relies on it.
5. **`S153`.** Green throughout, uncommitted and committed. It did not fire for WP121, WP122 or WP123 either,
   so **its silence here is evidence of nothing** and I do not cite it as a pass.

---

## 7. Gate — re-run by me, in the session in which these numbers are written

From `plugin/`, in charter order, on a quiet tree, alone:

```
./node_modules/.bin/tsc -noEmit -skipLibCheck        exit 0
./node_modules/.bin/vitest run                       444 files | 3375 tests | 0 failed
npm run build                                        exit 0
python -m pytest tools/e2e/test_ls_records.py -q     38 passed          (from the repo root)
python workflowArtifacts/canvas-v2/check_signal_register.py
    scanned 251 files under canvas-v2/  (control: all classes proved)
    baselined debt: 136 citations across 62 keys
    clean - no NEW violations. (29 baselined citations have since gone)
                                                     exit 0
```

**Baseline re-measured by me at `15868ac` before touching anything: 444 files / 3375 tests / 0 failed,
`tsc` 0** — matching the Dispatcher's figure exactly. **Delta 0 / 0**: this package adds no vitest row. Its
38 rows are pytest rows under `tools/e2e/`, which the vitest gate does not collect and never did.

**Caveats I attach to this figure:**

- **The pytest rows are a SECOND gate command, not part of the 3375.** A reader who runs only `vitest run`
  will see this package's tests neither pass nor fail. `python -m pytest tools/e2e/test_ls_records.py` is the
  command, run from the repo root, and it needs `node` + `plugin/node_modules` (it bundles and boots the
  bridge). There is no CI wiring for it — that is a residual, §8 R3.
- The checker's positive control printed *"control: all classes proved"*; without that line the run would be
  worth nothing and I would say so.
- `wp5/latency.test.ts` took ~38 s, by design.
- **§6.1**: one earlier vitest run in this session showed a single unattributed failure. Reported, not hidden.
- `S88` does not apply — this package touches neither `file-ops.ts` nor `vault-events.ts`.
- `S175` does not apply — no `write(`-shaped call was added anywhere near `main.ts`; `main.ts` is untouched.
- **`S180` checked, diff-scoped**: all four new files and `e2e-control.ts` scanned for NUL bytes — **0 in all
  five**, before the commit.
- `npx biome check --write` was **never** run.
- The gate above was run **after** every plant had been restored and each restore verified by whole-file
  sha256 (§4), and re-run after this report was on disk.

---

## 8. Handoff (Rule 13)

**Established, with file and line:**

- `tools/e2e/ls_records.py::assess_records` is the **only** place a driver may decide what the rig did with a
  records question. It takes the **expectation as well as the judgement**, and `BK9` is the plant that proves
  that is load-bearing.
- `tools/e2e/ls_records.py::records_converged` is the **only** green a canvas geometry round may record.
  Three conjuncts; `peersAgree` is not one of them (`BK4`).
- `tools/e2e/judge_bridge.py::JudgeBridge` runs the **shipped** oracle headlessly on an ephemeral port. Any
  future oracle question can be measured this way without an Obsidian instance. Its honesty rests on the
  empty host and on `tp06a`.
- `plugin/src/__tests__/e2e/judge-entry.ts` is launcher-only, is not a `*.test.ts`, is never imported by
  `main.ts`, and is grep-clean out of `main.js`.

**Rejected, and why:**

- **Rewriting `ls_b56.py` / `ls_b59.py` / the `liveshare_b5*` arms** — closed evidence of closed rounds; §2.
- **Editing `H:\tmp\w4d_lib.py`** — untracked, outside the repo, replaced every round. Landing the capability
  there would have made it un-committable and un-gated, which is how it got lost between WP116 and WP123.
- **A python fake of the rig as the test subject** — it would prove the author's model of the rig is
  self-consistent. The bridge exists to avoid exactly that (§3.2).
- **Asserting on `judgement["converged"]`** — it falls back to byte agreement when no usable records clause
  was stated, so it is `true` for a rig that ignored the question. `tp03a` is that case, produced live.
- **Deleting the verdict conjunct when `BK7` reddened nothing** — a row was written instead (§4.4).

**Residuals left, deliberately:**

- **R1 — no live round has used it.** This is the one thing W4 must do first, and it is two lines:
  ```python
  from ls_records import judge_canvas_round, records_line     # tools/e2e on sys.path
  green, why, v, expected = judge_canvas_round(
      lambda c, a: cmd(HOST, c, **a),                          # w4*_lib's own transport
      [("A", vpath("A", rel)), ("B", vpath("B", rel))],
      origin="the drag this round issued on the guest: n1 from (100,200) to (100,399)",
      nodes=[{"id": "n1", "x": 100, "y": 399}])
  say(records_line(expected, v))
  ```
  **Never record a canvas round green on anything but `green`.** If it comes back `NOT_JUDGED`, the installed
  bundle predates WP123 — that is a deploy finding, not a product finding.
- **R2 — nodes only, named fields only.** WP123's R1 and R3 pass straight through. An edge defect and a
  divergence in an unnamed field are both invisible to this driver, and any report quoting
  `peersAgreeOnRecords` should say so.
- **R3 — the pytest rows are not in any gate but this report.** `check_signal_register.py` does not see them
  and `vitest run` does not collect them. A future package could add `tools/e2e/` to whatever runs the python
  suites; I did not, because inventing a CI surface is not this package.
- **R4 — the bridge's bundle staleness check is unmeasured** (§6.4). It compares mtimes of the entry and
  `e2e-control.ts` against the bundle. Callers who edit anything else in the import graph should pass
  `force=True`.

---

## 9. Files

**Added (4), all test/driver surface:**

- `tools/e2e/ls_records.py` — the driver side of the records oracle.
- `tools/e2e/judge_bridge.py` — the shipped oracle, headless, on an ephemeral port.
- `tools/e2e/test_ls_records.py` — 38 rows against that oracle.
- `plugin/src/__tests__/e2e/judge-entry.ts` — the bundled entry the bridge runs.

**Changed: none.** `plugin/src/testing/e2e-control.ts` was planted on five times and restored byte-identical
five times; `git status` does not list it.

**Not touched:** any production behaviour, `BUILD_SPEC_CanvasV2.md`, `SIGNAL_REGISTER.md`,
`check_signal_register.py`, `ARCHITECTURE.md`, `README.md`, `docs/security.md`, `.bak` files, `main.ts`, and
the three live vaults. **No Obsidian instance was started and no live control port was opened.** No secret was
read, printed or fixtured; `disk_reading` refuses `data.json` structurally and `tp07a` asserts the refusal.

`workflowArtifacts/canvas-v2/temp.md` was untracked in the tree when I arrived and is **not mine** — left
alone, not staged.
