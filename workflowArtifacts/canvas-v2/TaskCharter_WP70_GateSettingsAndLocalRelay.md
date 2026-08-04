# Task Charter — WP70: Gate settings provisioning and local relay lifecycle

<!-- Updated: chartered because the two facts that make the real-Obsidian gate mean anything — that the two vaults share a surface containing the scratch canvas, and that a relay exists at all — were owned by no work package; WP44 provisions one key and WP7 says "a local relay" without anyone starting one 2026-08-02 -->
<!-- Updated: the second sync engine corrected from lan-vault-sync (installed, NOT enabled) to obsidian-git and its disposition made a precondition; the canvas.setFlag borrow-clobber entered as a risk and split out as WP72; the agent-mediated run entered against AC4's ordering. AC1–AC5 unchanged verbatim 2026-08-04 -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP70
**Phase:** P0 (PHASE T3 group)
**task_mode:** `standard`
**Depends on:** WP43, WP44, WP47, WP69
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** the gate has a sync path it owns end to end — a relay the rig starts, a room the rig mints, and a shared surface the rig **establishes** rather than hopes for — so a green matrix case is a statement about Canvas V2 and not about two files nobody was syncing.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, **PHASE T3**, component **C70 — Gate settings provisioning and local relay lifecycle** (work package WP70); phase **P0**. C70 sits at the end of the PHASE T3 block, after C69; in execution order it precedes **WP7** and runs after **WP69**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: **modify** in three files, plus one **create**:
    - `tools/obsidian_e2e/constants.py` — the pinned values this WP introduces (relay port, relay URL, store paths, provisioned settings key set and its values, new named failure reasons). **This module is the single owner of every constant in the phase** (WP43); WP70 adds to it and no other module re-spells any of them.
    - `workflowArtifacts/canvas-v2/T3_SharedContract.md` — the matching contract entries. `constants.py`'s own header states that a value there is transcribed from the contract and that "the fix is to amend the contract and this file together — never to shadow it locally". A constant added to one and not the other is drift, and drift in a pinned-constant register is what hard-won rule 10 exists to prevent.
    - `tools/obsidian_e2e/ports.py` — **one** generalisation: the textual splice that today writes a single member writes an ordered member set, reached through **one** added keyword argument. Nothing else in the module changes.
    - `tools/obsidian_e2e/relay.py` — **new** module: build-or-verify, start, readiness, room creation, stop and release of the rig-owned local relay.
  - Responsibility: **provision** the settings that make the gate non-vacuous, and **own** the relay's lifecycle. This WP is the *provisioner*. C50 AC5 is the *detector*.
- **Out of scope / non-goals:**
  - **Any relay deployment.** The gate runs against a local relay (see §3, "The relay decision"). The owner has *authorised* deploying to the NeuralAngels box for testing; that is permission, not a requirement, and a remote relay is not part of this gate. Remote-relay operation may later be recorded as a **future, non-gating** matrix case; it is **not** chartered here and must not be added in passing.
  - **Any change to `server/` source.** §7 makes touching it outside WP41 an abort criterion. This WP starts the server that exists, configures it entirely through environment variables it already reads, and changes nothing in it. Where the server's behaviour is inconvenient (see the `listen` note in §5) that is recorded as a constraint, not repaired.
  - **A second backup or restore mechanism.** `data.json` is borrowed exactly once per vault per run, under WP44's existing namespace (`data.json.e2e-original`, `.e2e-provision.json`). Two restore paths over one file is the failure this charter is written to avoid, not a design option.
  - **The scratch canvas itself** — its name, its folder, its creation, its removal and the vault fingerprint are **WP47**, landed. This WP does not create, name, place or delete a scratch artefact. It makes the folder WP47 already owns be inside the shared surface.
  - **Detection of unestablished sharing at run time** — C50 AC5, landed as a charter. This WP must not weaken it, and must not be implemented in a way that lets the detector be satisfied by anything other than sharing actually being established.
  - <!-- Updated: CORRECTED — the engine named here was lan-vault-sync, which is installed but NOT enabled; the enabled engine is obsidian-git, and C50 AC5 now makes its disposition a precondition rather than a choice. The independence of this WP's AC5 from that disposition is unchanged and is the whole point 2026-08-04 --> **The second sync engine's disposition** — WP50 (C50 AC5) owns it. **That engine is `obsidian-git`, not `lan-vault-sync`:** `community-plugins.json` is Obsidian's *enabled* list, it is byte-identical in both vaults, and it contains exactly `obsidian-git` and `live-share`, so **`lan-vault-sync` is installed but NOT enabled and cannot run** (recorded so it is not rediscovered). `obsidian-git` carries `autoPullOnBoot: true` in both vaults over dirty git working trees with `origin` remotes, and C50 AC5 now makes disabling-and-restoring it a **precondition** rather than one of two permitted decisions. **This WP's AC5 must nevertheless hold independently of that precondition** — it may not be discharged by observing content appear in vault B, and it may not be discharged by citing the disposition record. A precondition is a claim about what was configured; AC5 is a claim about what the relay observed. If AC5 could rest on the disposition, the disposition record would have become the evidence, which is exactly the substitution AC5 exists to refuse.
  - Building or installing the plugin bundle — **WP69**. Launching or attaching Obsidian — **WP45**. Readiness and identity — **WP46**. Teardown sequencing — **WP48**.
  - Any change to `plugin/src/**`. This WP reads plugin source to establish what the settings mean; it modifies none of it.
- **Known interfaces / dependencies:**
  - Input: the two resolved vault descriptors (WP43); a run identifier (WP43's `new_run_id`); the scratch folder and path scheme (WP47, `constants.py:119–121`, `:168–170`)
  - Output: a running local relay with a known port and a minted room; per vault one borrow carrying the full provisioned key set; a recorded ordering; a released port and a removed store directory
  - Depends on work packages: **WP43** (constants module, roles, named-reason enum), **WP44** (the one borrow: byte-exact capture, marker, verified restore — extended, never duplicated), **WP47** (the scratch folder whose membership in the shared surface this WP establishes), **WP69** (the E2E-capable bundle; a relay is pointless against a bundle that cannot host a control endpoint)
  - **WP7 depends on this WP.** WP50 does not: C50 AC5 is verified against fake endpoints, as §9 already records for WP69.

---

## 3. Architecture Context

*Task-local architecture guidance only. Everything below was read from the current tree on 2026-08-02 and is cited by file and line. **None of it has been executed** — see §5's last bullet.*

### The hole this closes

Two connected gaps, both currently unowned:

- **Nobody provisions the settings that make the gate non-vacuous.** WP44 provisions exactly one key, `e2eControlPort` (`constants.py:83`). WP47 places the scratch canvas at `<vault>/_e2e-rig/e2e-scratch-<run_id>.canvas` (`constants.py:119–121`, `:168–170`) — vault-relative and rig-owned. **Nothing establishes that `_e2e-rig` is inside the shared surface, or that the two vaults agree on `roomId` / `serverUrl` / `sharedFolder`.** If `sharedFolder` does not cover `_e2e-rig`, the scratch canvas is never synced, every matrix case converges trivially, and the release gate goes green while proving nothing. That is a vacuous green in the most consequential position this project has — the gate itself — and eliminating that failure class is the reason this initiative exists.
- **Nobody starts or points at a relay.** WP7 §2 scopes deployment out and states the gate "runs against a local relay", but nothing under `tools/obsidian_e2e/` starts one, and neither vault's `serverUrl` is read by any rig module.

**Detector versus provisioner — keep them distinct.** C50 AC5 makes the rig refuse loudly (`inconclusive`) when sharing is not established before case 1. That is the detector. **WP70 is the provisioner.** A detector that its own provisioner is allowed to satisfy trivially is worthless: the provisioner must establish the state, and the detector must be able to observe it through an independent channel — the running instances' own view of what they share — not by reading back the file the provisioner wrote.

### What the settings actually do — read from the tree, not assumed

| Fact | Site |
|---|---|
| Auto-reconnect fires only when `roomId && token && role && autoReconnect` are all set; it runs on `onLayoutReady`, i.e. from what `loadData()` read **at load time** | `plugin/src/main.ts:408–417` |
| `resumeSession()` branches on `role`: **host** publishes the manifest with `{purge: true}`; **guest** runs `cleanupStaleFiles()` and then `syncFromManifest(...)` | `plugin/src/main.ts:465–489` |
| `cleanupStaleFiles()` **trashes** (`app.fileManager.trashFile`) every local file that `isSharedPath` admits and the manifest does not contain | `plugin/src/main.ts:523–540` |
| `isSharedPath` returns **`true` for every path** when `sharedFolder` is empty — an empty `sharedFolder` means *the whole vault is shared* | `plugin/src/files/manifest.ts:422–450` |
| `sharedFolder` defaults to `""`; `serverUrl` defaults to `http://localhost:3000` | `plugin/src/types.ts:40–61` |
| The websocket URL is `serverUrl` with `http`→`ws`, path `/ws-mux/<roomId>`, query `token` (+ optional `jwt`, `password`, `userId`) | `plugin/src/sync/sync.ts:350–362`, `plugin/src/utils.ts:120–122` |

**The consequence is a data-safety finding, not a convenience argument.** The values in the two vaults' `data.json` have never been read by anyone (`T3_PREFLIGHT.md` open question 3 records this explicitly). If `sharedFolder` is empty in both — which is the shipped default — then a gate run makes the **whole of vault A** the shared surface, the host publishes a manifest of every file in it, and the guest trashes every file in **vault B** that is not in that manifest. The two vaults are copies of each other but were never asserted to be identical, and both are the owner's live working vaults (D16). A gate that can do that has a larger blast radius than the defect it is testing for.

### The relay decision — binding, recorded, not re-litigated

**The gate runs against a LOCAL relay, started and stopped by the rig.** A release gate must be hermetic. `server/package.json` builds with `tsc` and starts with `node dist/index.js` — ordinary process control, and, unlike the plugin's dev build (C69), **both commands terminate**; there is no watch trap on this side. A local relay is therefore cheap and deterministic. Deploying to the NeuralAngels box is *authorised* but not required, and a network dependency would inject exactly the flake this run has spent its whole length removing from its own signals. Remote-relay operation is a possible **future, non-gating** matrix case and is not chartered.

### The relay as it exists — configured entirely through environment variables it already reads

| Fact | Site |
|---|---|
| `PORT` (default `3000`) selects the listen port; invalid values exit 1 | `server/src/index.ts:227–233` |
| `GET /healthz` returns `{ok:true, uptime, sessions, documents, clients}` — a positive statement by the process about itself | `server/src/index.ts:73–81` |
| `POST /rooms` **mints** `id: randomUUID()` and `token: nanoid(24)` — the client cannot dictate either | `server/src/rooms.ts:83–115` |
| `SERVER_PASSWORD` unset ⇒ no password is checked on `/rooms` or on upgrade; `REQUIRE_GITHUB_AUTH` unset ⇒ no JWT is required | `server/src/index.ts:22–23`, `:51–60`, `:107–131` |
| `SIGTERM` / `SIGINT` trigger a graceful shutdown; there is no HTTP shutdown route | `server/src/index.ts:239–252` |
| Three LevelDB stores default to paths **relative to the process cwd**: `BLOB_STORE_PATH` → `./data/frames`, room persistence → `./data/yjs-docs`, audit log → `./data/audit` | `server/src/index.ts:203`, `server/src/persistence.ts:25`, `server/src/audit-log.ts:14` |

Two consequences the implementor must not rediscover the hard way. **First: the local relay needs no secret of any kind** — with `SERVER_PASSWORD` and `REQUIRE_GITHUB_AUTH` unset, a stored non-empty `serverPassword` in a vault is sent as a query parameter and ignored, so the rig never reads, needs or carries one. **Second: the three store paths are cwd-relative**, so a relay started with the repo as its working directory writes three LevelDB directories into the repo tree and leaves them there. The rig points all three at a run-scoped directory it owns and removes.

### Prior art — the headless rig's relay, and why it is not reusable here

`plugin/src/__tests__/e2e/two-host-harness.ts:226–248` boots an **in-process** relay (`startRelay()` from `wp5/harness.ts`) and calls `createRoom(relayPort, roomName)` so both lightweight hosts share one room id. That pattern works because both hosts live in the same Node process as the relay. The real rig's hosts are two Obsidian windows, so the relay must be a separate OS process. The **room-creation step is the same** and its shape (`POST /rooms`, read back `{id, token}`) is reused verbatim rather than reinvented. `launch_liveshare_e2e.py:80–86` also records why a bundled server must not re-run its own `isMain` bootstrap — it would spin up a second relay on `:3000` with a Level DB.

### Ports — one WP defines, the others read

Taken: `39421`/`39422` (`HEADLESS_RIG_PORT_A/B`) and `39431`/`39432` (`REAL_CONTROL_PORT_A/B`), `constants.py:72–77`. The relay port is **new, rig-owned and disjoint from all four**, defined once in `constants.py`, recorded in `T3_SharedContract.md` §3, and **spelled as a literal nowhere else** — not in `relay.py`, not in a default argument, not in a docstring example, not in a URL string. Hard-won rule 10: two agents independently choosing incompatible constants has already cost this run a batch.

### Interfaces involved

- Input: two vault descriptors, a run id, the scratch folder constant
- Output: a relay handle (port, base URL, store directory, process identity), a minted room `{id, token}` held in memory, one `ProvisionRecord` per vault, and a released state at teardown

### Constraints from BUILD_SPEC (invariants — what must not change)

- **One borrow per vault (WP44).** The backup namespace is `data.json.e2e-original` and `.e2e-provision.json` (`constants.py:93–94`) and is reused, not paralleled. The marker's pinned field set (`constants.py:98–106`, validated by an exact set comparison at `ports.py:476–480`) **does not change**: the marker's job is to record *what the owner had*, and the restore path (`ports.py:700–801`) needs `hadOriginal` and `originalSha256` and nothing else. Recording what the rig *wrote* into the marker would add fields to a validated set for no restore benefit — and would put provisioned values into a file on disk, which S4 forbids for anything read out of `data.json`.
- **The restore path is not touched.** It reads the backup and copies it verbatim, verified by sha256 **and** byte length, and is independent of the modify path by construction (`ports.py` module docstring, `:27–43`). WP70 adds members to the modify path only.
- **`T3_PREFLIGHT.md`'s independent baselines must still pass at teardown** — `ObsidianOrga` = `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162`, `ObsidianOrga - Kopie` = `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` (C50 AC6). Provisioning ten keys instead of one changes nothing about that check, and that is the test of whether this WP was built correctly: a restore that is byte-exact for one key and not for ten is a broken restore, not a bigger diff.
- **S4, restated because this WP writes more into `data.json` than any other.** Both files hold live credentials — `encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`, `token`. No byte of the file, and no value read from it, is ever printed, logged, echoed into a report, handover or commit message, placed in a fixture, or included in an error message. Comparison is **sha256-of-bytes only**. The room token the rig mints is not the owner's credential, but it is a credential: it lives in memory and in the provisioned file, and it is never printed either.
- **D15 / S2 — attach, never kill.** The rig stops only the relay process it started. A foreign listener on the relay port is a refusal, never a target.
- **D16 — the owner's live vaults.** Every write this WP makes is inside one borrowed `data.json` per vault, restored on every exit path.
- **S3 — the vault registry is read-only.** Not touched by this WP at all.
- **Zero new dependencies**, runtime or dev, on either side. The Python side is standard-library only, as the rest of `tools/obsidian_e2e/` is; the relay is started with the `node` and the `server/node_modules` that already exist.
- **Long-running processes go through the `visible-console` MCP tools**, launched by `run_python` with an **absolute** script path. Vault B's path contains spaces and this host has a recorded `run_command` nested-quote trap.
- Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I11 (CONCEPT_V2 Teil 3 + §4.6) are binding and are not weakened.

### Technology / framework / config constraints

- **Schema impact:** none. No doc format, no `.canvas` format, no wire format. The settings *shape* is unchanged: every provisioned key is an existing member of `LiveShareSettings` (`plugin/src/types.ts:5–34`) and no new setting is invented.
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, PHASE T3, component C70. No paraphrasing.*

1. **Every setting the gate depends on is provisioned through WP44's single borrow, and no second mechanism touches `data.json`.** The provisioned key set is pinned once in `constants.py` and is exactly: `e2eControlPort`, `serverUrl`, `roomId`, `token`, `role`, `permission`, `sharedFolder`, `excludePatterns`, `autoReconnect`, `debugLogging` — every one an existing member of `LiveShareSettings`, no key invented, and `encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword` neither read nor written. They are written in **one** capture-and-splice, by the existing borrow, into the existing backup namespace (`data.json.e2e-original`, `.e2e-provision.json`), reached through **one** added keyword argument; the marker's pinned field set is unchanged, and the restore path is not modified at all. Provisioning the port alone still produces byte-identical output to the pre-change implementation, and every byte outside the spliced members survives the round trip — the file keeps its own indentation, line endings, key order and encoding. `debugLogging` is provisioned `false` for the duration and restored, because a debug log written to `debugLogPath` inside the vault is a vault write that the C47 AC3 fingerprint would report as a mismatch. A run that cannot establish its borrow provisions nothing.
2. **The shared surface is established by the rig, not trusted, and it is narrowed rather than widened.** `sharedFolder` is provisioned to the rig-owned scratch folder WP47 already owns, so the run's scratch canvas is inside the shared surface **by construction** and nothing else in either vault is; `excludePatterns` is provisioned empty so no owner-side pattern can exclude the scratch folder from a surface that now contains only it. The rig states this positively in its run record — which folder is shared, in both vaults — rather than inferring it from a successful sync. The reason is data safety, not convenience: `isSharedPath` treats an **empty** `sharedFolder` as *the whole vault shared*, `resumeSession` publishes the host's manifest with `purge: true`, and the guest's `cleanupStaleFiles` **trashes every shared local file absent from that manifest** — so a run against an unconstrained shared surface can destroy the owner's files in the second vault. The two vaults' stored values have never been read and the rig must not assume they agree, are empty, or are equal to each other; it establishes the state and records what it established. C50 AC5 remains the independent detector, and satisfying it must require the instances' own view of what they share — never a read-back of the file this criterion wrote.
3. **The relay is built if needed, started, proven ready, and provably released — by the rig, on every exit path.** Its port is a new constant in `constants.py`, disjoint from `39421`/`39422` and `39431`/`39432`, mirrored into `T3_SharedContract.md`, and spelled as a literal nowhere else. Before start, an occupied port is a **named refusal**, never an adoption and never a kill: the rig may not attach to a relay it did not start — a stale relay carries a stale room and would let a run go green against a peer that is not there — and it may not terminate a process it did not start (D15/S2). The server build is verified present and current and is built with the terminating `tsc` build when it is not; there is no watch trap on this side, unlike C69's. Readiness is a **positive probe of `GET /healthz` reporting `ok`**, bounded, naming the awaited condition on expiry — never a sleep, and never the mere fact that a process was spawned. All three of the relay's cwd-relative LevelDB stores (`BLOB_STORE_PATH`, room persistence, audit log) are pointed at a run-scoped directory outside the repository and outside both vaults, and that directory is removed at teardown, so no run writes a store into the tree and no run inherits a previous run's rooms. Stop runs on success, failure, abort and interruption, and "stopped" means the **port no longer accepts a connection**, verified by a bounded probe — not that a terminate call returned. An orphaned listener at the end of a run is a failed run.
4. **The gate's start-up and teardown order is stated, enforced and recorded, not implied.** Start-up: the E2E-capable bundle is verified and installed (WP69) → the relay port is free → the relay is started and ready → the room is minted on that relay → **then** each vault is provisioned, with the room's own `id` and `token`, while its Obsidian instance is **not running** → then Obsidian is launched or attached (WP45) → then readiness and identity (WP46) → then the scratch canvas (WP47) → then the first matrix case (WP50). Teardown reverses it, and runs to completion even when a step fails. Provisioning into a vault whose plugin is already loaded is refused under the existing `RESTART_REQUIRED_OPERATOR` reason rather than performed: the settings are read once at load (`main.ts:408–417`), so a late write is not read — and worse, any later `saveSettings()` in that live instance writes its in-memory copy back over the rig's file, silently reverting the provisioning and corrupting the borrow the restore depends on. Each ordering constraint is enforced by the code, not only documented, and the run record states which steps ran in which order.
5. **A change made in vault A is demonstrated to reach vault B *through the relay*, and that demonstration is distinguishable from every other way the content could have arrived.** This is the single most important criterion in this work package: it is what converts the whole T3 layer from "two vaults ended up with the same file" into evidence about Canvas V2. It requires **two independent facts**, at least one of which is a fact about the relay or about a peer that is not connected: a **positive relay-side observation** that the run's canvas document carried traffic between two distinct clients in the rig's own room — the relay is hermetic and no other engine is connected to it, so its own accounting (`GET /healthz`'s document and client counts, and the frames its store retained for the room) is evidence no file-copying engine can manufacture — and a **negative control** in which the same gesture, performed while the relay-mediated path is provably not in place, does **not** produce the change in vault B within a window at least as long as the positive leg needed. Content appearing in vault B is **not** sufficient on its own and may not be recorded as satisfying this criterion. <!-- Updated: the second engine named here was wrong — lan-vault-sync is installed but NOT enabled; the enabled engine is obsidian-git, and its disposition is now a precondition rather than one of two choices, which strengthens rather than weakens this criterion 2026-08-04 --> **The second engine is `obsidian-git`** — enabled in both vaults, `autoPullOnBoot: true`, over dirty git working trees with `origin` remotes — and it can bring content into either vault by a path that has nothing to do with the relay. **`lan-vault-sync` is installed but NOT enabled and cannot run**; it is named here in that form only so it is not rediscovered. C50 AC5 now fixes `obsidian-git`'s disposition as a **precondition** (disabled for the run, restored afterwards, both recorded) rather than one of two permitted choices — and this criterion must hold **anyway**, because a precondition is a claim about what was configured and this criterion is a claim about what the relay observed. The two are independent on purpose: if satisfying this criterion required trusting that the disabling actually took effect, the disposition record would have become the evidence, which is exactly the substitution this criterion exists to refuse. A run in which the positive leg passes and the negative control also "passes" (the change appears anyway) is a **failed** run reported under a named reason, not a stronger result.

**Definition of Done:** the gate has a sync path the rig owns from the relay to the shared folder, and a green case can no longer mean that two vaults were never connected.

### Where each criterion is decided

- **AC1** and **AC2** are decided by the settings module's own standalone `python tools/test_<name>.py` script (workspace convention), run through `visible-console` `run_python` with an **absolute** path, against **temporary fixture vaults under `h:\tmp\`** — never against the owner's vaults. The byte-identity clause of AC1 is decided by comparing the provisioned output for the port-only case against the pre-change implementation's output over the same inputs.
- **AC3** is decided by the relay module's own standalone script: an occupied port produces the named refusal and no process; a started relay reaches `healthz`-ok; a stopped relay's port refuses a connection. It needs no vault and no Obsidian.
- **AC4** is decided partly structurally (the refusal when the target instance is running; the enforced sequence) and partly in the run record. The parts that require two real Obsidian windows are settled inside **WP7's run**, not here.
- **AC5** is the one criterion that **cannot** be fully settled by this WP: its positive leg requires two real instances, which is WP7's run. What this WP owns and must deliver is the *mechanism and its evidence channels* — the relay-side observation and the negative control — together with the refusal that fires when either is unavailable. The mechanism is exercised against the local relay and fake or single clients here; the two-instance demonstration is recorded by WP7. **This split is stated so that no one later reads a passing WP70 as evidence that propagation was ever observed.**

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Python is standard-library only. Node commands run from `server/` for the relay and never from the repo root (the store paths are cwd-relative). No Graphify graph exists (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map. **T3 host facts, given — do not re-derive:** Obsidian executable `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe`; vault registry `%APPDATA%\obsidian\obsidian.json` (read-only); vaults `H:\Developement\_NeuralAngels\ObsidianOrga` (role `a`) and `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (role `b`, **spaces in the path are load-bearing**); plugin id `live-share`, installed and enabled in both, **production** build in both until WP69 lands.
- **Known risks specific to this WP:**
  - **Two restore mechanisms over one file is the failure mode this charter exists to prevent.** WP44 already borrows `data.json`; a WP70 that borrows it again would produce two backups, two markers and a race whose loser silently writes the owner's settings back to a mid-run state. The mitigation is structural, not procedural: **there is exactly one borrow, and WP70 reaches it through one added argument.** If implementation appears to need a second capture, a second backup file, or a write to `data.json` from outside `ports.py`, that is an ESCALATE.
  - **The blast radius is the owner's second vault.** The `sharedFolder`-empty → whole-vault-shared → `purge: true` → `trashFile` path (`manifest.ts:422–450`, `main.ts:465–489`, `:523–540`) was traced in the current tree and is the reason AC2 exists. It has **not** been executed and is not a claim that data has been lost; it is a claim about what the code would do. Treat AC2 as a safety criterion, not a plumbing one.
  - **The relay port may be occupied by a previous crashed run.** Refusing is deliberate and is not laziness: adopting a listener the rig did not start means the run may drive a relay holding a *different* room, in which case both peers connect successfully to a place where they cannot meet, and the failure looks like a sync bug. Killing it violates D15. A named refusal with the port in the message is the only correct outcome.
  - **A relay that "started" is not a relay that is ready.** Node binds late; a spawn that returned tells you nothing. `healthz` is the process's own positive statement and is the only sanctioned readiness signal. This is *not* the pattern C69 rejected — C69 rejected polling a **file's** mtime as a proxy for a build's completion; polling an endpoint that answers only once the server is serving is a readiness probe, not a proxy.
  - **A stop that does not release the port poisons the next run.** Windows process termination is not graceful by default and the server's only shutdown channel is a signal. Whatever the implementation does, "stopped" must be established by probing the port, and a still-bound port at teardown must be a named failure rather than a warning.
  - **The room token is minted by the relay, not chosen.** `POST /rooms` returns `randomUUID()` and `nanoid(24)`; nothing can predict or dictate them. Any design that assumes a fixed room id, or that reuses a room id found in a vault, is wrong by construction against a freshly started relay.
  - <!-- Updated: CORRECTED — lan-vault-sync is installed but NOT enabled; the engine that can make the negative control fail is obsidian-git, and it can do so by a mechanism the original text did not anticipate 2026-08-04 --> **`obsidian-git` can make AC5's negative control fail — and `lan-vault-sync` cannot, because it is not enabled.** That is the point of the negative control: it is the only leg that can distinguish the engines. Note the *mechanism*, which differs from a file-copying sync engine: `obsidian-git`'s `autoPullOnBoot: true` fires at **launch**, so the content it brings in arrives at instance start-up rather than in response to the gesture — which means it can also make the **positive** leg look better than it is, and it can land content *before* the negative-control window opens. If the negative control shows the change arriving anyway, the run has learned something important and must report it — it must not be re-run until it passes, and it must not be recorded as green.
  - <!-- Updated: a control command the gate itself issues can destroy this WP's borrow; chartered as WP72 2026-08-04 --> **⚠ `canvas.setFlag` can destroy this WP's borrow, and AC4's warning did not reach it.** AC4 states that *"any later `saveSettings()` in that live instance writes its in-memory copy back over the rig's file, silently reverting the provisioning and corrupting the borrow the restore depends on"* — and attributes it to provisioning a vault whose plugin is already loaded. **There is a second source, and it is a command the gate itself issues mid-run:** `canvas.setFlag(name, value)` calls `plugin.saveSettings()` for any `name` that is an existing settings key, and every canvas-relevant key the gate cares about (`useCanvasBinding`, `showCanvasPresence`, `showCanvasCursors`, `sharedFolder`, `roomId`, `serverUrl`) is one. The consequence is this WP's restore failing and C50 AC6 / WP7 AC6 failing the run, with the cause looking like a WP44 restore bug. The repair is chartered as **WP72 / C72**; this WP does not fix it and its ACs are unchanged. Record the interaction in the report.
  - <!-- Updated: the rig has no launch backend, measured 2026-08-04 --> **The ordering AC4 enforces is executed by an agent, not by one process.** `lifecycle.py`'s only console backend is `PlanOnlyConsole` and there is no process spawn anywhere under `tools/obsidian_e2e/`; the gate run is agent-mediated (WP71 / C71). AC4 says each ordering constraint is **enforced by the code, not only documented** — that requirement is unchanged and becomes *more* important, not less: in a mediated run the ordering is the thing most easily lost, and an ordering that only the plan expresses is an ordering an agent can step around. Enforce it at the rig's own boundaries so a step arriving out of order is refused wherever it arrives from.
  - **The relay binds on all interfaces.** `server.listen(port)` is called without a host argument (`server/src/index.ts:236`), so a locally started relay is reachable from the network for the duration of the run. `server/` is off limits to this WP, so this is **recorded as a constraint, not repaired**; if it is unacceptable it is an ESCALATE and a `server/` change under a different WP.
  - **The guest's `cleanupStaleFiles` will trash rig-owned scratch artefacts** inside the shared folder that are absent from the manifest — including one left by a crashed earlier run. Under AC2's narrowed surface that is confined to `_e2e-rig`, which is rig-owned and disposable, and it interacts with WP47 AC4's stale-scratch reclaim. Note it in the report; do not "fix" it here.
- **Known flaky patterns:**
  - **No wall-clock sleeps anywhere** — not in the readiness path, not in the stop path, not in the AC5 windows. Every wait is a bounded poll of a condition that names itself on expiry (WP48 AC2, `WAIT_TIMEOUT`).
  - Do not use log strings as a primary oracle. For the relay, state — a bound port, a `healthz` body, a refused connection — is the oracle.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **External dependency risks:** no new runtime or dev dependency on either side. If one looks unavoidable, that is an ESCALATE, not a judgement call.
- **Hard constraints:**
  - `server/**` and `plugin/src/**` are untouched. `server/` source is an explicit §7 abort criterion outside WP41.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP70 holds no §7 licence of any class**; an unenumerated deletion or assertion rewrite is an abort criterion.
  - The marker's pinned field set and the restore path are not modified. If the implementation needs either, ESCALATE.
  - **Nothing in this charter may be reported as observed until it has run.** Everything above is read from source or measured as static state on 2026-08-02. The gate has never been executed: no relay has been started by any rig module, no settings beyond `e2eControlPort` have ever been provisioned, no control endpoint has answered on this host, and no propagation between the two vaults has been observed. Every statement about a run must be a statement about a run that actually happened.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `tools/obsidian_e2e/constants.py`
  - `tools/obsidian_e2e/ports.py`
  - `tools/obsidian_e2e/relay.py` (new)
  - `workflowArtifacts/canvas-v2/T3_SharedContract.md`
- **Required report:** `ImplementationReport_WP70.md` (in `workflowArtifacts/canvas-v2/`), containing: the pinned relay port and the demonstration that it is disjoint from all four existing ports; the provisioned key set exactly as pinned, with the statement that no credential key is read or written and no value from `data.json` appears anywhere in the report; the evidence that the port-only provisioning output is byte-identical to the pre-change implementation's; the run-scoped store directory's location and its removal; the enforced start-up and teardown order as implemented; the AC5 evidence channels as built, with an explicit statement of which legs have and have not been exercised; and an explicit statement of what has **not** been executed — in particular that no two-instance propagation has been observed.
- **BUILD_SPEC updates required:** no — C70, the §9 row and the count amendment are already written. If implementation invalidates an architecture decision, ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`, attributed against whatever batch is concurrently live. The server suite unchanged (no `server/` file is touched). The standalone `python tools/test_<name>.py` scripts for the settings and relay modules pass, launched through `visible-console` `run_python` with an absolute path, against fixture vaults under `h:\tmp\` and against the local relay only.

---

## 7. Visible Test Cases / Producer Artifacts

*Empty — filled by Worker 3's producer sub-agent. Worker 2 does not generate tests.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.* AC1–AC3 are settled by the two modules' standalone Python scripts against fixture vaults and the local relay; AC4 is settled structurally plus in the run record. **AC5's positive leg cannot be settled by this WP at all** — it needs two real Obsidian instances, which is WP7's run. That is recorded here rather than deferred to Worker 4 so that a passing WP70 is never read as evidence that propagation was observed.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
