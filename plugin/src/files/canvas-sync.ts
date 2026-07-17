import { Notice, type Vault } from "obsidian";
import * as Y from "yjs";

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
const DEBOUNCE_MS = 200;
const MAX_WAIT_MS = 500;

interface CanvasData {
  nodes: Record<string, Record<string, unknown>>;
  edges: Record<string, Record<string, unknown>>;
}

function parseCanvas(content: string): CanvasData {
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

function serializeCanvas(nodesMap: Y.Map<Y.Map<unknown>>, edgesMap: Y.Map<Y.Map<unknown>>): string {
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

  return JSON.stringify({ nodes, edges }, null, "\t");
}

function applyToYMap(ymap: Y.Map<unknown>, obj: Record<string, unknown>): void {
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
    ymap.delete(key);
  }
}

// True if any key differs between the two plain objects (shallow compare).
function objChanged(base: Record<string, unknown>, next: Record<string, unknown>): boolean {
  for (const key of Object.keys(next)) {
    if (base[key] !== next[key]) return true;
  }
  for (const key of Object.keys(base)) {
    if (!(key in next)) return true;
  }
  return false;
}

// Bug C: push ONLY the keys the local user actually changed relative to `base`
// (the last content this client knew) into the existing Y.Map. Keys that are
// unchanged relative to `base` are left untouched so an un-flushed remote delta
// on that same key is never clobbered by this client's stale on-disk value.
function applyKeyDiff(
  ymap: Y.Map<unknown>,
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(next)) {
    // Only touch keys the local user changed (or added) relative to base.
    if (base[key] !== value) {
      if (ymap.get(key) !== value) ymap.set(key, value);
    }
  }
  // Keys the local user removed relative to base.
  for (const key of Object.keys(base)) {
    if (!(key in next)) ymap.delete(key);
  }
}

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
  // WP4 (US5 AC1): per-path monotonic counter of remote (non-local) Yjs
  // transactions applied to the canvas doc. A whole-file disk flush snapshots
  // this; if it has advanced by write time, an in-flight remote delta arrived
  // after the snapshot and the flush must yield rather than clobber it. This is a
  // version/sequence gate, NOT a wall-clock debounce race.
  private remoteSeq = new Map<string, number>();
  private seqHandlers = new Map<string, () => void>();

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

  // WP2: expose the canvas doc handle (incl. its own awareness channel) so the
  // presence layer can read/write canvas cursors + locks on getDoc().awareness.
  getCanvasDocHandle(rawPath: string): DocHandle | null {
    const path = toCanonicalPath(normalizePath(rawPath));
    return this.syncManager.getDoc(`${CANVAS_DOC_PREFIX}${path}`);
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
        // Bug C: establish the diff baseline so the first local modify diffs
        // against what this client knows the file to be, not against nothing.
        this.lastWrittenContent.set(path, content);
      }
    } else {
      if (nodesMap.size > 0 || edgesMap.size > 0) {
        const content = serializeCanvas(nodesMap, edgesMap);
        await this.writeToDisk(path, content); // also records the diff baseline
      } else {
        // No shared data yet: baseline is whatever is currently on disk.
        const file = getFileByPath(this.vault, diskPath);
        if (file) {
          this.lastWrittenContent.set(path, await this.vault.read(file));
        }
      }
    }

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
      this.scheduleDiskWrite(path, nodesMap, edgesMap);
    };
    nodesMap.observeDeep(observer);
    edgesMap.observeDeep(observer);
    this.observers.set(path, () => {
      nodesMap.unobserveDeep(observer);
      edgesMap.unobserveDeep(observer);
    });
  }

  unsubscribe(rawPath: string): void {
    const path = toCanonicalPath(normalizePath(rawPath));
    this.subscribedPaths.delete(path);
    const timer = this.writeTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(path);
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
    const next = parseCanvas(content);
    // Bug C: diff the freshly-read local file against the last content THIS
    // client knew (lastWrittenContent), and push ONLY the nodes/edges/keys the
    // local user actually changed. Nodes that are un-flushed remote deltas are
    // absent from both base and next, so they are never touched. A node that is
    // missing only because the on-disk file is stale (present in neither base
    // nor next) is NOT deleted; only nodes present in base but removed in next
    // (a genuine local delete) are deleted.
    const baseContent = this.lastWrittenContent.get(path);
    const base = baseContent !== undefined ? parseCanvas(baseContent) : { nodes: {}, edges: {} };
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");

    const deletedNodeIds: string[] = [];
    this.recentLocalEdits.add(path);
    docHandle.doc.transact(() => {
      this.applyLocalDiffToYMaps(nodesMap, base.nodes, next.nodes, { path, deleted: deletedNodeIds });
      this.applyLocalDiffToYMaps(edgesMap, base.edges, next.edges);
      // GAP-5 (US5 AC3): cascade-prune edges whose endpoint node the local user
      // just deleted, so the shared doc never carries a dangling edge.
      if (deletedNodeIds.length > 0) {
        this.pruneEdgesForDeletedNodes(edgesMap, deletedNodeIds);
      }
    });
    this.recentLocalEdits.delete(path);
    // Advance the baseline to the state now on disk so the next local modify
    // diffs against current disk truth.
    this.lastWrittenContent.set(path, content);
  }

  // Bug C: apply the local user's diff (base -> next) to the shared Y map,
  // touching only entries the user actually added / modified / deleted.
  //
  // `opts` is set ONLY for the NODES map (not edges) and enables the WP3 lock
  // enforcement seam + the WP3 diff-inferred fallback + the GAP-2 no-resurrect
  // fix. Edges call this with no opts and keep the original merge behavior.
  private applyLocalDiffToYMaps(
    ymap: Y.Map<Y.Map<unknown>>,
    base: Record<string, Record<string, unknown>>,
    next: Record<string, Record<string, unknown>>,
    opts?: { path: string; deleted: string[] },
  ): void {
    for (const [id, obj] of Object.entries(next)) {
      const baseObj = base[id];
      const existing = ymap.get(id);
      if (!baseObj) {
        if (!existing) {
          // Genuinely new local node: the user just added it. Fire the
          // diff-inferred lock claim (US3 AC2 fallback), then gate the write.
          if (opts) {
            this.onLocalNodeChange?.(opts.path, id);
            if (!this.canWriteNode(opts.path, id)) continue; // US3 AC5: drop write
          }
          const yObj = new Y.Map<unknown>();
          ymap.set(id, yObj);
          applyToYMap(yObj, obj);
        } else {
          // Not in our last-known state but already in the Y map (a remote add
          // now also on disk). Not a local user edit — merge without claiming.
          applyToYMap(existing, obj);
        }
      } else if (existing) {
        // Present in both base and Y map. Only a genuine local key change fires
        // the fallback claim + is gated; an unchanged node is left untouched so
        // an un-flushed remote change on another key survives (Bug C).
        if (opts && objChanged(baseObj, obj)) {
          this.onLocalNodeChange?.(opts.path, id);
          if (!this.canWriteNode(opts.path, id)) continue; // US3 AC5 / US5 AC2 drop
        }
        applyKeyDiff(existing, baseObj, obj);
      } else if (opts) {
        // Present in this client's base but removed from the Y map by a remote
        // delete. GAP-2 delete-wins / no-resurrect: NEVER re-create it, even if
        // the local user also edited it. (This replaces the old resurrect at
        // canvas-sync.ts:304-311.) The presence layer drops any held lock via
        // CanvasPresence.onRemoteNodeDeleted.
      } else if (objChanged(baseObj, obj)) {
        // Edges (no lock semantics): keep the original re-create behavior.
        const yObj = new Y.Map<unknown>();
        ymap.set(id, yObj);
        applyToYMap(yObj, obj);
      }
      // else: unchanged locally -> leave the Y map untouched.
    }
    // Genuine local deletes: present in this client's base but removed in next.
    for (const id of Object.keys(base)) {
      if (id in next) continue;
      if (opts) {
        // US3 AC7 / GAP-2: cannot delete a node another peer holds locked.
        if (!this.canDeleteNode(opts.path, id)) continue;
        opts.deleted.push(id);
      }
      ymap.delete(id);
    }
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

  private scheduleDiskWrite(
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
    // still flushes at least ~every MAX_WAIT_MS instead of resetting forever.
    const delay = Math.max(0, Math.min(DEBOUNCE_MS, firstScheduled + MAX_WAIT_MS - now));
    this.writeTimers.set(
      path,
      setTimeout(() => {
        this.writeTimers.delete(path);
        this.writeFirstScheduled.delete(path);
        // Snapshot the remote sequence together with the serialized content (no
        // interleaving await) so writeToDisk can detect a remote delta that lands
        // afterwards and yield instead of clobbering it (US5 AC1).
        const seq = this.currentSeq(path);
        const content = serializeCanvas(nodesMap, edgesMap);
        void this.writeToDisk(path, content, seq);
      }, delay),
    );
  }

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
