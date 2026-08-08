# ImplementationReport WP123 — A board is judged by its records, not by its spelling

**Charter:** `TaskCharter_WP123_ABoardIsJudgedByItsRecordsNotItsSpelling.md` · **Batch B63** ·
**Branch:** `fix-bugs-and-raceconditions` · **HEAD at start:** `eb16fa5`
**Status:** DONE. Artifacts + test-surface only; **no production behaviour changed**.
**Commit:** one commit on `fix-bugs-and-raceconditions`, 10 files, staged explicitly with `git commit -o`,
never `git add -A` (it is the tip; the hash is left to `git log` so this line cannot go stale).
**Gate re-run AFTER the commit, on the committed tree:** `tsc` 0 · **444 files / 3375 tests / 0 failed** ·
`check_signal_register.py` 0 with its control proved. `S153` was green in both states, so its silence is
evidence of nothing and is not cited.

**The sentence the next reader can check:** *an expectation stating node `n1` is at (100, 200) is judged by
the oracle — `wp123/test_tp03_…:tp03a` — and `tp04a` is the test that proves the oracle says NO when it
isn't, naming `n1.y: expected 200, observed 399`.*

---

## 1. The fork — I built arm (a), and I priced arm (b) by construction

**Decision: arm (a).** The records judgement is a sixth row in `ExpectedContent`'s clause ledger, computed
inside `e2e-control.ts`, reachable over the existing `convergence.judge` command. Five assertions in three
other packages were amended, each with a §7 ledger entry in §4 below, and each shown still able to fail.

**W2's prediction was right, and the reason it gave is the reason that held.** But its arithmetic was wrong
twice — see §2 — and one of its two corrections *strengthens* arm (a) rather than weakening it.

### What arm (b) costs — MEASURED, not argued

`wp123/test_tp02_arm_b_is_priced_by_building_it.test.ts` **is** arm (b): a correct record oracle built out of
the real `parseCanvasReport` + `decodeCanvasDataToFlat`, living beside the clause ledger instead of inside it.
`tp02a` proves it is not a strawman — it answers correctly on the moved board, refuses `null` content and
refuses unparseable JSON. Three measurements:

| measurement | value |
|---|---|
| geometry rows in the object `convergence.judge` returns, under arm (b) | **0** — measured by running `tp02b` against the pre-implementation tree: `expected [] to have a length of 1` |
| `converged` for two peers agreeing on a board whose card moved 199 px, over the wire | **`true`** (`tp02b`, still true today for a caller who states no records clause — that is correct and intended) |
| `routeCommand(host, {cmd: "convergence.judgeRecords"})` | **400, `ok: false`** (`tp02c`) |

So arm (b)'s headline — *"no pin is touched"* — is **false in practice**: the live tester cannot reach a
command `routeCommand` does not route, so arm (b) requires an `e2e-control.ts` edit anyway. What it buys with
that edit is a **split ledger**: two answers about one round, in two objects, with nothing reconciling them and
no row in either naming the other's existence. That is `S155`'s defect ("not asked" and "asked and passed"
reading the same) reconstituted at the level of whole answers, in the file whose header says it is *"the last
place to add another"*. Under arm (a) the same call carries exactly one geometry row and it reads
`stated:false / satisfied:null` (`tp02b`, asserted).

### What arm (a) cost, exactly

Five assertions in three files, all ledgered (§4), all re-falsified (BK5, BK6). Plus one source array
(`e2e-control.ts`'s five-name fallback, not a pin). **Nothing else.** `everyBranch` at `wp116:334` is a list
of expectation *shapes* and was untouched, as the charter predicted.

### One arm I considered and rejected: (c) reach the parser through a dynamic `import()`

`e2e-control.ts` already does this twice — WP37 and WP38 reach the real driver and the real command ids
through dynamic `import()`, *deliberately*, with written rationale, precisely because the freeze's regex
(`/from\s+["']([^"']+)["']/g`) does not see a dynamic import. Arm (c) would therefore have landed the records
clause **touching neither allow-list**.

I rejected it, and this is an **argued** rejection with one measured leg:

- Measured: the freeze regex genuinely does not see `import(` — `wp44/test_tp12`'s package-level check stayed
  green under BK6 while both allow-lists went red, which is the same asymmetry.
- Argued: `judgeConvergence` is **synchronous** and pinned as such by `wp116` (`judgement.clauses` is read off
  the return value, not awaited). Arm (c) therefore forces the parser to be *injected* into the judgement,
  which creates a new branch — *"nobody injected a parser"* — that is exactly the "satisfied for a board it
  did not examine" family this package exists to close, and it removes the compiler's guarantee that the rig
  and the plugin read a `.canvas` the same way.
- Argued: buying "no ledger entry" by making a dependency **invisible to the instrument that exists to make
  dependencies visible** is `S162`'s shape one level up. The amendment ledger *is* the deliberation the freeze
  asks for; using a regex blind spot to skip it satisfies the letter and defeats the purpose.

---

## 2. Charter and brief corrections — three, all measured

**C1 — the import freeze is TWO allow-lists, not one.** The brief said *"one allow-list line, not a wall."*
There are two independent copies of `ALLOWED_IMPORTS`, in two files, each with its own assertion:

```
wp49/test_tp12_existing_protocol_no_new_dependency_visible.test.ts:46-52   asserted at :130
wp72/test_tp4_no_production_branch_and_no_new_transport_visible.test.ts:33-39  asserted at :54
```

Both went red on the added specifier (measured, §4). `ImplementationReport_WP122.md` §2 records only the
`wp72` failure; the `wp49` copy is the one nobody had counted. **Two ledger entries, not one.**

**C2 — the `wp116` amendment reddens SIX tests, not five.** WP122 reported 5 and the charter repeated it
(`:315` "3 tests"). The `cases` array at `wp116:284-305` has **four** entries, not three, so `:315` sits in a
four-iteration loop. Measured on the sixth-row plant:

```
tp03b               (:232)  1
tp05 × 4            (:315)  4
tp06a               (:347)  1
                            -
                            6 failed | 176 passed
```

**C3 — `wp72`'s third row does not bite, confirmed.** `CANVAS_MODULES` enumerates `src/canvas/canvas-sync.ts`,
which does not exist in this tree (`ls plugin/src/canvas/` — 19 files, none of them `canvas-sync.ts`), so its
own `existsSync` guard skips it. `parseCanvasReport` lives in `plugin/src/files/canvas-sync.ts`. The charter
was right and it is load-bearing for arm (a): the added specifier is `../files/canvas-sync`, which no
"no canvas module knows this WP exists" row covers.

**C4 — a hazard the tooling created, not the code.** Two **NUL bytes** were injected into
`e2e-control.ts` by my editing tool while writing `ids.join(" ")` (it landed as `ids.join("\0")`). `tsc` and
`vitest` both passed with them in place, and git would have been entitled to treat the file as **binary**.
Found by `cat -A`, confirmed by `od -c`, removed (`ids.join("|")`), and every file this package touched was
re-scanned: **0 NUL bytes in all 9**. *A source file that compiles is not the same as a source file that is
text.*

---

## 3. What was built

### 3.1 The clause

`plugin/src/testing/e2e-control.ts`:

| symbol | line | what |
|---|---|---|
| `import { decodeCanvasDataToFlat, parseCanvasReport } from "../files/canvas-sync"` | `:45` | the one parser — §3.2 |
| `ExpectedContent.records?: ExpectedRecords` | `:503` | the clause the caller states |
| `ExpectedNodeRecord` / `ExpectedRecords` / `RECORD_FIELDS` | `:515-535` | `{ id, x?, y?, width?, height? }` |
| `ConvergenceJudgement.peersAgreeOnRecords: boolean \| null` | `:570` | §3.4's sibling |
| `readCanvasRecords(file)` | `:651` | **`readable` first**, then records |
| `readExpectedRecords(raw)` | `:702` | a malformed expectation is a FAILURE, never a silence |
| `compareExpectedRecords(expected, observed)` | `:753` | names the id AND the field |
| `evaluateRecordAgreement(peers, expectedNodes)` | `:796` | the record-level peer question |
| the `records` clause row | `:957-1000` | ledger position 5 of 6 |
| the six-name fallback array | `:1071-1085` | the no-peer-reading branch |
| `agreeForVerdict` | `:1107` | which agreement decides the verdict |

**A2 — the command and its argument shape.** Unchanged surface: `convergence.judge`, `e2e-control.ts:1881`.

```jsonc
{ "cmd": "convergence.judge",
  "args": {
    "peers": [ { "peer": "host",  "file": { "exists": true, "sha256": "…", "size": 296, "content": "…" } },
               { "peer": "guest", "file": { … } } ],
    "expected": {
      "origin": "the drag this round issued on the guest: n1 from (100,200) to (100,399)",
      "records": { "nodes": [ { "id": "n1", "x": 100, "y": 399 } ] }
    } } }
```

Response gains `peersAgreeOnRecords`. `origin` is still mandatory and still non-empty (`tp03b`). Proven over a
real `JSON.parse(JSON.stringify(...))` round trip in `tp03c`.

### 3.2 Why the production parser, and why `parseCanvasReport`

One parser, statically imported, so **the compiler** guarantees the rig and the plugin read a `.canvas` the
same way. `parseCanvasReport` and not `parseCanvas` because `parseCanvas` (`files/canvas-sync.ts:684`)
degrades to empty records and never throws — demonstrated on production code in `tp01c`, before the clause
existed.

**`recordSignature` (`:265`) and `sameRecordSet` (`:275`) are NOT reused.** In one sentence, as the charter
asks: `recordSignature` hashes *every* key of a record, so any extra or renamed field reads as divergence —
and I have the measurement rather than the argument. `tp01c` shows that a `JSON.stringify` comparison of the
**parsed, decoded** records of the author's and the canonical spelling of *one identical board* returns
**`false`**, because the flat record preserves the source's key order. A record comparison done that way is
still a spelling oracle. This is why the clause compares **named fields only** (charter §3.1) and reports what
it compared.

### 3.3 §3.4 — `peersAgree`'s disposition, stated

**`peersAgree` is LEFT ALONE, byte-exact, and given a record-level sibling.** `sameFileObservation` (`:329`) is
unchanged; `evaluateCanvasConvergence` is unchanged and `wp116:248` still pins it. A sentence naming what a
reader must not confuse it with now sits on `sameFileObservation` itself (`:311-328`).

**The one behavioural consequence, stated plainly because it is the only one:** when — and only when — the
caller states a *usable* `records` expectation, the VERDICT is computed from record agreement instead of byte
agreement. A caller who states `records` has said the board is to be judged by its records, and three stable
byte spellings of one board exist on this build. No pre-WP123 caller states `records`, so `recordAgreement` is
`null` for every one of them and the verdict is computed from exactly the value it was computed from before.
Both facts are always reported and `reason` names the one that decided (`"agree on the records"` /
`"agree on the bytes"`) — an unqualified *"the peers agree"* next to `peersAgree: false` is how a reader is
misled. Guarded by **BK9**.

---

## 4. The §7 amendment ledger — five entries, ready to paste

Standing conditions: **strictness may not fall** and **the test count does not change**. Both hold: the
affected packages ran **182 tests before and 182 after**, and every amended assertion is the same matcher
(`toHaveLength`, `toStrictEqual`, `Set.has(...) === true`) — no `toMatchObject`, no `objectContaining`, no
subset match, no key-count, no `skip`/`only`, nothing destructured away.

| id | file · line | assertion | why stale | post-amendment strictness |
|---|---|---|---|---|
| **A-123-1** | `plugin/src/__tests__/v2/wp116/test_s158_…test.ts:232` (tp03b) | `expect(judgement.clauses).toHaveLength(5)` → `(6)` | the clause ledger gained the `records` row | identical — an exact row count, not a floor |
| **A-123-2** | same file `:315` (tp05 loop, 4 rows) | `expect(judgement.clauses).toHaveLength(5)` → `(6)` | same | identical |
| **A-123-3** | same file `:343 / :347` (tp06a) | test name `"five clause rows"` → `"six"`; `toStrictEqual([...5 names])` → `[...6]`, `records` in ledger position 5 | same | identical — still `toStrictEqual` over the whole ordered list |
| **A-123-4** | `plugin/src/__tests__/wp49/test_tp12_existing_protocol_no_new_dependency_visible.test.ts:46-52` | `ALLOWED_IMPORTS` gains `"../files/canvas-sync"` (6th entry) | the records clause reads a `.canvas` with the production parser; the alternative is a second parser inside the rig | falls by **exactly one specifier**; still an exact allow-list asserted `.has(spec) === true` for every specifier. No new package dependency, no new transport — the two assertions either side are untouched and green |
| **A-123-5** | `plugin/src/__tests__/wp72/test_tp4_no_production_branch_and_no_new_transport_visible.test.ts:33-39` | same entry, second copy of the same list | same | same. Must stay in step with A-123-4 — a comment in each file now says so |

**A7 — both amended pin families shown still able to fail:** BK5 and BK6 below.

**Not touched, per §7 of the charter:** `BUILD_SPEC_CanvasV2.md`. These entries are handed to the Dispatcher
to paste. I allocated **no signal numbers**.

---

## 5. The break table

Every plant was applied, measured, and restored **by copy-aside from `H:/tmp/wp123-aside`**, verified by
whole-file sha256 against a recorded baseline. **No `git checkout`, no `git stash`, no `git restore`, at any
point.** Final restore verified byte-identical on all five files:

```
bf5988250312454bfbcfd9c540be3a73de5ee2541276f86d9e682962dc0ae345  e2e-control.ts
0e0f589d41fdf4adfc7a577fcfb82119b8232ca079bc95b6abd78e35e1b7ce64  wp116/test_s158_….test.ts
6de3e629543cd94036c84c08cabdb141e5d297ac929c9b2a1569951396ecdc03  wp49/test_tp12_….test.ts
9cd470b28cbff05f6c28f6c19039dac4495859a7ce34c52018a1455a1a4c24d9  wp72/test_tp4_….test.ts
ba317feed54aedbfcaa721377d541e04c874a49f49e43481d8d7e6948802b8b1  wp123/test_tp05_….test.ts
```

| # | AC | plant | went RED | right reason? |
|---|---|---|---|---|
| **BK1** | **A5** | `readCanvasRecords`'s `unreadable()` returns `readable: true` — record extraction yields empty records on unreadable content and the clause compares empty-against-empty | **5** — `tp05a`, `tp05b`, `tp05c`, **`tp05d`**, `tp05e` | ✅ **and `tp05d` is the discriminator**: `expected true to be false` on `peersAgreeOnRecords` for two peers holding byte-identical UNPARSEABLE content. The vacuous green, executed. See §5.1 |
| **BK2** | **A6** | `"records"` deleted from the six-name fallback array (`:1103`) — the no-peer-reading branch | **2** — `wp123/tp06b`, `wp116` amended `tp05: no peers at all` (`:315`) | ✅ only the `no peers at all` row of `wp116`'s four fires, because the other three supply a reading and go through `judgeFileAgainstExpectation`, which still had the row. Precise, not partial |
| **BK3** | **A3** | the record comparison in `evaluateRecordAgreement` replaced by a `sha256` comparison | **5** — `tp03c`, **`tp03d`**, `tp04c`, `tp04d`, `tp04f` | ✅ `tp03d` is A3: three spellings, one verdict, and a byte-based implementation cannot pass it. **It also reddens A4's peer-side rows and NOT its expectation-side rows** — see §5.2 |
| **BK4** | **A4** | the position comparison drops `y` (both comparison loops; validation untouched) | **3** — `tp04a`, `tp04b`, `tp04c` | ✅ exactly A4. `tp04a`: the clause reads *satisfied* for a board whose card moved 199 px |
| **BK5** | **A7** | a clause row deleted from one branch (the unstated branch of `judgeFileAgainstExpectation`) | **8**, of which **5 are the AMENDED `wp116` ledger** — `tp03b` (`:232`), 3× `tp05` (`:315`), `tp06a` (`:347`) | ✅ the amended pin still guards. Also `wp123/tp06a`, `tp06c`, and `tp02b`'s split-ledger row |
| **BK6** | **A7** | a sixth, non-allowed import added to `e2e-control.ts` (`../canvas/canvas-schema`) | **2** — `wp49:130` **and** `wp72:54`, both `expected false to be true` | ✅ **both** amended allow-lists still guard. `wp44/tp12` correctly stayed green: it skips relative specifiers and is a package-level check, not an allow-list |
| **BK7** | **A5/A6** | a malformed `records` expectation reported as `stated:false / satisfied:null` instead of `stated:true / satisfied:false` | **2** — `tp05f`, `tp05g` | ✅ a caller who asked a question the oracle could not read must not get the answer of a caller who asked nothing |
| **BK8** | — | `evaluateRecordAgreement`'s `<2 readings` guard returns `agree: true` | **NOTHING** — 444 files / 3374 tests, all green | 🔴 **a finding.** See §5.3 |
| **BK9** | §3.4 | `peersAgree` given the record meaning (`agreeForVerdict`) instead of staying byte-exact | **4** — `tp05d`, `tp03c`, `tp03d`, `tp04d` | ✅ the disposition decision in §3.3 is guarded, not merely written down |

### 5.1 BK1 — where the degraded check is load-bearing, and where it is subsumed

**Reported precisely, because half of it is subsumed.** With BK1 planted, the records **clause** is *still*
`satisfied: false` for an unreadable board — because the expectation names `n1` and an empty parse has no
`n1`, so the named-node comparison catches it anyway. A row asserting only *"the clause is not satisfied"*
would have reddened **nothing** and would have been a green that cannot fail, in the instrument built to stop
greens that cannot fail.

The degraded check is load-bearing on the **agreement** side, and that is exactly the composition the charter
names: *"parse both sides, compare records" returns EQUAL for two files neither of which could be read.*
`tp05d` sets the trap deliberately — byte-identical unreadable content, so `evaluatePeerAgreement` (bytes)
reads `true`, the same shape as `S119`'s three clients — and asserts `peersAgreeOnRecords === false`. Under
BK1 that assertion is `expected true to be false`. **That is the discriminator of this package**, and the
clause's `detail` rows (`NOT EXAMINED`, `DEGRADED`, `no \`nodes\` ARRAY`) are the second, weaker leg.

*What a passing test would have done on the broken build:* a clause-only A5 row would have **passed**. It
would have measured nothing. The row was built to distinguish, not to describe.

### 5.2 BK3 — what it does not redden, and why

BK3 reddens A4's **peer-vs-peer** rows (`tp04c`, `tp04d`, `tp04f`) and **not** its **expectation-vs-board**
rows (`tp04a`, `tp04b`, `tp04e`). That is correct and it is structural: the two halves of A4 are two different
functions — `compareExpectedRecords` scores the reference reading against the expectation, and
`evaluateRecordAgreement` scores the peers against each other. BK4 is the plant that covers the first half;
BK3 covers the second. **Neither plant alone covers A4**, and a report claiming otherwise would be describing
one of them.

An intermediate version of BK3 that replaced only the **id-set** conjunct with `sha256` (leaving the field
loop live) reddened **4** rows and left `tp04c` green — because the field comparison still found `n1.y`. That
partial plant is on record because a plant that reddens the wrong thing is exactly the class this rule catches;
the row in the table is the complete one.

### 5.3 BK8 — the break that reddened nothing, and what I did about it

Flipping `evaluateRecordAgreement`'s `<2 readings` guard from `agree: false` to `agree: true` left the **whole
3374-test suite green**. Two reasons, and only one of them is benign:

1. `judgeConvergence` refuses a one-peer round as `UNJUDGEABLE` *before* anything acts on the verdict, so the
   value could not change an outcome. Subsumed — legitimate.
2. **But it is REPORTED.** `peersAgreeOnRecords` is on the `unjudgeable()` object, so a live tester reading a
   one-peer round would have seen `peersAgreeOnRecords: true` — *"the peers agree on the records"* with nobody
   to agree with. That is the reading this field exists to prevent, in the field that exists to prevent it.

Per §3.1 the answer to an empty break is not deletion: **`tp05h` was added to isolate it**, and with `tp05h`
in place the same plant reddens (`expected true to be false`). It is the only row in the package written
*because* a plant found nothing. Test count for this package therefore went 27 → 28.

---

## 6. Demonstrated vs argued (§3.7)

### Demonstrated — a test was written and run, and the number is from that run

- **The gap this closes**, proven on **unmodified HEAD before a line of the fix existed** (§3.9):
  `wp123/test_tp01_the_instrument_gap_is_demonstrated.test.ts`, 3 rows green at `eb16fa5`.
  - `tp01a` — three byte spellings (3 distinct digests, 3 distinct sizes) of one board whose records
    production's parser reads as identical; the shipped oracle returns **`DIVERGED`** with **zero clause
    violations**. Red for a board that is in sync.
  - `tp01b` — `contains: ['"x": 100']` is **CONVERGED** for the author's spelling, **AGREED_ON_WRONG_BYTES**
    for the canonical spelling of the *same* `x=100`, and **CONVERGED** for a board where `n1` actually moved.
    §3.2, executed.
  - `tp01c` — `parseCanvas` does not throw and returns `{}`; `parseCanvasReport(...).degraded` is `true`; the
    naive "parse both, compare" is **EQUAL** for two unreadable files.
- **Arm (b)'s price**: 0 geometry rows, `converged: true` over the wire on the moved board, 400 for the second
  command (§1).
- **A2–A6**: 28 rows in `v2/wp123/`, all green (§3, §5).
- **A7**: BK5 and BK6 — both amended pin families redden under a planted regression.
- **The two charter/brief arithmetic corrections** C1 and C2: measured by running the planted sixth row and
  the planted import.
- **The tree-shake is unaffected by the new static import**: `npm run build` then `grep -c` over
  `plugin/main.js` — `e2e-control` 0, `LIVESHARE_E2E` 0, `e2eControlPort` 0, `peersAgreeOnRecords` 0,
  `readCanvasRecords` 0, `evaluateRecordAgreement` 0, `judgeConvergence` 0.
- **Additivity**: `tp06d` asserts a pre-WP123-shaped caller still gets `CONVERGED` with `violations: []` and
  `peersAgreeOnRecords: null`; and the 3347 pre-existing tests are unchanged and green.

### Argued — no test was run for this, and the Dispatcher should not treat it as closed

- **The rejection of arm (c)** (dynamic `import()`) rests on one measurement and two arguments (§1). I did not
  build arm (c).
- **That the live rig will actually use the records clause.** The rule and the transport exist and are unit-
  tested; `tools/e2e/*.py` does not yet send a `records` expectation. This is WP116's residual R2, unchanged
  in kind by this package — see §8.
- **That the three byte spellings are 235 / 296 / 218 B on the live build.** That is `S174`/`S177`'s
  measurement, quoted; my fixtures are three hand-written spellings of my own, and what I measured is that
  three distinct spellings exist and parse identically — not those three sizes.
- **That `records` is the right vocabulary for edges as well as nodes.** The clause covers **nodes only**. See
  the residual in §8.

---

## 7. What I could not separate (§3.6)

1. **BK3 and BK9 overlap on three rows** (`tp03c`, `tp03d`, `tp04d`). Both plants make a byte fact decide a
   record question, from two different places, so those rows cannot attribute their red to one of the two. The
   rows that *do* separate them are `tp04c`/`tp04f` (BK3 only) and `tp05d` (BK9 only).
2. **`tp03c` measures A2's reachability and A3's spelling-independence in one row.** It states two spellings
   over the wire, so a failure there does not by itself say which of the two broke. `tp03d` isolates A3
   in-process; there is no in-process-only reachability row.
3. **The suite delta.** 3347 → 3375 is +28, and all 28 are in `v2/wp123/`. The amended packages ran 182 before
   and 182 after, which is what lets me say the test count did not change — but I measured that on the six
   packages I ran together (`wp116`, `wp49`, `wp72`, `wp117`, `wp123`, `t3/wp44`), not per-file.
4. **`S153`.** WP92's `no_collateral` was green throughout, including while uncommitted. It did not fire for
   WP121 or WP122 either, so **its silence here is evidence of nothing** and I do not cite it.
5. **The `origin` discipline is still a discipline, not a proof.** A caller can still derive a records
   expectation from a peer reading and write an honest-looking `origin`. This is WP116's residual, unchanged.

---

## 8. Gate — re-run by me, in the session in which these numbers are written

From `plugin/`, in charter order, on a quiet tree, alone:

```
./node_modules/.bin/tsc -noEmit -skipLibCheck        exit 0
./node_modules/.bin/vitest run                       444 files | 3375 tests | 0 failed
npm run build                                        exit 0
python workflowArtifacts/canvas-v2/check_signal_register.py
    scanned 249 files under canvas-v2/  (control: all classes proved)
    baselined debt: 136 citations across 62 keys
    clean - no NEW violations. (29 baselined citations have since gone)
                                                     exit 0
```

**Baseline re-measured by me at `eb16fa5` before touching anything: 440 files / 3347 tests / 0 failed,
`tsc` 0** — matching the Dispatcher's figure. Delta **+4 files / +28 tests**, all in `v2/wp123/`, all additive.

**Caveats I attach to this figure:**

- The checker's positive control printed *"control: all classes proved"*; without that line the run would be
  worth nothing and I would say so.
- `wp5/latency.test.ts` took 38.4 s, by design.
- `S88` does not apply — this package touches neither `file-ops.ts` nor `vault-events.ts`.
- `S175` does not apply — no `write(`-shaped call was added anywhere near `main.ts`; `main.ts` is untouched.
- `npx biome check --write` was **never** run.
- The gate above was run **after** every plant had been restored and each restore verified by whole-file
  sha256 (§5).

---

## 9. Files

**Changed (4):**

- `plugin/src/testing/e2e-control.ts` — the records clause, `readCanvasRecords`, `evaluateRecordAgreement`,
  `peersAgreeOnRecords`, the six-name fallback, headers. `evaluateCanvasConvergence` / `sameFileObservation` /
  `evaluatePeerAgreement` **behaviourally unchanged**.
- `plugin/src/__tests__/v2/wp116/test_s158_…test.ts` — A-123-1/2/3.
- `plugin/src/__tests__/wp49/test_tp12_…test.ts` — A-123-4.
- `plugin/src/__tests__/wp72/test_tp4_…test.ts` — A-123-5.

**Added (5), all under `plugin/src/__tests__/v2/wp123/`:** `boards.ts` (fixtures, hand-written),
`test_tp01_the_instrument_gap_is_demonstrated.test.ts` (3), `test_tp02_arm_b_is_priced_by_building_it.test.ts`
(3), `test_tp03_a_board_is_judged_by_its_records.test.ts` (10),
`test_tp05_a_board_that_was_not_examined_is_never_satisfied.test.ts` (12).

**Not touched:** any production behaviour, `BUILD_SPEC_CanvasV2.md`, `ARCHITECTURE.md`, `README.md`,
`docs/security.md`, `.bak` files, `canvas-presence.ts`, `main.ts`, and the three live vaults. No secret was
read, printed or fixtured; nothing in this package touches `data.json`.

**Charter contradiction, reported not resolved:** charter §7 says *"Do not commit. The Dispatcher commits."*;
the dispatch brief for B63 says *"Commit before you report."* I followed the brief and committed with
`git commit -o <explicit paths>`, no `git add -A`. If the charter is the operative instruction, the commit is
trivially revertible — it is one commit and it touches nothing else.

---

## 10. Handoff (Rule 13)

**Established, with file and line:**

- `readCanvasRecords` (`e2e-control.ts:651`) is the **only** place the rig turns a `.canvas` into records, and
  it returns `readable` first. Anything that adds a record question must go through it.
- `evaluateRecordAgreement` (`:796`) is `sameFileObservation`'s record-level sibling. `sameFileObservation`
  (`:329`) stays a byte test forever; the sentence saying so is on the function.
- `agreeForVerdict` (`:1107`) is the single line where a records expectation changes which agreement decides
  the verdict. It is the only behavioural switch in the package.
- The ledger is now **six** rows; the two places that must stay in step are `judgeFileAgainstExpectation`
  (`:957-1000`) and the fallback array (`:1071-1085`). BK2 is the plant that proves they are.
- The import allow-list exists in **two** files (§2 C1) and they must stay identical.

**Rejected, and why:** `recordSignature` for a geometry clause (key-order sensitive — measured in `tp01c`,
not argued); whole-record equality (same reason); `contains` as a geometry clause (`tp01b`); arm (b) (split
ledger, priced in `tp02`); arm (c), the dynamic-import dodge (§1, argued); relaxing any pin (five ledger
entries instead, §4).

**Residuals left, deliberately:**

- **R1 — nodes only.** `ExpectedRecords` names nodes; **edges have no records clause**. An edge defect is not
  judgeable by this instrument. Sized as a follow-up, not slipped in here.
- **R2 — the live driver still does not send a `records` expectation.** `tools/e2e/*.py` is unchanged (no
  rebuild, no deploy, per the brief). Until it does, `S174` is closed *at the rig* and open *at the driver*.
  This is the one thing W4 must do first.
- **R3 — `peersAgreeOnRecords` compares the named fields plus the node id set, not edges and not unnamed
  fields.** A board where only an unnamed field diverges reads as agreeing. That is deliberate (§3.1) and it
  is the price of not being a byte oracle; it should be stated in any report that quotes the field.
- **R4 — a records expectation must be `records: { nodes: [...] }`.** A bare array, a string, or a node naming
  no field is refused as a violation, not accepted. If the Python driver is written to send a flatter shape it
  will get a judged failure, not a crash — `tp05g` — but it will get a failure.
- **R5 — the NUL-byte hazard (§2 C4).** If a future worker sees an unexplained `M` on a source file with an
  empty or binary-looking diff, check for NUL bytes with `od -c` before anything else. `tsc` and `vitest` will
  not tell you.
