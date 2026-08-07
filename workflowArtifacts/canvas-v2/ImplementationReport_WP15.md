# Implementation Report — WP15

**WP:** WP15 — Shadow and intent diff at atomic-register granularity (C15, phase P1)
**Attempt:** 1
**Module modified:** `plugin/src/canvas/canvas-shadow.ts` (in place — no rewrite, no reorganisation)

---

## Status: DONE

All 17 visible tests pass. The five P0 buckets this module underpins stay green, the whole
`src/__tests__/v2/` tree stays green, and `npx tsc -noEmit -skipLibCheck` exits 0.

---

## Completed Work

| AC | Requirement | How it is met | Evidence |
|---|---|---|---|
| **AC1** | The shadow stores `pos`, `size`, `from`, `to` as single fields; a change to one component of a composite marks the whole register as intent (I8). | No production change was needed. The storage layer (`advanceField` / `advanceRecord` / `getField` / `getRecordFields`) and `planIntentDiff`'s field loop are field-name- and field-shape-agnostic: a field's value is one opaque unit, so `"pos": [10, 20]` occupies exactly one `Map` entry and produces exactly one upsert carrying the whole pair. `ShadowFieldValue` was widened so this is now *typed* as well as merely true at runtime, and the `planIntentDiff` docstring now states I8 explicitly. | `wp15/test_tp01` (4 cases), `wp15/test_tp02` (3 cases) |
| **AC2** | A save differing only in the rounding of a coordinate produces **no** intent. | **The one real defect, fixed.** Rule 2's staleness comparison changed from `===` to `fieldValueEquals(...)` — whole-value equality for arrays and plain data objects, `===` for primitives. | `wp15/test_tp03` (3 cases, incl. the discrimination case that a genuine different-pixel move *does* still upsert) |
| **AC3** | The delete-intent rule and the resurrect block operate against the tombstone view, not key absence. | No production change was needed; see **AC3, in detail** below. Rule 1 (resurrect block) already routes through the `TombstoneView` seam, and the visible tests drive that seam from WP12's real `applyTombstoneOp` + `isTombstoneSuppressed`. Rule 4 (delete) is gated on the shadow's three-state model plus the hand-over receipt — never on key absence — and is deliberately *not* gated on tombstone status. | `wp15/test_tp04` (2 cases), `wp15/test_tp05` (3 cases) |
| **AC4** | No V1 key names (`x`, `y`, `width`, `height`, `fromNode`, `fromSide`, `toNode`, `toSide`) remain as shadow field keys. | No production change was needed — the module never contained a geometry or endpoint key literal in the first place; field names arrive from callers. The `canvas-registers.ts` key vocabulary is what the tests drive it with, and nothing is re-declared here: the composite value *types* are imported from `canvas-registers.ts` rather than re-spelled (Shared Ownership Contract §1). | `wp15/test_tp06` (2 cases, dynamic membership scan) |

**Definition of Done — I6 and I8 hold together:** I8 because the register is one field and a
one-component change therefore yields one whole-register upsert (`test_tp02`); I6 because a
re-encoded same-pixel register is now recognised as staleness rather than pushed as fresh intent
(`test_tp03`). Before this WP they were mutually exclusive: making geometry atomic (I8) was
precisely what broke reference-equality staleness detection (I6).

### AC3, in detail — and the constraint it had to satisfy

`canvas-shadow.ts` consumes deletion as a **read-only input seam**, `TombstoneView.isDeleted(kind,
id)`. That is deliberate and it is what the charter §7 delta and the TaskCharter §2 non-goals
require ("writing tombstones — the tombstone view is an input"). Consequently:

- The module contains **zero copies** of "is this record deleted". There is no inline
  `entry?.on === true`, no local `isDeleted` helper, no second predicate. C12 AC2's "one shared
  predicate, not three copies" is satisfied by *subtraction*, not by adding a fourth spelling.
- The binding to WP12's predicate lives at the call site, and both visible AC3 tests build their
  `TombstoneView` entirely out of `canvas-tombstone.ts`'s own `applyTombstoneOp` +
  `readTombstoneEntry` + `isTombstoneSuppressed` — never a local `Set` or boolean stand-in.
- I deliberately did **not** add a production `import { isTombstoneSuppressed }` /
  `createTombstoneView(...)` adapter to this module. It would have been dead code (no production
  caller and no test caller exist — WP4 owns the capture wiring seam, and it is out of WP15's
  scope), it would have invented a `deleted`-map key convention this WP does not own, and the
  charter states explicitly that "no new export is strictly required". Dead code in a P0
  load-bearing pure core is a worse outcome than none. **Flagging this for Worker 3** as the one
  place where I read the sub-agent brief's "import `isTombstoneSuppressed`" as satisfied in
  substance (no re-implementation anywhere) rather than in literal letter (no new import
  statement). If Worker 3 wants the literal import, it is a one-function addition — say so and it
  lands in attempt 2.

**No SPEC_CONTRADICTION.** The constraint named in the brief —
`v2/wp2/test_tp03_delete_gating_visible.test.ts`'s last case, "a missing record still follows the
delete rule" for an already-tombstoned record — is *the same behaviour* `wp15/test_tp05` pins.
Charter §7 states the reading explicitly: rule 4 must not be gated on tombstone status, because
re-asserting an existing tombstone converges (WP12's LWW merge is idempotent) whereas suppressing
the delete would strand a peer replica that has not yet seen the tombstone. Both tests pass
unmodified. AC3's "operate against the tombstone view rather than key absence" is about rule 1's
resurrect block and about *what evidence deletion is drawn from* (the shadow's `present`/`absent`/
`unknown` model plus a hand-over receipt), not about adding a tombstone gate to rule 4.

---

## Blocked Items

None.

---

## Tools Created

None. No TOOL_REQUEST was needed.

---

## Changes Made

One file: **`plugin/src/canvas/canvas-shadow.ts`**. Three edits, all additive or in-place; no
export was removed, renamed or had its contract altered, and no function was moved.

1. **Header comment + type-only import.** Added a WP15/C15 paragraph to the module header
   explaining register granularity and why value equality follows from it, and added:

   ```ts
   import type { EndpointRegister, PosRegister, SizeRegister } from "./canvas-registers";
   ```

   `import type` is erased at compile time, so the runtime purity contract ("no import at all, no
   Obsidian, no clock, no entropy, no host global, no file I/O") is untouched. It is also a
   relative specifier, which is what `wp1/test_tp02` and `wp2/test_tp05` actually assert. And
   `canvas-registers.ts` itself imports nothing, so there is no import chain and no cycle.

2. **`ShadowFieldValue` widened (type-only, no runtime effect):**

   ```ts
   export type ShadowFieldValue =
     | string | number | boolean | null
     | PosRegister | SizeRegister | EndpointRegister;
   ```

   The register shapes are **imported, not re-declared** — Shared Ownership Contract §1 gives
   `readonly [x, y]` / `readonly [w, h]` to WP9 and `{node, side, end?}` to WP10, and a second
   local declaration of `{node, side, end?}` that later drifted from WP10's would be invisible to
   every test. `undefined` is still *not* a member, preserving the logged constraint that
   `undefined` must never enter the Surface-Shadow (`getField` uses it as the "never observed"
   sentinel). The existing `undefined`-dropping filters in `toReceiptFields` and `toAdvanceFields`
   are unchanged.

3. **`planIntentDiff` rule 2 — the behaviour fix.** Added three module-private helpers
   (`isPlainDataObject`, `observedKeys`, `fieldValueEquals`) and one module-private constant
   (`MAX_FIELD_COMPARE_DEPTH = 8`) immediately above `planIntentDiff`, and changed exactly one
   expression inside it:

   ```ts
   - if (value === getField(shadow, save.path, kind, record.id, field)) {
   + if (fieldValueEquals(value, getField(shadow, save.path, kind, record.id, field))) {
   ```

   Rule-2 and rule-3 docstrings updated to describe whole-register value equality and I8. Rules 1,
   3 and 4, the plan shape, the four-parameter arity, and every WP1/WP2/WP5 export are untouched.

**Not touched:** everything else. No `server/`, `docker/`, `deploy/`, `plugin/main.js`,
`manifest.json`, `package.json`, `canvas-presence.ts`, `canvas-binding.ts`,
`canvas-model-bridge.ts`, `canvas-registers.ts`, `canvas-tombstone.ts`, `main.ts`. No version bump,
no `npm run build`, no formatter, no `lint --fix`, no new dependency.

---

## The equality change, stated precisely

`fieldValueEquals(a, b, depth = 0)` decides rule 2. Its first line is `if (a === b) return true;`,
which is the whole of the old behaviour, so the semantics split cleanly into "byte-identical to
before" and "newly defined".

### Byte-identical to before — every value shape P0 uses

| Value shape | Old verdict | New verdict | Why identical |
|---|---|---|---|
| `string` vs `string` | `===` | `===` | decided on line 1; the array/object branches are unreachable for a primitive |
| `number` vs `number` | `===` | `===` | same. `0 === -0` → still ONE observed value (still discarded, *not* an intent) |
| `NaN` vs `NaN` | `false` (`===`) | `false` | line 1 fails; `Array.isArray(NaN)` and `isPlainDataObject(NaN)` are both false → falls through to `return false`. **Deliberately not `Object.is`** — switching to `Object.is` here would have silently changed a P0 verdict |
| `boolean` vs `boolean` | `===` | `===` | line 1 |
| `null` vs `null` | `true` | `true` | line 1 |
| `null` vs an object | `false` | `false` | `isPlainDataObject(null)` is false by explicit guard |
| `"1"` vs `1` (type mismatch) | `false` | `false` | line 1 fails, no branch matches |
| any value vs `undefined` from `getField` ("never observed") | `false` | `false` | no branch matches `undefined` |
| `undefined` vs `undefined` (a save field explicitly set to `undefined` on a never-observed record) | `true` (discarded) | `true` | line 1 — this pre-existing edge case is preserved exactly, not "fixed" |
| the *same object reference* on both sides | `true` | `true` | line 1, before any structural walk |

Every existing wp1 / wp2 / wp4 / wp5v2 / wp6 test uses primitive field values only, so all of them
take the line-1 path and cannot observe the change. That is what keeps the P0 suites green, and it
is confirmed empirically below rather than merely argued.

### Newly defined — the shapes that previously always compared unequal

| Value shape | Old verdict | New verdict |
|---|---|---|
| `PosRegister` / `SizeRegister` — two distinct `readonly [number, number]` instances holding the same numbers (i.e. two `encodePos` calls whose fractional inputs round to the same pixel) | **`false` — the defect.** A same-pixel restatement read as fresh intent, was pushed to the CRDT and overwrote newer peer state (Symptom-2) | `true` → `DiscardedStaleness{reason: "equals-shadow"}` |
| `PosRegister` / `SizeRegister` differing in **one** component | `false` | `false` → one upsert for the whole register (I8). The fix does **not** over-suppress |
| arrays of different length | `false` | `false` |
| `EndpointRegister` — two distinct `{node, side}` / `{node, side, end}` instances with equal components | `false` | `true` |
| `EndpointRegister` differing in `node`, `side` or `end` | `false` | `false` |
| `{node, side}` vs `{node, side, end: undefined}` | `false` | `true` — matching `canvas-registers.ts`'s own `endpointEquals` (`a.end === b.end`) and `encodeEndpoint`'s "absent, never `undefined`" contract. Disagreeing with the owning module here would make one endpoint read as two different values |
| an array vs an object, or a register vs a primitive (a genuine shape change) | `false` | `false` — never equal, so a shape change is intent |
| a `Map`, `Date`, class instance, or anything whose prototype is neither `Object.prototype` nor `null` | `false` unless same reference | unchanged: `isPlainDataObject` is prototype-checked, so exotic values fall back to reference equality rather than being key-compared as if they were plain data |
| a self-referential / pathologically deep value from an untyped boundary | `false` | `false` at depth 8, by the `MAX_FIELD_COMPARE_DEPTH` cap — degrade, never break (I5). No legitimate `.canvas` register is deeper than one level, so the cap is unreachable in practice, and hitting it reproduces exactly the pre-WP15 verdict |

The relation is reflexive (except `NaN`, as before), symmetric and transitive, so a save compared
against a shadow gets the same verdict regardless of which side holds which instance — which is
what `wp2/test_tp05`'s purity/replayability assertions and WP23's replay oracle depend on.

**On the "two ways to be wrong are symmetric" constraint:** this change moves exactly one class of
value from "fresh intent" to "staleness", and that class is *provably* staleness — the two values
are equal, component for component, after capture-side rounding. It cannot over-suppress a real
edit, because any component difference survives the walk and still produces the upsert
(`test_tp03`'s third case pins that: `100.6 → 101` is a different pixel and still upserts). The
change is exact, not cautious in either direction.

---

## Existing tests adjusted

**None.** No test file outside `src/__tests__/v2/wp15/` was opened for editing, and no test was
deleted, skipped, `.todo`'d, `.only`'d, commented out, weakened or relaxed. No test count dropped.
The wp15 visible suite was consumed exactly as delivered.

---

## P0 regression check

Command (from `plugin/`):

```
npx vitest run src/__tests__/v2/wp1/ src/__tests__/v2/wp2/ src/__tests__/v2/wp4/ \
               src/__tests__/v2/wp5v2/ src/__tests__/v2/wp6/ --reporter=dot
```

```
Test Files  29 passed (29)
     Tests  164 passed (164)
```

| Bucket | Result | What it guards, relative to this change |
|---|---|---|
| `v2/wp1/` | PASS | The shadow's storage/keying contract and `test_tp02_headless_purity_visible` — the source scan that permits relative imports but forbids packages, Obsidian, `fs`, clocks, entropy and host globals. The new `import type` is relative and erased, so it passes both the letter and the intent. |
| `v2/wp2/` | PASS | `planIntentDiff`'s four rules, incl. `test_tp01_stale_equals_shadow` (the primitive staleness path — the one most exposed to this edit), `test_tp03_delete_gating` (the constraint test named in the brief: re-asserting an existing tombstone still converges), `test_tp04_resurrect_block`, and `test_tp05_purity` (no module-level `let`/`var`, no cached plan, inputs unmutated, repeated calls identical). |
| `v2/wp4/` | PASS | The capture seam and the byte-echo breaker — the biggest consumer of rule 2's verdict. |
| `v2/wp5v2/` | PASS | `advanceFromReceipt` / `shadowToCanvasRecords` / `createSurfaceStateStore`; confirms the widened `ShadowFieldValue` did not disturb the projection or the receipt path. |
| `v2/wp6/` | PASS | The cascade and degraded-adapter chaos suites — the end-to-end proof that the cascade still cannot start. |

Additional confirmation runs (not required, run for confidence — no test was modified for them):

- `npx vitest run src/__tests__/v2/ --reporter=dot` → **91 files, 330 tests, all passed** (the
  whole V2 tree, including wp8/wp9/wp10/wp12/wp13/wp14, so the co-owned register and tombstone
  modules are confirmed untouched).
- `npx vitest run src/__tests__/canvas-binding.test.ts src/__tests__/canvas-persistence.test.ts
  src/__tests__/canvas-single-writer.test.ts src/__tests__/canvas-sync.test.ts
  src/__tests__/w4-canvas-integrity.test.ts --reporter=dot` → **5 files, 136 tests, all passed** —
  the non-V2 files that consume `planIntentDiff` / `ShadowFieldValue` through `canvas-sync.ts`.
- `npx tsc -noEmit -skipLibCheck` → **exit 0, no output.** This is the check vitest cannot make
  (esbuild strips types without checking them), and it is where the `ShadowFieldValue` widening
  would have surfaced if `canvas-sync.ts` or `main.ts` had narrowed the value type anywhere.

Per instruction, the full `npm test` was **not** run — Worker 3 runs it once at the end of the
batch. `npm run build` was likewise not run; its `tsc -noEmit -skipLibCheck` half was run
standalone and is clean.

---

## Visible Test Results

```
npx vitest run src/__tests__/v2/wp15/ --reporter=dot

Test Files  6 passed (6)
     Tests  17 passed (17)
```

| Test file | AC | Cases | Before | After |
|---|---|---|---|---|
| `test_tp01_composite_single_field_visible.test.ts` | AC1 | 4 | PASS | PASS |
| `test_tp02_component_change_whole_register_visible.test.ts` | AC1 (I8) | 3 | PASS | PASS |
| `test_tp03_rounding_no_intent_visible.test.ts` | AC2 (I6) | 3 | **2 FAIL**, 1 pass | PASS |
| `test_tp04_resurrect_block_tombstone_view_visible.test.ts` | AC3 | 2 | PASS | PASS |
| `test_tp05_delete_rule_tombstone_view_visible.test.ts` | AC3 | 3 | PASS | PASS |
| `test_tp06_no_v1_key_names_visible.test.ts` | AC4 | 2 | PASS | PASS |

The two pre-existing failures were `test_tp03`'s `pos` case (expected `upserts: []`, got one upsert
of `[100, 200]`) and its `size` case (expected `upserts: []`, got one upsert of `[260, 60]`) —
i.e. exactly the diagnosed reference-equality defect, and nothing else.

---

## Summary for Worker 3

WP15 is **DONE** on attempt 1. One file changed, `plugin/src/canvas/canvas-shadow.ts`, in place.

- The defect was exactly as diagnosed: `planIntentDiff` rule 2 used reference equality, and
  `encodePos`/`encodeSize`/`encodeEndpoint` allocate a fresh frozen value per call, so a same-pixel
  restatement read as fresh intent. Fixed with a module-private `fieldValueEquals` whose primitive
  path is `===` and therefore byte-identical to the P0 behaviour; only array and plain-object
  values gained new semantics, and those shapes did not previously exist in the shadow at all.
- `ShadowFieldValue` was widened type-only with `PosRegister | SizeRegister | EndpointRegister`,
  **imported** from `canvas-registers.ts` via `import type` (erased at runtime, relative specifier,
  no cycle, purity scans still pass). Nothing owned by WP9/WP10/WP12 was re-declared.
- AC1, AC3 and AC4 required no production change, as the charter §7 delta predicted; the visible
  suite confirms them rather than driving new code.
- **No SPEC_CONTRADICTION.** `wp2/test_tp03_delete_gating_visible.test.ts` and `wp15/test_tp05`
  pin the *same* behaviour (rule 4 is not gated on tombstone status), so the constraint named in
  the brief was never in tension with a correct implementation.
- **No test anywhere was adjusted, deleted, skipped or relaxed.** Test counts only went up.
- Gates: 17/17 visible · 164/164 across the five P0 buckets · 330/330 across all of
  `src/__tests__/v2/` · 136/136 across the five non-V2 consumers · `tsc -noEmit -skipLibCheck`
  exit 0. Full `npm test` and `npm run build` intentionally not run, per instruction.
- **One judgement call to sanity-check** (detailed under *AC3, in detail*): I did not add a
  production `import { isTombstoneSuppressed }` to `canvas-shadow.ts`. The module consumes the
  tombstone view as an input seam and holds zero copies of the suppression predicate, which is what
  C12 AC2 actually requires; a production import with no caller would have been dead code in a P0
  load-bearing pure core, and the charter says no new export is required. If you want the literal
  import, it is a small, self-contained addition.
