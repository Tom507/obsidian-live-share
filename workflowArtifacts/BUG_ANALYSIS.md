# Obsidian Live Share — Multiplayer Bug Analysis

> Plan-stage deliverable for the Dynamic Atomic Orchestrator. Produced by a 4-way
> parallel code review (presence/cursor · text/frontmatter · networking latency ·
> canvas/general) plus independent cross-check of the two user-reported bugs.
> Repo: `obsidian-live-share` (fork, pinned `f5fe736`). Client `plugin/src/`, relay `server/src/`.

---

## 0. System model (how a change travels)

Two independent WebSocket transports per session:

```
                       ┌─ MUX / Yjs  (/ws-mux)  ── sync.ts ⇄ ws-handler.ts
Obsidian (Electron) ───┤     • per-file Y.Doc "content" (Y.Text)   → live text + in-editor caret (awareness)
                       │     • per-canvas Y.Doc "__canvas__:path"  → nodes/edges (per-node Y.Map)
                       │     • NO rate limit, NO batching → immediate ws.send
                       │
                       └─ CONTROL  (/control)  ── control-ws.ts ⇄ control-handler.ts
                             • file create/delete/rename, chunked binary, presence, perms, host mgmt
                             • rate-limited 100 msgs / 10 s (hard ws.close on breach)
```

Key consequence: **live typing and the in-editor caret already propagate instantly** over MUX
*when the file is the active CodeMirror doc*. Everything else — canvas, non-active files, disk
persistence — is gated by **two 1000 ms trailing disk-write debounces**. That mismatch is the
felt "changes take a while to propagate."

Two separate "cursor" concepts (conflating them hides Bug A):
- **In-editor caret** = Yjs *awareness*, per file, over MUX, rendered by yCollab. ← the reported bug.
- **Presence panel** = control-channel `presence-update` (currentFile/scroll/line). Symmetric & fine.

---

## 1. Common multiplayer scenario layout

| # | Scenario | Verdict | Bug ref |
|---|----------|---------|---------|
| S1 | Live co-typing in the **same active note** (character-level) | ✅ works, immediate | — |
| S2 | See the other user's **in-editor caret / selection** | ❌ asymmetric — guest can't see host | **A** |
| S3 | See the other user in the **presence panel** (who/where) | ✅ works | — |
| S4 | Guest edits **frontmatter properties** (adds a new property) | ❌ corrupts / duplicates YAML | **B** |
| S5 | Edit a **non-active / background note** (preview pane, side note) | ⚠️ correct but **+1000 ms** lag | L2 |
| S6 | Drag **different** canvas nodes simultaneously | ❌ one move gets reverted (clobber) | **C** |
| S7 | Drag the **same** canvas node simultaneously | ✅ LWW per axis (cosmetic x/y split) | — |
| S8 | **Add a node** while peer edits another node's text | ❌ clobbered by stale reconcile | C |
| S9 | Create **canvas edge** while nodes move | ❌ clobbered by stale reconcile (+ dangling-edge nit) | C |
| S10 | Canvas node move **visible on peer** | ⚠️ correct but **+1000 ms** lag | L1 |
| S11 | Peer **disconnects** — their caret disappears | ❌ ghost caret lingers in the doc | D |
| S12 | Concurrent **renames** (A→B while other B→A / two renames at once) | ❌ files renamed to wrong names | E |
| S13 | Create-then-rename / create same filename / delete-while-editing | ✅ (delete-while-editing = low-sev edge) | — |
| S14 | **Guest joins mid-session** (manifest + docs) | ✅ sound (one empty-file boundary risk) | — |
| S15 | **Reconnect** after a network drop (Yjs re-sync) | ✅ CRDT converges | — |
| S16 | Reconnect replay of an **offline binary modify + rename** | ❌ binary modification lost | F |
| S17 | **Read-only** guest tries to edit text | ✅ enforced server-side (global) | — |
| S18 | Read-write guest edits a **host-designated read-only canvas / path** | ❌ not enforced (bypass) | G |
| S19 | **Half-dead socket** (Wi-Fi drop, no FIN) | ❌ edits silently stop, no heartbeat detects it | H |
| S20 | **Host disconnects**, guest auto-elected, host reconnects | ❌ split-brain (two hosts) | I |
| S21 | Large-file / burst of file-ops over control channel | ❌ trips rate limit → disconnect | L5 |

---

## 2. Confirmed bug catalog (ranked)

### 🔴 A. Guest cannot see the host's cursor  *(USER-REPORTED, root cause confirmed)*
- **Where:** `plugin/src/sync/sync.ts:137-148` (awareness sent only on *local* change; `origin==="remote"` returns) and `sync.ts:328-335` (`handleSyncRequest` re-sends `writeSyncStep1` document state but **never** awareness). Server `server/src/ws-handler.ts:89-131` relays a sync-request to existing peers but stores only numeric client IDs, never awareness state.
- **Why asymmetric:** the transport performs **no initial awareness transfer to a newly-subscribing client**, and there is **no awareness heartbeat** (unlike stock y-websocket's `queryAwareness` + re-announce). The host sits in the shared file first and sets its caret once (`collab.ts:102,119`) *before the guest subscribes* → that broadcast reaches nobody. The guest sets its caret *after* subscribing → reaches the host. So host sees guest; guest never sees the host's static caret. It "flickers on" only if the host physically moves the caret after the guest joined.
- **Fix direction:** when a new peer subscribes, existing peers re-emit their local awareness — mirror the control channel's existing `isNew` re-broadcast (`presence-manager.ts:133-135`). Simplest: in `handleSyncRequest` / on `MUX_SUBSCRIBED`, also `sendMux(docId, MUX_AWARENESS, encodeAwarenessUpdate(awareness, [clientID]))`. Add a periodic re-emit as belt-and-suspenders (also fixes H/ghost self-heal).

### 🔴 B. Adding frontmatter properties corrupts the YAML  *(USER-REPORTED, root cause confirmed)*
- **Where:** double-writer race on the active file's `Y.Text`. `main.ts:709-733` nulls `collabBoundFile` on every `active-leaf-change` and only restores it in the async `.then()` after `waitForSync` (up to 10 s). During that window `background-sync.ts:252` and the observer `:294` are **not** guarded, so both yCollab **and** `background-sync.handleLocalTextModify` write the property line into `Y.Text`.
- **Trigger:** Obsidian's Properties UI persists frontmatter to disk *without going through CM6* → fires a vault `"modify"` event (not in `recentDiskWrites`, `background-sync.ts:251`). If `handleLocalTextModify` runs before the CM6 reload transaction, `applyMinimalYTextUpdate` inserts the same `tags: x\n` line yCollab is also inserting → duplicate key / interleaved splice like `tagtags: xs: x`. ~50% (order-dependent) → matches "sometimes wrong."
- **Companion (guard set):** when `collabBoundFile===path` correctly, the same disk-only frontmatter edit is *dropped entirely* (`:252`/`:294`) → property silently lost.
- **Fix direction:** enforce a **single-writer invariant** for the active file: set `collabBoundFile = sharedPath` **synchronously** before async activation; gate `background-sync` on **active-file identity** (not just the racy `collabBoundFile`); recompute the diff base atomically; route/ignore disk frontmatter edits so they reach `Y.Text` exactly once.

### 🔴 C. Canvas concurrent-edit clobber (different nodes)  *(explains canvas data loss)*
- **Where:** `canvas-sync.ts:176-198` `handleLocalModify` re-reads the **entire** `.canvas` on every local save and force-reconciles all nodes via `applyCanvasToYMaps` (`:226-258`). Because remote→disk is **debounced 1000 ms** (`:17,260-275`) and the debounce *resets on every incoming update*, a user's on-disk file is stale relative to un-flushed remote CRDT state. Their next local save reverts every un-flushed remote node back to the stale value.
- **Trigger:** A drags node1 while B's node2 move hasn't flushed to A's disk → A's save writes `node2@old` into the CRDT → B's move reverts. Perpetual during continuous editing.
- **Fix direction:** don't blind-reconcile. Flush pending remote writes before accepting a local modify, **or** diff the local file against `lastWrittenContent` (already tracked, `:94`) and push only keys this user actually changed.

### 🟠 D. Ghost caret persists after a peer disconnects
- **Where:** `server/src/ws-handler.ts:206-213` synthesizes the awareness removal with a **hardcoded clock `0`**. `applyAwarenessUpdate` only applies when `currClock < clock`; any live peer already has clock ≥ 1, so the removal is ignored → the disconnected user's caret freezes in every open editor until the file is reopened. (Panel entry clears via `presence-leave`, so the tell is: name gone from panel, caret still in doc.)
- **Fix direction:** track the highest clock seen per client and send `lastClock + 1`.

### 🟠 E. Concurrent renames pair to the wrong names
- **Where:** `main.ts:92-138` guest manifest rename detector pairs `removed`→`added` by **iteration order**, ignoring the `hash`/`oldValue` it has available. `removed=[A,C], added=[D,B]` → renames A→D instead of A→B.
- **Fix direction:** match a removed path to the added entry with the same hash.

### 🟠 F. Offline binary modify lost across a rename
- **Where:** `offline-queue.ts:25-34` rewrites pending-op paths on rename → `[modify C, rename B→C]`; on drain, `modify C` hits a not-yet-existing file and `file-ops.ts:204-215` only mutates existing files → dropped; `rename` then yields old content. Binary only (text has Yjs backup).
- **Fix direction:** when rewriting a `modify` onto a not-yet-existing target, convert it to `create`; or don't rewrite `modify` paths across renames.

### 🟠 G. Read-only bypass on canvas / `readOnlyPatterns` not enforced on MUX
- **Where:** `ws-handler.ts:143-152` enforces only **global** read-only for Yjs; it never checks `readOnlyPatterns`. `canvas-sync.ts` has **no** permission logic; the pattern self-enforcement in `main.ts:711-718` is **text-editor only**. → a read-write guest can freely edit a canvas/path the host marked read-only.
- **Fix direction:** enforce `readOnlyPatterns` in `ws-handler.handleSync` by mapping `docId`→path (incl. `__canvas__:`); gate `canvas-sync` writes on effective permission.

### 🟠 H. No heartbeat / pong-timeout → half-dead socket silently stops delivering
- **Where:** `control-ws.ts:190-198` pings every 30 s but never verifies a pong; MUX (`sync.ts`) has **no** ping at all. A silently-dropped socket keeps "sending into the void" until OS TCP timeout (minutes). Classic "updates just stopped."
- **Fix direction:** add a pong deadline (close+reconnect if no pong within ~10 s), drop ping to ~15 s, add a liveness ping to MUX.

### 🟠 I. Host split-brain after unverified election + verified host reconnect
- **Where:** `control-handler.ts:544-573` elects the lowest-joinOrder guest but does **not** update `serverRoom.hostUserId` when the electee is unverified (guard `:558`). Original host reconnects with its JWT → `determineHostStatus` (`:142-152`) still matches → **two `isHost=true` clients.**
- **Fix direction:** update `hostUserId` even for unverified electees; demote other hosts when a verified host is re-admitted.

### 🟡 Latency limiters (explain "slow to propagate")
| Ref | Where | Value | Fix |
|-----|-------|-------|-----|
| L1 | `canvas-sync.ts:17` | 1000 ms canvas disk-write debounce | → ~200 ms (+ max-wait cap) |
| L2 | `background-sync.ts:21` | 1000 ms non-active text disk-write debounce | → ~300 ms (+ max-wait cap) |
| L3 | see **H** | 30 s ping, no pong-timeout; MUX no ping | pong deadline + MUX ping |
| L4 | `control-ws.ts:16` | 1000 ms control reconnect base (MUX is 100) | → ~300 ms |
| L5 | `control-handler.ts:44` + `file-ops.ts:507-517` | 100/10 s hard-close + unpaced 512 KB chunk burst (>~51 MB self-trips) | exempt `file-chunk-*` / pace loop |
| L6 | `server/src/index.ts:140-155` | no `socket.setNoDelay(true)` (Nagle ~40 ms/hop) | set noDelay before upgrade |
| L7 | `presence-manager.ts:48` | 3000 ms presence line refresh | cursor-move trigger (cosmetic) |

*(perMessageDeflate is correctly off — no change.)*

### 🟢 Low-severity notes
- Surrogate-pair split at diff boundary (`utils.ts:71-82`) — snap off surrogate halves.
- Non-atomic diff base in `handleLocalTextModify` (`background-sync.ts:260-263`).
- Host re-seed on activation can clobber concurrent guest edits (`collab.ts:95-98`) — seed only when `Y.Text` empty.
- Presence heartbeat leaks currentFile/line for non-shared notes (`presence-manager.ts:59-73`) — privacy.
- `__manifest__` Yjs doc unprotected server-side; `chunk-resume` bypasses offline queue; dangling edge on concurrent node delete; canvas x/y split-key; empty-file boundary risk on join with no doc peer.

---

## 3. Proposed fix work packages (for the orchestrator)

- **WP1 — Awareness lifecycle** (fixes **A** reported, **D**, **H**-awareness): re-emit awareness to newcomers on subscribe/sync-request; correct disconnect-removal clock; periodic re-emit. Files: `sync.ts`, `ws-handler.ts`.
- **WP2 — Active-file single-writer invariant** (fixes **B** reported + companions): synchronous `collabBoundFile`, active-file-identity gating in background-sync, atomic diff base, host seed-only-when-empty, surrogate-safe diff. Files: `main.ts`, `background-sync.ts`, `collab.ts`, `utils.ts`.
- **WP3 — Canvas concurrent-edit correctness** (fixes **C**): stop stale whole-file reconcile; diff against `lastWrittenContent` / flush-before-ingest. Files: `canvas-sync.ts`.
- **WP4 — Propagation latency** (fixes **L1/L2/L4/L6** + **H** transport): lower debounces + max-wait cap, pong-timeout heartbeat on both channels, control reconnect base, `setNoDelay`. Files: `canvas-sync.ts`, `background-sync.ts`, `control-ws.ts`, `sync.ts`, `server/src/index.ts`.
- **WP5 — Permissions & robustness** (fixes **E, F, G, I, L5**): canvas/pattern read-only enforcement, rename hash-pairing, offline modify→create, host election `hostUserId` update + demotion, chunk pacing/exemption. Files: `ws-handler.ts`, `control-handler.ts`, `canvas-sync.ts`, `main.ts`, `offline-queue.ts`, `file-ops.ts`.

WP1+WP2 resolve both explicitly reported bugs; WP3+WP4 resolve the canvas data-loss + "slow to propagate." WP5 is additional correctness/security hardening. There is a large existing vitest suite (`plugin/src/__tests__`, `server/src/__tests__`) to extend per fix.
