# Task Charter — WP18: Ingest + create-once wiring

**Charter Status:** `RISKY`
**WP:** WP18
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP14, WP16, WP17
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the doc cannot be brought into an invalid state by any local source.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C18 — Ingest validation and create-once transactions at every write boundary** (work package WP18); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (seed path `canvas-sync.ts:388–401`, `seedDocFromCanvasData` `canvas-persistence.ts:363–387`, the capture writer `applyLocalDiffToYMaps` `:620–704`, and the import path from WP30)
  - Responsibility: wire the validator in at every doc write boundary and make record creation a single validated transaction.
  - Scope summary: validation at every write boundary; single-transaction creation
- **Out of scope / non-goals:**
  - The validator's rules themselves — WP14.
  - The `CAPTURE_OP` boundary — that is P5 (WP39); wire the seam so it can be added without redesign.
  - Quarantining records already in the doc — WP20.
- **Known interfaces / dependencies:**
  - Input: proposed records from seed, `CAPTURE_NET`, and import (and, from P5, `CAPTURE_OP`)
  - Output: validated writes, or rejection with a signature
  - Depends on work packages: WP14, WP16, WP17
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 schema-invariant assertion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Ingest validation and create-once transactions at every write boundary
- **Interfaces involved:**
  - Input: proposed records from seed, `CAPTURE_NET`, and import (and, from P5, `CAPTURE_OP`)
  - Output: validated writes, or rejection with a signature
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - **Schema impact:** **`meta.schemaVersion = 2`.** The *doc* format changes; the `.canvas` *file* format does not. Mixed-version rule (CONCEPT_V2 Teil 12): a client whose major schema version differs from the doc's goes to Receive-and-Persist rather than guessing a translation. In P1 that degradation is local — capture disabled for the path, persistence continues — and it is unified with the room-level mode in WP32.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/files/canvas-sync.ts:388–401` — the host seed transaction
  - `plugin/src/files/canvas-persistence.ts:363–387` — `seedDocFromCanvasData`
  - `plugin/src/files/canvas-sync.ts:620–704` — `applyLocalDiffToYMaps`, the `CAPTURE_NET` writer
  - `plugin/src/files/canvas-sync.ts:171–195` / `:210–234` — `applyToYMap` / `applyKeyDiff` (the delete guards)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C18. No paraphrasing.*

1. Every local write boundary consults the validator before writing; an invalid local record never reaches the doc and produces a rejection signature naming the boundary and the reason.
2. Record creation happens in one transaction carrying a complete record; no code path calls `set(id, new Y.Map())` for an id that already exists.
3. Partial observation produces upserts only — no local write path deletes a doc key that is merely absent from the incoming record (I7).
4. Remote deltas are never rejected at ingest; they are left to the quarantine auditor.

**Definition of Done:** the doc cannot be brought into an invalid state by any local source.

<!-- Updated: I7 attribution clarified after the WP4 escalation — no AC changed 2026-07-31 -->

**Amendment note (2026-07-31) — scope clarification, no acceptance criterion changed.** AC3's I7 rule is unchanged and still owned here, but its remaining surface is now smaller than the entry points below suggest. WP4 (P0) already removed deletion-by-key-omission from the **Obsidian-save capture path**: `applyLocalDiffToYMaps` / `applyKeyDiff` no longer exist as a diff path, and `handleLocalModify` derives every write from the C2 intent plan, which has no field-removal category. What AC3 still has to close is therefore the **seed boundaries** — `applyToYMap`, reached from the `CanvasSync.subscribe` host seed and from `CanvasPersistence.seedDocFromCanvasData` (cold open) — where absent keys are still deleted under the `PROTECTED_KEYS` guard. Retiring that guard is this WP's job, not WP4's; WP4 was explicitly forbidden to touch it. See BUILD_SPEC §3.1 S4 for the three-boundary split and §4.6 for the phased I7 traceability.

**Consequence for the test suite:** when this WP retires the `applyToYMap` delete guard, the replacement discrimination pair added by WP4 AC6 (which asserts that disarming `PROTECTED_KEYS` on the seed path loses an endpoint) becomes unsatisfiable in the same way `A9`/`A10` did. Retire it here, by name, under the same deletion-ledger rule (§7) — do not weaken it and do not leave it red.

---

<!-- Updated: Worker 2 rulings on the B3 escalation (E1, E2, E3) + deletion ratification 2026-08-02 -->

## 4b. Worker 2 rulings on the B3 escalation (2026-08-02)

**No acceptance criterion of this WP is changed. AC1–AC4 stand exactly as written.** What changes is the state of the modules WP18 wires together, plus three explicit licences.

### E1 — the endpoint model is fixed at the model, in WP10. Not here, and not by WP18 special-casing.

**Ruling:** a side-less endpoint is a legal, representable endpoint. `side` (and `end`) are optional components of the single `{node, side?, end?}` register; `node` alone decides presence. Amendments land in **WP10 (AC5)**, **WP14** (pin the side-less edge as valid directly) and **WP17 (AC5)** (omit the key; byte-identical round-trip). WP18 must **not** compensate for this locally.

**The coder was right to refuse to fabricate a `side`, and right to escalate.** Inventing one would have written data the user never authored into a validity boundary, and admitted a record `migrateV1ToV2` could not convert. That refusal is the correct behaviour under pressure and is recorded as such.

**Correction to the escalation's own reasoning — this matters and it inverts one conclusion.** The handover states that E2 option (b) "collapses E1 as well". **It does not.** A quarantined record is *"nie serialisiert"* (Teil 11), and `CanvasPersistence` writes `serialize(doc)` over the file — so a quarantined side-less edge **still leaves the user's `.canvas` file** on the next flush, exactly as a refused one does. Quarantine protects the **doc**, not the **file**. E1 is a representability defect and had to be fixed at the model on its own merits; no seed-boundary policy could have substituted for it.

**Second instance of the same class, found during this ruling and not in the escalation:** WP14 refuses `"text": ""`, which is a **legal** JSON Canvas text node (an empty or cleared card). Same defect shape, same destructive consequence. Corrected in the WP14 amendment.

### E2 — the seed stays on the LOCAL side. Refusal is correct. The *coupling* is the defect.

**Ruling, part 1 — classification.** The seed is a **local** source; C18 AC1 stands and refusal at the seed is retained. Teil 11's stated reason for never rejecting remote deltas is *"das würde Divergenz erzeugen: Replikat A akzeptiert, B lehnt ab"* — the asymmetry is a **convergence** rule, not a trust rule. Refusing a seed record diverges nothing: one replica reads the file, and all replicas agree the record is absent. The seed therefore sits with `CAPTURE_NET` and Import. **Option (b) is refused**, and quarantine is the wrong instrument at this boundary for the reason given under E1.

**Ruling, part 2 — the real defect, which the escalation identified correctly.** *"Reject at ingest" and "delete from disk" are different things, and the current behaviour couples them.* That is exactly right and it is the finding of this batch. Refusal composed with `flush()` into silent, permanent deletion from a file the user did not create with this plugin — and **no acceptance criterion anywhere owned that composition**, which is why it passed review. It is now named as invariant **I11 REFUSAL NEVER DESTROYS** and owned by the new **WP63**.

**Scope for WP18: none.** WP63 is a separate WP, depends on WP18, and does **not** block WP19–WP23. Do not implement it here; do not weaken AC1 in anticipation of it.

### E3 — the call site is correct. The instrument is amended.

**Ruling:** `migrateV1ToV2` stays in `CanvasPersistence.coldOpen()`, after the seed, on both record-bearing branches, exactly as implemented. The `expect(tx.count()).toBe(0)` conjunct is amended under §7's amendment class.

**Why the call site and not the assertion.** Placing the migration after the seed is *forced* by the one-shot `meta` guard — stamping first strands everything seeded afterwards behind it, which is precisely what broke attempt 1. Moving the call site to satisfy the instrument would reintroduce that failure. The test's own title names its subject: *"NO file→CRDT read"*. `tx.count() === 0` was a valid proxy only while a file→CRDT seed was the sole thing that could open a transaction on that branch; a migration is a doc-internal translation that reads nothing from the file. The proxy now forbids a transaction the spec mandates while still not pinning the property it exists to protect — an instrument over-specifying its subject, the same shape B2 resolved for WP3/WP16.

**The empty-doc baseline (`tx.count() === 0`, migrate only when the doc is empty) is explicitly REFUSED.** A V1 doc arriving from the relay is by definition non-empty; migrating only empty docs is a no-op that leaves WP8's Definition of Done unachieved.

**Required amended form — strictly stronger, three conjuncts, all must hold:**
- `expect(tx.countWithOrigin(CANVAS_SEED_ORIGIN)).toBe(0)` — the subject, now pinned **directly** rather than by proxy
- `expect(tx.countWithOrigin(CANVAS_MIGRATION_ORIGIN)).toBe(1)` — exactly one migration, not "at least one"
- `expect(tx.count()).toBe(1)` — and **nothing else** opened a transaction

This requires `migrateV1ToV2` to run its transaction under a **distinct exported origin** (`CANVAS_SEED_ORIGIN` already exists as the seed's; add the migration's). Transacting with a bare/undefined origin fails the new assertions. Every other assertion in that test — doc wins, file overwritten with the doc's content — is **untouched**. Enumerate it in the amendment ledger per §7.

**Also confirmed:** WP16's `decodeCanvasDataToFlat` bridge is **RETAINED**. Migrating after the seed removes any need to retire it; retiring it was never a WP18 acceptance criterion, and forcing it broke pre-V2 readers for no AC gain. It retires naturally when the write boundaries move to the registers (WP22/WP39), not by decree here. The decision **not** to add a second migration call in `CanvasSync.subscribe` is also ratified — one arming point for a one-shot guard is correct.

### Deletion — RATIFIED

`plugin/src/__tests__/v2/wp4/test_tp08_protected_keys_seed_discrimination_visible.test.ts` **stays deleted.** §7's licensed-deletion list is amended to **WP4, WP18, WP21, WP22, WP33**, with WP18's row naming both tests verbatim. The charter ordered the retirement by name and the implementation report enumerated it; only the list lagged. **The licence covers exactly those two tests in that one file and nothing else.**

Checked, because the irony is real: those tests pinned `PROTECTED_KEYS` discrimination *on the seed path* — the boundary E1/E2 are about. They pin that a delete guard is **live**, and after AC3 there is no delete at the seed for a guard to shield. They pin **no** E1 or E2 property. That coverage did not exist anywhere before this ruling; WP10 AC5, WP14's direct pin, WP17 AC5 and **WP63 AC4** create it.

### The three licences, and the order they must be exercised in

**This order is mandatory. Do not start at step 3.**

1. **Land E1 and E3 first** (WP10/WP14/WP17 amendments + the migration origin + the amended `tx` assertion), then **re-run the full suite and re-measure.**
2. **Re-classify from that new measurement.** Several of the 29 class-A failures are expected to go green from E1 alone, with **no fixture touched** — all seven A4 rows, and any row whose only other conjunct was the `text: ""` rule.
3. **Only then** apply the **fixture-completion licence** (§7, fourth class — granted to WP18 only) to what is still red. Complete the fixture to a legal JSON Canvas record: add only the format-required fields with neutral values, keep every id, coordinate, edge topology and **every value any assertion reads** byte-identical. Touch **no** assertion, no matcher, no strictness, no `skip`/`only`. Enumerate every edited fixture by file, test title and the exact keys added. Falsify at least one representative per subject family (merge, echo window, lock denial, delete paths, dangling-edge pruning). **If completing a fixture changes what any assertion observes, or makes a test pass for any reason other than the record now being admitted — leave it red and ESCALATE.**

**A fixture completed for a test that step 1 would have fixed anyway is an unlicensed edit.** The point is to touch as few fixtures as the defect actually requires, not as many as the first measurement suggested.

### What is explicitly ratified as correct and must be kept

WP18's implementation is substantially right and is **not** to be redone: the single shared `admitRecordIngest` gate at all three local boundaries branching on `verdict.reject` and never re-deriving rejection from origin; create-once via draft → detached `Y.Map` → single attach; the retirement of the absent-key delete loop (AC3/I7); `PROTECTED_KEYS` preserved as an exported constant; the migration call site and its ordering; and the `decodeV2RecordToFlat` two-pass precedence fix (now owned by WP17 AC5).

**The classification method is ratified too.** Establishing Class B as empty **by counterfactual measurement** (gate forced open: 30 → 5) rather than by assertion is the correct way to answer "is this my bug or the spec's", and it is what made this ruling possible. Blind sets remain **UNVERIFIED** and must be re-run under the WP55 runner with recorded collected counts once the implementation is final — not before, since running them against an implementation about to change produces a number with no shelf life.

### Expected arithmetic

30 failures → **0**. Accounted for exactly: **7** (A4) close from E1's model fix with no fixture touched; **1** (the `tx.count()` conjunct) closes from E3's amendment; the remaining **22**, minus any that E1's `text: ""` correction also closes, from the fixture-completion licence. Test count changes by **−2** and only by −2 — the ratified `tp08` deletion, already taken. Any other movement in the count is unlicensed and is an abort criterion.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map.
- **Known flaky patterns:**
  - No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.
  - No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).
  - Never reason from two peers only — interleaving classes from three peers upward are distinct.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.
  - Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.
  - `CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.
  - **Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.
  - `GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.
  - `plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.
  - `plugin/src/main.ts` may hold wiring only, never logic — it has no test file.
  - `canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).
  - `server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/canvas-sync.ts`
  - `plugin/src/files/canvas-persistence.ts`
- **Required report:** `ImplementationReport_WP18.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

All files live in `plugin/src/__tests__/v2/wp18/` and are collected by `npm test`.
12 test points, 15 visible test cases. State is the oracle throughout; rejection
signatures are asserted only as the secondary check AC1 names by hand.

**Note on the two additional behaviours below.** TC7–TC11 pin the **V1→V2 migration call
site** (WP8's open HIGH risk: `migrateV1ToV2` is landed and unit-proven but has *no*
production caller, so "an existing V1 canvas doc opens as a valid V2 doc" is not achieved
end to end). The call site belongs in `CanvasPersistence.coldOpen()` and must leave **both**
branches migrated — the broken case today is the *doc-non-empty* branch, which a real V1
doc from the relay always takes. TC12 pins that `PROTECTED_KEYS` survives as an exported
constant with unchanged membership even though this WP retires its last reader (Shared
Ownership Contract §4).

**Amendment (2026-08-01, Worker 3 course correction) — ordering, and what is NOT pinned.**
The migration runs **after** the seed, not before it: empty doc → seed → migrate (nothing
is left behind the one-shot `meta` guard); non-empty V1 doc → migrate directly; second
open → `meta` present → the guard no-ops, so WP8 AC3 idempotence still holds. Consequently
**no test pins the vocabulary the seed itself writes.** Retiring WP16's
`decodeCanvasDataToFlat` bridge is not a WP18 acceptance criterion — §2 and §4 never
mention it, it is a P1 scaffold, and forcing it here breaks pre-V2 tests that read flat
`x`/`y` for no AC gain. TC11 was rewritten accordingly (it now asserts `coldOpen`'s
post-condition instead of the seed's intermediate shape) and TC5's oracle moved from the
ingest validator to record completeness, because a record is legitimately not yet in the
V2 vocabulary at the moment the seed publishes it. TC1–TC4, TC6 and TC12 were already
vocabulary-neutral and are unchanged; TC7–TC10 never asserted an ordering and are
unchanged.

### TC1 — AC1 at the host-seed boundary
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp18/test_tp01_host_seed_rejects_invalid_local_record_visible.test.ts
- What it checks: a type-less node in the host's `.canvas` file never reaches the doc (no husk container either), its valid sibling does, and a rejection signature names the boundary and `MISSING_TYPE`.
- Test data channel: fixture

### TC2 — AC1 at the cold-open seed boundary
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp18/test_tp02_cold_open_seed_rejects_invalid_local_record_visible.test.ts
- What it checks: `CanvasPersistence.coldOpen()`'s seed refuses the same invalid record and signs it, so AC1's "every local write boundary" covers the second seed path and not only `canvas-sync.ts`.
- Test data channel: fixture

### TC3 — AC1 at the capture boundary (`CAPTURE_NET`)
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp18/test_tp03_capture_boundary_rejects_invalid_new_record_visible.test.ts
- What it checks: a save introducing a type-less NEW node does not create it while the complete new node in the same save is created, with a signature naming the capture boundary; the record's doc vocabulary is deliberately not asserted.
- Test data channel: fixture

### TC4 — AC4 remote deltas are never rejected at ingest
- Verifies AC: AC4
- Test file: plugin/src/__tests__/v2/wp18/test_tp04_remote_delta_never_rejected_at_ingest_visible.test.ts
- What it checks: one scenario, one doc — the identical schema failure (`MISSING_TYPE`) is refused and signed when proposed locally and kept, unrepaired and unsigned, when it arrives as a peer delta (the `verdict.reject` trap of Shared Ownership Contract §2.3).
- Test data channel: fixture + deterministic peer `Y.Doc` (causally ordered, never concurrent)

### TC5 — AC2 create-once: one transaction, complete record, container never replaced
- Verifies AC: AC2
- Test file: plugin/src/__tests__/v2/wp18/test_tp05_create_once_complete_record_single_transaction_visible.test.ts
- What it checks: the first time a seeded record is observable at all it already carries its whole payload (never a husk that is filled in afterwards, never observable without its own `id`/`type`); a second host seed merges into the SAME `Y.Map` instance and a peer's concurrent field on it survives. The completeness oracle is the record's own content, not the ingest validator — the migration runs after the seed, so a just-published record is legitimately not yet in the V2 vocabulary.
- Test data channel: fixture

### TC6 — AC3 the seed upserts only (I7)
- Verifies AC: AC3
- Test file: plugin/src/__tests__/v2/wp18/test_tp06_seed_is_upsert_only_i7_visible.test.ts
- What it checks: doc keys the host's file omits (`color`, `background`, an edge's `color` — none of them shielded by `PROTECTED_KEYS`) survive the seed, while the file's own values still land; record-level re-seed destruction is left to WP29 and is not asserted.
- Test data channel: seed (doc pre-state) + fixture (file)

### TC7 — the V1→V2 migration call site fires on the doc-non-empty branch
- Verifies AC: AC1 (enabling behaviour — the migration call site WP8 left unwired)
- Test file: plugin/src/__tests__/v2/wp18/test_tp07_cold_open_migrates_existing_v1_doc_visible.test.ts
- What it checks: a non-empty, unstamped V1 doc taking the `doc-wins` branch comes out with `meta.schemaVersion = 2`, atomic `pos`/`size`/`from`/`to` registers and an `ord` on every record.
- Test data channel: seed (V1-shaped `Y.Doc`)

### TC8 — the migration call site is idempotent
- Verifies AC: AC1 (enabling behaviour)
- Test file: plugin/src/__tests__/v2/wp18/test_tp08_cold_open_migration_idempotent_no_delta_visible.test.ts
- What it checks: a second cold open produces the empty Yjs update against the post-first-open state vector and fires zero `update` events, so re-joining never echoes a same-value rewrite to every peer.
- Test data channel: seed (V1-shaped `Y.Doc`)

### TC9 — the migration call site is additive, never destructive
- Verifies AC: AC1 (enabling behaviour) · AC3 (same I7 rule, on the migration path)
- Test file: plugin/src/__tests__/v2/wp18/test_tp09_cold_open_migration_is_additive_visible.test.ts
- What it checks: every original field — including the translated flat V1 keys and an unknown forward-compat key — is still present and unchanged after cold open, with the registers added alongside; the flat keys are explicitly NOT asserted to be gone.
- Test data channel: seed (V1-shaped `Y.Doc`)

### TC10 — a doc already at `schemaVersion 2` is untouched
- Verifies AC: AC1 (enabling behaviour)
- Test file: plugin/src/__tests__/v2/wp18/test_tp10_cold_open_leaves_v2_doc_untouched_visible.test.ts
- What it checks: cold open on an already-V2 doc yields zero CRDT delta and zero `update` events, and `meta` keeps both its value and its container identity.
- Test data channel: seed (V2-shaped `Y.Doc`)

### TC11 — `coldOpen`'s post-condition: no record is left unmigrated, on either branch
- Verifies AC: AC1 (enabling behaviour — the migration call site's placement)
- Test file: plugin/src/__tests__/v2/wp18/test_tp11_cold_open_leaves_no_record_unmigrated_visible.test.ts
- What it checks: once `coldOpen` resolves — on the seed branch and on the doc-wins branch alike — the doc carries `meta.schemaVersion = 2` and **every** record in it satisfies the V2 ingest schema and carries an `ord`; the vocabulary the seed passes through on the way there is deliberately not asserted.
- Test data channel: fixture (seed branch) + seed (V1-shaped `Y.Doc`, doc-wins branch)

### TC12 — `PROTECTED_KEYS` survives the retirement of its last reader
- Verifies AC: AC3 (the constant the retired guard used, per Shared Ownership Contract §4)
- Test file: plugin/src/__tests__/v2/wp18/test_tp12_protected_keys_survive_as_exported_constant_visible.test.ts
- What it checks: both sets are still exported with exactly their established membership, and `PROTECTED_KEYS` is still a strict superset of `GEOMETRY_KEYS`.
- Test data channel: deterministic generator (imported constants only)

**Not covered, and why:** the vocabulary the seed writes — see the amendment note above; it
is a P1 scaffold decision, not an acceptance criterion. AC3 at the cold-open seed is
structurally vacuous — `coldOpen`
only seeds when the doc is empty, so `seedDocFromCanvasData` has no pre-existing key it
could delete. The live AC3 surface is the host seed (TC6). The `CAPTURE_OP` boundary is
out of scope (P5/WP39) and the import boundary does not exist yet (WP30).

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* No AC in this WP requires a running two-instance rig, a UI surface
or a live relay: every boundary is reachable through injected seams (`PersistenceIO`,
the vault/sync-manager doubles, an in-process peer `Y.Doc`).

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 2)

- **Observed current behavior:** `migrateV1ToV2` had no production caller; the three local write
  boundaries wrote unvalidated records; `applyToYMap` deleted absent keys under the `PROTECTED_KEYS`
  guard. Attempt 1 wired the migration BEFORE the empty/non-empty split, which forced the seed into
  the V2 vocabulary and broke every pre-V2 reader of flat `x`/`y`.
- **Approach:** one shared gate (`admitRecordIngest`) at all three boundaries, branching on WP14's
  `verdict.reject` and judging the **V2-converted** view of `doc ∪ proposal`; create-once via
  draft → detached `Y.Map` → single attach; the absent-key delete loop retired; and the migration
  moved to run **after** the seed, only on a doc that holds records.
- **Fallback path if all attempts fail:** report the residual by exact measurement (gate forced open)
  rather than narrowing the validator or editing fixtures.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1–AC4 wired and green against all 15 visible tests; `migrateV1ToV2` has a
  production call site in `CanvasPersistence.coldOpen()` that fires on BOTH branches (seed → migrate;
  doc-wins → migrate → flush) and never stamps `meta` on a record-less doc; `PROTECTED_KEYS` exported
  unchanged; `tsc` clean.
- **What remains open:** 30 full-suite failures, classified by measurement as **29 class A** (legacy
  fixtures WP14 rules invalid: no type-specific payload, no `type`, no `width`/`height`, and edges
  whose file record omits `fromSide`/`toSide`), **0 class B**, and **1 `SPEC_CONTRADICTION`** — §7 TC7
  requires the doc-wins branch to migrate an unstamped V1 doc, while
  `canvas-persistence.test.ts > "non-empty doc + stale file → doc wins…"` asserts that branch opens
  zero transactions. Both need a Worker 3 phasing ruling.
- **Final status:** PARTIALLY_DONE — see `ImplementationReport_WP18.md`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
