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
| Canvas sync engine: model-driven capture | `false` | **Does not change the data model** — both settings read and write the same node-level V2 record CRDT. It changes how local intent is captured and how remote deltas are applied. **ON** — captured from the interaction itself (model → CRDT, no file read) and applied per node. **OFF** — the settled default: captured by re-reading and diffing the `.canvas` file, with remote deltas patching the open view as a whole. Both directions follow the flag together. Close and reopen a canvas after changing it. |

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
- **Canvas files** (`.canvas`): Real-time node-level CRDT sync with per-node presence and conflict resolution. How local edits are captured is set by **Canvas sync engine** above; the record model is the same either way.

## Cross-Platform Support

Live Share supports collaboration between Windows and macOS/Linux vaults. Windows-forbidden filename characters (`? * < > " | :`) are transparently mapped to fullwidth Unicode equivalents on Windows systems. This mapping is automatic - no configuration needed.

## Troubleshooting

### A note opens empty, or content is missing on one peer

If a shared note appears **empty on one machine** while another shows it with content — or a note in the
shared folder goes to **0 bytes**, or a newly created canvas never shows up on one peer — the likely cause
is a **first-arrival race**, and it depends on the *difference* in connection speed between peers, not on
absolute speed.

**A peer on a slower link loses the race to publish a document, and the faster peer is told the document is
new.** The symptom lands on the *faster* peer and describes the *slower* peer's files. Two people on
similar connections rarely see it; one on mobile or a VPN and one on fibre is the shape that triggers it.

The known defects in this family are fixed. If you still see it:

1. **Note which peer is on the slower connection** — that is the first thing worth knowing.
2. **Turn on Debug logging** (Settings → Live Share → Debug). The log lives at
   `.obsidian/live-share-debug.md`, inside your configuration folder rather than among your notes, so it
   will not appear in search or the graph. **Debug log location** shows the resolved path and how many
   lines have been written — an enabled log that is failing to write looks exactly like an empty one, so
   check that line rather than assuming.
3. **Look for `MUTE OVERRUN:`** in the log. A rename, move or delete issued within about a second of that
   same file arriving from a peer is currently dropped, permanently and without notice. Waiting a moment
   after a file arrives before renaming it avoids it.
4. **Do not re-save the empty version.** If a note opens empty and you have a good copy elsewhere, close it
   without editing. Obsidian's **File recovery** (Settings → File recovery → Snapshots) keeps periodic
   snapshots and is the fastest route back.

### A "(conflicts)" folder appeared next to my shared folder

That is deliberate. When you rejoin a session and a file you edited **while the session was closed**
differs from the host's copy, your version is copied to `<shared folder> (conflicts)/` before the host's
version is written. The path is mirrored and the filename is timestamped, so nothing is overwritten and two
conflicts on the same file can coexist.

Files you did **not** edit are simply overwritten with the host's copy and produce no clutter. The folder is
never shared with peers.

### Nothing syncs at all, but the session says connected

Check **Shared folder** in settings. A folder name that does not exist shares nothing and reports no error.
Pick from the type-ahead suggestions rather than typing the name, and the value is one that exists.

## Invite Link Format

Invite links use the format `obsliveshare:<base64>` containing the server URL, room ID, room token, encryption passphrase, and server password. The encryption passphrase and server password are embedded so the server never sees them directly.

You can also join via Obsidian protocol link: `obsidian://live-share?invite=obsliveshare%3A...`

Share invite links through a secure channel - anyone with the link can join the session.
