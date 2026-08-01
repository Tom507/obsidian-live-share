# Task Charter — WP41: Relay blob store

**Charter Status:** `DONE`
**WP:** WP41
**Phase:** P6
**task_mode:** `standard`
**Depends on:** WP25
**W4 Test Targets:** `3`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** an empty room retains its docs without the relay learning anything.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C41 — Relay per-`roomId:docId` blob store** (work package WP41); phase **P6**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify (`server/src/persistence.ts`, `server/src/ws-handler.ts`, `server/src/mux-protocol.ts`)
  - Responsibility: let a room survive the absence of all peers without changing the trust model.
  - Scope summary: opaque per-`roomId:docId` append + replay + truncate
- **Out of scope / non-goals:**
  - Any change to rooms, permissions, auth or audit-log behaviour.
  - Parsing, decrypting or inspecting frame contents — the relay stays content-blind.
  - Deployment of the relay; this WP changes source only.
- **Known interfaces / dependencies:**
  - Input: incoming `MUX_SYNC` frames (possibly encrypted) and client checkpoint frames
  - Output: replay of stored frames to a later subscriber before live traffic
  - Depends on work packages: WP25
  - **Convergence-fuzzer link (required by the BUILD_SPEC):** WP23 "replay" op — duplicated and arbitrarily reordered replay of stored frames leaves every replica's state unchanged (idempotent, commutative delivery — the CRDT property the relay design relies on).

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** Relay per-`roomId:docId` blob store
- **Interfaces involved:**
  - Input: incoming `MUX_SYNC` frames (possibly encrypted) and client checkpoint frames
  - Output: replay of stored frames to a later subscriber before live traffic
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
  - `server/src/persistence.ts` — the existing LevelDB persistence layer
  - `server/src/ws-handler.ts` — the frame path
  - `server/src/mux-protocol.ts` — the frame types
  - `server/src/__tests__/` — 10 suites / 122 tests that must stay green
  - CONCEPT_V2 Teil 7 — the relay persistence section and its idempotence argument
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component C41. No paraphrasing.*

1. Frames are appended per `roomId:docId` and stored **opaquely** — the relay never parses, decrypts or interprets frame contents, and encrypted frames are stored as received.
2. A newly subscribing client receives the stored frames before any live traffic, and the resulting state equals that of a client that was present throughout.
3. A client checkpoint frame allows truncation of everything it supersedes, and truncation never loses an update that the checkpoint does not contain.
4. Replay is idempotent and order-insensitive: duplicated or reordered replays leave the client state unchanged, and no other relay subsystem (rooms, permissions, auth, audit) changes behaviour.

**Definition of Done:** an empty room retains its docs without the relay learning anything.

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
  - `server/src/persistence.ts`
  - `server/src/ws-handler.ts`
  - `server/src/mux-protocol.ts`
  - new tests under `server/src/__tests__/`
- **Required report:** `ImplementationReport_WP41.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/` and, for the relay change, `npm run build` + `npm test` from `server/`. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

All visible tests run under Vitest 4.0.18 from `server/`, are socket-free and
sleep-free, and are staged by copying them into `server/src/__tests__/<dir>/`
(hence the `../../persistence.js` / `../../mux-protocol.js` import depth).

> **Staging note:** `server/vitest.config.ts` sets `include: ["src/**/*.test.ts"]`.
> The mandated artifact filenames (`test_<point_id>_visible.ts`) do **not** match
> that glob — rename each staged copy to `*.test.ts` (e.g.
> `test_tp1_opaque_roundtrip_visible.test.ts`) or the runner collects nothing.

### TC1 — Frames are stored opaquely, byte-for-byte, with the envelope type intact
- Verifies AC: 1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp1_opaque_roundtrip_visible.ts
- What it checks: high-entropy, empty, oversized-varint and deliberately undecodable payloads round-trip unchanged, `MUX_SYNC` vs `MUX_SYNC_ENCRYPTED` is preserved as received, and a stored frame exposes exactly `{seq, msgType, payload}` — no field that could only exist if the payload had been decoded.
- Test data channel: deterministic generator (mulberry32, fixed seeds)

### TC2 — Frames are keyed per `roomId:docId` and numbered per stream
- Verifies AC: 1
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp2_key_isolation_visible.ts
- What it checks: four room/doc combinations stay independent, each stream numbers its own frames from 1 strictly ascending, an unknown key reads empty, and `clear()` on one stream leaves its siblings untouched.
- Test data channel: fixture (labelled UTF-8 payloads)

### TC3 — A late joiner rebuilt from the store equals a peer present throughout
- Verifies AC: 2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp3_replay_equals_present_visible.ts
- What it checks: with real Yjs, a doc rebuilt only from stored frames matches a doc that received every update live — both for `Y.Text` and for a canvas-shaped `Y.Map` with an LWW overwrite and a delete — compared on logical content and on a sorted clientID→clock state summary.
- Test data channel: fixture (scripted Yjs edit sequence, pinned `clientID`s)

### TC4 — The replay is an ordered batch terminated by an explicit boundary marker
- Verifies AC: 2
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp4_replay_order_before_live_visible.ts
- What it checks: `encodeReplay` emits every stored frame in ascending `seq` with its original docId, type and bytes, then exactly one `MUX_REPLAY_END` frame carrying the highest replayed sequence — strictly last, and still present (with `lastSeq = 0`) for a doc that has no frames.
- Test data channel: fixture (small byte payloads)

### TC5 — A checkpoint truncates exactly what it supersedes
- Verifies AC: 3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp5_checkpoint_truncation_visible.ts
- What it checks: frames with `seq <= upToSeq` are dropped and later frames survive, the checkpoint gets its own next sequence number (never a recycled one), its payload is stored as opaquely as any other frame, and the frame `checkpoint()` returns is the frame a later `read()` returns.
- Test data channel: fixture (labelled payloads + a non-Yjs ciphertext blob)

### TC6 — Truncation never loses an update the checkpoint does not contain
- Verifies AC: 3
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp6_truncation_lossless_visible.ts
- What it checks: with real Yjs, the document rebuilt from `checkpoint + surviving frames` is identical to the producer's document — for a `Y.Map` canvas and for `Y.Text` — proving the compaction is semantically lossless rather than merely smaller.
- Test data channel: fixture (scripted Yjs edits, `Y.encodeStateAsUpdate` as the checkpoint payload)

### TC7 — Replay is idempotent and order-insensitive
- Verifies AC: 4
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp7_idempotent_commutative_visible.ts
- What it checks: the same 18-frame set applied to a fresh `Y.Doc` in original order, in a seeded Fisher-Yates shuffle, and with every frame duplicated produces one identical document, equal to the producer's — the CRDT property the relay design rests on (BUILD_SPEC C41 fuzzer link / WP23 "replay" op).
- Test data channel: seed (mulberry32, seeds `0xc0ffee` / `0xbadf00d`; no `Math.random`)

### TC8 — Replay is non-destructive and repeatable
- Verifies AC: 4
- Test file: workflowArtifacts/canvas-v2/tests/visible/WP41/test_tp8_replay_nondestructive_visible.ts
- What it checks: `read()` does not drain the stream, applying a whole replay a second time changes nothing in the document, the store is byte-identical before and after a replay, and sequence numbering continues normally afterwards.
- Test data channel: fixture (small byte payloads + a scripted Yjs sequence)

### Required API surface (contract for the coder)

Exactly these symbols are imported by the tests. Names, signatures and
semantics must match; the surface is deliberately small and injectable, on the
existing `Persistence` / `noopPersistence` precedent.

**`server/src/mux-protocol.ts`** — additive only; every existing frame type keeps its meaning and encoding.

```ts
export const MUX_CHECKPOINT = 11;
export const MUX_REPLAY_END = 12;

export interface ReplayFrame {
  seq: number;
  msgType: number;
  payload: Uint8Array;
}

// Client -> relay checkpoint body, carried as the payload of
// encodeMuxMessage(docId, MUX_CHECKPOINT, body). The relay reads only the
// leading varUint (an envelope-level sequence field) and never decodes the
// opaque tail.
export function encodeCheckpointBody(upToSeq: number, payload: Uint8Array): Uint8Array;
export function decodeCheckpointBody(body: Uint8Array): { upToSeq: number; payload: Uint8Array };

export function encodeReplayEndBody(lastSeq: number): Uint8Array;
export function decodeReplayEndBody(body: Uint8Array): { lastSeq: number };

// Ascending seq, one mux message per frame (msgType and payload verbatim),
// then exactly one trailing MUX_REPLAY_END carrying max(seq) — 0 when empty.
export function encodeReplay(docId: string, frames: readonly ReplayFrame[]): Uint8Array[];
```

**`server/src/persistence.ts`**

```ts
export interface StoredFrame {
  seq: number;       // relay-assigned, 1-based, strictly ascending per roomId:docId
  msgType: number;   // the envelope type as received
  payload: Uint8Array;
}

export interface BlobStore {
  append(roomId: string, docId: string, msgType: number, payload: Uint8Array): Promise<StoredFrame>;
  read(roomId: string, docId: string): Promise<StoredFrame[]>;   // ascending seq, non-destructive
  checkpoint(roomId: string, docId: string, upToSeq: number, payload: Uint8Array): Promise<StoredFrame>;
  clear(roomId: string, docId: string): Promise<void>;
  close(): Promise<void>;
}

export function createMemoryBlobStore(): BlobStore;          // injected in tests
export function createLevelBlobStore(dbPath?: string): BlobStore; // production (LevelDB, per BUILD_SPEC §3)
export const noopBlobStore: BlobStore;                       // opt-out, mirrors noopPersistence
```

Behavioural contract the tests pin:

- `append` / `checkpoint` / `read` **copy** the payload in both directions. The caller may recycle its socket buffer, and a consumer may overwrite what `read()` returned, without either affecting stored bytes.
- The store key must be collision-free for colon-bearing ids (`room "a:b" + doc "c"` must not equal `room "a" + doc "b:c"`); length-prefixing the room id is sufficient.
- `checkpoint` appends the checkpoint as a normal frame with `msgType = MUX_CHECKPOINT`, assigns it the next sequence number, and **then** removes every frame with `seq <= min(upToSeq, checkpointSeq - 1)`. `upToSeq = 0` supersedes nothing; an overshooting `upToSeq` must never delete the checkpoint itself.
- Sequence numbers are never recycled after a truncation.
- `close()` is idempotent.

Wiring expectation for `server/src/ws-handler.ts` (not covered by the visible tests, see 7b): `handleSubscribe` sends the full `encodeReplay(...)` batch to the joining client **before** it is added to the live fan-out set; `MUX_CHECKPOINT` is routed to `blobStore.checkpoint(...)` and is not broadcast as a sync frame; a frame suppressed by the read-only gate is not appended.

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

Three ACs (or AC halves) need a running relay and are out of reach for headless
unit tests. The socket harness in `server/src/__tests__/ws-handler.test.ts`
(`createApp(noopPersistence)` → `listen` → `connectMux`) is the established
pattern for all three.

1. **AC2 (wiring half) — `INTEGRATION_SCOPE`.** The replay batch must reach a newly subscribing client *before any live traffic*. Drive it over a real socket: peer A writes, disconnects; peer B subscribes and must observe the stored `MUX_SYNC` frames followed by `MUX_REPLAY_END` **before** the first frame produced by a concurrently writing peer C. The pure ordering core (`encodeReplay`) is covered by TC4; only the send-order-versus-fan-out-registration seam is left.
2. **AC3 (wiring half) — `INTEGRATION_SCOPE`.** A `MUX_CHECKPOINT` frame arriving over the wire must be decoded with `decodeCheckpointBody` and routed to `blobStore.checkpoint(...)`, and must not be broadcast to peers as an ordinary sync frame. Requires the real `ws.on("message")` dispatch path.
3. **AC4 (second half) — `INTEGRATION_SCOPE`.** "No other relay subsystem (rooms, permissions, auth, audit) changes behaviour." Oracle: the existing 10 server suites / 122 tests stay green unchanged, plus one new live assertion that a sync frame suppressed by the read-only gate (`readOnlyPatterns` / `defaultPermission`) is **not** appended to the blob store.

**Environment prerequisite (not an AC):** `createLevelBlobStore` durability across a relay process restart depends on the LevelDB volume (`liveshare-data`) and is not exercised headlessly — the unit tests inject `createMemoryBlobStore()` instead, following the `noopPersistence` precedent.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:** the relay was purely in-flight. `handleSync` fanned a frame
  out to the other subscribers of `roomId:docId` and forgot it; when the last peer left, the
  room's content was gone. `mux-protocol.ts` knew types 0–10 and had no notion of a checkpoint
  or a replay boundary; `persistence.ts` stored room metadata only.
- **Approach:**
  - `mux-protocol.ts` (additive): `MUX_CHECKPOINT = 11`, `MUX_REPLAY_END = 12`, `ReplayFrame`,
    `encode/decodeCheckpointBody`, `encode/decodeReplayEndBody`, `encodeReplay`. The checkpoint
    body is a leading varUint (`upToSeq`) plus an **untouched tail** — the relay reads the
    varUint and copies the tail; it never decodes it. `encodeReplay` re-emits each frame with
    its original docId, envelope type and bytes, then exactly one `MUX_REPLAY_END` carrying
    `max(seq)` (0 when empty).
  - `persistence.ts`: `StoredFrame` / `BlobStore` + `createMemoryBlobStore`,
    `createLevelBlobStore(dbPath = "./data/frames")` and `noopBlobStore`. Keys length-prefix
    both ids (`<rlen>:<room>:<dlen>:<doc>:`) so colon-bearing ids cannot collide. Payloads are
    copied in both directions and before the first `await` on the LevelDB path, so a recycled
    socket buffer can never reach or corrupt the store. `checkpoint` appends the checkpoint as
    an ordinary frame with the next sequence number and only then drops
    `seq <= min(upToSeq, checkpointSeq - 1)`; counters are never recycled.
  - `ws-handler.ts`: `createYjsWSS(blobStore = noopBlobStore)`. `handleSync` appends the frame
    **after** the existing read-only gate, so a suppressed write is never stored. A new
    `handleCheckpoint` routes `MUX_CHECKPOINT` to `blobStore.checkpoint(...)` and does not
    broadcast it. `handleSubscribe` registers the client and then buffers its live traffic in
    `RoomState.replayQueues` until the `encodeReplay(...)` batch has been written to the socket
    — the client observes the stored frames strictly before any live frame, and nothing
    produced during the (async) store read can be lost. `createApp` takes an optional third
    `blobStore` argument; only the real server entrypoint wires `createLevelBlobStore()`.
- **Fallback path if all attempts fail:** not needed — the visible tests passed on the first
  run and the full server suite stayed green.

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:** all four ACs. 27/27 visible tests pass (staged permanently under
  `server/src/__tests__/wp41/`), `npm run build` passes, and the full server suite is
  18 files / 149 tests / 0 failed — the 122/10 baseline plus exactly the 27 staged tests, with
  no pre-existing test changed, weakened or removed. The three wiring seams listed in 7b were
  smoke-checked over a real socket during development (replay-before-live, checkpoint routing
  without broadcast, no append of a read-only-suppressed frame — all green); that throwaway
  harness was deleted so W4 owns the integration oracle.
- **What remains open:** the 7b integration targets (W4). `createLevelBlobStore` is exercised
  by no headless test — its durability depends on the `liveshare-data` volume and it needs its
  own LevelDB path (`./data/frames`, override `BLOB_STORE_PATH`) because the room database
  holds an exclusive lock on `./data/yjs-docs`. No client yet emits `MUX_CHECKPOINT`, so
  without a plugin-side producer the store grows monotonically per doc.
- **Final status:** DONE

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
