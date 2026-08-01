# Task Charter — WP3: Canonical form core

**Charter Status:** `DONE`
**WP:** WP3
**Phase:** P0
**task_mode:** `standard`
**Depends on:** `none`
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the same doc state, serialised on two different clients, produces identical bytes.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C3 — Canonical form core** (work package WP3); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/files/canvas-sync.ts` — `buildCanvasData` `:98–130`, `serializeCanvas` `:132–137`) + create (canonicalisation helpers)
  - Responsibility: produce byte-identical output on every client from the same doc state, and round geometry on the capture side so rounding can never read as intent.
  - Scope summary: canonical serialisation + capture-side rounding
- **Out of scope / non-goals:**
  - `(ord, id)` sorting and register expansion — that is WP17 (`ord` does not exist until P1).
  - Changing the tab indentation or the overall file shape Obsidian expects.
  - Any change to `parseCanvas` — that is WP16.
- **Known interfaces / dependencies:**
  - Input: node/edge record collections
  - Output: a canonical JSON string (tab-indented, as today) and a canonical-rounding helper usable by the capture path
  - Depends on work packages: `none`
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "identical canonical serialisation (byte equality)" assertion.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Canonical form core
- **Interfaces involved:**
  - Input: node/edge record collections
  - Output: a canonical JSON string (tab-indented, as today) and a canonical-rounding helper usable by the capture path
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
  - **Schema impact:** none. The `.canvas` file format is unchanged; only the byte-level determinism of our own output improves.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/files/canvas-sync.ts:98–130` — `buildCanvasData`
  - `plugin/src/files/canvas-sync.ts:132–137` — `serializeCanvas`
  - `plugin/src/files/canvas-persistence.ts:388` — the re-export, and `:229` — the only disk-writing call site
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C3. No paraphrasing.*

1. Two independently ordered inputs describing the same records serialise to **byte-identical** strings.
2. Object keys are emitted in the Obsidian-canonical order and numbers in Obsidian's format (integers without decimal places); no field gains or loses a value through canonicalisation.
3. The capture-side rounding helper maps geometry to whole pixels and is idempotent (rounding a rounded value changes nothing).
4. Record order is deterministic in P0 without requiring `ord` (which does not exist until P1), and the existing tab indentation and overall file shape are unchanged.

**Definition of Done:** the same doc state, serialised on two different clients, produces identical bytes.

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
- **Required report:** `ImplementationReport_WP3.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

All tests live under `plugin/src/__tests__/v2/wp3/` and run with the rest of the suite
(`npm test` from `plugin/`). They are pure-data tests except TC9, which drives the real
`canvas-sync.ts` seam through in-memory `Y.Doc`s. No wall-clock sleeps, no timing
constants, no `Math.random`, no log-string oracles.

### TC1 — Byte identity across two independently ordered inputs

- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp3/test_order_independent_bytes_visible.test.ts`
- What it checks: the same three nodes and two edges, supplied in a different array order **and** a different per-record key insertion order, serialise to the identical string, with nothing lost and the caller's arrays unmutated.
- Test data channel: fixture

### TC2 — Obsidian-canonical key order

- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp3/test_key_order_visible.test.ts`
- What it checks: node and edge keys come out in `CANONICAL_NODE_KEY_ORDER` / `CANONICAL_EDGE_KEY_ORDER` whatever the input order, emitted keys are always a subsequence of that order, and unknown keys are appended in UTF-16 code-unit order.
- Test data channel: fixture

### TC3 — No field gains or loses a value

- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp3/test_value_preservation_visible.test.ts`
- What it checks: canonicalisation is a reordering only — the exact key set survives, values are passed through by identity (including `0`, `false`, `""`, `null` and unknown/future fields), only `undefined` is dropped, and the input record is never mutated.
- Test data channel: fixture

### TC4 — Obsidian number format

- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp3/test_number_format_visible.test.ts`
- What it checks: integral values are written without a decimal tail, `-0` is emitted as `0`, large values never switch to exponent notation, and the writer does **not** round — a genuinely fractional doc value reaches disk unchanged (rounding is capture-side only).
- Test data channel: fixture

### TC5 — Capture-side geometry rounding to whole pixels

- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp3/test_geometry_rounding_visible.test.ts`
- What it checks: `x`/`y`/`width`/`height` become whole pixels (never `-0`), every other key — including non-numeric or absent geometry — is untouched, key order is preserved and the caller's record is not mutated.
- Test data channel: fixture

### TC6 — Rounding is idempotent

- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp3/test_rounding_idempotent_visible.test.ts`
- What it checks: rounding a rounded record changes nothing, over 240 samples from a seeded LCG plus the `±.5` tie boundaries, with every result an integer and never `-0`.
- Test data channel: deterministic generator (seeded LCG, fixed seed)

### TC7 — Deterministic record order without `ord`

- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp3/test_record_order_no_ord_visible.test.ts`
- What it checks: nodes and edges are ordered by `id` using UTF-16 code-unit comparison (explicitly *not* `localeCompare`, which is host/locale dependent), the order is identical for every input permutation, duplicate ids stay stable, and no `ord` field is required or emitted.
- Test data channel: fixture

### TC8 — Tab indentation and file shape unchanged

- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp3/test_file_shape_tabs_visible.test.ts`
- What it checks: the emitted document matches a byte-exact expected string (tab-indented, `nodes` before `edges`, no trailing newline, no CRLF, no space indentation), is re-stringify stable, and round-trips through the unchanged `parseCanvas`.
- Test data channel: fixture

### TC9 — Two clients, one doc state, identical bytes (Definition of Done)

- Verifies AC: 1, 4
- Test file: `plugin/src/__tests__/v2/wp3/test_two_client_bytes_visible.test.ts`
- What it checks: the canonical form is actually wired into the `buildCanvasData` / `serializeCanvas` seam — two `Y.Doc`s holding the same state with different Y.Map iteration and key insertion orders serialise identically, `buildCanvasData` returns canonical id-sorted records, `serializeCanvas` equals `serializeCanonicalCanvas(buildCanvasData(...))`, and the existing dangling-edge prune still happens.
- Test data channel: fixture (deterministically constructed in-memory `Y.Doc`s)

### TC10 — Geometry key drift guard and pure-core contract

- Verifies AC: 3 (hard constraints: `GEOMETRY_KEYS` membership/export, pure core)
- Test file: `plugin/src/__tests__/v2/wp3/test_geometry_keys_drift_visible.test.ts`
- What it checks: `CANONICAL_GEOMETRY_KEYS` mirrors the exported `GEOMETRY_KEYS` exactly (still `{x, y, width, height}`), the canonical key order carries all four, and the module's source contains no import at all — no Obsidian, no filesystem, no clock.
- Test data channel: fixture (plus a read of the module's own source text as the purity oracle)

---

### Required module API (defined by the visible tests)

**File the coder must create:** `plugin/src/canvas/canvas-canonical.ts`
(new headless pure module; the precedent is `plugin/src/canvas/reconcile-plan.ts`, which has
zero imports. **This module must have zero imports** — it therefore keeps its own private
mirror of the geometry key set, exactly like `RECONCILE_GEOMETRY_KEYS`, guarded by TC10.)

**File the coder must modify:** `plugin/src/files/canvas-sync.ts` — `buildCanvasData` (`:98–130`)
and `serializeCanvas` (`:132–137`) only. `GEOMETRY_KEYS` keeps its exact membership and export.

#### Types

```ts
export type CanvasRecord = Record<string, unknown>;
export type CanvasRecordKind = "node" | "edge";

export interface CanvasRecordSets {
  nodes: readonly CanvasRecord[];
  edges: readonly CanvasRecord[];
}

export interface CanonicalCanvasData {
  nodes: CanvasRecord[];
  edges: CanvasRecord[];
}
```

#### Constants

```ts
export const CANONICAL_NODE_KEY_ORDER: readonly string[];
export const CANONICAL_EDGE_KEY_ORDER: readonly string[];
export const CANONICAL_GEOMETRY_KEYS: ReadonlySet<string>;
```

- `CANONICAL_NODE_KEY_ORDER` is exactly, in this order:
  `["id", "type", "x", "y", "width", "height", "color", "file", "subpath", "url", "text", "label", "background", "backgroundStyle"]`
- `CANONICAL_EDGE_KEY_ORDER` is exactly, in this order:
  `["id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd", "color", "label"]`
- `CANONICAL_GEOMETRY_KEYS` is exactly `{"x", "y", "width", "height"}` — the private mirror of
  `GEOMETRY_KEYS` (BUILD_SPEC §3.1 S2). Neither order array may contain a P1 field
  (`ord`, `pos`, `size`, `from`, `to`, `schemaVersion`).

#### `canonicalizeRecord(record: CanvasRecord, kind: CanvasRecordKind): CanvasRecord`

- Returns a **new** plain object; the input is never mutated.
- Emits the keys of the matching canonical order that the record owns, in that order, then
  every remaining ("unknown") own key sorted by **UTF-16 code unit** (`a < b` comparison —
  **never `localeCompare`**, whose result depends on host ICU data and locale).
- A key whose value is `undefined` is omitted (JSON has no such value). Every other key —
  including `null`, `0`, `false`, `""`, objects and arrays — is emitted with its value passed
  through by identity. No key is ever added, removed, coerced or rounded.
- `kind` selects the schema: the same record canonicalised as `"edge"` moves `type` to the
  unknown tail, and as `"node"` moves `fromNode`/`toNode` there.

#### `roundCanvasGeometry(record: CanvasRecord): CanvasRecord`

The **capture-side** helper (BUILD_SPEC §4.4: geometry is rounded *before* the register write).

- Returns a **new** object preserving the input's own key order; the input is never mutated.
- For each key in `CANONICAL_GEOMETRY_KEYS` whose value is a **finite number**: the value
  becomes `Math.round(value)`, with `-0` normalised to `0`.
- Every other key, and any geometry value that is not a finite number (string, `null`,
  `NaN`, `Infinity`, boolean), is copied through untouched. Absent keys stay absent.
- Idempotent: `roundCanvasGeometry(roundCanvasGeometry(r))` deep-equals `roundCanvasGeometry(r)`.
- Key-name matching is exact — `xx`, `x2`, `X`, `heights`, `maxWidth` are not geometry.

#### `canonicalizeCanvasData(data: CanvasRecordSets): CanonicalCanvasData`

- Returns new arrays of new records; the caller's arrays and records are never mutated.
- Each node is `canonicalizeRecord(record, "node")`, each edge `canonicalizeRecord(record, "edge")`.
- Both arrays are sorted ascending by the record's id, compared by **UTF-16 code unit**. The
  sort key is `String(record.id ?? "")`, so a record without an id sorts first. The sort is
  **stable**, so records with equal ids keep their input order.
- Does **not** round geometry (that is capture-side, AC3) and does not prune or de-duplicate.

#### `serializeCanonicalCanvas(data: CanvasRecordSets): string`

- Returns `JSON.stringify(canonicalizeCanvasData(data), null, "\t")` — i.e. exactly the
  tab-indented shape `serializeCanvas` produces today: one top-level object with `nodes`
  before `edges`, `\n` line endings, **no** trailing newline, no BOM.

#### Changes to the existing seam (`plugin/src/files/canvas-sync.ts`)

- `buildCanvasData(nodesMap, edgesMap)` keeps its signature and its dangling-edge prune, and
  additionally returns the **canonical** form: records canonicalised by kind and both arrays
  id-sorted (i.e. its existing result passed through `canonicalizeCanvasData`).
- `serializeCanvas(nodesMap, edgesMap)` must satisfy
  `serializeCanvas(n, e) === serializeCanonicalCanvas(buildCanvasData(n, e))`.
- Note for the coder: `buildCanvasData` output is consumed by the reconcile path and by
  existing tests that index `data.nodes[0]`. Record order becomes id-sorted rather than
  Y.Map-iteration-ordered; any existing test that assumed insertion order must be updated
  (not the production behaviour).

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*None — all four acceptance criteria are covered by unit tests in section 7. No AC of this
work package requires a running system, an external API or multiple components.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `buildCanvasData` walked the two `Y.Map`s in raw iteration order and copied each record's keys in raw insertion order; `serializeCanvas` was a bare `JSON.stringify(..., null, "\t")` over that. Both orders are a function of the local integration history, so two peers holding identical state emitted different bytes — byte equality could not be used as the echo breaker.
- **Approach:** created the zero-import pure module `plugin/src/canvas/canvas-canonical.ts` (canonical key orders, private `CANONICAL_GEOMETRY_KEYS` mirror, `canonicalizeRecord`, `roundCanvasGeometry`, `canonicalizeCanvasData`, `serializeCanonicalCanvas`) and routed the two existing seam functions through it: `buildCanvasData` returns `canonicalizeCanvasData({nodes, edges})` after its unchanged dangling-edge prune, `serializeCanvas` returns `serializeCanonicalCanvas(buildCanvasData(...))`. Ordering is by `String(record.id ?? "")` under UTF-16 code-unit comparison (never `localeCompare`) with an index tiebreaker for explicit stability. No number-formatting code was needed: `JSON.stringify` already produces Obsidian's format.
- **Fallback path if all attempts fail:** not needed — all 47 visible tests passed on the first run.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs and the Definition of Done. 47/47 visible tests pass; the 7 required regression suites pass (224/224), as do all 35 non-v2 suites (674/674); `npx tsc -noEmit -skipLibCheck` is clean. `GEOMETRY_KEYS` membership and export unchanged, `parseCanvas` unchanged, `.canvas` format and tab indentation unchanged, zero new dependencies. No existing test needed adjusting.
- **What remains open:** `roundCanvasGeometry` is implemented and tested but has no caller yet — no capture seam exists inside this WP's file scope, so wiring it in belongs to the capture work package. Byte identity also assumes ids are unique: two records sharing an id keep input (Y.Map) order, which WP17's `(ord, id)` sort supersedes.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
