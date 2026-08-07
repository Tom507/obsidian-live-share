import { type App, Notice, PluginSettingTab, SettingGroup } from "obsidian";
import type LiveSharePlugin from "../main";
import { DEFAULT_SETTINGS } from "../types";
import { FolderSuggest } from "./folder-suggest";

/**
 * What an empty "Shared folder" field means, stated once so the settings UI and
 * `main.ts`'s session-start check cannot drift apart.
 *
 * `ManifestManager.isInSharedFolder` answers `return true` for EVERY path when
 * `sharedFolder` is empty (`manifest.ts:753`). Empty is not "unset" and it is not
 * "nothing shared" — it is *the entire vault*, which is also the shipped default.
 */
export function sharesEntireVault(sharedFolder: string): boolean {
  return sharedFolder.trim() === "";
}

export const ENTIRE_VAULT_WARNING =
  "⚠ Empty = your ENTIRE vault is shared. Guests see every note, and their " +
  "deletions, renames and moves apply to your vault. Pick a folder to limit it.";

/**
 * WP81 AC5 — what an emptied "Debug log file" field resolves to.
 *
 * Extracted so the relationship can be asserted as a relationship: the fallback
 * IS `DEFAULT_SETTINGS.debugLogPath`, read at call time, not a second literal
 * that happens to agree with it today. Perturb the default and this follows.
 */
export function resolveDebugLogPath(value: string): string {
  return value.trim() || DEFAULT_SETTINGS.debugLogPath;
}

export class LiveShareSettingTab extends PluginSettingTab {
  private plugin: LiveSharePlugin;

  constructor(app: App, plugin: LiveSharePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const { settings, sessionManager, authManager } = this.plugin;
    const active = sessionManager.isActive;

    new SettingGroup(containerEl)
      .setHeading("Connection")
      .addSetting((setting) => {
        setting
          .setName("Server URL")
          .setDesc("The server to connect to")
          .addText((text) => {
            text.setValue(settings.serverUrl).onChange(async (value) => {
              settings.serverUrl = value;
              await this.plugin.saveSettings();
            });
            text.inputEl.placeholder = "http://localhost:3000";
            if (active) text.setDisabled(true);
          });
      })
      .addSetting((setting) => {
        setting
          .setName("Server password")
          .setDesc("Required if the server has a password set")
          .addText((text) => {
            text
              .setPlaceholder("None")
              .setValue(settings.serverPassword)
              .onChange(async (value) => {
                settings.serverPassword = value;
                await this.plugin.saveSettings();
              });
            text.inputEl.type = "password";
            if (active) text.setDisabled(true);
          });
      })
      .addSetting((setting) => {
        if (authManager.isAuthenticated) {
          setting
            .setName("GitHub account")
            .setDesc(`Logged in as ${settings.displayName}`)
            .addButton((button) =>
              button.setButtonText("Log out").onClick(async () => {
                await authManager.logout();
                this.display();
              }),
            );
        } else {
          setting
            .setName("GitHub account")
            .setDesc("Optional, used for identity verification")
            .addButton((button) =>
              button
                .setButtonText("Log in with GitHub")
                .setCta()
                .onClick(async () => {
                  await authManager.authenticate();
                  this.display();
                }),
            );
        }
      });

    new SettingGroup(containerEl)
      .setHeading("Identity")
      .addSetting((setting) => {
        setting
          .setName("Display name")
          .setDesc("Shown to other collaborators")
          .addText((text) => {
            text
              .setPlaceholder("Anonymous")
              .setValue(settings.displayName)
              .onChange(async (value) => {
                settings.displayName = value.trim() || "Anonymous";
                await this.plugin.saveSettings();
              });
            if (authManager.isAuthenticated) text.setDisabled(true);
          });
      })
      .addSetting((setting) => {
        setting
          .setName("Cursor color")
          .setDesc("Your cursor and selection color visible to others")
          .addColorPicker((color) =>
            color.setValue(settings.cursorColor).onChange(async (value) => {
              settings.cursorColor = value;
              await this.plugin.saveSettings();
            }),
          );
      });

    const session = new SettingGroup(containerEl).setHeading("Session");

    session.addSetting((setting) => {
      if (active) {
        const connectionState = this.plugin.connectionState.getState();
        const role = settings.role === "host" ? "Hosting" : "Joined";
        const stateLabels: Record<string, string> = {
          connected: "Connected",
          connecting: "Connecting...",
          reconnecting: "Reconnecting...",
          error: "Error",
          "auth-required": "Auth required",
          disconnected: "Disconnected",
        };
        const stateLabel = stateLabels[connectionState] ?? connectionState;
        const encrypted = settings.encryptionPassphrase ? "Encrypted" : "Not encrypted";
        setting
          .setName(`${role} · ${stateLabel}`)
          .setDesc(`Room: ${settings.roomId} · ${encrypted}`);
        setting.addButton((button) =>
          button.setButtonText("Copy invite link").onClick(() => {
            void sessionManager.copyInvite();
          }),
        );
        // WP88 (AC3) — the second reachable surface for the re-arm. The command
        // palette entry (`rearm-session`) is the primary one; this is here
        // because a user whose peer has given up is far more likely to open
        // this panel than to remember a command name. Both call the SAME
        // production method — there is no second re-arm.
        setting.addButton((button) =>
          button
            .setButtonText("Retry connection")
            .setTooltip(
              "Re-arm sharing after a peer gave up: re-publishes the manifest and " +
                "re-subscribes every shared file, without ending the session.",
            )
            .onClick(() => {
              void this.plugin.rearmSharing().then(() => this.display());
            }),
        );
        if (settings.role === "host") {
          setting.addButton((button) =>
            button
              .setButtonText("End session")
              .setWarning()
              .onClick(() => {
                void this.plugin.endSession().then(() => this.display());
              }),
          );
        } else {
          setting.addButton((button) =>
            button
              .setButtonText("Leave session")
              .setWarning()
              .onClick(() => {
                void this.plugin.endSession().then(() => this.display());
              }),
          );
        }
      } else {
        setting.setName("No active session");
        setting.addButton((button) =>
          button.setButtonText("Join session").onClick(async () => {
            await this.plugin.joinSession();
            this.display();
          }),
        );
        setting.addButton((button) =>
          button
            .setButtonText("Start session")
            .setCta()
            .onClick(async () => {
              await this.plugin.startSession();
              this.display();
            }),
        );
      }
    });

    session
      .addSetting((setting) => {
        setting.setName("Shared folder");
        // The description is the ONLY place the empty case is visible before a
        // session starts. It is recomputed on every keystroke rather than
        // written once at render, because the dangerous state is one the user
        // reaches BY EDITING (clearing the field), not one they arrive at.
        const describe = (value: string) =>
          setting.setDesc(
            sharesEntireVault(value)
              ? ENTIRE_VAULT_WARNING
              : `Only “${value}” and everything inside it is shared. The rest of the vault stays private.`,
          );
        describe(settings.sharedFolder);
        setting.addText((text) => {
          text
            .setPlaceholder("Entire vault (everything)")
            .setValue(settings.sharedFolder)
            .onChange(async (value) => {
              // S114 — trim BEFORE storing, not only when reading. `"   "` used
              // to be stored verbatim and read as a scoped folder that matches
              // nothing, so the session shared not one file and said nothing.
              settings.sharedFolder = value
                .trim()
                .replace(/^[./\\]+/, "")
                .replace(/\.\./g, "");
              describe(settings.sharedFolder);
              await this.plugin.saveSettings();
            });
          // Picking from the vault's real folders instead of typing one: a
          // folder that does not exist shares NOTHING and reports nothing,
          // which presents as a broken session rather than as a typo.
          new FolderSuggest(this.app, text.inputEl, (path) => {
            settings.sharedFolder = path;
            describe(path);
            void this.plugin.saveSettings();
          });
          if (active) text.setDisabled(true);
        });
      })
      .addSetting((setting) => {
        // S116 — the GUEST half of the whole-vault warning. The host is asked to
        // confirm before sharing an entire vault; this is the peer on the other
        // end of that arrangement, whose own files are the ones at risk, being
        // asked the same question. Deliberately NOT disabled during an active
        // session: it is the control that stops an in-progress arrangement, so
        // locking it while the risk is live would be exactly backwards.
        setting
          .setName("Allow whole-vault cleanup")
          .setDesc(
            "When the host shares their ENTIRE vault, allow Live Share to delete local files " +
              "the host does not have. Off by default: while off, files that pre-date this " +
              "session are never deleted and whole-vault hosts trigger no cleanup at all.",
          )
          .addToggle((toggle) => {
            toggle.setValue(settings.allowWholeVaultReconcile).onChange(async (value) => {
              settings.allowWholeVaultReconcile = value;
              await this.plugin.saveSettings();
            });
          });
      })
      .addSetting((setting) => {
        setting
          .setName("Require approval")
          .setDesc("Guests must be approved by the host before joining")
          .addToggle((toggle) => {
            toggle.setValue(settings.requireApproval).onChange(async (value) => {
              settings.requireApproval = value;
              await this.plugin.saveSettings();
            });
            if (active) toggle.setDisabled(true);
          });
      })
      .addSetting((setting) => {
        setting
          .setName("Approval timeout (seconds)")
          .setDesc("Auto-deny join requests after this many seconds. 0 to disable.")
          .addText((text) => {
            text
              .setPlaceholder("60")
              .setValue(String(settings.approvalTimeoutSeconds))
              .onChange(async (value) => {
                const parsed = Number.parseInt(value, 10);
                settings.approvalTimeoutSeconds = Number.isNaN(parsed) ? 60 : Math.max(0, parsed);
                await this.plugin.saveSettings();
              });
          });
      });

    new SettingGroup(containerEl)
      .setHeading("Preferences")
      .addSetting((setting) => {
        setting
          .setName("Notifications")
          .setDesc("Show status notices for non-critical events like file syncs and follows")
          .addToggle((toggle) =>
            toggle.setValue(settings.notificationsEnabled).onChange(async (value) => {
              settings.notificationsEnabled = value;
              await this.plugin.saveSettings();
            }),
          );
      })
      .addSetting((setting) => {
        setting
          .setName("Auto-reconnect")
          // WP82 (AC5) — the description states the setting's ACTUAL scope. Its
          // NAME misled a diagnosis this week into recording "autoReconnect was
          // true and never fired" as a finding: it is read in exactly one place
          // outside this settings UI (`main.ts`, the `onLayoutReady` auto-resume
          // gate), and NEITHER retry loop consults it. Turning it off does not
          // stop a live session from reconnecting, and turning it on does not
          // make a dead one retry.
          .setDesc(
            "Automatically rejoin the previous session when Obsidian starts. " +
              "This governs startup only — reconnect attempts during a running " +
              "session are always made and are not controlled by this setting.",
          )
          .addToggle((toggle) =>
            toggle.setValue(settings.autoReconnect).onChange(async (value) => {
              settings.autoReconnect = value;
              await this.plugin.saveSettings();
            }),
          );
      });

    new SettingGroup(containerEl)
      .setHeading("Canvas")
      .addSetting((setting) => {
        setting
          .setName("Show canvas cursors")
          .setDesc("Display other collaborators' live cursors on shared canvases")
          .addToggle((toggle) =>
            toggle.setValue(settings.showCanvasCursors).onChange(async (value) => {
              settings.showCanvasCursors = value;
              await this.plugin.saveSettings();
            }),
          );
      })
      .addSetting((setting) => {
        setting
          .setName("Show canvas presence")
          .setDesc("Highlight cards other collaborators are selecting, editing, or holding")
          .addToggle((toggle) =>
            toggle.setValue(settings.showCanvasPresence).onChange(async (value) => {
              settings.showCanvasPresence = value;
              await this.plugin.saveSettings();
            }),
          );
      })
      .addSetting((setting) => {
        // WHAT THIS FLAG DOES AND DOES NOT SWITCH — stated carefully, because
        // the first version of this description got it wrong in the reader's
        // favour and called the OFF path "legacy".
        //
        // It does NOT switch the data model. BOTH paths read and write the same
        // V2 record CRDT: `parseCanvasReport` (canvas-sync.ts:628) produces
        // `V2Node` / `V2EdgeRecord` regardless of this flag.
        //
        // What it switches is HOW LOCAL INTENT IS CAPTURED and how remote
        // deltas are applied:
        //   OFF → capture by re-reading the .canvas file and diffing it
        //         (`canvasSync.handleLocalModify`, vault-events.ts:319);
        //         remote deltas patch the open view via `reconcileLiveCanvas`
        //         (main.ts:1974).
        //   ON  → capture from the adapter's interaction signals, model → CRDT,
        //         with no file read; remote deltas apply per node through
        //         `CanvasBinding.applyRemote` (main.ts:3150).
        //
        // The old description said "experimental — leave OFF unless testing",
        // which is why the path it gates had never been exercised by this
        // vault's owner. Say what it switches, without overstating it.
        setting
          .setName("Canvas sync engine: model-driven capture")
          .setDesc(
            "ON — your canvas edits are captured from the interaction itself and applied " +
              "node by node, so two people dragging different cards do not go through the " +
              "file. OFF — the settled default: the same node-level CRDT, but edits are " +
              "captured by re-reading the canvas file and remote changes patch the open " +
              "view as a whole. Close and reopen any canvas after changing this.",
          )
          .addToggle((toggle) =>
            toggle.setValue(settings.useCanvasBinding).onChange(async (value) => {
              settings.useCanvasBinding = value;
              await this.plugin.saveSettings();
            }),
          );
      });

    new SettingGroup(containerEl)
      .setHeading("Debug")
      .addSetting((setting) => {
        setting
          .setName("Open status console")
          .setDesc("Open the live Live Share log / status console in the sidebar")
          .addButton((button) =>
            button.setButtonText("Open console").onClick(() => {
              void this.plugin.activateLogView();
            }),
          );
      })
      .addSetting((setting) => {
        setting
          .setName("Debug logging")
          .setDesc(
            "Write timestamped debug logs to a file. The file lives inside your " +
              "vault's configuration folder, NOT among your notes — so it does not " +
              "appear in the file explorer, search, the graph or Quick Switcher.",
          )
          .addToggle((toggle) =>
            toggle.setValue(settings.debugLogging).onChange(async (value) => {
              settings.debugLogging = value;
              await this.plugin.saveSettings();
              this.display();
            }),
          );
      })
      // The owner went looking for this file and did not find it: `7754ac6`
      // moved it out of the vault root (where Obsidian indexed an unbounded log
      // as an ordinary note) into the config folder, and NOTHING in the UI said
      // so. A path the user cannot reach from Obsidian has to be readable HERE,
      // together with whether it is actually being written — an enabled sink
      // that is silently failing looks exactly like an empty log.
      .addSetting((setting) => {
        const sink = this.plugin.logger.getSinkState();
        setting.setName("Debug log location");
        if (!sink.enabled) {
          setting.setDesc(`Disabled. When enabled it will write to: ${sink.path}`);
        } else if (sink.lastError) {
          setting.setDesc(
            `⚠ CANNOT WRITE to ${sink.path} — ${sink.lastError.message} ` +
              `(${sink.failureCount} consecutive failures)`,
          );
        } else {
          setting.setDesc(
            `${sink.path} — ${sink.linesWritten} lines written this session` +
              (sink.linesPending > 0 ? `, ${sink.linesPending} pending` : ""),
          );
        }
        setting.addButton((button) =>
          button
            .setButtonText("Copy path")
            .setTooltip("Copy the log file's vault-relative path to the clipboard")
            .onClick(() => {
              void navigator.clipboard.writeText(sink.path).then(
                () => new Notice(`Live Share: copied ${sink.path}`),
                () => new Notice(`Live Share: log file is at ${sink.path}`),
              );
            }),
        );
        setting.addExtraButton((button) =>
          button
            .setIcon("refresh-cw")
            .setTooltip("Refresh")
            .onClick(() => this.display()),
        );
      })
      .addSetting((setting) => {
        setting
          .setName("Debug log file")
          .setDesc(
            `Vault-relative path for the debug log. Leave empty for the default (${DEFAULT_SETTINGS.debugLogPath}).`,
          )
          .addText((text) => {
            text.setValue(settings.debugLogPath).onChange(async (value) => {
              // WP81: the fallback IS the default, by reference. It used to be a
              // second, independent path literal pointing at the vault root, so
              // clearing this field silently moved the log back there — the
              // location `7754ac6` moved it out of, and where Obsidian indexes it
              // into the graph, search and Quick Switcher. Two literals that
              // agreed on the day they were written is the defect; a reference
              // cannot diverge from the default again.
              settings.debugLogPath = resolveDebugLogPath(value);
              await this.plugin.saveSettings();
            });
            text.inputEl.placeholder = DEFAULT_SETTINGS.debugLogPath;
          });
      });

    const exclusions = new SettingGroup(containerEl).setHeading("Exclusions");

    exclusions.addSetting((setting) => {
      setting
        .setName("Excluded patterns")
        .setDesc(
          "Glob patterns for files to keep out of the session, e.g. drafts/** or *.tmp. " +
            "Your configuration folder and .trash/** are always excluded, and inbound " +
            "writes into any .obsidian/ or .git/ folder are always refused — you do not " +
            "need patterns for those.",
        );
      setting.addButton((button) =>
        button
          .setButtonText("Add exclusion")
          .setCta()
          .onClick(async () => {
            const value = await this.plugin.promptText("Glob pattern, e.g. *.tmp or drafts/**");
            if (value) {
              const trimmed = value.trim();
              if (trimmed && !settings.excludePatterns.includes(trimmed)) {
                settings.excludePatterns.push(trimmed);
                await this.plugin.saveSettings();
                this.display();
              }
            }
          }),
      );
    });

    for (const pattern of settings.excludePatterns) {
      exclusions.addSetting((setting) => {
        setting.setName(pattern);
        setting.addExtraButton((button) =>
          button
            .setIcon("cross")
            .setTooltip("Remove this pattern")
            .onClick(async () => {
              settings.excludePatterns = settings.excludePatterns.filter((p) => p !== pattern);
              await this.plugin.saveSettings();
              this.display();
            }),
        );
      });
    }

    const readOnly = new SettingGroup(containerEl).setHeading("Permissions");

    readOnly.addSetting((setting) => {
      setting
        .setName("Read-only patterns")
        .setDesc(
          "Glob patterns for files guests can see but not edit, e.g. journal/** or " +
            "README.md. Shared normally; edits are refused. Per-person overrides are " +
            "set from the collaborators panel.",
        );
      setting.addButton((button) =>
        button
          .setButtonText("Add pattern")
          .setCta()
          .onClick(async () => {
            const value = await this.plugin.promptText(
              "Glob pattern, e.g. journal/** or README.md",
            );
            if (value) {
              const trimmed = value.trim();
              if (trimmed && !settings.readOnlyPatterns.includes(trimmed)) {
                settings.readOnlyPatterns.push(trimmed);
                await this.plugin.saveSettings();
                this.display();
              }
            }
          }),
      );
    });

    for (const pattern of settings.readOnlyPatterns) {
      readOnly.addSetting((setting) => {
        setting.setName(pattern);
        setting.addExtraButton((button) =>
          button
            .setIcon("cross")
            .setTooltip("Remove this pattern")
            .onClick(async () => {
              settings.readOnlyPatterns = settings.readOnlyPatterns.filter((p) => p !== pattern);
              await this.plugin.saveSettings();
              this.display();
            }),
        );
      });
    }
  }
}
