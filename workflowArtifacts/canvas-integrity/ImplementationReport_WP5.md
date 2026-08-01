# ImplementationReport — WP5 (Reconcile completeness + key protection, S3)

- **Batch:** C (second of WP4 → **WP5** → WP6 → WP7)
- **Stories:** US3 (AC1–AC13), US6 row `NO TYPE signature:`
- **Files changed:** `plugin/src/canvas/reconcile-plan.ts` (new), `plugin/src/__tests__/reconcile-plan.test.ts` (new), `plugin/src/main.ts`, `plugin/src/files/canvas-sync.ts`, `plugin/src/__tests__/canvas-sync.test.ts`
- **Grounding:** degraded mode (`graphify_enabled: false`, no `graph.json`, no `GRAPH_REPORT.md`); Graphify NOT run. Every anchor was re-located by symbol name because WP4 had shifted the line numbers in both of my files.
- **Test delta:** `canvas-sync.test.ts` 33 → **40** (+7); `reconcile-plan.test.ts` **new, 16**. Total **+23 tests, +1 file**. Neighbours unchanged: `canvas-matrix` 6, `canvas-persistence` 7, `harness/two-peer` 10, `canvas-presence` 16, `canvas-adapter` 42 (all green).
- **`plugin/src/canvas/canvas-adapter.ts`:** NOT touched (Batch A owns it). No new adapter method was needed — the classifier works from the data `reconcileLiveCanvas` already receives plus the shadow.

---

## ACs Satisfied

| AC | How verified |
|---|---|
| **US3 AC1** — a non-geometry difference vs the last-applied data classifies as `"structural"`, not just an id-set difference | `planReconcile` (`reconcile-plan.ts`) compares `desired` against the per-path shadow field-by-field; only NODE `x/y/width/height` number→number changes stay `"geometry"`. Tests: *AC4 text-only*, *AC4 sibling fields color/label*, *AC5 fromSide-only*, *"a node that LOST its type … is STRUCTURAL"*. The HEAD membership check is preserved as an additional structural trigger — test *"AC1: an id-set difference against the LIVE view is STRUCTURAL even when the data matches the shadow"*. |
| **US3 AC2** — pure exported function in a new module | `plugin/src/canvas/reconcile-plan.ts` exports `planReconcile`, `canvasIds`, `cloneCanvasRecords`, `RECONCILE_GEOMETRY_KEYS`, `type ReconcilePlan`, `type CanvasRecords`, `type ReconcilePlanInput`. The module imports **nothing** — no `obsidian`, no adapter, no `canvas-sync`. `reconcile-plan.test.ts` runs against it directly. |
| **US3 AC3** — returns `"structural" \| "geometry" \| "noop"`, pure over (desired, lastApplied, live node ids, live edge ids, `initial`) | `ReconcilePlanInput` is exactly those five fields. Test *"AC3: purity — same inputs give the same output and the inputs are not mutated"* calls it three times and re-checks a JSON snapshot of both inputs. All three return values are covered by tests (DoD). |
| **US3 AC4** — `text`-only → `"structural"` | Test *"AC4: a node `text`-only difference is STRUCTURAL, not geometry"*, green. RED-at-HEAD state recorded in § RED 6 (module absent) — see § ACs Not Satisfied for the honest scoping of the second half of the spec's red claim. |
| **US3 AC5** — edge `fromSide`-only → `"structural"` | Test *"AC5: an edge `fromSide`-only difference is STRUCTURAL"*, green. Implementation: any edge field difference is structural (an edge has no geometry, and per-node `moveAndResize` cannot re-route an arrow). |
| **US3 AC6** — geometry-only → `"geometry"`; the smooth drag path is NOT regressed | Two tests: *"AC6: an x/y/width/height-only difference stays GEOMETRY"* and *"AC6: 50 streamed drag frames all stay GEOMETRY (no setData per mouse move)"* — the second walks the shadow forward frame by frame exactly as `main.ts` does, so the geometry branch is asserted **reachable and sticky**, not just reachable once. |
| **US3 AC7** — equal data + matching id sets → `"noop"`, no adapter call | Tests *"AC7: identical data with matching id sets is NOOP"* and *"AC7: key ORDER and record ORDER never make a noop look like a change"*. In `main.ts` the `noop` plan returns **before** `mutePathEvents` and before every mutating adapter call. Wording caveat: the two pre-existing *read-only* calls `getLiveNodeIds()` / `getLiveEdgeIds()` still happen, because membership must be checked against the live view — they were already on this path at HEAD and cannot be replaced by the shadow without allowing a locally-added card to go unreconciled. Read as "no mutating adapter call". |
| **US3 AC8** — `initial` still forces `"structural"`; the moved-endpoint escalation still reloads | Test *"AC8: `initial` forces STRUCTURAL even for an exact match"* (and the `initial: false` control returns `noop`). The `movedEndpoint` → `reloadCanvasData` escalation in `main.ts` is byte-identical apart from the shadow write placed above it; `revertCanvasNode` (WP4) still calls `reconcileLiveCanvas(..., { initial: true })`. |
| **US3 AC9** — `type` protected from deletion in `applyToYMap` AND `applyKeyDiff` | New export `PROTECTED_KEYS` (`canvas-sync.ts:31-58`) replaces `GEOMETRY_KEYS` in **both** delete guards (`applyToYMap`, `applyKeyDiff`). Four tests: the key-set test, the AC11 node test, and two edge tests (one per branch). RED-first: § RED 1, 2, 3, 4. |
| **US3 AC10** — `GEOMETRY_KEYS` keeps `{x,y,width,height}` and stays exported | Test *"GEOMETRY_KEYS keeps exactly {x,y,width,height}; PROTECTED_KEYS is the wider superset"* asserts the sorted membership, that `PROTECTED_KEYS` is a strict superset, that content keys (`text`, `color`, `label`, `file`, `url`, `id`) stay deletable, and — drift guard — that `RECONCILE_GEOMETRY_KEYS` equals `GEOMETRY_KEYS`. `canvas-persistence.test.ts` (7) still green, so the transitive `applyToYMap` import is intact. |
| **US3 AC11** — `type` absent in `next`, present in `base` → key survives | Test *"keeps a node's `type` when a stale/partial local read omits it (US3 AC11)"*, and it also asserts the genuine local change (`x: 40`) still lands. **This WP's primary red** — § RED 2. |
| **US3 AC12/AC13** — `auditCanvasState` warns for a `type`-less node and a `type:file` node without `file`, through the `setLogger` seam, with a greppable prefix | `auditCanvasState` gains `noType` + `fileNodesWithoutFile` collectors and one `NO TYPE signature:` warn line. Tests *"audits a live node missing `type` and a type:file node missing `file`"* (asserts the prefix, that `n1` and `n2` are named, that the healthy `n3` is not, and that `SCATTER`/`DETACH` keep their exact text) and *"emits NO signature for a fully healthy canvas (no false positives)"*. RED-first — § RED 5. |
| **US6 (`NO TYPE signature:` row)** — one production emitter, greppable, no user data | `grep -n "NO TYPE signature:" plugin/src --include=*.ts` → one production hit, `plugin/src/files/canvas-sync.ts:892`. The line carries only counts and node ids — never node text, file contents or paths beyond the canvas path already logged. One line per audit (US6 AC5: once per occurrence). |
| **BUILD_SPEC WP5 AC7** — `main.ts` gains **wiring only** (D6) | `main.ts` gains one field (`canvasApplied`), one import, three `Map` writes, two `Map` deletes and a `plan ===` dispatch. Every decision — including the geometry-key semantics — lives in the pure module. The only logic **removed** from `main.ts` is `sameStringSet` (moved verbatim into `reconcile-plan.ts` as a module-private helper; it had no other caller). |
| **BUILD_SPEC WP5 AC8** — the shadow is per canonical path and cleared on unmount with the adapter | The map is keyed by `toCanonicalPath(normalizePath(path))`. `canvasApplied.delete(path)` sits next to `canvasAdapters.delete(path)` in the close-detection loop, and `canvasApplied.clear()` next to `canvasAdapters.clear()` in `teardownCanvasPresences`. A remount therefore has `lastApplied === null` → `"structural"`, and the mount path additionally passes `{ initial: true }`. Test *"no shadow yet … is STRUCTURAL"* pins the classifier half. |
| **Aliasing safety (self-imposed)** | The shadow stores `cloneCanvasRecords(data)`, not the same record objects that are handed to Obsidian's private `setData`. Test *"cloneCanvasRecords detaches the shadow from the records handed to setData"*. |

## ACs Not Satisfied

**None functionally.** Two honesty notes, both about *how* an AC was evidenced rather than whether it holds:

1. **BUILD_SPEC WP5 AC2's red framing is only half-verifiable, and I did not fake the other half.** The AC4/AC5 tests were confirmed RED against the unmodified tree, but the failure is `Cannot find module '../canvas/reconcile-plan'` — the *"module absent"* half of the spec's own wording (§ RED 6). The second half, *"today's equivalent decision in `reconcileLiveCanvas` yields the geometry branch"*, is **not** empirically reproducible: at HEAD that decision was an inline expression inside a private method of a class with **no test file**, so there is nothing to assert against without first extracting it (which is the fix). It is verified by direct code reading of the HEAD expression instead:
   ```ts
   const structural =
     !!opts?.initial ||
     !sameStringSet(desiredNodeIds, liveNodeIds) ||
     !sameStringSet(desiredEdgeIds, liveEdgeIds);
   ```
   With unchanged id sets and `initial` falsy this is `false`, so control fell to the `applyNodeGeometry` loop, which only ever writes `x/y/width/height` — a `text`/`color`/`fromSide` change could not reach the view. Reported as a code-level proof, not as a test.
2. **US3 AC7's "no adapter call is made"** is satisfied for mutating calls only — see the AC table row. The two read-only id reads pre-date this WP.
3. **US6 AC6 (the `ARCHITECTURE.md` appendix table)** is not done for my row: `ARCHITECTURE.md` is outside my permitted file list. `NO TYPE signature:` still needs appending there — same open item WP4 reported for its two rows.

## RED-First Observations

Every red was obtained by writing the test first and running it against the **unmodified** production tree. **No `git stash` / `checkout` / `reset` / `restore` / `clean` / `commit` was run at any point** — the tree carries uncommitted baseline work plus WP1/WP2/WP4 and a concurrent batch's in-flight edits.

Reds 1–5 come from one run; the `-t US3` filter keeps the reporter output clean (a failing Yjs `YMap` assertion dumps ~2 000 lines, so all assertions were written to compare **primitives**, which is why every failure below is one readable line).

> Line numbers in the RED output are from the pre-fix test file. They shifted by +4 afterwards when the `RECONCILE_GEOMETRY_KEYS` import and the drift-guard assertion were added.

### Run 1 — `npx vitest run src/__tests__/canvas-sync.test.ts -t US3`

Header: `❯ src/__tests__/canvas-sync.test.ts (40 tests | 5 failed | 35 skipped)`, footer `Test Files 1 failed (1)` / `Tests 5 failed | 35 skipped (40)`, exit code 1.

#### RED 1 — US3 AC9/AC10: the wider protected-key set does not exist at HEAD

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > GEOMETRY_KEYS keeps exactly {x,y,width,height}; PROTECTED_KEYS is the wider superset (US3 AC9/AC10)
TypeError: Cannot read properties of undefined (reading 'has')
 ❯ src/__tests__/canvas-sync.test.ts:831:60
    831|     for (const key of GEOMETRY_KEYS) expect(PROTECTED_KEYS.has(key)).t…
```

**GREEN after:** `PROTECTED_KEYS` exists as a strict superset of an unchanged `GEOMETRY_KEYS`; content keys stay deletable; `RECONCILE_GEOMETRY_KEYS === GEOMETRY_KEYS`.

#### RED 2 — US3 AC11 (**this WP's primary red**): `applyKeyDiff` deletes `type`

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > keeps a node's `type` when a stale/partial local read omits it (US3 AC11)
AssertionError: expected undefined to be 'text' // Object.is equality

- Expected: 
"text"

+ Received: 
undefined

 ❯ src/__tests__/canvas-sync.test.ts:865:28
    865|     expect(n1.get("type")).toBe("text"); // AC11: `type` survives the …
```
At HEAD one stale/partial disk read that moved the card and lost `type` **deleted `type` out of the shared CRDT**. Obsidian's `importData` then skips that node on every peer — and every edge attached to it — while the on-disk JSON still looks well-formed.

**GREEN after:** `type` stays `"text"` while the genuine local change (`x: 40`) still lands.

#### RED 3 — SPEC-DELTA: the full-merge branch deletes an edge's `fromNode`/`toNode`

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > keeps an edge's fromNode/toNode when the full-merge branch sees a partial local record (US3 AC9)
AssertionError: expected undefined to be 'n1' // Object.is equality

- Expected: 
"n1"

+ Received: 
undefined

 ❯ src/__tests__/canvas-sync.test.ts:894:32
    894|     expect(e1.get("fromNode")).toBe("n1"); // endpoints are structural…
```

**GREEN after:** `fromNode`/`toNode`/`toSide` all survive, the local `color: "4"` still lands, and `buildCanvasData` serialises an edge that still has its endpoints.

#### RED 4 — SPEC-DELTA, second branch: the key-diff path deletes them too

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > keeps an edge's endpoints when the key-diff branch sees a partial local record (US3 AC9)
AssertionError: expected undefined to be 'n1' // Object.is equality

- Expected: 
"n1"

+ Received: 
undefined

 ❯ src/__tests__/canvas-sync.test.ts:928:32
    928|     expect(e1.get("fromNode")).toBe("n1");
```
WP4's hand-off named only `applyToYMap`. The **same** loss is reachable through `applyKeyDiff` whenever the edge *is* in our diff baseline, so both guards had to change; this test pins the second path.

**GREEN after:** endpoints survive on this branch as well.

#### RED 5 — US3 AC12/AC13: a `type`-less node is invisible to the audit at HEAD

```
 FAIL  src/__tests__/canvas-sync.test.ts > CanvasSync > audits a live node missing `type` and a type:file node missing `file` (US3 AC12/AC13)
AssertionError: expected 0 to be greater than or equal to 1
 ❯ src/__tests__/canvas-sync.test.ts:981:27
    981|     expect(noType.length).toBeGreaterThanOrEqual(1);
```
At HEAD `auditCanvasState` inspected only `x`/`y` and dangling endpoints, so the most destructive corruption class emitted **no** log line at all.

**GREEN after:** one `NO TYPE signature: 1 node(s) missing type: n1; 1 file node(s) missing file: n2` line; the healthy `n3` is not named; `SCATTER`/`DETACH` stay silent and keep their exact text.

### Run 2 — `npx vitest run src/__tests__/reconcile-plan.test.ts`

#### RED 6 — US3 AC2/AC4/AC5: the classifier module does not exist at HEAD

```
 FAIL  src/__tests__/reconcile-plan.test.ts [ src/__tests__/reconcile-plan.test.ts ]
Error: Cannot find module '../canvas/reconcile-plan' imported from 'H:/Developement/_NeuralAngels/liveshareCollab/obsidian-live-share/plugin/src/__tests__/reconcile-plan.test.ts'
 ❯ src/__tests__/reconcile-plan.test.ts:3:1
    3| import { canvasIds, planReconcile } from "../canvas/reconcile-plan";
```
Footer: `Test Files 1 failed (1)` / `Tests no tests`, exit code 1.

**GREEN after:** `reconcile-plan.test.ts` 16/16 pass, covering all three return values.

### Green result (both files)

```
npx vitest run src/__tests__/reconcile-plan.test.ts src/__tests__/canvas-sync.test.ts && npx tsc -noEmit -skipLibCheck && echo TSC_CLEAN
 ✓ src/__tests__/reconcile-plan.test.ts (16 tests) 8ms
 ✓ src/__tests__/canvas-sync.test.ts (40 tests) 54ms
 Test Files  2 passed (2)
      Tests  56 passed (56)
TSC_CLEAN
```

## SPEC-DELTA — unnamed HIGH edge-endpoint deletion path

**Authorised by the dispatcher; NOT in the BUILD_SPEC's WP5 scope text.** Report upward as a deviation.

- **What:** the `!baseObj && existing` branch of `applyLocalDiffToYMaps` full-merges the local record into the existing `Y.Map` via `applyToYMap`, which deletes every key the local record lacks. The `GEOMETRY_KEYS` exemption is **node-shaped**, so for an edge *every* key was deletable — including `fromNode` and `toNode`. WP4 raised it as Risk Note 1; the BUILD_SPEC records it only as a "Known hole" in § 4 and never assigns it.
- **Why HIGH:** losing an endpoint is the round's headline symptom ("connections break"), and it **escapes the safety net** — `buildCanvasData`'s dangling-edge guard requires `typeof from === "string"`, so an edge that lost the key *entirely* passes straight through to disk, and every peer then drops it on `importData`.
- **Scope discipline:** fixed **inside the surface WP5 already owns** — the same new `PROTECTED_KEYS` set the WP block asked for ("a wider protected-key set including `type`, used by the delete guards in `applyToYMap` and `applyKeyDiff`") was extended with the edge structural keys, so the guards refuse them for exactly the reason they refuse `type`. **No new mechanism, no change to `GEOMETRY_KEYS`' membership, no adapter change.**
- **Red-first:** § RED 3 (the branch WP4 named) and § RED 4 (the *second*, un-named branch — `applyKeyDiff` loses the endpoints too whenever the edge **is** in our diff baseline; that one is my own finding, not WP4's).
- **Judgment call — `fromSide`/`toSide` ARE included** in `PROTECTED_KEYS`. They do not by themselves break a connection (Obsidian defaults the routing), so the narrow reading would exclude them. I included them because losing one makes Obsidian recompute *and re-save* its own routing, which then re-enters the sync as a fresh local edit — the exact "fights the sync" loop this round exists to close — and because their loss on this branch is peer data loss of precisely the kind US2 AC2 describes. Cost of being wrong: a legitimate removal of a side key never propagates and the CRDT value wins on the next remote-driven flush (cosmetic, self-healing, identical in character to the pre-existing `GEOMETRY_KEYS` behaviour). See Risk Note 3.
- **Trigger used in the test:** an edge present in the CRDT but absent from our diff baseline (a peer just added it) whose local disk record is partial — the edge-shaped twin of the node "partial disk read" case the v0.5.6 scatter fix was built for. WP4's narrative trigger (peer sets `color` → our structural reload makes Obsidian re-save → that save is diffed while `lastWrittenContent` is behind) reaches the same branch; the test constructs the branch conditions directly instead of simulating the whole loop, because the loop's other half is WP6/WP7 territory.

## Files Changed

```text
plugin/src/canvas/reconcile-plan.ts                        (NEW, 185 lines, zero imports)
├── type ReconcilePlan = "structural" | "geometry" | "noop"
├── interface CanvasRecords / ReconcilePlanInput
├── RECONCILE_GEOMETRY_KEYS  ← module-private mirror of GEOMETRY_KEYS, exported only
│                              so canvas-sync.test.ts can pin it against drift
├── canvasIds(records)       ← ids with a usable string id (replaces the inline
│                              .map().filter(Boolean) in main.ts)
├── cloneCanvasRecords(data) ← detached shallow copy for the shadow
├── sameStringSet(a, b)      ← moved verbatim out of main.ts:66-72 (private here)
├── indexById(records)       ← null when any record lacks an id ⇒ caller reloads
├── diffRecords(desired, lastApplied, kind) → "same" | "geometry" | "structural"
│     └── "geometry" ONLY for node x/y/width/height number→number; a geometry key
│         that appears/disappears or turns non-numeric is structural (the per-node
│         path would silently skip the node and leave the view stale)
└── planReconcile(input)    ← initial → live-membership → no-shadow → node diff →
                              edge diff (any difference = structural)

plugin/src/files/canvas-sync.ts
├── :31-60    NEW export PROTECTED_KEYS (declaration at :53) = {…GEOMETRY_KEYS, type,
│             fromNode, toNode, fromSide, toSide}, with the per-key rationale in the
│             comment above it.  GEOMETRY_KEYS at :29 is UNCHANGED and still exported
├── :190      applyToYMap delete guard: GEOMETRY_KEYS.has → PROTECTED_KEYS.has
├── :229      applyKeyDiff delete guard: GEOMETRY_KEYS.has → PROTECTED_KEYS.has
└── :826-894  auditCanvasState: new `noType` (:842) + `fileNodesWithoutFile` (:843)
              collectors filled in the existing single pass over nodesMap (:845-852),
              and one new warn at :882-893
              `NO TYPE signature: N node(s) missing type: …; M file node(s) missing
              file: …` (segments only when non-empty)  (US3 AC12/AC13, US6)

plugin/src/main.ts   (WIRING ONLY — no test file, per BUILD_SPEC WP5 AC7 / D6)
├── :13-18    import { type CanvasRecords, canvasIds, cloneCanvasRecords,
│             planReconcile } from "./canvas/reconcile-plan"
├── (was :66-72) REMOVED function sameStringSet — moved into reconcile-plan.ts; it had
│             no other caller, so leaving it would be dead code / a new biome finding
├── :96-105   NEW private canvasApplied = new Map<string, CanvasRecords>() (:105) — the
│             per-canonical-path last-applied shadow, in lockstep with canvasAdapters
├── :975-979  canvasApplied.delete(path) beside canvasAdapters.delete(path)  (AC8)
├── :1010-1033 reconcileLiveCanvas: desired ids via canvasIds() (:1017-1018); the inline
│             `const structural = …` expression is REPLACED by planReconcile({…})
│             (:1021-1028); a "noop" plan returns at :1030-1036, before mutePathEvents
│             and before any mutating adapter call  (AC1/AC2/AC7)
├── :1055-1060 structural branch: `if (plan === "structural")`, and the shadow is set
│             ONLY when reloadCanvasData returned true (:1060)
├── :1093-1096 geometry branch: shadow set only when interacting === 0 (:1096) — a card
│             the user is still holding was skipped, so the view does not match yet;
│             the movedEndpoint → reloadCanvasData escalation is otherwise untouched
└── :1303     canvasApplied.clear() in teardownCanvasPresences beside
              canvasAdapters.clear()  (AC8)

plugin/src/__tests__/reconcile-plan.test.ts                (NEW, 16 tests)
└── AC4 text / AC4 color+label / AC5 fromSide / AC6 geometry / AC6 50 drag frames /
    AC7 noop / AC7 order-independence / AC1 live-id difference / AC1 add+remove /
    AC8 initial / no-shadow / type lost+gained / AC3 purity / cloneCanvasRecords /
    canvasIds id filtering / mangled record

plugin/src/__tests__/canvas-sync.test.ts   (33 → 40 tests)
├── :6        import { RECONCILE_GEOMETRY_KEYS } from "../canvas/reconcile-plan"
├── :59-61    the dynamic import now also destructures buildCanvasData,
│             GEOMETRY_KEYS, PROTECTED_KEYS
└── :810-1016 NEW WP5 block inside describe("CanvasSync") (:822 helpers, :828 first
              test): nodesOf/edgesOf helpers +
              7 tests — key sets & drift guard, AC11 `type` survival, edge endpoints
              on the full-merge branch, edge endpoints on the key-diff branch,
              whole-record delete still honoured, the NO TYPE audit, and the
              no-false-positive control
```

**Not touched:** `plugin/src/canvas/canvas-adapter.ts` (Batch A owns it), `plugin/src/canvas/canvas-presence.ts`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `canvas-persistence.ts`, `GEOMETRY_KEYS`' membership, `pruneEdgesForDeletedNodes`, `buildCanvasData`, `serializeCanvas`, `handleLocalModify`'s WP4 baseline logic, `canWriteEntity`, the `onRevert` wiring, `plugin/src/types.ts` (`useCanvasBinding` still `false`, verified), version (still 0.6.0), `server/`, `docker/`, deploy files, manifests, `plugin/main.js`.

## Quality Gates

| Command | Result |
|---|---|
| `npx vitest run src/__tests__/reconcile-plan.test.ts src/__tests__/canvas-sync.test.ts` | **PASS** — `Test Files 2 passed (2)`, `Tests 56 passed (56)`, exit 0 |
| `npx vitest run src/__tests__/canvas-matrix.test.ts src/__tests__/canvas-persistence.test.ts src/__tests__/harness/two-peer.test.ts src/__tests__/canvas-presence.test.ts src/__tests__/canvas-adapter.test.ts` | **PASS** — `Test Files 5 passed (5)`, `Tests 81 passed (81)`, exit 0. No previously-passing test failed. |
| `npx tsc -noEmit -skipLibCheck && echo TSC_CLEAN` | **PASS** (`TSC_CLEAN`, exit 0, no diagnostics) |
| `npx biome lint <the 5 files>` | **1 finding — no increase.** The single `lint/style/useTemplate` is the same pre-existing one WP4 reported, on the untouched `local modify` telemetry line (now `canvas-sync.ts:586` after my +29-line `PROTECTED_KEYS` block). Zero findings on `reconcile-plan.ts`, `main.ts` and both test files. |
| `grep -n "NO TYPE signature:" plugin/src --include=*.ts` (production) | **PASS** — 1 production emitter, `plugin/src/files/canvas-sync.ts:892` |
| `npm run build` | **NOT RUN, by dispatcher instruction** — its esbuild step writes the shared `plugin/main.js` while three batches run concurrently. `tsc -noEmit` covers the typecheck half of gate 1. |
| `npm test` (whole suite) | **NOT RUN, by dispatcher instruction** (targeted runs only). Delta is purely additive: **+23 tests, +1 file**, 0 previously-passing failures across the 7 files run. From the dispatcher's stated 551 (526 HEAD + WP1 11 + WP2 8 + WP4 6) that projects to **574 / 33 files**, but the absolute number is not verifiable from inside a tree that two other batches are editing (`canvas-adapter.test.ts` already reads 42 tests here). |

## Risk Notes

1. **`main.ts` is still untested.** The shadow's *lifecycle* — written on a successful apply, dropped with the adapter — is glue in a class with no test file. The classifier half is fully unit-tested and the shadow-advance rule is mirrored frame-by-frame in the `50 streamed drag frames` test, but a future regression in `reconcileLiveCanvas`'s **bookkeeping** (e.g. someone moving the `canvasApplied.set` above the `interacting` check) would be caught by no test. This is the single highest-value follow-up for W4.
2. **Reconcile volume goes up, deliberately.** Non-geometry remote deltas now take the `setData` path that HEAD silently skipped. That is the bug fix, but it means more full reloads than before on canvases where peers edit text/colour. Bounded by three things: `isBusy()` still defers everything mid-drag, `"noop"` now suppresses passes HEAD would still have walked, and pure drags stay on `moveAndResize`. If a user reports flicker while a peer types into a card, this is the knob.
3. **`fromSide`/`toSide` are now undeletable through the diff path** (see § SPEC-DELTA). If Obsidian ever legitimately omits a side key to mean "automatic", that removal will not propagate; the CRDT value stands until something *sets* it, and the next remote-driven flush rewrites the disk file with the retained value. Same failure character as the pre-existing `GEOMETRY_KEYS` guard. Revisit here (`PROTECTED_KEYS`, `canvas-sync.ts:52-56`) if W4 sees a "side snaps back" symptom.
4. **A protected key can now be *stuck* rather than lost.** For any key in `PROTECTED_KEYS`, disk and CRDT can disagree indefinitely if the local file genuinely lacks it: the echo-breaker's `canvasRecordsEqual` then never matches, so every local-modify pass re-runs the diff. Verified non-looping — the diff makes no CRDT change, so no observer fires and no new event is produced — but it does mean a repeated no-op diff on a pathological file until the next remote-driven flush restores the key on disk.
5. **`type`-less nodes are flagged, never repaired** (explicit BUILD_SPEC out-of-scope). `NO TYPE signature:` makes the corruption diagnosable; the node is still broken for Obsidian's importer until a peer or the user rewrites it.
6. **The shadow does not survive a plugin reload or a canvas close/reopen** — by design (AC8). The first pass after a remount is `"structural"`, which costs one extra `setData` on reopen and is exactly the behaviour `mountCanvasPresence`'s `{ initial: true }` already had.
7. **WP6/WP7 will edit both of my files.** See the handover note in my final message; my `main.ts` footprint is one field, one import block, two `Map` writes inside `reconcileLiveCanvas` and two deletes at the teardown sites, and my `canvas-sync.ts` footprint is `PROTECTED_KEYS`, the two guard lines, and the tail of `auditCanvasState`.
8. **Tooling:** used a fresh `session_key` per run (`w3-wp5-r1` … `-r8`); no `WinError 5` lock hit this time. Confirmed again that `-t <name>` filtering is necessary to keep a failing Yjs assertion from truncating the reporter — all new assertions compare primitives for the same reason.
