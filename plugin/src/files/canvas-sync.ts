import { Notice, type Vault } from "obsidian";
import * as Y from "yjs";

import type { SyncManager } from "../sync/sync";
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
    const unobserve = this.observers.get(path);
    if (unobserve) {
      unobserve();
      this.observers.delete(path);
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

    this.recentLocalEdits.add(path);
    docHandle.doc.transact(() => {
      this.applyLocalDiffToYMaps(nodesMap, base.nodes, next.nodes);
      this.applyLocalDiffToYMaps(edgesMap, base.edges, next.edges);
    });
    this.recentLocalEdits.delete(path);
    // Advance the baseline to the state now on disk so the next local modify
    // diffs against current disk truth.
    this.lastWrittenContent.set(path, content);
  }

  // Bug C: apply the local user's diff (base -> next) to the shared Y map,
  // touching only entries the user actually added / modified / deleted.
  private applyLocalDiffToYMaps(
    ymap: Y.Map<Y.Map<unknown>>,
    base: Record<string, Record<string, unknown>>,
    next: Record<string, Record<string, unknown>>,
  ): void {
    for (const [id, obj] of Object.entries(next)) {
      const baseObj = base[id];
      const existing = ymap.get(id);
      if (!baseObj) {
        // Added locally (not in this client's last-known state).
        let yObj = existing;
        if (!yObj) {
          yObj = new Y.Map<unknown>();
          ymap.set(id, yObj);
        }
        applyToYMap(yObj, obj);
      } else if (existing) {
        // Present in both base and Y map: push only per-key local changes so
        // an un-flushed remote change on a different key is preserved.
        applyKeyDiff(existing, baseObj, obj);
      } else if (objChanged(baseObj, obj)) {
        // Present in this client's base but removed from the Y map by a remote
        // delete, yet the local user changed it: re-create it. If unchanged,
        // respect the remote delete (do nothing).
        const yObj = new Y.Map<unknown>();
        ymap.set(id, yObj);
        applyToYMap(yObj, obj);
      }
      // else: unchanged locally -> leave the Y map untouched.
    }
    // Genuine local deletes: present in this client's base but removed in next.
    for (const id of Object.keys(base)) {
      if (!(id in next)) ymap.delete(id);
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
    for (const [, unobserve] of this.observers) {
      unobserve();
    }
    this.observers.clear();
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
        const content = serializeCanvas(nodesMap, edgesMap);
        void this.writeToDisk(path, content);
      }, delay),
    );
  }

  private async writeToDisk(path: string, content: string): Promise<void> {
    // Final defense-in-depth gate: every disk write funnels through here.
    if (!isPathSafe(path)) return;
    if (this.lastWrittenContent.get(path) === content) return;
    const diskPath = toLocalPath(path);
    this.recentDiskWrites.add(path);
    this.fileOpsManager.mutePathEvents(diskPath);
    try {
      const parentDir = diskPath.substring(0, diskPath.lastIndexOf("/"));
      if (parentDir) await ensureFolder(this.vault, parentDir);
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
