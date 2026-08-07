# Plugin Usage

## Installation

### From Source

```bash
cd plugin && npm install && npm run build
```

Copy into your vault:

```bash
mkdir -p /path/to/vault/.obsidian/plugins/live-share
cp main.js styles.css /path/to/vault/.obsidian/plugins/live-share/
cp manifest.json /path/to/vault/.obsidian/plugins/live-share/
```

The folder name must match the `id` in `manifest.json`, which is `live-share`.

Enable **Live Share** in **Settings > Community Plugins**.

### Via BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), add this repository, and enable the plugin.

## Settings

Open **Settings > Live Share**:

### Connection

| Setting | Default | Description |
|---------|---------|-------------|
| Server URL | `http://localhost:3000` | URL of your Live Share server |
| Server password | - | Optional password if the server requires one |

### Identity

| Setting | Default | Description |
|---------|---------|-------------|
| Display name | `Anonymous` | Your name shown to collaborators |
| Cursor color | `#7c3aed` | Your cursor and selection color in the editor |

### Session

| Setting | Default | Description |
|---------|---------|-------------|
| Shared folder | - | Restrict sharing to a subfolder. Type-ahead over your vault's real folders. **Empty = the whole vault** — see below. |
| Require approval | `false` | Require host approval before guests can join |
| Approval timeout | `60` seconds | Auto-deny pending join requests after this duration (0 = no timeout) |

> **What an empty "Shared folder" does.** It is not "unset" and not "share nothing" — every path in the
> vault is shared, and it is the shipped default. Guests see every note, and their deletions, renames and
> moves are applied to your vault. Starting a session with the field empty asks for confirmation first.
>
> A folder name that does not exist shares **nothing**, silently — the session connects and reports no
> error. Pick from the suggestions rather than typing, and the value is one that exists.

### Preferences

| Setting | Default | Description |
|---------|---------|-------------|
| Notifications | `true` | Show non-critical status notices |
| Auto-reconnect | `true` | Rejoin the previous session automatically on startup |

### Debug

| Setting | Default | Description |
|---------|---------|-------------|
| Debug logging | `false` | Write verbose debug logs to a file |
| Debug log file | `.obsidian/live-share-debug.md` | Where the log goes. It lives in the **configuration folder, not among your notes**, so it does not appear in the file explorer, search, the graph or Quick Switcher — at the vault root Obsidian indexed an unbounded log as an ordinary note. Clearing the field restores the default. |
| Debug log location | — | Read-only. Shows the resolved path, how many lines were written this session, and any write failure. An enabled sink that is failing looks exactly like an empty log, so this states which it is. **Copy path** puts it on the clipboard. |
| Open status console | — | Opens the live log in the sidebar, without a file |

### Canvas

| Setting | Default | Description |
|---------|---------|-------------|
| Show canvas cursors | `true` | Other collaborators' live cursors on shared canvases |
| Show canvas presence | `true` | Highlight cards others are selecting, editing or holding |
| Canvas sync engine: V2 node-level binding | `false` | Selects between two whole canvas implementations. **ON** — changes sync node by node through the CRDT binding, so two people can drag different cards at once and an edit to one card does not rewrite the whole file. **OFF** — the legacy path, reconciling the entire canvas file on every change. Both directions (local capture and remote apply) follow the flag together. Close and reopen a canvas after changing it. |

### Advanced

| Setting | Description |
|---------|-------------|
| Excluded patterns | Glob patterns for files to exclude from sync (e.g. `drafts/**`, `*.tmp`). Your configuration folder and `.trash/**` are always excluded; inbound writes into any `.obsidian/` or `.git/` folder are always refused. |
| Read-only patterns | Glob patterns guests can see but not edit (e.g. `journal/**`, `README.md`). Per-person overrides are set from the collaborators panel. |

When a session is active, the settings page also shows connection state, room ID, encryption status, and session actions.

## Commands

All commands are in the command palette (Ctrl/Cmd+P, type "Live Share").

| Command | Description | Access |
|---------|-------------|--------|
| Start session | Create a room and start hosting | Anyone |
| Join session | Paste an invite link to join | Anyone |
| End session | End the session for all participants | Host |
| Leave session | Leave the session | Guest |
| Copy invite link | Copy invite to clipboard | Anyone in session |
| Retry connection | Re-arm sharing after a peer gave up: re-publishes the manifest and re-subscribes every shared file, without ending the session. Also a button on the settings page. | Anyone in session |
| Show collaborators panel | Open the presence sidebar | Anyone |
| Focus participants here | Send "look here" to all participants | Anyone in session |
| Summon all participants here | Navigate everyone to your cursor position | Host |
| Summon a specific participant | Pick a user and navigate them to your cursor | Host |
| Reload all files from host | Re-download all shared files | Guest |
| Toggle presentation mode | Auto-broadcast your navigation on file change | Host |
| Transfer host role | Offer host role to another user | Host |
| Set file permissions | Set per-file read-only/read-write for a specific guest | Host |
| Show audit log | View join/leave/kick/permission events | Host |
| Log in with GitHub | Start GitHub OAuth flow | Anyone |
| Log out | Clear stored authentication | Anyone |

## Presence Panel

The collaborators panel (right sidebar) shows each connected user with:

- Colored dot matching their cursor color
- Display name with "Host" badge if applicable
- Current file they're viewing
- **Follow**: Click to follow their navigation and scroll. Any local interaction unfollows.
- **Permission toggle** (host only): Switch between read-write and read-only
- **Summon** (host only): Navigate that user to your cursor position
- **Kick** (host only): Remove from session (with confirmation)

## Ribbon Icon

Click the collaborators icon in the left ribbon to open the presence panel. Right-click for a context menu with session actions.

## Status Bar

Shows connection state, user count, latency, and presentation mode status. Click to open the presence panel.

## Permissions

### Global Permissions

When **Require approval** is enabled, the host sees a modal to approve or deny each guest with read-write or read-only access. The host can change permissions at any time via the presence panel.

### Per-File Permissions

The host can set per-file overrides via the **Set file permissions** command. Per-file overrides take precedence over the user's global permission. Files with overrides show lock icons in the file explorer.

### Kick Protection

When the host kicks a user, that user must be re-approved by the host to rejoin the session. This applies even when **Require approval** is disabled - the server forces a one-time approval gate for kicked users.

## Host Transfer

The host can transfer the role via **Transfer host role**. The target sees a confirmation dialog. The server validates the transfer before swapping roles. All participants are notified of the new host.

## File Exclusion

Add glob patterns in **Settings > Live Share > Excluded patterns** to prevent specific files from syncing.

Default excludes: `.obsidian/**`, `.trash/**`.

Example patterns: `drafts/**`, `*.tmp`, `private/**`.

Uses glob syntax via [minimatch](https://github.com/isaacs/minimatch).

## Presentation Mode

When the host enables presentation mode via **Toggle presentation mode**, every file navigation the host makes is automatically broadcast to all participants. Guests will follow the host's active file in real time. The status bar shows when presentation mode is active.

## File Types

- **Text files** (`.md`, `.txt`, `.json`, `.css`, `.js`, `.ts`, `.html`, `.xml`, `.yaml`, `.toml`, `.csv`, etc.): Character-level real-time sync via Yjs
- **Binary files** (images, PDFs, etc.): Base64 transfer via the control channel with automatic chunking. Max 50 MB per file.
- **Canvas files** (`.canvas`): Real-time CRDT sync with per-node presence and node-level conflict resolution. Which engine handles them is set by **Canvas sync engine** above.

## Cross-Platform Support

Live Share supports collaboration between Windows and macOS/Linux vaults. Windows-forbidden filename characters (`? * < > " | :`) are transparently mapped to fullwidth Unicode equivalents on Windows systems. This mapping is automatic - no configuration needed.

## Invite Link Format

Invite links use the format `obsliveshare:<base64>` containing the server URL, room ID, room token, encryption passphrase, and server password. The encryption passphrase and server password are embedded so the server never sees them directly.

You can also join via Obsidian protocol link: `obsidian://live-share?invite=obsliveshare%3A...`

Share invite links through a secure channel - anyone with the link can join the session.
