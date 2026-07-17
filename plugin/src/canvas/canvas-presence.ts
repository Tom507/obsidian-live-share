// WP2 + WP3 — canvas presence + per-card advisory locking, riding the canvas
// doc's OWN Yjs awareness channel (crash-safe: awareness auto-clears on
// disconnect, so a held lock can never strand). This module:
//   * writes/reads the single shared awareness field
//       { canvasPath, nodeId|null, x, y, lockedNodes: {[id]:{color,name,epoch?}} }
//   * acquires locks hybrid: private Canvas API (adapter) → DIFF-INFERRED FALLBACK
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
}

export class CanvasPresence {
  private readonly path: string;
  private readonly awareness: AwarenessLike;
  private readonly identity: PeerIdentity;
  private overlay: CanvasOverlay | null;
  private readonly adapter: CanvasAdapter | null;
  private readonly onRevert?: (nodeId: string) => void;
  private readonly reclaimDeferMs: number;

  private lockedNodes: Record<string, LockEntry> = {};
  private nodeId: string | null = null;
  private x = 0;
  private y = 0;
  private disposers: Array<() => void> = [];
  private awarenessListener: (() => void) | null = null;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: CanvasPresenceOptions) {
    this.path = opts.path;
    this.awareness = opts.awareness;
    this.identity = opts.identity;
    this.overlay = opts.overlay ?? null;
    this.adapter = opts.adapter ?? null;
    this.onRevert = opts.onRevert;
    this.reclaimDeferMs = opts.reclaimDeferMs ?? RECONNECT_RECLAIM_DEFER_MS;
  }

  /** Whether the private Canvas API acquisition path is live for this canvas. */
  hasPrivateApi(): boolean {
    return !!this.adapter?.isAvailable();
  }

  start(): void {
    this.emitLocalState();

    const listener = () => {
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
        this.adapter.onPointerMove((cx, cy) => {
          const p = this.adapter?.clientToCanvas(cx, cy);
          if (p) this.updateCursor(p.x, p.y);
        }),
      );
    }

    this.refresh();
  }

  // Diff-inferred fallback (US3 AC2): canvas-sync calls this on the FIRST key
  // change of a node in the local diff path when the private API did not already
  // acquire the lock. This is a REAL acquisition path, not a stub.
  onDiffInferredChange(nodeId: string): void {
    if (!hasKey(this.lockedNodes, nodeId)) this.acquireLock(nodeId);
  }

  acquireLock(nodeId: string): void {
    if (hasKey(this.lockedNodes, nodeId)) return;
    this.lockedNodes[nodeId] = { color: this.identity.color, name: this.identity.name };
    this.nodeId = nodeId;
    this.emitLocalState();
  }

  releaseLock(nodeId: string): void {
    if (!hasKey(this.lockedNodes, nodeId)) return;
    delete this.lockedNodes[nodeId];
    if (this.nodeId === nodeId) this.nodeId = null;
    this.emitLocalState();
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
    const pending = Object.keys(this.lockedNodes);
    // (1) Withhold: clear our claims and broadcast a lock-free state now.
    this.lockedNodes = {};
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
  private reclaimStillFreeNodes(nodes: string[]): void {
    const states = this.awareness.getStates();
    const myId = this.awareness.clientID;
    for (const nodeId of nodes) {
      if (hasKey(this.lockedNodes, nodeId)) continue; // already re-held
      const takenByPeer = holdersOf(this.path, nodeId, states).some((id) => id !== myId);
      if (!takenByPeer) this.acquireLock(nodeId); // still free → safe to re-hold
    }
    this.refresh();
  }

  updateCursor(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.emitLocalState();
  }

  setOverlay(overlay: CanvasOverlay | null): void {
    this.overlay = overlay;
  }

  refresh(): void {
    if (!this.overlay) return;
    const states = this.awareness.getStates();
    const myId = this.awareness.clientID;
    this.overlay.render({
      cursors: resolveCursors(myId, this.path, states),
      highlights: resolveHighlights(myId, this.path, states),
    });
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
    this.nodeId = null;
    // Clear our awareness slot so peers drop our cursor + any held highlight.
    this.awareness.setLocalState(null);
    this.overlay?.destroy();
    this.overlay = null;
  }
}
