# Live Share for Obsidian

<p align="center">
  <strong>Self-hosted, real-time collaboration for Markdown and Canvas.</strong><br>
  Edit together with live cursors, structured Canvas CRDTs, file sync, presence, permissions, and optional end-to-end encryption.
</p>

<p align="center">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-22c55e.svg">
  <img alt="Obsidian desktop" src="https://img.shields.io/badge/Obsidian-desktop-7c3aed.svg">
  <img alt="Yjs CRDT" src="https://img.shields.io/badge/CRDT-Yjs-2563eb.svg">
  <img alt="Project status" src="https://img.shields.io/badge/status-active%20stabilization-f59e0b.svg">
</p>

![Live Share runtime architecture](docs/assets/architecture-overview.svg)

Live Share turns a self-hosted relay and two Obsidian desktop clients into a collaborative workspace. Markdown is synchronized character by character. Canvas files use a structured, record-level CRDT designed to preserve cards, arrows, ordering, live editor state, and deletion intent under concurrent work.

This repository began as a fork of [Mewski/obsidian-live-share](https://github.com/Mewski/obsidian-live-share) and has since undergone a substantial architectural rewrite. The original and modified work remains available under the MIT License.

> [!IMPORTANT]
> This branch is under active stabilization and is not yet presented as a finished public release. The core collaboration system is implemented and tested extensively, but the final two-instance release matrix and several edge-case investigations are still open. See [Project status](#project-status).

## Why this version exists

The original plugin proved that real-time Obsidian collaboration was possible. This version focuses on making it predictable under latency, reconnects, concurrent Canvas editing, stale files, and partial information.

The main architectural changes are:

- Canvas CRDT V2 with per-record maps, atomic registers, fractional ordering, tombstones, and `Y.Text` fields.
- A Surface Shadow that distinguishes user intent from stale disk state and remote projection.
- Per-record apply receipts so “values match” and “this surface accepted the change” are not confused.
- Completeness-aware deletion: missing data is never treated as permission to destroy content.
- One Canvas disk writer and explicit ownership boundaries.
- Durable local sidecar, document GUID, epoch, explicit import, and refusal protection.
- Editing-aware remote reconcile that preserves an active inline editor.
- Real Obsidian E2E control and two-vault validation infrastructure.

## Features

### Collaboration

- Real-time Markdown editing with Yjs and CodeMirror.
- Live text cursors and selections.
- Structured Canvas collaboration with node-level conflict handling.
- Canvas cursors, peer identity, and card interaction presence.
- File and folder create, delete, rename, and binary transfer.
- Offline operation queue and reconnect support.
- Offline-edit preservation: a guest's divergent local file is copied into a dedicated conflicts folder before the host version is applied.
- Presentation, follow, summon, and collaborator controls.

### Access and safety

- Self-hosted relay.
- Optional relay password.
- Optional GitHub OAuth/JWT authentication.
- Guest approval and kick protection.
- Host transfer and read-only permissions.
- Shared-folder, exclusion, and read-only patterns.
- Path traversal protection and `.obsidian/**` inbound protection.
- Optional AES-GCM-256 session encryption with a PBKDF2-derived key.

### Canvas integrity

- Deterministic canonical serialization.
- Create-once type and identity rules.
- Delete tombstones and dangling-edge suppression.
- Ingest validation and quarantine.
- Durable seed-refusal protection.
- GUID-backed identity across rename.
- Editing-aware deferral and blur merge.
- Explicit import instead of accidental reseeding.
- Empty-document safeguards that distinguish missing CRDT content from an intentional delete.

### Offline conflict preservation

The host remains authoritative when a guest rejoins with a different local file, but the guest's work is no longer silently overwritten. If the local file changed after that peer's previous session ended, Live Share preserves it before applying the host version:

```text
Shared Notes/
└── projects/plan.md

Shared Notes (conflicts)/
└── projects/plan (2026-08-07 17-42-03).md
```

When the whole vault is shared, copies go under `Live Share (conflicts)/` at the vault root. The relative folder structure is retained, filenames are timestamped, and the conflicts area is explicitly excluded from sharing so copies cannot recursively create more conflicts. If the plugin cannot determine whether a local file changed offline, it preserves the file rather than risking data loss.

## How it works

The system deliberately separates content synchronization from operational control:

| Channel | Carries | Why it is separate |
|---|---|---|
| **MUX** | Yjs document updates and awareness | Compact binary collaboration stream for many shared documents |
| **CONTROL** | File operations, session events, permissions, presence commands | Typed operational messages with authorization and lifecycle rules |

The relay forwards state and coordinates rooms. It does not understand Canvas semantics; correctness is enforced by each client.

### Canvas V2 in one picture

![Canvas V2 data flow](docs/assets/canvas-v2-flow.svg)

A local save is compared with the last state the Obsidian surface actually accepted. The resulting intent is validated before entering Yjs. Remote state follows the opposite path: it is planned, safely applied or deferred around a live editor, receipted, and serialized through one writer.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the full runtime, document model, security boundaries, and concurrency design.

### Obsidian Canvas compatibility

Canvas collaboration uses the public `.canvas` file format and a guarded adapter over Obsidian's currently undocumented live Canvas controller. The adapter is needed for live geometry, selection, dragging, inline-editor protection, and non-destructive view updates. These internal members are not part of Obsidian's stable public plugin API and may change between Obsidian releases.

The dependency is isolated in `plugin/src/canvas/canvas-adapter.ts`, capability-checked at runtime, restored when the adapter is destroyed, and designed to fall back to file-driven synchronization when a live capability is unavailable. Nevertheless, new Obsidian versions must be compatibility-tested before they are declared supported. This project is an independent community plugin and is not affiliated with or endorsed by Obsidian.

## Quick start

### Prerequisites

- Obsidian desktop 1.11 or newer.
- Node.js 20 or newer.
- npm.
- A machine reachable by every collaborator if you are self-hosting across devices.

### 1. Start the relay

```bash
cd server
npm ci
npm run build
npm start
```

The default endpoint is `http://localhost:3000`. Check it with:

```bash
curl http://localhost:3000/healthz
```

For a containerized setup, review `Dockerfile` and `docker-compose.yml` before deployment. Use TLS and a server password on an untrusted network.

### 2. Build the plugin

```bash
cd plugin
npm ci
npm run build
```

Copy the release files into your vault:

```text
<vault>/.obsidian/plugins/live-share/
├── main.js
├── manifest.json
└── styles.css
```

Use the root `manifest.json` and `plugin/styles.css` alongside the generated `plugin/main.js`. Reload Obsidian, enable **Live Share** under **Settings → Community plugins**, then open its settings page.

### 3. Configure a safe shared surface

Set:

- Server URL.
- Server password, if configured.
- Display name and cursor color.
- A dedicated shared folder.

> [!CAUTION]
> An empty shared-folder setting means the entire vault. Creates, changes, moves, renames, and deletions inside the shared surface are collaboration operations. Start with a dedicated test folder and a backup.

### 4. Collaborate

The host runs **Live Share: Start session** and sends the generated invite. A guest runs **Live Share: Join session** and pastes it.

## Commands

| Command | Purpose | Access |
|---|---|---|
| Start session | Create a room and begin hosting | Anyone |
| Join session | Join from an invite | Anyone |
| End session | End the room for all participants | Host |
| Leave session | Leave without ending the room | Guest |
| Copy invite link | Copy the current invitation | Participant |
| Retry connection | Reconnect and republish without destroying session identity | Participant |
| Show collaborators | Open the presence sidebar | Participant |
| Focus participants here | Broadcast the current location | Participant |
| Summon participants | Navigate participants to the host | Host |
| Transfer host role | Hand the host role to another peer | Host |
| Set file permissions | Change per-file read/write access | Host |
| Reload files from host | Reconcile shared files from host state | Guest |
| Show audit log | Inspect session events | Host |

## Configuration

### Plugin settings

| Setting | Default | Notes |
|---|---:|---|
| Server URL | `http://localhost:3000` | Use `https://`/`wss://` through a TLS proxy in production |
| Server password | empty | Shared relay credential |
| Display name | `Anonymous` | Shown to collaborators |
| Cursor color | `#7c3aed` | Used for presence indicators |
| Shared folder | empty | Empty shares the whole vault |
| Require approval | `false` | Host approves new guests |
| Auto-reconnect | `true` | Attempts to resume the previous room |
| Debug logging | `false` | Writes diagnostic logs under the Obsidian config area |
| Canvas cursors | `true` | Show remote pointers |
| Canvas presence | `true` | Show remote card interaction |
| Canvas V2 binding | `false` | Experimental model-driven capture path; file-driven V2 is the settled default |
| Excluded patterns | empty | Globs omitted from sharing |
| Read-only patterns | empty | Visible but guest-write-protected globs |

### Relay environment

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3000` | HTTP/WebSocket listen port |
| `SERVER_PASSWORD` | empty | Restrict relay access |
| `TLS_CERT`, `TLS_KEY` | empty | Direct TLS termination |
| `REQUIRE_GITHUB_AUTH` | `false` | Require GitHub OAuth |
| `GITHUB_CLIENT_ID` | empty | OAuth application ID |
| `GITHUB_CLIENT_SECRET` | empty | OAuth application secret |
| `JWT_SECRET` | empty | Required when JWT auth is enabled |
| `CORS_ORIGIN` | `*` | Allowed browser origin |

Never commit a production `.env`, server password, token, JWT secret, or session passphrase.

## Security model

- TLS protects all traffic in transit.
- AES-GCM session encryption protects file-operation content, file chunks, and transferred file paths from the relay.
- Yjs CRDT updates, including Markdown and Canvas collaboration state, are not end-to-end encrypted. The relay can read that live state; TLS protects it only while in transit.
- The relay also sees connection, room, presence, and protocol metadata.
- A relay password is shared access, not per-user revocation.
- JWT identity is trusted only when `JWT_SECRET` is explicitly configured; the insecure historical default is never accepted.
- Peer-supplied paths are constrained to the vault and protected `.obsidian/**` paths are rejected before disk writes.
- Collaborators are trusted participants; the protocol is not Byzantine-fault-tolerant.
- The host and guests can modify files within the configured shared surface according to permissions.

Read [docs/security.md](docs/security.md) before exposing a relay to the internet.

## Development

Install exact locked dependencies separately in each package:

```bash
cd plugin
npm ci
npm run build
npm test
npm run lint

cd ../server
npm ci
npm run build
npm test
npm run lint
```

Useful plugin commands:

| Command | Purpose |
|---|---|
| `npm run dev` | Watch and rebuild the development plugin |
| `npm run build` | Type-check and create a production bundle |
| `npm run build:e2e` | Create a one-shot instrumented E2E bundle |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Run Biome checks |

### Repository layout

```text
├── plugin/                    ← Obsidian client
├── server/                    ← self-hosted relay
├── tools/obsidian_e2e/        ← real two-vault orchestration
├── docs/                      ← user and developer documentation
├── workflowArtifacts/         ← specs and historical engineering evidence
├── ARCHITECTURE.md            ← current technical architecture
├── README.md                  ← project entry point
└── LICENSE                    ← MIT license
```

## Project status

The settled implementation includes Canvas V2 foundations, sidecar/GUID/epoch identity, editing-aware reconcile, durable refusal protection, relay checkpoints, offline conflict preservation, empty-write protection, event-driven Canvas mirror materialization, and the real-Obsidian test infrastructure.

Still incomplete or under active validation:

- The final real-host release matrix.
- Room-mode consensus and Receive-and-Persist as a complete phase.
- Promotion of model-driven operation capture as the universal Canvas path.
- Some cross-platform identity and lifecycle edge cases.
- Compatibility validation whenever Obsidian changes its undocumented Canvas controller.

The canonical current-state contract is [workflowArtifacts/BUILD_SPEC_ObsidianLiveShare.md](workflowArtifacts/BUILD_SPEC_ObsidianLiveShare.md). The many neighboring workflow files are an audit trail, not competing current documentation.

## Contributing

The project is not yet organized for broad external contributions, but focused bug reports and reproducible cases are welcome when the repository is published.

Good reports include:

- Obsidian and plugin version.
- Host/guest role and platform.
- Whether the Canvas was already present before joining.
- Exact shared-folder and feature-flag state without secrets.
- Minimal reproduction steps.
- Sanitized logs with credentials and vault content removed.

Before submitting code, run the plugin and server build, test, and lint commands relevant to your change.

## Provenance and license

This project is based on [Mewski/obsidian-live-share](https://github.com/Mewski/obsidian-live-share), originally copyright © 2026 Project Takoyaki Technologies. It has since received extensive architectural and implementation changes.

The project is licensed under the [MIT License](LICENSE). You may use, modify, distribute, sublicense, and sell copies subject to the license notice and disclaimer.

## Documentation

- [Current architecture](ARCHITECTURE.md)
- [Security model](docs/security.md)
- [Authoritative build specification](workflowArtifacts/BUILD_SPEC_ObsidianLiveShare.md)
