import { minimatch } from "minimatch";
import { MarkdownView, Notice, TFile } from "obsidian";

import type LiveSharePlugin from "../main";
import type { ControlMessage, FileOp } from "../types";
import { ApprovalModal } from "../ui/approval-modal";
import { showFocusNotification } from "../ui/focus-notification";
import { ConfirmModal } from "../ui/modals";
import { isTextFile, normalizePath, toCanonicalPath, toLocalPath } from "../utils";

const CHUNK_TO_CONTROL = {
  "chunk-start": "file-chunk-start",
  "chunk-data": "file-chunk-data",
  "chunk-end": "file-chunk-end",
  "chunk-resume": "file-chunk-resume",
} as const;

const CONTROL_TO_CHUNK = Object.fromEntries(
  Object.entries(CHUNK_TO_CONTROL).map(([chunkType, controlType]) => [controlType, chunkType]),
) as Record<
  (typeof CHUNK_TO_CONTROL)[keyof typeof CHUNK_TO_CONTROL],
  keyof typeof CHUNK_TO_CONTROL
>;

export function registerControlHandlers(plugin: LiveSharePlugin): void {
  const channel = plugin.controlChannel;
  if (!channel) return;

  plugin.fileOpsManager.setSender((op) => {
    if (op.type === "chunk-start" || op.type === "chunk-data" || op.type === "chunk-end") {
      channel.send({
        ...op,
        type: CHUNK_TO_CONTROL[op.type],
      } as ControlMessage);
    } else {
      channel.send({ type: "file-op", op });
    }
  });

  channel.on("file-op", (msg) => {
    const op = msg.op;
    const paths = [
      "path" in op ? op.path : null,
      "oldPath" in op ? op.oldPath : null,
      "newPath" in op ? op.newPath : null,
    ].filter(Boolean) as string[];
    if (paths.length === 0) return;
    const isRename = op.type === "rename";
    if (isRename) {
      if (!paths.some((path) => plugin.manifestManager.isSharedPath(path))) return;
    } else {
      if (paths.some((path) => !plugin.manifestManager.isSharedPath(path))) return;
    }
    plugin.fileOpsManager
      .applyRemoteOp(op, async () => {
        if (plugin.settings.role !== "host") return;
        if (op.type === "create" && "path" in op) {
          const file = plugin.app.vault.getAbstractFileByPath(toLocalPath(op.path));
          if (file instanceof TFile) {
            const content = isTextFile(file.path)
              ? await plugin.app.vault.read(file)
              : await plugin.app.vault.readBinary(file);
            await plugin.manifestManager.updateFile(file, content);
            if (isTextFile(file.path)) {
              await plugin.backgroundSync.onFileAdded(file.path);
            }
          }
        } else if (op.type === "modify" && "path" in op && !isTextFile(op.path)) {
          const file = plugin.app.vault.getAbstractFileByPath(toLocalPath(op.path));
          if (file instanceof TFile) {
            const content = await plugin.app.vault.readBinary(file);
            await plugin.manifestManager.updateFile(file, content);
          }
        } else if (op.type === "delete" && "path" in op) {
          plugin.manifestManager.removeFile(op.path);
          plugin.backgroundSync.onFileRemoved(op.path);
        } else if (op.type === "rename" && "oldPath" in op && "newPath" in op) {
          const renameOp = op as {
            oldPath: string;
            newPath: string;
          };
          if (isTextFile(renameOp.newPath)) {
            await plugin.backgroundSync.onFileRenamed(renameOp.oldPath, renameOp.newPath);
          }
          plugin.manifestManager.renameFile(renameOp.oldPath, renameOp.newPath, plugin.syncManager);
        } else if (op.type === "folder-create" && "path" in op) {
          plugin.manifestManager.addFolder(op.path);
        }
      })
      .catch((err) => {
        plugin.logger.error("file-op", "failed to apply remote file-op", err);
      });
  });

  for (const chunkType of [
    "file-chunk-start",
    "file-chunk-data",
    "file-chunk-end",
    "file-chunk-resume",
  ] as const) {
    channel.on(chunkType, (msg) => {
      if (!msg.path || !plugin.manifestManager.isSharedPath(msg.path)) return;
      plugin.fileOpsManager
        .applyRemoteOp({
          ...msg,
          type: CONTROL_TO_CHUNK[chunkType],
        } as FileOp)
        .catch((err) => {
          plugin.logger.error("file-op", `failed to apply remote ${chunkType}`, err);
        });
    });
  }

  channel.on("presence-update", (msg) => {
    // D2 — a guest may only delete against a manifest a live host published
    // DURING ITS SESSION, so somebody has to publish once the guest is listening.
    // A guest that joins a long-running session would otherwise hold only the
    // relay's replayed manifest, never obtain the evidence, and never clean up —
    // safe, but permanently useless. The arrival of a peer we have not seen
    // before is exactly the moment the host learns there is a new consumer.
    //
    // Computed here rather than inside PresenceManager because the newness test
    // must happen BEFORE `handlePresenceUpdate` inserts the user.
    const isNewPeer = !!msg.userId && !plugin.remoteUsers.has(msg.userId);
    plugin.presenceManager?.handlePresenceUpdate(msg);
    if (isNewPeer && plugin.settings.role === "host") {
      // WP80 call site 4 of 4 (new-peer republish). Wiring only — the purge is a
      // REQUEST here as everywhere else, and `ManifestManager` decides whether
      // to grant it. This site matters because it REPEATS whatever state site 3
      // (`promoteToHost`) left behind: without the producing-side gate a wrong
      // purge would be re-asserted with a fresh `seq` on every new peer and
      // could never age out.
      void plugin.manifestManager
        .publishManifest({ purge: true })
        .then((decision) => {
          plugin.logger.log(
            "manifest",
            `publish[new-peer] verdict=${decision.verdict} purged=${decision.purged} ` +
              `entries=${decision.entries} deleted=${decision.deleted.length} ` +
              `unaccounted=${decision.unaccounted.length} — ${decision.reason}`,
          );
        })
        .catch((err) => {
          plugin.logger.error("manifest", "republish for new peer failed", err);
        });
    }
  });

  channel.on("presence-leave", (msg) => {
    if (msg.userId) plugin.presenceManager?.handlePresenceLeave(msg.userId);
  });

  channel.on("join-request", (msg) => {
    if (plugin.settings.role !== "host") return;
    new ApprovalModal(
      plugin.app,
      msg,
      (approved, permission) => {
        plugin.controlChannel?.send({
          type: "join-response",
          userId: msg.userId,
          approved,
          permission,
        });
        if (approved) {
          const existing = plugin.remoteUsers.get(msg.userId);
          if (existing) existing.permission = permission;
        }
      },
      plugin.settings.approvalTimeoutSeconds,
    ).open();
  });

  channel.on("join-response", (msg) => {
    // ---------------------------------------------------------------- D1 ----
    // ROOT CAUSE OF THE 2026-08-05 DATA LOSS, and the reason a session could end
    // up with NO host at all.
    //
    // The server is authoritative about who hosts a room, and it tells every
    // client its verdict in `join-response.isHost`. This handler used to apply
    // that verdict in ONE DIRECTION ONLY: `isHost === false` demoted a local
    // host to guest, but `isHost === true` did nothing whatsoever to a local
    // guest. Every disagreement between server and client therefore moved
    // monotonically towards "guest", and never back. A role could be lost but
    // never regained.
    //
    // How that turns into destruction, measured on this host:
    //
    //   1. The host's Obsidian is closed. `control-handler.ts:568-591` sees the
    //      host's socket close with peers still in the room, auto-elects the
    //      remaining guest, and REWRITES `room.hostUserId` to that guest's id.
    //   2. The elected guest is being shut down at the same moment (one process
    //      serves both vaults), so the `host-transfer-complete` that would have
    //      promoted it is never processed and never persisted. The server now
    //      believes the guest is host; the guest's `data.json` still says guest.
    //   3. On relaunch the original host no longer matches `room.hostUserId`,
    //      is told `isHost: false`, and demotes — correctly, by its own lights.
    //      The elected guest is told `isHost: true` and, before this fix,
    //      IGNORED IT.
    //   4. Result: two guests, zero hosts, nobody publishing a manifest — and a
    //      guest that reads "not in the manifest" as "deleted". Vault B lost
    //      `hello.md` and `second.canvas` this way.
    //
    // The fix is to make the reconciliation symmetric. `isHost === true` is a
    // POSITIVE ASSERTION from the authority that already enforces the
    // single-host invariant (`determineHostStatus` demotes every other client
    // before answering), so adopting it cannot create a second host — while
    // refusing to adopt it demonstrably creates a session with none.
    if (msg.isHost === true && plugin.settings.role === "guest") {
      void plugin.promoteToHost();
      return;
    }
    if (msg.isHost === false && plugin.settings.role === "host") {
      void plugin.demoteToGuest();
      return;
    }
    if (plugin.settings.role !== "guest") return;
    if (msg.approved === false) {
      new Notice("Live Share: join request denied by host");
      void plugin.endSession();
      return;
    }
    if (msg.permission) {
      plugin.settings.permission = msg.permission;
    }
    if (msg.readOnlyPatterns) {
      plugin.remoteReadOnlyPatterns = msg.readOnlyPatterns;
      const readOnlyPaths = plugin.app.vault
        .getFiles()
        .map((f) => toCanonicalPath(normalizePath(f.path)))
        .filter((p) => msg.readOnlyPatterns?.some((pat) => minimatch(p, pat)));
      plugin.explorerIndicators?.update(readOnlyPaths);
    }
    plugin.controlConnected = true;
    plugin.updateOnlineState();
    plugin.presenceManager?.broadcastPresence();
  });

  channel.on("permission-update", (msg) => {
    plugin.settings.permission = msg.permission;
    plugin.onActiveFileChange();
    plugin.notify(`Live Share: your permission was changed to ${msg.permission}`);
  });

  channel.on("focus-request", (msg) => {
    showFocusNotification(plugin, msg);
  });

  channel.on("summon", (msg) => {
    const file = plugin.app.vault.getAbstractFileByPath(toLocalPath(msg.filePath));
    if (file instanceof TFile) {
      void plugin.app.workspace
        .getLeaf()
        .openFile(file)
        .then(() => {
          const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
          if (view) {
            view.editor.setCursor({ line: msg.line, ch: msg.ch });
            view.editor.scrollIntoView(
              {
                from: { line: msg.line, ch: 0 },
                to: { line: msg.line, ch: 0 },
              },
              true,
            );
          }
        });
    }
    new Notice(
      `Live Share: ${msg.fromDisplayName} summoned you to ${msg.filePath}:${msg.line + 1}`,
    );
  });

  channel.on("present-start", (msg) => {
    if (msg.userId) plugin.presenceManager?.handlePresentStart(msg.userId);
  });

  channel.on("present-stop", (msg) => {
    if (msg.userId) plugin.presenceManager?.handlePresentStop(msg.userId);
  });

  channel.on("sync-request", (msg) => {
    if (plugin.settings.role !== "host") return;
    if (msg.path && plugin.manifestManager.isSharedPath(msg.path)) {
      const file = plugin.app.vault.getAbstractFileByPath(toLocalPath(msg.path));
      if (file instanceof TFile) {
        void plugin.fileOpsManager.onFileCreate(file);
      }
    }
  });

  channel.on("kicked", () => {
    new Notice("Live Share: you have been removed from the session");
    void plugin.endSession();
  });

  channel.on("session-end", () => {
    new Notice("Live Share: the host ended the session");
    void plugin.endSession();
  });

  channel.on("host-transfer-offer", (msg) => {
    new ConfirmModal(
      plugin.app,
      `${msg.displayName ?? msg.userId} wants to make you the host. Accept?`,
      (accepted) => {
        if (accepted) {
          plugin.controlChannel?.send({
            type: "host-transfer-accept",
            userId: msg.userId,
          });
        } else {
          plugin.controlChannel?.send({
            type: "host-transfer-decline",
            userId: msg.userId,
          });
        }
      },
    ).open();
  });

  // D1 — routed through the SAME promotion as the `join-response` verdict.
  // These were two hand-rolled copies of "become the host"; keeping one of them
  // is how the server-verdict direction came to be missing in the first place.
  channel.on("host-transfer-complete", () => {
    void plugin.promoteToHost("host transfer accepted");
  });

  channel.on("host-transfer-decline", (msg) => {
    plugin.notify(`Live Share: ${msg.displayName ?? msg.userId} declined host transfer`);
  });

  channel.on("host-disconnected", () => {
    new Notice("Live Share: the host has disconnected");
    plugin.logger.log("session", "host disconnected");
  });

  channel.on("host-changed", (msg) => {
    const finish = () => {
      for (const [userId, user] of plugin.remoteUsers) {
        user.isHost = userId === msg.userId;
      }
      plugin.presenceManager?.broadcastPresence();
      plugin.onActiveFileChange();
      plugin.updateStatusBar();
      plugin.refreshPresenceView();
      plugin.notify(`Live Share: ${msg.displayName} is now the host`);
      plugin.logger.log("session", `host changed to ${msg.userId}`);
    };
    if (plugin.settings.role === "host") {
      plugin.settings.role = "guest";
      if (plugin.presenceManager?.getIsPresenting()) {
        plugin.presenceManager.togglePresent();
      }
      void plugin
        .saveSettings()
        .then(() => plugin.backgroundSync.startAll("guest"))
        .then(finish);
    } else {
      finish();
    }
  });
}
