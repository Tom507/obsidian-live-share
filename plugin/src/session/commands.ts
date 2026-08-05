import { MarkdownView } from "obsidian";

import {
  IMPORT_FROM_FILE_COMMAND_ID,
  IMPORT_FROM_FILE_COMMAND_NAME,
  canImportFromFile,
} from "../canvas/canvas-import-command";
import {
  CANVAS_REDO_COMMAND_ID,
  CANVAS_REDO_COMMAND_NAME,
  CANVAS_UNDO_COMMAND_ID,
  CANVAS_UNDO_COMMAND_NAME,
} from "../canvas/canvas-undo";
import type LiveSharePlugin from "../main";
import { UserPickerModal } from "../ui/modals";
import { normalizePath, toCanonicalPath } from "../utils";

export function registerCommands(plugin: LiveSharePlugin): void {
  plugin.addCommand({
    id: "start-session",
    name: "Start session",
    callback: () => void plugin.startSession(),
  });

  plugin.addCommand({
    id: "join-session",
    name: "Join session",
    callback: () => void plugin.joinSession(),
  });

  plugin.addCommand({
    id: "end-session",
    name: "End session",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "host" || !plugin.sessionManager.isActive) return false;
      if (checking) return true;
      (async () => {
        const confirmed = await plugin.confirm(
          "Are you sure you want to end the session? All participants will be disconnected.",
        );
        if (confirmed) void plugin.endSession();
      })().catch(() => {
        // Confirmation dialog was dismissed
      });
    },
  });

  plugin.addCommand({
    id: "leave-session",
    name: "Leave session",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "guest" || !plugin.sessionManager.isActive) return false;
      if (checking) return true;
      (async () => {
        const confirmed = await plugin.confirm("Are you sure you want to leave the session?");
        if (confirmed) void plugin.endSession();
      })().catch(() => {
        // Confirmation dialog was dismissed
      });
    },
  });

  // WP88 (AC3) — THE WAY BACK. The re-arm affordance, reachable from the
  // product and not only from `testing/`.
  //
  // This command exists because WP88 stops the retry ceiling from destroying
  // the session. Retaining the six credential keys while leaving the peer with
  // no edge that can re-arm it would be a session that reports itself alive and
  // is not — WP82's own defect, rebuilt by WP88's repair — so the retention and
  // the way back ship together.
  //
  // `checkCallback`, never `callback`: the command is meaningless without an
  // active session, and a `callback` command would sit in the palette
  // unconditionally with the guard nowhere to live (the WP30 precedent).
  // Deliberately NOT gated on role: a guest whose Wi-Fi died needs this exactly
  // as much as a host does, and the relay's election moves the role around
  // freely anyway.
  plugin.addCommand({
    id: "rearm-session",
    name: "Verbindung erneut versuchen",
    checkCallback: (checking) => {
      if (!plugin.sessionManager.isActive) return false;
      if (checking) return true;
      void plugin.rearmSharing().catch(() => {
        // `checkCallback` is not async and Obsidian discards its result, so an
        // escaping rejection would surface only as an unhandled rejection.
        // `rearmSharing` reports every outcome itself (I11).
      });
    },
  });

  plugin.addCommand({
    id: "copy-invite",
    name: "Copy invite link",
    callback: () => plugin.sessionManager.copyInvite(),
  });

  plugin.addCommand({
    id: "show-collaborators",
    name: "Show collaborators panel",
    callback: () => void plugin.activatePresenceView(),
  });

  plugin.addCommand({
    id: "open-status-console",
    name: "Open status console",
    callback: () => void plugin.activateLogView(),
  });

  plugin.addCommand({
    id: "log-in",
    name: "Log in with GitHub",
    callback: () => void plugin.authManager.authenticate(),
  });

  plugin.addCommand({
    id: "log-out",
    name: "Log out",
    callback: () => void plugin.authManager.logout(),
  });

  plugin.addCommand({
    id: "focus-here",
    name: "Focus participants here",
    editorCallback: (editor, view) => {
      const cursor = editor.getCursor();
      const filePath = view.file?.path;
      if (!filePath || !plugin.controlChannel) return;
      plugin.controlChannel.send({
        type: "focus-request",
        fromUserId: plugin.settings.githubUserId || plugin.settings.clientId,
        fromDisplayName: plugin.settings.displayName,
        filePath: toCanonicalPath(normalizePath(filePath)),
        line: cursor.line,
        ch: cursor.ch,
      });
      plugin.notify("Live Share: focus request sent");
    },
  });

  plugin.addCommand({
    id: "summon-all",
    name: "Summon all participants here",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "host" || !plugin.sessionManager.isActive) return false;
      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView?.file) return false;
      if (checking) return true;
      const cursor = activeView.editor.getCursor();
      plugin.controlChannel?.send({
        type: "summon",
        fromUserId: plugin.settings.githubUserId || plugin.settings.clientId,
        fromDisplayName: plugin.settings.displayName,
        targetUserId: "__all__",
        filePath: toCanonicalPath(normalizePath(activeView.file.path)),
        line: cursor.line,
        ch: cursor.ch,
      });
      plugin.notify("Live Share: summon sent to all participants");
    },
  });

  plugin.addCommand({
    id: "reload-from-host",
    name: "Reload all files from host",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "guest" || !plugin.sessionManager.isActive) return false;
      if (checking) return true;
      void plugin.reloadFromHost();
    },
  });

  plugin.addCommand({
    id: "summon-user",
    name: "Summon a specific participant here",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "host" || !plugin.sessionManager.isActive) return false;
      if (plugin.remoteUsers.size === 0) return false;
      if (checking) return true;
      new UserPickerModal(plugin.app, plugin.remoteUsers, (userId) => {
        plugin.summonUser(userId);
      }).open();
    },
  });

  plugin.addCommand({
    id: "toggle-present",
    name: "Toggle presentation mode",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "host" || !plugin.sessionManager.isActive) return false;
      if (checking) return true;
      plugin.presenceManager?.togglePresent();
    },
  });

  plugin.addCommand({
    id: "transfer-host",
    name: "Transfer host role",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "host" || !plugin.sessionManager.isActive) return false;
      if (plugin.remoteUsers.size === 0) return false;
      if (checking) return true;
      new UserPickerModal(plugin.app, plugin.remoteUsers, (userId) => {
        plugin.controlChannel?.send({
          type: "host-transfer-offer",
          userId,
        });
        const user = plugin.remoteUsers.get(userId);
        plugin.notify(`Live Share: offered host role to ${user?.displayName ?? userId}`);
      }).open();
    },
  });

  plugin.addCommand({
    id: "show-audit-log",
    name: "Show audit log",
    checkCallback: (checking) => {
      if (plugin.settings.role !== "host" || !plugin.sessionManager.isActive) return false;
      if (checking) return true;
      void plugin.fetchAuditLog();
    },
  });

  // WP30 (C30) — the explicit "Import from file" command: the ONLY way a file
  // overwrites an already-living shared board.
  //
  // `checkCallback`, never `callback`, and that is structural rather than
  // stylistic. AC4 ("unavailable for a path the client does not own or is
  // degraded on") can only be expressed in this shape — a `callback` command
  // sits in the palette unconditionally and leaves the guard nowhere to live.
  //
  // The guard asks two questions and both are fail-closed: is there a canvas in
  // context at all, and does `canImportFromFile` say yes about THAT path.
  // `main.ts` MEASURES ownership and degradation; the decision belongs to
  // `canvas-import-command.ts` and is not re-spelt here.
  plugin.addCommand({
    id: IMPORT_FROM_FILE_COMMAND_ID,
    name: IMPORT_FROM_FILE_COMMAND_NAME,
    checkCallback: (checking) => {
      const path = plugin.activeCanvasPathForImport();
      if (path === null) return false;
      if (!canImportFromFile(plugin.canvasImportAvailability(path))) return false;
      if (checking) return true;
      void plugin.runCanvasImportFromFile(path).catch(() => {
        // Absorbed on purpose: `checkCallback` is not async and Obsidian
        // discards its result, so an escaping rejection would surface only as an
        // unhandled rejection. `runImportFromFile` reports every failure as a
        // status and notifies the user itself (I11).
      });
    },
  });

  // --- WP38 (C38) — per-client undo/redo for an OWNED, SUBSCRIBED canvas -----
  //
  // Two separate commands with NO default hotkey. Obsidian's own file-based
  // undo is untouched for markdown, unowned files and unsubscribed canvases —
  // replacing it anywhere else is out of scope, and a rebind of `Ctrl+Z` would
  // be exactly that.
  //
  // `checkCallback`, and its guard asks "is there a canvas in context whose
  // undo history this client owns?" — NOT "is there a step to undo?". The
  // second question is the one the INVOCATION answers, and it has to stay free
  // to answer "no": an empty stack must reach the mechanism and come back with
  // a measured `0 -> 0`, which is the one response no hardcoded literal can
  // produce (C38 AC6).
  //
  // The availability predicate and the invocation are both one call each into
  // `canvas/canvas-undo.ts` through `main.ts`. No stack arithmetic, no origin
  // and no scope is spelt in either of these two blocks.
  plugin.addCommand({
    id: CANVAS_UNDO_COMMAND_ID,
    name: CANVAS_UNDO_COMMAND_NAME,
    checkCallback: (checking) => {
      if (!plugin.canvasUndoAvailable()) return false;
      if (checking) return true;
      plugin.runCanvasUndo("undo");
    },
  });

  plugin.addCommand({
    id: CANVAS_REDO_COMMAND_ID,
    name: CANVAS_REDO_COMMAND_NAME,
    checkCallback: (checking) => {
      if (!plugin.canvasUndoAvailable()) return false;
      if (checking) return true;
      plugin.runCanvasUndo("redo");
    },
  });
}
