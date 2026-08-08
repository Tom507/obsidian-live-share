# WP123 — A board is judged by its records, not by its spelling

**Source:** `SIGNAL_REGISTER.md` **S178** (the blocker) closing **S174** (the instrument gap) ·
`ImplementationReport_WP122.md` §2 (where both obstacles were measured) · **Batch B62** ·
**Branch:** `toms_branch` · **Artifacts + test-surface only. No product behaviour changes.**

---

## 0. The goal, in one sentence

**The convergence oracle must be able to judge a canvas by its RECORDS — ids and node positions — so that
*"the guest moved a card and it reached the host"* is machine-judged instead of hand-parsed.**

Why this and not another live round: node position is what every remaining canvas defect is about — `S150`,
the selection defect, the whole convergence remodel. Today an expectation about geometry comes back
`unjudgeable`. Live runs are currently scored by a human reading JSON in Python, and a human reading JSON is
exactly how `S158` happened: an oracle that could not see a shared loss.

**This package does not fix a canvas defect. It builds the instrument that can see one.** Judge it on whether
the instrument can fail, not on how much of it there is.

---

## 1. The two pins — I verified both against the tree, and WP122 is right on both

| claim | verified | note |
|---|---|---|
| a sixth clause row reddens `v2/wp116/test_s158_…` | ✓ | the pin is the **clause-row ledger**, exactly as WP122 says |
| `:232` `expect(judgement.clauses).toHaveLength(5)` | ✓ | `tp03b`, 1 test |
| `:315` same assertion inside a `for (const row of cases)` loop | ✓ | `tp05`, 3 tests |
| `:347` `expect(judgement.clauses.map(c => c.clause)).toStrictEqual([…5 names…])` | ✓ | `tp06a`, 1 test → **5 failed total, WP122's figure reproduces on inspection** |
| `everyBranch` at `:334` is **not** the pin | ✓ | it is a list of `ExpectedContent` *shapes*; adding a field to the interface does not touch it |
| `wp72/test_tp4:33-39` freezes `e2e-control.ts` to five import specifiers, asserted at `:54` | ✓ | `ALLOWED_IMPORTS` = `node:http`, `node:crypto`, `yjs`, `../canvas/canvas-binding`, `../utils` |

**Three things WP122's write-up does not contain, all of which change the fork's arithmetic. Verify them
yourself before you lean on them.**

1. **Two more assertions in `wp116` look like pins and are not.** `:167`
   (`clauses.filter(c => c.stated && c.satisfied === true)` → `toHaveLength(5)`) and `:276`
   (`clauses.filter(c => c.satisfied === false).map(…)` → `toStrictEqual([…])`) both filter on `stated` /
   `satisfied`, so an **unstated** sixth row is invisible to them. The amendment surface is **three
   assertions in one file**, not five. Confirm before amending; do not amend what is already green.
2. **The import freeze is not a "no production imports" rule and never was.** `../canvas/canvas-binding` is
   already on the allow-list — `e2e-control.ts` already imports a production canvas module. What the freeze
   forbids is a *new* dependency arriving without deliberation, plus a second transport (`.listen(` ×1,
   `createServer(` ×1) and any canvas module knowing the rig exists. Note also that `parseCanvas` lives in
   `plugin/src/files/canvas-sync.ts`, and `wp72`'s third row enumerates `src/canvas/canvas-sync.ts` — **a
   path that does not exist in this tree** and is skipped by its own `existsSync` guard. So that row does not
   bite either way. Verify that yourself; it is load-bearing for arm (a).
3. **`e2e-control.ts` already contains private record-comparison machinery**: `recordSignature` (`:265`) and
   `sameRecordSet` (`:275`), used by `evaluateCanvasConvergence` on the **doc** projection. Whatever you
   build, say in one sentence whether you reuse them, and if not, why not. **And read `recordSignature`
   before you reuse it:** it hashes *every* key of a record, so a geometry clause built on it treats any extra
   or renamed field as a divergence. That is the byte-oracle failure one level up — see §3.1.

---

## 2. 🔴 The fork. Argue it; do not assume it. Weakening a pin to get a green is an abort.

**"The pin is blocking me, so I relaxed the pin" is `S162`'s shape**, and this initiative has already shipped
one test that pinned a defect. `wp116`'s ledger pin exists *because an oracle once could not see a shared
loss* — the same family as the problem you are fixing. Treat it with the suspicion you would want applied to
your own work.

**You must choose, in writing, before you write the clause:**

- **(a) Amend both pins properly.** Each amendment carries a `BUILD_SPEC` §7 amendment-ledger entry naming the
  assertion by **file · line · why-stale · post-amendment strictness**, under §7's two standing conditions:
  **strictness may not fall** and **the test count does not change**. An assertion rewritten without a ledger
  entry is an **abort criterion**, not a mistake.
- **(b) Land the record judgement somewhere that is not `ExpectedContent`'s clause ledger**, so neither pin is
  touched. Note what this costs before you pick it: `convergence.judge` (`e2e-control.ts:1440`) computes the
  judgement **inside** `e2e-control.ts` from the `content` the caller supplies, so an arm (b) that lives in a
  new module is unreachable from the surface the live tester actually calls — and **an instrument the live
  tester cannot reach does not close `S174`.**

**I am not choosing for you. My prediction, so you can falsify it:** **(a) is likelier to be right.** The
amendment is bounded and measurable — three assertions in one file, one allow-list entry, plus the hardcoded
five-name fallback array inside `e2e-control.ts:662-673` which is source, not a pin. Arm (b) buys "no pin
touched" with a **permanent** structural cost: a second parser with its own semantics inside the rig, plus a
split ledger where a caller reading `clauses` can get `converged: true` on a board whose geometry was never
examined. And arm (b) satisfies the *letter* of `wp72`'s freeze while defeating its *purpose* — a rig that
parses `.canvas` differently from production is `S158`'s family in a new place.

**Whichever you pick, price the other the way WP122 priced arm (b): by building enough of it to measure.**
An argued-only rejection is §3.7 "argued", not "demonstrated", and the report must say so.

**Abort criteria for this package:**
- Any `wp116` or `wp72` assertion rewritten without its §7 ledger entry.
- Any amended pin whose strictness falls — `toMatchObject`, `objectContaining`, a subset match, a bare
  key-count, `skip`/`only`, or destructuring the new row away.
- Any amended pin left unfalsified. An amended pin that no longer fails is worse than the one it replaced.
- Scoring a canvas on bytes or `sha256` (§3.1 below).

---

## 3. Constraints the design must respect

### 3.1 Never score a canvas on bytes

`S174`/`S177` context: **three stable byte forms exist for identical records** on this build — the author's,
the plugin's canonical, and Obsidian's own (**235 / 296 / 218 B**, measured live). A byte oracle is RED for
boards that are in sync and GREEN for boards that are not. **Records, always.** The same reasoning bars
whole-record equality as the geometry test: compare the **named** fields the expectation states, and report
what you compared.

### 3.2 `contains` is not a substitute

`"x": 111` vs `"x":111`. WP122 recorded this. A substring clause over JSON is a byte oracle wearing a
record's clothes.

### 3.3 Additive-only, in `S155`'s shape

A clause that was **not stated** must be distinguishable from a clause that was **stated and satisfied**:
`stated:false` / `satisfied:null`, never a bare boolean, and never an omitted row. **A branch that does
nothing must not read the same as a branch that never ran.** This applies to every branch, including the
no-peer-reading branch.

### 3.4 `peersAgree` is a byte test — decide its disposition and write it down

`peersAgree` is computed by `sameFileObservation` (`e2e-control.ts:302`), which compares `exists`, `sha256`,
`size` **and** `content`. It therefore cannot be reused as a record-level judgement, and under §3.1 it reads
`false` for two peers holding the same board in two spellings. **State in the charter's report whether you
leave it alone or give it a record-level sibling** — both are defensible; silence is not. If you leave it,
put one sentence in the file saying what a reader must not confuse it with.

---

## 4. Acceptance criteria

Every AC below is subject to §5's break table. **An AC with no plant is not accepted.**

**A1 — The fork is decided in writing, with the rejected arm priced by construction.**
One section: which arm, what it cost, what the other cost, and which half of that is *measured* versus
*argued* (§3.7). If arm (a): both §7 amendment-ledger entries, complete, in the implementation report.

**A2 — The oracle can judge geometry, and the live tester can reach it.**
An expectation can state, for a named node id, the position it is supposed to hold, and the oracle returns a
verdict rather than `unjudgeable`. **Reachable from the surface `WP119`'s tester uses** — `convergence.judge`
or a named sibling command on the same control server. Name the command and its argument shape in the report.
The expectation still carries a mandatory non-empty `origin`; a record expectation read off a peer is the
defect `origin` exists to make visible.

**A3 — Three spellings, one verdict.**
Two peers holding **byte-different but record-identical** boards satisfy the records clause. This is the row
that proves the clause is not a byte oracle, and it is the row a byte-based implementation cannot pass.

**A4 — The oracle can fail. Non-negotiable, and it is in this package.**
A board that genuinely diverges in **records** — one node moved, ids otherwise identical — comes back judged
as diverging, naming the id and the field. A records clause that only compares id *sets* passes every
geometry defect this project has; the AC is not satisfied by an id-set comparison.

**A5 — A board that was not examined never reads as satisfied.**
`content: null`, an absent file, and unparseable JSON must each produce a **violation or an explicit
unjudgeable** — never `satisfied: true`, and never a satisfied comparison of empty-against-empty. Note the
live trap: `parseCanvas` **degrades to empty records and does not throw** (`files/canvas-sync.ts:684` →
`parseCanvasReport`'s `catch`), so the naive composition *"parse both, compare"* returns *equal* for two
files neither of which could be read. `parseCanvasReport` exposes `degraded` precisely so a caller about to
conclude something from an absence has to have it.

**A6 — `S155`'s shape holds in every branch.**
The records clause reports `stated:false` / `satisfied:null` when nobody asked, in **every** branch including
the one that has no peer reading at all, and `satisfied` is `null` exactly when `stated` is false.

**A7 — If a pin was amended, the amended pin is shown still able to fail.**
Per §3.8's logic applied to this pin family: the amended `wp116` ledger assertion must redden on a planted
missing clause row, and the amended `wp72` allow-list must redden on a planted sixth, non-allowed import.
An amendment without its own falsification is an abort, not a finding.

---

## 5. The break table — Rule 11 / workflow §3.1

For **every** AC: break what the criterion protects, run the test, show it **RED for the right reason**,
restore **by copy-aside, byte-identically** (`git checkout` / `git stash` / `git restore` are forbidden —
a sibling's uncommitted work goes with them), show it **GREEN**. Report the break and what it reddened.

**A break that reddens nothing is a FINDING**, reported with its reason. WP120's, WP121's and WP122's break
tables are the standard — read `ImplementationReport_WP122.md` §3 before you write yours, including §3.1
where a plant reddened for a *different reason than predicted* and the charter was corrected by the report.

**The plant most likely to expose this package's own failure mode — plant it first.** The failure mode is
**an oracle that reports `satisfied` for a board it did not actually examine.** The plant: make the record
extraction return an **empty record set** on a content it could not read (`null` content, or malformed JSON)
and let the clause compare empty-against-empty. **A5's row must go red.** If it does not, the clause is
vacuous and every green it has ever produced is worthless — that is the discriminator, and it is the reason
this package exists rather than another live round.

Minimum plants, each named with what it must redden:

| # | plants | must redden |
|---|---|---|
| **BK1** | record extraction yields empty records on unreadable content | **A5** |
| **BK2** | the records row is omitted from the no-peer-reading branch | **A6** (and `wp116`'s S155 rows) |
| **BK3** | the record comparison is replaced by a `sha256` comparison | **A3** — and if it also reddens A4, say so |
| **BK4** | the position comparison ignores one coordinate (drop `y`) | **A4** |
| **BK5** | *(arm (a) only)* a clause row is deleted from one branch | the **amended** `wp116` ledger — A7 |
| **BK6** | *(arm (a) only)* a sixth, non-allowed import is added | the **amended** `wp72` freeze — A7 |

**Ask, for every row: what would a passing test have done on the broken build?** If the answer is "passed",
the row is not a discriminator and does not count. Build the discriminator into the AC, not into the prose.

---

## 6. Gate

From `plugin/`, in this order:

1. `./node_modules/.bin/tsc -noEmit -skipLibCheck`
2. `./node_modules/.bin/vitest run` — **plain**. `--reporter=basic` does not exist and fails to *load*.
3. `npm run build`
4. `python check_signal_register.py` → exit 0, with its positive control proved.

**Baseline: 440 files / 3347 tests / 0 failed**, Dispatcher-measured on a quiet tree at `26e10c7`. Confirmed;
use that figure.

**Hazards, all measured, none hypothetical:**

- `S153` — WP92's `no_collateral` is red while uncommitted and green once committed. **It did not fire for
  WP121 or WP122, so its silence proves nothing either way.** Do not cite it as evidence.
- `S88` — `v2/wp93/` census tests read the **live working copy** of `file-ops.ts` / `vault-events.ts`.
- `S175` — WP87's route census parses a call **argument** as a unit signature: it invents a phantom sink *and*
  reclassifies a real definer. If a `write(`-shaped call goes anywhere near `main.ts`'s attach, **name the
  first parameter anything but `diskPath`.**
- `wp5/latency.test.ts` takes ~38 s by design. Budget for it; it is not a hang.
- **Never `npx biome check --write`.** It corrupts this tree.

---

## 7. Scope, ownership, numbering

- **Owned:** `plugin/src/testing/e2e-control.ts` (or the new module, if arm (b)), the new
  `plugin/src/__tests__/v2/wp123/` package, and — **only under arm (a) and only with their ledger entries** —
  the three named assertions in `v2/wp116/test_s158_…` and the `ALLOWED_IMPORTS` set in
  `wp72/test_tp4_…:33-39`.
- **Not owned:** any production behaviour. This package changes what the rig can *see*, not what the plugin
  *does*. A product-source edit here is an escalation.
- **Do not touch `BUILD_SPEC_CanvasV2.md`.** If you find a contradiction with §7, **report it**; do not edit it.
- **Signals:** you allocate **none**. Describe findings in prose and hand the numbering to the Dispatcher. The
  checker is **line-based** — a citation and its meta marker must share one line, and this has already caused
  five violations in this run, two of them in Dispatcher-authored charters.
- **Do not commit.** The Dispatcher commits. If you must stage, `git commit -o <explicit paths>` and never
  `git add -A`.

---

## 8. What the report must contain

1. **Demonstrated vs argued, split** (§3.7). The fork decision belongs in one of those two columns explicitly.
2. **The break table**, with every empty break reported as a finding and its reason.
3. **What you could not separate** (§3.6), in the same breath as any number.
4. **The §7 amendment-ledger entries**, if any, complete enough for the Dispatcher to paste into the spec.
5. **The gate, re-run by you in the session you write the numbers down** (§3.2).
6. **Handoff (Rule 13):** what you established with file and line, what you rejected and why, and what you
   left as a residual.

**And one sentence, plainly, that the next reader can check:** *"an expectation stating node `X` is at
(`x`,`y`) is judged by the oracle, and here is the test that proves the oracle says NO when it isn't."*
