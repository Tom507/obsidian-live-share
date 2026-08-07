# Implementation Report — WP59: WP3 set2 round-trip blind amendment

**Batch:** B13 · **Phase:** VI · **Date:** 2026-08-02
**Status:** `AMENDED — DoD NOT MET` · **Returns:** `ESCALATE_TO_WORKER2`

> The two assertions WP59 was licensed to amend are amended and green. The work package
> nevertheless does **not** meet its Definition of Done, because greening them exposed a
> third failure in the same test that C59 §2 declared out of scope **and asserted was
> passing**. That assertion was never passing — it was unreachable. Amending it is outside
> this charter's licence, so it is escalated rather than quietly absorbed.

---

## 1. The mandatory re-measurement (C59 §5)

C59's ruling was explicitly **provisional**: the evidence was gathered while batch B2 was
mid-edit in `canvas-sync.ts` (+643/−65). §5 makes re-measurement a hard gate — *"Re-measure
`WP3 set2` after B2 closes and before amending anything. If the failure has changed shape …
stop and escalate rather than amending."*

**Measured first, before any edit**, on the now-quiet tree:

| | Collected | Pass | Fail |
|---|---|---|---|
| `WP3 set2`, pre-amendment | **45** | 43 | **2** |

Identical to the DIVERGENT row WP56 recorded. The two failures are the two the charter names,
at the lines it names, with the symptoms it records:

```
:54  AssertionError: expected [ 'id', 'pos', 'size', 'text', 'type' ] to deeply equal [ Array(7) ]
:76  AssertionError: expected [ Array(5) ] to deeply equal [ Array(9) ]
```

C59 §3 predicted "round trip returns 5 keys, expected 7" and "edge optional fields 5 vs 9".
**Reproduced in exactly the same shape — the amendment licence is therefore live.**

---

## 2. Amendment 1 — the node key set

**BEFORE**

```ts
const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: NODES, edges: [] }));

expect(Object.keys(parsed.nodes).sort()).toEqual(["emoji", "long", "paths", "quotes"]);
for (const original of NODES) {
  const back = parsed.nodes[original.id as string];
  expect(Object.keys(back).sort()).toEqual(Object.keys(original).sort());
  for (const [key, value] of Object.entries(original)) {
    expect(back[key]).toBe(value);
  }
}
```

**AFTER**

```ts
const parsed = parseCanvas(serializeCanonicalCanvas({ nodes: NODES, edges: [] }));
const flat = decodeCanvasDataToFlat(parsed);

expect(Object.keys(flat.nodes).sort()).toEqual(["emoji", "long", "paths", "quotes"]);
for (const original of NODES) {
  const back = flat.nodes[original.id as string];
  expect(Object.keys(back).sort()).toEqual(Object.keys(original).sort());
  for (const [key, value] of Object.entries(original)) {
    expect(back[key]).toBe(value);
  }
}
```

**Strictness after:** the matcher is the same whole-collection exact `toEqual` over the
complete sorted key list. No `toMatchObject`, no `objectContaining`, no subset, no key-count
check, no `skip`/`only`, nothing destructured away. It is **stricter**: the per-key value loop
was previously *dead code* — the test died at `:54` and never reached it — and now executes,
pinning every value through the bridge; and the assertion now also pins that the V2 register
bridge is invertible, which nothing pinned before.

---

## 3. Amendment 2 — the edge key set

**BEFORE**

```ts
expect(Object.keys(parsed.edges.full).sort()).toEqual(
  ["color", "fromEnd", "fromNode", "fromSide", "id", "label", "toEnd", "toNode", "toSide"],
);
expect(Object.keys(parsed.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);
expect(parsed.edges.full.label).toBe("über");
```

**AFTER**

```ts
const flat = decodeCanvasDataToFlat(parsed);

expect(Object.keys(flat.edges.full).sort()).toEqual(
  ["color", "fromEnd", "fromNode", "fromSide", "id", "label", "toEnd", "toNode", "toSide"],
);
expect(decodeEndpointToFile("to", parsed.edges.full.to)).toEqual({
  toNode: "b",
  toSide: "left",
  toEnd: "arrow",
});
expect(Object.keys(parsed.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);  // UNCHANGED — see §5
expect(flat.edges.full.label).toBe("über");
```

**Strictness after:** the nine-key list is kept **verbatim** as a whole-collection exact
`toEqual`; only the subject moved to the sanctioned inverse. One assertion was **added** (test
count unaffected): the `to` register is decoded and pinned field-by-field, so a register that
passed the key-set check while carrying a wrong or absent side can no longer slip through.
This mirrors the already-sanctioned form in the visible twin, which asserts
`decodeEndpointToFile("to", data.edges.e1.to).toSide`.

---

## 4. Falsification — done, not asserted

Each amended site was perturbed individually in production, re-run, and the production file
then restored **byte-clean with sha256 verified identical** before and after
(`canvas-registers.ts` = `553c8464…d8b748`, `canvas-sync.ts` = `b2590855…cb880438`).

| # | Perturbation | Expected | Observed |
|---|---|---|---|
| P1 | `decodePos` returns `{x}` only, dropping `y` | amendment 1 goes red, nothing else | `expected [ Array(6) ] to deeply equal [ Array(7) ]` — amendment 1 red. The two untouched tests in the file (`long.text` code-unit length, `canonicalizeCanvasData` reference identity) stayed **green**. |
| P2 | `decodeEndpointToFile` drops the `end` component | amendment 2 goes red, and **only** it | `expected [ 'color', 'fromNode', …(5) ] to deeply equal [ Array(9) ]` — 44 of 45 pass; the single red is amendment 2. |

Both amended assertions therefore genuinely detect payload drift. Neither is a tautology.

---

## 5. Why the DoD is not met — the third assertion

C59 §2 places `:79` (`edges.bare`) out of scope with this reasoning:

> *"They pass and must keep passing — `edges.bare` passes precisely because
> `encodeEndpointFromFile` refuses to build a half endpoint."*

**Both halves of that sentence are false in the current tree.**

1. It was **not passing**. It was *unreachable* — `:76` threw first, so `:79` never ran in any
   measurement anyone has taken. Its "passing" status was an artefact of the masking failure.
2. `encodeEndpointFromFile` **no longer refuses** a side-less endpoint, deliberately. WP10 AC5
   made the `*Node` key alone decide presence (`canvas-registers.ts:645-659`), and the module's
   own doc comment calls the old refusal *"precisely the defect this predicate had: a
   fully-connected edge reported as dangling, refused at ingest, and then written out of the
   user's `.canvas` file."*

So a bare edge `{id, fromNode, toNode}` now reads as `{from, id, to}`:

```
:79  AssertionError: expected [ 'from', 'id', 'to' ] to deeply equal [ 'fromNode', 'id', 'toNode' ]
```

Post-amendment `WP3 set2` = **45 collected / 44 pass / 1 fail**. This is the same staleness
class as the two amended assertions and **no data is lost** — `decodeCanvasDataToFlat` restores
`{fromNode, id, toNode}` exactly. But it is a *third* site, in a test C59 explicitly fenced off,
and amending it would be adapting the amendment to fit a different failure. **Escalated.**

---

## 6. A second, independent finding: WP3 **set1** has regressed off its CONFIRMED row

`WP3 set1` was ledgered **CONFIRMED 56/56/0** by WP56. B13 changed nothing in set1. Re-measured:

```
WP3 set1 -> 56 collected / 55 pass / 1 fail
test_file_shape_tabs_blind1.test.ts
  "stays readable by the unchanged parseCanvas, including edge-only content"
  AssertionError: expected undefined to be 'ghost-a'
```

`:79` reads `parsed.edges["e-only"].fromNode` on the bare edge
`{id: "e-only", fromNode: "ghost-a", toNode: "ghost-b"}` — **identical root cause** to §5.
The set1 row is flipped CONFIRMED → DIVERGENT in `BlindVerificationLedger.md`. It is not a
behavioural regression and not a data-loss defect; it is a pin that WP10 AC5 retired, in a set
whose CONFIRMED row predates that AC.

---

## 7. Gate status

| Gate | Required | Measured |
|---|---|---|
| `WP3 set2` CONFIRMED, non-zero count | yes | **NOT MET** — 45/44/1, still DIVERGENT |
| Test count in the amended file unchanged | 4 → 4 | **MET** — 4 tests before and after |
| Plugin test count unmoved | yes | **MET** — 1346 before and after |
| `tsc --noEmit` clean | yes | **MET** — exit 0, no blind run in flight |
| Strictness preserved or increased | yes | **MET** — both amendments stricter; falsified P1/P2 |
| No production source modified | yes | **MET** — both perturbed files sha256-identical to baseline |

**Files changed by WP59:** `tests/blind_set2/WP3/test_value_preservation_blind2.test.ts`
(one import, two assertion subjects, one added assertion), `BUILD_SPEC_CanvasV2.md` §7 (two
rows), `BlindVerificationLedger.md` (WP3 rows + tally), this report.

---

# Addendum — B15 (WP59 re-entry, 2026-08-02)

**Worker 2 extended WP59's licence** to the two `edges.bare` pins B13 escalated (charter AC5/AC6).
Both are now amended, falsified and green. **The gate table in §7 above is superseded by §9 below.**

## 8. The two bare-edge amendments, before and after

### 8.1 `tests/blind_set1/WP3/test_file_shape_tabs_blind1.test.ts:79`

Test: `"stays readable by the unchanged parseCanvas, including edge-only content"`

**Before:**

```ts
const parsed = parseCanvas(out);

expect(Object.keys(parsed.nodes)).toEqual([]);
expect(Object.keys(parsed.edges)).toEqual(["e-only"]);
expect(parsed.edges["e-only"].fromNode).toBe("ghost-a");
```

**After:**

```ts
const parsed = parseCanvas(out);
const flat = decodeCanvasDataToFlat(parsed);

expect(Object.keys(parsed.nodes)).toEqual([]);
expect(Object.keys(parsed.edges)).toEqual(["e-only"]);
expect(flat.edges["e-only"].fromNode).toBe("ghost-a");
expect(Object.keys(flat.edges["e-only"]).sort()).toEqual(["fromNode", "id", "toNode"]);
expect(decodeEndpointToFile("from", parsed.edges["e-only"].from)).toEqual({
  fromNode: "ghost-a",
});
```

Imports added at `:4-5`: `decodeEndpointToFile`, `decodeCanvasDataToFlat`. The original `toBe`
is kept **verbatim**; only its subject moves to `flat`. Two whole-collection/whole-object
`toEqual` pins are added. Test count 5 → 5.

### 8.2 `tests/blind_set2/WP3/test_value_preservation_blind2.test.ts:103`

Test: `"preserves an edge's optional fields and adds none"`
(B13's handover called this `:79` — pre-amendment numbering.)

**Before:**

```ts
expect(Object.keys(parsed.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);
```

**After:**

```ts
expect(Object.keys(flat.edges.bare).sort()).toEqual(["fromNode", "id", "toNode"]);
expect(decodeEndpointToFile("from", parsed.edges.bare.from)).toEqual({ fromNode: "a" });
```

The three-key list is kept **verbatim**; `flat` was already bound at `:89`, so **no new import and
no new binding** were needed. Test count 4 → 4.

**Why both were stale rather than defects:** `toV2Edge` retains an edge's flat keys **only when the
endpoint register fails to build**. Pre-WP10-AC5 a side-less endpoint failed to build, so the flat
keys survived and both assertions passed. The green was produced by the very defect AC5 exists to
fix — a fully-connected side-less edge being read as not-an-endpoint.

## 9. Falsification (B15) and final gate status

| # | Perturbation of `decodeEndpointToFile` | Result |
|---|---|---|
| A | `fields[keys.side] = ""` unconditionally (charter-named) | set1 **red 55/56 at the new pin alone**; set2 red 44/45 **but at `:98`, masking the amended site**; `wp17` TP13 **red 4/5** |
| B | `""` only when `side` is absent (isolating) | set2 **red 44/45 at exactly the amended pin** |

Perturbation A alone was **not sufficient** for set2: the site sits behind B13's `:98` amendment in
the same test body. A masked assertion is not a falsified assertion.

`wp17` TP13 went red under A and is **green 5/5** after restore — the ruling's empirical basis
holds, so no escalation was warranted.

| Gate | Required | Measured |
|---|---|---|
| `WP3 set1` CONFIRMED, non-zero count | yes | **MET** — 56/56/0, verbatim from `_blind_records` |
| `WP3 set2` CONFIRMED, non-zero count | yes | **MET** — 45/45/0, verbatim from `_blind_records` |
| Test counts unchanged | 5→5, 4→4 | **MET** |
| `tsc --noEmit` clean | yes | **MET** — exit 0, no blind run in flight |
| Strictness preserved or increased | yes | **MET** — both stricter; falsified A/B |
| No production source modified | yes | **MET** — sha256 identical to baseline |

**Files changed by B15:** `tests/blind_set1/WP3/test_file_shape_tabs_blind1.test.ts`,
`tests/blind_set2/WP3/test_value_preservation_blind2.test.ts`, `BUILD_SPEC_CanvasV2.md` §7
(falsification evidence appended to the two bare-edge rows), `BlindVerificationLedger.md`
(both WP3 rows → CONFIRMED, tally 58/58/0), `Worker3Handover_B15_WP59ReEntry.md`, this addendum.
