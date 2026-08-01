# Task Charter — WP42: Client checkpoint + replay

**Charter Status:** `DONE`
**WP:** WP42
**Phase:** P6
**task_mode:** `standard`
**Depends on:** WP41
**W4 Test Targets:** `2`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** "a brand-new client enters an empty room" is covered, and neither persistence layer depends on the other.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C42 — Client-side checkpoint frame and replay handling** (work package WP42); phase **P6**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`plugin/src/sync/mux-protocol.ts`, `plugin/src/sync/sync.ts`)
  - Responsibility: emit checkpoints and consume replays on the client side.
  - Scope summary: checkpoint frame, replay-before-live, graceful fallback
- **Out of scope / non-goals:**
  - Changing the meaning or encoding of any existing frame type.
  - Requiring a blob-capable relay; the client must degrade gracefully.
  - Replacing the sidecar; the two layers compose.
- **Known interfaces / dependencies:**
  - Input: doc state and relay replay frames
  - Output: a checkpoint frame; a doc brought up to date before live traffic
  - Depends on work packages: WP41
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "replay + sidecar" composition — a replica restored from a replay, from a sidecar, or from both must reach the same state, with no update applied twice in effect.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Client-side checkpoint frame and replay handling
- **Interfaces involved:**
  - Input: doc state and relay replay frames
  - Output: a checkpoint frame; a doc brought up to date before live traffic
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
  - **Schema impact:** No doc schema change. Adds a checkpoint frame type to the mux protocol; every existing frame type keeps its meaning and encoding, and a relay or client without blob support must keep working (graceful fallback).
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
  - `plugin/src/sync/mux-protocol.ts` (35 L) — the client frame definitions
  - `plugin/src/sync/sync.ts:200–252` (`getDoc`), `:253–280` (`releaseDoc`), `:281–312` (`waitForSync`)
  - `plugin/src/sync/sync.ts:87–94` — `DocHandle`
  - the sidecar module from WP24 (the composing layer)
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C42. No paraphrasing.*

1. The client can emit a checkpoint frame carrying the full state as one update, on a documented trigger, and the frame is wire-compatible with the existing mux protocol (no breaking change to existing frame types).
2. Replayed frames are applied before live traffic is processed, and the client's resulting state is identical whether it received a replay or synced from a live peer.
3. A relay without blob support (older deployment) still works: the client detects the absence and falls back to the sidecar + peer path with no error surfaced to the user.
4. Sidecar and relay persistence compose — either alone is sufficient, and both together produce no duplicate application.

**Definition of Done:** "a brand-new client enters an empty room" is covered, and neither persistence layer depends on the other.

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
  - `plugin/src/sync/mux-protocol.ts`
  - `plugin/src/sync/sync.ts`
- **Required report:** `ImplementationReport_WP42.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

Seven test points, all headless and pure: no WebSocket, no Obsidian, no clock, no
`setTimeout`, no wall-clock sleep. Real Yjs is used wherever state equality is the claim;
the oracle is always encoded doc state or a deterministic map/text snapshot, never a log
string. Test files live under `workflowArtifacts/canvas-v2/tests/visible/WP42/` and are
staged into `plugin/src/__tests__/<one-level-dir>/` before running (`../../sync/...` import
depth). **Runner note:** Vitest 4.0.18 has no `--include` CLI flag and `test_*_visible.ts`
does not match the default `*.test.ts` include glob — stage with a `test.include` entry or
rename on copy.

> **Verified before handover:** all 21 WP42 test files (7 visible + 14 blind, 117 assertions)
> were executed against a throwaway reference implementation of the contract below —
> 117/117 pass, `tsc -noEmit` clean under the plugin's own `strict` options. Removing the
> barrier mechanism at source (not through the seam) fails 32 tests across 9 files, so the
> discrimination requirement is satisfied by construction rather than by assertion.

### TC1 — Checkpoint emission on a documented trigger, carrying the full state as one update
- Verifies AC: AC1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP42/test_checkpoint_emit_visible.ts
- What it checks: `shouldEmitCheckpoint` fires on the documented sole-peer/threshold triggers, and the frame produced from `Y.encodeStateAsUpdate(doc)` (body = `varUint upToSeq` + opaque tail) decodes back into a fresh doc whose snapshot equals the source — collapsing a five-delta history into one frame.
- Test data channel: fixture (a two-node/one-edge canvas doc) + deterministic generator (five scripted geometry edits)

### TC2 — Wire compatibility: no existing frame type changes meaning or encoding
- Verifies AC: AC1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP42/test_wire_compat_visible.ts
- What it checks: `MUX_SYNC`=0 … `MUX_PONG`=10 keep their numbers, `MUX_CHECKPOINT`=11 and `MUX_REPLAY_END`=12 are distinct and one-byte, `5` stays unclaimed, and `encodeMuxMessage`/`decodeMuxMessage` still produce the golden bytes plus byte-exact agreement with an independent lib0 reference encoder for every existing type.
- Test data channel: fixture (golden byte arrays `[0,9]` and `[5,100,111,99,45,49,2]`) + deterministic generator (reference encoder over the ten existing types)

### TC3 — An older peer/relay that does not understand the new type is unaffected
- Verifies AC: AC1, AC3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP42/test_unknown_type_tolerance_visible.ts
- What it checks: a pre-WP42 dispatcher fed a checkpoint frame and a replay-end marker throws nothing, surfaces no error, keeps processing the frames that follow, and `decodeCheckpointFrame` returns `null` for every existing type, for `MUX_REPLAY_END` and for any future type rather than misreading it.
- Test data channel: deterministic generator (frame streams over the fixed type table)

### TC4 — The replay batch is a barrier: nothing reaches the doc until it closes (DISCRIMINATION test point)
- Verifies AC: AC2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP42/test_replay_before_live_visible.ts
- What it checks: WP41 replays stored frames under their ORIGINAL msgType, so the client cannot separate replay from live by type; the gate therefore holds the whole batch until `MUX_REPLAY_END`, releases it at once in arrival order, never forwards the marker, records `lastSeq`, and lets everything after the barrier through — and, named `DISCRIMINATION — with enabled:false frames reach the doc mid-batch`, that the barrier disappears once the gate is switched off through its injected `{ enabled: false }` seam.
- Test data channel: deterministic generator (tagged single-byte frames, order-recorded)

### TC5 — Replay state is identical to live-peer state
- Verifies AC: AC2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP42/test_replay_equals_live_peer_visible.ts
- What it checks: a brand-new client restored from a relay batch (a stored delta stream, or one compacted checkpoint, or with live traffic following the barrier) reaches exactly the doc snapshot of a peer that was present throughout.
- Test data channel: deterministic generator (a four-transaction authored history on one peer)

### TC6 — A relay without blob support still works, with no user-visible error
- Verifies AC: AC3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP42/test_no_blob_support_fallback_visible.ts
- What it checks: a blob-capable relay is recognised by its `MUX_REPLAY_END` marker (present even with `lastSeq = 0`, so "empty store" is distinguishable from "no support"); on a legacy relay the marker never arrives and the optimistic barrier is closed by `endReplay(doc, "unsupported")`, which releases every buffered frame in arrival order with `fallback: true`, `lastSeq: null`, nothing thrown, no checkpoint emitted into a relay that cannot store it, and the sidecar-only path still reconstructs the full doc.
- Test data channel: fixture (hand-built `MUX_REPLAY_END` bodies for the capable-but-empty and legacy relay shapes)

### TC7 — Sidecar and relay persistence compose with no duplicate application
- Verifies AC: AC4
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP42/test_sidecar_replay_compose_visible.ts
- What it checks: replay-only, sidecar-only and both-together converge to the identical doc snapshot; with both sources each byte-identical update reaches the doc exactly once (`applied + skippedDuplicates == sidecarCount + replayCount`); and the convergence still holds with dedupe switched off, so the "no double application in effect" claim rests on the CRDT and not on the optimisation.
- Test data channel: deterministic generator (three-transaction authoritative history, injected as `Uint8Array[]` for both layers)

> **Sidecar note (WP24/WP25):** the sidecar does not exist yet and is deliberately **not**
> imported. At this seam it is exactly an injectable array of prior `Uint8Array` updates,
> which is what `applyRecoveredUpdates` takes. No file under `plugin/src/files/` is created
> or referenced by any WP42 test.

### Required API surface (contract for the coder)

All of the following are **new exports of `plugin/src/sync/mux-protocol.ts`**. They are pure:
zero new imports beyond the `lib0/encoding` + `lib0/decoding` the file already has — no Yjs,
no Obsidian, no clock, no filesystem (precedent: `plugin/src/canvas/reconcile-plan.ts`).
`plugin/src/sync/sync.ts` only *wires* them; it exports nothing new that the tests import.

> **Cross-WP binding:** the frame numbers and body layouts are **fixed by WP41**
> (`server/src/mux-protocol.ts`, charter already `TESTS_ADDED`). The client mirrors them
> exactly; the two `mux-protocol.ts` files are byte-parallel today and must stay so.
> Changing either number is a protocol break and an ESCALATE.

**Frame-type constants**

```ts
export const MUX_CHECKPOINT = 11;
export const MUX_REPLAY_END = 12;
```

`11`/`12` are WP41's choice (the first two free numbers above `MUX_PONG = 10`). `5` is also
unused — the gap between `MUX_SUBSCRIBED = 4` and `MUX_SYNC_REQUEST = 6` — and would keep the
range dense, but WP41 has already pinned 11/12 in its own tests, and an interop mismatch is
strictly worse than a hole. Both stay below 128, so the `writeVarUint` msgType remains one
byte and **no existing frame grows**. `5` is deliberately left unclaimed (asserted by TC2).

**Frame bodies (mirrors of the WP41 server helpers)**

```ts
/** varUint upToSeq, then the opaque tail verbatim — the relay never decodes the tail. */
export function encodeCheckpointBody(upToSeq: number, payload: Uint8Array): Uint8Array;
export function decodeCheckpointBody(body: Uint8Array): { upToSeq: number; payload: Uint8Array };
/** varUint lastSeq. Must not throw: an empty/garbled body degrades to { lastSeq: 0 }. */
export function encodeReplayEndBody(lastSeq: number): Uint8Array;
export function decodeReplayEndBody(body: Uint8Array): { lastSeq: number };
```

**Checkpoint frame codec**

```ts
export interface CheckpointFrame {
  docId: string;
  upToSeq: number;      // everything up to this relay seq may be truncated
  update: Uint8Array;   // full doc state as ONE update (Y.encodeStateAsUpdate)
}

export function encodeCheckpointFrame(docId: string, upToSeq: number, stateUpdate: Uint8Array): Uint8Array;
export function encodeReplayEndFrame(docId: string, lastSeq: number): Uint8Array;
/** null for any other msgType AND for any buffer that fails to parse — never throws. */
export function decodeCheckpointFrame(data: Uint8Array): CheckpointFrame | null;
```

**Documented emission trigger**

```ts
export const CHECKPOINT_UPDATE_THRESHOLD = 64;   // update count, NOT a timing constant
export type CheckpointTriggerReason = "sole-peer-sync" | "update-threshold" | "release";
export interface CheckpointTrigger {
  reason: CheckpointTriggerReason;
  peerCount: number;
  updatesSinceCheckpoint: number;
  hasLocalState: boolean;
  relayBlobSupport: boolean;
}
export function shouldEmitCheckpoint(trigger: CheckpointTrigger): boolean;
```

Rules: `false` if `!relayBlobSupport` or `!hasLocalState`; then
`sole-peer-sync` → `peerCount === 0`; `update-threshold` → `updatesSinceCheckpoint >= CHECKPOINT_UPDATE_THRESHOLD`;
`release` → `updatesSinceCheckpoint > 0`. The `upToSeq` to emit is `gate.lastSeq(docId) ?? 0`.

**Replay barrier (the AC2 mechanism)**

WP41 replays each stored frame with its **original** msgType (`MUX_SYNC`,
`MUX_SYNC_ENCRYPTED`, …) and terminates the batch with exactly one `MUX_REPLAY_END`, even
when nothing was stored (`lastSeq = 0`). Replay and live frames are therefore
**indistinguishable by type**, so the client mechanism is a readiness **barrier**, not a type
filter: nothing reaches the doc until the batch is complete.

```ts
export interface GatedFrame { docId: string; msgType: number; payload: Uint8Array; }
export type ReplayEndReason = "replay-end" | "unsupported";
export interface ReplayRelease {
  frames: GatedFrame[];   // everything buffered during the batch, in arrival order
  reason: ReplayEndReason;
  lastSeq: number | null; // from the marker; null when the batch ended without one
  buffered: number;
  fallback: boolean;      // reason === "unsupported"
}
export interface ReplayGate {
  beginReplay(docId: string): void;          // idempotent; a repeat keeps one batch + buffer
  accept(frame: GatedFrame): GatedFrame[];   // the frames to process NOW, in order
  endReplay(docId: string, reason?: ReplayEndReason): ReplayRelease;
  isReplaying(docId: string): boolean;
  bufferedCount(docId: string): number;
  lastSeq(docId: string): number | null;     // survives the batch; feeds the next checkpoint
}
/** `enabled` is the injected discrimination seam; default true. */
export function createReplayGate(options?: { enabled?: boolean }): ReplayGate;
```

`accept` while a batch is open for `frame.docId`: `MUX_REPLAY_END` closes it, records
`lastSeq`, is **not** forwarded, and returns the whole buffer in arrival order; every other
frame is buffered and returns `[]`. With no open batch, or with `enabled: false`, every frame
(including a stray marker) passes straight through. `endReplay` on an unknown doc is a no-op.

**Sidecar + replay composition**

```ts
export interface RecoverySources {
  sidecar?: readonly Uint8Array[];   // WP24/WP25 prior updates — injected, never imported
  replay?: readonly Uint8Array[];    // relay blobs, in relay order
}
export interface RecoveryReport {
  applied: number; skippedDuplicates: number;
  sidecarCount: number; replayCount: number; recovered: boolean;
}
/** Sidecar first, then replay. `apply` is the injected doc writer (Y.applyUpdate). */
export function applyRecoveredUpdates(
  apply: (update: Uint8Array) => void,
  sources: RecoverySources,
  options?: { dedupe?: boolean },    // default true: skip byte-identical updates
): RecoveryReport;
```

**Wiring expected in `plugin/src/sync/sync.ts`** (not directly asserted by these unit tests —
see 7b): `handleSubscribed` calls `gate.beginReplay(docId)`; `handleMessage` routes every
inbound frame through `gate.accept` before the existing switch and dispatches each returned
frame through the normal path; `MUX_CHECKPOINT` is handled by applying
`decodeCheckpointFrame(...).update` as a Yjs update; `MUX_REPLAY_END` is consumed by the gate
and never reaches the switch. **Legacy-relay fallback (AC3):** a blob-capable relay always
sends the marker, a legacy one never does, so the barrier is closed with
`gate.endReplay(docId, "unsupported")` from the existing sync-completion path
(`setSynced(docId, true)`) — **no timer and no new timing constant**; `relayBlobSupport` for
`shouldEmitCheckpoint` is then simply `gate.lastSeq(docId) !== null`. Emission uses
`encodeCheckpointFrame(docId, gate.lastSeq(docId) ?? 0, Y.encodeStateAsUpdate(doc))` on the
`releaseDoc` / sole-peer-sync triggers. `MUX_CHECKPOINT` and `MUX_REPLAY_END` must be added to
`sendMux`'s non-encrypted passthrough branch; a checkpoint carries a Yjs update, so an E2E
room must either encrypt it or not emit it — if that interaction is unclear, ESCALATE rather
than guess.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

Two residues that a pure unit test cannot reach, because they require the live
`SyncManager` + WebSocket + relay path rather than the injected seams above.

1. **AC2 (wiring residue) — INTEGRATION_SCOPE.** The pure gate is unit-tested, but *that
   `SyncManager` actually consults it* is not: verify over a real (or harness) socket that
   `handleSubscribed` calls `beginReplay` with the relay-announced count and that
   `handleMessage` routes every frame through `gate.accept` **before** `handleSync` /
   `handleAwareness`, so a live `MUX_SYNC` arriving mid-replay is genuinely deferred.
   Oracle: the resulting `Y.Doc` state of a newcomer versus a peer present throughout.
2. **AC3 (deployment residue) — INTEGRATION_SCOPE.** Against an actual pre-WP41 relay:
   the client detects the absence of blob support, completes over the sidecar + peer path,
   and surfaces **no** user-visible error (no `Notice`, no banner, no console error).
   Requires a running older relay deployment; the "no error surfaced" half is also partly
   HUMAN_OBSERVABLE at delivery.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** `plugin/src/sync/mux-protocol.ts` was the pre-WP42 35-line
  file (ten frame types, `encodeMuxMessage`/`decodeMuxMessage`). `SyncManager.handleMessage`
  decoded a frame and dispatched it straight into a switch, so anything the relay replayed was
  applied the moment it arrived and nothing distinguished a stored frame from live traffic.
  No checkpoint was ever emitted, so a relay with WP41 blob support kept the full delta
  history forever.
- **Approach:**
  1. `mux-protocol.ts` gained the WP41-mirrored constants (`11`/`12`), the four body codecs,
     the checkpoint frame codec, the `shouldEmitCheckpoint` trigger, the `createReplayGate`
     barrier and `applyRecoveredUpdates` — all pure, still importing only `lib0/encoding` and
     `lib0/decoding`. The pre-WP42 half of the file is untouched, so the golden bytes hold.
  2. `sync.ts` wires them: `handleSubscribed` opens the barrier before anything for that doc
     can arrive; `handleMessage` routes every frame through `gate.accept` and dispatches the
     released ones through the extracted `dispatchFrame` (the old switch, plus a
     `MUX_CHECKPOINT` case); `setSynced(docId, true)` closes an unterminated batch with
     `endReplay(docId, "unsupported")`; `releaseDoc` and the update counter drive emission.
  3. Wire evidence beats the charter sketch on one point: WP41 stores the checkpoint's opaque
     TAIL (`ws-handler.handleCheckpoint` → `blobStore.checkpoint(..., body)`), so a replayed
     checkpoint arrives as a bare Yjs update, not an enveloped body. `handleCheckpoint`
     therefore applies the payload directly and falls back to the enveloped form, silently.
  4. Two interactions the charter flagged as "ESCALATE rather than guess" were resolved by
     taking the option it names rather than inventing one — see section 9.
- **Fallback path if all attempts fail:** not needed; all 44 visible assertions pass.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** AC1–AC4 at the unit seam. 7/7 visible test files, 44/44 assertions
  pass; `npx tsc -noEmit -skipLibCheck` is clean; the pre-existing `mux-protocol.test.ts`,
  `sync.test.ts`, `background-sync`, `collab`, `regression`, `w4-canvas-integrity` and the
  real-relay `e2e/two-host` suites still pass (145 assertions) with the barrier in the path.
- **What remains open (decisions a reviewer should confirm, not defects):**
  1. **E2E rooms emit no checkpoint.** A checkpoint carries a plaintext Yjs update and the
     relay cannot be handed one in an end-to-end-encrypted room. Section 7 allowed "encrypt it
     or not emit it"; not emitting is chosen, so an E2E room keeps working over the sidecar +
     peer path exactly like a legacy relay. Encrypting it would need a new envelope and is a
     separate WP.
  2. **Legacy-relay safety valve.** The charter's close trigger (`setSynced`) deadlocks on a
     pre-WP41 relay when peers are present: the frame that would complete the sync is itself
     buffered by the optimistic barrier, so the trigger never fires and `waitForSync` would
     time out — a user-visible error AC3 forbids. `handleMessage` therefore also closes the
     barrier on the SYNC_STEP2 frame while no marker has ever been seen on this connection.
     No timer, no timing constant, order preserved (the buffer is dispatched first). It
     retires permanently the first time any `MUX_REPLAY_END` arrives, so against a WP41 relay
     the strict barrier is what runs.
  3. `applyRecoveredUpdates` is exported and unit-proven but has no production caller yet —
     by design: the sidecar (WP24/WP25) does not exist, and it is the injected seam it will
     use. Nothing under `plugin/src/files/` is imported or referenced.
- **Final status:** DONE.

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
