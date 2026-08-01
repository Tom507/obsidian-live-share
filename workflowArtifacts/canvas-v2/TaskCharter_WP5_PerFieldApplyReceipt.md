# Task Charter — WP5: Per-field apply receipt

**Charter Status:** `DONE`
**WP:** WP5
**Phase:** P0
**task_mode:** `standard`
**Depends on:** WP1, WP2
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** reconcile classification and capture basis are provably one structure with no drift between them.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C5 — Per-field apply receipt in the reconcile path** (work package WP5); phase **P0**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/main.ts`: `canvasApplied` `:114`, `reconcileLiveCanvas` `:1046–1175`, apply-ok writes `:1110`, `:1146`, deletes `:1029`, `:1425`)
  - Responsibility: turn `canvasApplied` from a record snapshot into the field-granular shadow, and advance it per field only on a confirmed apply.
  - Scope summary: `canvasApplied` → field shadow; per-field advance
- **Out of scope / non-goals:**
  - Any canvas decision logic inside `main.ts` — wiring only.
  - Changing `planReconcile`'s classification algorithm; only the shadow it classifies against changes.
  - The editing-aware `isBusy()` extension — that is WP37.
- **Known interfaces / dependencies:**
  - Input: the reconcile plan result and the adapter's apply outcome
  - Output: shadow advances scoped to exactly the fields that were confirmed applied
  - Depends on work packages: WP1, WP2

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Per-field apply receipt in the reconcile path
- **Interfaces involved:**
  - Input: the reconcile plan result and the adapter's apply outcome
  - Output: shadow advances scoped to exactly the fields that were confirmed applied
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
  - `plugin/src/main.ts:114` — `canvasApplied`
  - `plugin/src/main.ts:1046–1175` — `reconcileLiveCanvas` (adapter gate `:1053`, busy gate `:1054–1059`, plan call `:1071–1077`, noop early-out `:1080`)
  - `plugin/src/main.ts:1110` / `:1146` — the two apply-ok shadow writes; `:1029` / `:1425` — the deletes
  - `plugin/src/canvas/reconcile-plan.ts:33–55` — `ReconcilePlanInput`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C5. No paraphrasing.*

1. `canvasApplied` is replaced by the shadow from C1 as the single structure serving both reconcile classification and capture basis; there is no second, parallel shadow.
2. An `"interacting"` skip leaves exactly the fields of the affected record un-advanced and advances every other record's confirmed fields.
3. A failed or partial apply advances no field of the affected record.
4. `main.ts` gains wiring only — construction, injection and forwarding. No canvas decision logic is added to this file.

**Definition of Done:** reconcile classification and capture basis are provably one structure with no drift between them.

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
  - `plugin/src/main.ts`
  - `plugin/src/canvas/canvas-shadow.ts`
  - `plugin/src/canvas/reconcile-plan.ts` (only if its input shape must follow)
- **Required report:** `ImplementationReport_WP5.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Seven suites (34 cases) at the integration-with-injected-seams level required for a
wiring WP. They drive the REAL `CanvasSync` over a doubled vault plus real `Y.Doc`
replicas, and the REAL `createCanvasAdapter` over the existing `CanvasDouble` +
`InteractionDriver` harness — so every `"applied"` / `"unchanged"` /
`"interacting"` / `"missing"` / `"unsupported"` outcome the receipt is fed is
produced by the same code production feeds it, never hand-written.

`main.ts` itself is never imported or executed (it has no test file and must not
get one, BUILD_SPEC §3.1 S11). AC4 is tested by expressing the whole reconcile pass
as a fixed wiring sequence over the module API and proving it produces the right
state in four scenarios — plus a narrow source scan of `main.ts`, the repo's
established pattern for file-level claims (`canvas-single-writer.test.ts`,
`v2/wp1/test_tp02_headless_purity_visible.test.ts`).

No wall-clock sleep, no `setTimeout` wait and no timing constant appears anywhere.
The one real timer in the path (the settle window `noteExternalDiskWrite` opens) is
flushed with `vi.useFakeTimers()` + `vi.runOnlyPendingTimersAsync()`, which names no
duration. The watchdog-released drag state is reproduced with an adapter decorator
rather than by moving a clock.

Run from `plugin/`: `npx vitest run src/__tests__/v2/wp5v2` (or the full `npm test`).

**Note the directory: `src/__tests__/v2/wp5v2`.** `src/__tests__/wp5/` is a legacy
latency suite from an earlier initiative — do not touch it, do not merge into it.

### TC1 — One shadow serves reconcile classification and capture basis

- Verifies AC: 1
- Test file: plugin/src/__tests__/v2/wp5v2/test_tp01_single_shadow_visible.test.ts
- What it checks: a confirmed reconcile apply advances the very instance
  `CanvasSync.getSurfaceShadow()` returns, so the capture path immediately discards
  those values as staleness (different key order → different bytes, so the byte echo
  breaker cannot be what silences it) while treating the value the view no longer
  shows as real intent; the reverse direction holds too (a captured local edit is
  visible to the classifier through the projection); and `setSurfaceShadow(...)`
  re-points BOTH roles at once, proving there is no second, cached structure.
- Test data channel: fixture

### TC2 — `shadowToCanvasRecords` is the classifier's `lastApplied`

- Verifies AC: 1
- Test file: plugin/src/__tests__/v2/wp5v2/test_tp02_shadow_projection_visible.test.ts
- What it checks: the projection of a confirmed apply yields exactly the three
  `planReconcile` verdicts (`noop` / `geometry` / `structural`), an unknown path
  projects to `null` (→ the safe `structural` branch) while a path holding only
  `absent` records projects to empty arrays, `absent` records are excluded so a
  removal cannot make every future pass structural forever, the projection is
  DETACHED, and the record key is the authoritative `id` even against hostile field
  names (`__proto__`, `constructor`, a field literally called `id`).
- Test data channel: fixture

### TC3 — An `"interacting"` skip is scoped to its own record

- Verifies AC: 2
- Test file: plugin/src/__tests__/v2/wp5v2/test_tp03_interacting_skip_visible.test.ts
- What it checks: with the outcome produced by the real adapter under a real drag
  bracket, EXACTLY the held record's fields stay at their pre-pass shadow values
  while every other record's confirmed fields advance — geometry and non-geometry
  alike — the held record is absent from the hand-over set, the skip erases no
  knowledge the record already had (I7), and the next pass after the drag ends
  advances it normally, so a skip is a deferral and not a permanent hole.
- Test data channel: fixture

### TC4 — A failed or partial apply advances no field of the affected record

- Verifies AC: 3
- Test file: plugin/src/__tests__/v2/wp5v2/test_tp04_failed_apply_visible.test.ts
- What it checks: a structural reload that did not land advances nothing at all
  (oracle: a TOTAL dump of the shadow, so a leak into any other field is caught);
  `"missing"` and `"unsupported"` leave their own record un-advanced while the rest
  of the pass advances; a confirmed partial receipt advances only the fields it
  carries and removes none of the others (I7); and a landed reload marks the records
  it no longer carries as `absent`, so the classifier settles instead of reloading
  forever.
- Test data channel: fixture

### TC5 — The reconcile receipt supplies the capture path's surface state

- Verifies AC: 1, 2
- Test file: plugin/src/__tests__/v2/wp5v2/test_tp05_handover_and_close_visible.test.ts
- What it checks: before any confirmed apply nothing is handed over, so an omission
  in a save is ignorance (I7); after one, the same omission IS a deletion; a record
  skipped as `"interacting"` is never handed over, so the card the user is holding
  cannot be deleted by a save it never saw; and closing the view drops the hand-over
  state ONLY — the shared shadow keeps every field, so the first save after a close
  is still intent-free instead of reopening the window V1 opened by dropping its
  record snapshot at `main.ts:1029`.
- Test data channel: fixture

### TC6 — Discrimination: the per-field receipt does the work

- Verifies AC: 2, 3 (BUILD_SPEC §8 discrimination requirement)
- Test file: plugin/src/__tests__/v2/wp5v2/test_tp06_discrimination_seam_visible.test.ts
- What it checks: one scenario, two runs, one difference — with
  `{ perFieldReceipt: false }` a reload that never landed marks its data as applied
  and the stale view then reverts the peer (the Symptom-2 cascade), while the default
  keeps the peer's value; and an interacting skip discards the whole pass instead of
  advancing the other records. The two outcomes are compared directly, and the
  default is asserted to be the ENABLED mode so the seam cannot ship switched off.
- Test data channel: deterministic generator (parameterised scenario function)

### TC7 — `main.ts` gains wiring only

- Verifies AC: 4
- Test file: plugin/src/__tests__/v2/wp5v2/test_tp07_wiring_only_visible.test.ts
- What it checks: the whole reconcile pass, expressed as a fixed sequence over the
  module API with no predicate over shadow content, record fields or apply outcomes
  and a single uniform receipt call site, produces correct state in four scenarios
  (initial mount → settle to noop, geometry pass with a held card, unavailable
  adapter, reload the private API cannot perform) — if any C5 decision still had to
  live in `main.ts`, one of them could not come out right; plus a narrow source scan
  pinning that `canvasApplied` and `cloneCanvasRecords` are gone, that `main.ts`
  constructs no shadow and hand-rolls no advance, and that it obtains the shared one
  and wires the surface-state seam.
- Test data channel: fixture

### Required API and seams (defined by the visible tests)

Everything below is added to **`plugin/src/canvas/canvas-shadow.ts`** — the C1
module, which WP2 already extended with `planIntentDiff`. No new file, no new
dependency, no `.canvas` format change and no doc-schema change. **`reconcile-plan.ts`
is NOT modified:** the projection returns exactly the `CanvasRecords` shape
`planReconcile` already consumes. The module's purity contract is unchanged — the
additions import nothing, read no clock and touch no I/O.

**1. How `main.ts` obtains the ONE shared shadow (AC1)**

`main.ts` never constructs a shadow. At every use site it reads
`this.canvasSync.getSurfaceShadow()` — the seam WP4 already ships (section 7 of
`TaskCharter_WP4_CaptureShadowRebase.md`) — so the instance the capture path
classifies against IS the instance the reconcile receipt advances.
`CanvasSync.setSurfaceShadow(...)` stays the only way to replace it, and both roles
follow that replacement in the same call because neither caches.

| Removed from `main.ts` | Replacement |
|---|---|
| `private canvasApplied = new Map<string, CanvasRecords>()` (`:114`) | nothing — the shadow is the single structure |
| `this.canvasApplied.get(canonical) ?? null` (`:1073`) | `shadowToCanvasRecords(shadow, canonical)` |
| `this.canvasApplied.set(canonical, cloneCanvasRecords(data))` (`:1110`, `:1146`) | `advanceFromReceipt(shadow, buildApplyReceipt({...}))` |
| `this.canvasApplied.delete(path)` (`:1029`) | `this.surfaceState.clearPath(path)` — the hand-over receipt only. **The shared shadow's path is NOT cleared:** it is also the capture basis, and dropping it on canvas close reopens the exact cascade window (the `initial: true` at `:1300` / `:1379` already forces a full reload on remount, which was the original reason for the delete). |
| `this.canvasApplied.clear()` (`:1425`) | `this.surfaceState.clearAll()` |
| the `cloneCanvasRecords` import | — |

**2. The classifier basis**

```ts
export function shadowToCanvasRecords(
  shadow: SurfaceShadow,
  path: string,
): { nodes: Record<string, ShadowFieldValue>[]; edges: Record<string, ShadowFieldValue>[] } | null;
```

| Rule | Semantics |
|---|---|
| unknown path | `null` — `shadow.paths.get(path)` is `undefined`. Feeds `planReconcile`'s existing "nothing applied yet → structural" branch. |
| known path | both arrays always present; a path holding only `absent` records yields `{ nodes: [], edges: [] }` (that is NOT `null`). |
| `absent` records | excluded from the arrays. |
| record shape | a DETACHED copy of the record's fields with `id` taken from the map KEY (the key wins over a field literally named `id`). Written with `defineProperty`, like `getRecordFields`, so a field named `__proto__` stays ordinary data. |
| order | shadow insertion order per kind. `planReconcile` indexes by id, so order is not load-bearing; it must be deterministic. |

**3. The per-field apply receipt**

```ts
export type ApplyOutcome =
  | "applied" | "unchanged"                       // CONFIRMED: the values reached the surface
  | "interacting" | "missing" | "unsupported"     // per-record failure
  | "failed";                                     // whole-pass failure (a reload that did not land)

export interface RecordApplyResult {
  kind: ShadowRecordKind;
  id: string;
  outcome: ApplyOutcome;
  fields: Readonly<Record<string, ShadowFieldValue>>;
}

export interface ApplyReceipt {
  path: string;
  /** true only for a landed structural reload — the one pass that provably
   *  REPLACES the surface's membership. */
  exhaustive: boolean;
  records: readonly RecordApplyResult[];
}

export interface ReconcilePass {
  path: string;
  desired: {
    nodes: ReadonlyArray<Record<string, unknown>>;
    edges: ReadonlyArray<Record<string, unknown>>;
  };
  /** the verdict `planReconcile` returned for this pass */
  plan: "structural" | "geometry";
  /** `adapter.reloadCanvasData(...)` — structural passes and the edge reflow */
  reloaded?: boolean;
  /** `adapter.applyNodeGeometry(...)` per node id — geometry passes */
  nodeOutcomes?: ReadonlyMap<string, ApplyOutcome>;
}

export function buildApplyReceipt(pass: ReconcilePass): ApplyReceipt;
```

`buildApplyReceipt` rules — all mechanical, no shadow access:

- a record of `desired` without a usable string `id` is skipped (same rule as `canvasIds`);
- `fields` is every own key of the desired record, `id` included (matching WP4's
  `toParsedRecords`, so the two sides describe a record identically);
- `plan === "structural"` → every node and edge record gets
  `reloaded === true ? "applied" : "failed"`; `exhaustive = reloaded === true`;
- `plan === "geometry"` → each node gets `nodeOutcomes.get(id) ?? "missing"`
  (**an id with no entry was not confirmed**), each edge gets
  `reloaded === true ? "applied" : "unchanged"` — `planReconcile` only returns
  `"geometry"` when every edge already equals the classifier basis, so `"unchanged"`
  is literally true; `exhaustive = false`;
- **`"interacting"` dominates:** a node the adapter reported as `"interacting"` keeps
  that outcome even when a follow-up edge-reflow reload landed in the same pass. Any
  other unconfirmed node becomes `"applied"` when `reloaded === true`, because
  `setData` really did replace it.

```ts
export interface FieldAdvance {          // structurally identical to FieldUpsertIntent
  path: string; kind: ShadowRecordKind; id: string; field: string; value: ShadowFieldValue;
}

export interface ReceiptSummary {
  advanced: FieldAdvance[];
  unconfirmed: Array<{ kind: ShadowRecordKind; id: string; outcome: ApplyOutcome }>;
  markedAbsent: Array<{ kind: ShadowRecordKind; id: string }>;
  handed: { node: Set<string>; edge: Set<string> };
}

export interface ApplyReceiptOptions {
  /** BUILD_SPEC §8 discrimination seam — see point 6. Defaults to `true`. */
  perFieldReceipt?: boolean;
}

export function advanceFromReceipt(
  shadow: SurfaceShadow,
  receipt: ApplyReceipt,
  opts?: ApplyReceiptOptions,
): ReceiptSummary;
```

`advanceFromReceipt` rules (the enabled, production mode):

1. **Confirmed** (`"applied"` / `"unchanged"`) → `advanceField(...)` for every entry of
   `fields`, and the id joins `handed[kind]`. Fields the receipt does not mention are
   left exactly as they were (I7).
2. **Unconfirmed** (anything else) → NO field of that record is advanced, the record
   is NOT handed over, and its existing shadow knowledge is neither cleared nor
   altered. It appears in `unconfirmed`.
3. **`exhaustive === true`** → every record the shadow holds as `present` for
   `receipt.path` that the receipt does not carry is `markRecordAbsent(...)`ed and
   listed in `markedAbsent`. This is the one pass that proves "handed to the surface
   and it is not there", and it is what stops a removed record from making every
   future classification structural.
4. **A receipt that confirms nothing creates no shadow entry at all** — an unknown
   path stays `unknown`, it does not become an empty path entry.
5. Only `receipt.path` is touched; the two kinds are separate id spaces.

**4. The surface-state store (the other half of AC1)**

WP4 left `setSurfaceStateProvider` at its honest P0 default (`viewOpen: false`,
nothing handed). WP5 owns the real value, and it must come from the SAME confirmed
apply that advances the shadow — otherwise the hand-over receipt and the field
receipt drift apart, which is exactly what the Definition of Done forbids.

```ts
export interface SurfaceStateStore {
  /** REPLACES the previous receipt for that path — it never accumulates. */
  noteHandover(path: string, handed: { node: ReadonlySet<string>; edge: ReadonlySet<string> }): void;
  /** view closed / teardown: drops the hand-over for that path ONLY. */
  clearPath(path: string): void;
  clearAll(): void;
  /** what `CanvasSync` consumes. `handedToView` is empty for an unknown path. */
  stateFor(path: string): SurfaceState;
}

export function createSurfaceStateStore(isViewOpen: (path: string) => boolean): SurfaceStateStore;
```

`stateFor(path)` returns `{ viewOpen: isViewOpen(path), handedToView: <last receipt> }`.
The store never touches the shadow.

**5. `main.ts` wiring, in full**

```ts
// construction (once, next to the CanvasSync wiring)
private surfaceState = createSurfaceStateStore(
  (path) => this.canvasAdapters.get(path)?.isAvailable() === true,
);
this.canvasSync.setSurfaceStateProvider((path) => this.surfaceState.stateFor(path));

// inside reconcileLiveCanvas, replacing :1073 / :1110 / :1146
const shadow = this.canvasSync.getSurfaceShadow();
const plan = planReconcile({ ..., lastApplied: shadowToCanvasRecords(shadow, canonical) });
// … existing execution branches, unchanged, collecting `reloaded` / `nodeOutcomes` …
const summary = advanceFromReceipt(
  shadow,
  buildApplyReceipt({ path: canonical, desired: data, plan, reloaded, nodeOutcomes }),
);
this.surfaceState.noteHandover(canonical, summary.handed);
```

Nothing else is added. `main.ts` gathers facts, calls, forwards — no conditional over
canvas state, no field comparison, no direct `advanceField` / `advanceRecord` /
`markRecordAbsent` / `planIntentDiff` call.

**6. The discrimination seam (BUILD_SPEC §8 — mandatory)**

| Member | Default | Semantics |
|---|---|---|
| `advanceFromReceipt(shadow, receipt, { perFieldReceipt: false })` | `true` | Restores V1 record-snapshot semantics exactly: if any record's outcome is `"interacting"` the pass advances nothing and hands nothing over; otherwise every record of the receipt is advanced and handed over regardless of its outcome, and `exhaustive` absent-marking does not run. That is both V1 defects in one switch — an interacting skip loses every other record's advance, and unapplied data is marked applied. Test-only; there is no production caller. |

**7. Types and paths**

`SurfaceShadow`, `ShadowRecordKind`, `ShadowFieldValue`, `SurfaceState`,
`advanceField`, `markRecordAbsent`, `getField`, `getRecordFields`, `getRecordState`,
`createSurfaceShadow` are the existing WP1/WP2 exports and are reused unchanged.
Every shadow and store key is the CANONICAL path
(`toCanonicalPath(normalizePath(rawPath))`), matching every other registry in
`main.ts`.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

None. All four acceptance criteria are verified here against the real
`canvas-shadow` core, the real `CanvasSync`, the real `createCanvasAdapter` and real
`Y.Doc` replicas. AC4 is a structural claim about a file that has no test file by
design; it is covered at this level by the branch-free wiring sequence plus a narrow
source scan (TC7) rather than deferred, so nothing in WP5 remains that needs a
running system. The two facts a live run would still add — that a real Obsidian
canvas view really produces the `"interacting"` outcome, and that a real remote delta
really reaches `reconcileLiveCanvas` — are injected as seams here and are owned by
other charters (the chaos scenarios in WP6/C6 and the two-vault run in WP7/C7).

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempts 1–3)

- **Observed current behavior:** `main.ts:114` held `canvasApplied`, a per-path RECORD
  snapshot written wholesale at `:1110` (structural reload landed) and `:1146`
  (`interacting === 0`), read at `:1073` as `planReconcile`'s `lastApplied`, deleted at
  `:1029` on canvas close and cleared at `:1425`. That is a second, parallel structure
  next to the WP4 Surface-Shadow the capture path classifies against, with both V1
  defects intact: an unlanded reload was still recorded as applied, and one held card
  discarded every other card's advance. `setSurfaceStateProvider` was still at WP4's
  honest P0 default, so C4's delete rule could never fire.
- **Approach:** implemented section 7 literally and additively in `canvas-shadow.ts`
  (`shadowToCanvasRecords`, `buildApplyReceipt`, `advanceFromReceipt` incl. the
  `perFieldReceipt` seam, `createSurfaceStateStore`), then reduced `main.ts` to wiring:
  the shadow is obtained from `this.canvasSync.getSurfaceShadow()` at its single use
  site, the two execution branches stay unchanged but now only COLLECT `reloaded` /
  `nodeOutcomes`, and one uniform receipt call site advances the shadow and feeds
  `surfaceState.noteHandover(...)`. Canvas close clears the hand-over receipt only.
- **Attempt 2 (generalisation):** the two fixture defects attempt 1 identified were
  repaired by their owner, so all 35 visible cases pass. Attempt 2 re-derived the
  receipt semantics from AC2/AC3 rather than from the fixtures and generalised three
  places where the implementation was only accidentally correct: the advance unit is
  now the RECORD, not the receipt line (an unconfirmed line vetoes every confirmed
  line for the same `(kind, id)`); the `exhaustive` absent sweep — the only operation
  that ERASES shadow knowledge — is skipped when the pass left anything unconfirmed;
  and a field value of `undefined` is never written into the shadow, where it would
  read back as "never observed". Details in `ImplementationReport_WP5.md` →
  *What I Generalized*.
- **Attempt 3 (correction):** attempt 2's governing asymmetry was wrong. Under-advancing is
  NOT cheap — failing to advance a field the surface confirmed makes the next restatement of
  that value read as fresh intent, which is pushed to the CRDT and overwrites newer peer
  state. Two of the six generalisations were conservative rather than exact and are
  REVERTED: the record-level veto (its order-dependence justification was false — line
  dispatch is already order-independent, because an unconfirmed line writes nothing and a
  confirmed line only writes) and the whole-pass gate on the `exhaustive` absent sweep
  (section 7 rule 3 states the sweep unconditionally on `exhaustive`; the per-record
  carve-out "a record the receipt carried is never swept" is what AC2/AC3 actually require
  and is kept). G3–G6 are kept, since none of them withholds anything the surface confirmed.
  The failing hidden diagnostic that prompted this attempt was measured to be
  nondeterministic — a Yjs `clientID` coin flip between two concurrent PEER writes,
  independent of this repository — see `ImplementationReport_WP5.md` →
  *Attempt 2 Regression — Root Cause*.
- **Fallback path if all attempts fail:** n/a — the contract implemented cleanly.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1, AC2, AC3, AC4 — all four implemented and covered green.
  `canvasApplied` and `cloneCanvasRecords` are gone from `main.ts`; classification basis
  and capture basis are the same `SurfaceShadow` instance; the hand-over set comes from
  the same `advanceFromReceipt` summary that advances it; closing a view drops the
  hand-over only. wp1–wp4 stay fully green, `tsc -noEmit -skipLibCheck` clean, no new
  runtime dependency, no timing, no schema or `.canvas` format change.
- **What remains open:** nothing in scope. One item for Worker 3 and two acknowledged,
  non-blocking notes for later WPs.
  - **For Worker 3:** the hidden robustness fixture `failed_hidden_WP4_tp05_blind2.test.ts`
    `T2` is not a valid oracle — it asserts a specific value after two CONCURRENT peer
    writes to the same `Y.Map` key, which Yjs resolves by higher `clientID`, and
    `Y.Doc.clientID` is random per construction (measured 50/50 over 200 runs, exactly
    correlated with the id order). Both candidate values are peer-authored; the offscreen
    client's stale value never appears. Second fixture defect of this shape in WP5's loop.
  - The capture path rounds geometry (`roundCanvasGeometry`) while the receipt stores the
    desired value verbatim as section 7 requires, so a fractional coordinate costs one extra
    `geometry` classification (never a wrong value).
  - An object/array-valued unknown field can never satisfy the shadow's `===` staleness test
    on EITHER side, which is a WP4/`reconcile-plan` property, not a WP5 one.
- **Final status:** DONE — 35/35 visible, 209/209 across `src/__tests__/v2/`, full suite
  924/927 with no new failures beyond the known `w4-canvas-integrity` A4/A9/A10,
  `tsc -noEmit -skipLibCheck` clean.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
