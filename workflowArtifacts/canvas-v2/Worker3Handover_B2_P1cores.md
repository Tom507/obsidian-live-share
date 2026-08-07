# Worker 3 Handover — Canvas V2, Batch 2 / Phase P1 cores

**Batch:** 2 of 9 · **Phase:** P1 (cores only) · **Scope:** WP8–WP17
**Outcome returned to Dispatcher:** `HANDOVER_READY` — all ten WPs DONE, no escalation
**Date:** 2026-08-01

> **Run interruption, declared.** This batch was terminated twice mid-run by an account spend
> limit, not by any fault in the work, and resumed both times from on-disk state. One consequence
> is recorded honestly below: the WP10 Coder Sub-Agent was killed after it had written its
> implementation but before it wrote its report, so `ImplementationReport_WP10.md` was
> reconstructed by Worker 3 Core from directly executed test runs rather than from the agent's own
> account. Every number in this handover was measured on the current tree.

---

## Scope of This Run

- **Tasks completed:** WP8, WP9, WP10, WP11, WP12, WP13, WP14, WP15, WP16, WP17 — **all ten DONE**
- **Tasks with risk flags:** WP8 (HIGH — no production call site), WP16/WP17 (NORMAL-plus — temporary seams)
- **Escalations:** none. One candidate contradiction was raised by the WP16 coder and **resolved by
  Worker 3 Core on the evidence** rather than forwarded — see *The one conflict, and why it was not
  an escalation*.
- **Attempts consumed:** every WP landed on **attempt 1**. No WP used its retry budget.

### Execution order — a declared deviation from the charters' `Depends on`

The charters declare WP9–WP13 as depending on WP8. I executed **WP9 → WP10 → WP13 → WP8 → WP11 →
WP12 → WP14 → WP15 → WP16 → WP17.**

**Why.** WP8 AC2 requires the V1→V2 migration to convert `x/y`→`pos`, `width/height`→`size`,
endpoint keys→`from`/`to`, **and to assign an `ord` to every record.** The modules that own those
things are WP9, WP10 and WP13. Had WP8 run first it would have had to invent its own register
shapes and its own `ord` format, and WP13 would then have defined a second, different one — two
work packages independently choosing the same constant, with **both suites passing** while replicas
disagreed on file byte order. That is the exact failure mode this batch was briefed to design
against. WP9, WP10 and WP13 are pure, zero-dependency modules with no actual code dependency on
WP8, so running them first violates no acceptance criterion of any charter. The declared
`Depends on: WP8` is satisfied in substance — every one of them targets `schemaVersion 2`.

### Second declared deviation — test generation and implementation interleaved per WP

Phase 2 and Phase 3 were interleaved per work package rather than generating all tests first. Same
reason as batch B1: visible tests land in `plugin/src/__tests__/v2/` and are collected by
`npm test`, so batching all generation first would have left the suite red across the whole run and
destroyed the per-WP regression signal. Every gate was still applied per WP.

---

## Risk Summary

*(Worker 4 reads this table first — per-task detail below is only needed for HIGH-risk WPs.)*

| WP | Title | Status | risk_flag | Priority for W4 |
|---|---|---|---|---|
| **WP8** | `meta` + schemaVersion + V1→V2 migration | **DONE** | **HIGH** | **CRITICAL** |
| WP9 | Atomic `pos`/`size` registers | DONE | NONE | NORMAL |
| WP10 | Atomic `from`/`to` endpoint registers | DONE | NONE | NORMAL |
| WP11 | Write-once `type` guard | DONE | NONE | NORMAL |
| WP12 | Tombstone map core | DONE | NONE | NORMAL |
| WP13 | Fractional `ord` allocator | DONE | NONE | HIGH |
| WP14 | Ingest schema validator | DONE | NONE | NORMAL |
| WP15 | Shadow at register granularity | DONE | NONE | **HIGH** |
| WP16 | `parseCanvas` V2 + `ord` capture | DONE | NORMAL | **HIGH** |
| WP17 | Canonical serializer V2 | DONE | NORMAL | **HIGH** |

---

## Final Gate Status

*(Every number measured on the current tree at handover.)*

| Gate | Result |
|---|---|
| `npm test` (plugin, full) | **174 files / 1206 tests — 1206 pass, 0 fail** (42.46 s) |
| `npx tsc -noEmit -skipLibCheck` | **clean, zero output** |
| This batch's visible tests (WP8–WP17) | **72 files / 144 tests — all pass** |
| This batch's blind tests (20 sets) | **234 tests collected, 234 pass, 0 fail, 0 zero-collection sets** |
| `server/` | **untouched by this batch** — `git status` shows zero modified files under `server/` |
| `npm run build` | **deliberately not run** — its second half rewrites the committed `plugin/main.js`, which the charters forbid touching. `tsc -noEmit -skipLibCheck` (the first half) is clean. |

### Blind-set verification — proof of execution, not just exit codes

The shared runner `_run_blind.py` was found (by batch B10/WP55) to have **three no-op paths** that
could report a blind set green **without executing anything**. My first eight WPs were run under the
pre-repair runner, so **all twenty sets were re-run under the repaired runner** and are reported
here with collected counts:

| WP | blind_set1 (staged / collected / failed) | blind_set2 (staged / collected / failed) |
|---|---|---|
| WP8 | 5 / **5** / 0 | 5 / **8** / 0 |
| WP9 | 4 / **6** / 0 | 4 / **4** / 0 |
| WP10 | 4 / **6** / 0 | 4 / **6** / 0 |
| WP11 | 3 / **3** / 0 | 3 / **3** / 0 |
| WP12 | 10 / **16** / 0 | 10 / **15** / 0 |
| WP13 | 7 / **15** / 0 | 7 / **13** / 0 |
| WP14 | 13 / **32** / 0 | 13 / **30** / 0 |
| WP15 | 6 / **11** / 0 | 6 / **11** / 0 |
| WP16 | 8 / **13** / 0 | 8 / **11** / 0 |
| WP17 | 12 / **13** / 0 | 12 / **13** / 0 |
| **Total** | | **234 collected, 0 failed, 0 problem sets** |

The re-verified counts **match the counts recorded during the original per-WP runs exactly**, and
two sets (WP10, WP15) went red-then-green on a targeted fix during the run. Both facts are positive
evidence that the original runs genuinely executed and were not silent no-ops.

Driver: `workflowArtifacts/canvas-v2/_reverify_b2.py`. Note its first version reported all-zeros —
that was a **bug in my own driver's regex** (the body capture terminated at the `=====` rule that
the runner prints immediately after each header), not a runner or test failure. Recorded because a
false zero is exactly as dangerous as a false green.

### Test-count accounting against the deletion ledger

| Source | Files | Tests |
|---|---|---|
| Baseline measured at this batch's start | 81 | 926 |
| **Added by this batch (WP8–WP17 visible)** | **+72** | **+144** |
| Added by the concurrent T3 worker (`wp46/`, `wp47/`, `wp49/`) — **not mine** | +21 | +136 |
| **Total at handover** | **174** | **1206** |

**Deletions by this batch: ZERO.** No WP in this batch holds a deletion licence — the licensed
deleters for the whole initiative are **WP4, WP21, WP22, WP33** only. Verified mechanically:
`git status` shows **no deleted file** attributable to me, and a grep across all ten of my buckets
for `.skip` / `.only` / `.todo` / `xit(` / `xdescribe(` returns **nothing**. The three deleted
`conftest.py` files and the `e2e-control` edits visible in `git status` belong to the **concurrent
T3 worker (WP44/WP49)**, not to this batch.

**One existing test was adapted, behaviour-preservingly, and it is enumerated in full below.**

---

## The one conflict, and why it was not an escalation

The WP16 coder correctly stopped and reported a `SPEC_CONTRADICTION` rather than working around it:

- `plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts` asserted
  `expect(data.edges.e1.toSide).toBe("left")` — i.e. that `parseCanvas` returns **flat** endpoint keys.
- WP16 AC1 requires `parseCanvas` to produce **V2 records** (`from`/`to` registers), so `toSide`
  no longer exists on the returned object. Absent and `"left"` cannot both hold.

**I verified this myself rather than accepting the coder's account, and the evidence resolved it.**
The suite is named *"WP3 AC4 — the `.canvas` file shape is unchanged"*, every other test in it
asserts on `serializeCanonicalCanvas` **text**, and the file's own header comment states:
*"This test pins the bytes, not the intent."* The suite's subject is the **file bytes**;
`parseCanvas` was only the instrument used to observe the round-trip. **WP16 changes the reader, not
the file.**

The assertion was therefore restated through WP10's documented codec:

```ts
expect(decodeEndpointToFile("to", data.edges.e1.to).toSide).toBe("left");
```

**Nothing was removed or relaxed, and falsifiability is unchanged** — if `parseCanvas` dropped or
corrupted the `to` register, the decoded `toSide` would be wrong or `undefined` and the test still
fails. This is the "declare the precondition through a documented seam" form permitted by the
Shared Ownership Contract §4, and it is precedented in batch B1, which made four such adaptations.
The edit carries an in-place comment recording exactly this reasoning. Result: `tsc` clean and the
tree green.

**Why this was not forwarded to Worker 2:** there is no contradiction *between two spec statements*
— WP3's AC4 is about the file, WP16's AC1 is about the reader, and both hold simultaneously. Only
one test's *instrument* needed updating. Escalating would have stalled nine green work packages over
a one-line change whose intent the test file itself documents.

---

## Shared-constant discipline — how failure mode 1 was prevented

The batch brief named "two sub-agents independently choosing incompatible constants" as a real,
expensive failure. I front-loaded a **Shared Ownership Contract**
(`workflowArtifacts/canvas-v2/SharedOwnershipContract_P1cores.md`) naming a single owner for every
shared symbol, and passed it to **every** sub-agent, test-generator and coder alike.

| Owned concept | Owner | Module | Consumers that import it |
|---|---|---|---|
| V2 field key names, `V2Node`/`V2Edge`, `pos`/`size` registers + codec | WP9 | `canvas-registers.ts` | WP10, WP8, WP14, WP15, WP16, WP17 |
| `from`/`to` endpoint register + codec, `hasBothEndpoints` | WP10 | *(appended to the same file)* | WP8, WP14, WP16, WP17 |
| `ord` alphabet, allocator, `compareOrd`, `compareOrdId` | WP13 | `canvas-ord.ts` | WP8, WP16, WP17 |
| `meta`, `schemaVersion`, `SUPPORTED_SCHEMA_MAJOR`, migration | WP8 | `canvas-schema.ts` | later WPs |
| Write-once `type` guard | WP11 | `canvas-type-guard.ts` | WP14, WP18 |
| `deleted` entry shape, LWW merge, **the** suppression predicate | WP12 | `canvas-tombstone.ts` | WP15, WP17 |
| Ingest validity + reason codes | WP14 | `canvas-ingest-schema.ts` | WP18 |

Two consequences worth Worker 4's attention:

- **`ord` is compared by WP13's comparator everywhere.** WP16 (reorder detection) and WP17 (file
  sort) both import it. Neither uses `<` on raw strings or `localeCompare`. Had they disagreed,
  **both suites would pass while replicas produced different bytes** — the very property WP17 AC3
  exists to guarantee.
- **Suppression is asked exactly once.** WP17 calls WP12's `isTombstoneSuppressed`; there is no
  second copy of "is this record deleted" anywhere.

---

## Per-Task Detail

### WP8 — `meta`, schemaVersion, V1→V2 migration ← **the one HIGH risk in this batch**
- Status: **DONE** (attempt 1) — all four ACs green
- Changed files: **created** `plugin/src/canvas/canvas-schema.ts`; **modified**
  `plugin/src/files/canvas-sync.ts` (+21 lines, 0 removed — one import plus the AC4 capture gate in
  `handleLocalModify`, mirroring the existing `canWrite` guard). `CanvasPersistence` is not imported,
  referenced or modified — persistence keeps running, only local capture stops.
- Tests: visible 5 files / 5 tests · blind 5/5 + 5/8 — all pass
- **RISK (HIGH) — `migrateV1ToV2` has no production call site.** The coder deliberately did not wire
  it, and its reasoning is sound: WP7 moved the guest seed to `CanvasPersistence.coldOpen()`, which
  runs **after** `subscribe`. Wiring the migration into `subscribe` would stamp `meta` on an empty
  doc, and the records seeded afterwards would then never migrate, because the guard is one-shot by
  design. **Consequence: WP8's Definition of Done — "an existing V1 canvas doc opens as a valid V2
  doc" — is proven at unit level but is NOT achieved end-to-end in production.** Choosing the call
  site belongs with WP18/WP32. **This is the single most important input to the next batch.**
- **Second thing Worker 4 must know: the migration is deliberately ADDITIVE.** It never deletes the
  translated flat V1 keys. This is not laziness — `Y.encodeStateAsUpdate(doc, stateVector)` always
  ships the doc's **whole delete set** regardless of the state vector, so a single `delete()` makes
  every subsequent encoded update non-empty **forever**, and AC3's "produces no delta" idempotence
  could never again be demonstrated. It is also independently right for P1, since capture and
  persistence still speak the flat keys. **Consequence: after migration a record carries BOTH the
  flat V1 keys and the V2 registers.** Retiring the flat keys is WP18/WP22's job.
- Semantics worth relaying: `doc.getMap(name)` is a *definition*, not a read — it registers an empty
  container as a side effect, so "does `meta` exist" is `registered in doc.share` **and** non-empty.
  `isSchemaMajorMismatch` returns `false` when `meta` is absent (that is the migration case) and
  `true` on anything unreadable (refuse to guess).
- Priority for Worker 4: **CRITICAL**

### WP9 — Atomic `pos`/`size` registers
- Status: DONE (attempt 1) · Tests: visible 4 files / 8 tests · blind 4/6 + 4/4
- Changed files: **created** `plugin/src/canvas/canvas-registers.ts` — a zero-import pure core
  (no Obsidian, no fs, no clock, **no Yjs**) in three parts: V2 vocabulary, pure file↔doc codec,
  and doc accessors over a structural `V2RecordMap` that `Y.Map<unknown>` satisfies with no cast.
- `GEOMETRY_KEYS` untouched and still exported; the module deliberately declares no mirror set.
- Open assumption: `encodePos`/`encodeSize` **round finite input to whole pixels**, reading C9's
  "rounding integration" as this boundary, so the doc can never hold sub-pixel geometry regardless
  of caller discipline. If registers were meant to store fractional geometry faithfully, that is a
  two-line change in `normalizeGeometryScalar`.
- Priority: NORMAL

### WP10 — Atomic `from`/`to` endpoint registers
- Status: DONE (attempt 1) · Tests: visible 4 files / 9 tests · blind 4/6 + 4/6
- Changed files: **appended** to `canvas-registers.ts` (WP9's deliberate seam: `V2Edge` is generic
  over its endpoint type with default `unknown`; the `from`/`to` key names already lived in `V2_FIELD`).
- AC4 is enforced **at runtime, not only in the type system**: `encodeEndpoint` throws on a partial
  endpoint even when TypeScript is bypassed, the type guards reject partial values, **no
  per-component setter is exported**, and a value hand-written past the API reads back as absent.
- **Worker-3-Core intervention, disclosed:** the terminated coder shipped `writeFromRegister`/
  `writeFrom` but only `readFrom`/`readTo` — the `readFromRegister`/`readToRegister` spelling its own
  published contract specified was missing, and both blind sets failed on exactly that. Worker 3 Core
  added the two accessors as thin delegations. This completes the agent's own contract and restores
  WP9's naming symmetry; the `write*Register` counterparts and the `readPosRegister` precedent
  already existed, and no assertion anywhere was altered.
- Rough edge for consumers: a naming asymmetry inherited from WP9 — on the geometry side `readPos`
  returns the **decoded file shape**, on the endpoint side `readFrom` returns the **register**.
  Both spellings now exist for endpoints, but import deliberately.
- Priority: NORMAL

### WP11 — Write-once `type` guard
- Status: DONE (attempt 1) · Tests: visible 3 files / 3 tests · blind 3/3 + 3/3
- Changed files: **created** `plugin/src/canvas/canvas-type-guard.ts`. Zero imports beyond
  `canvas-registers.ts`; the `"type"` key name is never spelled inline.
- Only the `accepted` branch calls `record.set`. `noop` and `rejected` return without touching the
  record, so AC2's "no delta" is literal — a same-value LWW `set` in Yjs still emits a real update,
  and a save re-states every field, so same-value is the *common* case, not the edge case.
- `PROTECTED_KEYS` untouched. AC3 is classified `INTEGRATION_SCOPE` (charter §7b) — proving "a record
  can never reach the doc without `type`" needs the wired write boundaries (WP18). **W4 Test Targets: 1.**
- Conscious decision to sanity-check at composition time: a record already holding `""` or a
  non-string `type` is treated as **typeless**, so the next valid write repairs it. This matches
  `auditCanvasState`'s own predicate; the maximally literal write-once reading would instead freeze
  exactly the corruption the auditor exists to flag.
- Priority: NORMAL

### WP12 — Tombstone map core
- Status: DONE (attempt 1) · Tests: visible 10 files / 18 tests · blind 10/16 + 10/15
- Changed files: **created** `plugin/src/canvas/canvas-tombstone.ts` — zero import statements,
  no `Date.now()` anywhere (Lamport `t` is logical).
- The merge is `max` over a **total** order `(t, by, on, q)`. Extending the rank key past the
  spec-pinned `(t, by)` is what makes it provably commutative, associative and idempotent — stopping
  at `(t, by)` would force an arbitrary "pick the first argument" on a full tie, which is the
  non-commutative step. It never consults Yjs's random-`clientID` arbitration.
- `q` is normalised to **present only when true**, so an ordinary undo and a quarantine release
  produce byte-identical key shapes and two replicas in identical semantic state emit no spurious delta.
- **AC3 losslessness is structural, not careful:** the `TombstoneMap` seam exposes only `get`/`set` —
  no `delete`, no `clear` — so a tombstone op *cannot* reach a record's field container.
  **Note for WP25:** sidecar GC will have to widen that seam deliberately.
- Two dynamic export scans will fail loudly if a later WP adds a competing suppression predicate.
- Priority: NORMAL

### WP13 — Fractional `ord` allocator
- Status: DONE (attempt 1) · Tests: visible 7 files / 20 tests · blind 7/15 + 7/13
- Changed files: **created** `plugin/src/canvas/canvas-ord.ts` — pure, zero imports, randomness only
  through an injected `rng` seam (so nothing is flaky).
- **The format decision, which is load-bearing:** `ord` is one opaque base-62 string over
  `0123456789A–Za–z`, an alphabet whose digit order equals code-unit order, so `compareOrd` is plain
  code-unit comparison. The 12-digit client tag is a deterministic fingerprint of `clientID`, encoded
  **in the same alphabet with no separator**. A `<digits>-<clientID>` format would create neighbour
  pairs with **nothing representable strictly between them** (two peers drawing the same jitter →
  same digits, different client; inserting between them would require a clientID lexically between
  two given ones, which the allocating client does not have). Same-alphabet encoding removes that
  class entirely.
- Growth data for WP18's planning: 2 000 sequential appends → 97 chars; 2 000 head inserts → 435;
  3 000 narrowing inserts → 638. Typical `ord` is 13 chars.
- Degenerate input (`after` not strictly above `before`) does **not** throw inside a save path — the
  impossible bound is dropped and the value allocated after `before`.
- Priority: **HIGH** — every replica's file byte order depends on this comparator.

### WP14 — Ingest schema validator
- Status: DONE (attempt 1) · Tests: visible 13 files / 39 tests · blind 13/32 + 13/30
- Changed files: **created** `plugin/src/canvas/canvas-ingest-schema.ts` — two relative imports only,
  no Yjs/Obsidian/fs (a visible test scans the source for exactly this).
- **AC3's asymmetry is data, not convention:** `IngestInvalid.reject` is computed in exactly one place
  as `origin === "local"`, and `IngestValid` has **no `reject` key at all**, so origin cannot leak into
  the valid path. **WP18 must obey `verdict.reject` rather than re-deriving rejection from the origin
  at the call site** — that re-derivation is precisely the bug this AC exists to catch.
- **Edge validity is a straight delegation to `hasBothEndpoints`**, not an agreeing re-implementation,
  so WP23's fuzzer oracle is structurally incapable of drifting from this barrier.
- **The Worker-2 escalation-5 constraint was explicitly checked and is satisfied:** `V2Node.text` is
  already typed `unknown` in `canvas-registers.ts` for P4 forward-compat. `isRichTextValue` accepts a
  non-empty string **or** a non-null non-array object — duck-typed on purpose, since `instanceof Y.Text`
  would import Yjs and break AC4 purity. A real standalone `new Y.Text(...)` validates. **Not a
  contradiction.**
- Judgement call to sanity-check: the type-specific table covers `file`→`file`, `text`→`text` **plus
  `link`→`url`**, read as §4.5's "…" after the two named instances. A node type absent from the table
  (e.g. `group`) has no type-specific requirement — silence means "nothing further demanded", never
  "unknown, therefore refuse".
- Priority: NORMAL

### WP15 — Shadow at register granularity ← **found and fixed a real I6 defect**
- Status: DONE (attempt 1) · Tests: visible 6 files / 17 tests · blind 6/11 + 6/11
- Changed files: `plugin/src/canvas/canvas-shadow.ts` only, modified in place.
- **The defect:** `planIntentDiff` rule 2's staleness test was **reference equality** (`value === getField(...)`),
  but `encodePos`/`encodeSize` **freeze a new array on every call**. A same-pixel restatement therefore
  never compared equal, so the save silently read as **fresh intent** — which is pushed to the CRDT and
  overwrites newer peer state. That is the cascade this entire initiative exists to kill, reintroduced
  through the back door by the register work. Fixed with structural equality for array/object values;
  `fieldValueEquals`'s first line is `if (a === b) return true`, so **the primitive path is
  byte-identical to P0** — which is what keeps every P0 suite green.
- AC1, AC3 and AC4 needed **no** production change; the visible suite confirms them.
- **Judgement call, accepted by Worker 3 Core:** the coder did *not* add a production
  `import { isTombstoneSuppressed }`. The module consumes deletion as a read-only `TombstoneView`
  input seam and contains **zero** copies of "is this deleted" — no inline `entry?.on`, no local
  helper. C12 AC2 demands "one shared predicate, not three copies"; **zero copies is stronger than
  one import**, and an adapter would have been dead code inventing a `deleted`-map key convention
  WP15 does not own. I accept this as satisfying AC3 in substance.
- No existing test was adjusted. P0 buckets (wp1/wp2/wp4/wp5v2/wp6) 164/164; whole `v2/` tree 330/330.
- Priority: **HIGH** — the advance rule is the whole safety property and remains asymmetric.

### WP16 — `parseCanvas` V2 + conservative `ord` capture
- Status: DONE (attempt 1, after the WP3 instrument conflict was resolved) · Tests: visible 8 files / 13 tests · blind 8/13 + 8/11
- Changed files: `plugin/src/files/canvas-sync.ts`; plus a bridge in `plugin/src/files/canvas-persistence.ts`
  for a **fourth internal consumer the brief did not name** — `coldOpen()` feeds `parseCanvas` straight
  into `applyToYMap`, and without bridging it the one-time file seed would have written registers into
  the doc through the flat seed path. Good catch by the coder.
- **AC3 minimality is a computation, not a heuristic:** keep the **longest strictly-increasing
  subsequence** of survivors' positions and reassign only the complement — `n − |LIS|` is the provable
  minimum. Moving one record end→front reassigns exactly one `ord`.
- "Has the order changed" is answered by recomputing canonical order via WP13's `compareOrdId` —
  never array position, never `<` on raw strings, never `localeCompare`.
- Failure semantics preserved byte for byte: JSON error → empty records + empty order, no throw;
  entries without `id` dropped from records **and** order.
- **TEMPORARY SEAM — `decodeCanvasDataToFlat`.** It sits immediately after every internal
  `parseCanvas` call and expands registers back to flat keys, so downstream write paths keep seeing
  exactly the shape they saw before. **This is a P1 scaffold and is retired by WP18.** Its existence
  is why the four load-bearing suites stayed green without modification.
- Existing tests adjusted: **one** — `v2/wp3/test_file_shape_tabs_visible.test.ts`, documented in full above.
- Priority: **HIGH**

### WP17 — Canonical serializer V2
- Status: DONE (attempt 1) · Tests: visible 12 files / 12 tests · blind 12/13 + 12/13
- Changed files: `plugin/src/files/canvas-sync.ts` — `buildCanvasData` / `serializeCanvas` gain an
  **optional** third `deletedMap` parameter so both existing 2-argument call sites keep compiling with
  unchanged behaviour.
- **The subtlest finding in the batch, and Worker 4 should understand it:** `canonicalizeCanvasData`'s
  array-level sort is **id-only**. Routing the final array through it would silently discard the
  `ord` order **while still producing byte-identical files across replicas** — so a two-replica
  byte-equality test *cannot detect the bug*. It was bypassed at the array level and kept at the
  record level (`canonicalizeRecord`). This is why the WP17 tests assert both byte equality **and**
  the emitted sequence.
- The `""` `ord` fallback makes a canvas with no `ord` degenerate to exact P0 id order, which is what
  keeps the frozen WP3 suite green.
- The suppression cascade is folded into the same `visibleNodeIds` set the pre-existing GAP-5
  dangling-edge guard reads, so AC2's cascade and the P0 prune are **one rule that cannot disagree**.
  Endpoint ids are read **after** register expansion, otherwise the cascade would be blind to every
  `from`/`to`-register edge.
- **Nothing in production passes a `deletedMap` yet** — reaching the `deleted` container from
  `CanvasPersistence` is WP18's wiring. Suppression is therefore implemented and unit-proven but
  **inactive in production**.
- Priority: **HIGH**

---

## Risk Notes for Worker 4

**WP8 (CRITICAL).** The migration is implemented, idempotent, lossless and unit-proven — **and it
never runs.** There is no production call site, for a defensible reason (see above), which means no
real V1 canvas has yet been migrated by this code. Worker 4 should treat "does an existing V1 doc
actually become a V2 doc when a user opens it?" as **unverified**, not as passing. Related: because
the migration is additive, a migrated record carries **both** flat V1 keys and V2 registers, so any
probe that asserts "the flat keys are gone" will fail correctly and must not be "fixed" by making the
migration destructive — that would permanently break AC3's zero-delta idempotence.

**WP16/WP17 (HIGH) — the two temporary seams.** `decodeCanvasDataToFlat` (WP16) and the unused
optional `deletedMap` (WP17) are scaffolding that makes P1 cores land without disturbing P0
behaviour. Both are retired by WP18. The risk is that they make the system *look* wired when it is
not: **tombstone suppression does not affect any file Obsidian actually writes yet**, because no
caller passes a `deletedMap`. Do not report that as working.

**WP13/WP16/WP17 (HIGH) — the byte-order chain.** Three work packages now cooperate to decide the
order of records in the `.canvas` file. They agree today because all three import one comparator. The
highest-value integration probe available is: **two replicas, a reorder, then compare the two files
byte for byte** — and, critically, also compare the *emitted sequence*, because an id-only sort
produces byte-identical files while silently discarding `ord` order. A byte-equality assertion alone
is not sufficient to catch this class.

**WP15 (HIGH).** The shadow advance rule remains the whole safety property, and it is asymmetric:
advancing too eagerly converts a user's genuine edit into "staleness" and discards it (data loss);
advancing too conservatively turns a stale restatement into fresh intent that overwrites newer peer
state (the cascade). This batch fixed one concrete instance of the second failure (frozen-array
reference equality). Worker 4 should probe the composite registers specifically: a peer whose apply
partially fails, then moves a card, then saves.

**WP9 (NORMAL).** `encodePos`/`encodeSize` round to whole pixels at the register boundary. If any
real Obsidian canvas legitimately carries fractional geometry, that rounding becomes a silent,
repeated normalisation. Worth one look at a live canvas.

**Nothing in this batch has been verified against a real Obsidian.** All ten WPs are proven at unit
and injected-seam level only. That remains the R2 verification gap, owned by WP7/WP43–WP51.

---

## Summary for Worker 4 Entry Point

P1's **data model** now exists as seven pure, independently testable modules under
`plugin/src/canvas/`: `canvas-registers.ts` (WP9 + WP10), `canvas-ord.ts` (WP13),
`canvas-schema.ts` (WP8), `canvas-type-guard.ts` (WP11), `canvas-tombstone.ts` (WP12),
`canvas-ingest-schema.ts` (WP14), plus the lifted `canvas-shadow.ts` (WP15). Every one is importable
with no Obsidian, filesystem or clock dependency, so they can be driven directly from a test.

What is **observable end to end today**: `parseCanvas(content)` returns V2 registers plus an explicit
`order` observation (WP16), and `serializeCanvas(nodes, edges, deletedMap?)` emits the canonical
`.canvas` file sorted by `(ord, id)` with registers expanded and `ord` never written (WP17). Those two
are genuine round-trip partners — `parse(serialize(state))` is order-stable.

What is **implemented but not yet wired**, and must not be reported as working: the V1→V2 migration
(no call site), tombstone suppression in the serializer (no caller passes a `deletedMap`), the ingest
validator and the write-once `type` guard (no write boundary calls them). All four are WP18's job in
the next batch. The fastest way to see the cores work is the visible buckets themselves —
`npx vitest run src/__tests__/v2/wp8/ … wp17/` — which are the best executable documentation of the
intended behaviour.

---

## Automation Candidates

- **The blind runner's proof-of-execution rewrite (WP55) should be treated as mandatory tooling, not
  an improvement.** My first eight WPs ran under the pre-repair version; had their sets been named
  `_blind1.ts` instead of `_blind1.test.ts` they would have reported green having executed nothing.
  The re-verification driver (`_reverify_b2.py`) that prints **collected counts per set** should be
  standard at every handover — a blind pass without a count is not evidence.
- **My own driver produced a false all-zero report** on its first run through a regex that terminated
  at the wrong rule. A false zero is as dangerous as a false green; any aggregation script over test
  output should be checked against one known-good set before being trusted.
- **A "shared constant" lint** would mechanise what the Shared Ownership Contract does by convention:
  flag any module that declares a string literal or constant already exported by a sibling core.
  Everything this batch prevented by hand — the `ord` comparator, the suppression predicate, the V2
  key names — is mechanically detectable.
