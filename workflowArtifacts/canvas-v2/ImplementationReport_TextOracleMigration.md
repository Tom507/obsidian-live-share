# Implementation Report — Text-Oracle Migration (WP36 follow-up)

**Batch:** B32 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Authority:** the Dispatcher's ruling on `ImplementationReport_WP36.md` §5.1 (ESCALATE) and §5.4
(the deferred `text-edit` op). Not a work package — a ruled follow-up.

---

## 0. Summary

| | |
|---|---|
| **The ruling** | **UPHELD, with two corrections to its supporting premises.** Every one of the 13 reddened assertions encodes *"`text` is a whole-string LWW register"*, the property C36 was chartered to remove. None is weakened. |
| **Assertions re-oracled** | **13** — 7 direct doc reads + 6 fuzzer test files (2 assertion families, judged over 4 op classes). |
| **RED-on-old-behaviour** | **Executed, not argued.** New seam `CanvasSync.setCollabTextEnabled(false)` reproduces the pre-WP36 register. 8 paired controls run the migrated assertion against it and require it to **throw**; the fuzzer band produces **204 `[text-merge]` + 137 `[lww]` violations** on the old behaviour and **0** on the new one. |
| **Could any NOT be made strictly stronger?** | **One clause, named and quantified in §4.2** — the `[lww]` value check for a *diverged* text slot. Its strength is moved, not lost: the pair `[lww] ∧ [text-merge]` is strictly stronger than the pair it replaces. |
| **`text-edit` op** | **`textEditViaSave`**, registered, `reaches: ["WP36","WP4","WP17"]`, drawn **50 log entries / 25 concurrent pairs** in the green band. |
| **Unit suite** | **2340 tests, 2340 pass, 0 fail, 334 files** — measured by `npx vitest run` from `plugin/`. Was **2331 / 2318 / 13** at `44dabf2`. |
| **Build gate** | `npx tsc -noEmit -skipLibCheck` **exit 0** · `node esbuild.config.mjs e2e` **exit 0**. Run separately, on purpose — see §7.2. |
| **§7 licences** | **NONE taken as a deletion or a skip.** No test deleted, skipped or retitled. 13 assertions rewritten **under the Dispatcher's explicit ruling**, each with an executed red control. **9 tests added.** |
| **Live E2E** | **NOT RUN — deliberately, reasoned in §7.3.** No product behaviour changed; running it would have contended for `plugin/main.js` with no measurement to gain. |
| **Self-inflicted incident** | **S46-class, mine, §7.2.** `npm run build` overwrote the shared `plugin/main.js` with a production bundle. Restored to an e2e bundle; digest recorded. |

---

## 1. Verifying the ruling before implementing it

The Dispatcher asked to be checked rather than obeyed. Four claims were re-measured.

### 1.1 "No `[byte]` family and no convergence family fails" — **TRUE**

Measured at `44dabf2` (`npx vitest run`, 2331 tests): of 13 failures, the violated fuzzer families are
**exactly `[lww]` and `[intent-trace]`**. Zero `[sec]`, `[bytes]`, `[schema]`, `[shadow]`, `[i7]`.

Independently re-measured in `test_tp12`, which runs the **whole pre-WP36 band** and asserts, per
scenario, that no convergence family fires. It passes. **The character loss is provably invisible to
every convergence oracle** — which is the whole reason a stronger family had to be built rather than
convergence re-asserted.

### 1.2 "Both violated families encode whole-string LWW" — **TRUE**

- `[lww]` fires from `checkRecorded`'s `Object.is(admission.landed, admission.intended)` — *"my whole
  string is what my doc holds"*. That is the register, stated as an assertion.
- `[intent-trace]` fires from two arms: the **determinate** arm (*"the converged value equals what the
  LAST op wrote"* — last-writer-wins, by name) and the **contested** arm (*"the winner is one of the
  values somebody wrote"* — satisfied precisely when one author's edit is destroyed).
- The codebase anticipated it: `standard-ops.ts:552-555`, on `relabelViaSave`, says *"P1 `text` is a
  plain LWW string field. COLLABORATIVE TEXT EDITING … does NOT exist yet — that is WP36 … It is not a
  stand-in for it."*

### 1.3 "The value is correct in every case; only the representation changed" — **FALSE in 2 of 13**

WP36's report inferred this from vitest's truncated `expected YText{ _item: Item{ …(11) }, …(9) }`,
which never renders the string. Rendered, two of the thirteen hold a **different value**:

| site | old value | actual value now | why |
|---|---|---|---|
| `wp5v2/test_tp01 T4` | `"gamma"` | **`"betgamma"`** | The test replaces the shadow with an **empty** one, so the capture has no third operand. C36 §5.3's **no-base branch is insert-only by design**: with no base there is no way to distinguish *"the user deleted `beta`"* from *"a peer added `beta` after I last looked"*, and AC3's absolute rule is that a capture never deletes a character it did not observe deleted. `beta` + `gamm` merged on the shared suffix `a`. |
| `wp6/chaos_degraded_adapter D1` | `"contested"` | **`"peer two"`** | `setShadowRebaseEnabled(false)` disables the classification inside `planIntentDiff`, but `writeCollabText` reads its base from the **Surface-Shadow directly**. base === next ⇒ verdict `"identical"` ⇒ **zero ops**. The stale text is not pushed back at all. |

**The second one is a finding, not a nuisance:** WP36 closed the text half of WP6's degraded-adapter
leak through a **second, independent mechanism**, and nobody had noticed. That test's `x` half still
discriminates; its text half now records the protection instead of the leak.

Both remain *superseded by design* — the old values were the register's behaviour — so the ruling
stands. Its premise did not.

### 1.4 "The fuzzer's cascade is a harness-semantics mismatch" — **TRUE, and it was fixable at source**

WP36's report said the fuzzer *"re-authors every replica's edits as every other replica's local
intent, which is idempotent under LWW and is not under character merge."* Confirmed, and located
exactly: `buildSurface` built **every** replica's save from the **global** `IntentTrace`, so replica 2's
`.canvas` carried replica 3's text edits as replica 2's own local intent. Under a register, re-`set`ting
the same string is a no-op. Under a merge it is a fresh contribution — which is how one
`staleObsidianSave` carrier string ended up in the converged value **three times**:

```
"edited w2 by r1stale-carrier w7 r3tale-carrier w7 r3tale-carrier w7 r3"
```

**Fixed at the source rather than absorbed into the oracle** (§3.1). A harness whose inputs are
dishonest cannot be repaired by relaxing its judgements.

**Conclusion: the ruling is implemented, not escalated.**

---

## 2. The 7 direct assertions

Each read `record.get("text" | "label")` off the `Y.Map` and compared it to a string with `Object.is`
— the hard `typeof === "string"` narrowing `V2Node`'s docstring forbids (`canvas-registers.ts:148-152`).

### 2.1 What the new oracle asserts that the old one did not

New shared helper `plugin/src/__tests__/harness/collab-text.ts`:

```ts
collabText(value) -> { shape: "ytext" | "string" | "absent" | "other", text: string | undefined }
```

The migrated assertion is one `toEqual` carrying **both halves**:

| | old oracle | new oracle |
|---|---|---|
| value | `Object.is(field, "edited")` | `text === "edited"` — **byte-identical requirement**, read through the projection every consumer uses |
| representation | implicit: *the field is a plain string* — the superseded property | explicit: **`shape === "ytext"`** — C36 AC1, *"no capture path may overwrite a `Y.Text` with a plain value"* |

**What it catches that the old one could not:** the un-migration defect the charter names as the
second most likely wrong implementation — *"it merged once and then stopped merging"*, which reads
like flaky sync and which no string comparison can see.

The pair is a **conjunction**: the old value clause is retained verbatim, and one clause is added. The
only thing dropped is *"the field is a plain string"*, which is the property under supersession.

### 2.2 The RED proof — executed per site

New test-only seam, precedent `setShadowRebaseEnabled` (WP4, same file, same shape):

```ts
CanvasSync.setCollabTextEnabled(false)   // routes text/label to the plain register write
```

With it off, no `Y.Text` is ever constructed and no merge is ever planned, so the build is the
pre-WP36 one for these two fields. Each migrated site gained a **`PRE-WP36 CONTROL`** test that runs
the same scenario and asserts **the migrated expectation throws**:

```ts
expect(() => expect(observed).toEqual({ shape: "ytext", text: "edited" })).toThrow();
expect(observed).toEqual({ shape: "string", text: "edited" });
```

| # | site | migrated expectation | control observed (pre-WP36) | RED? |
|---|---|---|---|---|
| 1 | `canvas-persistence.test.ts` AC15 | `{ytext, "edited"}` | `{string, "edited"}` | ✅ shape |
| 2 | `w4-canvas-integrity.test.ts` A2 (edge `label`) | `{ytext, "L2"}` | `{string, "L2"}` | ✅ shape |
| 3 | `wp21/test_tp02` (edge `label`) | `{ytext, "depends on"}` | `{string, "depends on"}` | ✅ shape |
| 4 | `wp4/test_tp01` T2 | `{ytext, "edited"}` | `{string, "edited"}` | ✅ shape |
| 5 | `wp4/test_tp07` T2 | `{ytext, "edited"}` | `{string, "edited"}` | ✅ shape |
| 6 | `wp5v2/test_tp01` T4 | `{ytext, "betgamma"}` | `{string, **"gamma"**}` | ✅ **shape AND value** |
| 7 | `wp6/chaos` D1 | `{ytext, "peer two"}` | `{string, **"contested"**}` | ✅ **shape AND value** |

Sites 6 and 7 are the strongest of the seven: the control **executes the destruction**. On the old
build the no-base capture destroyed `beta`, and the stale view destroyed the peer's `"peer two"`.

**One bonus strengthening**, not a translation: `wp6` T1's `readings.localText` now asserts
`{shape: "string", text: "peer two"}` — with the mechanism ON this client's save carries no text intent,
so **no capture ever ran on the field and the lazy, write-triggered migration must have left it a plain
string**. That is C36 AC5's *no bulk pass*, which the old `.toBe("peer two")` could not express.

---

## 3. The fuzzer

### 3.1 The harness input fix — a dishonest input, repaired at source

`buildSurface(trace, overrides, replica?)` now takes the **saving replica** and reads `text`/`label`
from **that replica's own last-saved surface**, falling back to the trace only for a record the replica
has never saved (one a peer created — where the trace value is what the projection would have painted).

Consequence: a replica's `.canvas` restates its **own** text, so the shadow diff sees `base === next`,
the merge's verdict is `"identical"`, and **zero ops** are emitted. That is exactly what made the
pre-WP36 register look idempotent, restored honestly.

`contendedFieldWrite` additionally **declines** when either author has no surface value for the field:
without a shadow entry the capture takes C36 §5.3's **no-base branch**, which is correct and chartered
but is not the concurrent-merge scenario the op exists to measure. Judging it as one would be
asserting over a branch the op never meant to reach. *(Recorded gap: the fuzzer therefore does not
exercise the no-base branch. It is covered by WP36's own `test_tp01`/`test_tp03`.)*

### 3.2 `[intent-trace]` → the new `[text-merge]` family

| | old oracle (`[intent-trace]`) | new oracle (`[text-merge]`) |
|---|---|---|
| sequential writes | *"the converged value equals what the LAST op wrote"* | **unchanged, verbatim** — while the slot has not diverged, the expectation is the last author's exact string |
| concurrent writes | *"the winner is one of the two values"* — **satisfied when one author's edit is destroyed** | **SURVIVAL: every author's contributed characters are present.** LWW keeps exactly one ⇒ **RED** |
| concurrent writes, computable shapes | — | **the EXACT converged string**, computed from the harness's own log (§3.3) |
| agreement | first | **last**, deliberately — convergence is exactly what the defect preserves |

The trace records, per collaborative-text write, the **base** the author typed over (`textBase`) and
whether the op **verified** that base against the author's own doc (`textBaseVerified`). The
contribution is then `textAffixes(base, next).inserted` — a plain longest-common-affix diff written out
in `intent-trace.ts`, deliberately **not** `canvas-text-merge.ts:diffBounds`, which is the code under
test.

### 3.3 The exact-merge arm, and the precondition that gates it

Two shapes are exactly computable from the log alone:

- **pure insertions at pairwise-distinct offsets** — one answer, no tie-break: the base with each
  contribution spliced in. This is the headless form of C36 AC3's live `kolla1bo2ration`.
- **replacements of the same span** — `prefix + contributions in SOME order + suffix`. Yjs breaks that
  tie on a random `clientID`, so the oracle names the **whole set** and never which member won.

It runs **only** when every author of the last window **verified its base against its own doc and they
all agree** (`lastWindowBaseVerified`). Without that gate the arm would compute a merge from bases the
authors merely *believed*, and a stale belief makes every legitimate outcome look like an invention —
the vacuity C36 AC2 names: *"the recorded precondition is part of the criterion, not part of the
write-up."* Where the precondition does not hold (the WP85 stale-`.canvas` case), the oracle asserts
**survival only** and says so in the message rather than pretending to a value.

### 3.4 `[lww]` — the write-admission family

Three changes, two of them repairs of checks WP36 had silently disabled:

1. **`landed` is now a SNAPSHOT.** It stored `record.get(field)` — a **live `Y.Text` reference**. By the
   time the oracle ran at the end of a scenario, `toString()` returned the *final converged* string, not
   the string the replica held at the instant of its own write. **The family had stopped measuring write
   admission and started measuring convergence.** A green that cannot fail, in the family whose only job
   is to catch a denied write. `Y.Text.toString()` is now called at write time.
2. **The value clause, for text, became "my characters are in my doc".** *"My whole string is what my
   doc holds"* is unsatisfiable once the field merges — this replica's own doc may legitimately already
   carry a peer's characters, and demanding they be gone would demand the destruction AC3 forbids.
   What WP21 actually asks (*admitted or denied?*) survives intact in this form.
3. **A new shape clause: `expectYText ⇒ shape === "ytext"`.** This is what makes the pair red on the old
   behaviour. It is set **only** where WP36 guarantees a `Y.Text` — an *edit* to an existing record's
   text through the real capture path. Deliberately **not** set for a record **creation** (the migration
   is lazy: an unedited record keeps its plain string, C36 AC5) nor for the `CanvasBinding` write path
   (`useCanvasBinding` is `false` and frozen until P5, so WP36 never claimed it). Both of those
   distinctions were **found by the oracle firing on them** and then narrowed.

### 3.5 `staleObsidianSave` — a second disabled check, restored

The W1 discriminant read `Object.is(record.get(field), stale)`. A `Y.Text` is never `Object.is` a
string, so **this comparison lost the ability to fire for `text`/`label` the day WP36 landed** — on the
two fields where a stale push is most destructive — and nothing went red to say so. It now reads
through the render, and for a merging field asks the right question: *are the stale characters in the
doc while the newer value is not what it holds?*

### 3.6 `test_tp09`'s own two assertions

- the NO-DENIAL loop → the contribution form + the `expectYText` shape clause;
- the LWW-CONSISTENCY arm → for a text slot, **every author's contributed characters must be present**.
  Note that `trace.expect()` now returns `"text-merge"` for these slots, so the old
  `if (superseded?.kind !== "contested") continue;` would have **silently skipped** them. That would have
  been a weakening dressed as a migration. The text arm is explicit and comes first.

---

## 4. RED → GREEN, matched pair, same seeds

`plugin/src/__tests__/v2/wp23/test_tp12_text_merge_oracle_is_red_on_pre_wp36_visible.test.ts`.
24 scenarios · 3 replicas · 6 windows · seeds `0x230012 … 0x230029` · ops
`textEditViaSave`, `contendedFieldWrite`, `moveViaSave`, `relabelViaSave`.
The **only** difference between the bands is `collabText: true | false` on every replica.

| | **RED — pre-WP36 register** | **GREEN — this tree** |
|---|---|---|
| `[text-merge]` violations | **204** | **0** |
| — of which *"TWO AUTHORS … ONE OF THEM LOST"* | **111** | 0 |
| `[lww]` violations | **137** | **0** |
| — all of them the shape clause | 137 | 0 |
| `[sec]` / `[bytes]` / `[schema]` | **0** | **0** |
| ops applied | — | **144** |
| `textEditViaSave` log entries | — | **50** (25 concurrent pairs) |

**The RED sample, verbatim:**

```
replica 0: node/s1.text converged on "surfaQce s1", which does NOT contain the characters
replica 2 contributed ("Z", op "textEditViaSave", window 5).
      TWO AUTHORS WROTE THIS FIELD CONCURRENTLY AND ONE OF THEM LOST.
      A whole-string LWW register passes this run; a character-level merge must not.
```

**The GREEN counterparts, verbatim:**

```
base="surface s1" -> converged="surfaQceZ s1"       (Q at 5, Z at 8)
base="surface s2" -> converged="suQrZface s2"       (Q at 2, Z at 3 — adjacent, same word)
base="surface s2" -> converged="surfaQcZedited w2 by re s2"
```

**Zero convergence-family violations in the RED band** — asserted per scenario inside `test_tp12`, not
inferred. The old build converged perfectly while destroying `Z`. That is the entire argument for the
migration, and it is executed.

### 4.1 Per-family statement, as required

| family | what the OLD oracle asserted | what the NEW oracle asserts that the old did not | RED on old behaviour |
|---|---|---|---|
| **direct doc reads** (7) | the doc field `Object.is` this string | the capture went through the collaborative-text write and **did not flatten it** (C36 AC1) — plus, at 2 sites, the merged value itself | ✅ 7/7, each an executed control that requires the migrated assertion to **throw** |
| **`[intent-trace]` → `[text-merge]`** | the converged value is what the **last** op wrote / **one of** the concurrent values | **both** concurrent authors' characters survive; and, under a recorded precondition, the **exact** merged string | ✅ 204 violations, 111 of them the loss itself |
| **`[lww]`** | my whole string landed verbatim (live reference — see §3.4.1) | my contribution is in my doc **at write time**, and the field is still a `Y.Text` | ✅ 137 violations |

### 4.2 The one clause that could not be made strictly stronger — named

**`[lww]`'s value clause, for a text slot whose base was stale.** Old: *"the doc equals my whole
string"*. New: *"the doc contains my contribution"*. That is **strictly weaker in isolation**, and
saying otherwise would be dishonest.

It is weaker **because the property it stated is the one WP36 removed**: under a merge, this replica's
own doc may already carry a peer's characters, and requiring them to be gone is requiring the
destruction AC3 forbids. The strength is **moved, not lost** — the `[text-merge]` family now requires
*both* authors' characters to survive, which the old `[lww]` never asked and could never ask. Taken as
a pair, `[lww] ∧ [text-merge]` is strictly stronger than the pair it replaces, and §4 measures the
difference: 111 executed losses that the old pair passed.

**Nothing was escalated,** because no clause ended up weaker *as a pair*. Had the survival clause not
been constructible, this would have been an `ESCALATE_TO_WORKER2`.

---

## 5. The deferred op — `textEditViaSave`

Registered in `standard-ops.ts`. `reaches: ["WP36", "WP4", "WP17"]`; `WP36` added to
`REQUIRED_WP_COVERAGE`, which `test_tp06` asserts — so **deleting this op breaks a test** instead of
silently shrinking the fuzzer back to whole-string replacement.

**Shape:**

```
applicable  ├── ≥3 replicas, and a peer in a DIFFERENT partition (genuine concurrency)
            └── a surface node whose text is ≥6 chars and where, for BOTH peers,
                   surface value === peer's surface value === that peer's OWN DOC value
run         ├── base := the common string both peers are looking at
            ├── two DISTINCT offsets, strictly inside the string, 1–3 apart
            │      (so at least one run lands both markers inside the same word)
            ├── replica A saves `base` with "Q" spliced at offset₁
            ├── peer     saves `base` with "Z" spliced at offset₂
            └── both logged contested, with textBase = base, textBaseVerified = true
```

- **It is deliberately not `contendedFieldWrite` renamed.** That op has two peers *replace the whole
  card text* — the only thing a whole-string register could express. This one has two peers each type
  **one character at a different offset inside the same word**, which a register cannot represent at all:
  one marker must lose by construction.
- **`Q` and `Z` appear in no string this registry ever authors**, which is what keeps the affix diff's
  reported offset equal to the typed offset — the marker can never be absorbed into a shared prefix.
- **The precondition is part of the op, not of the write-up.** The doc check is what lets the oracle
  name the exact merged string; without it "both markers survived" would prove nothing about
  character-level merging.

---

## 6. Files changed

| file | change |
|---|---|
| `plugin/src/files/canvas-sync.ts` | **the only product-file change** — additive test-only seam `setCollabTextEnabled` + one `&&` in the write router |
| `plugin/src/__tests__/harness/collab-text.ts` | **new** — `collabText(value) -> {shape, text}` |
| `plugin/src/__tests__/harness/fuzz/intent-trace.ts` | `COLLAB_TEXT_FIELDS`, `textAffixes`, `TextAuthorship`, `textBase`/`textBaseVerified`, the `text-merge` expectation |
| `plugin/src/__tests__/harness/fuzz/oracle.ts` | the `text-merge` family, `expectedMergeSet`, the `[lww]` contribution + shape clauses |
| `plugin/src/__tests__/harness/fuzz/standard-ops.ts` | per-replica `buildSurface`, `readDocField`, snapshot admissions, render-aware stale push, **`textEditViaSave`**, `REQUIRED_WP_COVERAGE += WP36` |
| `plugin/src/__tests__/harness/fuzz/replica.ts` | `WriteAdmission.{shape,contribution,expectYText}`, per-replica `collabText` build mode |
| `plugin/src/__tests__/harness/fuzz/fuzzer.ts` | `FuzzScenarioOptions.collabText` (a build mode, not an op class — the core still knows no op by name) |
| `…/wp23/test_tp09_…` | two assertions re-oracled |
| `…/wp23/test_tp12_…` | **new** — the RED/GREEN matched pair |
| 7 test files (§2.2) | one assertion re-oracled + one `PRE-WP36 CONTROL` each |

**Not touched:** `plugin/src/main.ts` (not needed — nothing here is wiring), `plugin/src/utils.ts`,
`canvas-text-merge.ts`, `canvas-schema.ts`, `canvas-ingest-schema.ts`, `manifest-purge-decision.ts`,
`__tests__/dataloss/**`, `server/**`, `BUILD_SPEC_CanvasV2.md`, WP82's connectivity code, WP86's
deletion-licence code, WP85's writer-attach decision.

---

## 7. Found, and carried up

### 7.1 The absence claim, with its pattern (rule 15)

**Claim: `setCollabTextEnabled` has no production caller.**

- Pattern: **`setCollabTextEnabled(`** — with the opening parenthesis, and **`grep -F`** (fixed string;
  `grep` without `-F` would treat `(` as a literal here but the habit is what matters — a `.` in a
  pattern has produced two false hits in this run's history).
- Over `plugin/src --include=*.ts`, excluding `__tests__`: **1 hit, and it is the declaration**
  (`canvas-sync.ts:2118`).
- **Positive control:** the same `-F` pattern over the whole of `src` returns **11 hits**, so the
  pattern can match. **2 of the 11 are prose** (docstrings in `collab-text.ts` and `test_tp12`) —
  recorded rather than glossed, because a naive count would have called them call sites.
- **Second positive control:** `setShadowRebaseEnabled(` — the WP4 precedent this seam is modelled on
  — has the **identical** profile: one hit outside `__tests__`, and it is its declaration.

### 7.2 S46-class incident, self-inflicted — **`plugin/main.js`**

`npm run build` (the documented gate command) runs `node esbuild.config.mjs production` and
**overwrote the shared, gitignored `plugin/main.js`** at 09:50 with an **866 610 B production bundle**,
where the rig's instrument is a ~4 MB **e2e** bundle. Any sibling installing between 09:50 and 09:51
**without** `LS_EXPECT_SHA256` would have shipped a bundle with no `e2e-control.ts` in it — S46 exactly,
caused by the build gate rather than by a copy.

**Mitigated:** `npm run build:e2e` at 09:51 restored an e2e bundle.
**Recorded so the archaeology is not confusing later — two digests, both mine:**

```
09:51  plugin/main.js  4 262 061 B  sha256 fd350fcf2e794ba2952a50ca469b9e28970ad443e5fd4f608844fb33fc88cbb9
10:12  plugin/main.js  4 327 250 B  sha256 4705213452a481b733923910f9c501453b86622a7e5a0b4266e7c50f62042690
```

The 09:51 bundle is +3 426 B over WP36's green bundle (4 258 635 B), consistent with an additive seam
and nothing else product-side. **The 10:12 one is +65 189 B on top of that, and none of it is mine** —
a sibling's uncommitted `plugin/src/sync/{control-ws,link-state,sync}.ts` landed in the tree between
the two builds (§7.4) and is now compiled into the bundle sitting at `plugin/main.js`.

**That is the S46 hazard in its purest form and it is stated rather than tidied away: the bundle on
disk right now is a mixture of two batches' uncommitted work.** Anyone installing it must set
`LS_EXPECT_SHA256` to the digest above AND grep the installed bytes for a marker unique to their own
change, exactly as the standing instruction says. A digest proves *which* build, never *whose*.

**Carried up as a process finding: `npm run build` is not a safe gate command in a shared tree.**
Typecheck with `npx tsc -noEmit -skipLibCheck`, and build a bundle only deliberately, in a detached
worktree.

### 7.3 Why the live E2E suite was NOT run

Stated rather than skipped silently. **Nothing in this batch changes product behaviour**: the single
product-file edit is a test-only seam that defaults to the existing path, and every other change is in
`__tests__/`. The live rig measures the product; there was no product delta to measure. Running it
would have re-contended for `plugin/main.js` (§7.2) and for the two owner vaults, and produced a
number attributable to WP36 rather than to this batch. **The honest canvas-E2E baseline that S45
unblocked is therefore still unmeasured** — it remains owed by whoever next changes canvas behaviour.

### 7.4 Shared-tree measurement caveat

A sibling batch's uncommitted changes to `plugin/src/sync/control-ws.ts`, `link-state.ts` and `sync.ts`
appeared in the working tree **during** this run. The final suite number below was measured with those
present. They are **not staged** in either of this batch's commits. If that batch's work is red, the
number would move — re-measure before treating it as a baseline.

### 7.5 Two checks WP36 silently disabled, now restored

Neither had gone red, which is why neither had been noticed:

1. `staleObsidianSave`'s W1 stale-push discriminant, blind for `text`/`label` since `Y.Text` landed (§3.5).
2. `WriteAdmission.landed`'s live-reference bug: the `[lww]` family had stopped measuring admission and
   started measuring convergence (§3.4.1).

**Both are the same class:** a representation change turned an equality check into one that cannot
fire. Anywhere a `Y.Map` value is compared with `Object.is`/`toBe` and might one day be a nested type,
the check is one refactor away from being decorative. **Worth a sweep** — it is not obviously limited to
these two.

### 7.6 Gaps recorded, not closed

- The fuzzer does **not** exercise C36 §5.3's **no-base branch** (§3.1). Covered by WP36's unit tests.
- The `[text-merge]` family asserts **survival only** for a slot whose base the harness could not verify
  (the WP85 stale-`.canvas` case). Pinning that would require simulating the CRDT inside the oracle,
  which is the circularity `intent-trace.ts` exists to forbid.
- WP36's own **§5.2 KNOWN LIMIT** (a single-span diff from a stale base can re-author one character) is
  untouched and still open.

---

## 8. Data-safety statement

No vault file was read, hashed or fixtured. No `data.json` value was read, printed, logged or
committed. `sharedFolder` was not touched. No Obsidian instance was launched, no relay contacted, no
E2E script run, no vault port opened. Every change is inside `plugin/src/`. No secret passed through
any agent tool.

---

## 9. One note for whoever touches this next

**The temptation here was to make the fuzzer green by relaxing its judgement, and it would have
worked.** Replacing `[intent-trace]`'s text arm with "all replicas agree" turns 6 red files green in
about twenty lines, reads as a reasonable migration, and is satisfied by exactly the data loss WP36
exists to prevent — because *convergence is what the defect preserves*. The thing that made it possible
to tell the difference was insisting the replacement **fail on the old build**, in the same run, over
the same seeds. `test_tp12` is that instrument, and it is worth more than the family it guards: any
future change to how `text` merges must keep it red on `collabText: false`, or the oracle has quietly
stopped being an oracle.
