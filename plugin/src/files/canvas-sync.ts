import { Notice, type Vault } from "obsidian";
import * as Y from "yjs";

import {
  canonicalizeCanvasData,
  roundCanvasGeometry,
  serializeCanonicalCanvas,
} from "../canvas/canvas-canonical";
import {
  type DeleteIntent,
  type FieldUpsertIntent,
  type IntentPlan,
  type ParsedSave,
  type ParsedSaveRecord,
  type ShadowFieldValue,
  type ShadowRecordKind,
  type SurfaceShadow,
  type SurfaceState,
  type TombstoneView,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getRecordFields,
  getRecordState,
  markRecordAbsent,
  planIntentDiff,
} from "../canvas/canvas-shadow";
import type { DocHandle, SyncManager } from "../sync/sync";
import {
  VAULT_EVENT_SETTLE_MS,
  ensureFolder,
  getFileByPath,
  isPathSafe,
  normalizePath,
  toCanonicalPath,
  toLocalPath,
} from "../utils";
import type { FileOpsManager } from "./file-ops";

const CANVAS_DOC_PREFIX = "__canvas__:";
// Bug L1: remote->disk write latency. Trailing debounce (short) plus a max-wait
// cap so a continuous stream of remote updates still flushes to disk regularly
// instead of the trailing timer resetting forever.
export const DEBOUNCE_MS = 200;
export const MAX_WAIT_MS = 500;

// Scatter fix (v0.5.6): geometry keys that define WHERE a card sits. Obsidian
// never removes these from a node that still exists — a live node losing x/y/w/h
// is always a transient/partial disk read, never a real user intent. The key-diff
// and full-merge paths therefore NEVER delete these keys, so a stray partial read
// can no longer strip a node's position out of the shared CRDT (→ scatter on all
// peers). They are still SET normally when a real new value is present.
export const GEOMETRY_KEYS = new Set(["x", "y", "width", "height"]);

// WP5 (US3 AC9): the wider STRUCTURAL key set the delete guards honour. Same
// reasoning as GEOMETRY_KEYS, one level up: a live record never legitimately
// loses one of these keys, and losing one is silently catastrophic rather than
// merely ugly.
//
// ├── `type`                → Obsidian's importData SKIPS any node whose type is
// │                           not file|text|link|group, so a type-less node and
// │                           every edge attached to it silently vanish on all
// │                           peers (the disk file still "looks" fine).
// ├── `fromNode` / `toNode` → importData creates an edge only when BOTH endpoints
// │                           exist; an edge that LOST the key entirely also slips
// │                           past buildCanvasData's dangling-edge guard (which
// │                           requires a string), so it reaches disk and then
// │                           disappears on every peer — "connections break".
// └── `fromSide` / `toSide` → the arrow's routing. Losing it makes Obsidian
//                             recompute + re-save its own routing, which then
//                             fights the sync as a fresh local edit.
//
// GEOMETRY_KEYS keeps its exact membership (US3 AC10) — it is exported and
// asserted elsewhere; this is a strict superset used only by the delete guards.
// Content keys (`text`, `color`, `label`, `file`, `url`) stay deletable: removing
// them is a real, reversible user intent.
export const PROTECTED_KEYS = new Set([
  ...GEOMETRY_KEYS,
  "type",
  "fromNode",
  "toNode",
  "fromSide",
  "toSide",
]);

// Minimal structural logger so CanvasSync can narrate the data path into the
// status console without importing the concrete DebugLogger (avoids a cycle).
export interface CanvasSyncLogger {
  debug(category: string, message: string): void;
  warn(category: string, message: string): void;
}

export interface CanvasData {
  nodes: Record<string, Record<string, unknown>>;
  edges: Record<string, Record<string, unknown>>;
}

export function parseCanvas(content: string): CanvasData {
  try {
    const parsed = JSON.parse(content);
    const nodes: Record<string, Record<string, unknown>> = {};
    const edges: Record<string, Record<string, unknown>> = {};
    if (Array.isArray(parsed.nodes)) {
      for (const node of parsed.nodes) {
        if (node.id) nodes[node.id] = node;
      }
    }
    if (Array.isArray(parsed.edges)) {
      for (const edge of parsed.edges) {
        if (edge.id) edges[edge.id] = edge;
      }
    }
    return { nodes, edges };
  } catch {
    return { nodes: {}, edges: {} };
  }
}

// Build the Obsidian .canvas data object ({nodes:[], edges:[]}) from the CRDT.
// Shared by disk serialization AND live-view reconciliation so both see the exact
// same (dangling-edge-pruned) snapshot.
//
// WP3: the pruned snapshot is returned in CANONICAL form — every record's keys in
// the file schema's order and both arrays sorted by id (UTF-16 code units) — so the
// same doc state produces the same bytes on every client. Y.Map iteration order is
// a function of the local integration history, not of the state, and V2's echo
// breaker is byte equality. Record order is therefore id-sorted rather than
// Y.Map-iteration-ordered; the dangling-edge prune below is unchanged and still
// runs BEFORE canonicalisation.
export function buildCanvasData(
  nodesMap: Y.Map<Y.Map<unknown>>,
  edgesMap: Y.Map<Y.Map<unknown>>,
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const nodeIds = new Set<string>(nodesMap.keys());

  for (const [, nodeYMap] of nodesMap) {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of nodeYMap) {
      obj[key] = value;
    }
    nodes.push(obj);
  }

  for (const [, edgeYMap] of edgesMap) {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of edgeYMap) {
      obj[key] = value;
    }
    // GAP-5 (US5 AC3): never serialize a dangling edge. If either endpoint node
    // was deleted (locally or remotely) the edge is pruned from the on-disk
    // .canvas so no edge references a non-existent node.
    const from = obj.fromNode;
    const to = obj.toNode;
    if (typeof from === "string" && !nodeIds.has(from)) continue;
    if (typeof to === "string" && !nodeIds.has(to)) continue;
    edges.push(obj);
  }

  return canonicalizeCanvasData({ nodes, edges });
}

// WP3: identical to `serializeCanonicalCanvas(buildCanvasData(...))` by
// construction. Canonicalisation is idempotent, so routing the already-canonical
// snapshot through it again is a no-op that keeps the two entry points provably
// in agreement. The emitted text is unchanged in SHAPE: one top-level object,
// `nodes` before `edges`, tab-indented, no trailing newline.
export function serializeCanvas(
  nodesMap: Y.Map<Y.Map<unknown>>,
  edgesMap: Y.Map<Y.Map<unknown>>,
): string {
  return serializeCanonicalCanvas(buildCanvasData(nodesMap, edgesMap));
}

// WP4 (D9): the semantic record compare that used to break the echo at
// `handleLocalModify` is GONE. V2's echo breaker is BYTE equality against
// `lastWrittenContent`, which only became sound once WP3 made this client's
// serialisation canonical. Nothing reconstructs plain records from the CRDT for
// comparison any more — the CRDT is deliberately not an input to the intent
// verdict (that is the defect the Surface-Shadow removes).

/** The two shadow id spaces, in a fixed order. */
const RECORD_KINDS: readonly ShadowRecordKind[] = ["node", "edge"];

/**
 * WP4: one parsed `.canvas` id-space, CAPTURE-ROUNDED (BUILD_SPEC §4.4).
 *
 * Geometry is rounded to whole pixels HERE — before anything else looks at the
 * records — so that sub-pixel noise can never be classified as intent and a
 * rounded value can never reach a peer as a delta that reads like a user edit.
 */
function toParsedRecords(records: Record<string, Record<string, unknown>>): ParsedSaveRecord[] {
  const out: ParsedSaveRecord[] = [];
  for (const [id, record] of Object.entries(records)) {
    out.push({ id, fields: roundCanvasGeometry(record) as Record<string, ShadowFieldValue> });
  }
  return out;
}

/** The rounded `ParsedSave` the shadow-relative intent diff consumes. */
function toParsedSave(path: string, data: CanvasData): ParsedSave {
  return {
    path,
    nodes: toParsedRecords(data.nodes),
    edges: toParsedRecords(data.edges),
  };
}

/** The save's records by id, per kind — the lock seam's "intended" record. */
type SaveIndex = { [K in ShadowRecordKind]: Map<string, ParsedSaveRecord> };

/** What an intent plan ACTUALLY did, which is what may advance the shadow. */
interface AppliedIntent {
  /** Field upserts that reached the CRDT (a denied record contributes none). */
  upserts: FieldUpsertIntent[];
  /** Record deletes that reached the CRDT. */
  deletes: DeleteIntent[];
  /** Ids the lock seam denied in this pass (US2 AC4) — the baseline hold. */
  denied: string[];
  /** Node ids deleted here, for the GAP-5 edge cascade + telemetry. */
  deletedNodeIds: string[];
  /** Node ids created here (telemetry only). */
  created: string[];
  /** Existing node ids that took a write here (telemetry only). */
  changed: string[];
}

export function applyToYMap(ymap: Y.Map<unknown>, obj: Record<string, unknown>): void {
  const existingKeys = new Set<string>();
  for (const key of ymap.keys()) {
    existingKeys.add(key);
  }
  for (const [key, value] of Object.entries(obj)) {
    const existing = ymap.get(key);
    if (existing !== value) {
      ymap.set(key, value);
    }
    existingKeys.delete(key);
  }
  for (const key of existingKeys) {
    // Scatter fix + WP5 (US3 AC9): never strip a live record's STRUCTURAL keys
    // because a partial/transient disk read omitted them. This full-merge branch
    // is reached for an entry that is in the CRDT but not in our diff baseline
    // (`applyLocalDiffToYMaps`, `!baseObj && existing`), i.e. exactly when our
    // copy of it is the stale one — for an edge that used to make `fromNode` /
    // `toNode` deletable, which drops the arrow on every peer.
    if (PROTECTED_KEYS.has(key)) continue;
    ymap.delete(key);
  }
}

// WP4: the three-way key diff (`base -> next` against `lastWrittenContent`) is
// GONE from the capture path. The unit of intent is the FIELD and the basis is
// the Surface-Shadow (`planIntentDiff`), so there is no `base` object left to
// diff against — and I7 forbids reading an omitted field as a removal at all,
// which makes the old PROTECTED_KEYS delete guard redundant HERE. The guard
// itself stays and still runs in `applyToYMap` on the seed path.

export class CanvasSync {
  private vault: Vault;
  private syncManager: SyncManager;
  private fileOpsManager: FileOpsManager;
  private subscribedPaths = new Set<string>();
  private observers = new Map<string, () => void>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Bug L1: timestamp of the first not-yet-flushed remote update per path, used
  // to enforce the max-wait cap on the trailing debounce.
  private writeFirstScheduled = new Map<string, number>();
  private recentDiskWrites = new Set<string>();
  // WP7: settle timers for writes performed by the EXTERNAL single writer
  // (`CanvasPersistence`), reported through `noteExternalDiskWrite`. Tracked so
  // teardown can cancel them, exactly like `writeTimers`.
  private externalWriteSettleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recentLocalEdits = new Set<string>();
  private lastWrittenContent = new Map<string, string>();
  // Bug G (client-side guard): predicate deciding whether local edits to a
  // canvas path may be pushed into the shared Y.Doc. Defaults to allow-all; the
  // owner of permission state (main.ts) injects the real predicate via
  // setCanWrite(). The argument is the CANONICAL path (toCanonicalPath).
  private canWrite: (path: string) => boolean;
  // WP3: advisory per-node lock gates wired into the diff path. Default allow-all
  // until main.ts injects the presence-backed predicates. `path` is canonical.
  private canWriteNode: (path: string, nodeId: string) => boolean = () => true;
  private canDeleteNode: (path: string, nodeId: string) => boolean = () => true;
  // WP3 diff-inferred fallback: notified the instant the local user first changes
  // a node's keys, so the presence layer can acquire the lock even when the
  // private Canvas API is absent. Null until wired.
  private onLocalNodeChange: ((path: string, nodeId: string) => void) | null = null;
  // Scatter fix (live-view reconciliation): fired whenever a REMOTE (non-local)
  // delta is integrated, carrying the full post-delta canvas data so main.ts can
  // patch the OPEN Obsidian canvas view (which ignores external file writes). Null
  // until wired. `path` is canonical.
  private onRemoteCanvasUpdate:
    | ((path: string, data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) => void)
    | null = null;
  // WP4 (US5 AC1): per-path monotonic counter of remote (non-local) Yjs
  // transactions applied to the canvas doc. A whole-file disk flush snapshots
  // this; if it has advanced by write time, an in-flight remote delta arrived
  // after the snapshot and the flush must yield rather than clobber it. This is a
  // version/sequence gate, NOT a wall-clock debounce race.
  private remoteSeq = new Map<string, number>();
  private seqHandlers = new Map<string, () => void>();
  // Optional status-console logger for narrating the canvas data path (disk
  // writes, geometry/edge anomalies). Null until main.ts injects it.
  private logger: CanvasSyncLogger | null = null;
  // WP4 (C4): the per-FIELD Surface-Shadow that replaced `lastWrittenContent` as
  // the intent basis. Constructed with the instance so the capture path always
  // has one, even before any wiring runs.
  private shadow: SurfaceShadow = createSurfaceShadow();
  // WP4: what the surface can prove about the last apply, per canonical path.
  // P0's honest default is "closed, nothing handed over" — WP5 wires the real
  // Obsidian view state. Consulted at every handleLocalModify AND every
  // noteExternalDiskWrite.
  private surfaceStateProvider: (path: string) => SurfaceState = () => ({
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  });
  // WP4: the resurrect-block seam. P0 has no `deleted` container (WP12 creates
  // it), so the default is "nothing is tombstoned".
  private tombstoneView: TombstoneView = { isDeleted: () => false };
  // WP4 (BUILD_SPEC §8): the discrimination seam. `false` stops classifying the
  // save against the shadow — every observed field becomes intent, exactly the
  // pre-V2 behaviour. Test-only; there is no production caller.
  private shadowRebaseEnabled = true;

  constructor(
    vault: Vault,
    syncManager: SyncManager,
    fileOpsManager: FileOpsManager,
    canWrite?: (path: string) => boolean,
  ) {
    this.vault = vault;
    this.syncManager = syncManager;
    this.fileOpsManager = fileOpsManager;
    this.canWrite = canWrite ?? (() => true);
  }

  // Bug G: inject/replace the client-side read-only guard after construction.
  // `path` is the canonical canvas path (toCanonicalPath(normalizePath(rawPath))).
  setCanWrite(predicate: (path: string) => boolean): void {
    this.canWrite = predicate;
  }

  // WP3: inject the advisory per-node lock gates. `canWriteNode` false => the diff
  // path drops the local write for that node; `canDeleteNode` false => the diff
  // path drops the local delete of that node. `path` is the canonical canvas path.
  setCanWriteNode(predicate: (path: string, nodeId: string) => boolean): void {
    this.canWriteNode = predicate;
  }

  setCanDeleteNode(predicate: (path: string, nodeId: string) => boolean): void {
    this.canDeleteNode = predicate;
  }

  // WP3: register the diff-inferred lock-acquisition hook.
  setOnLocalNodeChange(cb: (path: string, nodeId: string) => void): void {
    this.onLocalNodeChange = cb;
  }

  // Inject the status-console logger (optional; no-op until set).
  setLogger(logger: CanvasSyncLogger): void {
    this.logger = logger;
  }

  // WP4: the LIVE shadow instance (never a copy) — the capture path's basis, the
  // tests' primary state oracle, and what WP5 advances on a confirmed apply.
  getSurfaceShadow(): SurfaceShadow {
    return this.shadow;
  }

  // WP4 / C5 AC1: replace the instance so reconcile and capture provably share
  // ONE structure — there is no second, parallel shadow.
  setSurfaceShadow(shadow: SurfaceShadow): void {
    this.shadow = shadow;
  }

  // WP4: inject the surface-state seam (is the view open, which ids did the last
  // apply hand to it). `path` is the canonical canvas path.
  setSurfaceStateProvider(provider: (path: string) => SurfaceState): void {
    this.surfaceStateProvider = provider;
  }

  // WP4: inject the read-only view over the tombstone container (WP12).
  setTombstoneView(view: TombstoneView): void {
    this.tombstoneView = view;
  }

  // WP4 (BUILD_SPEC §8): disable the shadow rebase at its seam. Test-only.
  setShadowRebaseEnabled(enabled: boolean): void {
    this.shadowRebaseEnabled = enabled;
  }

  // Register the live-view reconciliation hook (scatter fix). Called on every
  // integrated REMOTE delta with the full canvas data.
  setOnRemoteCanvasUpdate(
    cb: (path: string, data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) => void,
  ): void {
    this.onRemoteCanvasUpdate = cb;
  }

  // WP2: expose the canvas doc handle (incl. its own awareness channel) so the
  // presence layer can read/write canvas cursors + locks on getDoc().awareness.
  getCanvasDocHandle(rawPath: string): DocHandle | null {
    const path = toCanonicalPath(normalizePath(rawPath));
    return this.syncManager.getDoc(`${CANVAS_DOC_PREFIX}${path}`);
  }

  // Initial-sync fix: expose the current CRDT snapshot (dangling-edge-pruned) so
  // main.ts can force a freshly-MOUNTED live view to match shared truth on the
  // very first sync (Obsidian's open canvas ignores external .canvas writes, and
  // the observer only fires on SUBSEQUENT remote deltas — never the seed). Returns
  // null when not subscribed, no doc, or the shared doc is still empty (nothing
  // authoritative to apply yet → keep the local view untouched).
  getCanvasSnapshot(
    rawPath: string,
  ): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } | null {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (!this.subscribedPaths.has(path)) return null;
    const docHandle = this.syncManager.getDoc(`${CANVAS_DOC_PREFIX}${path}`);
    if (!docHandle) return null;
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    if (nodesMap.size === 0) return null;
    return buildCanvasData(nodesMap, edgesMap);
  }

  private currentSeq(path: string): number {
    return this.remoteSeq.get(path) ?? 0;
  }

  async subscribe(rawPath: string, role: "host" | "guest"): Promise<void> {
    const path = toCanonicalPath(normalizePath(rawPath));
    // A peer/host controls manifest keys; reject any that would escape the vault.
    if (!isPathSafe(path)) return;
    if (this.subscribedPaths.has(path)) return;
    this.subscribedPaths.add(path);

    const docId = `${CANVAS_DOC_PREFIX}${path}`;
    const docHandle = this.syncManager.getDoc(docId);
    if (!docHandle) {
      this.subscribedPaths.delete(path);
      return;
    }

    try {
      await this.syncManager.waitForSync(docId);
    } catch {
      this.subscribedPaths.delete(path);
      return;
    }

    if (!this.subscribedPaths.has(path)) return;
    if (this.observers.has(path)) return;

    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");

    const diskPath = toLocalPath(path);
    if (role === "host") {
      const file = getFileByPath(this.vault, diskPath);
      if (file) {
        const content = await this.vault.read(file);
        const data = parseCanvas(content);
        this.recentLocalEdits.add(path);
        docHandle.doc.transact(() => {
          this.applyCanvasToYMaps(nodesMap, edgesMap, data);
        });
        this.recentLocalEdits.delete(path);
        // Bug C: establish the ECHO baseline so a byte-identical first modify is
        // recognised as our own write (WP4 AC1: this is no longer the intent
        // basis, only the echo/telemetry aid).
        this.lastWrittenContent.set(path, content);
        // WP4: the host seed is the same class of receipt as a closed-view
        // persistence write — this client just pushed exactly this file into the
        // doc, so the surface provably holds it. Without this the shadow is empty
        // right after a subscribe and the first Obsidian save replays the whole
        // file as intent, which is precisely the window the cascade starts in.
        this.advanceShadowFromContent(path, content, false);
      }
    }
    // WP7 (US5 AC13/AC17): the GUEST seed is gone from here. `CanvasPersistence`
    // owns it now via `coldOpen()`, which the wiring layer runs after this
    // subscribe resolves (i.e. after `waitForSync`) and before `start()`:
    //   ├── doc NON-empty → "doc-wins" → flush() → the stale file is overwritten
    //   │                   from the doc. Behaviour-equivalent to the seed write
    //   │                   this replaces, minus the second writer.
    //   └── doc EMPTY     → the file is parsed ONCE and SEEDS the doc, instead of
    //                       only recording a diff baseline. Deliberate change.
    // The HOST branch above stays exactly as it was: `applyCanvasToYMaps` DELETES
    // doc entries absent from the host's local file and `coldOpen`'s doc-wins
    // branch does not, so substituting it would silently change rejoin semantics.

    // WP4 (US5 AC1): bump the per-path remote sequence on every non-local
    // transaction. afterTransaction fires exactly once per transaction (unlike
    // the two deep observers below), so a remote delta touching both maps counts
    // once. Local edits (transact() from applyLocalDiffToYMaps / seeding) have
    // tr.local === true and never bump.
    const afterTx = (tr: Y.Transaction) => {
      if (!tr.local) this.remoteSeq.set(path, this.currentSeq(path) + 1);
    };
    docHandle.doc.on("afterTransaction", afterTx);
    this.seqHandlers.set(path, () => docHandle.doc.off("afterTransaction", afterTx));

    const observer = () => {
      if (this.recentLocalEdits.has(path)) return;
      // REMOTE delta: patch the OPEN canvas view directly — Obsidian ignores
      // external .canvas writes while the view is open, so a file-only sync leaves
      // the view stale/scattered until a full reload.
      if (this.onRemoteCanvasUpdate) {
        try {
          this.onRemoteCanvasUpdate(path, buildCanvasData(nodesMap, edgesMap));
        } catch {
          /* live reconciliation must never break the data path */
        }
      }
      // WP7 (US5 AC13): the CRDT→disk write is RETIRED here. `CanvasPersistence`
      // is the single writer for every canvas-owned path; scheduling a second
      // flush from this observer is exactly the two-writer race this round
      // exists to remove. What remains is the corruption TELEMETRY, on the same
      // trailing debounce so it still narrates once per settled burst rather
      // than once per delta (US6 AC5).
      this.scheduleCanvasAudit(path, nodesMap, edgesMap);
    };
    nodesMap.observeDeep(observer);
    edgesMap.observeDeep(observer);
    this.observers.set(path, () => {
      nodesMap.unobserveDeep(observer);
      edgesMap.unobserveDeep(observer);
    });

    // Initial-sync fix: the observer above only fires on SUBSEQUENT remote deltas,
    // never on the seed that just completed via waitForSync. If the guest already
    // had this canvas OPEN, its live view is still showing the stale local file
    // (wrong positions / disconnected edges) — Obsidian ignores the disk write we
    // just did. Drive one authoritative reconcile now so the open view snaps to
    // shared truth. Host's own view IS the source of truth, so only guests need it.
    if (role === "guest" && this.onRemoteCanvasUpdate && nodesMap.size > 0) {
      try {
        this.onRemoteCanvasUpdate(path, buildCanvasData(nodesMap, edgesMap));
      } catch {
        /* live reconciliation must never break subscribe */
      }
    }
  }

  unsubscribe(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    this.subscribedPaths.delete(path);
    const timer = this.writeTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(path);
    }
    const settleTimer = this.externalWriteSettleTimers.get(path);
    if (settleTimer) {
      clearTimeout(settleTimer);
      this.externalWriteSettleTimers.delete(path);
    }
    this.writeFirstScheduled.delete(path);
    this.remoteSeq.delete(path);
    const unobserve = this.observers.get(path);
    if (unobserve) {
      unobserve();
      this.observers.delete(path);
    }
    const detachSeq = this.seqHandlers.get(path);
    if (detachSeq) {
      detachSeq();
      this.seqHandlers.delete(path);
    }
    this.syncManager.releaseDoc(`${CANVAS_DOC_PREFIX}${path}`);
  }

  async handleLocalModify(rawPath: string): Promise<void> {
    const path = toCanonicalPath(normalizePath(rawPath));
    if (this.recentDiskWrites.has(path)) return;
    if (!this.subscribedPaths.has(path)) return;
    // Bug G: never push local edits for a read-only canvas path (defense in
    // depth; the authoritative check is server-side in ws-handler.ts).
    if (!this.canWrite(path)) return;

    const docId = `${CANVAS_DOC_PREFIX}${path}`;
    const docHandle = this.syncManager.getDoc(docId);
    if (!docHandle) return;

    const file = getFileByPath(this.vault, toLocalPath(path));
    if (!file) return;

    const content = await this.vault.read(file);

    // WP4 AC2 — the BYTE echo breaker (BUILD_SPEC D9), which replaced the
    // semantic `canvasRecordsEqual` compare. It is sound only because WP3 made
    // this client's serialisation canonical, and it is deliberately NOT a timer:
    // identical bytes are our own write coming back. Zero CRDT writes and NO
    // shadow mutation — the bytes prove what the DISK holds, never what an open
    // Obsidian canvas holds (that receipt is a confirmed apply, WP5's job).
    if (content === this.lastWrittenContent.get(path)) {
      this.logger?.debug("canvas-sync", `local modify ${path}: no-op (disk == shared state)`);
      return;
    }

    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    const maps = { node: nodesMap, edge: edgesMap };

    // WP4 AC1: the save is parsed, CAPTURE-ROUNDED (§4.4) and then classified
    // against the Surface-Shadow. The three-way read of `lastWrittenContent` is
    // gone — the CRDT is not an input to the verdict either, which is precisely
    // why a stale save can no longer be mistaken for intent.
    const save = toParsedSave(path, parseCanvas(content));
    const surface = this.surfaceStateProvider(path);
    const plan = this.planCapture(save, surface);
    const saved: SaveIndex = {
      node: new Map(save.nodes.map((record) => [record.id, record])),
      edge: new Map(save.edges.map((record) => [record.id, record])),
    };

    // AC4: the DIVERGENT discards — fields the save re-stated at the shadow's
    // value while the CRDT has genuinely moved on. Read BEFORE the transaction,
    // so the compared value is the one the capture actually classified against.
    const divergent = plan.discarded.filter((discard) => {
      const record = maps[discard.kind].get(discard.id);
      return record !== undefined && record.get(discard.field) !== discard.value;
    });

    this.recentLocalEdits.add(path);
    const applied = docHandle.doc.transact(() => this.applyIntentPlan(plan, saved, maps));
    this.recentLocalEdits.delete(path);

    // WP4 step 6: the shadow advances for what ACTUALLY happened — a denied id
    // advances nothing, so the divergence it represents stays detectable.
    for (const upsert of applied.upserts) {
      advanceField(this.shadow, path, upsert.kind, upsert.id, upsert.field, upsert.value);
    }
    for (const del of applied.deletes) {
      markRecordAbsent(this.shadow, path, del.kind, del.id);
    }

    // WP4 (US2 AC4/AC5): advance the ECHO baseline ONLY for a clean pass. If any
    // write was denied, the local file still holds an edit that never reached the
    // shared doc; advancing would make the next save look like our own echo and
    // silently swallow it. Holding it keeps the rejected edit detectable.
    if (applied.denied.length > 0) {
      this.logger?.warn(
        "canvas-sync",
        `LOCK DENIED: ${path} ids=[${applied.denied.join(", ")}] (baseline held)`,
      );
    } else {
      this.lastWrittenContent.set(path, content);
    }

    // WP4 AC4 — the `SHADOW STALE:` signature, ONE line per pass with at least
    // one divergent discard. A save re-states every unchanged field and C2
    // discards all of them; logging those too would bury the one line that
    // matters. Ids and field NAMES only — never a value (US6: no user data).
    if (divergent.length > 0) {
      this.logger?.debug(
        "canvas-sync",
        `SHADOW STALE: ${path} ${divergent.length} field(s) not pushed: ${divergent
          .map((discard) => `${discard.kind}/${discard.id}.${discard.field}`)
          .join(", ")}`,
      );
    }

    // Telemetry: what did the local user's edit actually push? Correlate this with
    // any SCATTER/DETACH signature on the following disk write.
    if (this.logger) {
      // A node the local user "changed" to a state missing geometry is the direct
      // upstream cause of a scatter — flag it at the source, not just on write.
      const changedNoGeo = applied.changed.filter((id) => {
        const fields = saved.node.get(id)?.fields;
        return !fields || typeof fields.x !== "number" || typeof fields.y !== "number";
      });
      this.logger.debug(
        "canvas-sync",
        `local modify ${path}: +${applied.created.length} ~${applied.changed.length} -${applied.deletedNodeIds.length} node(s)` +
          (applied.deletedNodeIds.length
            ? ` deleted=[${applied.deletedNodeIds.join(", ")}]`
            : ""),
      );
      if (changedNoGeo.length) {
        this.logger.warn(
          "canvas-sync",
          `local disk read missing geometry for: ${changedNoGeo.join(", ")} (guard kept CRDT geometry)`,
        );
      }
    }
  }

  /**
   * WP4: the intent plan for one save.
   *
   * With the shadow rebase ON (the default and the only production state) this
   * is `planIntentDiff` verbatim. With it OFF at the discrimination seam
   * (BUILD_SPEC §8) the save is no longer classified against the shadow at all:
   * every observed field becomes intent and nothing is discarded, which is the
   * pre-V2 observation-as-intent behaviour whose defect class V2 removes. The
   * delete rule, the resurrect block, the byte echo breaker and the capture-side
   * rounding are untouched by the seam — only the classification changes.
   */
  private planCapture(save: ParsedSave, surface: SurfaceState): IntentPlan {
    const plan = planIntentDiff(this.shadow, save, this.tombstoneView, surface);
    if (this.shadowRebaseEnabled) return plan;
    plan.upserts = [];
    plan.discarded = [];
    for (const kind of RECORD_KINDS) {
      for (const record of kind === "node" ? save.nodes : save.edges) {
        if (this.tombstoneView.isDeleted(kind, record.id)) continue;
        for (const field of Object.keys(record.fields)) {
          plan.upserts.push({
            path: save.path,
            kind,
            id: record.id,
            field,
            value: record.fields[field],
          });
        }
      }
    }
    return plan;
  }

  /**
   * WP4: apply an intent plan to the shared maps, inside the caller's single
   * transaction, and report what actually landed.
   *
   * ├── upsert — the record's `Y.Map` is created on the first upsert for an id
   * │            absent from the doc, otherwise the field is set only when the
   * │            current value differs. A field the save omitted is NEVER
   * │            deleted (I7): a save is a partial observation, not a removal.
   * ├── delete — `ymap.delete(id)`; the GAP-5 edge cascade runs afterwards.
   * └── the lock seam is unchanged (`canWriteEntity` / `canDeleteNode`, the
   *     `denied` list and its baseline hold). Removing it is WP21, not WP4.
   */
  private applyIntentPlan(
    plan: IntentPlan,
    saved: SaveIndex,
    maps: { node: Y.Map<Y.Map<unknown>>; edge: Y.Map<Y.Map<unknown>> },
  ): AppliedIntent {
    const applied: AppliedIntent = {
      upserts: [],
      deletes: [],
      denied: [],
      deletedNodeIds: [],
      created: [],
      changed: [],
    };

    // One entry per record, in plan order, so a record absent from the doc is
    // created once and takes all of its upserts in this same transaction.
    const groups = new Map<string, FieldUpsertIntent[]>();
    for (const upsert of plan.upserts) {
      const key = `${upsert.kind}|${upsert.id}`;
      const group = groups.get(key);
      if (group) group.push(upsert);
      else groups.set(key, [upsert]);
    }

    for (const fields of groups.values()) {
      const { path, kind, id } = fields[0];
      const opts = { path, kind };
      // WP3 (US3 AC2) diff-inferred lock claim: the local user provably changed
      // this node, so claim the lock before the gate reads it.
      if (kind === "node") this.onLocalNodeChange?.(path, id);
      const previous = getRecordFields(this.shadow, path, kind, id) ?? undefined;
      if (!this.canWriteEntity(opts, id, saved[kind].get(id)?.fields, previous)) {
        applied.denied.push(id); // US3 AC5 / US2 AC1: drop the write
        continue;
      }
      const existing = maps[kind].get(id);
      if (!existing) {
        // GAP-2 / US2 AC3 delete-wins, no-resurrect: an id the shadow still holds
        // as `present` while the doc no longer has it was deleted by a peer.
        // NEVER re-create it — for nodes AND edges — even if the local user also
        // edited it. `absent`/`unknown` means this is a genuinely new record.
        if (getRecordState(this.shadow, path, kind, id) === "present") continue;
        const created = new Y.Map<unknown>();
        maps[kind].set(id, created);
        for (const upsert of fields) {
          created.set(upsert.field, upsert.value);
          applied.upserts.push(upsert);
        }
        if (kind === "node") applied.created.push(id);
        continue;
      }
      // US2 AC2: merge PER FIELD into the existing Y.Map — never
      // `ymap.set(id, new Y.Map())`, which detaches the record and silently
      // discards a peer's concurrent edit to a DIFFERENT field of it.
      for (const upsert of fields) {
        if (existing.get(upsert.field) !== upsert.value) existing.set(upsert.field, upsert.value);
        applied.upserts.push(upsert);
      }
      if (kind === "node") applied.changed.push(id);
    }

    for (const del of plan.deletes) {
      if (del.kind === "node") {
        // US3 AC7 / GAP-2: cannot delete a node another peer holds locked.
        if (!this.canDeleteNode(del.path, del.id)) {
          applied.denied.push(del.id);
          continue;
        }
        applied.deletedNodeIds.push(del.id);
      } else {
        // US2 AC1: removing an edge is an edge write too — a peer holding either
        // endpoint blocks it (the GAP-5 cascade prune stays separate and
        // unguarded because it follows an already-permitted node delete).
        const previous = getRecordFields(this.shadow, del.path, "edge", del.id) ?? undefined;
        if (!this.canWriteEntity({ path: del.path, kind: "edge" }, del.id, previous)) {
          applied.denied.push(del.id);
          continue;
        }
      }
      maps[del.kind].delete(del.id);
      applied.deletes.push(del);
    }

    // GAP-5 (US5 AC3): cascade-prune edges whose endpoint node the local user
    // just deleted, so the shared doc never carries a dangling edge.
    if (applied.deletedNodeIds.length > 0) {
      this.pruneEdgesForDeletedNodes(maps.edge, applied.deletedNodeIds);
    }

    return applied;
  }

  /**
   * WP4 AC3 / the host seed: record that `content` provably reached the surface.
   *
   * `markMissingAbsent` is the closed-view case: with no open Obsidian canvas the
   * FILE is the surface, so a record the writer left out is known-absent rather
   * than merely unobserved, and may become a delete intent later.
   */
  private advanceShadowFromContent(
    path: string,
    content: string,
    markMissingAbsent: boolean,
  ): void {
    const data = parseCanvas(content);
    for (const kind of RECORD_KINDS) {
      const records = kind === "node" ? data.nodes : data.edges;
      for (const [id, record] of Object.entries(records)) {
        advanceRecord(this.shadow, path, kind, id, record as Record<string, ShadowFieldValue>);
      }
      if (!markMissingAbsent) continue;
      const pathState = this.shadow.paths.get(path);
      if (!pathState) continue;
      const missing: string[] = [];
      for (const [id, shadowRecord] of pathState[kind]) {
        if (shadowRecord.state !== "present") continue;
        if (Object.prototype.hasOwnProperty.call(records, id)) continue;
        missing.push(id);
      }
      for (const id of missing) {
        markRecordAbsent(this.shadow, path, kind, id);
      }
    }
  }

  // WP4 (US2 AC1) / WP3 (US3 AC5): the lock-seam gate for one diff entry.
  // Nodes are gated on their own id. An edge is writable only while BOTH endpoint
  // nodes are writable by this client (`canWriteNode(from) && canWriteNode(to)`),
  // checked across every supplied record (intended AND previous) so re-routing an
  // edge cannot slip past a lock held on the endpoint it is leaving. A non-string
  // endpoint is ignored, matching pruneEdgesForDeletedNodes / buildCanvasData.
  private canWriteEntity(
    opts: { path: string; kind: "node" | "edge" },
    id: string,
    ...records: Array<Readonly<Record<string, unknown>> | undefined>
  ): boolean {
    if (opts.kind === "node") return this.canWriteNode(opts.path, id);
    for (const record of records) {
      if (!record) continue;
      for (const key of ["fromNode", "toNode"] as const) {
        const endpoint = record[key];
        if (typeof endpoint === "string" && !this.canWriteNode(opts.path, endpoint)) return false;
      }
    }
    return true;
  }

  // GAP-5 (US5 AC3): remove every edge whose endpoint is one of the just-deleted
  // node ids from the shared edges map, so no dangling edge survives in the CRDT.
  private pruneEdgesForDeletedNodes(
    edgesMap: Y.Map<Y.Map<unknown>>,
    deletedNodeIds: string[],
  ): void {
    const deleted = new Set(deletedNodeIds);
    for (const [edgeId, edge] of edgesMap) {
      const from = edge.get("fromNode");
      const to = edge.get("toNode");
      if (
        (typeof from === "string" && deleted.has(from)) ||
        (typeof to === "string" && deleted.has(to))
      ) {
        edgesMap.delete(edgeId);
      }
    }
  }

  isRecentDiskWrite(rawPath: string): boolean {
    return this.recentDiskWrites.has(toCanonicalPath(normalizePath(rawPath)));
  }

  isSubscribed(rawPath: string): boolean {
    return this.subscribedPaths.has(toCanonicalPath(normalizePath(rawPath)));
  }

  destroy(): void {
    for (const timer of this.writeTimers.values()) {
      clearTimeout(timer);
    }
    this.writeTimers.clear();
    for (const timer of this.externalWriteSettleTimers.values()) {
      clearTimeout(timer);
    }
    this.externalWriteSettleTimers.clear();
    this.writeFirstScheduled.clear();
    this.remoteSeq.clear();
    for (const [, unobserve] of this.observers) {
      unobserve();
    }
    this.observers.clear();
    for (const [, detachSeq] of this.seqHandlers) {
      detachSeq();
    }
    this.seqHandlers.clear();
    for (const path of [...this.subscribedPaths]) {
      this.syncManager.releaseDoc(`${CANVAS_DOC_PREFIX}${path}`);
    }
    this.subscribedPaths.clear();
    this.recentDiskWrites.clear();
    this.recentLocalEdits.clear();
    this.lastWrittenContent.clear();
  }

  private applyCanvasToYMaps(
    nodesMap: Y.Map<Y.Map<unknown>>,
    edgesMap: Y.Map<Y.Map<unknown>>,
    data: CanvasData,
  ): void {
    const existingNodeIds = new Set(nodesMap.keys());
    for (const [id, node] of Object.entries(data.nodes)) {
      let yNode = nodesMap.get(id);
      if (!yNode) {
        yNode = new Y.Map<unknown>();
        nodesMap.set(id, yNode);
      }
      applyToYMap(yNode, node);
      existingNodeIds.delete(id);
    }
    for (const id of existingNodeIds) {
      nodesMap.delete(id);
    }

    const existingEdgeIds = new Set(edgesMap.keys());
    for (const [id, edge] of Object.entries(data.edges)) {
      let yEdge = edgesMap.get(id);
      if (!yEdge) {
        yEdge = new Y.Map<unknown>();
        edgesMap.set(id, yEdge);
      }
      applyToYMap(yEdge, edge);
      existingEdgeIds.delete(id);
    }
    for (const id of existingEdgeIds) {
      edgesMap.delete(id);
    }
  }

  // WP7: formerly `scheduleDiskWrite`. The disk write it drove is retired (that
  // is now `CanvasPersistence`'s sole job); the debounce is kept purely so the
  // SCATTER / DETACH / NO TYPE telemetry still fires once per settled burst of
  // remote deltas instead of once per delta.
  private scheduleCanvasAudit(
    path: string,
    nodesMap: Y.Map<Y.Map<unknown>>,
    edgesMap: Y.Map<Y.Map<unknown>>,
  ): void {
    const now = Date.now();
    let firstScheduled = this.writeFirstScheduled.get(path);
    if (firstScheduled === undefined) {
      firstScheduled = now;
      this.writeFirstScheduled.set(path, now);
    }
    const existing = this.writeTimers.get(path);
    if (existing) clearTimeout(existing);
    // Trailing debounce (DEBOUNCE_MS) capped by a max wait since the first
    // pending update (MAX_WAIT_MS), so a continuous stream of remote updates
    // is still audited at least ~every MAX_WAIT_MS instead of resetting forever.
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, firstScheduled + MAX_WAIT_MS - now));
    this.writeTimers.set(
      path,
      setTimeout(() => {
        this.writeTimers.delete(path);
        this.writeFirstScheduled.delete(path);
        this.auditCanvasState(path, nodesMap, edgesMap);
      }, delay),
    );
  }

  /**
   * WP7 (BUILD_SPEC § 6.2, US5 AC15/AC7): told by the wiring layer that
   * `CanvasPersistence` — the single writer — just put `content` on disk.
   *
   * Two jobs, both of which used to be side effects of `writeToDisk`:
   *  ├── advance the three-way-diff baseline, so `handleLocalModify` still
   *  │   diffs the local file against what this client knows the file to be.
   *  │   Without this the baseline goes stale the moment another component
   *  │   writes the file, and the next local modify replays the whole file as
   *  │   "user changes" (the Part V failure mode).
   *  └── mark the path as a recent disk write for the settle window, so
   *      `vault-events.ts:121`'s existing `canvasSync.isRecentDiskWrite(path)`
   *      check still suppresses OUR write's echo — with no change at the
   *      vault-events end.
   */
  noteExternalDiskWrite(rawPath: string, content: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    this.lastWrittenContent.set(path, content);
    // WP4 AC3 — the CLOSED-VIEW receipt. With no open Obsidian canvas the FILE
    // is the surface this path's next save comes from, so what the single writer
    // just put there provably reached it: every written record advances the
    // shadow field by field, and every record the shadow still holds as present
    // but the content omits becomes known-ABSENT. With the view OPEN the shadow
    // is not touched at all — an open canvas ignores external file writes, so
    // only a confirmed apply is a receipt there, and that is WP5's mechanism.
    if (this.surfaceStateProvider(path).viewOpen === false) {
      this.advanceShadowFromContent(path, content, true);
    }
    this.recentDiskWrites.add(path);
    const existing = this.externalWriteSettleTimers.get(path);
    if (existing) clearTimeout(existing);
    this.externalWriteSettleTimers.set(
      path,
      setTimeout(() => {
        this.externalWriteSettleTimers.delete(path);
        this.recentDiskWrites.delete(path);
      }, VAULT_EVENT_SETTLE_MS),
    );
  }

  // Scatter/detach/no-type telemetry: inspect the CRDT snapshot about to be
  // serialized and surface the three corruption signatures to the status console —
  // (1) a live node missing geometry (→ card scatter), (2) an edge whose endpoint
  // node is absent (→ arrow detach; pruned from disk this write, self-heals when
  // the node returns) and (3) WP5/US3 AC12: a live node that lost its `type`, or a
  // `type: "file"` node that lost its `file`. Obsidian's importData drops a node
  // with an unknown type — and every edge attached to it — so this third class is
  // the most destructive and was previously invisible: the x/y and dangling-endpoint
  // checks cannot see it. Detection only (US3 out of scope: repairing the node).
  private auditCanvasState(
    path: string,
    nodesMap: Y.Map<Y.Map<unknown>>,
    edgesMap: Y.Map<Y.Map<unknown>>,
  ): void {
    if (!this.logger) return;
    const nodeIds = new Set<string>(nodesMap.keys());
    const noGeo: string[] = [];
    const noType: string[] = [];
    const fileNodesWithoutFile: string[] = [];
    for (const [id, node] of nodesMap) {
      if (typeof node.get("x") !== "number" || typeof node.get("y") !== "number") noGeo.push(id);
      const type = node.get("type");
      if (typeof type !== "string" || type.length === 0) {
        noType.push(id);
      } else if (type === "file" && typeof node.get("file") !== "string") {
        fileNodesWithoutFile.push(id);
      }
    }
    const danglingEdges: string[] = [];
    for (const [id, edge] of edgesMap) {
      const from = edge.get("fromNode");
      const to = edge.get("toNode");
      if (
        (typeof from === "string" && !nodeIds.has(from)) ||
        (typeof to === "string" && !nodeIds.has(to))
      ) {
        danglingEdges.push(id);
      }
    }
    this.logger.debug(
      "canvas-sync",
      `disk write ${path}: nodes=${nodeIds.size} edges=${edgesMap.size}`,
    );
    if (noGeo.length) {
      this.logger.warn(
        "canvas-sync",
        `SCATTER signature: ${noGeo.length} node(s) missing geometry: ${noGeo.join(", ")}`,
      );
    }
    if (danglingEdges.length) {
      this.logger.warn(
        "canvas-sync",
        `DETACH signature: ${danglingEdges.length} edge(s) pruned (endpoint absent): ${danglingEdges.join(", ")}`,
      );
    }
    // WP5 (US3 AC12/AC13, US6): one greppable line per audit, listing only the
    // broken ids — never node text or any other user data.
    const noTypeParts: string[] = [];
    if (noType.length) {
      noTypeParts.push(`${noType.length} node(s) missing type: ${noType.join(", ")}`);
    }
    if (fileNodesWithoutFile.length) {
      noTypeParts.push(
        `${fileNodesWithoutFile.length} file node(s) missing file: ${fileNodesWithoutFile.join(", ")}`,
      );
    }
    if (noTypeParts.length) {
      this.logger.warn("canvas-sync", `NO TYPE signature: ${noTypeParts.join("; ")}`);
    }
  }

  // WP7 (US5 AC13, BUILD_SPEC § 9 WP7 AC9): RETAINED as the seed-path helper,
  // but it has NO CRDT-observer-driven caller any more — the doc observer no
  // longer schedules a disk write at all, so this class is not a `.canvas`
  // writer during a session. The `expectedSeq` gate below is likewise retained
  // rather than ported into `CanvasPersistence`: the new writer serializes the
  // doc synchronously immediately before its (queued) write, so the early
  // snapshot this gate compensates for cannot exist there.
  private async writeToDisk(path: string, content: string, expectedSeq?: number): Promise<void> {
    // Final defense-in-depth gate: every disk write funnels through here.
    if (!isPathSafe(path)) return;
    if (this.lastWrittenContent.get(path) === content) return;
    // WP4 (US5 AC1): version/sequence gate. If a remote delta was integrated
    // after this flush snapshotted its content (sequence ADVANCED past the
    // snapshot), the snapshot is stale — writing it would overwrite the in-flight
    // remote change on disk. Yield; the observer that integrated the remote delta
    // scheduled its own flush of the newer content. Strict ">" (not "!=") so a
    // reset (destroy clearing the map -> 0) is never read as staleness. Seed
    // writes pass no expectedSeq and are intentionally ungated.
    if (expectedSeq !== undefined && this.currentSeq(path) > expectedSeq) return;
    const diskPath = toLocalPath(path);
    this.recentDiskWrites.add(path);
    this.fileOpsManager.mutePathEvents(diskPath);
    try {
      const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
      if (parentDir) await ensureFolder(this.vault, parentDir);
      // Re-check after the awaited folder ensure: a remote delta may have landed
      // during the await. Yield rather than clobber it.
      if (expectedSeq !== undefined && this.currentSeq(path) > expectedSeq) return;
      await this.vault.adapter.write(diskPath, content);
      this.lastWrittenContent.set(path, content);
    } catch {
      new Notice(`Live Share: failed to write canvas ${diskPath}`);
    } finally {
      setTimeout(() => {
        this.recentDiskWrites.delete(path);
        this.fileOpsManager.unmutePathEvents(diskPath);
      }, VAULT_EVENT_SETTLE_MS);
    }
  }
}
