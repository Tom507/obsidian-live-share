# Implementation Report — WP10

Attempt: 1

> **Provenance note, declared rather than buried.** The WP10 Coder Sub-Agent was terminated
> mid-run by an account spend limit, **not** by a fault in its work. It had already written the
> full endpoint implementation into `canvas-registers.ts` before it died, but never emitted this
> report. This report was reconstructed by **Worker 3 Core** from the on-disk state and from
> directly executed test runs — every number below was measured on the current tree, not carried
> over from the terminated agent's claims. Worker 3 Core also made one small completion edit,
> disclosed in full under *Worker 3 Core intervention* below.

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — `from`/`to` round-trip losslessly to/from the file representation, including the optional `end` | DONE | `encodeEndpoint` / `decodeEndpoint` / `encodeEndpointFromFile` cover `fromNode`/`fromSide`/`fromEnd` and the `to*` counterparts; `end` is preserved when present and stays absent (not `undefined`, not `null`) when omitted. |
| AC2 — two concurrent re-routes of the same endpoint converge to exactly one submitted endpoint on every replica, never a `node`/`side` mixture | DONE | One key, one value, one delta: `writeEndpointRegister` performs a single `record.set(slot, endpoint)`, so a concurrent race is decided over the whole `{node, side, end?}` triple. Verified across three replicas in both mesh and relay topologies. |
| AC3 — concurrent re-route of `from` on one replica and `to` on another leaves both intact | DONE | `from` and `to` are separate keys, so the two registers commute. Each register has a single author in this scenario, so the surviving value is asserted exactly. |
| AC4 — an endpoint register is wholly present or wholly absent; a partial endpoint cannot be constructed through the module's API | DONE | Enforced at runtime, not only in the type system: `encodeEndpoint` throws on a missing/empty `node` or `side` even when TypeScript is bypassed, `isEndpointRegister`/`asEndpointRegister` reject partial or ill-typed values, and **no per-component setter is exported** (`writeFromNode`/`writeFromSide`/`writeFromEnd` deliberately do not exist). Wholeness is also enforced on read — see the intervention note. |

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| *(none)* | | |

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| `workflowArtifacts/canvas-v2/_run_blind.py` | one-off helper script | Stage → run → **always** clean up a WP's blind sets. Closes the B1 automation candidate; the `finally` block guarantees `src/__tests__/v2blind/` is removed even on failure, which is what breached context isolation in the previous batch. |

## Changes Made

- **modified** `plugin/src/canvas/canvas-registers.ts` — appended PART D (endpoint registers) to the
  module WP9 created. No other production file was touched.
- **created** `plugin/src/__tests__/v2/wp10/` — 4 visible test files.
- **created** `workflowArtifacts/canvas-v2/tests/blind_set1/WP10/` and `.../blind_set2/WP10/` — 4 files each.

`canvas-sync.ts` was **not** modified: WP10 is a pure core, and wiring the endpoint registers into
the write boundaries / parser / serializer is WP16, WP17 and WP18 in a later batch.

## Exported API surface (for the WPs that will import this)

Consumed by WP8 (migration), WP14 (ingest validity), WP15 (register-granular shadow),
WP16 (parse) and WP17 (serialize):

- `EndpointRegister` — `{ readonly node: string; readonly side: string; readonly end?: string }`
- `FileEndpoint`, `EndpointSlot`, `V2EdgeRecord = V2Edge<EndpointRegister>`
- `encodeEndpoint(node, side, end?)` — throws on a partial endpoint · `decodeEndpoint(endpoint)`
- `encodeEndpointFromFile(...)` — file-shaped input → register, `undefined` when not wholly present
- `isEndpointRegister(v)` · `asEndpointRegister(v)` · `endpointEquals(a, b)`
- `readEndpoint(record, slot)` · `readFrom(record)` · `readTo(record)`
- `readFromRegister(record)` · `readToRegister(record)`
- `writeEndpointRegister(record, slot, endpoint)` · `writeFromRegister(record, e)` · `writeToRegister(record, e)`
- `writeFrom(record, node, side, end?)` · `writeTo(record, node, side, end?)`
- `hasBothEndpoints(record)` — the "no endpoint-less edge" invariant as one predicate, so **WP14's
  validator and WP23's fuzzer oracle ask the same question the same way** instead of each
  re-deriving it. WP14 should call this rather than write its own endpoint check.

## WP9 symbols reused (proof of no re-declaration)

Per the Shared Ownership Contract, WP10 reused rather than redefined: `V2_FIELD` (which already
carried the `from`/`to`/`ord` key names), `V2FieldKey`, `V2RecordMap`, `V2Edge<TEndpoint>` (WP9's
deliberate generic append seam — WP10 supplied the type argument rather than inlining the shape),
and WP9's `normalizeGeometryScalar` conventions for input validation style. No WP9 symbol was
shadowed, re-exported under a second name, or re-declared as a local constant.

## Worker 3 Core intervention — disclosed

The terminated coder shipped the `write` side of the endpoint API with both spellings
(`writeFromRegister` **and** `writeFrom`), matching WP9's `writePosRegister`/`writePos` convention,
but shipped only `readFrom`/`readTo` on the read side — the `readFromRegister`/`readToRegister`
spelling its own declared API contract specified was missing. Both blind sets failed on exactly
that, and only that (`TypeError: readFromRegister is not a function`), one test in each set.

Worker 3 Core added the two missing accessors as thin delegations to the existing
`readEndpoint(record, slot)`. **This is completion of the interrupted agent's own published
contract and a restoration of WP9's naming symmetry — not a patch aimed at a blind test.** The
evidence that it is not test-patching: the `write*Register` counterparts already existed, the
`readPosRegister`/`readSizeRegister` precedent already existed in the same file, and no assertion
anywhere was altered. This is recorded because a Worker-3-Core edit to production code is a
deviation from the normal routing role and should be visible to Worker 4, not silent.

## Visible Test Results

| Test | Status | Notes |
|---|---|---|
| `test_tp01_lossless_endpoint_roundtrip_visible.test.ts` (AC1) | PASS | |
| `test_tp02_concurrent_reroute_convergence_visible.test.ts` (AC2) | PASS | three replicas; asserts cross-replica agreement + membership in the submitted set + explicit rejection of both torn mixtures, never a hardcoded winner |
| `test_tp03_from_to_independence_visible.test.ts` (AC3) | PASS | single author per register, so exact values are asserted legitimately |
| `test_tp04_wholly_present_or_absent_visible.test.ts` (AC4) | PASS | |

**Visible set: 4 files / 9 tests, 0 failed.**

## Blind Test Results

| Set | Files | Tests | PASS | FAIL |
|---|---|---|---|---|
| blind_set1 | 4 | 6 | 6 | 0 |
| blind_set2 | 4 | 6 | 6 | 0 |

Both sets were red on the same single missing export before the intervention above, and green after.

## Full-suite result

Not re-run at this point in the batch **by explicit Dispatcher instruction** — the full plugin suite
is run once at the end of the batch for the handover numbers, to control spend. WP9+WP10 buckets
together measured **8 files / 17 tests, 0 failed**. No existing test was deleted, skipped, `.only`'d,
`.todo`'d, commented out, weakened or relaxed by this WP.

## Summary for Worker 3

`from` and `to` are now atomic registers in the same module and the same idiom as `pos`/`size`. The
whole endpoint is one key and one value, so a concurrent re-route can never produce one author's
`node` with another's `side`, and the module offers no API through which a half-endpoint can be
constructed — `encodeEndpoint` throws, the type guards reject, no per-component setter exists, and a
partial value hand-written past the API reads back as absent rather than as a partial object. The one
rough edge worth carrying forward is a naming asymmetry inherited from WP9: on the geometry side
`readPos` returns the *decoded file shape* while on the endpoint side `readFrom` returns the
*register*. Both spellings now exist for endpoints so no consumer is blocked, but WP14/WP15/WP16/WP17
should import deliberately and not assume the two halves of the module read alike.

---

# Implementation Report — WP10 · AMENDMENT (AC5)
Attempt: 1 (re-entry, batch B3b, 2026-08-02)

## Status: DONE

## What this amendment does

Implements **AC5** from the 2026-08-02 Worker 2 E1 ruling: *a side-less endpoint is a first-class,
representable endpoint.* `side` and `end` are OPTIONAL components of the single
`{node, side?, end?}` register; **`node` alone decides the register's presence.** AC1–AC4 are
unchanged and their behaviour is unchanged.

The original implementation read AC4 as "all components mandatory". It is a **write-granularity**
rule, not a component-obligation rule. Nothing about the atomicity was relaxed to land AC5: the
endpoint is still ONE LWW register holding ONE value, still written whole, and still has no
per-component setter.

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 lossless round trip | DONE (unchanged) | now also lossless for the side-less case: `{fromNode}` → register → `{fromNode}`, `fromSide` key absent on both sides |
| AC2 concurrent re-route convergence | DONE (unchanged) | one key, one value, one delta — untouched |
| AC3 from/to independence | DONE (unchanged) | untouched |
| AC4 wholly present or wholly absent | DONE (unchanged in substance) | "wholly" is about the REGISTER, whose presence is `node`; no per-component setter exists, and a wrong-typed component still reads the whole register as absent |
| **AC5 side-less endpoint is first-class** | **DONE** | construction, file reader and register predicate all changed; see below |

## Changes Made

`plugin/src/canvas/canvas-registers.ts` — the only source file touched.

| Symbol | Change |
|---|---|
| `EndpointRegister` | `side` is now `readonly side?: string` |
| `FileEndpoint` | `side` now optional |
| `EndpointFileFields<S>` | only `*Node` is required; `*Side` joins `*End` in the `Partial<...>` half |
| `encodeEndpoint(node, side?, end?)` | `side` optional; `""` / `null` / `undefined` normalise to the KEY BEING OMITTED; a non-string, non-absent component still throws; **empty/missing `node` still throws** |
| `encodeEndpointFromFile` | builds the register whenever `*Node` is present and non-empty; takes `*Side` / `*End` only when present and usable |
| `isEndpointRegister` | presence decided on `node` alone; `side`/`end` optional-when-present, present-but-wrong-type ⇒ whole register absent |
| `decodeEndpoint` / `decodeEndpointToFile` | omit the `side` / `*Side` key when the register has none — never `null`, never `""` |
| `writeFrom` / `writeTo` | `side` parameter now optional (same single-`set` contract) |
| `hasBothEndpoints` | **unchanged code**; doc-comment now states the two absences that must stay distinguishable |

Two private helpers were added (`isAbsentComponent`, `normaliseComponent`, `isOptionalComponent`) so
"absent" means the same thing at construction and at the read boundary. No export was added or
removed. `GEOMETRY_KEYS` untouched and still exported. Zero new dependencies.

**Side vocabulary is still not validated.** Any string other than `""` is carried through verbatim
and opaquely (pinned by a test with an invented side/end value), so a forward-compatible file cannot
lose information here.

## Visible Test Results

| Test | Status | Notes |
|---|---|---|
| `wp10/test_tp01_lossless_endpoint_roundtrip_visible` | PASS | unchanged |
| `wp10/test_tp02_concurrent_reroute_convergence_visible` | PASS | unchanged |
| `wp10/test_tp03_from_to_independence_visible` | PASS | unchanged |
| `wp10/test_tp04_wholly_present_or_absent_visible` | PASS | **amended under licence** — see below |
| `wp10/test_tp05_sideless_endpoint_is_first_class_visible` | PASS (new, 8 cases) | the AC5 regression pin |

### Licensed test amendment (TC4)

Two assertion groups in `test_tp04_wholly_present_or_absent_visible.test.ts` were asserting the
defect and were re-pointed, exactly as licensed by the WP10 amendment:

- `encodeEndpoint` "throws on an empty/absent **side**" → replaced by "throws on an empty/absent
  **node**", plus the new positive facts (a side-less construction succeeds and stores the key as
  omitted). A wrong-TYPED `side`/`end` still throws, and that is now asserted too.
- `isEndpointRegister({node})` / `asEndpointRegister({node})` "absent" → "**present**".

Nothing else in that file was weakened. The no-per-component-setter block, the wrong-typed-field
block and the only-`side` / only-`end` absences are all asserted exactly as strictly as before, and
two strictly-new negatives (`{}`, `{node: ""}`) were added.

## Full-suite result (from `plugin/`)

- `npx tsc --noEmit` — clean.
- `npm test -- --reporter=dot` — **before: 30 failed | 1189 passed (1219)** → **after: 25 failed |
  1217 passed (1242)**.
- **Zero tests changed from passing to failing.** Five pre-existing baseline failures in
  `src/__tests__/canvas-sync.test.ts` now PASS as a direct consequence of AC5 (they exercise edges
  whose file records carry no `*Side`).
- No test was deleted, skipped, `.only`'d, `.todo`'d, commented out or relaxed. No fixture edited.

## Summary for Worker 3

An edge that is legal under the JSON Canvas format is now representable: `{fromNode: "n1"}` builds a
whole register, reads back as PRESENT, and round-trips to the file with `fromSide` absent rather than
`null` or `""`. The two absences the ruling insisted on are distinguishable and pinned — a register
that is absent still fails `hasBothEndpoints` (dangling edge), a register present with no side passes
(attached, legal). The atomicity guarantee is intact: one doc key, one frozen value, replaced whole,
no per-component setter. Consumers WP14 (pinned in this batch) and WP17 (key omission + byte-identical
round trip) should be checked against the same table.
