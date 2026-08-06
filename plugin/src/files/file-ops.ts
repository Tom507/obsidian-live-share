import { type FileManager, Notice, type TAbstractFile, TFile, type Vault } from "obsidian";
import { OfflineQueue } from "../sync/offline-queue";
import type { FileOp } from "../types";
import {
  VAULT_EVENT_SETTLE_MS,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  ensureFolder,
  isPathSafe,
  isTextFile,
  normalizeLineEndings,
  normalizePath,
  skipsAutoTextSync,
  toCanonicalPath,
  toLocalPath,
} from "../utils";
import { isSidecarPath } from "./canvas-sidecar";

const CHUNK_SIZE = 512 * 1024;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
// Yield to the event loop every N chunks so a large binary (>100 chunks) does
// not emit its whole burst synchronously and self-trip the control-channel
// rate limit (Bug L5).
const CHUNK_PACING_BATCH = 32;
const RENAME_RETRY_DELAY_MS = 300;
const STALE_TRANSFER_MS = 5 * 60 * 1000;

interface ChunkAssembly {
  chunks: string[];
  totalSize: number;
  binary?: boolean;
  transferId?: string;
  lastActivity: number;
}

interface OutgoingTransfer {
  path: string;
  content: string;
  binary: boolean;
  totalChunks: number;
  lastActivity: number;
}

export class FileOpsManager {
  private vault: Vault;
  private fileManager: FileManager;
  private sendOp: ((op: FileOp) => void) | null = null;
  private mutedPaths = new Map<string, number>();
  private pendingChunks = new Map<string, ChunkAssembly>();
  private outgoingTransfers = new Map<string, OutgoingTransfer>();
  private opQueues = new Map<string, Promise<void>>();
  private sendQueues = new Map<string, Promise<void>>();
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private offlineQueue = new OfflineQueue();
  private isOnline = true;
  // --- WP88 (AC6) — S40's coupling, bounded by construction ------------------
  //
  // NOT a cap and not a retention policy: there is no constant here, nothing is
  // evicted, and nothing already queued is discarded. C82's ruling that a cap
  // is a data-retention decision stands untouched.
  //
  // What WP88 owns is the bound it REMOVES. Before WP88 this queue was bounded
  // by the session being destroyed ~128 s after the link died — an accidental
  // and destructive bound, but a bound. Now the peer survives its own outage,
  // so an uncapped queue would grow for as long as the outage lasts.
  //
  // The structural answer: once the carrier link's retry chain has ENDED, this
  // manager knows it will not send these ops. Accepting them anyway is the same
  // lie the status bar told before WP82. So it stops accepting and COUNTS what
  // it refused, which is the difference between a bound and a silent drop.
  private acceptingIntoQueue = true;
  private refusedWhileSealed = 0;
  // --- WP68 (C68 AC1) — the outbound sidecar-rename refusal, COUNTED ---------
  //
  // A refusal that leaves no trace is indistinguishable from a rename that never
  // happened, and this run has already paid for that confusion twice. The
  // counter is the observable; it is state, not a log line, so a test can be an
  // oracle over it (see the WP88 counter directly above for the precedent and
  // the reasoning). It counts refusals only — it is never decremented, and
  // nothing else in this class reads it.
  private refusedSidecarRenames = 0;

  constructor(vault: Vault, fileManager: FileManager) {
    this.vault = vault;
    this.fileManager = fileManager;
    this.staleTimer = setInterval(() => this.purgeStaleTransfers(), 60_000);
  }

  destroy(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    this.outgoingTransfers.clear();
    this.pendingChunks.clear();
    this.offlineQueue.clear();
    this.mutedPaths.clear();
    this.opQueues.clear();
    this.sendQueues.clear();
  }

  /**
   * WP82 (AC2) — READ-ONLY. How many ops are waiting for a drain, and whether
   * this manager currently believes it may transmit. Nothing about what the
   * queue HOLDS changes here, and no cap is introduced: `OfflineQueue`'s
   * unboundedness is S40, a data-retention decision that is explicitly out of
   * this WP's scope. Reportable is not the same as repaired.
   *
   * This exists because a peer that had latched `connected: false` was routing
   * every file operation into this queue while its status bar read
   * `Live Share: hosting`, and nothing in the process could say so.
   */
  getOfflineState(): {
    online: boolean;
    queueDepth: number;
    acceptingIntoQueue: boolean;
    refusedWhileSealed: number;
  } {
    return {
      online: this.isOnline,
      queueDepth: this.offlineQueue.size,
      // WP88 (AC6) — reported BESIDE the landed depth, never instead of it.
      // "the depth stopped growing" and "the depth stopped growing because
      // nothing was produced" are different observations, and only the refusal
      // counter can tell them apart.
      acceptingIntoQueue: this.acceptingIntoQueue,
      refusedWhileSealed: this.refusedWhileSealed,
    };
  }

  /**
   * WP68 (C68 AC1) — READ-ONLY. How many outbound renames this manager refused
   * because one of their endpoints was a sidecar path.
   *
   * "Nothing was emitted" and "nothing was emitted because the refusal fired"
   * are different observations, and only this counter tells them apart. It
   * carries no path: the count is a diagnostic, and a path here would put local
   * replica-state filenames into a value other components may render.
   */
  getSidecarRenameRefusals(): number {
    return this.refusedSidecarRenames;
  }

  /**
   * WP88 (AC6) — the stop-accepting boundary. WIRING ONLY: the decision is
   * `sync/link-state.ts`'s `acceptsIntoOfflineQueue`, taken over the definer's
   * verdict, and this manager is told the answer rather than computing it.
   *
   * Sealing NEVER discards. Everything already queued stays queued and is still
   * drained verbatim by {@link setOnline} when the peer comes back.
   */
  setQueueAccepting(accepting: boolean): void {
    if (this.acceptingIntoQueue === accepting) return;
    this.acceptingIntoQueue = accepting;
    // Re-opening resets the counter so a later seal reports ITS OWN refusals
    // rather than a running total across unrelated outages.
    if (accepting) this.refusedWhileSealed = 0;
  }

  setOnline(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;
    if (online && wasOffline && this.sendOp) {
      const ops = this.offlineQueue.drain();
      for (const op of ops) {
        this.sendOp(op);
      }
    }
  }

  private purgeStaleTransfers(): void {
    const now = Date.now();
    for (const [key, assembly] of this.pendingChunks) {
      if (now - assembly.lastActivity > STALE_TRANSFER_MS) {
        this.pendingChunks.delete(key);
      }
    }
    for (const [id, transfer] of this.outgoingTransfers) {
      if (now - transfer.lastActivity > STALE_TRANSFER_MS) {
        this.outgoingTransfers.delete(id);
      }
    }
  }

  setSender(sender: (op: FileOp) => void) {
    this.sendOp = sender;
  }

  private emitOp(op: FileOp): void {
    if (!this.sendOp) return;
    if (!this.isOnline) {
      // WP88 (AC6) — the chain that carries file ops has ended, so this op will
      // not be sent. Refusing it is counted; nothing already queued is touched.
      if (!this.acceptingIntoQueue) {
        this.refusedWhileSealed += 1;
        return;
      }
      this.offlineQueue.enqueue(op);
      return;
    }
    this.sendOp(op);
  }

  mutePathEvents(path: string): void {
    const norm = normalizePath(path);
    this.mutedPaths.set(norm, (this.mutedPaths.get(norm) ?? 0) + 1);
  }

  unmutePathEvents(path: string): void {
    const norm = normalizePath(path);
    const count = this.mutedPaths.get(norm) ?? 0;
    if (count <= 1) {
      this.mutedPaths.delete(norm);
    } else {
      this.mutedPaths.set(norm, count - 1);
    }
  }

  isPathMuted(path: string): boolean {
    return (this.mutedPaths.get(normalizePath(path)) ?? 0) > 0;
  }

  clearPendingChunks(): void {
    this.pendingChunks.clear();
    this.outgoingTransfers.clear();
    this.offlineQueue.clear();
  }

  async applyRemoteOp(op: FileOp, afterApply?: () => Promise<void>) {
    const paths = this.getOpPaths(op);

    // Chain onto existing queue for all affected paths atomically
    const currentQueues = paths.map((path) => this.opQueues.get(path) ?? Promise.resolve());
    const gate = Promise.all(currentQueues);

    const promise = gate.then(async () => {
      await this.applyRemoteOpInner(op);
      if (afterApply) await afterApply();
    });

    // Set the new promise for all paths BEFORE awaiting
    for (const path of paths) this.opQueues.set(path, promise);

    try {
      await promise;
    } finally {
      for (const path of paths) {
        if (this.opQueues.get(path) === promise) this.opQueues.delete(path);
      }
    }
  }

  private isPathSafe(path: string): boolean {
    return isPathSafe(path);
  }

  private getOpPaths(op: FileOp): string[] {
    const paths: string[] = [];
    if ("path" in op) paths.push(normalizePath(op.path));
    if ("oldPath" in op) paths.push(normalizePath(op.oldPath));
    if ("newPath" in op) paths.push(normalizePath(op.newPath));
    return paths;
  }

  private async applyRemoteOpInner(rawOp: FileOp) {
    const op = { ...rawOp } as FileOp;
    if ("path" in op) op.path = toLocalPath(normalizePath(op.path));
    if ("oldPath" in op) op.oldPath = toLocalPath(normalizePath(op.oldPath));
    if ("newPath" in op) op.newPath = toLocalPath(normalizePath(op.newPath));

    if ("path" in op && !this.isPathSafe(op.path)) return;
    if ("oldPath" in op && !this.isPathSafe(op.oldPath)) return;
    if ("newPath" in op && !this.isPathSafe(op.newPath)) return;

    const paths = this.getOpPaths(op);
    for (const path of paths) this.mutePathEvents(path);
    try {
      switch (op.type) {
        case "create": {
          const exists = this.vault.getAbstractFileByPath(op.path);
          if (exists && exists instanceof TFile) {
            if (op.binary) {
              const binaryData = base64ToArrayBuffer(op.content);
              await this.vault.modifyBinary(exists, binaryData);
            } else {
              await this.vault.modify(exists, op.content);
            }
          } else if (!exists) {
            const parentDir = op.path.substring(0, op.path.lastIndexOf("/"));
            if (parentDir) await ensureFolder(this.vault, parentDir);
            if (op.binary) {
              const binaryData = base64ToArrayBuffer(op.content);
              await this.vault.createBinary(op.path, binaryData);
            } else {
              await this.vault.create(op.path, op.content);
            }
          }
          break;
        }
        case "modify": {
          const file = this.vault.getAbstractFileByPath(op.path);
          if (file instanceof TFile) {
            if (op.binary) {
              const binaryData = base64ToArrayBuffer(op.content);
              await this.vault.modifyBinary(file, binaryData);
            } else {
              await this.vault.modify(file, op.content);
            }
          }
          break;
        }
        case "delete": {
          const file = this.vault.getAbstractFileByPath(op.path);
          if (file) {
            try {
              await this.fileManager.trashFile(file);
            } catch {
              // File may have already been deleted
            }
          }
          this.pendingChunks.delete(op.path);
          break;
        }
        case "rename": {
          let file = this.vault.getAbstractFileByPath(op.oldPath);
          if (!file) {
            await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
            file = this.vault.getAbstractFileByPath(op.oldPath);
          }
          const alreadyExists = this.vault.getAbstractFileByPath(op.newPath);
          if (alreadyExists && !file) {
            break;
          }
          if (file && !alreadyExists) {
            const parentDir = op.newPath.substring(0, op.newPath.lastIndexOf("/"));
            if (parentDir) await ensureFolder(this.vault, parentDir);
            try {
              await this.vault.rename(file, op.newPath);
            } catch (renameErr) {
              if (!this.vault.getAbstractFileByPath(op.newPath)) throw renameErr;
            }
          } else if (file && alreadyExists) {
            await this.fileManager.trashFile(file);
          }
          break;
        }
        case "chunk-start": {
          if (op.totalSize <= 0 || op.totalSize > MAX_FILE_SIZE) {
            if (op.totalSize > MAX_FILE_SIZE) {
              new Notice(`Live Share: incoming ${op.path} exceeds 50 MB limit, skipping`);
            }
            break;
          }
          const chunkKey = op.transferId ?? op.path;
          this.pendingChunks.delete(chunkKey);
          this.pendingChunks.set(chunkKey, {
            chunks: [],
            totalSize: op.totalSize,
            binary: op.binary,
            transferId: op.transferId,
            lastActivity: Date.now(),
          });
          break;
        }
        case "chunk-data": {
          const dataKey = op.transferId ?? op.path;
          const assembly = this.pendingChunks.get(dataKey);
          if (assembly) {
            const expectedChunks = Math.ceil(assembly.totalSize / CHUNK_SIZE);
            if (op.index < 0 || op.index >= expectedChunks) break;
            assembly.chunks[op.index] = op.data;
            assembly.lastActivity = Date.now();
          }
          break;
        }
        case "chunk-end": {
          const endKey = op.transferId ?? op.path;
          const assembly = this.pendingChunks.get(endKey);
          if (!assembly) break;

          const expectedChunks = Math.ceil(assembly.totalSize / CHUNK_SIZE);
          const missingSeqs: number[] = [];
          for (let i = 0; i < expectedChunks; i++) {
            if (assembly.chunks[i] === undefined) missingSeqs.push(i);
          }
          if (missingSeqs.length > 0) {
            if (assembly.transferId) {
              const receivedSeqs: number[] = [];
              for (let i = 0; i < expectedChunks; i++) {
                if (assembly.chunks[i] !== undefined) receivedSeqs.push(i);
              }
              this.sendOp?.({
                type: "chunk-resume",
                path: op.path,
                transferId: assembly.transferId,
                receivedSeqs,
              });
              break;
            }
            this.pendingChunks.delete(endKey);
            new Notice(`Live Share: incomplete transfer for ${op.path}, some chunks were lost`);
            break;
          }

          this.pendingChunks.delete(endKey);
          const joined = assembly.chunks.join("");
          const exists = this.vault.getAbstractFileByPath(op.path);
          if (assembly.binary) {
            const binaryData = base64ToArrayBuffer(joined);
            if (exists && exists instanceof TFile) {
              await this.vault.modifyBinary(exists, binaryData);
            } else {
              const parentDir = op.path.substring(0, op.path.lastIndexOf("/"));
              if (parentDir) await ensureFolder(this.vault, parentDir);
              await this.vault.createBinary(op.path, binaryData);
            }
          } else {
            if (exists && exists instanceof TFile) {
              await this.vault.modify(exists, joined);
            } else {
              const parentDir = op.path.substring(0, op.path.lastIndexOf("/"));
              if (parentDir) await ensureFolder(this.vault, parentDir);
              await this.vault.create(op.path, joined);
            }
          }
          break;
        }
        case "chunk-resume": {
          const transfer = this.outgoingTransfers.get(op.transferId);
          if (!transfer) break;
          transfer.lastActivity = Date.now();
          const receivedSet = new Set(op.receivedSeqs);
          for (let i = 0; i < transfer.totalChunks; i++) {
            if (!receivedSet.has(i)) {
              const chunk = transfer.content.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
              this.sendOp?.({
                type: "chunk-data",
                path: transfer.path,
                index: i,
                data: chunk,
                transferId: op.transferId,
              });
            }
          }
          this.sendOp?.({
            type: "chunk-end",
            path: transfer.path,
            transferId: op.transferId,
          });
          break;
        }
        case "folder-create": {
          await ensureFolder(this.vault, op.path);
          break;
        }
      }
    } catch {
      const opPath = "path" in op ? op.path : "unknown";
      new Notice(`Live Share: failed to apply ${op.type} for ${opPath}`);
    } finally {
      setTimeout(() => {
        for (const path of paths) this.unmutePathEvents(path);
      }, VAULT_EVENT_SETTLE_MS);
    }
  }

  async onFileCreate(file: TAbstractFile) {
    const localPath = normalizePath(file.path);
    if (this.isPathMuted(localPath) || !this.sendOp) return;
    const wirePath = toCanonicalPath(localPath);
    if (!(file instanceof TFile)) {
      this.emitOp({ type: "folder-create", path: wirePath });
      return;
    }
    // WP83 (C83 AC1) — THE CONTENT PUSH IS REFUSED FOR A PATH `CanvasSync` OWNS.
    //
    // Everything below this line reads the whole file and pushes it as
    // `{type:"create", path, content}` (`sendFileContent`, or `sendChunked` above
    // CHUNK_SIZE). The receiver applies that with `vault.modify` / `vault.create`
    // (`applyRemoteOpInner`, the `"create"` case) under a path mute taken
    // immediately before the apply — so for a `.canvas` the bytes land on the
    // peer's disk as a RAW, UNMERGED, LAST-WRITER-WINS overwrite of a file
    // `CanvasSync` owns, and the mute means the resulting vault `modify` never
    // reaches `handleLocalModify` and the doc is never told. No CRDT, no merge,
    // no capture. (It installs no second `Y.Text` — this is a different and
    // sharper defect than the double-CRDT the sidecar clause guards against.)
    //
    // It is also what made scenario `[07]` unfalsifiable: the door delivered the
    // file to the guest before WP79's mirror pass ran, the mirror then correctly
    // answered `skip-local-file`, and a file-existence assertion could not tell
    // the two mechanisms apart.
    //
    // THE GUARD IS THE SHARED PREDICATE, IMPORTED — never a private
    // `endsWith(".canvas")`, never a re-spelt sidecar test, never a second
    // constant. Four private copies of that test is exactly how this defect class
    // propagated (see `skipsAutoTextSync`'s contract comment in `utils.ts`).
    //
    // SCOPE, deliberately narrow: this refuses the CONTENT PUSH and nothing else.
    // The folder branch above it still runs; `onFileDelete` / `onFileRename` are
    // untouched (they carry no content); the mute-based loop prevention at the
    // top of this method is untouched; nothing is deleted, trashed or renamed.
    // A shared `.canvas` still reaches a peer — through the two routes the design
    // sanctions, the `CanvasSync` doc and WP79's mirror materialisation, both of
    // which merge.
    if (skipsAutoTextSync(wirePath)) return;
    const prev = this.sendQueues.get(localPath) ?? Promise.resolve();
    const binary = !isTextFile(file.path);
    const tfile = file;
    const task = prev.then(async () => {
      if (!this.sendOp) return;
      try {
        if (binary) {
          const binaryContent = await this.vault.readBinary(tfile);
          if (this.isPathMuted(localPath)) return;
          if (binaryContent.byteLength > MAX_FILE_SIZE) {
            new Notice(`Live Share: ${localPath} exceeds 50 MB limit, skipping`);
            return;
          }
          this.sendFileContent(wirePath, arrayBufferToBase64(binaryContent), true);
        } else {
          const content = normalizeLineEndings(await this.vault.read(tfile));
          if (this.isPathMuted(localPath)) return;
          this.sendFileContent(wirePath, content, false);
        }
      } catch {
        // File may have been deleted/renamed before we could read it
        new Notice(`Live Share: failed to sync ${localPath}`);
      }
    });
    this.sendQueues.set(localPath, task);
    await task;
    if (this.sendQueues.get(localPath) === task) this.sendQueues.delete(localPath);
  }

  async onFileModify(file: TAbstractFile) {
    const localPath = normalizePath(file.path);
    if (this.isPathMuted(localPath) || !this.sendOp) return;
    if (!(file instanceof TFile)) return;
    const binary = !isTextFile(file.path);
    if (!binary) return;
    const wirePath = toCanonicalPath(localPath);
    const tfile = file;
    const prev = this.sendQueues.get(localPath) ?? Promise.resolve();
    const task = prev.then(async () => {
      if (!this.sendOp) return;
      try {
        const binaryContent = await this.vault.readBinary(tfile);
        if (this.isPathMuted(localPath)) return;
        if (binaryContent.byteLength > MAX_FILE_SIZE) {
          new Notice(`Live Share: ${localPath} exceeds 50 MB limit, skipping`);
          return;
        }
        const content = arrayBufferToBase64(binaryContent);
        if (content.length > CHUNK_SIZE) {
          void this.sendChunked(wirePath, content, true);
        } else {
          this.emitOp({
            type: "modify",
            path: wirePath,
            content,
            binary: true,
          });
        }
      } catch {
        new Notice(`Live Share: failed to sync ${localPath}`);
      }
    });
    this.sendQueues.set(localPath, task);
    await task;
    if (this.sendQueues.get(localPath) === task) this.sendQueues.delete(localPath);
  }

  onFileDelete(file: TAbstractFile) {
    const localPath = normalizePath(file.path);
    if (this.isPathMuted(localPath) || !this.sendOp) return;
    const wirePath = toCanonicalPath(localPath);
    const prev = this.sendQueues.get(localPath) ?? Promise.resolve();
    const task = prev.then(() => {
      this.emitOp({ type: "delete", path: wirePath });
    });
    this.sendQueues.set(localPath, task);
  }

  onFileRename(file: TAbstractFile, oldPath: string) {
    const localNew = normalizePath(file.path);
    const localOld = normalizePath(oldPath);
    if (this.isPathMuted(localNew) || this.isPathMuted(localOld) || !this.sendOp) return;
    const wireOld = toCanonicalPath(localOld);
    const wireNew = toCanonicalPath(localNew);
    // ------------------------------------------------------------- WP68 AC1 --
    // THE OUTBOUND HALF OF C26'S GUARANTEE, ON THE FILE-OP CHANNEL.
    //
    // C26 established that local replica state is never shared CONTENT. This is
    // the same guarantee for the file-operation channel, in the direction this
    // peer produces. Before this line `onFileRename` had no path-class guard of
    // any kind — its only conditions were the two mutes and the presence of a
    // sender — so a rename whose destination lay under the sidecar directory was
    // emitted verbatim, and a peer applying it would move ITS OWN copy of a
    // shared note into ITS OWN `.obsidian/**`. The reverse direction is not
    // decoration: `index.json` is a fixed filename every peer holds, so a rename
    // OUT of the sidecar directory names a path that exists everywhere.
    //
    // BOTH ENDPOINTS, and both spellings. The local and the canonical form of a
    // path can only differ in the seven characters `toLocalPath` substitutes on
    // Windows, none of which occurs in the sidecar directory prefix — so today
    // the four tests below collapse to two. They are written out anyway rather
    // than argued down to two, because the argument depends on a character map
    // in another module and a test that rests on it would go quiet if that map
    // ever grew a `.` or a `/`.
    //
    // PLACED ABOVE THE QUEUE ACQUISITION, deliberately (AC4). A refusal takes no
    // `sendQueues` slot, takes no mute and schedules no task, so it leaves the
    // per-path bookkeeping exactly as an ordinary muted rename does — the early
    // return one line up. There is no path here on which a refusal could strand
    // a mute count and silently freeze the path.
    //
    // REFUSING IS ALL IT DOES (AC3, I11). No trash, no delete, no recreate, and
    // no vault call whatsoever: `onFileRename` has never touched the disk and
    // still does not. The local rename Obsidian already performed stands; the
    // peers keep their own copies at the old path. That divergence is the
    // ACCEPTED outcome. "The file left the shared tree, so drop it" is the
    // refuse-then-delete trap, and it is the defect this guard exists to avoid
    // becoming.
    //
    // The manifest arm is NOT merged into this one and must not be:
    // `ManifestManager.renameFile` still deletes the stale old key and still
    // declines a sidecar destination (WP26/C26). The two arms give deliberately
    // different answers to the same event — the manifest entry goes, the peer's
    // file stays — and unifying them breaks one of the two.
    if (
      isSidecarPath(localOld) ||
      isSidecarPath(localNew) ||
      isSidecarPath(wireOld) ||
      isSidecarPath(wireNew)
    ) {
      this.refusedSidecarRenames += 1;
      return;
    }
    const prev = this.sendQueues.get(localOld) ?? Promise.resolve();
    const task = prev.then(() => {
      this.emitOp({
        type: "rename",
        oldPath: wireOld,
        newPath: wireNew,
      });
    });
    this.sendQueues.set(localOld, task);
    this.sendQueues.set(localNew, task);
  }

  private sendFileContent(path: string, content: string, binary: boolean) {
    if (content.length > CHUNK_SIZE) {
      void this.sendChunked(path, content, binary);
    } else {
      this.emitOp(
        binary
          ? { type: "create", path, content, binary: true }
          : { type: "create", path, content },
      );
    }
  }

  private async sendChunked(path: string, content: string, binary: boolean) {
    if (!this.sendOp) return;
    const transferId = crypto.randomUUID();
    const totalChunks = Math.ceil(content.length / CHUNK_SIZE);
    this.outgoingTransfers.set(transferId, {
      path,
      content,
      binary,
      totalChunks,
      lastActivity: Date.now(),
    });
    this.emitOp(
      binary
        ? {
            type: "chunk-start",
            path,
            totalSize: content.length,
            binary: true,
            transferId,
          }
        : { type: "chunk-start", path, totalSize: content.length, transferId },
    );
    for (let i = 0; i < totalChunks; i++) {
      const chunk = content.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      this.emitOp({
        type: "chunk-data",
        path,
        index: i,
        data: chunk,
        transferId,
      });
      // Pace the burst: yield periodically so we never emit >100 frames in a
      // single synchronous tick and self-trip the server rate limit (Bug L5).
      if ((i + 1) % CHUNK_PACING_BATCH === 0 && i + 1 < totalChunks) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    this.emitOp({ type: "chunk-end", path, transferId });
  }
}
