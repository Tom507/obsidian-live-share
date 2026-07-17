# BUILD_SPEC — ObsidianLiveShare (Round 2: Latency-Resistance, Canvas Presence & Per-Card Locking)

> Authoritative architecture document for Phase A of Round 2. Drives the WP breakdown,
> acceptance criteria, and the W4 validation gate. User stories + their ACs live in
> `USER_STORIES.md` (this file references them, does not repeat them).
>
> **Graph basis:** none — Graphify disabled for this workflow; grounded on `PLAN.md`
> discovery grounding (file:line refs) + Round-1 code (`BUG_ANALYSIS.md`). All file paths
> below are confirmed present in-tree; none invented.

---

## 1. Project Overview

- **Project name:** ObsidianLiveShare (repo `obsidian-live-share`, fork pinned `f5fe736`; client `plugin/src/`, relay `server/src/`).
- **Target vision:** Make Obsidian multiplayer reliable under **real network latency** — text carets always visible and persistent, canvases with live cursors + presence, and per-card locking that prevents same-card clobber and never strands a lock.
- **Primary user group / consumers:** Collaborators (host + guests) editing shared Obsidian notes and canvases over a real internet link via the NeuralAngels relay.
- **Non-goals (Phase A):**
  - Phase B items: OIDC primary auth, headless persistent host, admin web UI, in-Obsidian status console (deferred; see PLAN.md Appendix).
  - Server-enforced (mutual-exclusion) locking — impossible given Yjs delta opacity; locking is advisory + presence only.
  - True fencing tokens (GAP-7) — out of scope; bounded LWW risk accepted.
  - Re-fixing already-fixed Round-1 bugs (ghost-caret, per-key canvas diff — "Bug C/D" stale).
  - Relay redeploy for on-join awareness transfer (resolved client-side — see §5).
- **UI language / locale:** English (Obsidian plugin UI); code + comments English.

---

## 2. Scope and Deliverables

- **User stories:** see `USER_STORIES.md` (US1–US6).
- **Must-have requirements (P0):**
  - Symmetric, persistent text caret visibility incl. static-caret survival past 30 s and reconnect re-visibility (US1 / WP1).
  - Canvas cursors + here/typing indicator on the canvas-doc awareness channel + DOM overlay (US2 / WP2).
  - Per-card advisory locking with deterministic lowest-`clientID` tiebreak, delete-wins/no-resurrect, `canWriteNode`/`canDeleteNode`, colored held highlight (US3 / WP3).
  - Crash-safe auto-release + idle-holder lock survival + reconnect no-split-lock (US4 / WP1+WP3). **Non-negotiable: crash-safe auto-release.**
  - Version/sequence-gated flush, drop-unflushed-on-remote-lock, edge cascade-prune, single-writer invariant intact (US5 / WP4).
  - Deterministic 50–150 ms RTT two-client harness reproducing every targeted race red-first (US6 / WP5).
- **Should-have requirements (P1):**
  - Optional lock-epoch/Lamport counter mitigating GAP-7 stale resumed-holder writes (US3 AC9).
  - Private-Canvas-API acquisition path (best UX) alongside the mandatory diff-inferred fallback.
- **Nice-to-have requirements (P2):**
  - Server-side awareness on-join replay (only if client-side hardening proves insufficient — see §5 Open-Question resolution).
- **Explicitly out of scope:** everything under §1 Non-goals; all Phase B; unrelated Round-1 latency limiters (L1–L7) except where a WP already touches the same seam.

---

## 3. System Architecture

- **Graph basis:** none — Graphify disabled; grounded on PLAN.md discovery grounding + Round-1 `BUG_ANALYSIS.md`. Build date of grounding: 2026-07-17.
- **Frontend stack (client / plugin):** TypeScript Obsidian plugin (`plugin/src/`); CodeMirror 6 editor integration (`yCollab`); Yjs CRDT + y-protocols awareness; canvas presence is **net-new DOM overlay** against Obsidian's private Canvas view API.
- **Backend stack (relay / server):** TypeScript Node WebSocket relay (`server/src/`). Stateless / host-authoritative; per-doc read-only enforcement only (cannot decode a Yjs delta to a single node).
- **Data storage:** No DB for this scope. State is Yjs Y.Docs (per-file `content` Y.Text; per-canvas `__canvas__:path` with per-node `Y.Map`s) + on-disk `.md`/`.canvas` vault files. Lock/presence state is **ephemeral awareness** (never persisted — that is what makes it crash-safe).
- **External integrations:** NeuralAngels relay over two WebSocket transports per session — **MUX** (`/ws-mux`, Yjs sync + awareness, `sync.ts ⇄ ws-handler.ts`) and **CONTROL** (`/control`, file ops/presence/perms). This round works almost entirely on MUX + client-side canvas code.
- **Runtime environment:** Client = Obsidian (Electron). Relay = container in the NeuralAngels server stack. **No relay redeploy required for Phase A** (on-join awareness resolved client-side).
- **Key subsystems:**
  - Awareness lifecycle (`sync.ts`): outbound emit, join re-emit, heartbeat, reconnect clock-tick.
  - Editor cursor rendering (`collab.ts`, yCollab) — text carets.
  - Canvas sync + per-node diff/enforcement seam (`canvas-sync.ts`).
  - Canvas presence overlay (net-new file) + activation branch (`main.ts`).
  - Latency-tolerant disk flush (`background-sync.ts` text, `canvas-sync.ts` canvas).
- **Key architecture decisions (with rationale):**
  1. **One shared canvas-presence subsystem** — cursors, held-highlight, and lock state ride the *same* canvas-doc awareness channel + one new DOM overlay, built together. Rationale: they share the awareness field and overlay DOM; splitting them would triplicate wiring and re-introduce the file-conflict churn Round 1 hit.
  2. **Advisory client-side locking, not server mutual exclusion.** Rationale: the relay is stateless/host-authoritative and cannot decode a Yjs delta to one node; enforcement must live in the existing per-node diff path (`canvas-sync.ts:284-318`) via `canWriteNode`/`canDeleteNode`.
  3. **Lock rides Yjs awareness (auto-release on disconnect), not a persistent map.** Rationale: crash-safety is non-negotiable; a persistent lock map would strand locks forever on a crash.
  4. **Deterministic lowest-`clientID` tiebreak instead of a central arbiter (GAP-1/3).** Rationale: no server orders claims, so two clients can grab a card within one RTT; a deterministic client-side rule (lowest clientID / lowest Lamport clock wins, loser reverts) needs no server and is reproducible.
  5. **Delete-wins / never resurrect a remote-deleted node (GAP-2).** Rationale: matches mature-editor practice (Figma) and prevents a held card zombie-ing back forever.
  6. **Awareness hardening over symptom-patching (GAP-4/6).** Rationale: a full-state <30 s heartbeat + reconnect clock-tick + on-join full-state transfer fixes text *and* canvas cursor flakiness *and* keeps locks from stranding/splitting — one mechanism, many symptoms.
  7. **Hybrid lock acquisition (private Canvas API → diff-inferred fallback).** Rationale: private API gives best UX (lock on drag/edit-start) but is untyped/unstable, so the diff-inferred path (lock on first key change) must be a real, tested fallback.

---

## 4. Data Architecture

- **Primary data sources:** Yjs Y.Docs over MUX; on-disk vault `.md` / `.canvas` files; ephemeral y-protocols awareness state (text-doc awareness for carets; canvas-doc awareness for canvas presence/locks).
- **Core data models / schemas:**
  - **Canvas awareness field (new, single shared shape):**
    `{ canvasPath: string, nodeId: string | null, x: number, y: number, lockedNodes: { [nodeId: string]: { color: string, name: string } } }`
    Optionally extended with a lock-epoch: `lockedNodes[nodeId] = { color, name, epoch?: number }` (GAP-7 mitigation, P1).
  - **Canvas node:** existing per-node `Y.Map` keyed by node id (`canvas-sync.ts:182-183`) — the lock key.
  - **Canvas edge:** references two endpoint node ids — must never dangle after §US5 AC3 pruning.
  - **Text awareness:** existing yCollab caret/selection state (per-file Y.Text awareness).
- **Normalisation rules:** per-property (per-key) LWW on canvas node maps (already in-tree) — never whole-object overwrite. Presence (lossy) is kept separate from document data (ordered).
- **Consistency and integrity rules:**
  - Single deterministic lock holder per node after settle (no dual ownership).
  - Delete wins over concurrent edit; no resurrect of a remote-deleted node.
  - No edge may reference a non-existent node (prune on delete + on serialize).
  - Single-writer text invariant for the active file preserved (Round-1 `collabBoundFile`/active-file gating).
  - Awareness state is ephemeral and auto-clears on disconnect (crash-safe locks).
- **Data flow:** local edit/drag → optimistic lock claim on canvas awareness → ~1 RTT settle (tiebreak) → committed per-node CRDT write via diff path gated by `canWriteNode` → remote apply → overlay/highlight render from awareness. Disk flush is version/sequence-gated to yield to in-flight remote deltas.

---

## 5. Component Map

### sync.ts (awareness lifecycle)
- Change type: modify
- Responsibility: emit/join-re-emit/heartbeat/reconnect-tick of awareness for text (and plumbing reused by canvas awareness).
- Interfaces:
  - Input: local awareness state changes; MUX subscribe/sync-request events; reconnect events.
  - Output: MUX awareness frames (full local state incl. `lockedNodes`) at < 30 s cadence; on-join awareness transfer; clock-tick on reconnect.
- User stories: US1, US4
- Assigned to WP: WP1
- Anchors: create+outbound `sync.ts:132-157`; join/re-emit race `sync.ts:354-402` (fix null/static bail at `:392-402`); inbound apply `sync.ts:423-427`.

### collab.ts (editor caret rendering)
- Change type: modify (if needed for full-state/idle caret rendering)
- Responsibility: render remote text carets via yCollab.
- Interfaces: Input awareness state; Output CM6 caret decorations.
- User stories: US1
- Assigned to WP: WP1
- Anchors: editor-only cursor rendering `collab.ts:104-122`.

### server/ws-handler.ts + server/mux-protocol.ts + plugin/sync/mux-protocol.ts
- Change type: modify **only if** on-join replay is done server-side (P2, not planned for Phase A — see Open-Question resolution below).
- Responsibility: relay awareness/sync frames.
- Interfaces: MUX frames.
- User stories: US1
- Assigned to WP: WP1 (optional server path only)
- Anchors: relay per-doc read-only `ws-handler.ts:155-177,381-395`; disconnect awareness-removal already correct `ws-handler.ts:220-250`; ghost-caret fix live at `ws-handler.ts:236-237` (`lastClock+1`) — do not disturb.

### main.ts (activation + canvas branch)
- Change type: modify
- Responsibility: branch activation to `CanvasView` (today hard-returns for non-`MarkdownView`); wire canvas presence overlay.
- Interfaces: Input Obsidian view activation; Output canvas presence subscription + overlay mount.
- User stories: US2, US3
- Assigned to WP: WP2 (owns), WP3 (shares)
- Anchors: activation gated to MarkdownView `main.ts:749-802`; canvas subscribe already wired `main.ts:694-700`.

### canvas-presence overlay (NEW FILE — net-new)
- Change type: create
- Responsibility: DOM overlay rendering remote canvas cursors, here/typing indicators, and per-node held-highlight; reads canvas-doc awareness.
- Interfaces: Input canvas awareness state (`{ canvasPath, nodeId, x, y, lockedNodes }`); Output DOM markers/highlights on the canvas surface.
- User stories: US2, US3
- Assigned to WP: WP2 (owns), WP3 (held-highlight shares)
- Anchors: no canvas-view DOM code exists today — net-new against Obsidian's private Canvas API. (File path chosen by W3 within `plugin/src/`; not pre-invented here.)

### canvas-sync.ts (per-node diff/enforcement + lock + latency)
- Change type: modify
- Responsibility: expose canvas-doc awareness; per-node diff path is the lock-enforcement seam (`canWriteNode`/`canDeleteNode`); delete-wins/no-resurrect; version-gated flush.
- Interfaces:
  - Input local `.canvas` modifications; remote deltas; awareness lock state.
  - Output gated per-node CRDT writes; edge-prune on delete/serialize.
- User stories: US3, US4, US5
- Assigned to WP: WP2 (expose awareness), WP3 (lock gates + delete-wins), WP4 (version-gated flush + edge prune)
- Anchors: per-node maps `canvas-sync.ts:182-183`; diff/enforcement seam `:242-318` (esp. `:284-318`); resurrect bug to fix `:304-311`; disk-write funnel `:409-429`; per-key diff live `:104-119,300-303` (keep).

### background-sync.ts (text disk flush)
- Change type: modify
- Responsibility: version/sequence-gated text flush; preserve single-writer invariant.
- Interfaces: Input local text modify events; Output gated Y.Text writes.
- User stories: US5
- Assigned to WP: WP4
- Anchors: disk-write funnel `background-sync.ts:365-391`; active-file/`collabBoundFile` gating must stay intact.

### Latency E2E harness (NEW — tests)
- Change type: create
- Responsibility: two-client harness injecting 50–150 ms RTT; reproduces WP1–WP4 races red-first; regression assertions.
- Interfaces: Input configurable RTT; Output pass/fail per race scenario.
- User stories: US6
- Assigned to WP: WP5
- Anchors: extend existing vitest suites (`plugin/src/__tests__`, `server/src/__tests__`).

**Open-Question resolution (documented constraint/assumption, non-blocking):** On-join awareness transfer is resolved **client-side first — no relay redeploy**. Existing peers re-emit their full awareness state to a newly-subscribing client (per WP1), which closes the `null`/static-caret join race without touching the relay. Server-side replay (touching `ws-handler.ts` + `mux-protocol.ts`, triggering a redeploy) is a **P2 fallback**, adopted only if client-side hardening leaves residual flakiness after WP5 validation. This is an assumption, **not a blocker**, and is not escalated.

**Other §5 constraints/assumptions (from PLAN.md §Constraints):**
- Locking is **advisory-only + presence** — no server enforcement (Yjs delta opacity). Accepted.
- **No fencing token (GAP-7):** a GC-paused holder can push one stale delta after its lock auto-released and another peer reacquired. Accepted **bounded risk** — worst case per-key LWW clobber, not corruption. Optional lock-epoch/Lamport counter mitigates (US3 AC9, P1).
- **Crash-safe auto-release is non-negotiable** — lock must ride ephemeral awareness.
- Private Canvas API is **untyped/unstable** — the diff-inferred fallback must be a **real, tested path**, not a stub.
- **Single-writer text invariant** (Round-1 `collabBoundFile`/active-file gating in `background-sync.ts`) must stay intact.
- **Do not re-spend on already-fixed bugs:** ghost-caret (`ws-handler.ts:236-237` `lastClock+1`) and per-key canvas diff (`canvas-sync.ts:104-119,300-303`) are live in-tree; BUG_ANALYSIS "Bug C/D" are stale.
- **Protected infra untouched:** `neural-angels-access` and `n8n` never restarted; if any relay change is made, reuse the established build→save→scp→load→root-recreate deploy path (no `--remove-orphans`, `name: liveshare`, password + volume preserved, landing untouched); do **not** read `SERVER_PASSWORD`; coop console connects as `thomas` (not root); npm changes are `nginx -t`-gated. (Phase A expects no relay change.)

---

## 6. API and Interfaces

- **Endpoints / tool surfaces:** No new network endpoints in Phase A (client-side resolution). Transports unchanged: MUX (`/ws-mux`), CONTROL (`/control`).
- **New client interfaces (internal):**
  - Canvas awareness field: `{ canvasPath, nodeId|null, x, y, lockedNodes: {[nodeId]: {color, name, epoch?}} }`.
  - `canWriteNode(path, nodeId): boolean` — advisory gate in the per-node diff path; false while a lower-`clientID` peer also claims, or another peer holds the lock.
  - `canDeleteNode(path, nodeId): boolean` — false when another peer holds the node locked.
  - Lock acquire/release lifecycle (hybrid: private Canvas API detect → diff-inferred fallback) writing/clearing `lockedNodes`.
  - Awareness heartbeat: re-emit full local state at fixed interval < 30 s (target 10–15 s).
  - Reconnect clock-tick: `setLocalState(getLocalState())`.
- **Request / response structure:** MUX awareness frames carry `encodeAwarenessUpdate` payloads (existing mechanism); no wire schema change beyond richer local state content.
- **Authentication / authorization:** unchanged; advisory lock enforcement is per-node client-side, layered over existing per-doc read-only. No auth changes in Phase A.
- **Error cases and expected responses:**
  - Competing claim within one RTT → lowest-`clientID` wins; loser reverts + releases (no error surfaced; deterministic).
  - Remote delete of locked node → holder aborts edit, drops lock, no resurrect.
  - Remote lock arrives with un-flushed local edits → drop local edits.
  - Reconnect → do not blind-reassert locks; re-request `lockedNodes`, re-claim only still-free nodes.
- **Persistence behaviour:** lock/presence state is **never persisted** (ephemeral awareness → crash-safe). Document/canvas content persists via existing Yjs → disk flush, now version/sequence-gated.

---

## 7. Quality Gates

- **Lint / typecheck / test commands (exact commands W3 must run):**
  - Client: `cd plugin && npm run lint` (if present) · `npm run build` (tsc typecheck) · `npm test` (vitest).
  - Server: `cd server && npm run build` (tsc typecheck) · `npm test` (vitest).
  - W3 must confirm the exact script names against each `package.json` before running and use those; do not invent scripts.
- **Execution order:** typecheck/build → unit/integration tests → smoke → full E2E latency harness (WP5).
- **Abort criteria:** typecheck/build failure; any Round-1 regression test going red (single-writer, ghost-caret, per-key diff); a race AC that cannot be made green under injected latency.
- **Definition of Done (project-level):** all US1–US6 ACs satisfied; every GAP-1..GAP-7 AC (or documented bounded-risk acceptance for GAP-7) green under 50–150 ms RTT; no Round-1 regression; both artifacts' WP DoDs met.
- **Test framework and runner:** vitest (existing suites `plugin/src/__tests__`, `server/src/__tests__`), extended with the WP5 latency harness.
- **Active W4 test levels (read from `workflow.config.json` — current state):**
  - Smoke tests: **enabled** (`w4_smoke: true`)
  - Integration tests: **enabled** (`w4_integration: true`)
  - Full E2E: **enabled** (`w4_e2e_full: true`)
  - **Fix-as-failing-test (TDD rework): enabled** (`w4_fix_as_failing_test: true`) — every CRITICAL/HIGH fix ships a confirmed-red failing test for W3 to drive green.
- **Mandatory latency requirement:** the WP5 harness MUST inject simulated **50–150 ms RTT**; a zero-latency harness cannot reproduce these races and would give false green. Race assertions are only meaningful under injected latency.

---

## 8. Validation and Test Strategy

- **Test levels active:** smoke + integration + full E2E + fix-as-failing-test — all enabled (see §7).
- **Test data sources:** deterministic fixtures / fixed seeds / controlled injected delays. No ad-hoc LLM-generated data, no wall-clock `sleep`-based timing. Two-client scenarios use scripted Yjs docs and simulated RTT.
- **Known flaky areas (patterns to avoid):**
  - Wall-clock/`sleep`-based timing assertions — use the harness's controlled RTT + event hooks instead.
  - Order-dependent awareness frame assertions — assert on final converged state plus explicit frame-cadence checks, not incidental ordering.
  - Zero-latency runs used as proof (false green) — race assertions must run under injected latency.
  - Reconnect tests that assume a new `clientID` — assert single stable identity.

---

## 9. Work Package Breakdown

> Batching guidance for W3 (from PLAN.md §Batching note): **WP2 + WP3 share `canvas-sync.ts`, `main.ts`, and the new overlay file → one execution batch owned by one agent** (not parallel) to avoid file conflicts. **WP1 (`sync.ts`) and WP4 (`background-sync.ts`) are more file-disjoint and can run alongside.** WP5 depends on WP1–WP4 and runs after. W3 parallel threshold is 5 (per `workflow.config.json`); with 5 WPs but a mandatory 2+3 co-batch, expect ~3 execution lanes (WP1 | WP2+WP3 | WP4), then WP5.

### WP1 — Awareness latency-resistance
- **Status:** planned
- **Depends on:** none
- **Scope:** Heartbeat that re-emits **full local awareness state incl. `lockedNodes`** at a fixed interval **< 30 s** (target 10–15 s); on-join full awareness-state transfer to a newly-subscribing peer (existing peers re-emit); fix the `null`/static-state re-emit bail so a static caret is still transferred (`sync.ts:392-402`); **reconnect clock-tick** `setLocalState(getLocalState())` with **no blind lock re-assert** (re-request `lockedNodes`, re-claim only still-free nodes); ensure a reconnecting client keeps a single stable awareness identity.
- **Out of scope:** canvas overlay rendering (WP2); lock acquisition/tiebreak logic (WP3); disk-flush gating (WP4); server-side replay (P2, only if client-side proves insufficient).
- **User stories covered:** US1, US4
- **Acceptance Criteria:**
  1. New peer renders an existing static caret within ≤ 1000 ms of subscribing, symmetric both directions (US1 AC1/AC2). *(testable: two-client join, assert caret decoration exists ≤1000 ms, no caret movement)*
  2. A static caret survives > 30 s on all peers — no y-protocols prune (US1 AC3, **GAP-6**). *(testable: hold static 35 s, assert remote decoration present)*
  3. Heartbeat emits full local state (incl. `lockedNodes`) with inter-emit gap < 30 s even with zero local edits (US1 AC4, **GAP-6**). *(testable: capture outbound MUX awareness frames, assert cadence)*
  4. `reemitLocalAwareness` no longer bails on a static/non-moving caret; mid-sync joiner still receives it (US1 AC5). *(testable: join mid-sync, assert caret appears with no local movement)*
  5. On reconnect, awareness clock ticks so the caret re-renders on peers ≤ 1000 ms without typing (US1 AC6, **GAP-4**). *(testable: drop+restore socket, assert peer re-renders caret)*
  6. Reconnect produces exactly one awareness identity for the client — no ghost duplicate, no split lock (US1 AC7, US4 AC3/AC4, **GAP-4**). *(testable: assert exactly one awareness entry; a peer-acquired node is not reclaimed)*
  7. An idle-but-connected lock holder keeps its lock past 30 s because the heartbeat re-emits `lockedNodes` (US4 AC2, **GAP-6**). *(testable: hold lock idle 35 s, assert peers still see held + their `canWriteNode` false)*
- **Definition of Done:** Under WP5's 50–150 ms RTT harness: symmetric ≤1000 ms caret join, static-caret survival past 35 s, <30 s full-state heartbeat frames on the wire, reconnect caret re-visibility with a single identity, and idle-holder lock survival — all green; no Round-1 caret regression.
- **Key files:** `plugin/src/sync/sync.ts` (primary); `plugin/src/editor/collab.ts` (if caret rendering needs full-state/idle handling). Optional/P2 only if server replay is later required: `server/src/ws-handler.ts`, `server/src/mux-protocol.ts`, `plugin/src/sync/mux-protocol.ts`.
- **Architecture notes:** Do not disturb the live ghost-caret fix (`ws-handler.ts:236-237` `lastClock+1`). Heartbeat must NOT be short-circuited by `getLocalState()===null` when a caret is merely static. Provides the awareness plumbing WP2/WP3 consume; `lockedNodes` field shape is `{[nodeId]:{color,name,epoch?}}`. Client-side on-join transfer only (no relay redeploy).
- **Handover summary:** *(filled by W3 on completion)*

### WP2 — Canvas presence (cursors + here/typing indicator)
- **Status:** planned
- **Depends on:** WP1 (awareness plumbing)
- **Scope:** New canvas-presence module + **new DOM overlay file** rendering remote **cursors** and a typing/"here" indicator on the canvas surface; branch activation to `CanvasView` (today hard-returns for non-`MarkdownView` at `main.ts:749-802`); expose the canvas doc's awareness (`getDoc().awareness`) from `canvas-sync.ts`; write/read the shared awareness field `{ canvasPath, nodeId|null, x, y, lockedNodes }`.
- **Out of scope:** lock acquisition, tiebreak, enforcement, held-highlight *behavior* (WP3 — though WP3 reuses this overlay for the highlight rendering); disk-flush gating (WP4). Does not modify text-editor cursor rendering.
- **User stories covered:** US2 (and provides the overlay WP3's US3 highlight uses)
- **Acceptance Criteria:**
  1. Two clients on the same canvas each render the other's cursor as a DOM overlay marker that updates on movement (US2 AC1). *(testable: move cursor, assert peer marker coords change)*
  2. Each remote cursor marker carries the peer's color + name (US2 AC2). *(testable: assert overlay element color/name)*
  3. A here/typing indicator shows for a present/editing peer and is absent for a peer on a different canvas (US2 AC3). *(testable: assert indicator presence/absence)*
  4. Canvas presence renders with no CodeMirror editor active — activation branches to `CanvasView`, not hard-return (US2 AC4). *(testable: open canvas only, assert cursors render)*
  5. Closing the canvas / disconnecting removes the peer's marker within one heartbeat (US2 AC5). *(testable: disconnect peer, assert marker gone)*
  6. Emitted awareness state matches exactly `{ canvasPath, nodeId|null, x, y, lockedNodes }` (US2 AC6). *(testable: inspect emitted object shape)*
- **Definition of Done:** Two clients on one canvas see each other's live, identity-colored cursors + here/typing indicators via the canvas-doc awareness channel and the new overlay; markers vanish on leave — green under the latency harness.
- **Key files:** `plugin/src/main.ts` (activation branch + overlay mount); `plugin/src/files/canvas-sync.ts` (expose awareness); **new overlay file under `plugin/src/`** (path chosen by W3 — not pre-invented). Anchors: `main.ts:694-700,749-802`.
- **Architecture notes:** Net-new against Obsidian's **private, untyped Canvas view API** — isolate private-API access behind a thin adapter so WP3's acquisition can reuse it and the diff-inferred fallback stays clean. Shares the overlay DOM with WP3 (held-highlight) — build the overlay to accept both cursor markers and per-node highlights. **Co-batch with WP3 under one agent.**
- **Handover summary:** *(filled by W3 on completion)*

### WP3 — Per-card locking (acquisition, tiebreak, delete-wins, enforcement, highlight)
- **Status:** planned
- **Depends on:** WP2 (shared overlay + exposed canvas awareness)
- **Scope:** Hybrid lock acquisition (private Canvas API detect on drag/edit-start → **diff-inferred fallback**: lock on first node-key change); write lock to canvas awareness `lockedNodes` (auto-release on disconnect); **provisional-claim + lowest-`clientID` (or lowest Lamport clock) tiebreak with loser-revert** (GAP-1); **settle ~1 RTT / one heartbeat before committing a mutating write** (GAP-3, WP3 half); advisory `canWriteNode(path,nodeId)` **and** `canDeleteNode(path,nodeId)` gates wired into the per-node diff path (`canvas-sync.ts:284-318`); **delete-wins / no-resurrect** of a remote-deleted locked node (fix `canvas-sync.ts:304-311`); **colored "held" highlight** rendered via WP2's overlay; **optional** lock-epoch/Lamport counter (GAP-7, P1).
- **Out of scope:** cursor/indicator rendering primitives (WP2 owns the overlay); text-flush/edge-prune (WP4); on-reconnect lock re-request plumbing (WP1 owns the reconnect path — WP3 supplies the "re-claim only still-free" policy it calls).
- **User stories covered:** US3, US4 (lock lifecycle)
- **Acceptance Criteria:**
  1. Begin edit/drag → `lockedNodes[nodeId]={color,name}` set and every peer highlights the node in the holder's color (US3 AC1). *(testable: assert peer overlay highlight color)*
  2. Hybrid acquisition works with the private API forcibly absent — diff-inferred fallback still acquires on first key change; fallback is real, not a stub (US3 AC2). *(testable: stub out private API, assert lock acquired on first key change)*
  3. Two claims within one RTT → lowest-`clientID` wins; loser reverts optimistic edit + releases; exactly one holder, no dual ownership (US3 AC3, **GAP-1**). *(testable: two-client one-RTT claim, assert winner=lowest id, loser lockedNodes cleared + edit rolled back)*
  4. Claim is pending ~1 RTT/one heartbeat before a mutating write; a competing lower-id claim in that window aborts the local mutation — loser makes no committed CRDT write (US3 AC4, **GAP-3**). *(testable: assert loser performs no node CRDT write)*
  5. `canWriteNode` returns false while a lower-id peer claims or another peer holds the lock; diff path drops such writes (US3 AC5). *(testable: non-holder edit produces no CRDT change to the node)*
  6. Lock holder observing a remote delete of its locked node aborts, drops lock, does **not** resurrect (US3 AC6, **GAP-2**). *(testable: remote-delete while locked+edited, assert node stays deleted + lock released)*
  7. `canDeleteNode` blocks deleting a peer-held node (US3 AC7, **GAP-2**). *(testable: attempted delete of peer-held node dropped, node still present + locked)*
  8. Release (end drag/edit/blur) clears `lockedNodes[nodeId]` + highlight on all peers within one heartbeat (US3 AC8). *(testable: end edit, assert peers un-highlight)*
  9. If lock-epoch implemented: a superseded resumed holder self-aborts its stale write; if not, GAP-7 bounded risk is documented (§5) with no AC failing on its absence (US3 AC9, **GAP-7**). *(testable only when epoch field present)*
- **Definition of Done:** Two clients contending for one card converge to a single deterministic holder with the loser reverted; held card shows holder's color on peers; delete-wins + `canDeleteNode` prevent resurrection/clobber; locks release on end-edit — all green under 50–150 ms RTT.
- **Key files:** `plugin/src/files/canvas-sync.ts` (lock gates, delete-wins, expose/consume awareness); `plugin/src/main.ts` (drag/edit-start hooks); the WP2 overlay file (held-highlight). Anchors: `canvas-sync.ts:182-183,242-318` (esp. `:284-318`), resurrect fix `:304-311`.
- **Architecture notes:** Locking is **advisory + presence** — never server-enforced. Lock **must** ride ephemeral awareness (crash-safe auto-release — non-negotiable). Reuse WP2's private-Canvas-API adapter; the diff-inferred fallback must be a tested path. Tiebreak is deterministic and server-free. **Co-batch with WP2 under one agent** (shared `canvas-sync.ts`/`main.ts`/overlay).
- **Handover summary:** *(filled by W3 on completion)*

### WP4 — Latency-tolerant editing (version-gated flush, drop-unflushed, edge prune)
- **Status:** planned
- **Depends on:** none
- **Scope:** Make the local text/canvas disk-flush **yield to in-flight remote deltas** via a version/sequence gate (not wall-clock debounce racing); on receiving a **remote lock** for a node with un-flushed local edits, **drop those edits rather than push them** (GAP-3, WP4 half); **cascade/prune dangling edges** whose endpoint node was concurrently deleted, and prune dangling edges on serialize (GAP-5); close the remaining canvas guest-text-loss clobber window; keep the Round-1 single-writer text invariant intact.
- **Out of scope:** lock acquisition/tiebreak (WP3 — WP4 only *reacts* to a remote lock); awareness heartbeat/reconnect (WP1); canvas overlay (WP2). Does not re-touch already-fixed per-key diff behavior beyond the reconcile-clobber window.
- **User stories covered:** US5
- **Acceptance Criteria:**
  1. A local whole-file flush yields to an in-flight remote delta not yet applied locally — remote change survives, not clobbered (US5 AC1). *(testable: inject in-flight remote delta during local flush, assert remote change persists)*
  2. Remote lock for a node with un-flushed local edits → local edits dropped, not pushed (US5 AC2, **GAP-3**). *(testable: assert un-flushed edit discarded, holder value stands)*
  3. Deleting an endpoint node (local or remote) prunes its edges; no serialized edge references a non-existent node (US5 AC3, **GAP-5**). *(testable: delete endpoint node, assert serialized .canvas has no dangling edge)*
  4. Round-1 single-writer text invariant preserved — frontmatter/single-writer regression tests stay green, no Bug B reintroduction (US5 AC4). *(testable: re-run Round-1 regression suite green)*
  5. No reintroduction of ghost-caret or per-key canvas diff regressions (US5 AC5). *(testable: Round-1 tests green)*
- **Definition of Done:** Under 50–150 ms RTT, guest in-flight canvas node/text edits survive concurrent host/guest writes (version-gated flush + drop-on-remote-lock), edges never dangle, and no Round-1 fix regresses — all green.
- **Key files:** `plugin/src/files/background-sync.ts` (text flush gate; anchor `:365-391`); `plugin/src/files/canvas-sync.ts` (canvas reconcile/flush gate + edge prune; anchors `:242-318,409-429`).
- **Architecture notes:** Version/sequence gate — do not rely on wall-clock debounce for ordering. Preserve `collabBoundFile`/active-file gating (single-writer invariant). Shares `canvas-sync.ts` with WP2/WP3 but on the flush/reconcile seam rather than the lock/awareness seam — W3 must coordinate edits within `canvas-sync.ts` if run alongside the WP2+WP3 batch; otherwise sequence WP4 after the co-batch. File-disjoint enough (owns `background-sync.ts`) to run alongside WP1.
- **Handover summary:** *(filled by W3 on completion)*

### WP5 — Latency E2E harness
- **Status:** planned
- **Depends on:** WP1, WP2, WP3, WP4
- **Scope:** Two-client E2E harness injecting a configurable **50–150 ms RTT**; reproduce (as red-first tests, fix-as-failing-test ON) WP1–WP4 symptoms: same-card claim in one tick → tiebreak, delete-vs-lock (no resurrect), idle-holder > 30 s lock survival, reconnect no-split-lock, guest canvas text/node survival under concurrent write; regression assertions mapping each race AC → test id.
- **Out of scope:** implementing the fixes (WP1–WP4). Does not add production code beyond test scaffolding/harness utilities.
- **User stories covered:** US6
- **Acceptance Criteria:**
  1. Harness injects configurable RTT in 50–150 ms; measured round-trip within band (US6 AC1). *(testable: assert applied delay)*
  2. Named red-first tests exist for: (a) same-card one-tick tiebreak, (b) delete-vs-lock no-resurrect, (c) idle-holder >30 s lock survival, (d) reconnect no-split-lock, (e) guest canvas text/node survival — failing pre-fix, passing post-fix (US6 AC2). *(testable: each test present; red on pre-fix tree)*
  3. Each race-describing WP1–WP4 AC has a corresponding harness assertion (AC→test mapping present) (US6 AC3). *(testable: mapping exists)*
  4. Harness is deterministic — fixed seeds/controlled delays, repeatable, no timing flakiness (US6 AC4). *(testable: repeated runs stable)*
  5. Zero-latency run is not treated as proof — race assertions skip/annotate when RTT=0; latency path is gating (US6 AC5). *(testable: assert race assertions skipped at RTT 0)*
- **Definition of Done:** A deterministic 50–150 ms RTT two-client harness reproduces every targeted race red-first and asserts each fix, providing the regression net for WP1–WP4 — full E2E green.
- **Key files:** extend `plugin/src/__tests__` and `server/src/__tests__` (vitest); new harness utility file(s) under the test tree (path chosen by W3).
- **Architecture notes:** Localhost (≈0 ms) hides these races — injected latency is mandatory (§7). Use controlled delays + event hooks, never wall-clock `sleep`. Deterministic seeds; assert on converged state + explicit frame-cadence, not incidental ordering.
- **Handover summary:** *(filled by W3 on completion)*

---

## 10. Operational Rules

- **Logging:** reuse the existing `DebugLogger`; do not add noisy per-frame awareness logging in hot paths (heartbeat/cursor-move). Gate any new verbose logs behind the existing debug level.
- **Monitoring:** none new in Phase A. Race behavior is observed through the WP5 harness, not runtime telemetry.
- **Recovery / backups:** lock/presence state is ephemeral and self-heals on reconnect (clock-tick, re-request `lockedNodes`); document content recovers via existing Yjs CRDT convergence + disk flush. No new persistence to back up.
- **Security and access rules:** advisory per-node gate layers over existing per-doc read-only; no auth changes. Protected infra untouched (`neural-angels-access`, `n8n` never restarted); no `SERVER_PASSWORD` reads; coop console as `thomas`; npm/relay changes (not expected in Phase A) are `nginx -t`-gated and use the established deploy path.

---

## 11. Repeated-Action Signals and Automation Candidates

Filled progressively as W3 runs.

| Repeated action | Tool / command | Frequency | Friction / failure | Automation candidate |
|---|---|---|---|---|
| | | | | |

---

## Worker 2 Checklist

- [x] Project overview and non-goals aligned with PLAN.md?
- [x] USER_STORIES.md written with all stories expanded from PLAN.md (6 stories)?
- [x] All stories have numbered, observable ACs and a definition of done?
- [x] All components in scope defined with interfaces and US/WP references?
- [x] Every WP in Section 9 has scope, out-of-scope, ACs, DoD, and US references?
- [x] Every AC is observable and testable (no interpretation gaps)?
- [x] Architecture decisions documented with rationale?
- [x] Data models and flows complete?
- [x] API surfaces fully specified?
- [x] Quality gates and active W4 levels documented in Section 7 (smoke + integration + full E2E + fix-as-failing-test all TRUE)?
- [x] Graph basis noted ("none — Graphify disabled")?
- [x] GAP-1..GAP-7 folded into concrete testable ACs (WP1: GAP-4/6; WP3: GAP-1/2/3/7; WP4: GAP-3/5)?
- [x] Open Question resolved client-side (no relay redeploy) as a §5 assumption, not escalated?
- [x] BUILD_SPEC saved as `obsidian-live-share/workflowArtifacts/BUILD_SPEC_ObsidianLiveShare.md`?
- [x] Both BUILD_SPEC and USER_STORIES.md paths returned to Dispatcher?
