// WP2 + WP3 — canvas presence + per-card advisory locking, riding the canvas
// doc's OWN Yjs awareness channel (crash-safe: awareness auto-clears on
// disconnect, so a held lock can never strand). This module:
//   * writes/reads the single shared awareness field
//       { canvasPath, nodeId|null, x, y, lockedNodes: {[id]:{color,name,epoch?}} }
//   * acquires locks hybrid: private Canvas API (adapter) → DIFF-INFERRED FALLBACK
//   * WP120: gives the DIFF-INFERRED half of that a LIFETIME. It is the only
//     acquisition path with no gesture to end it, so without one the claim is
//     permanent, and with a session-fixed clientID tiebreak the higher-id peer
//     then loses every contest on every card it has ever touched, forever.
//   * resolves the lowest-clientID tiebreak with loser-revert (GAP-1)
//   * exposes advisory canWriteNode / canDeleteNode gates (wired into the
//     canvas-sync per-node diff path)
//   * drives the shared DOM overlay (cursors, here/typing, held-highlight)
//
// The race-critical decisions are extracted as PURE functions (computeCanWriteNode,
// computeCanDeleteNode, resolveHolder, resolveCursors, resolveHighlights) so they
// are deterministically unit-testable without any transport or DOM.

import type { CanvasAdapter } from "./canvas-adapter";
import type { CanvasOverlay, CursorMarker, HeldHighlight } from "./canvas-overlay";

// Reconnect re-claim settle window: how long a returning lock-holder WITHHOLDS
// its locks and waits for peers' awareness to re-sync before re-claiming only
// still-free nodes (US4 AC3/AC4, GAP-4). ~1 heartbeat/RTT — it must exceed the
// resubscribe → peer-reemit round trip so a node a peer grabbed during the
// outage is visible before we decide, yet stay well under a second.
const RECONNECT_RECLAIM_DEFER_MS = 250;

/**
 * WP120 — WHERE A CLAIM COMES FROM DECIDES WHETHER IT CAN BE RETIRED.
 *
 *   `"gesture"`  the user is provably holding the card: the private Canvas API
 *                reported a selection or a drag (`canvas-adapter.ts:845 emitHeld`
 *                -> `onNodeInteractionStart`). Its release is the interaction END,
 *                which that same `held` set issues. **Never expired** — expiring
 *                one would drop the ring off a card the user has in hand and give
 *                it to somebody else mid-gesture, which is worse than the leak.
 *   `"inferred"` the capture path noticed the local diff touched this node
 *                (`files/canvas-sync.ts:4130` -> `main.ts:2505` ->
 *                {@link CanvasPresence.onDiffInferredChange}). `emitHeld` can only
 *                release ids it put into `held` itself, so this claim has **no**
 *                gesture that ends it — which is exactly the leak WP120 repairs.
 */
export type LockOrigin = "gesture" | "inferred";

/**
 * WP120 — the idle window after which a DIFF-INFERRED claim is retired.
 *
 * Derived from the capture cadence rather than picked: local capture runs on a
 * `DEBOUNCE_MS = 200` trailing debounce with a `MAX_WAIT_MS = 500` cap
 * (`files/canvas-sync.ts:318-319`), so a user who is still working on a card
 * re-touches its claim at least twice a second and refreshes it. 15 s is 30x that
 * worst-case cap — far outside anything a continuing interaction can produce, and
 * far short of a session. It is also comfortably inside y-protocols' 30 s awareness
 * prune window, so a claim is retired by its own idleness before the transport
 * would drop the whole state carrying it.
 */
export const INFERRED_LOCK_IDLE_MS = 15_000;

export interface LockEntry {
  color: string;
  name: string;
  // GAP-7 (P1, optional): monotonic lock epoch. Present in the shape but not
  // used for stale-write self-abort in this build — see the WP3 report for the
  // documented bounded-LWW risk acceptance (BUILD_SPEC §5).
  epoch?: number;
}

export interface CanvasAwarenessState {
  canvasPath: string;
  nodeId: string | null;
  x: number;
  y: number;
  lockedNodes: Record<string, LockEntry>;
}

export interface PeerIdentity {
  clientId: number;
  name: string;
  color: string;
}

// Structural subset of y-protocols Awareness that we depend on. Keeps the module
// testable with a hand-built states map.
export interface AwarenessLike {
  clientID: number;
  getLocalState(): Record<string, unknown> | null;
  setLocalState(state: Record<string, unknown> | null): void;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: "change" | "update", cb: () => void): void;
  off(event: "change" | "update", cb: () => void): void;
}

function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readCanvasState(raw: unknown): CanvasAwarenessState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<CanvasAwarenessState>;
  if (typeof s.canvasPath !== "string") return null;
  return {
    canvasPath: s.canvasPath,
    nodeId: typeof s.nodeId === "string" ? s.nodeId : null,
    x: typeof s.x === "number" ? s.x : 0,
    y: typeof s.y === "number" ? s.y : 0,
    lockedNodes:
      s.lockedNodes && typeof s.lockedNodes === "object"
        ? (s.lockedNodes as Record<string, LockEntry>)
        : {},
  };
}

// ---- Pure decision functions (deterministic, transport-free) ---------------

/** clientIds (incl. possibly `localId`) currently holding `nodeId` on `path`. */
export function holdersOf(
  path: string,
  nodeId: string,
  states: Map<number, Record<string, unknown>>,
): number[] {
  const holders: number[] = [];
  for (const [clientId, raw] of states) {
    const cs = readCanvasState(raw);
    if (!cs || cs.canvasPath !== path) continue;
    if (hasKey(cs.lockedNodes, nodeId)) holders.push(clientId);
  }
  return holders;
}

/**
 * Advisory write gate (US3 AC5). FALSE while a lower-id peer also claims the node
 * OR another peer holds it. TRUE when the node is free, or when the local client
 * is the deterministic winner (lowest clientID among all holders — GAP-1 tiebreak).
 */
export function computeCanWriteNode(
  localId: number,
  path: string,
  nodeId: string,
  states: Map<number, Record<string, unknown>>,
): boolean {
  const holders = holdersOf(path, nodeId, states);
  if (holders.length === 0) return true; // free node
  const minHolder = Math.min(...holders);
  // Local client may write only if it is (a) a holder and (b) the lowest id.
  return holders.includes(localId) && localId === minHolder;
}

/**
 * Advisory delete gate (US3 AC7 / GAP-2). FALSE when ANY other peer holds the
 * node locked (you cannot delete a card someone else is holding).
 */
export function computeCanDeleteNode(
  localId: number,
  path: string,
  nodeId: string,
  states: Map<number, Record<string, unknown>>,
): boolean {
  const holders = holdersOf(path, nodeId, states);
  return holders.every((id) => id === localId);
}

/** Winner (lowest clientID) among the current holders, or null if none. */
export function resolveHolder(
  path: string,
  nodeId: string,
  states: Map<number, Record<string, unknown>>,
): number | null {
  const holders = holdersOf(path, nodeId, states);
  return holders.length ? Math.min(...holders) : null;
}

/** Remote cursor markers for peers present on `path` (excludes the local client). */
export function resolveCursors(
  localId: number,
  path: string,
  states: Map<number, Record<string, unknown>>,
): CursorMarker[] {
  const cursors: CursorMarker[] = [];
  for (const [clientId, raw] of states) {
    if (clientId === localId) continue;
    const cs = readCanvasState(raw);
    if (!cs || cs.canvasPath !== path) continue; // AC3: absent for peers elsewhere
    const identity = (raw as { identity?: PeerIdentity }).identity;
    cursors.push({
      clientId,
      x: cs.x,
      y: cs.y,
      color: identity?.color ?? "#888888",
      name: identity?.name ?? `peer-${clientId}`,
      typing: cs.nodeId !== null, // editing a node ⇒ "typing"
    });
  }
  return cursors;
}

/** Held-highlights shown in each holder's color (excludes the local client's own). */
export function resolveHighlights(
  localId: number,
  path: string,
  states: Map<number, Record<string, unknown>>,
): HeldHighlight[] {
  const byNode = new Map<string, { color: string; name: string; holderId: number }>();
  for (const [clientId, raw] of states) {
    if (clientId === localId) continue;
    const cs = readCanvasState(raw);
    if (!cs || cs.canvasPath !== path) continue;
    for (const [nodeId, entry] of Object.entries(cs.lockedNodes)) {
      // Lowest-id holder's color wins the visual (matches the tiebreak winner).
      const prev = byNode.get(nodeId);
      if (!prev || clientId < prev.holderId) {
        byNode.set(nodeId, { color: entry.color, name: entry.name, holderId: clientId });
      }
    }
  }
  return [...byNode.entries()].map(([nodeId, v]) => ({
    nodeId,
    color: v.color,
    name: v.name,
  }));
}

/**
 * Ring bookkeeping (pure, DOM-free, unit-tested). Given the node ids currently
 * decorated with a held-ring (nodeId → applied color) and the desired highlight
 * set, decide which rings to add, remove, or recolor. The DOM apply/remove layer
 * (which touches real `nodeEl` elements) is inherently not unit-testable and just
 * consumes this delta.
 */
export interface RingDelta {
  add: HeldHighlight[];
  recolor: HeldHighlight[];
  remove: string[];
}

export function computeRingDelta(
  applied: Map<string, string>,
  desired: HeldHighlight[],
): RingDelta {
  const desiredIds = new Set(desired.map((h) => h.nodeId));
  const add: HeldHighlight[] = [];
  const recolor: HeldHighlight[] = [];
  const remove: string[] = [];
  for (const h of desired) {
    const cur = applied.get(h.nodeId);
    if (cur === undefined) add.push(h);
    else if (cur !== h.color) recolor.push(h);
  }
  for (const nodeId of applied.keys()) {
    if (!desiredIds.has(nodeId)) remove.push(nodeId);
  }
  return { add, recolor, remove };
}

// ---- Presence controller ----------------------------------------------------

export interface CanvasPresenceOptions {
  path: string;
  awareness: AwarenessLike;
  identity: PeerIdentity;
  overlay?: CanvasOverlay | null;
  adapter?: CanvasAdapter | null;
  // Rollback of the loser's optimistic edit (GAP-1 loser-revert). Supplied by
  // main.ts to snap a node back to its pre-claim position via the adapter.
  onRevert?: (nodeId: string) => void;
  // Deferred-reclaim settle window after a reconnect (ms). A returning holder
  // withholds its locks, waits this long for peers' awareness to re-sync, then
  // re-claims only still-free nodes (US4 AC3/AC4, GAP-4). Injectable so tests can
  // drive the defer deterministically; defaults to RECONNECT_RECLAIM_DEFER_MS.
  reclaimDeferMs?: number;
  // WP120 — injected clock for the diff-inferred claim's idle budget, so its
  // release is asserted by ADVANCING A NUMBER and never by sleeping. Defaults to
  // `Date.now`. Same seam and same reason as `CanvasAdapterOpts.now`.
  now?: () => number;
  // WP120 — the idle budget itself (ms), injectable for the same reason.
  // Defaults to INFERRED_LOCK_IDLE_MS.
  inferredLockIdleMs?: number;
  // WP2/WP3 display toggles (default true). `showCursors` gates the free-cursor
  // overlay + local pointer broadcast; `showPresence` gates the per-node held
  // ring + name tag. Both respected live via setDisplayOptions().
  showCursors?: boolean;
  showPresence?: boolean;
  // Optional status-console logger for throttled cursor-coordinate telemetry
  // (diagnosing the broadcast↔render transform). No-op when absent.
  logger?: { debug(category: string, message: string): void } | null;
}

// Structural view of the private canvas node card element the ring is applied to.
// Kept minimal so this module never hard-depends on a browser DOM at runtime
// (the ring path only runs when a real adapter/canvas is present).
interface RingRecord {
  color: string;
  el: HTMLElement;
  tag: HTMLElement;
}

export class CanvasPresence {
  private readonly path: string;
  private readonly awareness: AwarenessLike;
  private readonly identity: PeerIdentity;
  private overlay: CanvasOverlay | null;
  private readonly adapter: CanvasAdapter | null;
  private readonly onRevert?: (nodeId: string) => void;
  private readonly reclaimDeferMs: number;
  private readonly now: () => number;
  private readonly inferredLockIdleMs: number;
  private showCursors: boolean;
  private showPresence: boolean;
  private readonly logger: { debug(category: string, message: string): void } | null;
  // Throttle for coordinate telemetry (ms of monotonic-ish wall clock).
  private lastBcastLog = 0;
  private lastRenderLog = 0;

  private lockedNodes: Record<string, LockEntry> = {};
  // WP120 — provenance + idle clock for each entry of `lockedNodes`, kept BESIDE
  // it rather than inside `LockEntry`, so the awareness wire shape peers read is
  // byte-for-byte what it was (WP27 AC3 pins its six keys). Local bookkeeping only:
  // nothing here is broadcast and no peer can see or forge it.
  private lockMeta = new Map<string, { origin: LockOrigin; touchedAt: number }>();
  private nodeId: string | null = null;
  private x = 0;
  private y = 0;
  private disposers: Array<() => void> = [];
  private awarenessListener: (() => void) | null = null;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;
  // nodeId → applied held-ring record, so rings are diffed and cleaned up cleanly.
  private appliedRings = new Map<string, RingRecord>();

  constructor(opts: CanvasPresenceOptions) {
    this.path = opts.path;
    this.awareness = opts.awareness;
    this.identity = opts.identity;
    this.overlay = opts.overlay ?? null;
    this.adapter = opts.adapter ?? null;
    this.onRevert = opts.onRevert;
    this.reclaimDeferMs = opts.reclaimDeferMs ?? RECONNECT_RECLAIM_DEFER_MS;
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this.inferredLockIdleMs = opts.inferredLockIdleMs ?? INFERRED_LOCK_IDLE_MS;
    this.showCursors = opts.showCursors ?? true;
    this.showPresence = opts.showPresence ?? true;
    this.logger = opts.logger ?? null;
  }

  /** Live-toggle the display options (called when the user flips the settings). */
  setDisplayOptions(showCursors: boolean, showPresence: boolean): void {
    this.showCursors = showCursors;
    this.showPresence = showPresence;
    this.refresh();
  }

  /** Whether the private Canvas API acquisition path is live for this canvas. */
  hasPrivateApi(): boolean {
    return !!this.adapter?.isAvailable();
  }

  start(): void {
    this.emitLocalState();

    const listener = () => {
      // WP120 — RETIRE IDLE INFERRED CLAIMS BEFORE THE TIEBREAK, NOT AFTER.
      // A stale claim is harmless right up to the instant it becomes a CONTEST,
      // and the awareness `change` that could make it one is this very callback.
      // Sweeping here therefore needs no timer: the claim is retired by the same
      // event that would otherwise have cost the user a card. Ordering is
      // load-bearing — after `reconcileClaims()` the revert has already fired.
      this.expireIdleInferredLocks();
      // A remote claim may have superseded ours: settle the tiebreak first, then
      // repaint the overlay from the converged awareness snapshot.
      this.reconcileClaims();
      this.refresh();
    };
    this.awareness.on("change", listener);
    this.awarenessListener = listener;

    if (this.adapter) {
      this.disposers.push(
        this.adapter.onNodeInteractionStart((nodeId) => this.acquireLock(nodeId)),
        this.adapter.onNodeInteractionEnd((nodeId) => this.releaseLock(nodeId)),
        // Pointer capture rides the adapter's patched pointermove → posFromEvt and
        // already yields CANVAS-space coords, which we broadcast verbatim. Peers
        // convert back to their own screen space when rendering.
        this.adapter.onPointerMove((cx, cy) => {
          if (this.showCursors) this.updateCursor(cx, cy);
        }),
        // Pan/zoom must reposition the screen-space cursor overlay.
        this.adapter.onViewportChange(() => this.refresh()),
      );
    }

    this.refresh();
  }

  // Diff-inferred fallback (US3 AC2): canvas-sync calls this on the FIRST key
  // change of a node in the local diff path when the private API did not already
  // acquire the lock. This is a REAL acquisition path, not a stub.
  onDiffInferredChange(nodeId: string): void {
    if (!hasKey(this.lockedNodes, nodeId)) {
      this.acquireLock(nodeId, "inferred");
      return;
    }
    // WP120 — ALREADY OURS: this is the REFRESH, and it is what makes the idle
    // window mean "the user stopped working on this card" instead of "15 s have
    // passed". Capture fires at least every MAX_WAIT_MS while an edit continues,
    // so a card under active work can never reach the budget. A `"gesture"` claim
    // is left alone: it does not expire, so it has no clock to advance.
    const meta = this.lockMeta.get(nodeId);
    if (meta && meta.origin === "inferred") meta.touchedAt = this.now();
  }

  acquireLock(nodeId: string, origin: LockOrigin = "gesture"): void {
    if (hasKey(this.lockedNodes, nodeId)) return;
    this.lockedNodes[nodeId] = { color: this.identity.color, name: this.identity.name };
    // WP120: default `"gesture"` deliberately — an unqualified acquisition is a
    // real hold by an interaction seam, and the SAFE default is the one that is
    // never expired out from under a user.
    this.lockMeta.set(nodeId, { origin, touchedAt: this.now() });
    this.nodeId = nodeId;
    this.emitLocalState();
  }

  releaseLock(nodeId: string): void {
    if (!hasKey(this.lockedNodes, nodeId)) return;
    delete this.lockedNodes[nodeId];
    this.lockMeta.delete(nodeId);
    if (this.nodeId === nodeId) this.nodeId = null;
    this.emitLocalState();
  }

  /**
   * WP120 — A CLAIM HAS A LIFETIME. Retire every `"inferred"` claim that has not
   * been re-touched for `inferredLockIdleMs`, broadcast the shrunken set once, and
   * return the ids retired.
   *
   * Three properties, in the order they matter:
   *
   *   1. **`"gesture"` claims are never candidates.** A1 is worth nothing if it is
   *      bought by A3: someone dragging a card keeps it for as long as they hold it,
   *      however long that is. The same goes for a claim whose provenance is unknown
   *      — the fall-through is "do not expire", so a bookkeeping gap can only ever
   *      cost us the old leak, never a card out of a user's hand.
   *   2. **It only ever claims LESS.** Since WP21 a lock carries no write authority
   *      (`files/canvas-sync.ts:4127-4130`), so releasing one cannot cause a doc
   *      write, a file write or a `coldOpen`. It strictly reduces how often
   *      `onRevert` fires, and it touches nothing else.
   *   3. **It is driven by an injected clock**, so its behaviour is asserted by
   *      advancing a number rather than by sleeping.
   *
   * Public because the sweep is a fact about the object, not a private detail of
   * one listener, and because a test must be able to drive it directly.
   */
  expireIdleInferredLocks(): string[] {
    const cutoff = this.now() - this.inferredLockIdleMs;
    const expired: string[] = [];
    for (const nodeId of Object.keys(this.lockedNodes)) {
      const meta = this.lockMeta.get(nodeId);
      // Unknown provenance is treated as a gesture: never expire what you cannot
      // prove nobody is holding.
      if (!meta || meta.origin !== "inferred") continue;
      if (meta.touchedAt > cutoff) continue; // still inside the window
      delete this.lockedNodes[nodeId];
      this.lockMeta.delete(nodeId);
      if (this.nodeId === nodeId) this.nodeId = null;
      expired.push(nodeId);
    }
    // One broadcast for the whole sweep, and none at all when nothing expired —
    // an idle client must not turn this into an awareness heartbeat of its own.
    if (expired.length > 0) this.emitLocalState();
    return expired;
  }

  isLockedByMe(nodeId: string): boolean {
    return hasKey(this.lockedNodes, nodeId);
  }

  canWriteNode(nodeId: string): boolean {
    return computeCanWriteNode(this.awareness.clientID, this.path, nodeId, this.awareness.getStates());
  }

  canDeleteNode(nodeId: string): boolean {
    return computeCanDeleteNode(this.awareness.clientID, this.path, nodeId, this.awareness.getStates());
  }

  /**
   * GAP-1 loser-revert: for every node this client is optimistically holding, if
   * a LOWER-id peer also holds it, this client lost the tiebreak → release the
   * claim and roll back its optimistic edit. Returns the nodes reverted. Called
   * on every awareness change (settle) and safe to call directly in tests.
   */
  reconcileClaims(): string[] {
    const reverted: string[] = [];
    const states = this.awareness.getStates();
    const myId = this.awareness.clientID;
    let mutated = false;
    for (const nodeId of Object.keys(this.lockedNodes)) {
      const holders = holdersOf(this.path, nodeId, states);
      const lower = holders.some((id) => id !== myId && id < myId);
      if (lower) {
        delete this.lockedNodes[nodeId];
        this.lockMeta.delete(nodeId);
        if (this.nodeId === nodeId) this.nodeId = null;
        reverted.push(nodeId);
        this.onRevert?.(nodeId);
        mutated = true;
      }
    }
    if (mutated) this.emitLocalState();
    return reverted;
  }

  /**
   * GAP-2 (behavioral half): a remote delete removed `nodeId` from the shared
   * doc. If this client held it, abort — drop the lock, do NOT resurrect (the
   * no-resurrect data fix lives in canvas-sync applyLocalDiffToYMaps).
   */
  onRemoteNodeDeleted(nodeId: string): void {
    if (hasKey(this.lockedNodes, nodeId)) this.releaseLock(nodeId);
  }

  /**
   * WP1 reconnect policy (US4 AC3/AC4, GAP-4): a returning lock-holder must NEVER
   * blind re-assert its (possibly stale) locks. During the outage a peer may have
   * acquired one of our nodes; re-broadcasting `lockedNodes` — or winning the
   * lowest-id tiebreak on such a node — would steal it back and split the lock.
   *
   * Two steps:
   *   1. WITHHOLD immediately — drop ALL local claims and broadcast a lock-free
   *      state now, so a peer that grabbed one of our nodes is never contested by
   *      a blind re-assert (and never reverts on our account). This runs BEFORE
   *      the SyncManager reconnect clock-tick, so the re-emit carries no locks.
   *   2. DEFER re-acquisition — the resubscribe only pulls peers' current
   *      `lockedNodes` back over the wire after ~1 heartbeat/RTT. Once that settle
   *      window elapses we re-claim ONLY the nodes that are still free; any a peer
   *      took during the outage stays with that peer (no dual ownership).
   */
  onReconnect(): void {
    // WP120: carry each claim's ORIGIN across the withhold. A claim the user is
    // still holding must come back as `"gesture"` — re-acquiring it as `"inferred"`
    // would arm an expiry on a card in somebody's hand, which is precisely A3's
    // failure mode arriving by the back door.
    const pending: Array<{ nodeId: string; origin: LockOrigin }> = Object.keys(
      this.lockedNodes,
    ).map((nodeId) => ({ nodeId, origin: this.lockMeta.get(nodeId)?.origin ?? "gesture" }));
    // (1) Withhold: clear our claims and broadcast a lock-free state now.
    this.lockedNodes = {};
    this.lockMeta.clear();
    this.nodeId = null;
    this.emitLocalState();
    this.refresh();
    if (pending.length === 0) return;
    // (2) Defer the re-claim until peers' awareness has re-synced.
    if (this.reclaimTimer) clearTimeout(this.reclaimTimer);
    this.reclaimTimer = setTimeout(() => {
      this.reclaimTimer = null;
      this.reclaimStillFreeNodes(pending);
    }, this.reclaimDeferMs);
  }

  /**
   * Deferred second half of {@link onReconnect}: re-acquire only the previously
   * held nodes that no peer holds now. A node a peer acquired during the outage
   * is left with that peer — the returning client never steals it back.
   */
  private reclaimStillFreeNodes(nodes: Array<{ nodeId: string; origin: LockOrigin }>): void {
    const states = this.awareness.getStates();
    const myId = this.awareness.clientID;
    for (const { nodeId, origin } of nodes) {
      if (hasKey(this.lockedNodes, nodeId)) continue; // already re-held
      const takenByPeer = holdersOf(this.path, nodeId, states).some((id) => id !== myId);
      if (!takenByPeer) this.acquireLock(nodeId, origin); // still free → safe to re-hold
    }
    this.refresh();
  }

  updateCursor(x: number, y: number): void {
    this.x = x;
    this.y = y;
    if (this.logger) {
      const now = Date.now();
      if (now - this.lastBcastLog > 300) {
        this.lastBcastLog = now;
        const vp = this.adapter?.getViewport();
        this.logger.debug(
          "canvas-cursor",
          `BCAST canvas=(${x.toFixed(0)},${y.toFixed(0)}) vp=(${vp ? `${vp.x.toFixed(0)},${vp.y.toFixed(0)},z${vp.zoom.toFixed(2)}` : "?"})`,
        );
      }
    }
    this.emitLocalState();
  }

  setOverlay(overlay: CanvasOverlay | null): void {
    this.overlay = overlay;
  }

  refresh(): void {
    const states = this.awareness.getStates();
    const myId = this.awareness.clientID;

    // (a) Free cursors → screen space. resolveCursors yields peer CANVAS coords;
    // convert each to a wrapper-relative SCREEN point via the adapter so the dumb
    // overlay can paint it. Highlights are anchored to nodeEl (below), so the
    // overlay draws cursors ONLY (no floating held boxes).
    if (this.overlay) {
      const cursors = this.showCursors ? resolveCursors(myId, this.path, states) : [];
      const screenCursors: CursorMarker[] = [];
      for (const c of cursors) {
        const s = this.adapter?.canvasToScreenRelativeToWrapper(c.x, c.y);
        screenCursors.push(s ? { ...c, x: s.x, y: s.y } : c);
      }
      if (this.logger && cursors.length > 0) {
        const now = Date.now();
        if (now - this.lastRenderLog > 300) {
          this.lastRenderLog = now;
          const c = cursors[0];
          const s = this.adapter?.canvasToScreenRelativeToWrapper(c.x, c.y);
          const vp = this.adapter?.getViewport();
          this.logger.debug(
            "canvas-cursor",
            `RENDER peer=${c.clientId} canvas=(${c.x.toFixed(0)},${c.y.toFixed(0)}) -> screen=(${s ? `${s.x.toFixed(0)},${s.y.toFixed(0)}` : "?"}) vp=(${vp ? `${vp.x.toFixed(0)},${vp.y.toFixed(0)},z${vp.zoom.toFixed(2)}` : "?"})`,
          );
        }
      }
      this.overlay.render({ cursors: screenCursors, highlights: [] });
    }

    // (b) Per-node held ring anchored to the real card DOM (fixes the invisible
    // highlight: resolveHighlights carries no geometry — we style nodeEl instead).
    const desired = this.showPresence ? resolveHighlights(myId, this.path, states) : [];
    this.applyRings(desired);
  }

  // ---- Held-ring DOM application (not unit-testable; diff via computeRingDelta) --
  private applyRings(desired: HeldHighlight[]): void {
    if (!this.adapter) return;
    const appliedColors = new Map<string, string>();
    for (const [id, rec] of this.appliedRings) appliedColors.set(id, rec.color);
    const delta = computeRingDelta(appliedColors, desired);
    for (const nodeId of delta.remove) this.removeRing(nodeId);
    for (const h of delta.recolor) {
      this.removeRing(h.nodeId);
      this.addRing(h);
    }
    for (const h of delta.add) this.addRing(h);
  }

  private addRing(h: HeldHighlight): void {
    const el = this.adapter?.getNodeEl(h.nodeId) ?? null;
    if (!el) return;
    try {
      el.classList.add("ls-canvas-held-ring");
      el.style.setProperty("--ls-hold-color", h.color);
      const tag = el.ownerDocument.createElement("div");
      tag.className = "ls-canvas-held-tag";
      tag.textContent = h.name;
      tag.style.background = h.color;
      el.appendChild(tag);
      this.appliedRings.set(h.nodeId, { color: h.color, el, tag });
    } catch {
      /* DOM shape drift must never throw into the plugin */
    }
  }

  private removeRing(nodeId: string): void {
    const rec = this.appliedRings.get(nodeId);
    if (!rec) return;
    try {
      rec.el.classList.remove("ls-canvas-held-ring");
      rec.el.style.removeProperty("--ls-hold-color");
      rec.tag.remove();
    } catch {
      /* ignore */
    }
    this.appliedRings.delete(nodeId);
  }

  private clearRings(): void {
    for (const nodeId of [...this.appliedRings.keys()]) this.removeRing(nodeId);
  }

  private emitLocalState(): void {
    const state: CanvasAwarenessState & { identity: PeerIdentity } = {
      canvasPath: this.path,
      nodeId: this.nodeId,
      x: this.x,
      y: this.y,
      lockedNodes: { ...this.lockedNodes },
      identity: this.identity,
    };
    this.awareness.setLocalState(state as unknown as Record<string, unknown>);
  }

  destroy(): void {
    if (this.reclaimTimer) {
      clearTimeout(this.reclaimTimer);
      this.reclaimTimer = null;
    }
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    if (this.awarenessListener) {
      this.awareness.off("change", this.awarenessListener);
      this.awarenessListener = null;
    }
    this.lockedNodes = {};
    this.lockMeta.clear();
    this.nodeId = null;
    // Remove every injected ring/tag from peer cards — no leaked DOM/classes.
    this.clearRings();
    // Restore all patched canvas methods + detach adapter listeners.
    this.adapter?.destroy();
    // Clear our awareness slot so peers drop our cursor + any held highlight.
    this.awareness.setLocalState(null);
    this.overlay?.destroy();
    this.overlay = null;
  }
}
