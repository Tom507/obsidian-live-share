# Task Charter — WP92: the durable withhold still expires, now with the platform

<!-- Updated: chartered 2026-08-07 (B51, Worker 2) against S63 and S64 in `SIGNAL_REGISTER.md` §3a, and against `DISPATCHER_STATE.md`'s WP90 block. Re-verified independently against the tree per rule 12, on branch `fix-bugs-and-raceconditions` at `8e88f88`. THE MECHANISM HOLDS AND THE STATED REPRODUCTION DOES NOT — read §3.2 before writing anything. Verified: `main.ts:2900` passes `toLocalPath(canonical)` as the writer's `diskPath`, `canvas-persistence.ts:650`/`:674`/`:677` are the store's only three call sites and all three key by `this.diskPath`, so S63's mechanism — the durable store is the ONE artefact in the vault keyed in a platform-dependent representation — is CONFIRMED verbatim. But S63's stated reproduction, *"a vault carried between Windows and macOS keys those paths differently"*, DOES NOT REPRODUCE, and I measured it rather than argued it: `H:\tmp\b51_rt_probe.js` replays `toLocalPath`/`toCanonicalPath` under both `Platform.isWin` values over five on-disk names, and the store key round-trips for every name Windows can actually hold. The mismatch needs an ASCII `? * < > " | :` in the on-disk filename — which is precisely the character class Windows cannot represent, and which our own materialiser writes in its fullwidth form on that platform. So the macOS→Windows carry is blocked by the filesystem before the store is ever consulted, and the Windows→macOS carry round-trips cleanly. ⚠ TWO FINDINGS REPLACE IT, both measured, both reachable, and one of them is worse. (1) **THE ORPHAN ON RENAME, and it is the same defect with no platform in it.** `CanvasSync.handleRename` (`canvas-sync.ts:3114-3145`) re-keys `guidByPath`, the manifest guid and every `index.json` row — and says NOTHING to `SeedRefusalStore`. `grep -rn "seedRefusalStore\|durableRefusals"` over `plugin/src` excluding tests returns SIX production sites and not one of them is a rename, a delete or an unbind. So a renamed canvas leaves its standing withhold behind under the old key forever, and the new path opens with no withhold at all — WP90's cascade, restored, on an ordinary user gesture, on one machine. (2) **THE CANONICAL FORM IS NOT PLATFORM-STABLE, one layer above the store.** The same probe shows a file literally named `Q3：plan.canvas` (a genuine fullwidth colon, ordinary in CJK text) has canonical `Q3:plan.canvas` on Windows and `Q3：plan.canvas` on macOS. Those are two different documents on the wire, and on Windows two genuinely different files collapse to one canonical identity. That is a wire-identity defect, it is not WP92's, and it is described in §6 for the Dispatcher to number. ALSO VERIFIED: **`store.idle()` has ZERO production callers** — `grep -rn "\.idle()" plugin/src --include=*.ts` excluding tests returns nothing, and `onunload` (`main.ts:1386-1415`) destroys eleven subsystems and never mentions the store. S64 is confirmed exactly as filed. No Obsidian was launched, no vault file was read, no `data.json` was opened, no relay was contacted, no E2E script was run, and no `plugin/src/**` file was edited for this charter. -->
**Charter Status:** `SPEC_COMPLETE`
**WP:** WP92
**Phase:** P1
**task_mode:** `standard`
**Depends on:** WP90 (`DONE`, `a67ff9f` / `2debb41`) — its `SeedRefusalStore`, its `hydrateDurableRefusals` seam and its `SEED REFUSAL STORE:` signature are **consumed and extended, never duplicated**. WP63 (`DONE`) — the withhold gate and the lift are read, not redesigned. WP24 (`DONE`) — `SidecarIO` and `SIDECAR_DIR` are the only I/O seam. **MUST NOT be batched with any other `canvas-persistence.ts` / `canvas-sync.ts` / `main.ts` work** — see §2 Ordering.
**W4 Test Targets:** `2`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **The framing, first, because it is the whole reason this work package exists.** WP90's founding argument was *"a protection with a lifetime is not 'never', it is 'not yet'"*. WP90 was right, and it did not finish the job: **the repair rewrote the withhold's lifetime from the session to the platform rather than removing it.** The refused set is now durable, and it is durable under a key that is a function of the machine the plugin happens to be running on — and, as §3.2 shows, under a key that no rename ever follows. This is WP90's own premise applied to WP90's own result, and it is the second time this run has found a protection whose expiry moved instead of ending.
- **Outcome:** a standing seed-refusal withhold is found whenever the record it protects is still refused — whatever the path's spelling, whatever the machine, and after the user has renamed the file — and a stored withhold that is *never looked up* is **detectable**, because today it produces no signal of any kind and that silence is the defect's entire character.
- **The one-sentence statement of the defect:** *the durable record is keyed in a vocabulary nothing else in the system uses, and nothing anywhere reports a key that was never asked for.*
- **The two halves, and they are unequal.** The **key representation** half (S63) is a real discipline defect with a narrower live reproduction than the register records — see §3.2, and do not inherit the register's sentence. The **key lifetime** half — the orphan a rename leaves, measured in §3.3 and not previously filed — is reachable today, on one machine, by an ordinary user gesture, and it restores WP90's cascade in full. **A reader who fixes only the first has fixed the smaller one.**
- **S64 is FOLDED IN, and the argument is not convenience.** S64 (WP90's store writes are fire-and-forget; nothing awaits `store.idle()`) could stand alone as a low-severity durability gap. It must not, for one reason that is structural rather than tidy: **WP92's own repair is a write.** Whatever this WP does about the key — migrate the existing entries, re-derive them, or carry both spellings — it must write the store, and it must do so at moments (a rename, a detach, an unload) that are exactly the moments S64 says a write can be lost. A migration that is fire-and-forget at unload is a migration that can half-happen, and a half-migrated store is strictly worse than an unmigrated one, because it has entries under two vocabularies and no way to tell which is authoritative. **S64 is not merely foldable into WP92; it is a precondition of WP92's repair being sound.** AC4 owns it.
- **Why P1 rather than P0.** WP90 is P1 and this is its residue on the same seam. The severity argument for P0 exists — the destroyed record has no other copy, because it never entered the doc — but that argument is WP90's and WP90 has landed; what remains is a key-management defect on a protection that now works in its ordinary case. **If AC1 shows the rename orphan is reachable in the live editor, the implementor escalates the phase rather than deciding it.**
- **BUILD_SPEC reference:** `workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md` — section 5, component **C92** (work package **WP92**), and the section 9 row; section 4.6 (invariant → work-package traceability, **I11**); section 10 (the signature register — this WP proposes one, see §6). **C92, the §9 row and the header arithmetic are PROPOSED in §6 of this charter and landed by the Dispatcher; this charter does not edit the BUILD_SPEC.**

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: modify, in **at most three** production files:
    - `plugin/src/files/seed-refusal-store.ts` — the key vocabulary, the migration/re-derivation decision, the unmatched-entry census, and the flush guarantee.
    - `plugin/src/files/canvas-persistence.ts` — `hydrateDurableRefusals` (`:641-685`) only, i.e. **what key it hands the store** and the teardown flush. WP90 landed 112 insertions and 0 deletions in this file precisely so it could report the rest as untouched; that standard is inherited.
    - `plugin/src/main.ts` — **wiring only**: the rename/detach/unload notification and the `idle()` await. §3.1's S11 rule is absolute; a conditional over canvas state written into `main.ts` is a §7 abort criterion.
  - Responsibility: give the durable refused set a key that is a property of the **document**, not of the **host**; make a store entry that is never matched **observable**; and make the store's writes **awaited** at every point where the process may be about to end.
- **Out of scope / non-goals — each of these is an ESCALATE, not a judgement call:**
  - **⚠⚠ `plugin/src/utils.ts` — `toLocalPath`, `toCanonicalPath` and `WIN_CHAR_MAP` (`:7-33`). DO NOT TOUCH.** Two hard reasons. **(1)** The map is consulted by **eight production modules** (`background-sync.ts`, `canvas-sync.ts`, `file-ops.ts`, `manifest.ts`, `main.ts`, `control-handlers.ts`, `focus-notification.ts`, plus `utils.ts` itself) at **thirty-plus call sites**, and `file-ops.ts:602-609` carries a landed comment that reasons explicitly from the map's current membership. Changing it re-opens every one of them. **(2)** The wire-identity defect in §3.4 is a *consequence* of this map and is **not this WP's** — repairing it here would be a wire-format change smuggled into a store repair. If the implementor believes the map must move, that is an **ESCALATE**.
  - **⚠ The canonical↔local mapping itself, as a behaviour.** WP92 changes **which representation the store keys by**. It does not change what either function returns, does not add a third representation to the system, and does not make any other component key differently. *Making the store agree with everything else* is the goal; *making everything else agree with the store* is the abort criterion.
  - **⚠ `SeedRefusalLedger` (`canvas-sync.ts:1663`ff), `isSeedRefusalResolved`, `projectRefusal` and `SeedRefusal`'s shape.** WP63/WP90 vocabulary. This WP adds no field, no second refusal shape, no second lift trigger and no second predicate (rule 10). `projectRefusal` stays **the one gate in both directions** — WP90's property 1 — and a key change must not become a licence to widen what the store may hold.
  - **⚠ `CanvasPersistence.coldOpen`'s three outcomes and their order** (C29 AC4), the `doc-wins` branch's *"never read the file"* rule, `writeIsWithheld`, `armSettleRelease`, `acquireMute`/`releaseMute`, the write queue, the debounce, and **WP91's `MAX_MUTE_MS` cap** (`canvas-persistence.ts:79`, `:505-523`). All untouched. WP91 landed on this file three commits ago; do not be the batch that re-opens it.
  - **⚠ `plugin/src/files/canvas-sidecar.ts`.** `SIDECAR_DIR`, `isSidecarPath`, `seedRefusalStorePath`, `SidecarIO` and the `.yhistory`/`.ycheckpoint`/`index.json` filenames are WP24's and WP26's. **AC5 REPORTS on the other sidecar artefacts; it repairs none of them.** ⚠ **This file is UNCOMMITTED in the shared working tree at chartering time** (`git status` → ` M plugin/src/files/canvas-sidecar.ts`) — a sibling batch is live in it. Rule 14: read it, never revert it, never stage it.
  - **⚠ `plugin/src/files/canvas-sync.ts`'s `handleRename` (`:3114-3145`), `rekeyPathState`, `createCanvasIdentityStore` (`:248-303`) and the `identityStore` bind/unbind ordering.** WP27's, and the bind-before-unbind ordering is load-bearing and stated. WP92 may **observe** a rename through an added notification; it may not re-order, re-key or extend that sequence. If the notification cannot be added without touching that ordering, **ESCALATE**.
  - **⚠ `server/**`, deployment, `docker/.env`, any secret, any `data.json` value.** Entirely out. The relay is production; `GET /healthz` is the only permitted interaction.
  - **⚠ `useCanvasBinding`, `canvas-binding.ts`, `canvas-model-bridge.ts`, `canvas-presence.ts`.** Frozen; the flag stays `false`.
  - **⚠ Any new runtime dependency** (D11), and **any new clock**. WP90's store reads no clock and this WP adds none — a store entry's validity is a fact about the doc, never about elapsed time. Introducing an expiry, a TTL or a "stale entry" sweep by age is the **exact** defect this WP exists to close, one lifetime further out, and it is an abort criterion.
- **Known interfaces / dependencies:**
  - Input: a `SeedRefusal` set for a canvas, the canvas's identity, the store's current bytes
  - Output: a store whose entries are found when they apply and reported when they are not; a flush that has landed before the process can end
  - Depends on: **WP90** for the store and its five properties, **WP63** for the withhold and the lift, **WP24** for `SidecarIO`, **WP27** for whatever stable identity AC1 chooses (see §3.5 — the guid is a candidate and it is **not** pre-selected here)

### Ordering — what must NOT be batched together

Measured at charter time (`git status`, `git log`, `8e88f88`), and stated as a measurement, not a timeless fact (rule 5).

1. **Not with any other `canvas-persistence.ts` work.** WP90 (`a67ff9f`) and WP91 (`267d5b2`) both landed in it inside the last three commits; `git diff --stat a10f4c2..HEAD` gives **+172** lines in that file alone. It is the run's most contended file after `main.ts`.
2. **Not with any other `main.ts` work.** `main.ts` is contended by nearly everything. WP92's surface is the attach region (`:2833-2930`) and `onunload` (`:1386-1415`); WP89's revision, chartered in the same batch, owns the reconcile region (`:2379-2600`) and the writer-decoration region (`:2860-2915`). **Those overlap at the decoration boundary. WP89 and WP92 must not be in flight together**, in either direction.
3. **Not with a live sibling E2E suite.** Two E2E suites against one instance pair **do not compose** — measured by B39 (`19/21` vs `21/21`; `37/1/4` vs `38/0/4`) with the loser recorded as a product failure. **B50 is live against both instances at chartering time.** AC1's live arm waits.
4. **`plugin/src/files/canvas-sidecar.ts` is uncommitted in the shared tree.** Re-locate every symbol in it by name, never by line number, and coordinate before reading its state as settled.

---

## 3. Architecture Context

*Task-local architecture guidance only.*

### Verified against the tree (rule 12), 2026-08-07, branch `fix-bugs-and-raceconditions` at `8e88f88` — measured, given, do not re-derive

**Every claim below states its pattern and its tool. `grep -nF` for literals. Cite by symbol; the line numbers are a measurement at `8e88f88` and are to be re-measured before they are quoted anywhere else (rule 5, which this run has broken at least five times, including in the file that states the rule).**

#### 3.1 The store's key, traced to its origin — S63's mechanism, CONFIRMED verbatim

| # | site | what it does |
|---|---|---|
| 1 | `main.ts:2834` | `const canonical = toCanonicalPath(normalizePath(rawPath));` |
| 2 | **`main.ts:2900`** | `attachCanvasPersistence(handle.doc, io, toLocalPath(canonical), …)` — **`diskPath` is born here**, and it is the only production construction site (`grep -rn "attachCanvasPersistence\|new CanvasPersistence" plugin/src --include=*.ts` excluding tests → `canvas-persistence.ts:870` definition + `main.ts:2897` call, and nothing else) |
| 3 | `canvas-persistence.ts:276` | `this.diskPath = diskPath;` — `readonly`, never re-assigned |
| 4 | **`canvas-persistence.ts:650`** | `stored = await store.load(this.diskPath);` — **the lookup** |
| 5 | **`canvas-persistence.ts:674`** | `this.refusals.setDurableSink((refusals) => store.save(this.diskPath, refusals));` — **every later write** |
| 6 | **`canvas-persistence.ts:677`** | `store.save(this.diskPath, this.refusals.list());` — the adopt-on-reseed write |
| 7 | `seed-refusal-store.ts:198` | `const entry = root.paths[canvasPath];` — **exact-match, case-sensitive, on the string it was handed** |

**Those are the store's only three call sites, and all three key by `diskPath`.** `utils.ts:26-33` defines `toLocalPath` as `Platform.isWin ? substitute(seven ASCII chars → fullwidth) : identity`. So the durable file's keys are a function of `Platform.isWin`, a property of the running host. **That is the mechanism S63 names, it is real, and it is the only artefact in the vault with this property** — see AC5.

#### 3.2 ⚠ S63's STATED REPRODUCTION DOES NOT REPRODUCE. Measured, not argued. Do not inherit the register's sentence.

`SIGNAL_REGISTER.md` §3a records S63 as *"A vault carried between Windows and macOS keys those paths differently, so the standing withhold is not found."* **I replayed both functions under both `Platform.isWin` values** (`H:\tmp\b51_rt_probe.js`, which reproduces `WIN_CHAR_MAP`, `ASCII_RE`, `FULLWIDTH_RE`, `toLocalPath` and `toCanonicalPath` verbatim from `utils.ts:7-33`, and composes them exactly as sites 1+2 above do):

| on-disk filename | Windows store key | macOS store key | match |
|---|---|---|---|
| `plain.canvas` | `plain.canvas` | `plain.canvas` | ✅ |
| `Q3：plan.canvas` *(fullwidth — what our own materialiser writes on Windows)* | `Q3：plan.canvas` | `Q3：plan.canvas` | ✅ |
| `meeting｜notes.canvas` *(fullwidth)* | `meeting｜notes.canvas` | `meeting｜notes.canvas` | ✅ |
| `Q3:plan.canvas` *(ASCII colon)* | `Q3：plan.canvas` | `Q3:plan.canvas` | ❌ |
| `meeting\|notes.canvas` *(ASCII pipe)* | `meeting｜notes.canvas` | `meeting\|notes.canvas` | ❌ |

**The composition `toLocalPath(toCanonicalPath(x))` is the identity for every `x` Windows can actually hold on disk.** The two mismatching rows both require the on-disk filename to contain a **raw ASCII** member of `{? * < > " | :}` — which is exactly the character class NTFS refuses, and exactly the class our own materialiser rewrites to fullwidth before it ever writes the file. So:

- **Windows → macOS carry:** the file on the Windows disk already carries the fullwidth spelling, `toCanonicalPath` is the identity on macOS, and the key matches. **No defect.**
- **macOS → Windows carry:** the file cannot be created on the Windows filesystem at all, so the store is never consulted for it. **Blocked before the defect.**

**Ruling, and the implementor must not soften it:** S63's *mechanism* — a durable artefact keyed in a host-dependent vocabulary — is confirmed and is worth closing on discipline grounds, because it is a defect that is *invisible until the day the map grows a character*. Its *stated live reproduction* is **not reachable** and no acceptance criterion in this charter is written against it. **A criterion written against an unreachable reproduction is a green that cannot fail**, which is this run's dominant defect class, and the register handed me one.

#### 3.3 ⭐ THE REACHABLE INSTANCE, and it has no platform in it — the orphan a rename leaves

- **TOOL:** `grep -rn "seedRefusalStore\|durableRefusals\|DurableSeedRefusals" plugin/src --include=*.ts`, tests excluded. **Result: six production sites** — `canvas-persistence.ts:24` (type import), `:179` (opt), `:227` (field), `:293` (assignment), `:642` (the hydrate read), and `main.ts:234`/`:2850`/`:2853`/`:2912` (the construction and the injection). **Not one is a rename, a delete, an unbind or a teardown.**
- **Positive control for the same pattern with the same tool:** `identityStore` over the same root returns **nine** sites including `canvas-sync.ts:3137` `await store.bind(guid, newPath)` and `:3142` `await store.unbind(oldPath)`. The pattern works; the absence is real (rule 15).
- **The trace.** `vault-events.ts:216` calls `plugin.canvasSync?.handleRename(oldPath, file.path)`. `handleRename` (`canvas-sync.ts:3114-3145`) does four things: `rekeyPathState`, `stampIdentity`, `identityStore.bind(guid, newPath)`, `identityStore.unbind(oldPath)` — which re-key the manifest guid **and** every `index.json` row whose value is that path, with a stated bind-before-unbind ordering so *"the mapping is never absent from both stores at once"*. **`SeedRefusalStore` is told nothing.**
- **The consequence, stated plainly.** After a rename: (a) the old key's entry stays in `seed-refusals.json` forever, matched by nothing, reported by nothing, and it is the only record that a record was ever refused; and (b) the next cold open of the **new** path calls `store.load(newDiskPath)`, gets `[]`, takes the `doc-wins` branch, never reads the file, and flushes the projection over it. **That is WP90's cascade, in full, reached by renaming a file.** One machine, one platform, no carry.
- **Why it was not found:** WP90's own comment block (`seed-refusal-store.ts:4-53`) enumerates **five** properties the module carries, and every one of them is about *what the store may hold and how it degrades*. None is about *when an entry stops applying*. The store was specified as a container and the question of key lifetime was never posed.
- **Delete has the same shape and a different disposition.** A deleted canvas also leaves an entry. That one is harmless in the destructive direction — nothing will look it up — but it is the same silence, and AC3 measures both with one instrument.

#### 3.4 The wire-identity defect the same probe found — NOT this WP's, described in §6 for a number

The bottom half of `H:\tmp\b51_rt_probe.js` measures `toCanonicalPath` alone, and it does not round-trip:

| on-disk filename | Windows canonical (wire) | macOS canonical (wire) | same document? |
|---|---|---|---|
| `Q3：plan.canvas` *(genuine fullwidth colon, ordinary in CJK text)* | `Q3:plan.canvas` | `Q3：plan.canvas` | **no** |
| `meeting｜notes.canvas` | `meeting\|notes.canvas` | `meeting｜notes.canvas` | **no** |

So a peer on Windows and a peer on macOS holding the *same physical file* publish **different canonical paths** for it, and a Windows peer holding *two different files* — one with an ASCII-derived fullwidth colon and one the user typed — **collapses them to one canonical identity.** This reaches the manifest, `index.json`, `guidByPath` and every doc id. **It is a wire-format defect, it is one layer above the store, and repairing it inside a store charter would be smuggling.** Described in §6; the Dispatcher allocates.

#### 3.5 What the key should be — the question is POSED here, not answered

**This charter does not pre-select the replacement key, and that is deliberate.** Three candidates are live in the tree and each has a measured cost; AC1 requires the implementor to choose **one**, in writing, with the rejected two named:

| candidate | what it is | measured cost |
|---|---|---|
| **the canonical path** | `toCanonicalPath(normalizePath(raw))` — what `subscribedPaths`, `recentDiskWrites`, `lastWrittenContent`, the manifest and `index.json` all key by | closes S63's mechanism and makes the store speak the same vocabulary as every neighbour. **Does not close §3.3** — a rename changes the canonical path too. |
| **the canvas guid** | WP27's stable identity, `guidByPath` / `manifest.getCanvasGuid` / `index.json`'s keys | survives both a rename and a platform. **But** `guidForPath` is `async`, may answer `null`, and minting is deliberately forbidden on a failed lookup (`canvas-sync.ts:222-227`) — so a hydrate that needs a guid may have to wait for or fail over an identity resolution that `coldOpen` currently does not depend on. **And `index.json` already names the canvas path as a VALUE**, so a guid-keyed store plus that index is a two-hop lookup with two failure modes. |
| **both, with a migration** | key by guid, carry the path as a non-authoritative label | the most robust and the largest diff, and it puts a second vocabulary in the file the WP exists to give one vocabulary. |

**The one thing that is fixed here rather than left open: whatever key is chosen, an entry written under the OLD key must not silently vanish.** AC2 owns that, and it forbids the cheap answer.

#### 3.6 S64, verified exactly as filed

- **TOOL:** `grep -rn "\.idle()" plugin/src --include=*.ts`, tests excluded. **Result: zero.** `SeedRefusalStore.idle()` (`seed-refusal-store.ts:301-303`) and `saveNow` (`:256-259`) exist and have **no production caller**.
- `save()` (`:236-253`) extends `this.queue` synchronously before the first `await` — deliberately, and the comment says why: *"a caller which then awaits `idle()` is guaranteed to be waiting for THIS save."* **The mechanism to make the write awaitable was built. Nothing awaits it.**
- `main.ts:1386-1415` `onunload` destroys eleven subsystems (`logger`, `controlChannel`, `explorerIndicators`, `canvasSync`, `canvasSidecar.lifecycle`, `presenceManager`, `fileOpsManager`, `backgroundSync`, `manifestManager`, `syncManager`) and never mentions the store.
- **Severity, stated honestly:** the window is the interval between `queue` being extended and the `adapter.write` resolving. It is small, and it is strictly better than WP63's nothing. **It matters here because WP92's own repair writes the store**, and a migration lost at unload leaves a half-migrated file.

#### 3.7 The store's five properties are INHERITED, not re-litigated

`seed-refusal-store.ts:23-52` states them: ids/reasons/boundaries only · nothing re-injected · local-only and peer-unreachable · defined degradation with quarantine · hydration and persistence are different events. **All five survive this WP unchanged, and AC6 asserts it.** In particular property 5 — *reading never writes* — is the one a migration is most likely to break, because the natural place to write the migrated form is the moment you read the old one. **It must not be.**

- **Interfaces involved:**
  - Input: a canvas's identity (form chosen by AC1), a `readonly SeedRefusal[]`, the store's current bytes
  - Output: a store file whose entries are addressable by that identity; an unmatched-entry census; an awaited flush
- **Constraints from BUILD_SPEC (invariants — what must not change):**
  - **I11 REFUSAL NEVER DESTROYS** is binding and is AC1's second arm. A withhold that cannot be found is a withhold that does not exist, and the write it fails to stop destroys the record. I11 says NEVER.
  - **I5 DEGRADE** — a store that cannot answer for one path degrades to WP63's in-memory behaviour for **that path**, never for the session, and never silently.
  - **I3** — the store emits zero CRDT writes. `hydrateDurableRefusals` reads the store and never the `.canvas`.
  - Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I11 (CONCEPT_V2 Teil 3 + §4.6) are binding and must not be weakened.
  - `CanvasPersistence` remains the single CRDT→disk writer. `coldOpen` keeps exactly three outcomes in the same order (C29 AC4) and the `doc-wins` branch still never reads the file. `main.ts` holds wiring only.
  - **Zero new runtime dependencies. Zero new timing constants. No clock in the store.**
  - Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. `plugin/manifest.json` is a **real file** since `67f1036` — the old "broken symlink, do not read" instruction in BUILD_SPEC §10 is retired.
- **Entry points / relevant files:**
  - `plugin/src/files/seed-refusal-store.ts` — the whole module
  - `plugin/src/files/canvas-persistence.ts:641-685` — `hydrateDurableRefusals`
  - `plugin/src/main.ts:2833-2930` — the attach; `:1386-1415` — `onunload`
  - `plugin/src/files/canvas-sync.ts:3114-3145` — `handleRename`, **read-only context, not a target**
  - `plugin/src/utils.ts:7-33` — the character map, **read-only context, NOT a target**
  - `plugin/src/files/canvas-sidecar.ts` — `SIDECAR_DIR`, `seedRefusalStorePath`, **read-only context, NOT a target, and UNCOMMITTED under a sibling batch**
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Each criterion names **the observable that proves it** and **what would make it vacuous**.*

*Acceptance evidence is **visible tests only** plus, for the two rows in §7b, **two LIVE Obsidian instances** driven through the E2E rig — `POST http://127.0.0.1:39431/command` (A) / `:39432` (B). **Blind sets are discontinued** — no `blind_set1`, no `blind_set2`, no `BlindVerificationLedger` row is owed. `canvas.simulateEdit` is **never** called (`testing/e2e-control.ts:995-1005` writes straight into the `Y.Doc` and returns a hardcoded `applied: true` at `:1023`); `canvas.open` is **never** called (**S45** — it subscribes without opening a leaf and permanently consumes the `!isSubscribed` writer-attach opportunity). Every leaf is opened with `canvas.typeInNode{open:true}`, empty text, no blur. **No `data.json` value is read, printed, logged, hashed into a report or fixtured** — key names and boolean presence only. **Every live row records the role its instance actually resumed as**, quoted from its own `[session] resuming as …` line (**S37**). **Every live row states the bundle hash** (**S67**, `S57(installer)`). **No absence claim is read from the debug log** unless the reader proves the log flushed past the action window through `tools/e2e/ls_logwait.py` (**S65**; the lag is bimodal, 0.50 s or 60.0 s, and 31 % of measured batches exceeded the 2.5 s margin every old reader used). **State is the oracle; signatures are for humans.***

---

### ⚠ Which criteria depend on `SEED REFUSED:` being reachable at all — read this before scheduling

**S73 records that `SEED REFUSED:` has NEVER fired: zero occurrences across 79 185 lines in both vaults' entire retained history, verified by the Dispatcher, while `CANVAS WRITER:` fires 975 / 821 times in the same files.** Two readings and nothing on hand distinguishes them: either no malformed record has ever been present, or **the refusal path is unreachable in the live wiring**. A live batch is attempting to plant a malformed record and produce a first `SEED REFUSED:`.

| AC | needs a live refusal? | what happens if the refusal path proves unreachable |
|---|---|---|
| **AC1** key choice + hydrate | **NO** | driven by `store.save()` / `store.load()` directly and by a `SeedRefusalLedger` constructed in the fixture. The store is a plain class over an injected `SidecarIO`; a refusal is a **datum**, not an event, at this seam. |
| **AC2** migration / no silent loss | **NO** | same. Both arms are file-content assertions over the store. |
| **AC3** the unmatched census | **NO** | the census is over store entries vs. lookups, both of which the fixture supplies. |
| **AC4** the flush (S64) | **NO** | driven by `saveNow`/`idle` against a controlled `SidecarIO`. |
| **AC5** the sidecar-artefact report | **NO** | a derivation over the source. |
| **AC6** no collateral | **NO** | behavioural, over WP90's five properties. |
| **§7b live row 1** — the rename orphan end to end | **NO** for the orphan itself; **YES** for the destruction it enables | the orphan is observable as a store entry under the old key with none under the new one, which needs no refusal to have *fired* — only one to have been *recorded*, which the rig can do by planting a store file. **The second step — the projection destroying the record — needs a genuine refused record and therefore needs S73 resolved.** Report the orphan; SKIP the destruction with the reason recorded. |
| **§7b live row 2** — the withhold survives a restart under the new key | **YES** | this is WP90's own AC1 RED, still unrun for the same reason. **If S73 resolves as "unreachable", this row cannot run and WP92's premise changes**: the protection would be guarding something that cannot occur, and the correct response is an **ESCALATE to the Dispatcher**, not a green. |

**Stated plainly so it is not discovered late: if S73 resolves as *the refusal path is unreachable*, then WP63, WP90 and WP92 together protect against a state the product cannot enter, and that is a finding about three work packages rather than a defect in this one.** Nothing in AC1–AC6 becomes wrong — a store that loses its keys is still a store that loses its keys — but the **severity** collapses, and the implementor says so rather than reporting a P1 fix to a P4 problem.

---

1. **The key is a property of the DOCUMENT, and the choice is made in writing with its rejects named.**
   - **Deliverable:** one key form, chosen from §3.5's three candidates or a fourth the implementor argues for, applied at **all three** store call sites (`canvas-persistence.ts:650`, `:674`, `:677`) and nowhere else, with the two rejected candidates named and their measured cost stated. **The implementor decides; this charter refuses to.**
   - **Observable (structural, derived from the source, not from this table):** a test parses `plugin/src/files/` and asserts that the set of expressions reaching `SeedRefusalStore.load` and `.save` as their first argument is a **singleton**, and that it is not `toLocalPath(...)` of anything. **The census must be derived** — a hand list cannot catch the fourth call site the next WP writes.
   - **Observable (behavioural, and this is the criterion):** two `CanvasPersistence` instances constructed over the **same doc identity** but with `Platform.isWin` fixtured **differently** hydrate the **same** refused set from the **same** store bytes. Today they do not, for a name containing a mapped ASCII character; after this WP they must, for every name in §3.2's five-row table.
   - **Observable (I11, the second arm):** with a standing refusal in the store and the doc arriving non-empty, `coldOpen` takes `doc-wins`, `writeIsWithheld` returns true, and **`io.write` is never called** — asserted on the injected `PersistenceIO`, on both platform fixtures, for a path with a mapped character.
   - **Vacuity risk — named.** **(a) The killer, and it is this charter's own §3.2:** a test written against the *carry* story of S63 as filed. That story does not reproduce (§3.2, measured), so a test that asserts *"a Windows key and a macOS key differ and the fix makes them agree"* using an on-disk name Windows can hold is **green before and after the fix**, on both arms, forever. The fixture's filenames must come from §3.2's **mismatching two rows** (`Q3:plan.canvas`, `meeting|notes.canvas`) or the test measures nothing. **(b)** A structural census that finds zero call sites and reports the property as held — the deriver **exits non-zero without emitting a census** if its input set is empty (the third-deriver pattern), and its positive control must find `SeedRefusalStore.load` on the pre-repair tree. **(c)** The two-platform assertion satisfied by stubbing `toLocalPath` rather than by fixturing `Platform.isWin` — then it tests the stub. **(d)** `io.write` never called because the doc was empty, the subscription declined, or `canWrite` was false: every one of the doc-non-empty branch, the subscription and `canWrite` must be asserted **passing** before the "no write" assertion is read, or four unrelated early returns satisfy this AC.

2. **An entry written under the OLD key is not silently lost — the disposition is chosen, executed and asserted.**
   - **Why this is its own criterion:** a store whose keys change is a store with two vocabularies for one interval. **The cheap answer — "start fresh, the old entries just stop matching" — is precisely the defect this WP exists to close**, and it would ship it deliberately.
   - **Deliverable:** one of exactly two dispositions, chosen in writing: **MIGRATE** (old entries are re-keyed under the new form, once, idempotently) or **RE-DERIVE** (old entries are discarded **and the discard is announced**, on the argument that the next seed re-derives the verdict). Either is acceptable; **an unstated third — they stop matching and nothing happens — is an abort criterion.**
   - **Observable (MIGRATE arm, if chosen):** a store file written in WP90's shape (`{version: 1, paths: {"<old key>": [...]}}`) is loaded by the new code and the refusal is **found** for the corresponding canvas. Run **twice**: the second run writes **zero bytes** (`lastQueued` dedup, `seed-refusal-store.ts:295`) and produces a byte-identical file, asserted by comparing the file's bytes, not by trusting the dedup.
   - **Observable (RE-DERIVE arm, if chosen):** the discarded entries are counted and named in the store's health report and in one signature line **before** they are dropped, and the file bytes for **other paths' entries are preserved untouched** — WP90's property that a rewrite never drops another path's entry (`:148-150`) is asserted, not assumed.
   - **Observable (the version stamp moves or is argued not to):** `SEED_REFUSAL_STORE_VERSION` (`:56`) is `1` and its comment says *"bumped only if the on-disk shape changes"*. A key-vocabulary change **is** an on-disk shape change. Either the stamp moves and an old-version file is handled, or the report states in one sentence why the shape did not change. Silence here is a shortfall.
   - **Vacuity risk — named.** **(a)** A migration test whose input file is written by the **new** code — then it migrates nothing. The fixture's bytes are a **literal string** in the test, in WP90's landed shape, so the test still means something after the writer changes again. **(b)** Idempotence asserted by calling the migration twice on an in-memory object rather than on the file — the dedup at `:295` compares serialised bytes, so the round trip through `SidecarIO` is the only place the property lives. **(c)** "Other paths preserved" asserted with a store containing one path — the fixture carries **at least three**, one of which is deliberately **unparseable**, because WP90's property is that even unreadable entries survive a rewrite. **(d)** The RE-DERIVE arm reported as satisfied because nothing was in the store to discard.

3. **A stored entry that is NEVER MATCHED is detectable. This is the criterion, and the silence is the defect.**
   - **Why this outranks the key repair, and the implementor should be told so:** a store entry that no lookup ever asks for produces, today, **no signal of any kind** — not a warning, not a counter, not a health value. That is true of the rename orphan (§3.3), of a platform mismatch, of a typo in a hand-edited file, and of every future key defect nobody has thought of yet. **The key repair closes two instances; this closes the class**, and it is what would have found §3.3 in WP90's own batch. It is also the only criterion here that keeps its full value if S73 resolves badly.
   - **Deliverable:** a read-only accessor on `SeedRefusalStore` reporting, at minimum, the **count of stored path entries that no `load()` has asked for in this process**, and **one** signature with **exactly one** production emitter (§6). The precedent is `file-ops.ts`'s WP68/WP88 counters and WP91's `captureDeclines`: *the counter is the observable; it is state, not a log line, so a test can be an oracle over it.*
   - **Observable (state):** a store hydrated with three path entries, of which two are then `load()`ed, reports **exactly one** unmatched entry. The count is asserted to be **1**, not merely non-zero, and the two matched entries are asserted to have **decremented it** — a count that only ever goes up is a count of the file, not of the mismatch.
   - **Observable (the rename orphan, end to end, headless):** a canvas with a standing refusal is renamed through the production `handleRename` path; afterwards the store reports **one** unmatched entry, and the **new** path's `load()` answers `[]`. **Both halves.** Whether the repair is "follow the rename" or "key by something a rename does not change" is AC1's, not AC3's; AC3 asserts the *reporting* either way, so it stays green under both.
   - **Observable (the carry to the report):** the count and its paths (**path only — never a refusal's reason string, never node content**) appear in the implementation report for a real vault's store if one exists.
   - **Vacuity risk — named.** **(a) The trap this AC sets for itself, and it is B44's `[06] B: node gone` exactly:** after AC1 lands, the *platform* mismatch is no longer reachable, so an assertion of the form *"zero unmatched entries"* is **true for free**. This AC therefore asserts a **positive non-zero** as its primary observable and asserts **no zero anywhere** as evidence of the fix. **(b)** A counter incremented on a branch no test reaches: the unmatched census must be driven by a store that was **actually loaded from bytes**, not by a hand-set field. **(c)** Reporting the census from the debug log rather than from state — under **S65** a zero-line read is not an absence, and this AC's whole subject is a thing that produces no line. **The counters are the evidence; the signature is corroboration.** **(d)** Counting an entry as "unmatched" merely because no canvas is currently attached — a vault with fifty canvases and one open board would then report forty-nine. The census must distinguish *"not asked in this process"* from *"asked and not found"*, and the report must say which number it is quoting.

4. **The store's writes are AWAITED at every point the process may be about to end (S64) — and the migration is awaited first.**
   - **Deliverable:** production callers for `idle()`. At minimum: plugin unload (`main.ts:1386-1415`), session cleanup (`:1631-1653`), and the writer detach. **`saveNow` exists and `idle()` exists** (`seed-refusal-store.ts:256`, `:301`) — the mechanism was built by WP90 and left unwired; this is a wiring criterion, not a design one.
   - **Observable (behavioural, injected `SidecarIO`):** with a write in flight — the fixture's `io.write` held on an unresolved promise — the unload path **does not resolve** until the write does. Asserted by the ordering of two recorded events, not by a sleep.
   - **Observable (the failure direction is bounded):** a write that **rejects** during unload must not reject the unload. WP90 already routes every save rejection into a narrated `catch` (`:244-252`, *"a rejection here would POISON the chain"*); the awaited path must preserve that and is asserted with a rejecting `io.write`.
   - **Observable (no new hang):** the await is bounded — an `io.write` that never settles must not wedge unload forever. State the bound and how it is enforced. **A `setTimeout` race here is acceptable and is the one place in this WP a timer is permitted**, because the alternative is a plugin that will not unload; but under **S71** a `setTimeout` bound can itself stretch to 60 s on a clamped renderer, so the report states what the user sees in that case.
   - **Vacuity risk — named.** **(a)** A test that awaits `idle()` on a store with an empty queue — `this.queue` starts as `Promise.resolve()`, so `await idle()` on a fresh store resolves immediately and proves nothing. The fixture **must** have a pending write, and the test must show it fails when the `await` is removed. **(b)** Asserting the wiring by grepping `main.ts` for `idle()` rather than by driving unload. **(c)** The bound asserted by reading its constant (the C73/WP75 class) rather than by measuring the sequence. **(d)** Wiring `idle()` into unload but **not** into the migration path, so AC2's one-shot rewrite is still the thing that can be lost — the two criteria meet here and the report says explicitly which call sites were wired.

5. **`SIDECAR_DIR`'s OTHER artefacts are surveyed for the same exposure — derived from the source, and REPORTED rather than repaired.**
   - **Why this is a criterion:** the brief's question is *"do the other sidecar artefacts share this?"* and it must be answered by a derivation, not by this charter's opinion. My own reading of the tree is given below as an **input to be re-measured, not a result to be quoted**:

     | artefact | keyed by | platform-dependent? | followed on rename? |
     |---|---|---|---|
     | `<guid>.yhistory` (`canvas-sidecar.ts:63`) | **guid** | no | n/a — guid is stable |
     | `<guid>.ycheckpoint` (`:67`) | **guid** | no | n/a |
     | `index.json` (`:71`) | **guid** → path as a **VALUE** | the *value* is a canvas path; §3.4 shows the canonical form is not platform-stable | **yes** — `createCanvasIdentityStore.bind`/`unbind` (`canvas-sync.ts:266-301`) re-point it, and `handleRename` calls both |
     | `seed-refusals.json` (`:76`) | **`diskPath`** | **yes** | **no** |

     **`seed-refusals.json` is the only sidecar artefact keyed by a path at all, and the only one no rename follows.** That is the finding, and the implementor confirms or falsifies it.
   - **Observable (derived, with a two-halved positive control):** a test parses `plugin/src/files/canvas-sidecar.ts` and every module writing under `SIDECAR_DIR`, enumerates the key expression of each artefact, and pins the result. The control has **two halves**: it must find a **known-present** platform-dependent key on the pre-repair tree (`diskPath` at `canvas-persistence.ts:650`) **and** exit non-zero if its input set is empty — because after the repair *"the class is empty"* and *"the deriver went blind"* otherwise produce the same output (**S53**'s recursive shape, which made WP86's *"every derived site is corrected"* pass perfectly on an empty set).
   - **Disposition, fixed here rather than left to the implementor:** anything found outside `seed-refusals.json` is **carried up with its receipt, not repaired**. `index.json` in particular is WP24/WP27 territory and is named in §2 as out of scope.
   - **Vacuity risk — named.** **(a)** A hand list dressed as a derivation — it cannot catch the artefact WP94 adds. **(b)** A census that runs after the repair and finds one member (`index.json`) and reports the class closed, without ever having demonstrated it can find two. **(c)** Concluding `.yhistory`/`.ycheckpoint` are safe from the *filename* alone: the guid is stable, but the test must show the **write path** for those files never composes a path from `toLocalPath`, which is a source claim and needs `grep -nF` with a stated positive control.

6. **No collateral. WP90's five properties, WP63's withhold and WP91's cap all survive, shown by driving them.**
   - **Observable (WP90's five, behavioural, in the same run):** ids/reasons/boundaries only — a refusal object carrying an extra field still leaves it at the door (`projectRefusal`, `:109-123`) · nothing re-injected — no route from the store to `serializeCanvas`, asserted by driving a withheld flush and reading the produced bytes (there are none) · local-only — the store path still satisfies `isSidecarPath` and appears in **no** manifest and **no** file-op payload, driven, not read off the constant · defined degradation — an unreadable root still **quarantines** and still leaves the bytes intact, and a **migration must not launder a failed read into the file** (this is the property the repair is most likely to break) · hydration ≠ persistence — **`load()` still performs no write**, asserted on the injected `SidecarIO` by counting `write` calls during a pure hydrate.
   - **Observable (WP63/WP90 tests unmodified):** `plugin/src/__tests__/v2/wp63/**` is **not in this WP's diff at all**, asserted by running `git diff --name-only` over the directory **with a positive control that the directory is not empty** — WP90's own precedent, and it is why WP63's contract stands by measurement rather than by claim.
   - **Observable (WP91's cap intact):** `MAX_MUTE_MS` (`canvas-persistence.ts:79`) is unchanged and the measured longest continuous mute is still ≤ 750 ms on WP91's own harness. This WP touches the same file; WP91 landed three commits ago and its ceiling is the newest thing in it.
   - **Observable (structural):** `plugin/src/utils.ts`, `plugin/src/files/canvas-sidecar.ts`, `plugin/src/files/canvas-sync.ts` and `plugin/src/files/file-ops.ts` are **not in this WP's diff** — asserted by running the diff, not by prose. `canvas-sidecar.ts` is **uncommitted under a sibling batch** and a WP92 line in it is unattributable by construction.
   - **Vacuity risk — named.** **(a)** "Unchanged" asserted by reading the diff rather than running one. **(b)** A full-suite green quoted in place of naming the affected files and counts — a suite green hides a file quietly edited to stay green. **(c)** Driving WP90's five properties on a store that was never populated, so every one is true of the empty case; each needs a populated fixture and a control showing it reddens when the property is removed. **(d)** Attributing a red to a sibling without measuring it — B50 is live, and §5's concurrent-batch attribution rule applies.

**Definition of Done:** a standing withhold is found for the record it protects whatever the path's spelling, whatever the host, and after a rename; an entry nobody ever asks for is counted and named instead of sitting silently in a file; and the store's writes have landed before the process can end.

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** Windows dev host; run all plugin commands from `plugin/` (never the repo root). Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. Budget **≥90 s** for any automated `npm test` (a deliberate 33.5 s sleeper in `wp5/latency.test.ts` makes ≈41 s the floor, not a hang). No Graphify graph exists (declared FALLBACK mode); `workflowArtifacts/RepoMap.md` is the structural map.
- **🚨 RULE 14 — the working tree is shared.** `git status` before **every** stage and **every** commit — not earlier in the turn, because a sibling can act in the gap. Stage **explicit paths only**. Never `git checkout --`, `git restore`, `git stash` or any revert on a path you did not create in this batch; the instrument for a parked baseline is a **detached worktree**. **S34**: a sibling reverted `main.ts` between WP81's edit and its stage and it was caught only by the before-commit check. **At chartering time `plugin/src/files/canvas-sidecar.ts` is uncommitted in the shared tree and B50 is running live E2E against both instances.**
- **⚠ The premise you were handed about S63 is wrong in its reproduction and right in its mechanism.** §3.2 measured it. **Do not write an acceptance criterion against the carry story.** If the implementor's own measurement contradicts §3.2, that is a finding worth more than agreement — report it with its probe.
- **The most likely wrong answer is the smallest diff: change the key and stop.** That leaves §3.3's orphan open under a different vocabulary if the chosen key is the canonical path, and it leaves the *class* — a key nobody ever asks for, reported by nothing — completely untouched. **AC3 is the criterion that survives every other one being wrong.**
- **The second most likely is a sweep by age.** "Drop store entries older than N days" closes the orphan and re-creates WP90's exact defect one lifetime further out. **Forbidden, and an abort criterion** — the store reads no clock and must not start.
- **The third is repairing `toLocalPath`.** It is thirty-plus call sites across eight modules and a landed comment reasons from its membership. **ESCALATE.**
- **A detached-worktree measurement of the unit suite is 15 tests short** unless `server/node_modules` is linked as well as `plugin/node_modules`, and it reports the shortfall as **two failed files** (`e2e/two-host.test.ts`, `wp5/latency.test.ts`), not as a smaller total. Any baseline this WP quotes states its environment.
- **S74 makes the gate figure unquotable without a caveat.** `wp5/latency.test.ts` US6 AC1 asserts a wall-clock RTT band (50–150 ms) while 364 files run in parallel: **fails 2 of 3 full-suite runs**, green 11/11 in isolation, **pre-existing**, reproduced independently by two batches. Record it by name; do not report it as this WP's, and do not use it as cover for a genuine red.
- **S67 and `S57(installer)` govern every live row.** The repo's committed `plugin/main.js` is **not** the installed bundle (`85a29c85` vs `b672be50`); running the installer without `LS_EXPECT_SHA256` silently changes the code under measurement. Installed bytes are not loaded bytes. **State the bundle hash and grep the installed bytes for a marker unique to this batch's own change** — a digest proves *which* build, not *whose*.
- **S65 governs every log-based claim.** The lag is **bimodal — 0.50 s or 60.0 s** — and 31 % of measured batches exceeded the 2.5 s margin every old reader used. Use `tools/e2e/ls_logwait.py`; it raises `FlushNotProven` rather than returning an empty list. **A signature with zero hits in the retained history is `UNINFORMATIVE`, never `ABSENT`** — which is exactly the state `SEED REFUSED:` is in (**S73**).
- **S66 governs the negative control.** `link.break shape="close"` is **not** a break — a run scored 29/29 with the link nominally severed. Use `shape="mux"`.
- **Verification must be by targeted injection of this WP's own class.** A green is worth nothing unless removing the change reddens a test **on its own named assertion**. The two classes that apply most directly: a test written against §3.2's unreachable reproduction (green before and after, forever), and a census that reports "0 violations" without having proved it can find one — **twelve-plus instances of that across eight surfaces in this run.**
- **Known flaky patterns:**
  - No wall-clock sleeps in new tests; use the injected scheduler or fake timers.
  - Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.
  - Biome reports a whole-file `format` finding per touched file (CRLF environment artefact). Advisory locally, gating in CI — do not mass-reformat.
- **Hard constraints:**
  - Invariants I1–I5 and I6–I11 are binding; **I11 is an acceptance criterion, not advice.**
  - `plugin/src/utils.ts`, `plugin/src/files/canvas-sidecar.ts`, `plugin/src/files/canvas-sync.ts`, `plugin/src/files/file-ops.ts` and `server/**` are **not modified by this WP**.
  - No existing test is deleted, weakened, retitled, skipped or amended. **WP92 holds no §7 licence of any class**, and an unenumerated deletion or assertion rewrite is an abort criterion.
  - `SIDECAR_DIR` stays spelt in exactly one production module; `seedRefusalStorePath()` stays the one spelling of the store's path.

### Recorded, not repaired — this WP's own sweep

1. **The canonical form is not platform-stable** (§3.4). Measured, reachable, one layer above this WP, and **worse than S63** because it reaches the manifest, `index.json` and every doc id. Described in §6 for a number; **not repaired here.**
2. **`SEED REFUSED:` has never fired** (**S73**). Not this WP's to resolve, and it governs which of §7b's rows can run at all.
3. **`SEED_REFUSAL_STORE_VERSION` is `1` and nothing reads it.** `loadFile` (`:350`) takes `parsed.version` if it is a number and otherwise substitutes the current constant — it never **compares**. So a future version bump would be accepted silently by an older build. AC2 touches this and does not close it; recorded.
4. **A delete leaves the same orphan a rename does** (§3.3), harmlessly in the destructive direction. AC3's census covers it; no separate repair is chartered.

---

## 6. Definition of Done Artifacts

- **Required changed files:**
  - `plugin/src/files/seed-refusal-store.ts`
  - `plugin/src/files/canvas-persistence.ts` (`hydrateDurableRefusals` and the teardown flush only)
  - `plugin/src/main.ts` (wiring only)
  - `plugin/src/__tests__/v2/wp92/**` — **new**
- **Explicitly NOT changed:** `plugin/src/utils.ts`, `plugin/src/files/canvas-sidecar.ts`, `plugin/src/files/canvas-sync.ts`, `plugin/src/files/file-ops.ts`, `plugin/src/sync/control-handlers.ts`, `plugin/src/canvas/**`, `plugin/src/__tests__/v2/wp63/**`, `server/**`.
- **Required report:** `ImplementationReport_WP92.md` (in `workflowArtifacts/canvas-v2/`), containing: **AC1's key choice in one sentence with both rejected candidates named and their measured cost**; **AC2's disposition (MIGRATE or RE-DERIVE) with its reason and the version-stamp decision**; AC3's unmatched census with the number it is quoting and which of the two senses it means; the per-AC falsification (change neutralised → which test reddens, on which **named** assertion, and whether any neighbouring pre-existing oracle also reddened); AC5's derived artefact census with **both halves** of its positive control shown firing; the `wp63/` empty-diff statement **with its positive control**; a line-by-line diff statement for `canvas-persistence.ts` on WP90's precedent; the before/after full-suite counts with every failure attributed by owner and **S74** named; the live rows with the bundle hash, the resumed role, and every SKIP carrying its reason; the artefact sweep count; a data-safety statement; **an explicit statement of whether the implementor's own probe agrees with §3.2**; and the statement that no existing test was deleted, weakened, retitled, skipped or amended and that **no §7 licence of any class was taken**.

### Proposed for the Dispatcher to land — this charter does not edit `BUILD_SPEC_CanvasV2.md`

- **Proposed signature (BUILD_SPEC §10 row).** §10's rule is that every declared signature has exactly one production emitter; **`SEED REFUSAL STORE:` was emitting unregistered until B45 caught it**, and this WP must not repeat that.

  | Signature | Status | Owner |
  |---|---|---|
  | `SEED REFUSAL UNMATCHED:` | new | WP92 — one emitter in `files/seed-refusal-store.ts`; a stored path entry that no lookup in this process has asked for, with its count and its path |

  Format: `SEED REFUSAL UNMATCHED: <n> stored entr(y|ies) never looked up — <path>[, <path>…]`. **Path and count only — never a refusal's reason string, never a node id's content, never file bytes.** The name is deliberately *unmatched* rather than *orphaned* or *stale*: the store does not know whether the entry is wrong or merely not yet needed, and a name that asserted either would be a claim the emitter cannot support. The existing `SEED REFUSAL STORE:` row (WP90) is **unchanged**; this is a second, distinct signature with its own single emitter.

- **Proposed §9 row:**

  | WP | Phase | Title | Scope summary | Depends on | Status |
  |---|---|---|---|---|---|
  | **WP92** | **P1** | **The durable withhold still expires — now with the platform, and with the filename** | WP90 made the seed-refusal withhold survive a restart and **rewrote its lifetime from the session to the platform instead of removing it** — WP90's own founding argument (*"a protection with a lifetime is not 'never', it is 'not yet'"*) applied to WP90's own result. The store keys by `diskPath` = `toLocalPath(canonical)` (`main.ts:2900` → `canvas-persistence.ts:650`, `:674`, `:677`, the module's only three call sites), which on Windows substitutes seven ASCII characters for fullwidth. **⚠ S63's stated reproduction was FALSIFIED by this charter and must not be inherited:** the composition `toLocalPath(toCanonicalPath(x))` is the identity for every name Windows can hold, so the carry round-trips in one direction and is blocked by the filesystem in the other; the mismatch needs an ASCII `? * < > " \| :` in the on-disk name, which is exactly what NTFS refuses. **What IS reachable, measured and previously unfiled: a RENAME orphans the entry.** `handleRename` (`canvas-sync.ts:3114-3145`) re-keys `guidByPath`, the manifest guid and every `index.json` row and tells `SeedRefusalStore` **nothing** — six production references to the store, not one a rename, delete or unbind — so the old key holds the only record that a record was ever refused, the new path opens with no withhold, `coldOpen` takes `doc-wins`, never reads the file, and projects over it. **WP90's cascade in full, one machine, one platform, one user gesture.** Scope: a key that is a property of the **document** rather than the host, **chosen in writing with its rejects named** (canonical path / guid / both — this charter refuses to pre-select) · old entries **migrated or re-derived**, never silently stopped from matching · **a stored entry nobody ever asks for is COUNTED and NAMED** under a new `SEED REFUSAL UNMATCHED:` signature — the class, not the two instances, and the only criterion that survives S73 resolving badly · **S64 FOLDED IN, as a precondition rather than a convenience**: `store.idle()` has **zero** production callers and `onunload` destroys eleven subsystems without it, so this WP's own migration write is losable at exactly the moment it must not be · the other `SIDECAR_DIR` artefacts **surveyed and reported, not repaired** (`.yhistory`/`.ycheckpoint` key by guid; `index.json` keys by guid and IS followed on rename; `seed-refusals.json` is the only path-keyed artefact and the only one no rename follows). **`utils.ts`'s character map out of scope entirely** — 30+ call sites across 8 modules and a landed comment reasons from its membership. **No clock, no TTL, no age sweep** — an expiry by age is this WP's defect one lifetime further out and is an abort criterion. **⚠ Two ACs' live arms depend on S73**: `SEED REFUSED:` has never fired in 79 185 lines, and if the refusal path proves unreachable, three work packages protect against a state the product cannot enter — an ESCALATE, not a green. | **WP90 (`DONE`), WP63 (`DONE`), WP24** | **planned** |

- **Proposed header arithmetic.** Current: **90 live (WP1–WP83, WP85–WP91; WP84 withdrawn, counted zero, number not re-used)**. **90 + WP92 + WP93 = 92 live (WP1–WP83, WP85–WP93).** A simple range extension: nothing is withdrawn, split or renumbered, and WP84's withdrawn row still counts zero.

- **New finding needing a signal number — described, not numbered** (per `SIGNAL_REGISTER.md` §1, workers describe and the Dispatcher allocates): **the CANONICAL path is not platform-stable, and on Windows it aliases two distinct files onto one identity.** Measured (`H:\tmp\b51_rt_probe.js`): a file literally named `Q3：plan.canvas` with a genuine fullwidth colon — ordinary in CJK text — has canonical `Q3:plan.canvas` on Windows and `Q3：plan.canvas` on macOS, because `toCanonicalPath` is `Platform.isWin ? fullwidth→ASCII : identity` (`utils.ts:31-34`). Two consequences, and both reach further than the store: **(a)** two peers on different platforms holding the same physical file publish **different** canonical paths for it, so the manifest, `index.json`, `guidByPath` and the doc id all disagree; **(b)** a Windows peer holding both `Q3：plan.canvas` (user-typed) and a canvas our materialiser wrote from canonical `Q3:plan.canvas` **collapses them to one canonical identity**, which is a collision in the primary key of the whole system. Not WP92's — repairing it is a wire-format change — and explicitly out of that charter's scope. Worth a number because it is the *cause* of which S63 is one downstream symptom, and because nothing in the run has named it.

- **Second finding, smaller, also unnumbered:** **`SEED_REFUSAL_STORE_VERSION` is never compared.** `loadFile` (`seed-refusal-store.ts:350`) accepts `parsed.version` if it is a number and otherwise substitutes the current constant; no branch compares it against `SEED_REFUSAL_STORE_VERSION`. A future shape change would be read silently by an older build. The comment at `:55` says the stamp is *"bumped only if the on-disk shape changes"*, which is a rule with no reader.

- **BUILD_SPEC §5 component:** **C92** is proposed by the §9 row above and by §4's criteria. The Dispatcher writes it.

- **Gate status required at handover:** `tsc -noEmit -skipLibCheck` exit 0 · `npm test` from `plugin/` with the executed count recorded and every failure attributed by owner (**S74** named) · `npm run build`'s esbuild half **only when `plugin/src/**` is quiet** — it overwrites the shared, gitignored `plugin/main.js` and a sibling's bundle has already been destroyed that way once. **B50 is live at chartering time; check the batch table before building.**

---

## 7. Visible Test Cases / Producer Artifacts

*Empty — filled by Worker 3's producer sub-agent. Worker 2 does not generate tests.*

*⚠ **Blind sets are discontinued for new work** (owner's instruction, 2026-08-05): no `blind_set1`, no `blind_set2`, no falsification-injection requirement and no `BlindVerificationLedger` row is owed by this WP. Validation is W4 against two live Obsidian instances. E2E-plugin defects found while validating go back to **W3 as a revision**.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

**Two criteria carry a live arm that no unit seam can settle.** Everything else in §4 is decidable headless: `SeedRefusalStore` is a plain class over an injected `SidecarIO`, `CanvasPersistence` takes an injected `PersistenceIO` and scheduler, and both platform arms are reachable by fixturing `Platform.isWin`.

1. **The rename orphan, in the real editor.** Rename a shared `.canvas` with a standing store entry through Obsidian's own rename, then read the store file. **Required: the orphan is observable** (an entry under the old key, none under the new). **This row does NOT need `SEED REFUSED:` to have fired** — the entry can be planted. **Its second step — that the new path's cold open then destroys the record — DOES need a genuine refusal and is SKIPped with that reason recorded if S73 is unresolved.**
2. **The withhold survives a restart under the new key.** This is **WP90's own AC1 RED and AC2 GREEN, still unrun**, and it is the row that would finally give the mechanism live evidence. **It requires S73 resolved.** If the refusal path proves unreachable in the live wiring, this row cannot run, and the correct output is an **ESCALATE naming WP63, WP90 and WP92 together** — not a SKIP buried in a table.

**Constraints on every live row:** the bundle hash is stated (**S67**, `S57(installer)`) and the installed bytes are grepped for a marker unique to this batch's change; the instance's resumed role is quoted from its own `[session] resuming as …` line (**S37**); the negative control is `shape="mux"` and never `close` (**S66**); no absence claim is read from the debug log without `ls_logwait.py` proving the flush (**S65**), and a signature with zero historical hits is `UNINFORMATIVE`, never `ABSENT`; per-run ids and `reset_canvas()` are mandatory; `canvas.simulateEdit` and `canvas.open` are never called; and no `data.json` **value** is read, printed or fixtured. **No sibling live suite may be in flight** — two suites against one instance pair do not compose.

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

*Empty at handover.*

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

*Empty at handover.*

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

*Empty at handover.*
