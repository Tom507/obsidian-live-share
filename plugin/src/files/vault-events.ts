import { MarkdownView, Notice, type TAbstractFile, TFile } from "obsidian";

import type LiveSharePlugin from "../main";
import { isTextFile } from "../utils";
import type { MuteConsumingEvent } from "./file-ops";

// ---------------------------------------------------------------------------
// WP6 / US5 — canvas ownership (BUILD_SPEC § 6.1 state machine).
//
// A shared `.canvas` path has EXACTLY ONE owner at any instant:
//
//   CANVAS-OWNED   CanvasSync holds the structured nodes/edges doc.
//                  The raw-text path is unreachable for that path.
//   TEXT-OWNED     BackgroundSync holds the whole file as one Y.Text.
//                  Entered only on a FAILED CanvasSync subscribe (fallback).
//
// Two owners at once is what destroys edge endpoints: a Y.Text merge of two
// concurrently-rewritten JSON files interleaves characters, and an edge is
// nothing but references.
// ---------------------------------------------------------------------------

/** Minimal structural surface of `CanvasSync` needed to decide ownership. */
export interface CanvasOwnershipSource {
  isSubscribed(path: string): boolean;
}

/** Minimal structural logger surface (the concrete `DebugLogger` satisfies it). */
export interface CanvasFallbackLogger {
  warn(category: string, message: string): void;
}

export interface CanvasHandoverOptions {
  path: string;
  role: "host" | "guest";
  backgroundSync: {
    subscribe(path: string): Promise<void>;
    unsubscribe(path: string): void;
  };
  canvasSync: {
    subscribe(path: string, role: "host" | "guest"): Promise<void>;
    isSubscribed(path: string): boolean;
  };
  logger?: CanvasFallbackLogger | null;
}

/**
 * US5 AC3 — the single ownership predicate, evaluated once per `modify` event.
 *
 * A **pending** subscribe already counts as owned: `CanvasSync.subscribe` adds to
 * `subscribedPaths` synchronously, before its first `await`, so there is no
 * unowned window while a subscribe is in flight. Only a genuinely FAILED
 * subscribe (no doc, or `waitForSync` threw) removes the path again.
 */
export function canvasOwned(
  path: string,
  canvasSync: CanvasOwnershipSource | null | undefined,
): boolean {
  if (!path.endsWith(".canvas")) return false;
  if (!canvasSync) return false;
  return canvasSync.isSubscribed(path);
}

// `CANVAS TEXT FALLBACK:` fires once per path per session (US6 AC5). Reset by
// `resetCanvasTextFallbackWarnings()` from the session teardown in main.ts.
const fallbackWarnedPaths = new Set<string>();

/** US6: emit `CANVAS TEXT FALLBACK:` at most once per path per session. */
export function warnCanvasTextFallback(
  path: string,
  logger: CanvasFallbackLogger | null | undefined,
): void {
  if (fallbackWarnedPaths.has(path)) return;
  fallbackWarnedPaths.add(path);
  logger?.warn(
    "canvas",
    `CANVAS TEXT FALLBACK: ${path} is syncing as raw text - CanvasSync does not own it`,
  );
}

/** Clears the once-per-session fallback warn memory. */
export function resetCanvasTextFallbackWarnings(): void {
  fallbackWarnedPaths.clear();
}

/**
 * US5 AC8/AC9 — the unowned↔owned transition, in one place so BOTH
 * `canvasSync.subscribe` call sites in `main.ts` get identical ordering.
 *
 * `backgroundSync.unsubscribe(path)` is the statement IMMEDIATELY PRECEDING
 * `canvasSync.subscribe(path, role)`, in the same synchronous block: `unsubscribe`
 * flushes the pending `Y.Text` write and detaches the observer, so the final text
 * flush lands *before* CanvasSync's seed reads the file and no vault event can
 * interleave between the two calls.
 *
 * If the subscribe genuinely FAILED (rejected, or settled without claiming the
 * path) the canvas would otherwise be silently unsynced, so the raw-text path is
 * installed as an announced fallback. It is exclusive — never concurrent with
 * `CanvasSync` — which is why it cannot reproduce the interleaving corruption.
 *
 * @returns true when CanvasSync owns the path afterwards, false on fallback.
 */
export async function subscribeCanvasWithHandover(
  options: CanvasHandoverOptions,
): Promise<boolean> {
  const { path, role, backgroundSync, canvasSync, logger } = options;
  backgroundSync.unsubscribe(path);
  const subscribed = canvasSync.subscribe(path, role);
  try {
    await subscribed;
  } catch {
    // A rejected subscribe is exactly the unowned case handled below.
  }
  if (canvasSync.isSubscribed(path)) return true;
  warnCanvasTextFallback(path, logger);
  await backgroundSync.subscribe(path);
  return false;
}

/**
 * WP93 (C93 AC3) — THE CONSUMPTION SIGNAL, and it is a report, not a gate.
 *
 * The five gates below already decide the same thing WP93 needs to know: this
 * vault event was suppressed BECAUSE the path is muted, so the echo the mute was
 * taken for has arrived and the mute has done its job. Saying so lets
 * `FileOpsManager` release on the event instead of on a `setTimeout` the host is
 * free to stretch to 60 s (S71).
 *
 * It is called ONLY where a gate returns because of the mute. Reporting every
 * event, muted or not, would release mutes that had not yet suppressed anything.
 *
 * Nothing branches on the result and no decision moves here: the WP6/US5
 * ownership predicate, the order of the gates and every early return are
 * byte-identical to before. In particular the canvas branch below is UNTOUCHED —
 * WP91 removed the mute from in front of canvas capture and putting anything
 * mute-shaped back there is an abort criterion, so a canvas-owned `modify`
 * reports nothing and `CanvasPersistence`'s mute keeps WP91's `MAX_MUTE_MS` cap.
 *
 * Optional-called: several test harnesses build a partial `fileOpsManager`
 * double with only the members their subject reaches, and this signal must not
 * turn those into a TypeError.
 */
function noteMuteConsumed(
  plugin: LiveSharePlugin,
  path: string,
  kind: MuteConsumingEvent,
): void {
  plugin.fileOpsManager.noteVaultEvent?.(path, kind);
}

export function registerVaultEvents(plugin: LiveSharePlugin): void {
  let pendingRename: Promise<void> | null = null;
  const renamedPaths = new Set<string>();

  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", () => {
      const run = () => {
        plugin.onActiveFileChange();
        plugin.presenceManager?.debouncedBroadcastPresence();
      };
      if (pendingRename) {
        void pendingRename.then(run);
      } else {
        run();
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on("create", (file: TAbstractFile) => {
      const originalPath = file.path;
      if (!plugin.manifestManager.isSharedPath(originalPath)) return;
      if (plugin.fileOpsManager.isPathMutedFor(originalPath, "create")) {
        // S120 — kind-aware. A mute armed for an op that cannot emit a `create`
        // no longer swallows one.
        noteMuteConsumed(plugin, originalPath, "create");
        plugin.fileOpsManager.noteMuteDrop("create");
        plugin.logger.warn("file-op", `MUTE DROP: create suppressed as an echo`);
        return;
      }
      if (renamedPaths.has(originalPath)) return;
      void plugin.fileOpsManager.onFileCreate(file);
      if (plugin.settings.role === "host") {
        if (file instanceof TFile) {
          void (async () => {
            try {
              const content = isTextFile(originalPath)
                ? await plugin.app.vault.read(file)
                : await plugin.app.vault.readBinary(file);
              if (renamedPaths.has(originalPath)) return;
              if (isTextFile(originalPath)) {
                await plugin.backgroundSync.onFileAdded(originalPath);
              }
              if (renamedPaths.has(originalPath)) return;
              await plugin.manifestManager.updateFile(file, content);
            } catch {
              if (!renamedPaths.has(originalPath)) {
                new Notice(`Live Share: failed to update manifest for ${originalPath}`);
              }
            }
          })();
        } else {
          plugin.manifestManager.addFolder(originalPath);
        }
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on("delete", (file: TAbstractFile) => {
      const run = () => {
        if (!plugin.manifestManager.isSharedPath(file.path)) return;
        if (plugin.fileOpsManager.isPathMutedFor(file.path, "delete")) {
          noteMuteConsumed(plugin, file.path, "delete");
          plugin.fileOpsManager.noteMuteDrop("delete");
          plugin.logger.warn("file-op", `MUTE DROP: delete suppressed as an echo`);
          return;
        }
        plugin.fileOpsManager.onFileDelete(file);
        if (plugin.settings.role === "host") {
          plugin.backgroundSync.onFileRemoved(file.path);
          plugin.manifestManager.removeFile(file.path);
        }
      };
      if (pendingRename) {
        void pendingRename.then(run);
      } else {
        run();
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      if (
        !plugin.manifestManager.isSharedPath(file.path) &&
        !plugin.manifestManager.isSharedPath(oldPath)
      )
        return;
      if (
        plugin.fileOpsManager.isPathMutedFor(file.path, "rename") ||
        plugin.fileOpsManager.isPathMutedFor(oldPath, "rename")
      ) {
        // Both endpoints: `applyRemoteOpInner` mutes oldPath AND newPath for a
        // rename, so one event consumes two armed releases.
        noteMuteConsumed(plugin, file.path, "rename");
        noteMuteConsumed(plugin, oldPath, "rename");
        // S120 AC2 — the gesture that went missing in the live run. Counted and
        // logged, so a permanent divergence can never again be invisible.
        plugin.fileOpsManager.noteMuteDrop("rename");
        plugin.logger.warn("file-op", `MUTE DROP: rename suppressed as an echo`);
        return;
      }

      renamedPaths.add(oldPath);

      const prev = pendingRename ?? Promise.resolve();
      const task = prev.then(async () => {
        plugin.fileOpsManager.onFileRename(file, oldPath);
        plugin.backgroundSync.cancelSubscribe(oldPath);
        await plugin.backgroundSync.onFileRenamed(oldPath, file.path);
        if (plugin.settings.role === "host") {
          plugin.manifestManager.renameFile(oldPath, file.path, plugin.syncManager);
        }
        // WP27 AC2, wired by WP25 (§7.0(e)): a rename is a METADATA UPDATE — the
        // guid, the doc id and the `Y.Doc` are all unchanged. AFTER
        // `renameFile`, which re-keys the manifest entry this then re-points.
        // A path `CanvasSync` holds no identity for is a no-op, so this is safe
        // for every renamed file, not only canvases.
        await plugin.canvasSync?.handleRename(oldPath, file.path);
        const activeFile = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (activeFile && (activeFile.path === file.path || activeFile.path === oldPath)) {
          plugin.onActiveFileChange();
        }
      });
      pendingRename = task.finally(() => {
        if (pendingRename === task) pendingRename = null;
        renamedPaths.delete(oldPath);
      });
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on("modify", (file: TAbstractFile) => {
      if (!(file instanceof TFile) || !plugin.manifestManager.isSharedPath(file.path)) return;

      if (isTextFile(file.path)) {
        // `BackgroundSync`'s OWN 250 ms disk-write window. It is the text
        // writer's echo guard and it is left exactly where WP6 put it: WP91
        // did not charter it and no measurement in this run reaches it. It is
        // recorded rather than removed — a path is only in this set while
        // `BackgroundSync` is its writer, and the ownership discipline below
        // forbids that for a canvas-owned path, so the only way it can stand in
        // front of the canvas branch is the ≤ 250 ms window in which a
        // text-owned path is handed over to `CanvasSync`.
        if (plugin.backgroundSync.isRecentDiskWrite(file.path)) return;
        // WP6 / US5 AC3+AC4: ONE ownership predicate, evaluated once per event.
        // Canvas-owned ⇒ the text path below is UNREACHABLE for this path, no
        // matter why the canvas branch itself declined. A naive `else` here would
        // redirect both the disk-write echo and the flag-ON capture to the text
        // path, i.e. re-create the two-writer race this WP exists to remove.
        const canvasSync = plugin.canvasSync;
        if (canvasSync && canvasOwned(file.path, canvasSync)) {
          // WP91 (C91 AC1) — THE MUTE AND THE DISK-WRITE WINDOW ARE NOT ASKED HERE.
          //
          // Both used to stand in front of this call: `isPathMuted` above (a bare
          // per-path refcount) and `canvasSync.isRecentDiskWrite` inside the
          // condition (a 250 ms window re-armed on every write). Neither has a
          // term for the bytes, so for a canvas-owned path they answered "our own
          // echo" for a real user save that merely arrived while the window was
          // open — the save was discarded before the file was ever read, with no
          // receipt of any kind. Measured: LOST 11/12 at a 0.5-0.8 s delta.
          //
          // The discriminator this event actually admits is content identity, and
          // it already exists: `handleLocalModify`'s byte echo breaker (WP4 AC2),
          // which reads the file and compares it against `lastWrittenContent`.
          // It is exact, it has no window, and it is strictly stronger than either
          // timer. So the canvas branch is decided THERE, on the bytes, and every
          // decline it takes is counted and named (`CAPTURE DECLINED:`).
          //
          // The mute itself is untouched and still governs every other consumer:
          // it moves DOWN to the text branch and to the binary branch below, which
          // is where it remains the only answer available.
          if (
            // Phase 3 (SPEC_04 §4): when the CanvasBinding path is ON, local canvas
            // edits are captured model→CRDT by the bridge's interaction-signal
            // capture (SPEC_02 §4) — NOT by re-reading the .canvas file. Skipping the
            // legacy file→CRDT read here is what routes local edits through
            // `captureLocal`. Flag OFF ⇒ legacy `handleLocalModify` remains the path.
            !plugin.settings.useCanvasBinding
          ) {
            void canvasSync.handleLocalModify(file.path);
          }
          return;
        }
        if (plugin.fileOpsManager.isPathMutedFor(file.path, "modify")) {
          noteMuteConsumed(plugin, file.path, "modify");
          plugin.fileOpsManager.noteMuteDrop("modify");
          plugin.logger.warn("file-op", `MUTE DROP: modify suppressed as an echo`);
          return;
        }
        // Not canvas-owned: the text path runs exactly as before. For a `.canvas`
        // that means the announced raw-text fallback (US5 AC5) — a canvas synced
        // through character-merge, but exclusively, never alongside CanvasSync.
        if (file.path.endsWith(".canvas")) {
          warnCanvasTextFallback(file.path, plugin.logger);
        }
        void plugin.backgroundSync.handleLocalTextModify(file.path);
        return;
      }
      if (plugin.fileOpsManager.isPathMutedFor(file.path, "modify")) {
        noteMuteConsumed(plugin, file.path, "modify");
        plugin.fileOpsManager.noteMuteDrop("modify");
        plugin.logger.warn("file-op", `MUTE DROP: modify suppressed as an echo`);
        return;
      }
      void plugin.fileOpsManager.onFileModify(file);
      if (plugin.settings.role === "host") {
        void (async () => {
          try {
            const buf = await plugin.app.vault.readBinary(file);
            await plugin.manifestManager.updateFile(file, buf);
          } catch {
            new Notice(`Live Share: failed to update manifest for ${file.path}`);
          }
        })();
      }
    }),
  );
}
