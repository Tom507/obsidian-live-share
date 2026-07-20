# RepoMap — Canvas-Sync CRDT Redesign (Phase 0)

> Discovery artifact (graphify disabled → RepoMap fallback). Structural map for the
> Phase 0 implementers. All paths relative to `plugin/`. Line numbers against HEAD.

## 1. Y.Doc canvas shape usage

File: `src/files/canvas-sync.ts`

- Doc shape: two top-level Y.Maps keyed by id. Each entry is itself a `Y.Map<unknown>`
  of primitive fields (a map-of-maps).
  - `doc.getMap<Y.Map<unknown>>("nodes")` — id → Y.Map of node fields
  - `doc.getMap<Y.Map<unknown>>("edges")` — id → Y.Map of edge fields
  - Retrieved at lines 306-307, 340-341, 468-469.
- Record shape = raw Obsidian `.canvas` node/edge objects, stored key-by-key. Nodes
  carry `id, x, y, width, height, type, text, ...`; edges carry `id, fromNode, toNode, ...`
  (`pruneEdgesForDeletedNodes` reads `"fromNode"`/`"toNode"` at 606-607;
  `GEOMETRY_KEYS = new Set(["x","y","width","height"])` at line 29).
- Read helpers:
  - `buildCanvasData(nodesMap, edgesMap)` L67-99 — flattens map-of-maps to
    `{nodes:[], edges:[]}`, prunes dangling edges (endpoint node absent).
  - `ymapToRecords(m)` L106-114 — flatten to `Record<id, Record<field,value>>`.
  - `serializeCanvas(...)` L101-103 — `JSON.stringify(buildCanvasData(...), null, "\t")`.
- Write helpers (into a single node/edge `Y.Map<unknown>`):
  - `applyToYMap(ymap, obj)` L137-155 — full merge; sets changed keys, deletes stale
    keys EXCEPT `GEOMETRY_KEYS`.
  - `applyKeyDiff(ymap, base, next)` L172-193 — pushes only user-changed keys; geometry
    keys never deleted.
  - `applyCanvasToYMaps(...)` L649-681 (private) — full seed/replace of both maps.

## 2. Two-peer harness pattern (SPEC_01 §10)

File: `src/__tests__/canvas-sync.test.ts`

`applyRemoteCanvasDelta` (L62-74) is the canonical peer-to-peer pattern Phase 0 tests
must mirror:

```ts
function applyRemoteCanvasDelta(doc, build) {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));   // sync remote <- doc
  build(remote.getMap("nodes"), remote.getMap("edges")); // mutate remote replica
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));   // integrate remote -> doc (tr.local=false)
  remote.destroy();
}
```

Key point: because `remote` is first synced from `doc`, a delete references the SAME
item so it actually removes it on `doc`, and the integrating transaction is non-local.
Helper `remoteNode(fields)` (L76-80) builds a `Y.Map` from a plain object. Usage:
L408, L513-515, L566-567, L586-588.

## 3. Serializer / diff / equality helpers (reuse, do not duplicate)

All in `src/files/canvas-sync.ts`:

- `buildCanvasData(nodesMap: Y.Map<Y.Map<unknown>>, edgesMap): { nodes: Record<string,unknown>[]; edges: Record<string,unknown>[] }` — L67-99.
- `serializeCanvas(nodesMap, edgesMap): string` — L101-103.
- `ymapToRecords(m: Y.Map<Y.Map<unknown>>): Record<string, Record<string, unknown>>` — L106-114.
- `canvasRecordsEqual(a, b): boolean` — order-independent semantic equality — L118-135.
- `applyToYMap(ymap: Y.Map<unknown>, obj): void` — L137-155.
- `objChanged(base, next): boolean` — shallow diff predicate — L158-166.
- `applyKeyDiff(ymap: Y.Map<unknown>, base, next): void` — L172-193.
- Private methods on `CanvasSync`: `applyLocalDiffToYMaps(ymap, base, next, opts?)` L538-596,
  `applyCanvasToYMaps(...)` L649-681, `pruneEdgesForDeletedNodes(...)` L600-615.

Note: module-level helpers (L1-193) are NOT exported today. Phase 0 reuse either
re-exports them or re-implements the same contracts in the new binding.

## 4. How a per-canvas Y.Doc is obtained

- `CanvasSync.getCanvasDocHandle(rawPath)` — `src/files/canvas-sync.ts` L288-291:
  `this.syncManager.getDoc("__canvas__:" + toCanonicalPath(normalizePath(rawPath)))`.
  Doc-id prefix `CANVAS_DOC_PREFIX = "__canvas__:"` L16.
- `SyncManager.getDoc(docId): DocHandle | null` and `waitForSync(docId)` — `src/sync/sync.ts`,
  class at L49.
- `DocHandle` type — `src/sync/sync.ts` L41-45: `{ doc: Y.Doc; text: Y.Text; awareness: awarenessProtocol.Awareness }`.
- `Y.Doc` type import: `import * as Y from "yjs"` then `Y.Doc` (canvas-sync.ts L2).
  Phase 0 binding constructor takes a `Y.Doc` typed via `import * as Y from "yjs"`.

## 5. CanvasAdapter surface (LATER phase — inventory only, NOT Phase 0)

File: `src/canvas/canvas-adapter.ts`

Interface `CanvasAdapter` (L32-87). Members relevant to a future real bridge:
- `isAvailable()` L34 / impl L304-308; `availabilityReport()` L36 / L310-321.
- `getLiveNodeIds(): Set<string>` L52 / L368-372; `getLiveEdgeIds(): Set<string>` L54 / L374-378.
- `getNodeGeometry(nodeId): NodeGeometry | null` L56 / L380-392.
- `isBusy(): boolean` L58 / L394-399 (true during drag).
- `applyNodeGeometry(nodeId, geo): "applied"|"unchanged"|"interacting"|"missing"|"unsupported"` L63-66 / L401-425 — wraps private `node.moveAndResize(...)` (CanvasNode shape L135-145).
- `reloadCanvasData(data): boolean` L72 / L427-438 — wraps private `canvas.setData(data)` + `requestFrame()` (PrivateCanvas L154-175).
- Interaction hooks: `onNodeInteractionStart/End` L78/L80 (patch `updateSelection`/`setDragging`),
  `onPointerMove` L82, `onViewportChange` L83; `destroy()` L86.
- Factory: `createCanvasAdapter(view: unknown): CanvasAdapter` L195. Types `NodeGeometry`
  L147-152, `CanvasViewport` L26-30.

The Phase 0 `CanvasModelBridge` interface should be modeled so it can LATER be satisfied
by an adapter-backed real bridge (SPEC_02): nodes/edges id sets, per-node geometry
get/set (`moveAndResize`→`applyNodeGeometry`), structural `setData`/`reloadCanvasData`,
`isBusy`/dragging, selection patches.

## 6. Test infra

- Vitest config: `plugin/vitest.config.ts` — aliases `obsidian` → `src/__mocks__/obsidian.ts`;
  empty `test: {}` (Node env, default glob `**/*.test.ts`).
- yjs import in tests: `import * as Y from "yjs"` (canvas-sync.test.ts L3).
- Test dir/naming convention: `src/__tests__/*.test.ts` (plus nested `src/__tests__/wp5/latency.test.ts`).
  Mocks in `src/__mocks__/`.
- Current suite: `npx vitest run` → **23 test files, 440 tests passing** (matches SPEC's ~440).
- Commands (`package.json`): test = `vitest run`; test:watch = `vitest`; lint = `biome check .`;
  format = `biome check --write .`; build (includes typecheck) = `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`.
  No standalone `typecheck` script — use `npx tsc -noEmit -skipLibCheck`.

## 7. Where CanvasBinding should live

- Source: `src/canvas/canvas-binding.ts` (beside `canvas-adapter.ts`; headless, no Obsidian import).
- Test: `src/__tests__/canvas-binding.test.ts` (matches `src/__tests__/*.test.ts` convention).
- The fake in-memory `CanvasModelBridge` and two-peer harness live inline in that test
  file, mirroring canvas-sync.test.ts's `applyRemoteCanvasDelta`/`remoteNode` helpers.

## 8. yjs import style + version

- Style: namespace import `import * as Y from "yjs"` everywhere (canvas-sync.ts:2,
  canvas-sync.test.ts:3, sync.ts). Use `Y.Doc`, `Y.Map`, `Y.encodeStateAsUpdate`, `Y.applyUpdate`.
- Installed version: `"yjs": "^13.6.0"` (`plugin/package.json` L19). Also present:
  `y-protocols ^1.0.6`, `y-codemirror.next ^0.3.5`, `lib0 ^0.2.97`.

---

**Top reuse targets:**
1. `src/files/canvas-sync.ts` map-of-maps model + helpers `buildCanvasData` (L67),
   `applyKeyDiff` (L172), `applyToYMap` (L137), `canvasRecordsEqual` (L118),
   `ymapToRecords` (L106) — reuse/re-export, don't reimplement.
2. `src/__tests__/canvas-sync.test.ts` `applyRemoteCanvasDelta` (L62-74) + `remoteNode`
   (L76) — the exact two-peer `encodeStateAsUpdate`/`applyUpdate` harness Phase 0 mirrors.
3. `import * as Y from "yjs"` (yjs ^13.6.0), `Y.Doc` from `src/sync/sync.ts` `DocHandle`
   (L41-45); place binding at `src/canvas/canvas-binding.ts` + test `src/__tests__/canvas-binding.test.ts`.
