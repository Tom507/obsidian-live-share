# Task Charter — WP27: GUID identity + rename + `getDoc` guards

**Charter Status:** `DONE`
**WP:** WP27
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP8, WP24
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** R5 and the rename hole are closed structurally.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C27 — GUID doc identity, path mapping and rename** (work package WP27); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`CANVAS_DOC_PREFIX` `:16` and the five doc-id sites `:334`, `:348`, `:367`, `:493`, `:504`; `manifest.ts`; `sync.ts:200–252`) + fix `background-sync.ts:173` and `collab.ts:62`
  - Responsibility: make identity independent of the path, so a rename is metadata and a bare-path `getDoc` cannot collide with a canvas doc.
  - Scope summary: doc id by guid; path stays the registry key
- **Out of scope / non-goals:**
  - Re-keying any in-memory registry, the ownership predicate or the awareness field shape — all stay path-keyed.
  - The epoch comparison rule — WP28.
  - Changing `SyncManager.getDoc`'s create-on-demand behaviour for non-canvas docs.
- **Known interfaces / dependencies:**
  - Input: a canonical path
  - Output: the doc id `__canvas__:<guid>`, with `path` an attribute in `meta` and in the manifest
  - Depends on work packages: WP8, WP24

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** GUID doc identity, path mapping and rename
- **Interfaces involved:**
  - Input: a canonical path
  - Output: the doc id `__canvas__:<guid>`, with `path` an attribute in `meta` and in the manifest
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
  - **Schema impact:** No `schemaVersion` bump. Adds `meta.guid`, `meta.epoch` and `meta.path`, the sidecar files, and changes the doc-id namespace from path-based to guid-based. Mixed-version rule: a client that cannot resolve a guid for a path treats the doc as unknown and asks peers or the manifest — it never seeds a second doc for the same file.
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/files/canvas-sync.ts:16` — `CANVAS_DOC_PREFIX` (module-private, not exported) and the five construction sites `:334`, `:348`, `:367`, `:493`, `:504`, plus `:768`
  - `plugin/src/sync/sync.ts:200–252` — `getDoc` creates a `Y.Doc` + `Y.Text("content")` on demand (`:210`, `:249`)
  - `plugin/src/files/background-sync.ts:173` — unguarded bare-path `getDoc` inside `setActiveFile`
  - `plugin/src/editor/collab.ts:62` — unguarded bare-path `getDoc` inside `activateForFile`
  - `plugin/src/files/manifest.ts` — the manifest doc and `syncFromManifest`
  - `plugin/src/files/vault-events.ts:53–63` — `canvasOwned` (stays path-based)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C27. No paraphrasing.*

1. Canvas docs are addressed by `__canvas__:<guid>`; `meta.path` and the manifest carry the `path → guid` mapping, and a client that knows only the path can resolve the guid from the manifest or from peers.
2. A rename mid-session updates `meta.path`, the manifest mapping and `index.json` without creating a new doc and without orphaning the old one; edits continue to flow across the rename.
3. All in-memory registries (adapter, presence, persistence, mute registry), the ownership predicate `canvasOwned`, and the **awareness field shape including `canvasPath`** remain path-keyed and unchanged.
4. The two unguarded bare-path `getDoc` call sites (`background-sync.ts:173`, `collab.ts:62`) can no longer create or reach a canvas doc, verified by an explicit test rather than by a reachability argument.

**Definition of Done:** R5 and the rename hole are closed structurally.

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
  - `plugin/src/files/manifest.ts`
  - `plugin/src/files/background-sync.ts`
  - `plugin/src/editor/collab.ts`
  - the sidecar index from WP24
- **Required report:** `ImplementationReport_WP27.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases

### 7.0 — What the coder cannot derive from this charter

#### (a) The exported API surface WP27 must provide, verbatim

The visible tests import exactly these symbols. Every name, signature and
literal below is what the suite asserts; nothing else is pinned.

`plugin/src/canvas/canvas-schema.ts` — beside the existing `META_MAP_NAME` /
`SCHEMA_VERSION_KEY`, in the same style, in that same module:

```ts
/** The `meta` key carrying the doc's stable identity. */
export const GUID_KEY = "guid";
/** The `meta` key carrying the canvas file's current vault path. */
export const PATH_KEY = "path";
/**
 * The `meta` key carrying the doc's epoch.
 * WP27 DEFINES this constant; WP28 owns its SEMANTICS (contract §2).
 */
export const EPOCH_KEY = "epoch";
```

`plugin/src/files/canvas-sync.ts`:

```ts
/** Currently a module-private `const` at `:93`. WP27 exports it. */
export const CANVAS_DOC_PREFIX = "__canvas__:";

/**
 * The ONE constructor for a canvas doc id. Returns `` `${CANVAS_DOC_PREFIX}${guid}` ``.
 * THROWS for a non-string, empty or blank guid — an unresolved guid must never
 * produce the bare prefix, which would be one shared doc for every canvas whose
 * guid could not be resolved.
 */
export function canvasDocId(guid: string): string;

/** The path <-> guid store. Async because `index.json` is a file. */
export interface CanvasIdentityStore {
  guidForPath(path: string): Promise<string | null>;
  bind(guid: string, path: string): Promise<void>;
  unbind(path: string): Promise<void>;
}

/**
 * The production store: manifest first, then the sidecar `index.json`
 * (guid -> path, scanned by VALUE). `bind` writes both; `unbind` clears the
 * manifest entry's guid at that path and drops any index row whose value is
 * that path. Both are idempotent — `ManifestManager.renameFile` may already
 * have moved the entry before this runs.
 */
export function createCanvasIdentityStore(deps: {
  manifest: Pick<ManifestManager, "getCanvasGuid" | "setCanvasGuid"> | null;
  sidecar: Pick<SidecarStore, "readIndex" | "writeIndex"> | null;
}): CanvasIdentityStore;

class CanvasSync {
  setIdentityStore(store: CanvasIdentityStore): void;
  /** Cached, synchronous: the guid for a CANONICAL path, or `null`. */
  getCanvasGuid(rawPath: string): string | null;
  /** The rename entry point. Re-keys every path-keyed map, updates `meta.path`,
   *  and re-binds the identity store. Creates no doc and releases none. */
  handleRename(oldRawPath: string, newRawPath: string): Promise<void>;
}
```

`plugin/src/files/manifest.ts`:

```ts
export interface FileEntry {
  /* …existing fields… */
  /** WP27: the `path -> guid` half of AC1. */
  guid?: string;
}

class ManifestManager {
  setCanvasGuid(rawPath: string, guid: string): void; // creates a minimal entry if none
  getCanvasGuid(rawPath: string): string | null;
  // `renameFile` already re-keys the whole entry object, so `guid` travels with
  // it. TC5.5 pins that.
}
```

Behavioural rules the suite pins on `subscribe(rawPath, role)`:

- the doc id is `canvasDocId(guid)` — `getDoc` and `waitForSync` are called with
  nothing else in the canvas namespace;
- `meta[GUID_KEY]` and `meta[PATH_KEY]` are stamped on the doc;
- `role === "host"` with no resolvable guid MINTS one and binds it;
- `role === "guest"` with no resolvable guid **does nothing at all** — no
  `getDoc`, no doc, and the path is not added to `subscribedPaths`. This is the
  mixed-version rule of §3: never a second doc for the same file.

#### (b) Three facts a coder cannot derive

1. **Every line number in §2/§3 of this charter is stale** (Shared Ownership
   Contract §4). Locate by NAME. Verified anchors at authoring time:
   `CANVAS_DOC_PREFIX` → `canvas-sync.ts:93`; the doc-id sites → `:1723`,
   `:1737`, `:1761`, `:1912`, `:1923`, `:2336`; `subscribe` → `:1754`;
   `unsubscribe` → `:1882`; `SyncManager.getDoc` → `sync/sync.ts:222-277`; the
   two bare-path `getDoc` sites → `background-sync.ts` `setActiveFile` (**`:195`**,
   not `:173`) and `editor/collab.ts:62`; `canvasOwned` → `vault-events.ts:53-60`.

2. **`EPOCH_KEY` is a deliberate ownership SPLIT.** WP27 declares the constant
   and may stamp an initial value. Monotonicity, comparison, host-increment and
   conflict handling are WP28's and are **not** pinned by any test here. A coder
   who finds itself writing a comparison has crossed into WP28 and must stop.

3. **The identity stamp can strand WP8's migration, silently.**
   `migrateV1ToV2` (`canvas-schema.ts`) uses the mere presence of a non-empty
   `meta` as its one-shot marker (`if (readMeta(doc) !== undefined) return;`).
   AC1 writes three keys into that container at SUBSCRIBE time, while the
   migration runs later inside `CanvasPersistence.coldOpen`. Stamping first
   therefore arms the marker before the migration has run and leaves every
   V1-shaped doc permanently untranslated — no `schemaVersion`, no `pos`/`size`
   registers, no `ord`. Nothing throws and every convergence oracle stays green.
   The suite is ordering-neutral about the fix (call `migrateV1ToV2(doc)` first,
   or stamp after cold open) but it does pin that the doc still reaches V2.

#### (c) The AC4 vacuity trap — read before touching TC9 or TC10

Once a canvas doc is `__canvas__:<guid>`, a bare path collides with no canvas
doc, so "calling `getDoc(path)` did not return a canvas doc" is **true against a
completely unguarded call site**. A test written that way cannot fail. AC4 says
so in as many words: *verified by an explicit test rather than by a reachability
argument.*

TC9 and TC10 therefore make the CALL the oracle, not the result:

| Assertion | Production line whose removal reddens it |
|---|---|
| TC9 `expect(requested).not.toContain("boards/board.canvas")` and `expect(getDoc).not.toHaveBeenCalledWith(...)` | the guard statement immediately preceding `const docHandle = this.syncManager.getDoc(oldActive);` in `BackgroundSync.setActiveFile` (`files/background-sync.ts`, currently `:195`) |
| TC10 `expect(syncManager.getDoc).not.toHaveBeenCalled()` and `expect(lastReconfigure()).not.toContain("yCollab-extension")` | the guard statement immediately preceding `const docHandle = syncManager.getDoc(filePath);` in `CollabManager.activateForFile` (`editor/collab.ts`, currently `:62`) |

`skipsAutoTextSync` (`utils.ts:230`) is the intended predicate at both sites —
it already covers `.canvas` (clause 1) and the sidecar (clause 2), and this repo
has been bitten twice by a second private copy of `endsWith(".canvas")`. Both
sites are fed from the same `sharedPath` derived from a `MarkdownView` in
`main.ts:894-943`, so a `.canvas` cannot reach them in production and the guard
breaks nothing — including the R10 text fallback, which never routes through a
MarkdownView. Each test carries an **over-guard control** proving
`BackgroundSync.subscribe(".canvas")` stays the open R10 door (WP33's to close).

#### (d) AC3 is negative — the tests observe survival, not absence

TC7 and TC8 never assert "nothing broke". Every path-keyed lookup is performed
AFTER a guid-addressed subscribe and is PAIRED with the guid-shaped key that
must not answer, so a registry re-keyed by guid flips both columns of the same
table. TC8 is the only file in the set that imports nothing WP27 adds; it passes
against the current tree on purpose and its value is entirely in what turns it
red — a `canvasPath` carrying the guid or the doc id.

---

### TC1 — `CANVAS_DOC_PREFIX` is exported and `canvasDocId` is the sole doc-id constructor
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp27/test_tp01_doc_id_construction_visible.test.ts`
- What it checks: the id is `prefix + guid` for every guid shape, no vault path is ever in the namespace, an unresolved guid is refused rather than mapped to the bare prefix, and the three meta keys are `"guid"` / `"path"` / `"epoch"` and distinct from the two existing ones.
- Test data channel: deterministic generator (a fixed guid corpus and a fixed path corpus, both literal in the file)

### TC2 — subscribing a canvas addresses `__canvas__:<guid>` and stamps `meta`
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp27/test_tp02_subscribe_addresses_by_guid_visible.test.ts`
- What it checks: the only canvas-namespace id ever requested is `canvasDocId(guid)`, `meta.guid` / `meta.path` are stamped, the manifest carries `path -> guid`, and a host with no known guid mints, binds and uses one.
- Test data channel: fixture (in-memory vault + recording `SyncManager` double + real `ManifestManager` and WP24 `SidecarStore`)

### TC3 — a bare path resolves to a guid, and an unresolvable one seeds no second doc
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp27/test_tp03_path_to_guid_resolution_visible.test.ts`
- What it checks: resolution from the manifest and from `index.json` (matched by value), and that a guest which cannot resolve opens nothing and later joins the SAME doc — exactly one canvas doc id has ever existed for the file.
- Test data channel: fixture (a fixed guid pre-published through one source at a time)

### TC4 — a rename updates `meta.path`, the manifest mapping and `index.json`
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp27/test_tp04_rename_updates_metadata_visible.test.ts`
- What it checks: all three destinations move, the guid is unchanged at each, no stale mapping is left at the old path, no second guid appears in `index.json`, and `ManifestManager.renameFile` carries `guid` with the entry.
- Test data channel: fixture (fixed guid, in-memory sidecar IO read back through WP24's own `readIndex`)

### TC5 — the rename creates no new doc and orphans no old one
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp27/test_tp05_rename_creates_no_doc_and_no_orphan_visible.test.ts`
- What it checks: the doc-registry key set is identical before and after, the `Y.Doc` is the SAME instance (`toBe`), the doc was never released, the subscription follows the path, and a later `unsubscribe` releases the guid id rather than a path id.
- Test data channel: fixture (recording `SyncManager` double whose `releaseDoc` records without destroying)

### TC6 — edits continue to flow across the rename
- Verifies AC: AC2
- Test file: `plugin/src/__tests__/v2/wp27/test_tp06_edits_flow_across_rename_visible.test.ts`
- What it checks: a local edit reaches the same doc before (control) and after the rename, the retired path stops being accepted, and a peer delta after the rename is delivered through the remote hook under the NEW path.
- Test data channel: seed (a peer `Y.Doc` forked from the live doc, applied as a real update)

### TC7 — the path-keyed registries survive the identity change
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp27/test_tp07_registries_stay_path_keyed_visible.test.ts`
- What it checks: `isSubscribed`, `getCanvasDocHandle`, `getCanvasSnapshot`, `canvasOwned`, the real `FileOpsManager` mute registry and the two persistence seams all answer to the PATH and not to the guid or the doc id, after a guid-addressed subscribe.
- Test data channel: fixture (real `FileOpsManager`, real `canvasOwned`, doubles only for vault and sync)

### TC8 — the awareness field shape including `canvasPath` is unchanged
- Verifies AC: AC3
- Test file: `plugin/src/__tests__/v2/wp27/test_tp08_awareness_field_shape_visible.test.ts`
- What it checks: the emitted local state has exactly the six documented keys, `canvasPath` carries the vault path at every emission, and `holdersOf` / `resolveHolder` / `computeCanWriteNode` / `computeCanDeleteNode` still match on the path while a doc-id "room" finds nobody.
- Test data channel: fixture (hand-built awareness states; `canvas-presence.ts` is read-only for this initiative)

### TC9 — `BackgroundSync.setActiveFile` can no longer reach a canvas doc
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp27/test_tp09_background_sync_getdoc_guard_visible.test.ts`
- What it checks: a `.canvas` old-active path is never handed to `getDoc` (asserted through the call log AND through vitest's call matcher), with a positive control that markdown still is and an over-guard control that `subscribe()` stays the open R10 door.
- Test data channel: fixture (recording `SyncManager` double; the call log is the oracle, not the returned handle)

### TC10 — `CollabManager.activateForFile` can no longer reach a canvas doc
- Verifies AC: AC4
- Test file: `plugin/src/__tests__/v2/wp27/test_tp10_collab_getdoc_guard_visible.test.ts`
- What it checks: a `.canvas` path never reaches `getDoc` or `waitForSync`, no `yCollab` binding is installed, no `Y.Text` is seeded from the editor content, and an ordinary markdown file still binds.
- Test data channel: fixture (module-level `vi.mock` doubles for `@codemirror/state`, `@codemirror/view`, `y-codemirror.next` and `yjs`, mirroring the pre-existing `collab.test.ts`)

### TC11 — the identity stamp does not strand the V1→V2 migration
- Verifies AC: AC1
- Test file: `plugin/src/__tests__/v2/wp27/test_tp11_identity_stamp_does_not_strand_migration_visible.test.ts`
- What it checks: after the identity has been stamped on a V1-shaped doc, `migrateV1ToV2` still brings it to `SUPPORTED_SCHEMA_MAJOR` with `pos` / `size` / `ord` written, the identity keys survive, and the stamped doc is not read as a foreign schema major.
- Test data channel: seed (a hand-built V1 `Y.Doc` placed under the guid id before the subscribe), plus a pre-condition control proving the fixture really is un-migrated

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty — no AC in §4 is INTEGRATION_SCOPE. All four are unit-observable at the
module boundary, and the AC4 pair is deliberately a unit-level call-log
assertion rather than an end-to-end one (see §7.0(c)).*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
  - `CANVAS_DOC_PREFIX` module-private at `canvas-sync.ts:93`; six doc-id sites each building
    `` `${CANVAS_DOC_PREFIX}${path}` `` by hand (`getCanvasDocHandle`, `getCanvasSnapshot`,
    `subscribe`, `unsubscribe`, `handleLocalModify`, `destroy`).
  - `background-sync.ts` `setActiveFile` (`:195`, not `:173`) and `editor/collab.ts:62` both
    call `getDoc(<vault path>)` unguarded. The file header of `background-sync.ts` explicitly
    justified `setActiveFile` on a REACHABILITY argument, which AC4 rejects.
  - `migrateV1ToV2`'s one-shot marker was "`meta` is non-empty", i.e. armed by the identity
    stamp AC1 requires.
  - ~40 pre-existing test files address canvas docs as `__canvas__:<path>` and never inject an
    identity store.
- **Approach:**
  - Identity as an INJECTED capability (`setIdentityStore`), mirroring WP24's `SidecarIO` seam.
    With a store: guid-addressed docs + `meta` stamp + the mixed-version refusal. Without one:
    the canonical path is the identity token, which reproduces the pre-WP27 id byte for byte
    through the same single constructor — so no pre-existing test needed editing.
  - `canvasDocId(guid)` as the sole constructor, throwing on a blank guid; every one of the six
    sites routed through a private `canvasDocIdFor(path)`.
  - Two independent defences against the tp11 stranding: stamp AFTER the host seed, AND teach
    the migration marker to ignore the three identity keys (`hasSchemaClaim`). The ordering
    alone does not cover `coldOpen`'s `seeded-from-file` branch, which runs after subscribe
    returns.
  - Rename as a metadata update: re-key every path-keyed structure, re-point the observer
    through a mutable path cell, re-stamp `meta.path`, then `bind(new)` → `unbind(old)`.
  - Both guards placed immediately BEFORE their `getDoc`, using the shared `skipsAutoTextSync`
    predicate rather than a private `.canvas` test.
- **Fallback path if all attempts fail:** not needed — attempt 1 passed 54/54 on its first run.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. 54/54 visible tests green (baseline 8 green, all 8 still
  green); `tsc --noEmit -skipLibCheck` clean; WP24 (76) and WP26 (46) unchanged. Full suite
  1524 total / 1522 pass (baseline 1478 pass, 46 fail).
- **What remains open:**
  1. **Licence request.** `w4-canvas-integrity.test.ts` `M1` (`:1597`) and `K5` (`:1666`) are W4
     characterisations asserting AC4's two guards do NOT exist. AC4 and those assertions are
     mutually exclusive. WP27 is on neither the licensed-deletion nor the licensed-amendment
     list, so both were left untouched and are red. Requested remedy: INVERT them, do not
     delete — inverted they become an independent second pin on AC4.
  2. **Production wiring, handed to WP25.** `setIdentityStore` has no production caller.
     `createCanvasIdentityStore` needs a `SidecarIO` adapter that does not exist yet, and
     wiring manifest-only would drop a guest that subscribes before the host's manifest entry
     replicates into the R10 text fallback with no retry. WP25 should add
     `setIdentityStore(...)` in `main.ts` and `handleRename(...)` in the `vault-events.ts`
     rename handler.
- **Final status:** `DONE` for WP27's own scope, with the two items above escalated to Worker 3
  Core. Full detail in `ImplementationReport_WP27.md`.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
