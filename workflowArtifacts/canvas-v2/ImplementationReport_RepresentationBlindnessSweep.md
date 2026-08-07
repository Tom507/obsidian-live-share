# Implementation Report — Representation-Blindness Sweep

**Batch:** B35 · **Worker:** 3 (Implementation) · **Mode:** autonomous
**Date:** 2026-08-05 · **Branch:** `fix-bugs-and-raceconditions`
**Authority:** the finding carried up by B32 (`ImplementationReport_TextOracleMigration.md` §7.5) —
*"Same class — a representation change turning an equality check into one that cannot fire. Worth a
sweep; I do not believe it is limited to these two."*
**Commits:** `d0992b6` (repairs + tests) · the report commit below (this file + the deriver)

---

## 0. Summary

| | |
|---|---|
| **Is the class limited to B32's two?** | **NO. Five more sites, four of them repaired here.** The judgement B32 recorded was right, and it was right about the direction too: the worst one is in **product code, on a live path, and it destroys CRDT history**. |
| **Derivation** | **AST + type-checker taint over `plugin/src`** (425 `.ts` files), committed as `workflowArtifacts/canvas-v2/tools/derive_representation_blindness.mjs`. Not a hand list. |
| **Candidates derived** | **302** silent comparison sites with a doc-derived operand — **50 product**, 252 test/harness. Tiered by the field key the value came from: **WIDENED 29** · **DYNAMIC 94** · **NARROW-KEY 179**. |
| **In-class review set** | **123** (WIDENED + DYNAMIC). The 179 NARROW-KEY rows are the seams that would *join* the class if their field ever widened; recorded, not in class today. |
| **Could not fire** | **5** — plus the 2 B32 had already repaired, so **7 members of the class in total** across the run. |
| **LIVE** | **2** — both in `files/canvas-sync.ts`, both repaired. |
| **LATENT** | **3** — two repaired, one left alone because it is in a sibling's file (§6.1). |
| **HARMLESS (unreachable)** | **0.** Every member found is reachable. |
| **Positive control** | **PASSES.** The deriver, run against `fc10c5b` (the tree where B32's two were still blind), **finds both**, by name and line. Recorded in §2.3 with the command. |
| **Repairs** | **4**, each with an **executed RED** on the unrepaired tree and a **CONTROL** proving the repaired check still fires. |
| **Unit suite** | **2387 / 2387 pass, 341 files, 0 fail** — `npx vitest run` from `plugin/`, **10:42**. Parent `bd6b2da`, clean detached worktree, **10:44**: **2354 / 2354**. |
| **Typecheck** | `npx tsc -noEmit -skipLibCheck` **exit 0**. `npm run build` deliberately NOT run (§6.6). |
| **§7 licences** | **NONE.** No test deleted, skipped, weakened, retitled or amended. Nothing escalated. |

**The one-line finding:** *WP36 did not only blind two oracles. It blinded the write path's own
"is this already the value?" question, and both seed boundaries have been silently un-migrating
records ever since — while restating a string they themselves had rendered.*

---

## 1. Why a derivation and not a search

The class needs **no bad test and no bad code**. A correct check plus a legitimate representation
change equals a check that silently stops discriminating, and every suite stays green. So the only
way to bound it is to enumerate the seams structurally and then adjudicate each one.

Three things had to be true of the deriver, and each was a specific past failure of this run:

| requirement | the failure it answers |
|---|---|
| derived from the tree, not authored | a hand list is a memory of the tree, not a measurement (rule 5) |
| **provably able to find a known member** | **WP86's census deriver returned EMPTY** and both of its *"every site is pinned"* assertions passed on it |
| refuses to run on an empty input set | the same failure, made impossible rather than merely unlikely |

The third is enforced in the tool: if Stage A derives fewer than two evidence lines it **exits 3**
rather than producing a census.

---

## 2. The derivation

`workflowArtifacts/canvas-v2/tools/derive_representation_blindness.mjs`, run over
`plugin/tsconfig.json` with the TypeScript 5.9.3 compiler API and a full type checker.

### 2.1 Stage A — which field keys can be widened

Derived **three independent ways**, which agree:

| # | source | keys |
|---|---|---|
| A1 | interface members declared `unknown` in the doc record shapes — `V2Node.text`, `V2Node.label`, `V2Edge.label` (`canvas/canvas-registers.ts`) | `text`, `label` |
| A2 | the `V2_FIELD.*` members compared inside the routing predicate `isCollabTextField` (`files/canvas-sync.ts`) | `text`, `label` |
| A3 | the harness's own `COLLAB_TEXT_FIELDS` set (`__tests__/harness/fuzz/intent-trace.ts`) | `text`, `label` |

**7 evidence lines, 2 keys.** Three derivations from three unrelated files landing on the same pair
is the check that Stage A is measuring the tree rather than one author's opinion.

### 2.2 Stages B and C — taint to a silent sink

**Sources.** A `.get(K)` whose receiver or whose `get` symbol is declared inside `node_modules/yjs`
— i.e. a value read straight out of a Yjs shared container. The **key** `K` is recorded with it.

**Propagation** (symbol-level fixpoint, converged in 4 rounds over 252 symbols): variable
declarations, destructuring, assignments, object-literal properties **and their contextual-type
property symbols** (this is what carries `landed` from `replica.ts`'s construction site to
`oracle.ts`'s read), shorthand properties, `return` statements → function symbols, and argument →
parameter binding.

**Key polymorphism.** A helper such as `nodeField(doc, id, field)` reads `.get(field)`. Naively that
collapses every call to "dynamic". The deriver records `@pN` instead and **substitutes the caller's
actual argument at each call site**, so `nodeField(doc, "n1", "x")` resolves to the key `x`. Without
this the DYNAMIC tier was 136 rows of noise; with it, 94 rows that mean something.

**Sanitisers.** `String(...)`, template literals, `.toString()`, `.toJSON()`, anything under `JSON`,
and — the general rule — **any call whose declared return type is confined to primitives**. A value
the type system pins to a primitive cannot hold a nested type.

**Sinks — silent ones only.** The class is about checks that keep answering; a check that *throws*
is loud and announces itself.

```
===  !==  ==  !=        Object.is(a,b)         expect(x).toBe(y) / .toContain(y)
switch (x)              .includes / .indexOf / .has / .add        Map/Set .set(key, …)
typeof x === "string"   ← the narrowing V2Node's own docstring forbids consumers to do
truthiness              ← if (x) / !x / x && / x || / x ? :
```

**Truthiness is in the set on purpose.** An empty `Y.Text` is **truthy**; `""` is falsy. Any
emptiness guard on a widened field stopped firing the day it widened. That sink alone contributes
**38** candidates, **32** of them in the in-class tiers — the largest single sink family in the
review set, and one no `Object.is`-shaped search would have surfaced.

### 2.3 THE POSITIVE CONTROL — executed

A deriver that returns nothing satisfies *"all of them are pinned"* perfectly. So it was run against
**`fc10c5b`** — the tree in which B32's two known members were **still blind** — in a detached
worktree, and required to find them.

```
git worktree add --detach H:/tmp/reprsweep-baseline fc10c5b
node derive_representation_blindness.mjs H:/tmp/reprsweep-baseline/plugin baseline.json
```

```
Stage A keys: text, label (5 evidence lines)
candidates: 303 { WIDENED: 35, DYNAMIC: 89, NARROW-KEY: 179 }

FOUND  Object.is(admission.landed, admission.intended)
       DYNAMIC  __tests__/harness/fuzz/oracle.ts:243        [Object.is]
FOUND  Object.is(held, entry.stale)
       DYNAMIC  __tests__/harness/fuzz/standard-ops.ts:979  [Object.is]
```

**Both known members found, at their pre-repair lines.** The control is baked into the tool as
`KNOWN_BLIND` and printed on every run, so it cannot be forgotten by whoever runs it next.

**Second control:** Stage A refuses to emit a census at all when it derives nothing (`exit 3`).
Verified by inspection of the guard and by the 7-evidence-line output above.

---

## 3. The census, and a verdict for every candidate

**302 sites** at the pre-repair tree (`bd6b2da`). Tier = the field key the tainted value was read
under.

| tier | meaning | product | test/harness | total | in class? |
|---|---|---|---|---|---|
| **WIDENED** | the read key is `text` or `label` | 0 | 29 | **29** | yes |
| **DYNAMIC** | the read key is a runtime value — may be `text`/`label` | 39 | 55 | **94** | yes |
| **NARROW-KEY** | the read key is a field that is not widenable today | 11 | 168 | **179** | not today |
| | | **50** | **252** | **302** | |

The 123 in-class rows by sink family: `.toBe()` / `.toContain()` **52** · truthiness **32** ·
`===`/`!==` **21** · `typeof`-narrowing **16** · `Object.is` **2**.

The 39 DYNAMIC **product** rows by file: `files/canvas-sync.ts` 15 · `files/manifest.ts` 7 ·
`canvas/canvas-registers.ts` 6 · `canvas/canvas-schema.ts` 6 · `canvas/canvas-binding.ts` 2 ·
`testing/e2e-control.ts` 2 · `canvas/canvas-epoch.ts` 1.

### 3.1 The five members — checks that CANNOT FIRE

| # | site | check | verdict | disposition |
|---|---|---|---|---|
| **1** | `files/canvas-sync.ts` `upsertRecordFields` | `docValueEquals(record.get(key), value)` | **LIVE** | **REPAIRED** — §4.1 |
| **2** | `files/canvas-sync.ts` `handleLocalModify`, the AC4 divergent-discard filter | `record.get(discard.field) !== discard.value` | **LIVE** | **REPAIRED** — §4.2 |
| **3** | `canvas/canvas-binding.ts` `writeRecordMinimal` | `ymap.get(key) !== value` | **LATENT** | **REPAIRED** — §4.3 |
| **4** | `__tests__/harness/fuzz/standard-ops.ts`, the `[i7]` unmentioned-field check | `now !== value && JSON.stringify(now) !== JSON.stringify(value)` | **LATENT** | **REPAIRED** — §4.4 |
| **5** | `testing/e2e-control.ts:1256` `upsertRecord` | `ymap.get(k) !== v` | **LATENT**, rig-only | **CARRIED UP, not touched** — §6.1 |

**Harmless (unreachable): none.** Every member is reachable by something.

### 3.2 The mechanism itself, named and deliberately left alone

`files/canvas-sync.ts:1537` — `docValueEquals`'s own `current === next`. **It cannot fire for a
widened field, and that is by design:** C36 §7 clause 4 forbids widening it, because it is a value
predicate shared with the capture path where a `Y.Text`-equals-string arm would make **real edits
silently skip**. It is byte-unchanged. Its three call sites were each checked instead:

| call site | can a widened value reach it? |
|---|---|
| `upsertRecordFields:1568` | **YES** — this is member 1, repaired at the call site |
| `writeCollabText:3201` | no — that branch is `targetBefore === "other"`, i.e. neither string nor `Y.Text` |
| `applyIntentPlan:3423` | no — the WP36 router takes `text`/`label` before the equality question |

### 3.3 The 27 test-side WIDENED assertions — they FIRE, and the argument is measured

The remaining WIDENED rows are all `expect(<doc read of text|label>).toBe(<string>)` (7 files,
`wp18`, `wp19`, `wp25`, `wp28`, `wp4`, `wp5v2`, `wp6`, `wp63`, `wp8`, `canvas-sync.test.ts`).

They are **not** members of the class, for a reason that is worth stating precisely: a `.toBe(string)`
against a `Y.Text` **goes RED**. It is loud. That is exactly what happened to the 13 assertions WP36
reddened and B32 migrated. The silent failure this sweep hunts cannot occur here.

**Measured, not assumed:** the suite is **2387/2387 green**, and green ⇒ none of those reads returned
a `Y.Text` ⇒ each is comparing a plain string against a string and discriminates every wrong value.

### 3.4 The 94 DYNAMIC rows

Adjudicated by resolving what the key actually is at each site. Five are the members of §3.1; the
other 89 fire, for these reasons:

- **record/container presence** (`!record`, `existing === undefined`, `!ymap`, `if (existing)`) — the
  subject is a `Y.Map` or a record, not a field value. A `Y.Map` is truthy and defined whether or not
  any field inside it widened.
- **narrow doc fields reached through a helper** — `x`, `y`, `pos`, `size`, `from`, `to`, `ord`,
  `toSide`, `schemaVersion`, `epoch`, `guid`, `path`. These are DYNAMIC only because the key arrives
  as a parameter; the deriver's `@pN` substitution resolves each call site's literal.
- **the manifest doc** (`files/manifest.ts`, **7** rows) — a different document entirely. Its values
  are `ManifestEntry` / `ManifestPublication` objects and no field there widened.
- **type guards that exist to reject objects** — `isEndpointRegister`, `readSchemaMajor`,
  `isFiniteNumber`, `readEndpointNodeId`. They answer correctly *because* a nested type is not a
  primitive; a `Y.Text` reaching one is rejected, which is the intended verdict.
- **the WP36 mechanism's own classifiers** — `writeCollabText`, `getTextShape`, `readDocField`,
  `collabText`. Each tests `instanceof Y.Text` **first**, so the `typeof === "string"` arm underneath
  is a genuine else-branch and not a narrowing.
- **B32's two repaired members** (`oracle.ts:290`, `standard-ops.ts:1147`) — **re-verified in source,
  not assumed**: `WriteAdmission.landed` is now a string snapshotted at write time via
  `noteWriteLanded` → `readDocField`, and `held` is `readDocField(...).value`, which calls
  `toString()` on a `Y.Text`. Both `Object.is` calls therefore compare rendered strings and **can
  fire**. B32's repairs hold.

### 3.5 The 179 NARROW-KEY rows — recorded, not in class

Every one is a silent comparison of a doc value read under a field that is **not widenable today**.
They are the class's future membership: the day any of those fields becomes a nested type, each of
them goes blind in exactly the way the five above did, and **nothing will go red**. The census is
committed so that question can be asked again by running one command rather than by remembering.

---

## 4. The repairs — each with an executed RED and a control

**Method, applied literally: no repair is claimed without the check having been made to fail.**
The RED band is the unrepaired tree at `0e3b1c8` in a **detached worktree** (`H:/tmp/reprsweep-head`,
rule 14 — no shared path was reverted, stashed or checked out), with the same test files copied in.

```
RED  (unrepaired, detached worktree @ 0e3b1c8) : 10 failed / 7 passed  (17)
GREEN(repaired,   shared tree)                 :  0 failed / 18 passed (18)
```

*(the 18th is the committed PRE-REPAIR CONTROL of §4.4, which has no meaning in the RED band)*

The 7 that pass in **both** bands are the CONTROLs. They are the reason a repair here cannot be a
blanket skip: a check that never fires and a check that always passes are the same defect.

### 4.1 Member 1 — `upsertRecordFields`: both seed boundaries were un-migrating records. **LIVE.**

```ts
if (docValueEquals(record.get(key), value)) continue;   // "already holding this value?"
record.set(key, value);
```

`docValueEquals` is *"is the doc already holding this exact value?"*, and its answer suppresses the
write. A `Y.Text` is never `===` a string and is no register either, so **from the day WP36 landed it
answered `false` for a byte-identical restatement** — and the `set` underneath replaced the nested
type with a plain string.

**Why it is LIVE and not theoretical.** Both production seed boundaries *re-seed a path they have
already seeded*, and the `.canvas` they read carries the **rendered string of the very `Y.Text` they
then flatten**:

```
CanvasPersistence.coldOpen -> seedDocFromCanvasData -> seedRecordsIntoYMaps -> writeRecordCreateOnce
CanvasSync.subscribe       -> applyCanvasToYMaps    -> seedFlatSpace        -> writeRecordCreateOnce
canvas-import.ts:307       -> seedRecordsIntoYMaps
```

`applyCanvasToYMaps`'s own docstring says it: *"this IS a re-seed of the path"*.

**Why nothing went red.** The projected `.canvas`, `canvas.state`, the Surface-Shadow and every
cross-replica byte oracle see the **same string** before and after. What is destroyed is the record's
CRDT history — i.e. the thing that makes the *next* concurrent edit merge instead of destroying a
peer's characters. The user-visible symptom is **"it merged once and then stopped merging"**, which
reads as flaky sync. It is the exact defect C36's charter names as the second most likely wrong
implementation of WP36, arriving through a door WP36 did not claim.

**RED, executed** (`test_tp01`, detached worktree at `0e3b1c8`):

```
× COLD-OPEN SEED: a byte-identical restatement leaves the Y.Text alone
    AssertionError: the cold-open seed flattened the Y.Text while restating its own
    rendered string: expected 'AliceBob' to be an instance of YText
× HOST-SEED HELPER (`applyToYMap`): the same restatement, the same verdict
    AssertionError: the host seed flattened an edge label it was only restating:
    expected 'depends on' to be an instance of YText
× the CRDT history survives, which is the whole point of not flattening
× CONTROL — the migrated restatement emits NO update either
    AssertionError: the restatement still produced a CRDT write: expected 1 to be +0
```

The last one is worth its own line: the flatten was not only destroying the type, it was **emitting a
Yjs update, to every peer, for a value nobody had changed**.

**The repair** compares through the same render the projection uses, at the **call site**, leaving
`docValueEquals` byte-unchanged (§3.2):

```ts
if (isYText(current) && typeof value === "string" && current.toString() === value) continue;
if (docValueEquals(current, value)) continue;
```

**GREEN + controls:** 7/7. Three controls pass in both bands — a genuinely different string is still
written; a one-space difference is still written; and a plain-string restatement still emits **zero**
updates, so the pre-existing property was not disturbed.

### 4.2 Member 2 — the `SHADOW STALE` discriminant fired unconditionally. **LIVE.**

```ts
const divergent = plan.discarded.filter((discard) => {
  const record = maps[discard.kind].get(discard.id);
  return record !== undefined && record.get(discard.field) !== discard.value;   // ← blind
});
```

`discard.value` is the **shadow's** value, and the shadow stores the **rendered** projection (C36 AC4:
`buildApplyReceipt` → `advanceFromReceipt`). So the raw doc value is never `===` its own rendered
string, and WP4 AC4's question — *"has the CRDT genuinely moved past what this save restated?"* —
**answered YES for every discarded `text`/`label`, on every save.**

`plan.discarded` holds **every unchanged field of every record in the save**. So one migrated card
names itself on every single save. WP4 AC4's own comment states the purpose it lost:

> *"ONE line per pass with at least one divergent discard. A save re-states every unchanged field and
> C2 discards all of them; logging those too would bury the one line that matters."*

That is precisely what happened. This is the run's lesson about a logger that stops, in mirror image:
**a diagnostic that fires unconditionally reports nothing.**

**RED, executed** (`test_tp02`, same worktree) — verbatim:

```
× a pure RESTATEMENT of a migrated text raises no stale signature
    AssertionError: the shadow-stale signature fired for a field that was merely restated:
    expected [ Array(1) ] to deeply equal []
    +   "SHADOW STALE: deck.canvas 1 field(s) not pushed: node/c1.text"
```

**The repair:** `renderDocValue(record.get(discard.field)) !== discard.value`.

**The control is the important half**, and it passes in both bands: a peer's character is inserted
into the nested `Y.Text` (the doc genuinely moves past the shadow), the save restates the shadow's
value, and the signature **must still fire** — `SHADOW STALE: … node/c1.text`, exactly once. A repair
that merely silenced the line would pass the first test and fail this one.

### 4.3 Member 3 — the binding's minimal diff was not minimal. **LATENT.**

`canvas/canvas-binding.ts` `writeRecordMinimal`: `if (ymap.get(key) !== value) ymap.set(key, value)`.
Identical shape to member 1, identical consequence — a spurious CRDT update **and** an un-migration
on every capture of a migrated field.

**LATENT, and stated precisely rather than dismissed:** the binding is constructed only when
`settings.useCanvasBinding` is ON, and `types.ts:181` ships it `false`. It is **not unreachable** —
`ui/settings.ts:303` is a user-facing toggle, and this repository's **own fuzzer** constructs a
`CanvasBinding` and calls `captureLocal` directly in `standard-ops.ts`'s `partialCapture` op. WP36
explicitly disclaimed this path (*"`useCanvasBinding` is `false` and frozen until P5, so WP36 never
claimed it"*), which is why nobody had looked.

**RED, executed:** `× a byte-identical restatement neither rewrites nor un-migrates the field —
AssertionError: the binding flattened a Y.Text it was only restating: expected 'card one' to be an
instance of YText`. Two controls (a real edit is still captured; plain strings behave exactly as
before) pass in both bands.

### 4.4 Member 4 — `JSON.stringify` made the `[i7]` check right by accident. **LATENT.**

```ts
if (now !== value && JSON.stringify(now) !== JSON.stringify(value)) { … }
```

The `JSON.stringify` arm is there for a **good** reason: `encodePos` freezes a *new* array per call,
so a same-pixel register is reference-unequal and value-equal, and a reference compare would make the
family fire on every restatement.

But **`Y.Text.prototype.toJSON` returns the plain string.** So a `Y.Text("x")` replaced by the plain
string `"x"` — i.e. exactly the un-migration members 1 and 3 produce — began comparing **EQUAL**, and
the `[i7]` family stopped being able to see it.

**This is the composition that matters: member 4 is precisely the check that would have caught member
3.** Two independent representation blindnesses, one masking the other. No amount of reasoning about
the fuzzer would have surfaced that; only enumerating the seams did.

**The RED is committed, not quoted.** A `PRE-REPAIR CONTROL` test holds the inherited comparison
verbatim and executes it:

```ts
const preRepairI7Changed = (before, now) =>
  now !== before && JSON.stringify(now) !== JSON.stringify(before);

expect(preRepairI7Changed(held, "x")).toBe(false);   // ← the blindness, executed
expect(i7FieldValueChanged(held, "x")).toBe(true);   // ← the repair
```

**A detail that would have made a careless fixture vacuous, and is asserted rather than assumed:**
the `Y.Text` must be **ATTACHED**. A detached `new Y.Text("x")` answers `""` to `toJSON` (Yjs queues
content until integration), so a fixture built on a bare constructor reproduces nothing. The test
asserts `JSON.stringify(held) === JSON.stringify("x")` **first**, with the message *"the fixture is
not attached — nothing is proven"*.

**The repair** asks the shape first and separately from the value, and the register arm the JSON
comparison exists for is preserved and controlled (`[20,40]` vs `[20,40]` ⇒ unchanged; vs `[20,60]`
⇒ changed).

---

## 5. Numbers, with the time they were measured

| | |
|---|---|
| **Full plugin suite, shared tree, repaired** | **2387 tests, 2387 pass, 0 fail, 341 files** — `npx vitest run` from `plugin/`, **2026-08-05 10:42** |
| **Parent `bd6b2da`, clean detached worktree** | **2354 tests, 2354 pass, 0 fail** — same command, **10:44**. 2 suites unloadable (`Cannot find package 'cors'`; no `server/node_modules` in a worktree — a worktree artefact, contributing 0 tests, identical to the one WP36 §5.1 recorded) |
| **`0e3b1c8`, clean detached worktree** | **2325 / 2325, 334 files**, same 2 suites unloadable, **10:40** |
| **Delta attributable to this batch** | **+18 tests, +3 files.** `2354 + 18 = 2372`, and the shared tree additionally loads the 2 worktree-unloadable suites (`wp5/latency` 11 + `e2e/two-host` 4 = 15) ⇒ **2387**. The arithmetic closes exactly. |
| **Typecheck** | `npx tsc -noEmit -skipLibCheck` **exit 0** |
| **Sweep suite alone** | `src/__tests__/v2/reprsweep/` — **18/18** green; **10 failed / 7 passed** on the unrepaired tree |
| **Census, re-derived after the repairs** | **306** { WIDENED 33 · DYNAMIC 94 · NARROW-KEY 179 } — 302 + the 4 rows this batch's own test files contribute. The positive control still passes on the same run. |

Reproduce any of these with:

```
node workflowArtifacts/canvas-v2/tools/derive_representation_blindness.mjs <plugin dir> <out.json>
```

It prints the positive control on every run. It exits **3**, without emitting a census, if Stage A
derives nothing.

**Shared-tree caveat, stated rather than glossed.** WP88's work landed at `bd6b2da` **during** this
run (its files were uncommitted when the batch started and committed by its own batch mid-run). Every
number above is measured against a tree that already contains it, and the parent-commit baseline is
taken at `bd6b2da` precisely so the delta is mine and nobody else's.

---

## 6. Found, and carried up

### 6.1 The fifth member — `testing/e2e-control.ts:1256`. Reachable, **not repaired, and not mine**

```ts
function upsertRecord(map, id, record) { … for (const [k, v] of Object.entries(record))
  if (ymap.get(k) !== v) ymap.set(k, v); }
```

Byte-for-byte the shape of member 3, in the E2E rig's mirror of the production write. It drives
`canvas.simulateEdit`, which the Dispatcher has already forbidden for other reasons — so it can
un-migrate a record during a live rig run and mislead a later measurement of the doc's shape.

**Not repaired, deliberately: `plugin/src/testing/e2e-control.ts` is WP88's file** and a sibling
committed to it during this run (`bd6b2da`). Rule 14's spirit is the reason — two batches editing one
file is how WP81 nearly shipped with no `Notice` channel. **One line, and it needs an owner.**

- Pattern used for the presence claim: **`ymap.get(k) !== v`**, `grep -F` (fixed string).
- **1 hit**, `testing/e2e-control.ts:1256`.
- **Positive control:** the same `-F` search for **`ymap.get(`** over the same scope returns
  **3 hits** — `canvas-binding.ts:139` (member 3, repaired), `e2e-control.ts:1256` (this), and one
  prose occurrence in this batch's own test header. So the pattern can match, and the narrower
  absence is real. The prose hit is recorded rather than glossed: a naive count would have called it
  a call site.

### 6.2 The residual on member 1 — a seed proposing a *different* string still flattens

The repair restores the blind check, which is the *byte-identical restatement*. It does **not** decide
what a seed should do when it proposes a genuinely different string over a `Y.Text`. Today it
flattens.

**That is deliberately out of scope, and the distinction is the point.** A differing value is not a
blind check — the values really do differ. What to do about it (skip, merge, or write) is a routing
question that belongs with C36's write router, and answering it here would have been the scope creep
this run has repeatedly and correctly refused. It is **executed and pinned** by the CONTROL test
`"a genuinely DIFFERENT string is still written, not silently skipped"`, so the behaviour is
recorded rather than hidden.

**It is reachable**, and WP85 is why: a `.canvas` does not converge from the doc, so a peer's file can
legitimately hold a different string at subscribe time. **Deserves a WP.**

### 6.3 The 179 NARROW-KEY seams are the class's future membership

Not a defect today. But every one is a silent comparison of a doc value that is only safe because its
field has not widened, and **the whole lesson of this class is that widening a field is a legitimate,
local, well-reviewed change that reddens nothing.** The census is committed and the tool is one
command, so the next widening can ask the question instead of remembering it.

### 6.4 Truthiness is the sink nobody is watching

57 of the 302 candidates are truthiness tests. An empty `Y.Text` is **truthy** where `""` is falsy —
so any *emptiness* guard on a widened field silently inverted the day it widened. None of the 57 is a
defect today (they all guard record presence or narrow fields), but this is the sink that will bite
next, and it is invisible to every `Object.is`-shaped search. Recorded so the next sweep does not have
to rediscover it.

### 6.5 A member this derivation CANNOT reach — a criterion that HANGS instead of failing

**Carried up from WP88 via the Dispatcher, and it is the sharpest extension of the class so far.**

`link.break{shape:"silence"}` cannot drive a link to its retry ceiling: a reconnect's `onopen` is
ungated by `silenced`, so every retry succeeds, resets the chain, and the link oscillates forever.
C88 AC4 as written was therefore **unsatisfiable** — and the failure mode is the part that matters:

> a criterion waiting on that state does not fail. **It hangs.** It never produces an answer at all.

That is the same class one level up, and arguably worse than everything in §3.1. A check that cannot
fire at least returns a value somebody can look at. A check whose *precondition* can never be
produced returns nothing, and a timeout reads as flakiness, infrastructure, or "the rig again".

**This sweep's derivation does not reach it, and it is worth being exact about why rather than
implying broader coverage than was measured.** The deriver's sinks are *comparison sites*: it asks
"can this expression's operands still discriminate?". WP88's defect is not about an operand at all —
it is a **liveness** property of an instrument: *can the state this criterion waits for ever be
produced?* No amount of type or taint information about a comparison answers that.

What would reach it is a different derivation over a different pair:

| this sweep | what WP88's shape needs |
|---|---|
| sink = a comparison | sink = a **wait**: `await`, a poll loop, `waitFor`, a rig command that blocks on a predicate |
| question = can the operands differ? | question = is there **any path** that sets the awaited predicate true? |
| evidence = make the check fail | evidence = make the wait **return**, and separately show it can time out |

The two are complementary and the second is unowned. **It deserves a WP**, and its positive control
is the same trick that made this one trustworthy: point it at `link.break{shape:"silence"}` on the
tree where AC4 was unsatisfiable and require it to say so.

**One connection worth recording:** the run has now found this class in an oracle (B32 ×2), in a
product write path (§4.1), in a diagnostic (§4.2), in a latent write path (§4.3), inside the
anti-vacuity instrument itself (§4.4), in the rig (§6.1), and now in a *criterion's precondition*.
Seven surfaces. The common factor is never the check — it is that **something changed underneath a
check that was correct when it was written, and nothing in the system is responsible for noticing.**

### 6.6 Process

- **`npm run build` was NOT run**, per the standing warning: it overwrote the shared, gitignored
  `plugin/main.js` with a production bundle at 09:50 today. `npx tsc -noEmit -skipLibCheck` (exit 0)
  is the gate used instead.
- **No live E2E.** Two of the four repairs change product behaviour, and both are genuinely
  observable — but `plugin/main.js` is contended and the bundle on disk is a mixture of two batches'
  uncommitted work (B32 §7.2). Running the rig would have required a build into that contention for a
  measurement the unit band already makes decisively. **The canvas-E2E baseline S45 unblocked remains
  unmeasured and is still owed** — and members 1 and 3 are now on the list of things it should check.
- **Three detached worktrees** were used and left in place for whoever wants to re-measure:
  `H:/tmp/reprsweep-baseline` (`fc10c5b`, the positive control), `H:/tmp/reprsweep-head` (`0e3b1c8`,
  the RED band), `H:/tmp/reprsweep-parent` (`bd6b2da`, the clean baseline). Each has a `node_modules`
  **junction** to the main plugin's, which is what makes a worktree measurable at all here without a
  second `npm ci`.
- **No shared path was reverted, restored or stashed** at any point.
- **Self-inflicted, reported rather than tidied away: this batch broke `tsc` repo-wide for about
  five minutes.** `test_tp01` was created at ~10:33 importing `FlatCanvasData` from
  `canvas/canvas-canonical`, which does not export it (it lives in `files/canvas-sync`). `tsc`
  typechecks `src/` **including tests**, so an untracked, unlanded test file breaks `npm run build`
  for every batch in the shared tree. Corrected at 10:38 and landed at 10:44 (`d0992b6`);
  `npx tsc -noEmit -skipLibCheck` **exit 0**, re-verified at 10:51. A sibling measured it and
  attributed it correctly before I noticed it myself.
  **The general lesson, which is not about this import:** in this repo a test file is not private
  until it compiles. `npx tsc -noEmit -skipLibCheck` belongs immediately after creating one, not at
  the end of the batch — the same argument as re-reading `git status` immediately before a commit
  rather than earlier in the turn.

---

## 7. Constraints discharged

| constraint | status |
|---|---|
| no `server/**` edit | ✅ — `git show --stat d0992b6` lists 6 files, all under `plugin/src/` |
| `BUILD_SPEC_CanvasV2.md` untouched | ✅ |
| `manifest-purge-decision.ts`, `__tests__/dataloss/**` untouched | ✅ |
| WP88's `session/`, `sync/`, `main.ts`, `testing/e2e-control.ts` untouched | ✅ — §6.1 is left for its owner |
| WP86's deletion licence, WP85's writer-attach decision untouched | ✅ |
| `docValueEquals` **not** widened (C36 §7 clause 4) | ✅ — byte-unchanged; the decision is at the call site |
| `plugin/src/utils.ts`, `canvas-text-merge.ts`, `canvas-schema.ts`, `canvas-ingest-schema.ts` unchanged | ✅ |
| no test deleted, skipped, weakened, retitled or amended | ✅ — 18 added, 0 touched |
| every repair has an executed RED **and** a control proving it still fires | ✅ — §4 |
| `WORKFLOW_ANALYSIS.md` not mine | ✅ — left untracked and unstaged |
| `data.json` never read, printed, logged or fixtured | ✅ — §8 |

---

## 8. Data-safety statement

No vault file was read, hashed or fixtured. No `data.json` value was read, printed, logged or
committed. No Obsidian instance was launched, no relay contacted, no E2E script run, no vault port
opened. No secret passed through any agent tool. Every product change is inside `plugin/src/`; the
only other artefacts are this report and the deriver under `workflowArtifacts/canvas-v2/`. The
fixtures use `"AliceBob"`, `"card one"` and `"depends on"` — no user content of any kind.

---

## 9. One note for whoever touches this next

**The tempting shape of this repair is a widened equality predicate, and it would have been wrong.**
Teaching `docValueEquals` that a `Y.Text` "equals" a string closes all of members 1, 3 and 5 in three
lines, reads as the obvious fix, and would make **real edits silently skip** on the capture path —
trading a defect that destroys history for one that destroys keystrokes. C36 §7 clause 4 forbade it
in advance and the reason is written down; this batch obeyed it and moved the decision to each call
site instead.

**And the second thing.** The reason the sweep found five and not zero is the positive control. The
first deriver I wrote returned 1129 candidates, the second returned 239, and both were plausible.
Neither was trustworthy until one of them was made to find, by name and line, two defects somebody
else had already proved were there. **Run the tool against `fc10c5b` before you believe any census it
gives you** — including this one.
