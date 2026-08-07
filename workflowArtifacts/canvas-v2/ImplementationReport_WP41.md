# Implementation Report — WP41
Attempt: 1

## Status: DONE

## Completed Work

| AC | Status | Notes |
|---|---|---|
| AC1 — frames appended per `roomId:docId`, stored opaquely, encrypted frames as received | DONE | `BlobStore` stores `{seq, msgType, payload}` and nothing else. No parse, decode, decrypt or validate anywhere on the store path; `MUX_SYNC` vs `MUX_SYNC_ENCRYPTED` is kept as received. Keys length-prefix both ids so `room "a:b" + doc "c"` cannot collide with `room "a" + doc "b:c"`. |
| AC2 — a new subscriber receives the stored frames before any live traffic, ending in the same state as a peer present throughout | DONE | `encodeReplay(docId, frames)` emits every frame in ascending `seq` with its original type and bytes, then exactly one `MUX_REPLAY_END` carrying `max(seq)` (0 when empty). `handleSubscribe` buffers the joining client's live fan-out until that batch is on the socket. |
| AC3 — a checkpoint truncates exactly what it supersedes, losing nothing it does not contain | DONE | The supersede point rides in the checkpoint *envelope* (leading varUint), so the relay decides what to drop without looking inside. `checkpoint` takes the next `seq`, then drops `seq <= min(upToSeq, checkpointSeq - 1)`. `upToSeq = 0` drops nothing; an overshooting `upToSeq` can never take the checkpoint itself. Sequence numbers are never recycled. |
| AC4 — replay is idempotent and order-insensitive, no other relay subsystem changes behaviour | DONE | No dedup, no reordering, no coalescing — replay safety is left to the CRDT property. `read()` is non-destructive and hands out fresh copies. Rooms, permissions, auth and audit are untouched; the read-only gate runs *before* the append, so a suppressed write is never stored. |

**Definition of Done** — "an empty room retains its docs without the relay learning anything": met on the source level. The relay now stores and replays the frames of a room with zero peers, and the only fields it holds about a frame are its relay-assigned sequence number and the envelope type it arrived with.

## Blocked Items

| Item | Blocker | Workaround attempted |
|---|---|---|
| — | none | — |

## Tools Created (by Worker 3 this attempt)

| Tool | Type | Purpose |
|---|---|---|
| — | — | none needed |

## Changes Made

| File | Change |
|---|---|
| `server/src/mux-protocol.ts` | Additive only. New frame types `MUX_CHECKPOINT = 11` / `MUX_REPLAY_END = 12`, the `ReplayFrame` interface, `encode/decodeCheckpointBody`, `encode/decodeReplayEndBody`, `encodeReplay`. Every existing type keeps its number, meaning and encoding; a peer that does not know the new types ignores them. |
| `server/src/persistence.ts` | New `StoredFrame` / `BlobStore` surface with `createMemoryBlobStore()` (injected in tests), `createLevelBlobStore(dbPath?)` (production, its own LevelDB path) and `noopBlobStore` (opt-out, mirroring `noopPersistence`). Existing `Persistence` / `Room` code untouched. |
| `server/src/ws-handler.ts` | `createYjsWSS(blobStore = noopBlobStore)`. Sync frames are appended after the read-only gate; `MUX_CHECKPOINT` is routed to the store and not broadcast; `handleSubscribe` sends the replay batch and gates the joining client's live traffic behind it. Existing fan-out loops were replaced by one `sendToPeers` helper with identical semantics for non-replaying peers. |
| `server/src/index.ts` | `createApp(persistence?, externalServer?, blobStore?)` — third argument optional, so every existing caller is unchanged and defaults to the opt-out store. The real entrypoint wires `createLevelBlobStore(process.env.BLOB_STORE_PATH ?? "./data/frames")` and closes it on shutdown. |
| `server/src/__tests__/wp41/*.test.ts` | The 8 visible test files, staged verbatim (renamed to `*.test.ts` so `vitest.config.ts`'s `include: ["src/**/*.test.ts"]` collects them). No assertion was edited. Permanent deliverable. |

Zero new runtime dependencies. Nothing outside `server/` was modified except this report and the TaskCharter.

## Visible Test Results

`npx vitest run src/__tests__/wp41` → **8 files / 27 tests passed, 0 failed** (706 ms). Passed on the first run; no test was adjusted.

| Test | Status | Notes |
|---|---|---|
| TC1 `test_tp1_opaque_roundtrip` (4) | PASS | High-entropy, empty, never-terminating-varint and truncated-lib0 payloads round-trip byte-for-byte; `msgType` preserved; a stored frame exposes exactly `{seq, msgType, payload}`. |
| TC2 `test_tp2_key_isolation` (4) | PASS | Four room/doc streams independent, each numbered from 1 ascending, unknown key reads empty, `clear()` is stream-local. |
| TC3 `test_tp3_replay_equals_present` (3) | PASS | Real Yjs: late joiner rebuilt from the store equals the always-present peer, for `Y.Text` and a canvas-shaped `Y.Map` with LWW overwrite and delete. |
| TC4 `test_tp4_replay_order_before_live` (4) | PASS | Ascending order, original docId/type/bytes, marker exactly once and strictly last, `lastSeq = 0` for an empty doc. |
| TC5 `test_tp5_checkpoint_truncation` (4) | PASS | Superseded frames dropped, checkpoint gets its own (never recycled) seq, payload stored opaquely, returned frame == later `read()` frame. |
| TC6 `test_tp6_truncation_lossless` (2) | PASS | Real Yjs: `checkpoint + survivors` rebuilds the producer's exact document and state vector, for `Y.Map` and `Y.Text`. |
| TC7 `test_tp7_idempotent_commutative` (2) | PASS | 18-frame set in original order, seeded shuffle and with every frame duplicated/tripled yields one identical document, equal to the producer's. |
| TC8 `test_tp8_replay_nondestructive` (4) | PASS | `read()` does not drain, a second full replay changes nothing, the store is byte-identical across a replay, numbering continues afterwards. |

## Server Suite Result

- `npm run build` (tsc): **PASS**, no diagnostics.
- `npm test` (from `server/`): **18 files / 149 tests passed, 0 failed** (20.3 s).
- Versus the 122 tests / 10 files baseline: `122 + 27 = 149` and `10 + 8 = 18` — the delta is exactly the staged WP41 tests. No pre-existing test was deleted, weakened or modified.
- `biome check` on the four touched source files reports 4 findings, all of them the known whole-file `format` CRLF environment artifact (one per file), no lint findings. Not mass-reformatted, per the charter.

## Summary for Worker 3

The relay now remembers. Every `MUX_SYNC` / `MUX_SYNC_ENCRYPTED` frame that survives the existing read-only gate is appended verbatim to an opaque per-`roomId:docId` stream; a subscriber gets that stream replayed in ascending order, terminated by a `MUX_REPLAY_END` marker, before it can see any live frame; and a client `MUX_CHECKPOINT` frame folds the history it supersedes away. The relay reads exactly three things from a frame — docId, msgType, and the envelope-level `upToSeq` on a checkpoint — and never touches a payload, so encrypted rooms stay encrypted end to end. To trigger it in a headless test, inject a store: `createApp(noopPersistence, undefined, createMemoryBlobStore())`; the production entrypoint uses `createLevelBlobStore()`. Default behaviour without a store is `noopBlobStore`, which is exactly today's in-flight relay — that is why the 122 legacy tests are untouched.

Rough edges worth knowing. (1) Retention is unconditional: with no client emitting `MUX_CHECKPOINT` yet, a doc's stream grows without bound, and `SyncStep1` request frames are stored too, because distinguishing them would mean parsing a payload we may not parse. Compaction is the client's job by design. (2) `createLevelBlobStore` is not exercised by any test — it needs its own LevelDB directory (`./data/frames`, override via `BLOB_STORE_PATH`) since `createLevelPersistence` holds an exclusive lock on `./data/yjs-docs`, and its durability across a restart is a property of the `liveshare-data` volume, so it is deployment-verified, not test-verified. (3) `handleSubscribe` became `async`; the joining client is added to the fan-out set immediately but its live traffic is buffered until the replay batch is written. That is a deliberate strengthening of the charter's "before it is added to the live fan-out set" — the observable contract is identical, but a frame produced by another peer while the store read is in flight cannot be lost. (4) A read-only client's checkpoint is ignored, mirroring the write gate — no new policy, but worth a sanity check if W4 tests permissions against the new frame type.

### Knowledge Signals

- **Design decision (durable):** in a content-blind relay, a checkpoint's supersede marker must live in the frame *envelope* (a leading varUint), never be derived from the payload. That is what makes "truncate what the checkpoint supersedes" and "never parse a payload" coexist instead of contradicting each other.
- **Design decision (durable):** replay-before-live is better implemented as a *buffered fan-out gate* than as delayed registration. Delaying `clients.add(...)` until after an awaited store read opens a window in which a concurrently produced frame is neither replayed nor fanned out — a silent lost update. Registering immediately and queueing the client's outbound live traffic until the replay batch is written closes it with the same observable ordering.
- **Gotcha (confirmed again):** `server/vitest.config.ts` has `include: ["src/**/*.test.ts"]`; artifact tests named `test_<id>_visible.ts` are collected only after being renamed to `*.test.ts`. A naive `npx vitest run <dir>` on the raw filenames reports success while running nothing.
- **Gotcha (new):** when a store's `append` may await before it copies its input, it must copy *before* the first `await` — the caller is handing it a pooled `ws` socket buffer that can be recycled mid-write. Same reason the returned frame must not alias the caller's bytes.
