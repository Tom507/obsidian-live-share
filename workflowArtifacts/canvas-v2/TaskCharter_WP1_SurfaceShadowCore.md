# Task Charter — WP1: Surface-Shadow core

**Charter Status:** `DONE`
**WP:** WP1
**Phase:** P0
**task_mode:** `standard`
**Depends on:** `none`
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a headless module whose entire state can be constructed, advanced and read without any Obsidian or filesystem access.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C1 — Surface-Shadow core** (work package WP1); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (`plugin/src/canvas/canvas-shadow.ts`, new headless module)
  - Responsibility: hold, per subscribed canvas, the last version of each field that provably reached the surface Obsidian's save comes from.
  - Scope summary: new headless field-granular shadow module
- **Out of scope / non-goals:**
  - Any change to the capture path, the reconcile path or `main.ts` — this WP creates the module only.
  - Persisting the shadow to disk; the shadow is in-memory state rebuilt from the surfaces.
  - V2 register granularity (`pos`/`size`/`from`/`to`) — that is WP15.
- **Known interfaces / dependencies:**
  - Input: field-granular record updates from three sources (confirmed view apply, captured local edit, persistence write when the view is closed)
  - Output: a readable field-granular snapshot plus per-record presence information
  - Depends on work packages: `none`

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Surface-Shadow core
- **Interfaces involved:**
  - Input: field-granular record updates from three sources (confirmed view apply, captured local edit, persistence write when the view is closed)
  - Output: a readable field-granular snapshot plus per-record presence information
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
  - **Schema impact:** No `meta.schemaVersion` change and no `.canvas` file-format change. P0 is a pure logic change in the capture and serialisation paths, which is exactly why it ships first (CONCEPT_V2 Teil 13). Mixed-version behaviour: a P0 client and a pre-P0 client interoperate unchanged at the doc level.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/canvas/canvas-shadow.ts` (new)
  - `plugin/src/canvas/reconcile-plan.ts:163–185` — the precedent for a zero-import pure module
  - `plugin/src/main.ts:114` — `canvasApplied`, the record-granular shadow this module replaces (read for shape only; do not edit here)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C1. No paraphrasing.*

1. The module exports a shadow structure keyed by canonical path, then record kind (`node`/`edge`), then record id, then field name, and it has **no** import of Obsidian, no clock, no DOM and no file I/O.
2. Advancing a single field leaves every other field of the same record untouched, and advancing a field of one record leaves other records untouched.
3. The shadow distinguishes three states for a record: present with known fields, known-absent (it was handed to the surface and is not there), and unknown (never observed on this surface) — and a caller can read which state applies.
4. Clearing a path removes all of its shadow state and leaves other paths intact.

**Definition of Done:** a headless module whose entire state can be constructed, advanced and read without any Obsidian or filesystem access.

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
  - `plugin/src/canvas/canvas-shadow.ts` (new)
- **Required report:** `ImplementationReport_WP1.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

All six test cases are pure data tests: no Obsidian, no adapter, no clock, no wall-clock
sleep, no timing constant. They run from `plugin/` via `npm test` (Vitest 4.0.18).

### TC1 — Shadow structure and key hierarchy

- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp1/test_tp01_structure_keying_visible.test.ts`
- What it checks: the exported structure nests exactly `path → kind → id → field`, `node`
  and `edge` are separate id spaces under one path, every reader agrees with a hand-written
  walk of the raw structure, and `getRecordFields` hands back a detached snapshot.
- Test data channel: fixture

### TC2 — Headlessness (no Obsidian, no clock, no DOM, no file I/O)

- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp1/test_tp02_headless_purity_visible.test.ts`
- What it checks: the module source declares no non-relative import and contains no
  Obsidian symbol, no `fs` call, no clock/entropy call and no DOM or host global; plus, at
  runtime, that two shadows are fully independent (no module-level state).
- Test data channel: fixture (the module source itself, read with `node:fs` in the test —
  the runner environment is node, so a runtime probe for `document`/`window` would pass
  vacuously; source scanning is the repo's established oracle, see
  `canvas-single-writer.test.ts` AC8)

### TC3 — Per-field advance leaves the rest of the record untouched

- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp1/test_tp03_field_isolation_visible.test.ts`
- What it checks: advancing one field of a seven-field node changes exactly that field,
  adding a new field keeps the rest, re-advancing the same value is a no-op, and a partial
  multi-field advance upserts only the fields it mentions and deletes none (I7).
- Test data channel: fixture

### TC4 — Record and path isolation

- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp1/test_tp04_record_isolation_visible.test.ts`
- What it checks: advancing one record leaves sibling records, the edges and every other
  path byte-identical, and the same record id on two paths stays two independent records.
- Test data channel: fixture

### TC5 — present / known-absent / unknown are three readable states

- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp1/test_tp05_record_states_visible.test.ts`
- What it checks: a never-observed record reads `unknown`, an observed one `present`, a
  record handed to the surface and found missing reads `absent` (not `unknown`) with its
  fields dropped, all three coexist in one path, and re-observing an absent record makes it
  `present` again with only the newly observed fields.
- Test data channel: fixture

### TC6 — Clearing a path

- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp1/test_tp06_clear_path_visible.test.ts`
- What it checks: clearing removes every record of that path in both kinds and both states
  (the path key itself disappears), every other path stays byte-identical, clearing an
  unknown path is a no-op, and a cleared path can be repopulated from scratch.
- Test data channel: fixture

### Required module API (defined by the visible tests)

`plugin/src/canvas/canvas-shadow.ts` — implement exactly this surface. Every symbol below is
exported. The module must import nothing but relative modules (ideally nothing at all, like
`reconcile-plan.ts`). Path strings are treated as **opaque, already-canonical** keys: the
module must never canonicalise, normalise or lower-case them (canonicalisation happens at
the subsystem boundary, per BUILD_SPEC §4.4).

**Types**

```ts
/** The two record kinds of a `.canvas` file. */
export type ShadowRecordKind = "node" | "edge";

/** The value types a `.canvas` field can carry on the surface. */
export type ShadowFieldValue = string | number | boolean | null;

/** What the shadow knows about one record on one surface. */
export type ShadowRecordState = "present" | "absent" | "unknown";

/** One record's shadow. `absent` records carry an empty `fields` map. */
export interface ShadowRecord {
  state: "present" | "absent";
  fields: Map<string, ShadowFieldValue>;
}

/** Level 2 of the hierarchy: the two id spaces of one surface. */
export type ShadowPathState = { [K in ShadowRecordKind]: Map<string, ShadowRecord> };

/** Level 1: the whole shadow, keyed by canonical path. */
export interface SurfaceShadow {
  paths: Map<string, ShadowPathState>;
}
```

The four-level nesting `shadow.paths.get(path)[kind].get(id).fields.get(field)` is part of
the contract (AC1) and is asserted directly. Every level is a `Map` (never a plain object —
ids and field names such as `constructor` or `__proto__` must behave like ordinary keys).

**Functions** (all synchronous, all total, none throwing on unknown keys)

| Signature | Semantics |
|---|---|
| `createSurfaceShadow(): SurfaceShadow` | A fresh, empty shadow. No module-level state — two calls return fully independent values. |
| `advanceField(shadow, path, kind, id, field, value): void` | Upsert exactly one field. Creates the path, the record and the field if needed; marks the record `present`; touches no other field, record or path. `value` may be `null` (a known value, distinct from "not observed"). |
| `advanceRecord(shadow, path, kind, id, fields): void` | Upsert every entry of `fields` (`Readonly<Record<string, ShadowFieldValue>>`). Marks the record `present`. **Never removes a field absent from `fields`** (I7). An empty `fields` object changes no value but still marks the record `present`. |
| `markRecordAbsent(shadow, path, kind, id): void` | Record the knowledge "handed to this surface, not there": state becomes `absent` and the field map is emptied. Legal for a never-observed record (the result is `absent`, not `unknown`) and idempotent. Affects no other record. |
| `getRecordState(shadow, path, kind, id): ShadowRecordState` | `"present"`, `"absent"`, or `"unknown"` when the path, the kind entry or the id was never observed. The **only** discriminator between `absent` and `unknown`. |
| `getField(shadow, path, kind, id, field): ShadowFieldValue \| undefined` | The last observed value, or `undefined` when the field was never observed or the record is not `present`. `undefined` means "unknown", `null` means "observed as null". |
| `getRecordFields(shadow, path, kind, id): Record<string, ShadowFieldValue> \| null` | A **detached copy** of the record's fields (mutating the result must not affect the shadow), `{}` for a present record with no fields, `null` for `absent` **and** for `unknown`. |
| `clearPath(shadow, path): void` | Delete the whole path entry — both kinds, present and absent records alike — by **exact key** (never by prefix, never case-insensitively). Leaves every other path untouched, leaves no empty container behind, and is a no-op for an unknown path. |
| `listPaths(shadow): string[]` | The path keys currently held, as a plain array (order is not asserted; tests sort). |

Parameter order is fixed everywhere: `(shadow, path, kind, id, [field], [value])`.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

None. All four acceptance criteria are fully covered by unit tests — the component is a pure
headless module with no runtime environment, external API or cross-component dependency.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `plugin/src/canvas/canvas-shadow.ts` did not exist; all six
  visible test files under `plugin/src/__tests__/v2/wp1/` imported it and therefore could not
  resolve. The only shadow in the codebase was the record-granular `canvasApplied` map in
  `main.ts:114` (read for shape only, not edited).
- **Approach:** implement the section-7 "Required module API" literally — nested `Map`s at
  every level (`paths → {node,edge} → id → fields`), `ShadowRecord.state` limited to
  `present`/`absent`, and `unknown` expressed as the *absence* of a record so
  `getRecordState` is the sole discriminator. Two private helpers (`ensurePathState`,
  `ensurePresentRecord`) carry all creation, so `advanceField`/`advanceRecord`/
  `markRecordAbsent` share one lifecycle rule; readers use one `findRecord` lookup and never
  create anything. Zero imports, mirroring `reconcile-plan.ts`.
- **Fallback path if all attempts fail:** not needed — attempt 1 passed all visible tests.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four acceptance criteria. `plugin/src/canvas/canvas-shadow.ts`
  exists with the full section-7 API surface (9 functions, 6 exported types), imports nothing,
  and passes all 6 visible test files / 32 assertions plus `tsc -noEmit`.
- **What remains open:** nothing in WP1 scope. The module has no caller yet — wiring it into
  the capture/apply/persistence paths is WP2/WP4/WP5, and V2 register granularity is WP15.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
