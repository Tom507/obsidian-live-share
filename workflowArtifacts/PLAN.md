# Plan: Obsidian Live Share — Latency-Resistance, Canvas Presence & Per-Card Locking

Generated: 2026-07-17
Task: Make multiplayer reliable under real network latency — fix intermittent/absent
cursors (text + canvas), stop canvas guest-text loss, and add per-card locking with a
colored "held" indicator. Scoped to **Phase A** (no external dependencies). Phase B
(OIDC / headless host / admin UI / status console) is captured as a decided direction
for a later planning round.

> Round 2 of the Dynamic Atomic Orchestrator for this repo. Round 1 (`BUG_ANALYSIS.md`)
> fixed bugs A–I + L1–L7. This round targets the **latency-exposed races** those fixes
> didn't fully close and the newly reported canvas symptoms.

---

## Grounding: why these bugs exist (root causes, code-verified)

Confirmed by 4-way parallel code review. The unifying finding matches the user's own
observation — **on localhost (≈0 ms RTT) everything works; only real network latency
breaks it** → these are timing/ordering races, not logic errors.

- **Text cursor intermittent** — awareness is emitted *only* on local change (no
  heartbeat); `reemitLocalAwareness` (`plugin/src/sync/sync.ts:392-402`) bails when the
  local state is still `null`, so a peer joining during the ~1 s sync/text-wait window
  never receives a static caret; and `y-protocols` prunes any remote after 30 s of no
  renewal. At 0 ms none of these windows are open.
- **Canvas cursors / typing cursor absent** — awareness rendering is bound *exclusively*
  to the CodeMirror editor (`plugin/src/editor/collab.ts`, `yCollab`). The canvas view is
  not a CM editor; the canvas Y.Doc *has* an awareness channel (`getDoc().awareness`) but
  nothing ever writes to or reads from it. Activation hard-returns for non-`MarkdownView`
  (`plugin/src/main.ts:749-802`).
- **Guest text deleted in canvas** — a remaining reconcile-clobber window: the local
  whole-file flush races ahead of an in-flight remote delta and overwrites it
  (`plugin/src/files/canvas-sync.ts` diff path; `plugin/src/files/background-sync.ts` for
  text). The debounce cap helps but doesn't order the two writers.

**Per-card locking is the structural fix** for the whole same-card edit-race class:
- Canvas nodes are already per-node `Y.Map`s (`canvas-sync.ts:182-183`) — ideal lock keys.
- Lock state should ride the **canvas doc's Yjs awareness** — it **auto-releases on
  disconnect** (crash-safe; a persistent lock map would strand locks forever).
- Enforcement is **client-side/advisory + presence**: the server can't decode a Yjs
  delta down to one node, so the gate lives in the existing per-node diff path
  (`canvas-sync.ts:284-318`) via a new `canWriteNode(path, nodeId)` predicate.

---

## User Story Sketch

1. As a **collaborator**, I always see everyone's text caret/selection within a second of
   opening a shared note — and it doesn't vanish while they sit still — so I know who's
   where even over a real internet link.
2. As a **collaborator on a canvas**, I see other people's cursors and a "typing/here"
   indicator on the canvas, so canvas feels as alive as text notes.
3. As a **collaborator**, when I start editing or moving a card, everyone else sees it
   **locked with my color** and cannot edit or move it until I'm done — so our changes
   never clobber each other.
4. As a **collaborator**, if the person holding a card crashes or drops offline, the lock
   **releases automatically** so the card never gets stuck.
5. As a **guest editing a canvas over the network**, my text and nodes are **not silently
   deleted** by the host's or another guest's concurrent write.
6. As a **maintainer**, the fixes are validated under **simulated latency (50–150 ms
   RTT)**, because localhost hides exactly these races.

## Tech / Approach Decisions

- **One shared canvas-presence subsystem.** Canvas cursors, the per-node "held" highlight,
  and lock state all ride the *same* canvas-doc awareness channel + one new DOM overlay.
  They are built together, not as three features. New awareness field shape:
  `{ canvasPath, nodeId|null, x, y, lockedNodes: {[nodeId]: {color, name}} }`.
- **Locking = hybrid acquisition** (user decision): try Obsidian's private Canvas view API
  to lock on drag/edit-start (best UX); **fall back to diff-inferred** locking (lock the
  instant a card's keys first change) if that internal API is unstable. Enforcement stays
  advisory in the per-node diff path regardless of how the lock was acquired.
- **No central arbiter → deterministic client-side tiebreak** (from adversarial research,
  GAP-1/3). Our relay is stateless/host-authoritative, so — unlike Figma/Miro — no server
  orders lock claims. Two clients can grab the same card within one RTT and both believe
  they own it. Resolution: acquisition is **optimistic but provisional** — a claim is
  published, then treated as *pending for ~1 RTT/one heartbeat*; if a competing claim is
  seen, **lowest `clientID` (or lowest awareness Lamport clock) wins** and the loser
  reverts its optimistic edit and releases. `canWriteNode` returns false while a
  lower-id peer also claims the node. Deterministic, needs no server.
- **Delete wins over edit; never resurrect a remote-deleted node** (GAP-2). Round 1's diff
  path currently *re-creates* a node that was remote-deleted but locally changed
  (`canvas-sync.ts:304-311`). That contradicts Figma's "delete wins" and, with locking,
  lets a held card zombie back forever. New rule: a lock holder that observes a remote
  delete of its node **aborts the edit, drops the lock, does not resurrect**; and peers
  must not delete a node another peer holds locked (`canDeleteNode` guard).
- **Awareness hardening over patching symptoms** (GAP-4/6). Add (a) a periodic awareness
  re-broadcast heartbeat that re-emits the **full local state including `lockedNodes`** at
  a **<30 s interval (≈10–15 s)** so y-protocols' 30 s prune can't silently drop an idle
  holder's lock, and that is **not** short-circuited by the `getLocalState()===null` bail
  when a caret is merely static; (b) full awareness-state transfer to a newly-joined peer;
  (c) on **reconnect**, tick the clock via `setLocalState(getLocalState())` (documented
  y-websocket #122 fix) and **do not blindly re-assert previously-held locks** — re-request
  current `lockedNodes` and only re-claim nodes still free. This fixes text + canvas cursor
  flakiness *and* keeps locks from stranding/splitting. Server-side replay is optional (see
  Open Questions); client-side hardening comes first.
- **Latency-tolerant editing.** Make the local text/canvas disk-flush **yield to in-flight
  remote deltas** (version/sequence gate) instead of racing on wall-clock debounce timers;
  additionally, on receiving a remote lock for a node with un-flushed local edits, **drop
  those edits rather than push them** (GAP-3). Cascade-prune edges whose endpoint node was
  concurrently deleted, and prune dangling edges on serialize (GAP-5).
- **Test under injected latency.** E2E must simulate 50–150 ms RTT; a zero-latency harness
  cannot reproduce any of these and would give false green.

## Constraints

- **No relay redeploy required for Phase A** unless the awareness on-join replay is done
  server-side (WP1 may touch `server/src/ws-handler.ts`); if so, reuse the established
  build→save→scp→load→root-recreate deploy path (no `--remove-orphans`, `name: liveshare`,
  password + volume preserved, landing untouched). Do **not** read `SERVER_PASSWORD`.
- **Protected infra untouched**: `neural-angels-access` and `n8n` never restarted; npm
  changes `nginx -t`-gated; coop console connects as `thomas` (not root).
- Locking must be **crash-safe** (auto-release on disconnect) — non-negotiable.
- Per-card lock cannot be server-enforced (Yjs delta opacity) — advisory + presence only.
- **No fencing token** (GAP-7, inherent to the stateless-relay + advisory model): a
  GC-paused holder can push one stale delta after its lock auto-released and another peer
  reacquired. Accepted as **bounded risk** — worst case is a per-key LWW clobber, not
  corruption. Optional mitigation: a lock-epoch/Lamport counter in the lock value so a
  resumed holder self-aborts on a superseded lock. True fencing is out of scope for Phase A.
- Private Canvas API is **untyped/unstable** — the diff-inferred fallback must be a real,
  tested path, not a stub.
- Keep the single-writer text invariant intact (Round 1's `collabBoundFile` /
  active-file gating in `background-sync.ts`).
- **Do not re-spend on already-fixed bugs**: research confirmed Round-1's ghost-caret
  (`ws-handler.ts:236-237` uses `lastClock+1`) and per-key canvas diff
  (`canvas-sync.ts:104-119,300-303`) are live in-tree. BUG_ANALYSIS "Bug C/D" are stale.

## Discovery Grounding

Key structural findings that shape the WPs (file:line):
- Awareness create + sole outbound handler: `sync.ts:132-157`; join/re-emit race:
  `sync.ts:354-402`; inbound apply: `sync.ts:423-427`.
- Editor-only cursor rendering: `collab.ts:104-122`; activation gated to MarkdownView:
  `main.ts:749-802`; canvas subscribe already wired: `main.ts:694-700`.
- Canvas per-node maps + diff path (lock/enforcement seam): `canvas-sync.ts:182-183,
  242-318`; disk-write funnels: `canvas-sync.ts:409-429`, `background-sync.ts:365-391`.
- Server per-doc read-only enforcement (not per-node): `ws-handler.ts:155-177, 381-395`;
  disconnect awareness-removal already correct: `ws-handler.ts:220-250`.
- No canvas-view interaction or DOM code exists today — cursors, highlight, and
  lock-on-drag are all net-new against Obsidian's private Canvas API.

## Work Package Sketch (Phase A)

| WP | Title | Scope summary | Depends on |
|---|---|---|---|
| WP1 | Awareness latency-resistance | Heartbeat re-emitting **full local state incl `lockedNodes`** at <30 s + on-join full awareness-state transfer + fix `null`-state re-emit race (don't bail on a static caret) + **reconnect clock-tick** (`setLocalState(getLocalState())`) & no-blind-lock-reassert. Fixes intermittent **text** cursor; makes locks survive idle/reconnect (GAP-4/6). `sync.ts`, poss. `server/ws-handler.ts` + `mux-protocol.ts`, `collab.ts`. | — |
| WP2 | Canvas presence | New canvas-awareness module + DOM overlay: remote **cursors** + typing/"here" indicator + per-node highlight. `CanvasView` branch in activation. New file(s), `main.ts`, `canvas-sync.ts` (expose awareness). | WP1 |
| WP3 | Per-card locking | Hybrid acquisition (private Canvas API + diff-inferred fallback); lock on canvas awareness (auto-release); **provisional-claim + lowest-`clientID` tiebreak with loser-revert** (GAP-1/3); **settle ~1 RTT before mutating**; advisory `canWriteNode` **and `canDeleteNode`** gates; **delete-wins: no resurrect of a remote-deleted locked node** (GAP-2); **colored locked-card highlight** (shares WP2 overlay); optional lock-epoch counter (GAP-7). | WP2 |
| WP4 | Latency-tolerant editing | Local text/canvas flush yields to in-flight remote deltas (version/seq gate); **drop un-flushed local edits when a remote lock for that node arrives** (GAP-3); **cascade/prune dangling edges** on node delete + serialize (GAP-5); close remaining canvas guest-text-loss clobber. `background-sync.ts`, `canvas-sync.ts` reconcile path. | — |
| WP5 | Latency E2E harness | Simulated 50–150 ms RTT two-client tests reproducing WP1–WP4 symptoms **incl. the lock races**: same-card-in-one-tick tiebreak, delete-vs-lock, idle-holder >30 s lock survival, reconnect no-split-lock. Regression assertions. (Test level per `workflow.config.json`.) | WP1–WP4 |

> **Batching note (for W2/Dispatcher):** WP2 and WP3 share `canvas-sync.ts`, `main.ts`, and
> the new overlay file → almost certainly **one execution batch owned by one agent** (not
> parallel), to avoid the file conflicts Round 1 had to re-partition around. WP1 (`sync.ts`)
> and WP4 (`background-sync.ts`) are more file-disjoint and can run alongside.

## Open Questions

- WP1 on-join awareness transfer: **server-side replay** (touches relay → a redeploy) vs
  **client-side** (peer re-emit hardened, no redeploy). Recommendation: client-side first
  (no redeploy, closes the `null`-race), add server replay only if flakiness persists.
  → resolve in W2 spec.
- None blocking approval.

## Race-Hardening Provenance (adversarial research)

Web study of how mature collaborative canvases handle these races (Figma, tldraw,
Excalidraw, Liveblocks, Yjs/y-protocols issues, distributed-locking/fencing literature),
each classified against our code + plan. Gaps folded into the WPs above:

| Gap | Race | Fold-in |
|---|---|---|
| GAP-1 | Two clients grab the same card in one RTT — no arbiter | WP3 provisional-claim + lowest-`clientID` tiebreak |
| GAP-2 | Remote delete of a locked node → diff *resurrects* it | WP3/WP4 delete-wins, `canDeleteNode`, no-resurrect |
| GAP-3 | Lock broadcast unordered vs first edit delta | WP3 settle-before-edit + WP4 drop-unflushed-on-remote-lock |
| GAP-4 | Reconnect re-asserts stale lock / clock doesn't advance | WP1 clock-tick + no-blind-reassert |
| GAP-5 | Dangling edge when endpoint node concurrently deleted | WP4 cascade/prune edges |
| GAP-6 | Idle >30 s → y-protocols prunes lock-bearing awareness | WP1 full-state heartbeat <30 s, no null-bail |
| GAP-7 | No fencing token → resumed-holder stale write | Constraints: accepted bounded risk (opt. lock-epoch) |

Best-practice principles adopted: separate lossy presence from ordered document data;
per-property (not per-object) LWW; delete wins / never write to a deleted object; locking
is a presence-layer UX pattern (auto-release), not mutual exclusion; always send full
awareness state to late joiners; re-announce + tick clock on reconnect; sessions should
outlive brief socket blips.

Primary sources: Figma "How multiplayer works" + "Making multiplayer more reliable";
tldraw & Excalidraw collaboration/reconciliation docs; Yjs awareness docs + y-protocols#7 /
y-websocket#122,#47 / yjs#591,#622,#642; Liveblocks Storage-vs-Presence; fencing-token
literature (advisory locks ≠ mutual exclusion).

---

## Appendix — Phase B (deferred, direction decided)

Not planned in detail this round; captured so intent isn't lost. To be expanded in a
future Phase 1 round once NA-Access OIDC endpoints exist.

- **OIDC as primary auth** — rework `server/src/github-auth.ts:verifyJWT` to validate
  NA-Access tokens (RS256/JWKS) + emit a `role` claim; flip `REQUIRE_GITHUB_AUTH` to
  require. Plugin: repoint existing `AuthManager` + settings login button to NA-Access.
  Reuses existing `?jwt=` seams — **small**.
- **Headless persistent host = standalone Node host** (decided) — reuse the Obsidian-free
  sync core behind an `FsVault` shim over a **git working tree**; co-located as a second
  process in the server stack; connects to the relay as an always-on client; pins a stable
  JWT `hostUserId` so host-election never demotes it. ~1,500 LOC reused, ~1,000 new.
- **Admin control = web UI on server** (decided) — NA-authenticated admin web UI driving a
  new `adminRouter` on the relay: start/stop sessions (rooms), per-file lock toggles
  (existing `readOnlyPatterns`/`setPermission`), monitoring (`getStats` + audit log). One
  new "kick-all" per-room primitive needed.
- **In-Obsidian status console** — new log `ItemView` (model on `PresenceView`) backed by
  an extended `DebugLogger` (ring buffer + level filter; today it's file-only).
