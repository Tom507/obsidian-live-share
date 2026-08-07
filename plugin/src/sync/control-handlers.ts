import { minimatch } from "minimatch";
import { MarkdownView, Notice, TFile } from "obsidian";

import { isSidecarPath } from "../files/canvas-sidecar";
import {
  isProtectedPath,
  noteProtectedRefusal,
  protectedRefusalMessage,
} from "../files/protected-paths";
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
    // --------------------------------------------------------------- WP95 --
    // THE PROTECTED-PATH REFUSAL, ABOVE THE OP-TYPE SPLIT.
    //
    // This is the line whose ABSENCE was S94. WP68's guard sat inside the
    // `isRename` branch below, so it constrained ONE of the nine members of the
    // `FileOp` union; the other eight reached `applyRemoteOp` with only
    // `isSharedPath` between them and the vault, and `isSharedPath` refuses
    // `.obsidian/**` only because `ExclusionManager` happens to be configured
    // with `${configDir}/**` — a coincidence `manifest.ts` had already written
    // down as a coincidence, and one that holds for no `.git` path at all.
    //
    // PLACED ABOVE THE SPLIT so the guard cannot be narrower than the union.
    // Every op type, every endpoint, one predicate, one test. A tenth member
    // added to `FileOp` tomorrow is covered on the day it is added, because this
    // gate never learns the type.
    //
    // ALL PATHS, not `.some` — the rename branch below is admitted on
    // `.some(isSharedPath)`, and that asymmetry is exactly how a hostile
    // endpoint rode in on its shared partner. A protected endpoint refuses the
    // whole op no matter what its partner is.
    //
    // BEFORE `applyRemoteOp` (I11 — REFUSAL NEVER DESTROYS): no `opQueues` slot
    // is taken, no `mutePathEvents` is issued and can therefore be stranded, and
    // NOT ONE vault call is made. Nothing is renamed, trashed, created, modified
    // or folder-created at any endpoint, and every local file named by the op is
    // left byte-identical.
    const protectedPath = paths.find((path) => isProtectedPath(path));
    if (protectedPath !== undefined) {
      noteProtectedRefusal("file-op-gate", protectedPath);
      plugin.logger.warn("file-op", protectedRefusalMessage("file-op-gate", protectedPath));
      return;
    }
    const isRename = op.type === "rename";
    if (isRename) {
      // ----------------------------------------------------------- WP68 AC2 --
      // THE RECEIVER REFUSES INDEPENDENTLY OF THE SENDER.
      //
      // The rename branch is the ONLY file-op admitted on `.some(isShared)`
      // rather than on the strict all-paths form below, and that is exactly what
      // made this reachable: with C26 landed `isSharedPath` answers `false` for a
      // sidecar path, so a rename straddling the boundary was admitted on the
      // strength of its SHARED endpoint alone. The op then reached
      // `applyRemoteOpInner`'s `"rename"` case, which finds this peer's own file
      // at `oldPath`, calls `ensureFolder` for the destination's parent and moves
      // it — a peer-driven write into this process's own `.obsidian/**`.
      //
      // No sender-side guard is in the picture here on purpose. The outbound
      // guard in `files/file-ops.ts` constrains what THIS peer produces; it says
      // nothing about an older build, a differently-configured vault or a
      // hostile one, and those are precisely the cases this gate has to survive.
      //
      // BEFORE `applyRemoteOp`, not inside it (AC3, AC4): refusing here means no
      // `opQueues` slot is taken, no `mutePathEvents` is issued and therefore
      // none can be stranded, and — the criterion that matters most — NOT ONE
      // vault call is made. Nothing is renamed, trashed, created, modified or
      // folder-created at either endpoint, and the file at `oldPath` is left
      // exactly as it was. A refusal that degraded into a delete would be the
      // I11 failure this criterion exists to forbid.
      //
      // The membership test is `isSidecarPath` from `files/canvas-sidecar.ts` —
      // imported, never re-spelt (C26 AC3). NOT `skipsAutoTextSync`: an ordinary
      // `.canvas` must keep passing this boundary, exactly as it does through
      // `isSharedPath`.
      //
      // Per-path and non-fatal (I5): one refused rename does not throw, does not
      // touch the session and does not affect any other path or op type.
      if (paths.some((path) => isSidecarPath(path))) {
        plugin.logger.warn(
          "file-op",
          `refused remote rename touching the sidecar directory (${paths.length} paths)`,
        );
        return;
      }
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
      if (!msg.path) return;
      // WP95 — THE CHUNK CHANNEL IS A SEPARATE DOOR AND NEEDS ITS OWN GUARD.
      //
      // These four control messages do NOT travel as `file-op`; they are their
      // own `ControlMessage` types with their own `channel.on` registration, so
      // the gate above never sees them. `chunk-end` lands
      // `vault.createBinary` / `vault.modifyBinary` / `vault.create` /
      // `vault.modify` on `op.path` — the same four sinks the create arm uses,
      // reached over a channel the create arm's guard does not cover. It is
      // also the arm by which a >512 KB `main.js` would arrive, because
      // `sendChunked` is what the producer uses above `CHUNK_SIZE`.
      //
      // Ordered ahead of `isSharedPath` deliberately: the refusal must not be a
      // function of manifest membership or of `ExclusionManager` configuration.
      if (isProtectedPath(msg.path)) {
        noteProtectedRefusal("chunk-gate", msg.path);
        plugin.logger.warn("file-op", protectedRefusalMessage("chunk-gate", msg.path));
        return;
      }
      if (!plugin.manifestManager.isSharedPath(msg.path)) return;
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
    // ---------------------------------------------------------------- WP82 --
    // THE LATCH, HOISTED OUT OF THE ROLE BRANCHES.
    //
    // This marking used to live at the BOTTOM of this handler, past the
    // `role !== "guest"` return below, and it was the second of only two sites
    // in the whole tree that could ever set it. The other one
    // (`main.ts`, the ControlChannel `connected` callback) was gated on
    // `role === "host"`. The two were MUTUALLY EXCLUSIVE BY ROLE, and a peer
    // that resumed as guest and was then promoted by the relay's verdict fell
    // between both: the host gate was false at socket-open, and the promotion
    // branch below `return`ed before ever reaching the marking. That peer was
    // `connected: false` for the life of the session while both of its sockets
    // were open, every file operation it performed went into an unbounded
    // `OfflineQueue` that nothing would drain, and its status bar read
    // `Live Share: hosting`. Measured on a live vault: `resuming as guest` →
    // `control channel connected` → `promoted to host`, 106 ms, then permanent.
    //
    // Receiving a `join-response` AT ALL is proof that this peer's control
    // socket delivered a frame — a fact about the LINK, which is true under
    // every ordering of {socket open, join-response, promotion, demotion} and
    // under every role. So it is marked here, once, before any branch.
    //
    // This is NOT the "set the latch unconditionally" mistake the charter names
    // as the most likely wrong implementation: the marking is a BELIEF, and
    // `plugin.controlConnected` is no longer that belief. It is now derived by
    // the pure definer (`sync/link-state.ts`) from the socket's live
    // `readyState`, so a genuinely dead control link cannot report healthy no
    // matter what is marked here.
    plugin.controlConnected = true;
    plugin.updateOnlineState();

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
    // WP82 — the marking that used to be here is now HOISTED above the role
    // branches (see the long note at the top of this handler). Left as a
    // pointer rather than deleted silently, because "the connected marking
    // moved" is exactly the kind of change that is invisible in a diff read
    // bottom-up.
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
