# Task Charter — WP79: a shared folder mirrors completely, canvases included

<!-- Updated: chartered 2026-08-05 from the FIRST REAL RUN finding in DISPATCHER_STATE.md, re-verified against the current tree on branch `fix-bugs-and-raceconditions` per hard-won rule 12. The reported cycle HOLDS and its consequence is confirmed, but the trace was INCOMPLETE in a way that changes the repair: the one manifest-driven canvas-subscribe loop that exists (`main.ts:858-877`) reads a manifest that is NULL at the moment it runs, in every session and for both roles, because `connectSync()` is awaited BEFORE `manifestManager.connect(...)` at all four session entry points. See §3 Verification 3. Every line number below was measured by reading the current tree. No Obsidian was launched, no vault file was read, no `data.json` was opened, no relay was contacted, and the smoke-setup script was not run. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP79
**Phase:** P2
**task_mode:** `standard`
**Depends on:** WP7 (`DONE`), WP25 (`DONE`), WP27 (`DONE`), WP29 (`DONE`)
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** a guest that joins a session receives **every** `.canvas` in the shared folder, not only the ones it already had. Today it receives none it does not already have, and there is no command, menu item or setting that shares one afterwards — the path does not exist, so the missing affordance is not a UI gap but a structural one. After this WP a shared folder mirrors **completely** on a guest, the mirrored file is produced by the **same canonical projection the host writes with** (`serializeCanvas`, `files/canvas-sync.ts:971`) so both sides agree byte-for-byte by construction rather than by comparison, and the mirror is **create-only**: it never overwrites, truncates, renames or trashes a `.canvas` the guest already has.
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 9, work package **WP79**; section 4.5 invariants **I3 DOC IS TRUTH**, **I9 HISTORY IS THE TRUTH** and **I11 REFUSAL NEVER DESTROYS**; section 4.7 (the doc→disk arm of the data flow). Phase **P2**.
- **Owner's ruling, settled — this charter does not re-open it:** *"auf dem Gast system [soll] ein kompletter Ordner gespiegelt werden mit Canvas — es gibt ja nicht mal eine Option den Canvas nachträglich zu sharen."*

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify + create, **one repository** (`obsidian-live-share`, branch `fix-bugs-and-raceconditions`), **`plugin/src/` only**.
  - Responsibility: give the manifest's canvas entries a **materialisation path that does not require the file to already exist**, without putting a second CRDT, a second serialiser or a second disk writer on a path `CanvasSync` and `CanvasPersistence` already own.
  - Scope summary: one **pure decision core** (zero imports, in the precedent of `files/canvas-seed-decision.ts`) that answers, per shared canvas path and per role, whether that path is to be published, materialised or left alone; one **headless wiring module** that drives it over the manifest's canvas entries and is called from `main.ts` at the five sites enumerated in §3 Verification 4 — `main.ts` gains **calls only**, never a conditional over canvas state (§7 abort criterion, §3.1 S11); and the file write itself performed by the **existing single writer** and by nothing else.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠ Removing, weakening, narrowing or bypassing either `.canvas` skip.** `skipsAutoTextSync` (`utils.ts:229-300`) and both of its consulting sites — `background-sync.ts:97` and `manifest.ts:203` — stay **byte-unchanged**, and no call site of the predicate is removed. The predicate's own docstring states the reason: without it a shared canvas *also* gets a bare-path raw `Y.Text` of the same bytes, a second CRDT over a path `CanvasSync` already owns, *"whose character-level merge destroys edge endpoints."* That is the data-loss class this whole redesign exists to eliminate. **A WP79 that closes the gap by deleting a skip is wrong and is to be rejected on sight, however green its tests are.**
  - **⚠ Installing the R10 raw-text fallback for a canvas this WP merely mirrors.** `subscribeCanvasWithHandover` (`files/vault-events.ts:101-116`) calls `backgroundSync.subscribe(path)` whenever `canvasSync.subscribe` did not take ownership, and `BackgroundSync`'s guest branch then materialises the file from a bare-path `Y.Text`. Reusing that helper across a whole shared folder would install the forbidden second CRDT on **every** canvas whose guid the guest cannot resolve — the deleted-skip failure, arrived at from the other side. In WP79's pass an unresolvable identity is a **skip**, never a fallback. The fallback stays exactly as it is for the two existing call sites.
  - **Re-gating the host seed in `CanvasSync.subscribe` (`canvas-sync.ts:2501-2521`).** See the §7 disposition below: it is the right question, it is **not WP79's**, and taking it would require a §7 amendment licence against two inherited WP29 tests. **Carried up as S21, not fixed.**
  - **A fourth `ColdOpenResult`, or any change to `coldOpen`'s three outcomes, its branch order or its `after waitForSync / before start()` placement.** C29 AC4 pins all of it. WP79 decides *whether a path is materialised at all*; it does not teach `coldOpen` a new answer.
  - **A second serialiser.** `buildCanvasData` / `serializeCanvas` (`canvas-sync.ts:918`, `:971`) are the one definer. The epoch archive already re-uses them for exactly this reason (`canvas-sync.ts:2160-2166`: *"the SAME single projection `CanvasPersistence` writes with — an archive produced by a second serializer could agree with a broken one"*). WP79 inherits that argument verbatim.
  - **A second CRDT→disk writer.** `CanvasPersistence` remains the single writer (§4.5, C7). WP79 adds no `vault.create` / `adapter.write` / `vault.modify` call for a `.canvas` path anywhere.
  - **`useCanvasBinding`, `CanvasBinding`, `captureLocal`, `canvas-binding.ts`, `canvas-model-bridge.ts`.** The flag is `false` (`types.ts:65`) and is frozen there until P5 (WP39/WP40); flipping it is a §7 abort criterion. The live capture path is `handleLocalModify`; card text is a whole-string LWW register until P4 (WP36–38). **No criterion here depends on any unbuilt phase**, and none may.
  - **`server/**`.** Untouched — a `server/` edit outside WP41 is a §7 abort criterion.
  - **The relay, the sidecar format, the manifest schema, the wire protocol.** No new field, no new frame, no new manifest key. The identity WP79 consumes (`FileEntry.guid`, `manifest.ts:27-34`) already exists and is already published.
  - **Presence, cursors, the open-view reconcile.** A materialised canvas that nobody has open needs no view work.
  - **The prefix-match suspicion in `isSharedPath`.** **SETTLED, not deferred** — see §3 Verification 5. It does not hold, and nothing is owed.
- **Known interfaces / dependencies:**
  - Input: `ManifestManager.getEntries()` (`manifest.ts:417-420`), `ManifestManager.getCanvasGuid` (`:364`), `CanvasSync.subscribe` (`canvas-sync.ts:2374`), `CanvasSync.getCanvasDocHandle`, `attachCanvasPersistence` (`canvas-persistence.ts:~692-708`), `serializeCanvas` (`canvas-sync.ts:971`)
  - Output: one pure decision core; one headless wiring module; call sites in `main.ts`; **zero** new production disk writers
  - Depends on: **WP7** (the single writer and the `coldOpen` ordering), **WP25** (the sidecar the identity store scans), **WP27** (guid identity and the guest's refusal to mint), **WP29** (the seed decision) — all four `DONE`. Nothing planned is a prerequisite.
  - **Blocks nothing.** It is product scope, off the WP7 gate's critical path, and touches no file WP50/WP71/WP74/WP75/WP76/WP77/WP78 own (those are in `tools/obsidian_e2e/`, the AgenticWorkspace-side driver, or `plugin/src/testing/`). File overlap with every in-flight gate WP: **zero**.

### §7 disposition — no `DONE` work package is re-opened, and no §7 licence of any class is taken

Stated explicitly because the brief requires it not be left implicit. Each clause is measured, not argued.

1. **No C7, C25, C27 or C29 acceptance criterion is restated, weakened or re-verified.** C7 keeps its single writer and its ordering; C25 keeps load-before-sync; C27 keeps guid identity, the guest's refusal to mint and the four `getDoc` guards; C29 keeps its two witnesses, its three `ColdOpenResult` values and its branch order. WP79 changes **which paths reach those mechanisms**, never what any of them does when reached.
2. **No existing test is deleted, weakened, retitled, skipped or amended.** WP79 holds **no §7 licence of any class**, and an unenumerated deletion or assertion rewrite is an abort criterion exactly as it is for every other WP.
3. **`main.ts` gains wiring only.** §3.1 S11 and the §7 abort criterion are absolute: every decision lives in a headless module and `main.ts` may only construct, inject and forward. A conditional over canvas state written inside `main.ts` is an abort, not a shortcut. The precedent is `wireCanvasSidecar` (`files/canvas-sidecar-lifecycle.ts:459-487`), which exists for exactly this reason and says so in its own docstring.
4. **The one place where re-opening would be tempting is named and refused.** Gating the host seed at `canvas-sync.ts:2501-2521` by `decideSeed` would make C29 AC1 true at the *second* file→doc boundary, where today it is enforced only in `coldOpen` (`canvas-persistence.ts:504`). It is a real gap and it is written up as **S21**. It is **not taken here**, for a reason that is measured rather than preferred: two inherited WP29 tests pin the host seed as *running* on `subscribe(path, "host")` and assert its upsert outcome — `v2/wp29/test_tp04_host_seed_retains_records_absent_from_file_visible.test.ts` and `v2/wp29/test_tp05_host_rejoin_older_file_keeps_peer_records_visible.test.ts`, whose own header states that the host's upsert of keys it *does* mention is *"WP18's upsert boundary … deliberately unchanged by WP29"*. Gating the seed reddens them. Reddening an inherited assertion requires a §7 amendment licence, and **Worker 2 does not assume a licence**. WP79 therefore leaves that boundary exactly as it is and confines itself to not making it worse — see the amplification note in §5.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** the manifest→canvas entry path. One pure core, one wiring module, five call sites.
- **Interfaces involved:**
  - Input: the manifest's canvas entries, their published guid, the local file's existence, and (post-sync) whether the doc holds records
  - Output: one of a small closed set of verdicts per path, and — for exactly one of them — a file produced by the existing writer through the existing projection

### Verified against the current tree (rule 12), 2026-08-05 — measured, given, do not re-derive

**Verification 1 — the two skips are real, correct, and stay.**

| site | what is there |
|---|---|
| `files/background-sync.ts:97` | `if (skipsAutoTextSync(path)) continue;` inside `startAll`'s manifest replay — the guest never subscribes a canvas from the manifest by the raw-text route |
| `files/manifest.ts:203` | `if (!entry.binary && skipsAutoTextSync(path)) continue;` in `syncFromManifest`'s text branch, whose comment (`:186-202`) names `CanvasPersistence.coldOpen` as the materialiser and states that without the skip the branch *"would create or overwrite the user's canvas EMPTY"* |
| `utils.ts:229-300` | the predicate itself, whose clause-1 docstring is the reason both skips exist: a second CRDT over a path `CanvasSync` owns, *"whose character-level merge destroys edge endpoints"* |

**Verification 2 — the materialiser really does require an open file, so the cycle closes.**
`CanvasPersistence` is constructed only by `attachCanvasWriter` (`main.ts:1365-1407`), which is reached from exactly **two** sites, both of which run `subscribeCanvasWithHandover` first: `main.ts:874` and `main.ts:1035`. `coldOpen` (`canvas-persistence.ts:473`) is called only by `attachCanvasPersistence`. So the file is materialised only if the path is subscribed, and — before this WP — a path is subscribed only from those two sites.

**Verification 3 — NEW, and it is the fact that changes the repair. The manifest-driven site is structurally dead.**

`main.ts:858-877` is the only production code that iterates the manifest looking for canvases:

```text
main.ts:858   const entries = this.manifestManager.getEntries();
main.ts:860   for (const [path] of entries) {
main.ts:861     if (isTextFile(path) && path.endsWith(".canvas")) {   ← subscribes, then attaches the writer
```

It lives inside `connectSync()` (`main.ts:735`). **`connectSync()` is awaited before `manifestManager.connect(...)` at every session entry point** — `resumeSession` `:488`/`:489`, `startSession` `:618`/`:619`, `joinSession` `:649`/`:650`, `joinWithInvite` `:682`/`:683`. `ManifestManager.connect` (`manifest.ts:74-80`) is what assigns `this.manifest`, and `getEntries()` (`manifest.ts:417-420`) is `if (!this.manifest) return new Map();`. `cleanupSession()` calls `manifestManager.destroy()` (`main.ts:588`), which nulls it again, so the state is the same on every subsequent session.

**Therefore the loop iterates zero entries, in every session, for both roles.** Not usually, not on a race — always. The only surviving subscriber is the lazy one at `main.ts:1017-1037`, which walks the **open canvas leaves**, and a leaf cannot exist for a file that is not on disk. That is why the guest's canvas never arrived, and it is also why the **host's** guid is minted only for canvases the host happens to open: `resolveGuidForSubscribe` (`canvas-sync.ts:2090-2126`) is the only site that mints and binds, and it runs only inside `subscribe`.

**This is load-bearing for the design, not a curiosity.** A repair that only "revives" the loop by moving it after `manifestManager.connect(...)` would satisfy the guest half by accident and would silently widen the host seed to every shared canvas (see §5). The verdict has to be taken deliberately, per role, by a core that can be tested.

**Verification 4 — the five entry points, measured, with what each one does today.**

| # | Entry point | Site | Canvas materialisation today |
|---|---|---|---|
| 1 | **join** | `joinSession` `:636-668` and `joinWithInvite` `:672-701` → `connectSync` → `manifestManager.connect` → `cleanupStaleFiles` → `syncFromManifest` → `startAll("guest")` | **none** — the loop saw an empty manifest, `syncFromManifest` skipped the canvas, `startAll` skipped it |
| 2 | **rejoin / resume** | `resumeSession` `:485-508` (plugin load with a live session), same order | **none**, same three reasons |
| 3 | **reconnect** | `demoteToGuest` `:1797-1815` and the manifest-change handler `main.ts:181-306` (`syncFromManifest({skipText:true})` at `:273`, then `backgroundSync.onFileAdded` at `:282`) | **none** — and this is also the mid-session case: a canvas the host creates during the session reaches the guest's manifest and is then skipped by both consumers |
| 4 | **reload-from-host** | `reloadFromHost` `:1817-1826`, the user command at `session/commands.ts:129` | **none** — it calls `syncFromManifest` and nothing else |
| 5 | on open (not an entry point, listed for completeness) | `syncCanvasPresences` `:1017-1037` | the **only** path that works, and it needs the file to exist |

**Verification 5 — the suspected `isSharedPath` prefix match does NOT hold. Settled, nothing owed.**
`manifest.ts:443-449` builds `folder` from `normalizePath(sharedFolder + "/")` and tests `path.startsWith(folder)`. The suspicion was that Obsidian's `normalizePath` strips the trailing slash, making `_liveshare-testing/secret.md` count as inside `_liveshare-test`. **The `normalizePath` in scope is not Obsidian's.** `manifest.ts:6-17` imports it from `"../utils"`, and `utils.ts:38-40` is `filePath.replace(/\\/g, "/")` — backslashes only, no trailing-slash handling; `utils.ts:1` imports only `Platform, TFile, TFolder, Vault` from `"obsidian"`. So `folder` is `"_liveshare-test/"`, `"_liveshare-testing/secret.md".startsWith("_liveshare-test/")` is `false`, and the `|| path === normalizePath(sharedFolder)` arm is an exact match. **No confidentiality bug, no charter owed.** Recorded here because the Dispatcher asked for it to be settled if the trace reached it.

### The mechanism this WP is allowed to use, stated so the implementor does not invent a second one

Everything needed already exists and is landed. The guest's file must come from the doc, and the doc→file projection has exactly one definer:

```text
canvas-sync.ts:918   buildCanvasData(nodes, edges, deleted?)   ← the one snapshot builder
canvas-sync.ts:971   serializeCanvas(...)                      ← JSON.stringify of that snapshot, tab-indented
canvas-persistence.ts:324                                      ← the single writer's only call to it
canvas-sync.ts:2205                                            ← the epoch archive re-using it, for this exact reason
```

The write is `CanvasPersistence`'s and stays `CanvasPersistence`'s: its `flushToDisk` → `writeSnapshot` → `io.write` path (`canvas-persistence.ts:314-330`, `:396-423`, `:664-675`) already creates a missing file, already runs `isPathSafe` and `ensureFolder`, already mutes its own echo and already feeds `onWritten` back into `CanvasSync`. **WP79 needs no new write primitive, and adding one is an abort.**

- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I3 DOC IS TRUTH / single writer.** `CanvasPersistence` stays the only CRDT→disk writer for a `.canvas`; `CanvasPersistence` still emits zero CRDT writes.
  - **I9 HISTORY IS THE TRUTH.** Materialising a file is a doc→file act and must never count as a seed. The guest must not mint a guid (`canvas-sync.ts:2098-2100`, `:2119`), must not create a second doc for a path a peer already holds, and the file it writes must never become the input of a later seed.
  - **I11 REFUSAL NEVER DESTROYS.** Nothing this WP adds may remove or shorten a user file as a consequence of a decision not to admit something. **Do not lean on the refusal ledger:** `SeedRefusalLedger` is per-session and in-memory (`canvas-sync.ts:1313-1321`, `:1842`) and the project has a **confirmed live P0** — its protection expires with the session, and the next cold open's doc-wins branch flushes over the file. WP79's non-destructiveness has to hold **without** it.
  - **C29 AC4** — `coldOpen` keeps exactly three outcomes, in the same order, at the same point in the lifecycle.
  - **C27** — the doc id is `__canvas__:<guid>`; the path is an attribute. A path-derived doc id is the no-identity-store fallback and is not to be re-introduced.
  - **`useCanvasBinding` stays `false`.** No criterion depends on P4 or P5 behaviour.
  - **Data safety.** No file in either owner vault is read, opened, hashed into an artefact or pointed at by any test. Every fixture is synthetic and in-memory or under `tmp_path`. Naming a settings **key** is permitted; naming a **value** is not, and no value appears in this charter, in any test this WP produces, or in any artefact it writes. **No secret through an agent tool**, in any command string, script argument, test name or commit message.
  - **No Obsidian is launched, no vault is touched, `H:\tmp\liveshare_smoke_setup.py` is not run** by this WP or by anything it produces.
- **Technology / framework / config constraints:**
  - TypeScript, `plugin/` workspace, Vitest 4.0.18, pure-function + injected-seam style. **Zero new runtime dependencies** (D11); a new dependency is an ESCALATE.
  - The decision core takes the impure world by argument, in the precedent of `files/canvas-seed-decision.ts` (*"A pure core … ZERO imports. No Obsidian, no filesystem, no clock, no Yjs"*).
  - **Schema impact:** none.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Entry points / relevant files:**
  - `plugin/src/main.ts` — **wiring only**: the dead loop at `:858-877`, and the four session entry points at `:485-508`, `:608-633`, `:636-668`, `:672-701`, plus the manifest-change handler `:181-306` and `reloadFromHost` `:1817-1826`
  - `plugin/src/files/` — the new pure core and the new wiring module live here, beside `canvas-seed-decision.ts` and `canvas-sidecar-lifecycle.ts`
  - Read-only context, not modified: `utils.ts:229-300`, `files/background-sync.ts:97`, `files/manifest.ts:203`, `files/vault-events.ts:101-116`, `files/canvas-sync.ts:2374-2521` and `:918-975`, `files/canvas-persistence.ts:473-517`
- **Files this WP may NOT touch:** `plugin/src/utils.ts`, `plugin/src/files/background-sync.ts`, `plugin/src/files/manifest.ts` (the `syncFromManifest` skip and `isSharedPath`), `plugin/src/canvas/canvas-binding.ts`, `plugin/src/canvas/canvas-model-bridge.ts`, `plugin/src/types.ts` (the flag), everything under `server/`, and `CanvasSync.subscribe`'s host-seed block (`canvas-sync.ts:2501-2521`). **If the repair appears to require reaching into any of these, that is an ESCALATE, not a judgement call.**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

### The ruling: EAGER, and the reason is that the lazy alternative does not exist

**Decision: materialise every shared canvas the guest lacks, at each of the four entry points — eagerly.**

The lazy design would be *"place a trigger and materialise on first open"*. **There is no such trigger.** The only user act that could carry it is opening the file, and Obsidian cannot open a file that is not on disk — that is the cycle itself (§3 Verification 2). Every other candidate is not a user act on the missing file: a manifest change is the host's act, an explorer click needs an entry, and the quick switcher indexes files that exist. The only way to make "open" available is to write a **placeholder** first, and a placeholder is an empty or near-empty `.canvas` that a later reconcile can win with — precisely how the E2 cascade destroyed user data, and precisely what `manifest.ts:186-202` refuses to do today in as many words. So the comparison is **not** "eager is complete, lazy is cheaper": lazy is **unavailable** without re-introducing the defect class this initiative exists to remove.

**What eager costs, stated rather than glossed.** One `getDoc` + one `waitForSync` + one sidecar attach per shared canvas the guest lacks, at join, where today there are zero; on a vault with many canvases that is N concurrent doc subscriptions and N relay round-trips at the least convenient moment. Two consequences follow and both are criteria, not advice: the pass must **not block** the join (a slow or failing canvas degrades that canvas only — I5), and it must **not** subscribe a canvas the guest already has on disk, because that one needs nothing from this WP and paying for it is pure cost. That second rule is also what makes the pass non-destructive by construction: the only paths it touches are paths where there is no user file to destroy.

**What the owner asked for is what this delivers.** "The whole folder is mirrored" is satisfied literally for every canvas that has content; the one honest exception is named in AC4 and is a refusal to write, never a silent partial.

---

## 4. Acceptance Criteria

*Each criterion is followed by the statement of what would make it vacuous. This run has found ten-plus instances of a green test that cannot fail; a criterion that does not name its own vacuity risk is incomplete.*

1. **The verdict is taken by a pure core, it is a closed set, and it is fail-closed.** A dependency-free function — no Obsidian, no filesystem, no clock, no Yjs — answers, for one canvas path, exactly one verdict from a closed set covering at least: *publish* (host: this client owns the file and the identity must exist for peers to resolve), *materialise* (guest: no local file, an identity resolves, and the doc holds records), *skip — local file present* (a `.canvas` exists at that path; **no write of any kind is licensed, not even a byte-identical one**), *skip — no source* (no resolvable identity, or the doc holds no records). Every input that is missing, `undefined`, `null` or non-boolean yields a **skip**, never a materialise — the `!== false` discipline `decideSeed` already states in its own header (*"a knowledge probe that cannot answer … is not evidence"*). The core is exported, has no state between calls, does not mutate its argument and never throws.
   - **Vacuous if:** the test exercises the *materialise* row and treats the rest as obvious. The truth table is asserted **row by row, including every unknown-input row**, because a guard that is right on three rows of four is exactly how R4 was re-armed once already. A test that passes when one conjunct is deleted has not tested a conjunction.

2. **The mirrored file is produced by the one existing projection and the one existing writer, and by nothing else.** The bytes a guest receives are `serializeCanvas(nodes, edges, deleted)` — the same function `CanvasPersistence` calls at `canvas-persistence.ts:324` — applied to the same doc the host holds, so byte-agreement is a consequence of using one definer rather than a property to be compared. **WP79 introduces no second serialiser, no second CRDT→disk writer and no `Y.Text` anywhere on this path**; `skipsAutoTextSync` is byte-unchanged and every one of its call sites survives; and the R10 raw-text fallback is **not** installed for any path this pass handles. A materialised file is byte-identical to what the host's own writer would have produced from the same doc state.
   - **Vacuous if:** — **and this is the failure mode the brief names by hand, so it is written out.** *"The guest has the file"* passes trivially when the fixture pre-created it, when the test's own helper wrote it, or when a stray fallback wrote it from a `Y.Text`. **A positive control is mandatory and is part of this criterion:** the file is asserted **absent** immediately before the pass; the write is attributed to the mechanism under test by a receipt the mechanism itself emits (which path, which writer, which projection); the bytes are asserted to **change** when the doc changes, so the oracle cannot be satisfied by a constant; and the same fixture run with the pass disabled through its injected seam leaves the file **absent**. A byte-comparison against a second serialiser written for the test is **not** evidence — it is the failure C28's archive argument names, reproduced in the oracle.

3. **Seed-once (I9) and identity are answered separately for join, rejoin, reconnect and reload-from-host, and materialisation is never a seed at any of them.** For each of the four entry points, asserted individually rather than by one representative: the guest **never mints** a guid (an unresolvable identity is a skip, and `resolveGuidForSubscribe`'s guest branch is unchanged); no second doc is created for a path a peer already holds; the pass writes **no** CRDT delta of its own; and the file a materialisation writes is **never** read back as a seed — a later `coldOpen` on that path takes the doc-wins branch, never `seeded-from-file`. `coldOpen` keeps its three outcomes and its position.
   - **Vacuous if:** one entry point is exercised and the other three are asserted by argument. They differ in the state they start from — rejoin arrives with a sidecar replica, reconnect arrives mid-session with a live doc, reload-from-host is a user command over an already-converged session — and *"the same function is called"* is a claim about the code, not about the state it meets. Equally vacuous: asserting *"no re-seed happened"* without showing the assertion goes **red** when a re-seed is injected. An absence assertion with no positive control is not evidence.

4. **Nothing this WP adds ever destroys, and an empty doc produces no file.** Under every entry point, and including a guest whose local `.canvas` has **diverged** from the host's: an existing file is not overwritten, not truncated, not renamed, not trashed and not written to at all — its bytes are compared before and after and are identical. This holds **without** relying on the seed-refusal withhold, which is per-session and in-memory and whose protection is a confirmed live P0 across a restart. A doc holding **no records** materialises **no file** — never an empty or skeleton `.canvas` — because an empty file that then wins a reconcile is exactly how the E2 cascade destroyed user data; the refusal is observable rather than a silent no-op.
   - **Vacuous if:** the collision fixture's "existing" file happens to equal the projection, in which case *"unchanged"* is satisfied by an overwrite. The pre-existing file must **differ** from what the doc would produce, and the assertion must be over its **bytes**, not its parse. Equally vacuous: an empty-doc test whose doc is empty for the wrong reason (never populated, wrong doc id, wrong map names) — the same fixture must be shown to produce a file once one record is added, or "no file" is just "no mechanism".

5. **The mirror is complete, counted, and falsifiable — headless, with no Obsidian, no vault and no relay.** Over a shared folder containing **N > 1** canvases that the guest lacks and whose docs hold records, the pass yields **N** files, each byte-equal to the host's projection of the same doc; a canvas that must be skipped is skipped **by its own named verdict** and is reported, not dropped silently; and a canvas that fails to materialise degrades that canvas alone — the join completes and the other N−1 still arrive (I5). The whole verification runs in-process against fakes and synthetic docs. Each criterion is falsified separately, one injection at a time, each recorded as *not a pass* under the repaired code: **(i)** disable the pass at its seam → AC2 and AC5 go red and the file stays absent; **(ii)** make the core answer *materialise* for a path whose file exists → AC4 goes red **on the byte comparison**, naming the path; **(iii)** empty the doc → AC4's no-empty-file row goes red if any file is written; **(iv)** rename the symbol the completeness count looks for → the **positive control** goes red, proving the count sees what it claims to see rather than passing on an empty lookup.
   - **Vacuous if:** N = 1, which cannot distinguish "the mechanism mirrors a folder" from "the mechanism handled the one path the test named"; or if injection (iv) is omitted, which is the specific vacuity the Dispatcher named — a count of zero satisfies *"every canvas that should have arrived, arrived"*. An implementation report carrying (i)–(iii) without (iv) is incomplete, not partial.

**Definition of Done:** a guest that joins a session ends up with every `.canvas` in the shared folder that has content, produced by the host's own projection, and with every `.canvas` it already had **untouched**.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host. Run tests from the workspace root, never from a subdirectory; long-running invocations through `visible-console` `run_python`/`run_command` with absolute paths, never a Bash background process. No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map. **The two owner vaults are off limits for this WP**: nothing is launched, installed, restored or read.

- **Known risks specific to this WP:**
  - **⚠ The most likely wrong implementation is deleting a skip.** *"The guest never subscribes a canvas from the manifest"* reads like an instruction to stop skipping. It makes the symptom disappear, makes the diff smaller, and re-introduces a raw `Y.Text` over a path `CanvasSync` owns — the character-level merge that destroys edge endpoints. **If the diff touches `utils.ts`, `background-sync.ts:97` or `manifest.ts:203`, the WP is wrong.**
  - **⚠ The second most likely is reaching the same place through `subscribeCanvasWithHandover`.** Its unowned branch installs the raw-text fallback (`vault-events.ts:113-114`). Used across a folder it mass-installs the second CRDT for every canvas whose guid does not resolve — the deleted-skip failure with a different diff. **An unresolvable identity is a skip.**
  - **⚠ The third is "just move the loop".** `main.ts:858-877` is dead because of an ordering bug (§3 Verification 3), and moving it after `manifestManager.connect(...)` makes canvases mirror. It also puts the verdict back inside `main.ts` (a §7 abort criterion), skips no canvas the guest already has, and silently widens the host seed — see the amplification note below. **The revival is a consequence of the repair, not the repair.**
  - **⚠ AMPLIFICATION, named because it is the one genuinely new hazard.** The host seed at `canvas-sync.ts:2501-2521` runs on **every** `subscribe(path, "host")` with no `decideSeed` gate; today that is only canvases the host opens, and after WP79 it is every shared canvas at session start. The class is **bounded and already ruled on by this project**: since WP29 AC2 the seed is upsert-only at the record level, so no record is ever removed — WP29's own test header calls the residue *"a stale key value … a visible, self-correcting staleness, whereas a removed record is silent, shared and permanent."* WP79 therefore may **not** make it worse, and the pass must be shown not to create a new route to record loss. Closing the gap properly is **S21**, and it is not WP79's (§7 disposition, clause 4).
  - **⚠ Do not treat the withhold as protection.** I11's refusal ledger is per-session and in-memory; its protection expires with the session and the record is deleted on the next cold open. That is a confirmed live P0 with no owner. **AC4 must hold with the withhold assumed absent.**
  - **⚠ Do not assume the unbuilt phases.** `useCanvasBinding` is `false` and frozen until P5; the live capture path is `handleLocalModify`; card text is a whole-string LWW register until P4. A criterion that would only pass once P4 or P5 lands is a criterion this WP cannot discharge.
  - **⚠ Do not mirror any test suite into `plugin/src/__tests__/` before this WP is implemented.** `tsc` typechecks `src/` including tests, so an unimplemented mirrored suite breaks `npm run build` repo-wide for every other WP. This has been violated once already in this run.
  - **⚠ No statement about a live Obsidian instance, a real vault or a gate result may appear in any artefact of this WP.** The finding that produced this charter came from a human-observed smoke test; **the repair is verified headless**, and the smoke test is not re-run to confirm it.

### Recorded, not repaired — this WP's own sweep

*None of the following is in WP79's scope. Each is recorded so it is not rediscovered as a finding, with its owner named where one exists.*

- **S21 — C29 AC1 is enforced at only one of the two file→doc boundaries.** `decideSeed` gates `coldOpen` (`canvas-persistence.ts:504`); the host seed in `CanvasSync.subscribe` (`canvas-sync.ts:2501-2521`) takes no such gate, although both witnesses are already measured a few lines above it (`:2473-2478`). It is non-destructive at the record level (WP29 AC2) and therefore not a data-loss defect, but a rejoining host's stale file does upsert key values over an already-living doc, which C30 AC1 says only the import command may do. **Closing it reddens two inherited WP29 tests and so requires a §7 amendment licence.** **Owner: none assigned; needs its own charter and a Dispatcher ruling on the licence.**
- **S22 — the manifest-driven canvas loop at `main.ts:858-877` has never run.** It has been dead since it was written, for both roles, in every session (§3 Verification 3). Recorded separately from the repair because it means **no production evidence exists** for anything downstream of it: the host's guid minting, the writer attach and the `coldOpen` doc-wins branch have only ever been reached through the on-open path. A reader who assumes the manifest path has been exercised will over-trust it. **Owner: WP79 by consequence; recorded so the assumption is not inherited.**
- **S23 — `plugin/manifest.json` is a broken symlink (git mode `120000` → a path on the original author's Linux machine), so the repo cannot produce an installable plugin folder.** Unrelated to this WP and untouched by it; already recorded in `DISPATCHER_STATE.md`. **Owner: none assigned.**
- **S24 — the `isSharedPath` prefix-match suspicion is CLOSED, negative.** Settled in §3 Verification 5 against the current tree: the `normalizePath` in scope is the plugin's own (`utils.ts:38`), not Obsidian's, so the trailing slash survives and a sibling folder whose name extends the shared folder's is **not** treated as shared. **No work is owed.** Recorded so the suspicion is not re-opened by the next reader of `DISPATCHER_STATE.md`.

- **Known flaky patterns:**
  - No wall-clock sleeps. Every wait is bounded and names the condition it was waiting for on expiry.
  - Do not assert on log strings as the primary oracle; state is the oracle. (A receipt asserted **in addition** to state is fine and AC2 requires one.)
  - A test that asserts an absence is suspect by default. Ask what it would take for it to fail, and write that down.
- **External dependency risks:** none permitted (D11). A new runtime dependency is an ESCALATE.
- **Hard constraints:**
  - **Neither `.canvas` skip is removed, weakened or bypassed**, and `utils.ts`, `background-sync.ts` and `manifest.ts` are not modified.
  - **No second serialiser, no second CRDT→disk writer, no `Y.Text` on the canvas path.**
  - **The R10 raw-text fallback is not installed for any path this pass handles.**
  - **Create-only:** an existing `.canvas` is never written to, in any branch, under any entry point.
  - **An empty doc materialises no file.**
  - **`main.ts` gains calls only** — no conditional over canvas state (§7 abort criterion).
  - **`coldOpen` keeps three outcomes, one order, one position.** No fourth value.
  - **The guest never mints a guid.**
  - **No `DONE` work package is re-opened; WP79 holds no §7 licence of any class.** An unenumerated deletion or assertion rewrite is an abort criterion.
  - **No `server/**` edit; `useCanvasBinding` is not flipped; the plugin version is not bumped.**
  - **No owner-vault file is read, hashed, fixtured or named by value; no secret through an agent tool.**

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/` — the new pure decision core and the new headless wiring module (this repo, branch `fix-bugs-and-raceconditions`)
  - `plugin/src/main.ts` — **wiring only**, at the sites enumerated in §3 Verification 4
- **Already landed by Worker 2 with this charter — NOT implementor work:** the §9 WP79 row, the §7 Definition-of-Done count and the header count (78 → 79), re-derived from §7 and §9 rather than edited independently. The implementor does not edit `BUILD_SPEC_CanvasV2.md`.
- **Required report:** `ImplementationReport_WP79.md` (in `workflowArtifacts/canvas-v2/`), which must additionally record: the **verdict truth table** as executed, row by row including every unknown-input row; the **positive-control evidence** for AC2 and AC5, naming what was asserted absent before the pass and what receipt attributed the write to the mechanism; the **byte-comparison evidence** for AC4's collision case, stating explicitly that the pre-existing file **differed** from the projection; the **per-entry-point results** for AC3, all four, separately, with the injected-re-seed falsification result for each; the AC5 falsification in full, per injection (i)–(iv), naming the pre- and post-repair outcome of each and stating whether neighbouring behaviour stayed green; the **executed test count** for the plugin suite before and after, with the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**; a positive statement that `skipsAutoTextSync` and both of its call sites are **byte-unchanged**, quoted; confirmation that **no second serialiser, writer or `Y.Text`** was added and that the R10 fallback was not installed by the pass; confirmation that `main.ts` received **calls only**; and an explicit statement that **no Obsidian instance was launched, no vault file was read, hashed into this report or placed in a fixture, no relay was contacted, and no gate result is claimed.**
- **BUILD_SPEC updates required:** no — the §9 row, the §7 count and the header were entered when this charter was written. Anything further is an **ESCALATE** rather than a spec edit.
- **Gate status required at handover:** `npm run build` (tsc + esbuild) PASS and `npm test` 0 failed from `plugin/`, with the executed test count recorded. `npm run lint` advisory locally, gating in CI — do not mass-reformat.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
