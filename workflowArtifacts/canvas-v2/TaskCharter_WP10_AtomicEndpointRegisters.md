# Task Charter — WP10: Atomic `from`/`to` registers

**Charter Status:** `DONE`
**WP:** WP10
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP8
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the "arrow points at a side where nothing hangs" class is unrepresentable.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C10 — Atomic `from` / `to` endpoint registers** (work package WP10); phase **P1**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (pure register module) + modify (record shape types)
  - Responsibility: make an edge endpoint one value, so concurrent re-routing cannot produce a geometrically impossible edge.
  - Scope summary: composite LWW endpoints
- **Out of scope / non-goals:**
  - The dangling-edge prune and cascade behaviour — that is WP19.
  - Serializer expansion — WP17.
  - The lock seam's edge endpoint double-check — that is removed in WP21.
- **Known interfaces / dependencies:**
  - Input: 
  - Output: 
  - Depends on work packages: WP8
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 `reroute` op + the schema invariant "no endpoint-less edge".

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Atomic `from` / `to` endpoint registers
- **Interfaces involved:**
  - Input: 
  - Output: 
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
  - `plugin/src/files/canvas-sync.ts:53–62` — `PROTECTED_KEYS`, which currently carries the endpoint keys
  - `plugin/src/files/canvas-sync.ts:723–739` — `pruneEdgesForDeletedNodes` (read for the endpoint contract)
  - CONCEPT_V2 Teil 4, the `from`/`to` rows
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C10. No paraphrasing.*

1. `from` and `to` each round-trip losslessly to and from the `.canvas` file representation, including the optional `end` component.
2. Two concurrent re-routes of the same endpoint converge to exactly one submitted endpoint on every replica — never one author's `node` with another's `side`.
3. Concurrent re-routing of `from` on one replica and `to` on another leaves both changes intact.
4. An endpoint register is either wholly present or wholly absent; a partially populated endpoint cannot be constructed through the module's API.
5. **A side-less endpoint is a first-class, representable endpoint.** `side` and `end` are optional components of the single register value (§4.3); `node` alone decides the register's presence. Specifically: an endpoint may be constructed from a `node` with no `side`; a register carrying a `node` and no `side` reads back as **present**, not absent; and it round-trips to the file as `fromNode`/`toNode` with the `fromSide`/`toSide` key **absent** — never `null`, never `""`. A register with no `node` is not a register.

**Definition of Done:** the "arrow points at a side where nothing hangs" class is unrepresentable, **and every edge legal under the JSON Canvas format is representable.**

---

<!-- Updated: E1 ruling — WP10 REOPENED; the endpoint model could not represent a legal side-less JSON Canvas edge 2026-08-02 -->

### Amendment (2026-08-02, Worker 2 — E1 ruling). WP10 is REOPENED. AC5 is new; AC1–AC4 are unchanged.

**Why.** `fromSide`/`toSide` are **optional** in the JSON Canvas format. The landed implementation requires a whole `{node, side}` pair — `encodeEndpoint` throws on an empty `side`, `encodeEndpointFromFile` returns `undefined` unless both are non-empty, and `isEndpointRegister` reads a side-less value back as **absent**. A fully-connected, perfectly legal side-less edge therefore has no representable V2 endpoint; WP14 reports `MISSING_FROM`, WP18 refuses it, and `CanvasPersistence.flush()` then writes the doc back over the file — **deleting the user's edge from their own `.canvas` file.** This is silent, permanent data loss on a document the user did not create with this plugin. `migrateV1ToV2` cannot rescue it either, because `migrateEndpoint` calls the same encoder.

**Reading of AC4 (this is the part that was implemented wrongly).** AC4 was read as *"all components must be present"*. It is a rule about **write granularity**, not about component obligation: the register is written and replaced as **one value**, so no author's `node` can ever combine with another author's `side` — Teil 4's chimera, W2. "Wholly present or wholly absent" refers to the **register**, whose presence is decided by `node`. AC4 and AC5 are both binding and consistent: the module must offer **no** API that mutates one component of an existing register in place, **and** must accept a `node` with no `side` as a complete construction.

**The atomicity must not be weakened to achieve this.** `{node, side?, end?}` stays **one** LWW register holding **one** value. Splitting the pair back into separate keys would reintroduce W2 and torn writes and is forbidden. Optionality is a property of the value's shape, never of the write granularity.

**Two absences must stay distinguishable:** a register that is *absent* (no endpoint — the edge is dangling, `Edge valid` fails) versus a register that is *present with no side* (attached to a node, side unspecified — legal and valid). Reading the second as the first is the whole defect.

**Concretely, the three predicates that must change:**
- construction must accept a missing/`undefined` `side` and still produce a complete register — while still refusing a missing or empty `node`;
- the file reader must build the register whenever the `*Node` key is present, taking `*Side`/`*End` only when present;
- the register predicate must decide presence on `node` alone, treating `side`/`end` as optional-when-present.

Empty (`""`), `null` and `undefined` all count as **absent** for `side`/`end`. Any other string is carried through **verbatim and opaquely** — WP10 does not validate side vocabulary and must not start; an unrecognised value is preserved, not normalised, so no forward-compatible file loses information.

**Consumer note:** WP14 and WP17 have matching amendments (WP14 pins the side-less edge as valid directly; WP17 pins key omission and the byte-identical file round-trip). Landing AC5 without those is incomplete.

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
  - a new register module under `plugin/src/canvas/`
  - `plugin/src/files/canvas-sync.ts` (type shapes only)
- **Required report:** `ImplementationReport_WP10.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

### TC1 — lossless from/to round trip, including optional end
- Verifies AC: 1
- Test file: `plugin/src/__tests__/v2/wp10/test_tp01_lossless_endpoint_roundtrip_visible.test.ts`
- What it checks: the pure encode/decode codec and a real `Y.Map` write/read cycle both reproduce the original `node`, `side` and optional `end` exactly for a table of representative cases (end present, end omitted), for both the `from` and `to` directions independently.
- Test data channel: fixture

### TC2 — two concurrent re-routes converge to one submitted endpoint, never a mixture
- Verifies AC: 2
- Test file: `plugin/src/__tests__/v2/wp10/test_tp02_concurrent_reroute_convergence_visible.test.ts`
- What it checks: with three replicas and two concurrent `writeTo` authors, after a full-mesh merge every replica agrees, the agreed value is exactly one author's whole submitted `{node, side, end}`, and none of the torn combinations across the three fields appear — no hardcoded winner is asserted.
- Test data channel: fixture

### TC3 — concurrent from-reroute and to-reroute of the same edge survive independently
- Verifies AC: 3
- Test file: `plugin/src/__tests__/v2/wp10/test_tp03_from_to_independence_visible.test.ts`
- What it checks: with three replicas, a sole `from` author and a sole `to` author writing concurrently both land on every replica after a full-mesh merge — `from` and `to` are resolved as disjoint registers, so both concrete values are asserted directly (single-author registers, not a same-key race).
- Test data channel: fixture

### TC4 — an endpoint register is wholly present or wholly absent
- Verifies AC: 4
- Test file: `plugin/src/__tests__/v2/wp10/test_tp04_wholly_present_or_absent_visible.test.ts`
- What it checks: the constructor (`encodeEndpoint`) throws at runtime when called with a missing/empty `node` or `side` even past a TypeScript bypass; the read boundary (`isEndpointRegister` / `asEndpointRegister`) treats a value holding only `node` or only `side`, or a wrong-typed field, as absent rather than partial; and the module exports no per-component setter (`writeFromNode`, etc.) that would let a caller build one field of an endpoint at a time.
- Test data channel: fixture

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
