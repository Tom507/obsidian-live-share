# Task Charter — WP24: Sidecar store core

**Charter Status:** `DONE`
**WP:** WP24
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP8
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a doc's causal history survives the process.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C24 — Sidecar store core** (work package WP24); phase **P2**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: create (headless module with injected I/O)
  - Responsibility: give each doc a durable, append-only update history outside the shared vault scope.
  - Scope summary: append/checkpoint/truncate/load, corrupt tolerance
- **Out of scope / non-goals:**
  - Wiring the store into the doc lifecycle — WP25.
  - Excluding the files from manifest/sync — WP26.
  - The relay-side blob store — WP41 (a separate, composable layer).
- **Known interfaces / dependencies:**
  - Input: encoded Yjs updates; injected file I/O
  - Output: `.obsidian/liveshare/state/<guid>.yhistory`, `<guid>.ycheckpoint`, and an `index.json` mapping
  - Depends on work packages: WP8
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "replica restart" op — a replica that unloads and reloads from its sidecar must converge identically to one that stayed online for the whole run.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Sidecar store core
- **Interfaces involved:**
  - Input: encoded Yjs updates; injected file I/O
  - Output: `.obsidian/liveshare/state/<guid>.yhistory`, `<guid>.ycheckpoint`, and an `index.json` mapping
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
  - CONCEPT_V2 Teil 7 — the sidecar log, its file names and the compaction/truncation rule
  - `plugin/src/files/canvas-persistence.ts:47–60`, `:61–66`, `:420–430` — `PersistenceIO`, `PersistenceScheduler`, `PersistenceGuards`: the established injected-IO pattern to follow
  - `plugin/src/files/canvas-persistence.ts:431–454` — `createVaultPersistenceIO`
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C24. No paraphrasing.*

1. The module appends encoded updates to `<guid>.yhistory`, writes a full-state checkpoint to `<guid>.ycheckpoint`, and truncates the history only after the checkpoint is durably written — never the reverse order.
2. Loading reconstructs a doc from checkpoint + history such that its state equals the state before unload, and loading is idempotent.
3. A missing, truncated or corrupt sidecar is a defined degradation: loading yields an empty-but-valid result and reports the degradation, never throws and never leaves a partially applied doc.
4. All file I/O is injected; the module imports neither Obsidian nor `node:fs` directly.

**Definition of Done:** a doc's causal history survives the process.

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
  - a new sidecar module under `plugin/src/files/`
- **Required report:** `ImplementationReport_WP24.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Module under test (create-path, does not exist yet): `plugin/src/files/canvas-sidecar.ts`.

### 7.0 — BINDING API surface for the Coder Sub-Agent

The names, signatures and the on-disk format below are **binding**. WP25, WP26, WP27 and
WP29 import from this module (Shared Ownership Contract §1) and must never re-spell a
constant, re-derive a path or re-implement the framing. The names in §1 of the contract
(`SIDECAR_DIR`, the three extensions/filenames, `isSidecarPath`, the three path helpers,
`SidecarIO`, `SidecarStore`, `SidecarLoadResult`) were pinned before this suite existed and
are reproduced here unchanged; everything else on this page is pinned by this suite.

```ts
// plugin/src/files/canvas-sidecar.ts
// AC4: `yjs` and relative modules are the ONLY permitted imports.
import type * as Y from "yjs";

// ── constants ───────────────────────────────────────────────────────────────
export const SIDECAR_DIR = ".obsidian/liveshare/state";
export const SIDECAR_HISTORY_EXT = ".yhistory";
export const SIDECAR_CHECKPOINT_EXT = ".ycheckpoint";
export const SIDECAR_INDEX_FILENAME = "index.json";

// ── paths ───────────────────────────────────────────────────────────────────
export function sidecarHistoryPath(guid: string): string;    // `${DIR}/${guid}${HISTORY_EXT}`
export function sidecarCheckpointPath(guid: string): string; // `${DIR}/${guid}${CHECKPOINT_EXT}`
export function sidecarIndexPath(): string;                  // `${DIR}/${INDEX_FILENAME}`

/**
 * True iff `path` names a FILE inside SIDECAR_DIR, at any depth, with any
 * extension (`index.json` included). Directory-prefix test on a `/` boundary —
 * NOT an extension test. `\` is normalised to `/` and one leading `./` or `/`
 * is stripped before the comparison; the comparison is case-SENSITIVE. The
 * directory itself, a trailing-slash form of it, and any path that merely
 * *contains* the directory further in (`notes/.obsidian/liveshare/state/x`) are
 * all false. WP26 calls this; it never writes its own prefix/suffix test.
 */
export function isSidecarPath(path: string): boolean;

// ── the injected I/O seam (AC4) ─────────────────────────────────────────────
/**
 * Every promise resolves only once the effect is DURABLE. `read` rejects if the
 * path does not exist — the store must therefore confirm with `exists` first.
 * `truncate` reduces the file to zero bytes and leaves it in place; `remove`
 * unlinks it.
 */
export interface SidecarIO {
  ensureDir(dirPath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  read(filePath: string): Promise<Uint8Array>;
  write(filePath: string, data: Uint8Array): Promise<void>;
  append(filePath: string, data: Uint8Array): Promise<void>;
  truncate(filePath: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}

// ── the degradation report (AC3) ────────────────────────────────────────────
export const SIDECAR_DEGRADATION = {
  NONE: "none",
  MISSING: "missing",
  TRUNCATED: "truncated",
  CORRUPT: "corrupt",
} as const;
export type SidecarDegradation =
  (typeof SIDECAR_DEGRADATION)[keyof typeof SIDECAR_DEGRADATION];

export interface SidecarLoadResult {
  readonly degradation: SidecarDegradation;
  readonly checkpointApplied: boolean;
  readonly historyEntriesApplied: number;
  /** Human-readable only. Never an oracle, never parsed by a consumer. */
  readonly detail?: string;
}

export function isSidecarDegraded(result: SidecarLoadResult): boolean; // degradation !== NONE

/** Transaction origin of the single `Y.applyUpdate` that `load` performs. */
export const SIDECAR_LOAD_ORIGIN: unique symbol;

// ── index.json ──────────────────────────────────────────────────────────────
/** guid → vault-relative canvas path. WP27 owns what the mapping MEANS; WP24
 *  owns the file, its JSON encoding and its degradation behaviour. */
export type SidecarIndex = Record<string, string>;

// ── the store ───────────────────────────────────────────────────────────────
export interface SidecarStore {
  append(guid: string, update: Uint8Array): Promise<void>;
  checkpoint(guid: string, doc: Y.Doc): Promise<void>;
  load(guid: string, doc: Y.Doc): Promise<SidecarLoadResult>;
  truncate(guid: string): Promise<void>;
  readIndex(): Promise<SidecarIndex>;
  writeIndex(index: SidecarIndex): Promise<void>;
}

export function createSidecarStore(io: SidecarIO): SidecarStore;
```

**On-disk format (pinned — the tests encode and decode it independently):**

```text
<guid>.yhistory     := frame*
frame               := u32 BIG-ENDIAN payloadByteLength || payload
<guid>.ycheckpoint  := the raw bytes of Y.encodeStateAsUpdate(doc), UNFRAMED
<dir>/index.json    := UTF-8 JSON.stringify of a flat string→string object
```

**Semantics (pinned):**

- `append(guid, update)` — `ensureDir(SIDECAR_DIR)`, then exactly ONE `io.append` of one
  frame to `sidecarHistoryPath(guid)`. Never read-modify-write, never `io.write` on the
  history path. **The input bytes are snapshotted synchronously, before the first `await`**
  (the caller's `Uint8Array` may be a pooled socket buffer — this project has already been
  bitten by the same defect in the relay blob store).
- `checkpoint(guid, doc)` — encodes `Y.encodeStateAsUpdate(doc)` **synchronously, before its
  first `await`**; then `io.write(sidecarCheckpointPath(guid), state)`; then, and only after
  that promise has resolved, `truncate(guid)`. The two effects are never issued
  concurrently and never in the reverse order. If the write rejects, the history is left
  untouched and the rejection propagates.
- `truncate(guid)` — `io.truncate(sidecarHistoryPath(guid))`; safe on an absent file.
- The store **serialises `append` / `checkpoint` / `truncate` per guid**, so no append can
  land between a checkpoint's encode and its truncate.
- `load(guid, doc)` — reads the checkpoint (if `exists`) and the history (if `exists`),
  validates ALL of it, and only then applies it to `doc` in ONE `Y.applyUpdate(doc, …,
  SIDECAR_LOAD_ORIGIN)`. `load` never writes, never creates and never repairs a file, and
  never throws for any byte sequence. Verdicts:
  | condition | `degradation` |
  |---|---|
  | neither file exists | `MISSING` |
  | checkpoint file exists but is empty or Yjs refuses it | `CORRUPT` |
  | history tail is an incomplete frame header or a short payload | `TRUNCATED` |
  | a complete frame declares length 0, or Yjs refuses its payload | `CORRUPT` |
  | otherwise | `NONE` |
  The checkpoint is judged first; its verdict wins. **On any verdict other than `NONE`
  nothing at all is applied** — `checkpointApplied: false`, `historyEntriesApplied: 0`, no
  update event on `doc`, and the doc's own pre-existing content is left exactly as it was.
  An empty (zero-byte) *history* is not a degradation: it is a compacted sidecar.
- `readIndex()` — missing, empty, unparseable or non-object JSON all yield `{}`; non-string
  values are dropped; it never throws and never writes. `writeIndex(index)` — `ensureDir`,
  then one `io.write` of the whole document (never `append`), and IO failures propagate.

No other export is licensed. AC3's "never throws" is a claim about `load` and `readIndex`;
`append`, `checkpoint`, `truncate` and `writeIndex` propagate IO failures.

### TC1 — sidecar constants, path helpers and the `isSidecarPath` predicate
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp24/test_tp01_path_and_predicate_contract_visible.test.ts
- What it checks: the four constants equal the literals the BUILD_SPEC's C24 interface line states, the three helpers compose them without a second spelling, and `isSidecarPath` is a `/`-boundary directory test that accepts unknown extensions and nested files while rejecting the directory itself and prefix-sharing siblings such as `.obsidian/liveshare/stateful/`.
- Test data channel: fixture (literal paths from the BUILD_SPEC plus a curated near-miss corpus)

### TC2 — the history file is append-only
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp24/test_tp02_append_is_append_only_visible.test.ts
- What it checks: each appended update becomes one frame in call order and byte-for-byte, a later append never rewrites the earlier prefix, the history path is reached by `io.append` and by nothing else (no read-modify-write), and `ensureDir` completes before the first append.
- Test data channel: deterministic generator (updates emitted by a real `Y.Doc`)

### TC3 — the checkpoint is durable before the history is truncated
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp24/test_tp03_checkpoint_before_truncate_order_visible.test.ts
- What it checks: with the injected `write` held open, no truncate has been issued and the history is still intact; after release the recorded sequence is exactly `write:start, write:end, truncate:start, truncate:end`; and a failing checkpoint write leaves the history untouched.
- Test data channel: deterministic generator + an instrumented IO seam that records the call sequence and can block one operation

### TC4 — the checkpoint carries the whole state, not a delta
- Verifies AC: AC1, AC2
- Test file: plugin/src/__tests__/v2/wp24/test_tp04_checkpoint_is_full_state_visible.test.ts
- What it checks: after compaction a brand-new `Y.Doc` loaded from the sidecar equals the checkpointed doc, the checkpoint bytes alone rebuild the records, updates appended after the checkpoint are replayed on top of it, and a second compaction replaces the first without loss.
- Test data channel: deterministic generator (real `Y.Doc` updates)

### TC5 — load reconstructs the pre-unload state
- Verifies AC: AC2
- Test file: plugin/src/__tests__/v2/wp24/test_tp05_load_reconstructs_pre_unload_state_visible.test.ts
- What it checks: history-only and checkpoint-plus-tail both rebuild a replica with the same state vector and the same observable content (including a delete), the reloaded replica still converges with a peer that stayed online, and the reconstruction lands as ONE transaction stamped `SIDECAR_LOAD_ORIGIN`.
- Test data channel: deterministic generator (creates, an edit, a delete, an edge)

### TC6 — loading is idempotent
- Verifies AC: AC2
- Test file: plugin/src/__tests__/v2/wp24/test_tp06_load_is_idempotent_visible.test.ts
- What it checks: a second load changes neither the doc nor the reported result, `load` writes nothing at all (both sidecar files byte-identical afterwards), two independent fresh docs agree, and an unrelated local edit made between two loads survives the second one.
- Test data channel: deterministic generator

### TC7 — a missing sidecar is a defined degradation
- Verifies AC: AC3
- Test file: plugin/src/__tests__/v2/wp24/test_tp07_missing_sidecar_degradation_visible.test.ts
- What it checks: no throw, `degradation === MISSING`, an empty-but-valid result, the doc untouched and still usable, no file created while looking, and — the discriminating case — an empty-but-present history reported as `NONE` rather than `MISSING`.
- Test data channel: fixture (an empty fake disk)

### TC8 — a truncated history is a defined degradation
- Verifies AC: AC3
- Test file: plugin/src/__tests__/v2/wp24/test_tp08_truncated_history_degradation_visible.test.ts
- What it checks: both tear shapes (incomplete header, payload past end-of-file) report `TRUNCATED` and apply nothing, every prefix of a valid history is either `NONE` or `TRUNCATED` and never throws, a positive control proves the good frames were applicable, and the verdict is a report rather than a latch.
- Test data channel: deterministic generator + byte-level fixture surgery

### TC9 — corrupt bytes are a defined degradation
- Verifies AC: AC3
- Test file: plugin/src/__tests__/v2/wp24/test_tp09_corrupt_bytes_degradation_visible.test.ts
- What it checks: a complete frame with a garbage payload, a plain-text history, a zero-length frame, a garbage checkpoint and a zero-length checkpoint all report `CORRUPT` and apply nothing; the fixtures' premise (Yjs really refuses these bytes) is asserted in the test; and the corrupt file is neither repaired nor deleted.
- Test data channel: fixture (byte constants, each verified against `Y.applyUpdate` in the test itself)

### TC10 — a failed load leaves no partially applied doc
- Verifies AC: AC3
- Test file: plugin/src/__tests__/v2/wp24/test_tp10_no_partial_application_visible.test.ts
- What it checks: three good frames followed by a garbage fourth leave the doc with none of the three — zero update events, unchanged state vector — while a positive control proves those three carried real content; a doc with pre-existing content keeps exactly that content; a good checkpoint with a corrupt history applies neither; and the same holds for a torn tail.
- Test data channel: deterministic generator + a poisoned frame at a chosen position

### TC11 — index.json round trip and degradation
- Verifies AC: AC3
- Test file: plugin/src/__tests__/v2/wp24/test_tp11_index_degradation_and_round_trip_visible.test.ts
- What it checks: `writeIndex`/`readIndex` round-trip through one `io.write` (never `append`) and a second write replaces rather than merges; a missing, half-written, wrongly-shaped or empty index degrades to `{}` without throwing; non-string values are dropped; and a corrupt index is left on disk rather than silently overwritten.
- Test data channel: fixture (a curated set of malformed JSON payloads)

### TC12 — all I/O is injected; the module imports neither Obsidian nor node:fs
- Verifies AC: AC4
- Test file: plugin/src/__tests__/v2/wp24/test_tp12_injected_io_module_purity_visible.test.ts
- What it checks: a scan of the module's own source (the repo's established oracle for purity claims) permits only `yjs` and relative imports and rejects every Obsidian, filesystem, host-global and clock token; plus a behavioural leg in which a store built over an IO whose methods all throw can perform no work of its own.
- Test data channel: fixture (the module source read at test time) + an exploding IO double

### TC13 — append snapshots its input before the first await
- Verifies AC: AC1
- Test file: plugin/src/__tests__/v2/wp24/test_tp13_append_snapshots_input_before_await_visible.test.ts
- What it checks: a caller buffer mutated between the call and the awaited resolution does not corrupt the stored frame, the stored bytes still decode to the original update, two appends over one reused buffer keep their own bytes, and the written frame matches the pinned framing.
- Test data channel: deterministic generator + a simulated pooled/recycled caller buffer

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* All four acceptance criteria are unit-testable at this WP's own seam:
the I/O is injected by AC4, the CRDT side uses real `Y.Doc`s, and AC4's structural half is
checked against the module source. No AC requires a running system or a second component.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `plugin/src/files/canvas-sidecar.ts` did not exist; the 13 visible test files under `plugin/src/__tests__/v2/wp24/` all failed to resolve the import. No doc history survived a process restart.
- **Approach:** create the module exactly to the §7.0 contract block — zero-import-except-`yjs` core over the injected `SidecarIO` seam, `u32BE`-framed append-only history, full-state `Y.encodeStateAsUpdate` checkpoint written and awaited before `io.truncate`, and an all-or-nothing `load` that validates checkpoint + every frame against a throwaway probe `Y.Doc` before applying the whole reconstruction to the caller's doc in one `Y.applyUpdate(..., SIDECAR_LOAD_ORIGIN)` via `Y.mergeUpdates`. Mutating operations (and `load`) are serialised per guid through a promise chain so no append can land between a checkpoint's encode and its truncate.
- **Fallback path if all attempts fail:** not needed — attempt 1 landed 76/76 visible tests green with a clean `tsc`.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. `plugin/src/files/canvas-sidecar.ts` created; the §7.0 API surface is exported verbatim and nothing else. Visible suite 76/76 PASS, `npx tsc --noEmit -skipLibCheck` clean, full plugin suite 1424 passed / 0 failed / 244 files (0 pre-existing tests red). Per-guid serialisation implemented and falsified by a temporary counterfactual (reverted). Report: `ImplementationReport_WP24.md`.
- **What remains open:** nothing in scope. WP25 wires the store into the doc lifecycle and owns `SIDECAR_COMPACTION_*`; WP26 imports `isSidecarPath`; WP27 owns what `index.json`'s mapping means. Two behaviours are wider than the pinned semantics and are called out in the report: `load` also runs on the per-guid queue, and `checkpoint`/`writeIndex` call `ensureDir` before writing.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
