# Test Deprecation Ledger — B61 / Worker 1 (evaluation)

**Batch:** B61 · **Worker:** 1 (evaluation) · **Mode:** read-only proposal
**Date:** 2026-08-07 · **Branch:** `fix-bugs-and-raceconditions` · **HEAD:** `69c606e`
**Population:** 387 `*.test.ts` under `plugin/src/__tests__/` (+ 36 non-test `.ts` helpers)
**Signals allocated:** none. Next free remains **S104**.

> **This phase wrote nothing but this file.** No test was edited, deleted, staged, moved or
> skipped. Nothing was run against the working tree. Every verdict below is a *proposal* for the
> adversarial pass to attack.

---

## 0. The fact that governs the whole ledger, stated before any count

**At `69c606e` the suite is `2792 / 2792` tests, `387 / 387` files, zero failures**, measured on a
bracket-verified quiet tree (`DISPATCHER_STATE.md`, WP95 completion block; `git status` diffed
before and after the run and found identical and empty).

That single fact constrains category (A) more than any reading I could do:

> **A test asserting a property the design no longer has is RED.** There are no red tests. There
> are also **0 `it.skip` / `describe.skip` / `xit` / `.todo`** in the population (measured), and
> **0 files with no `expect(` at all** (measured). So no property was quietly parked, either.

Therefore (A) can only be populated from two much narrower sources:

| Source | What it would look like | Found |
|---|---|---|
| **A-i** | a test amended to assert the *new* behaviour, where the *old* case is now redundant | see §3 — every one I found is now a **live** assertion of the new behaviour, i.e. **(C)** |
| **A-ii** | a test green **because it cannot fail** — the property is gone and nothing noticed | **1 site found** (§4), and by the run's own rule it is a **rewrite, not a deletion** |

I want to be blunt about the shape of the answer before the counts, because the counts are the part
that gets acted on: **this evaluation proposes zero deletions.** Not "few" — zero. The reasoning is
per-candidate below, and §5 is where I say which of those calls is weakest.

### Tree state at the time of this evaluation — and why it matters to the verdicts

```
 M plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts
 M plugin/src/__tests__/v2/wp5v2/test_tp07_wiring_only_visible.test.ts
 M plugin/src/__tests__/v2/wp94/harness.ts
 M plugin/src/__tests__/v2/wp94/test_ac4_edge_and_combined_delete_visible.test.ts
 M plugin/src/canvas/canvas-shadow.ts        ← a sibling's in-flight PRODUCT edit
 M plugin/src/main.ts                        ← a sibling's in-flight PRODUCT edit
?? tools/e2e/liveshare_b59_*.py  (7 files)
```

**Two sibling batches are mid-edit.** I did not run the suite: a figure measured now would be a
measurement of *something else*, which is exactly the `S88` / `S102` lesson this run has already
paid for twice. Every claim below is derived from source reading, git history and the committed
reports — never from a run I performed.

One of those modified files is load-bearing for a verdict: **`plugin/src/canvas/canvas-shadow.ts`
is the file `v2/wp1/test_tp02_headless_purity_visible.test.ts` reads with `readFileSync`.** Right
now that test's verdict is a function of a sibling's uncommitted edit. That is not a hypothetical
argument for category (B) — it is the (B) failure mode happening in this working tree today.

---

## 1. Pass 1 — the mechanical census over all 387

### 1.1 What this pass is

**A classifier, not a verdict.** Every bucket below is a `ripgrep` predicate over file text. A
bucket says *"this file carries a signal worth a human look"*. It does **not** say the test is
wrong, obsolete, weak, or deletable. Files were promoted to pass 2 from these buckets; **no file
was categorised from a bucket alone.**

### 1.2 The buckets

| # | Bucket — the signal | Predicate (abridged) | Files | Promoted to pass 2 |
|---|---|---|---|---|
| **M1** | Reads **product source text** directly | `readFileSync` / `execSync` / `execFileSync` / `child_process` / `__dirname` / `process.cwd()` **and** a `src/`-rooted or `.ts` path | **47** | 47 |
| **M1b** | Reads product source **only via a shared census helper** | imports `./census`, `route-census`, `surface-route-census`, `wp83-source-derivation` and does no `fs` call itself | **2** | 2 |
| **M1c** | Reads a **data/fixture** file, not source | same `fs` predicate, no `src/` path | **3** | 3 (to confirm they are not M1) |
| **M2** | **Comment-stripping** before matching — i.e. a regex is being run over code | `.replace(/\/\*[\s\S]*?\*\//g, …)` or a named `stripComments` | **14** | 14 (all ⊂ M1) |
| **M3** | Depends on **git / a moving `HEAD` / the live working tree** | `execFileSync("git", …)`, `git diff`, `git show` | **1** | 1 |
| **M4** | **`.obsidian` path-string** fixtures — the WP95 blast radius | literal `.obsidian` | **21** | 21 |
| **M5** | Asserts on a **message / prose string** rather than a value | `toMatch(/… …/)` with a space, or `toContain("word word")` | **27** | 27 |
| **M6** | **Sleeps** instead of waiting on an observable | `await sleep(` / `await delay(` | **1** file, 8 sites | 1 |
| **M7** | Names a **work package other than its own directory** | `WP3[6-9]|WP4x|WP5x` outside that dir | **63** | sampled, see §1.4 |
| **M8** | Explicit **deprecation marker** | `DEPRECATED` / `@deprecated` / `OBSOLETE` / `SUPERSEDED` | **0** | — |
| **M9** | Self-declared **characterisation** test (pins behaviour, not a requirement) | `characterisation` / `characterization` | **2** | 2 |
| **M10** | **Green-that-cannot-fail** shapes | `expect(typeof x).toBe(…)`, `expect(Array.isArray(…))`, `toBeGreaterThanOrEqual(0)`, `expect(true).toBe(true)` | **~30 sites / 24 files** | all sites read |
| **M11** | **Skipped / parked** | `it.skip` / `describe.skip` / `test.skip` / `xit(` / `.todo(` | **0** | — |
| **M12** | **No oracle at all** | file with zero `expect(` | **0** | — |
| — | **Union of M1–M6 + M9** | | **79** | **79** |
| — | **No census signal whatsoever** | | **308** | not read |

### 1.3 The stated limits of pass 1 — read these before quoting any number above

1. **It is text matching.** A test can hold a dead property with no signal at all: assert a stale
   *value*, drive a stale *scenario*, or use a stale *fixture constant*. Bucket M0 (308 files) is
   **unexamined**, not **cleared**. Nothing in this ledger licenses a claim about those 308.
2. **M5 is the weakest bucket by a distance.** Reading all 27, the large majority are assertions on
   a **structured `reason` field returned by a decision function** — `planCanvasDrain(...).reason`,
   `manifest-purge-decision`'s `v.reason`, `fileop-inject`'s `out.reason`. That is a **return value
   with a documented contract**, not a log line. Only a handful are genuine prose oracles
   (`wp28/tp05` `/Live Share/`, `wp68/tp02`'s refusal match). The bucket over-reports by roughly 4×.
3. **M7 over-reports almost completely.** In this repo a cross-WP reference is overwhelmingly a
   *provenance comment* ("this preserves WP64's oracle"), which is the opposite of rot. I sampled
   it rather than reading all 63, and I found **no** case where the reference marked a dead
   property. **I did not exhaustively clear M7** — see §5.
4. **M1 vs. the ~51 in the brief.** I measure **47 direct + 2 helper-only = 49**. The gap to the
   brief's ~51 is a boundary question (whether the 3 fixture-readers of M1c and the two helper
   modules themselves are counted), not a disagreement. Treat 47–52 as the same set.
5. **M6 = 1 is a real number, not an error.** The Sleep-as-Wait sweep (B39, S56) already converted
   49 of 61 in-scope sleeps — and its census lived in the `H:\tmp\liveshare_*.py` E2E scripts, not
   in `plugin/src/__tests__/`. The unit suite was already clean of this class before I looked.
6. **The census cannot see a test that is wrong about a *runtime* property.** That is category (D)
   by construction and I have not tried to fake it.

### 1.4 What the census found that a reader would not predict

- **`M8 = 0`.** Not one file in 387 is marked deprecated, obsolete or superseded by its own author,
  in a run that has produced 95 work packages and 231 artifacts. The population contains no
  self-identified deprecation.
- **`M11 = 0` and `M12 = 0`.** No parked test, no test without an oracle.
- The `.obsidian` bucket (M4, 21 files) — the one place a confirmed (A) was expected — contains
  **zero surviving admission assertions.** See §3.

---

## 2. Pass 2 — the ledger

Every promoted candidate lands in exactly one of (A) / (B) / (C) / (D).

### 2.1 Category (B) — WRONG METHOD, LIVE PROPERTY · **NOT deletable**

These check a real, current property by reading source text instead of running the product. **All
47+2.** Rather than 49 near-identical rows, they are grouped by property family; the property, the
method defect, and the proposed method change are stated per family, and the individually
interesting ones are broken out.

| Family | Files | The live property | Why the method is wrong | Proposed method change |
|---|---|---|---|---|
| **Module purity** — `wp1/tp02`, `wp2/tp05`, `wp3/geometry_keys_drift`, `wp14/tp12`, `wp24/tp12` | 5 | *"the pure core imports nothing from Obsidian, the filesystem or a clock"* (BUILD_SPEC §3 D12) | regex over comment-stripped text; `wp1/tp02` says so itself — a runtime probe would pass for a module that *does* use `document`, because Vitest's node env has none. So source **is** the right layer; **regex** is the wrong instrument. And its subject file is being edited by a sibling **right now** (§0). | Extract specifiers with the **TypeScript AST** or `es-module-lexer`, not `String.replace` + `matchAll`. Resolve against the **built module graph** so a transitive Obsidian import is caught too — the current check is direct-imports-only. |
| **One predicate, one definition** — `wp26/tp09`, `wp68/tp05` | 2 | *"the guard is spelt once and imported, never restated"* — the exact failure `protected-paths.ts:88-92` documents ("a restated list is how a guard and its test come to disagree") | text scan for a second spelling | AST identifier-resolution over the same file set; the property is structural and deserves a structural oracle. |
| **Derived census** — `wp83/tp02`, `wp83/tp03`, `wp86/tp01`, `wp87/tp01`, `wp88/ac1,ac2,ac3,ac6`, `wp92/tp01,tp03,tp04,tp05`, `wp93/tp01,tp03,tp04`, `wp95/tp01` | 17 | *"the set of call sites / routes / sinks is CLOSED"* — an enumeration that must be derived, never hand-listed | derivation is regex-over-source in `census.ts` / `route-census.ts` / `surface-route-census.ts` | Same helpers, AST-backed. **The helpers are the leverage: repair 5 modules and 17 tests improve.** |
| **Structural seam / no-new-dependency** — `wp82/structural_seam`, `wp49/tp10,tp11,tp12,tp9`, `wp72/tp1,tp2,tp4`, `wp44/tp12`, `wp5v2/tp07`, `wp22/tp04,tp05`, `wp21/tp01,tp04,tp05`, `wp25/tp09`, `wp16/tp8`, `wp37/tp04`, `wp81/tp04,tp05`, `liveness/tp01`, `canvas-single-writer` | 24 | *"the break seam is unreachable in a production build"*, *"no runtime dependency was added"*, *"exactly one `.listen(` call site"*, *"the fallback IS the default, by reference"* | pinned regexes over `src/**` — `wp82` pins `/new WebSocket\(url\)/` and a 80-char `[\s\S]{0,80}` window; any refactor reddens it without any property changing | Where a build fact is claimed (`wp72`, `wp49`), assert on the **built bundle** (`esbuild` output), which is what the report already measures by hand. Where a call-site count is claimed, use the AST. `wp81/tp05` is the best of this family — it already asserts a *relationship by reference* rather than a literal; make it the pattern. |
| **Test-suite hygiene meta-scan** — `wp21/tp06` | 1 | *"after WP21's deletion, no test file still reaches for the removed seam"* — a genuine and genuinely mechanical invariant, and it is the one property here that **must** be a source scan | it scans the **live** `__tests__` tree, so any sibling's in-flight test edit can red it. It is also fail-closed by design, which is right. | Keep the scan; pin it to a **git revision** (`git show HEAD:<path>`) rather than the working tree, so it measures the committed suite and not whoever is typing. |
| **git / working-tree scope policing** — `wp92/tp06` (and by shape `wp68/tp04`, `wp91/tp06`, `wp93/tp05`, `wp94/ac8`) | 1 measured + 4 by shape | *"no out-of-scope file carries a WP92 line"* — attributable-in-a-shared-tree, and its own comment explains why `git diff HEAD` was rejected as an oracle | `execFileSync("git", …)` over a **moving `HEAD`**, plus `expect(src).toMatch(/const DISK_WRITE_SETTLE_MS = 250;/)` — a source literal that reddens on a whitespace change | This is the textbook `S88` shape. The scope-policing half is a **CI/process check, not a unit test** — it belongs in a pre-merge script. The `MAX_MUTE_MS` half should **export the constant** (or a `describeCeiling()`) so the test can read a value instead of a line. |

**Not one of these is a deletion candidate.** Each removes real coverage if deleted. The method is
the defect; the property is live. This is the largest single finding of the batch and it is a
**repair backlog, not a deletion list**.

> Reading these 49, I want to record something in their favour, because a "wrong method" verdict
> reads harsher than the code deserves: the majority **already carry a positive control** ("Rule 15
> is observed throughout: every row that reports an ABSENCE also proves its own pattern matches a
> known-present line, in the same test" — `wp82`). They are fragile, not vacuous. That distinction
> is the whole point of the (B) bucket.

### 2.2 Category (C) — VALID · leave alone

| File · case | Assertion, one line | Why (C) and not (A) |
|---|---|---|
| `v2/wp26/test_tp06` · *"does not swallow near-miss siblings"* | `isSidecarPath("…stateful/notes.md") === false`, and the ordinary-space twin `isSharedPath("notes/liveshare/stateful/board.canvas") === true` | **This is the split the brief cites, already landed at `5dcbf26`.** The dead half (`.obsidian/…` admitted) is now asserted `false`; the live half (no prefix over-match) moved onto the predicate directly. Nothing left to delete. |
| `v2/wp26/test_tp06` · *"sharedFolder points into the config directory"* | `isSharedPath(".obsidian/snippets/theme.css") === false` + a *separate* manager as positive control | Ruled at `5dcbf26`. The consequence ("this configuration now shares **nothing at all**") is asserted explicitly so a later reader cannot mistake the empty result for a bug. |
| `v2/wp26/test_tp06` · *"keeps excluding the default-config-dir case (characterisation)"* — **M9 hit** | every `SIDECAR_PATHS` entry and `.trash/deleted.md` are excluded | The one self-declared characterisation test. It characterises behaviour WP95 **strengthened**, not removed — it is now over-determined (two independent gates refuse), which is redundancy, not deadness. Deleting it would remove the only assertion that `.trash` is still excluded. |
| `v2/wp68/test_tp02` · six refusal rows | `warned` matches `/PROTECTED PATH REFUSED\|refused remote rename/i` **and** contains `arm=file-op-gate` | Amended at `5dcbf26` (cosmetic, behaviour byte-identical). The new form is **stronger**: the old prose oracle could not tell which guard fired. |
| `v2/wp68/test_tp04` · relocated ADMITTED rows | the two `.obsidian`-rooted near-miss rows moved from ADMITTED to their own REFUSED rows, same two oracles | The change is asserted **in both directions** instead of appearing as two deleted lines. Falsified: BR3 reddened 34, proving the moved rows still bite. |
| `v2/wp90/test_tp06` · configuration 3 | `inside.isSharedPath(".obsidian/notes/hello.md") === false` | Same ruling, same shape, already flipped. |
| `w4-canvas-integrity` · **M1** `setActiveFile` guards the bare-path `getDoc` | `reached === false` **plus** `guardConsults …).toEqual([true])` | Its own comment: WP27 AC4 made the original assertion *"a characterisation of a defect that no longer exists"*, and it was **re-pointed at the guard rather than deleted**. It is now a second independent pin on AC4 from a file WP27 does not own. **This is the precedent that governs this whole ledger.** Note the second `expect` — without it, `reached === false` would also be satisfied by `setActiveFile` never running. That is a correctly-built oracle. |
| `wp5/latency.test.ts` · *"caret + idle lock survive >30 s"* — **M6 hit** | after `await sleep(33_000)`: caret present, lock held, `canWriteNode("n1") === false` | The **subject of the test is the passage of 33 s** past the y-protocols 30 s prune window. There is no observable to wait on instead — the property *is* "nothing happened for 33 seconds". The other 7 sleeps in the file are settle margins protecting negative assertions, which B39 explicitly classified as the legitimate minority (5 of 61). **Cost note, not a defect:** this file spends ~45 s of wall clock. |
| `types.test.ts` · defaults contract | `DEFAULT_SETTINGS.debugLogPath === ".obsidian/live-share-debug.md"` | Restating the literal is the *point* of a defaults test — it is the tripwire for an accidental change. Verified against `types.ts:174`. Its comment already records the one time it drifted (`7754ac6`) and that it was corrected rather than left red. |
| `exclusion.test.ts`, `manifest.test.ts`, `fileop-inject.test.ts` (M4) | `.obsidian/**` is **excluded** / a rename **into** `.obsidian/plugins/live-share/` is refused | All assert exclusion/refusal — the direction WP95 **widened**. Unaffected. |
| `v2/wp24/test_tp01` | `isSidecarPath(".obsidian/liveshare/state/…") === true` | Looks like an `.obsidian` admission at a glance and **is not**. `protected-paths.ts:117-122`: the predicate *"governs INBOUND PEER OPERATIONS ONLY. The plugin's own writer still writes its sidecar under `.obsidian/liveshare/state/**`, and must."* Two different questions. **This is the single most likely place for the adversarial pass to find me wrong in the other direction, so I am naming it.** |

### 2.3 Category (D) — UNDECIDABLE without running it

| File · case | Assertion | Why (D) |
|---|---|---|
| The **308 files with no census signal** | — | **Not read.** A dead property with no textual signal is invisible to pass 1, and pass 2 was scoped to the promoted set. I will not guess. Bounding these needs either a full read or a mutation run, and neither was affordable here. |
| `wp5/latency.test.ts` · remaining 7 sleep sites | various settle margins | Whether each margin is load-bearing was established for the suite **as a whole** by B39, and B39 found the canvas suite verdict changed `21/21 → 16/20` *only when waits were allowed to end early*. Per-site, in this file, I did not re-derive it. Do not act on these without the run. |
| M7's 63 cross-WP references | provenance comments | Sampled, not exhausted. No rot found in the sample; the sample does not clear the set. |
| `wp91/tp06`, `wp93/tp05`, `wp94/ac8` scope-policing rows | *"no out-of-scope file carries a WP-N line"* | Classified **by shape** from `wp92/tp06`, not read individually. I expect (B); I have not established it. `wp94`'s files are being edited by a sibling right now, so reading them would tell me about the sibling, not the test. |

### 2.4 Category (A) — OBSOLETE · **deletable**

**None.**

The brief named one confirmed (A): *fixtures asserting a path under `.obsidian/**` must be
**admitted**, true only under the narrow guard WP95 replaced.* That family was located, and it is
**already resolved in-tree** — by **splitting**, at `5dcbf26` and `baa9aa0`, before this batch
opened:

- `wp68/tp04` — the two `.obsidian`-rooted near-miss rows **moved** from ADMITTED to REFUSED, with
  the same two oracles, *"so the change is asserted in both directions instead of appearing as two
  deleted lines."*
- `wp26/tp06` — property 1 (no prefix over-match) re-pointed **onto the predicate**; property 2
  (such a path is shared) **moved** to `NEAR_MISS_SHARED = _liveshare-test/liveshare/stateful/board.canvas`,
  the same near-miss shape outside the protected tree.
- `wp90/tp06` configuration 3 — same shape, flipped to `false` with the consequence named.
- `wp68/tp02`'s six rows — cosmetic only; behaviour byte-for-byte unchanged.

**Verified independently, not taken from the commit message.** I grepped all 21 M4 files for a
surviving assertion of the form *"a path under `.obsidian` is shared / admitted"*. **There are
none.** Every `.obsidian` assertion in the suite today is either an **exclusion/refusal** (the
direction WP95 widened) or an assertion about `isSidecarPath`, which is a different question
(§2.2, `wp24/tp01`).

So the one confirmed (A) the brief handed me **no longer exists as a deletion candidate** — it was
converted into live coverage of the new behaviour, which by rule is category (C).

**And no second (A) was found.** Each of the three accountings is unavailable for every candidate I
examined:

1. *"The property is obsolete"* — would require a red test. There are none (§0).
2. *"The property is covered elsewhere"* — I could name a specific holder in several places
   (`wp26/tp06` holds the predicate coverage `wp68/tp04` cannot isolate; `w4` M1 holds a second pin
   on WP27 AC4). But in every such case the candidate is **not redundant with** the holder — it
   asserts from a different file, a different seam, or the other direction. Redundancy is not what
   I found; **complementarity** is.
3. *"The property is real and would become uncovered"* — this is the accounting that applies, and
   by the brief's own rule that is **a rewrite, not a deletion**, and it moves out of (A). It is
   why §2.1 has 49 rows.

---

## 3. The one green-that-cannot-fail I found — and why it is still not an (A)

**`w4-canvas-integrity.test.ts:1759`**, case **M2** *"flushWrite genuinely IS gated on an armed
write timer (W3's claim holds here)"*:

```ts
const reached = getDoc.mock.calls.map((c) => c[0]).includes(PATH);
expect(typeof reached).toBe("boolean");
```

`Array.prototype.includes` returns a boolean. **This assertion cannot fail** — not for any product
change, not for a broken harness, not if `handleLocalTextModify` throws before the spy is ever
consulted. The title claims a gating property. The oracle asserts a JavaScript language guarantee.

Sitting beside it is M1 (§2.2), which is a *correctly* built oracle — it explicitly adds the
`guardConsults` check because *"without this, the assertion above would also be satisfied by
`setActiveFile` never running."* The same file gets it right one case earlier. This is the run's
dominant defect class, and this is the twelfth-plus instance.

**Disposition — and this is the part I want the adversarial pass to check hardest.** The row's own
comment says the doc acquisition here *"IS the R10 fallback path and legitimately acquires a doc —
that is by design, not a defect. Recorded, not asserted as a defect."* So the author knew it was a
recording, not an assertion, and said so in place. That makes it **honest but mis-titled**, not
dishonest.

Applying the rule literally: is the property (*"flushWrite is gated on an armed write timer"*)
obsolete? **No** — nothing removed it. Covered elsewhere? **I cannot name a file and case that
holds it**; I looked and did not find one. Real and would become uncovered? It is *already*
uncovered — deleting the case removes nothing, but it also **removes the visible marker that the
gap exists**, and an invisible gap is worse than a labelled one.

**Verdict: not (A). It is a rewrite** — assert the gating (drive an armed timer, then a
disarmed one, and require the doc acquisition to differ) **or** retitle the case to what it
actually does (*"handleLocalTextModify's R10 fallback acquires a doc — recorded, not asserted"*)
so the title stops promising an oracle that is not there. **The one thing not to do is delete it
silently**, which would convert a labelled gap into an unlabelled one — the strongest possible
version of the defect class this run exists to kill.

---

## 4. Summary table — and it deliberately has no headline deletion number

| Category | Count | Meaning |
|---|---|---|
| **(A) OBSOLETE — deletable** | **0** | with the three accountings applied, none survives |
| **(B) WRONG METHOD, LIVE PROPERTY** | **49** | 47 direct source-readers + 2 helper-only. **Repair backlog. Deleting any of these silently removes real coverage.** |
| **(C) VALID** | **11 files / 13 cases examined** | incl. the entire WP95 `.obsidian` family, already split rather than deleted |
| **(D) UNDECIDABLE** | **308 unexamined + 4 shape-classified + 7 sleep sites + 63 sampled M7 refs** | honestly unbounded; see §2.3 |
| **Rewrites (not deletions)** | **1** | `w4-canvas-integrity` M2, §3 |

**Read that table with §0.** A count of deletable tests without its reasoning is precisely the
artifact that gets acted on carelessly, so the number that matters here is not "0 deletions" — it
is **"49 tests whose method should change and whose coverage must not be lost."**

---

## 5. The calls I am least sure about — start the adversarial pass here

Ordered by how much I would want them attacked. None of these is an (A) I am proposing; they are
the places my **(B)/(C)/(D)** calls are weakest, which is where a wrong (A) would come from next.

1. **`v2/wp24/test_tp01` — I may be wrong in the *permissive* direction.** I classified
   `isSidecarPath(".obsidian/liveshare/state/scratch.tmp") === true` as (C) on the strength of the
   `protected-paths.ts:117-122` comment that the protected predicate governs **inbound peer ops
   only** while the local sidecar writer must still write there. **I verified that from a comment,
   not by driving both paths.** If the local writer is in fact now gated — or becomes gated — this
   is a live conflict I have called safe. *Attack: drive a local sidecar write and an inbound peer
   op at the same path and confirm they get different answers.*
2. **The 4 shape-classified scope-policing tests** (`wp91/tp06`, `wp93/tp05`, `wp94/ac8`, and
   `wp68/tp04`'s structural half). I read `wp92/tp06` and generalised. Generalising from one file
   is exactly the move that produced this run's fixture collision. Two of these live in files a
   sibling is editing right now. *Attack: read them; I did not.*
3. **The 308 unexamined files.** My (A)=0 claim is a claim about the ~79 files I looked at, plus an
   inference from suite greenness. The inference is strong but it is an inference. A test can be
   green, signal-free, and still assert something nobody wants any more. *Attack: if a real (A)
   exists in this repo, it is most likely in here, and a mutation run would find it faster than
   reading would.*
4. **`w4-canvas-integrity` M2 (§3).** I called it a rewrite, not a deletion, partly on the argument
   that a labelled gap beats an unlabelled one. That argument is a **judgement about
   maintainability**, not a property accounting, and it is the softest reasoning in this document.
   If someone can name the file and case that already covers *"flushWrite is gated on an armed
   write timer"*, accounting 2 applies and M2 becomes a genuine (A). **I looked for that holder and
   did not find it — but I did not search exhaustively.**
5. **M5's 27 files.** I dismissed most of the bucket as structured-`reason` assertions after
   reading the grep output, not after reading each file's contract. If any of those `reason`
   strings is in fact a free-form log line rather than a documented return value, that row is a
   text oracle I have waved through as (C)-by-omission.
6. **M7's 63 cross-WP references — sampled, not exhausted.** The bucket most likely to hide a real
   (A), and the one I did least work on. A test in `wpN/` asserting a property `wpM/` later
   replaced would show here and nowhere else.
7. **The greenness claim itself.** I did not run the suite — deliberately, because two siblings are
   mid-edit and the number would be a measurement of something else. Everything in §0 rests on
   `69c606e`'s commit message and `DISPATCHER_STATE.md`. That figure was bracket-verified by its
   author, and this run has already voided one figure that was not. **But I am consuming a
   measurement, not making one, and every (A)-related conclusion in this ledger inherits that.**

---

## 6. Recommendations — none of them is a deletion

1. **Do not delete anything from this population on the strength of this pass.** The one family the
   brief flagged was already handled, correctly, by splitting.
2. **Repair the 5 census helper modules first** (`v2/wp92/census.ts`, `v2/wp93/census.ts`,
   `v2/wp87/surface-route-census.ts`, `wp88/route-census.ts`, `v2/wp83/wp83-source-derivation.ts`).
   Moving them from regex to AST improves **17 tests for 5 edits** — the highest ratio available.
3. **Pin every source-reading test to a git revision instead of the working tree.** `wp21/tp06` and
   `wp92/tp06` are the `S88` class by construction, and `wp1/tp02` is demonstrating it in this tree
   today (§0). This is a one-line change per test and it removes an entire failure mode.
4. **Move scope-policing (`no_collateral` structural rows) out of the unit suite into a pre-merge
   script.** *"Did this batch touch a file it should not"* is a process question with a moving
   answer; it does not belong beside product assertions and it is why a unit test shells out to git.
5. **`w4-canvas-integrity` M2: rewrite or retitle (§3). Do not delete.**
6. **If a real (A) is wanted, the instrument is a mutation run, not a reading pass.** Deleting each
   candidate and requiring the suite to *stay green* is the only evidence that actually discharges
   accounting 2 — and it is cheap to run per-file. This ledger could not produce that evidence,
   because the tree is not quiet enough to trust any run performed in it.
