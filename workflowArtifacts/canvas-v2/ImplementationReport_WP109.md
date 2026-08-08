# ImplementationReport WP109 — S134: a note born in a session is published and never SEEDED

**Worker:** W3c · **Branch:** `fix-bugs-and-raceconditions` · **Base:** `ed0307c` (the charter commit; the
charter names `26581d2`, which is three dispatch commits back — see §7.1)

---

## 1. The mechanism — and it is not the one the charter names

The charter's headline is *"no peer ever subscribes the document"*. **That is not what happens.** The
document is subscribed, on every peer, and it is marked synced. What never happens is that anybody puts the
file's bytes **into** it.

### The line

`plugin/src/files/background-sync.ts`, `subscribe()`, as shipped:

```ts
if (this.role === "host" && path !== this.activeFile) {
  const file = getFileByPath(this.vault, diskPath);
  if (file) {
    const content = normalizeLineEndings(await this.vault.read(file));
    const remoteContent = docHandle.text.toString();
    if (remoteContent.length === 0) {
      applyMinimalYTextUpdate(docHandle.doc, docHandle.text, content);   // ← THE SEED
    } else if (remoteContent !== content) {
      await this.writeToDisk(path, remoteContent);                       // ← the DISK write
    } …
```

`path !== this.activeFile` is the **single-writer** guard, and single-writer is a statement about the
**disk**: the active file's copy on disk belongs to the editor and `yCollab`. But the guard sits in front of
the **whole arm**, and the arm's first branch runs in the opposite direction — disk → CRDT. So the guard
also disabled **seeding**, which it was never protecting anything from. `activateForFile`'s host arm already
seeds the same document from the editor buffer (`collab.ts`, `hostMaySeedFromEditor`), so seeding the active
file was never forbidden in the first place; one of the two seeders was simply switched off.

**A note created during a session is, in Obsidian, the ACTIVE FILE the instant it exists.** So this branch
decides every mid-session file, and it decided not to seed.

### The evidence line, measured — not argued

Full production wiring: the real in-process relay (`server/src`), a real `SyncManager`, a real
`ManifestManager`, a real `FileOpsManager`, the real `registerVaultEvents` create handler, a real
`BackgroundSync`, driven by a genuine vault `create` event. Two peers, one room.

```
BEFORE   MID host obs   [ '_liveshare-test/start.md', '_liveshare-test/born.md' ]
         MID host synced true  no-peers
         MID host doc text ""                       ← 16 bytes on disk, 0 in the CRDT
         AFTER guest doc text ""
         [live-share] empty-write refused for _liveshare-test/born.md: refusing to replace
             16 byte(s) with empty content …        ← the S119/S126 floor, doing its job

AFTER    MID host doc text "born mid session"
         AFTER guest synced true peer-state
         AFTER guest doc text "born mid session"
```

`observers` contains the path in **both** columns and `synced` is `true` in both. The document is empty, not
absent.

### The charter's control, explained by the code rather than by the file's birth time

`main.ts:1545` / `:1564` call `backgroundSync.startAll(role)`. `main.ts:1571` calls `onActiveFileChange()`.
**`startAll` runs first, so `activeFile` is `null` for the entire session-start pass** and every
session-start file takes the seed branch. A `Leave` / `Start` / `Join` cycle re-runs `startAll` over the
manifest — which is exactly why the *same* file, with the *same* peers, on the *same* build, converges in
0.54 s afterwards. The discriminator is **the active-file predicate**, not the birth time, and the suite
asserts that directly: the same file, same peer, same call, with `setActiveFile(null)` instead of
`setActiveFile(path)`, seeds.

### Why nothing anywhere said anything

1. Host: subscribed, observed, synced, document empty. No branch, no counter, no log.
2. Guest: `subscribe()`'s guest arm waits 2 s for a host seed that never comes, reads `""`, and tries to
   write it over its own bytes.
3. **The S119/S126 empty-write floor correctly refuses.** The file keeps its bytes — so from outside,
   "nothing happened" is a complete description. The floor is what turned a data-loss bug into a silent
   no-sync bug.
4. Every peer now holds an empty CRDT for a file with content, so nothing anyone types is ever merged with
   anything. **Three peers, three unlinked copies** — exactly what was measured live.

The vacuity control in the suite asserts step 3 against the product's own ledger
(`getEmptyWriteRefusals().byArm["doc-write"] > 0`), so "the file kept its bytes" is the floor working and
not the absence of an attempt.

### Correcting the charter (method rule 6)

- `observers: false` / `synced: false` **does not reproduce** in the real wiring, at any point I could
  reach. Both are `true`. I could not construct a state in which `waitForSync` rejects at 10 s for a
  mid-session file on a healthy link, and I say so rather than inventing one. Two readings I cannot
  separate, and I did not pick the more interesting one: either the live probe read within the ~2 s window
  in which the guest's `subscribe()` is still inside its wait loop and never re-read, or it read a field
  other than `BackgroundSync.observers` / `SyncManager.synced`. **The provenance of that measurement is not
  in the repo** — it lived in W4's transcript — so I could not check it.
- What this does **not** weaken: the user-visible defect the charter describes is fully reproduced and fully
  explained, and the `waitForSync`-rejection half of it is repaired independently under AC3 whatever the
  cause of the rejection turns out to be.
- **A falsifiable prediction for the live re-validation, and it is sharp:** pre-fix, a note born on a
  **GUEST** should have been FINE, because the host's own `onFileAdded` (from `control-handlers.ts:209`)
  reaches `subscribe()` for a path that is **not** the host's active file, so the host seeds it normally.
  Only a note born on **the host** (or on whichever peer holds it open) was broken. If the live run finds a
  guest-born note that also failed, there is a second mechanism and this report is incomplete.

---

## 2. What changed

| file | change |
|---|---|
| `plugin/src/files/background-sync.ts` | `subscribe()`'s host arm no longer skipped wholesale for the active file. The SEED branch runs; the two DISK branches are refused for the active file by an explicit `else if (isActive)` — the invariant is now a line a test can point at instead of a side effect of a guard placement. Newly-reachable seed gated on `yTextHeldContent` (S129 AC3's evidence). `getCollabBoundFile()` added, read-only. |
| `plugin/src/editor/collab.ts` | The `waitForSync` timeout `catch` now **counts** (`noteCollabBindFailure`), **logs** (`bind FAILED for …`), **reports the bind state** (`bindStateSink`), and installs the S129 content watcher so a failed bind recovers on the event. The S129 refusal path reports the same bind state — it leaves the compartment empty too, so it told the same lie. |
| `plugin/src/editor/collab-bind-decision.ts` | A **second, separate** ledger (`CollabBindFailures`) and `makeBindStateSink()` — the identity-guarded glue, owned here so it has one definition and a test can drive it. |
| `plugin/src/main.ts` | Wires `setBindStateSink(makeBindStateSink(this.backgroundSync))` beside the existing `setLogger`, i.e. **after** `this.logger` exists (S104's placement rule). Exposes `getCollabBindFailures()`. |
| `plugin/src/testing/e2e-control.ts` | Additive read-only command `collab.bindFailures`. |
| `plugin/src/__tests__/v2/wp109/test_s134_a_note_born_in_a_session.test.ts` | 12 tests. |
| `workflowArtifacts/canvas-v2/wp109_break_table.py` | The falsifiability driver. |

**Why the failure ledger is separate from S129's refusal ledger:** S132's finding, applied before it could
be repeated. A refusal is a **decision this peer took on evidence it holds**; a failure is *the activation
never reached a decision*. One counter for both would be dominated by the benign class and could not report
the one that still loses collaboration. `getCollabBindRefusals()`'s `{total, paths}` shape is pinned by four
S129 assertions and is byte-unchanged.

**Why clearing `collabBoundFile` cannot open a second-writer window** — checked, not assumed:
`onActiveFileChange` sets `setActiveFile(sharedPath)` on the line **above** `setCollabBoundFile(sharedPath)`,
and both consumers test the ACTIVE-file identity first (`background-sync.ts:369`/`:370` in
`handleLocalTextModify`, `:449`/`:450` in the `Y.Text` observer). For a file that is still open the two flags
are redundant, so clearing the weaker one changes nothing. Break **W4** is the row that would catch it if
that reasoning were wrong.

---

## 3. Break table (AC4)

Driver: `workflowArtifacts/canvas-v2/wp109_break_table.py`. Copy-aside, exact string replacement, restore in
a `finally`, sha256 equality on every target. Its own file rather than more rows on `s115_break_table.py`
**because a sibling worker (W3d/WP110) is live in this working copy** and that driver is a file we would
both be editing — `S100`, avoided rather than re-learned. Mechanics and the `^\s*[x×]` failure parser
(`S133`) are copied verbatim.

Test set: the WP109 suite plus S129, S126, S119-floor, `background-sync.test.ts`, `collab.test.ts`.
**Baseline 96/96 green.**

| # | AC | break | result | RED for |
|---|---|---|---|---|
| **W1** | AC1/AC2 | restore the active-file exemption in front of the whole host arm — **the shipped defect, verbatim** | 2 failed / 94 | THE MECHANISM; AC2 reaches a second real peer |
| **W2** | AC2 | the host stops seeding at all (inert for every path) | 6 failed / 90 | THE MECHANISM; POSITIVE CONTROL; AC2 second peer; **and three pre-existing `background-sync.test.ts` rows** — `host seeds empty Y.Text from vault content`, `handleLocalTextModify skips the active file`, `single-writer: active-file gate holds even before collabBoundFile is set` |
| **W3** | AC2 | the tombstone gate is removed, so an emptied note is resurrected under the user's cursor | 1 failed / 95 | the newly reachable seed does NOT resurrect a note a peer emptied |
| **W4** | AC2 | the DISK-write branch is let through for the active file (the invariant the original guard protected) | 1 failed / 95 | the SINGLE-WRITER invariant is intact |
| **W5** | AC3 | the failed bind stops reporting its state, so `collabBoundFile` keeps naming it | 1 failed / 95 | THE LIE |
| **W6** | AC3 | the failure is no longer counted | 2 failed / 94 | COUNTED AND LOGGED; event recovery |
| **W7** | AC3 | the failure stops reaching the debug log (Notice-only again — the S117 shape) | 1 failed / 95 | COUNTED AND LOGGED |
| **W8** | AC3 | the sink clears the flag for ANY path | 1 failed / 95 | the sink is IDENTITY-GUARDED |
| **W9** | AC3 | a timeout is filed as a REFUSAL, collapsing the two ledgers | 1 failed / 95 | COUNTED AND LOGGED |
| **W10** | AC3 | a failed bind no longer re-activates when the document arrives | 1 failed / 95 | RECOVERS on the event |
| **W11** | **negative control** | the failure log line is reworded, everything else unchanged | **96/96 green** | **nothing — as intended** |

**Restore byte-identical (sha256) on all 11 rows. `COPY-ASIDE LEFTOVERS: 0`. Final green check 96/96.**

W11's first anchor did not match (the `+` concatenation crosses a backtick, which my anchor spelled as a
quote). The driver reported `ANCHOR NOT FOUND` and **did not score it as a pass** — that distinction is why
`s115_break_table.py` prints it, and it worked. Anchor fixed, row re-run, reddens nothing.

**W2 is the most informative row:** the three `background-sync.test.ts` rows it reddens are *pre-existing*
tests of the single-writer invariant and of the seed, and they are **green with my change**. The invariant is
not weakened; the seed is not weakened; only the coupling between them is gone.

---

## 4. Gate (AC5) — bracketed

| | before (`ed0307c`, my first change not yet made) | after (last change) |
|---|---|---|
| `vitest` full suite | **3000 tests / 407 files** · 2979 passed, **21 failed** | see §4.1 |
| `tsc --noEmit` | clean | **clean** |
| `check_signal_register.py` | exit 0 | see §4.1 |

The charter's baseline figure — **3000 tests / 407 files** — is confirmed exactly. What the charter does not
say is that **21 of them fail at the base commit**, in 11 files. I re-ran those 11 files in isolation:
**9 of 11 pass alone**, so they are the `S74` / `S88` load-and-shared-tree family (a wall-clock RTT band and
censuses that read the live working copy while another worker types in it). Two reproduce in isolation and
are genuinely red at the base commit, untouched by this package:

- `v2/wp93/test_tp01…` › `T6 — RECONCILIATION against the PRE-REPAIR tree`
- `v2/wp101/test_s123_canvas_mirror_race` › `re-arms exactly once when records arrive, over 60 runs`

Quoting a bare "N passed" for this suite is not meaningful while a sibling is live in the tree; the
before/after **failure sets** are the comparable figures and are given in §4.1.

### 4.1 After figures

| | before | after |
|---|---|---|
| totals | **3000 tests / 407 files** | **3057 tests / 410 files** |
| passed | 2979 | **3044** |
| failed | **21**, in 11 files | **13**, in 7 files |
| `tsc --noEmit` | clean | **clean, exit 0** |
| `check_signal_register.py` | exit 0 | **exit 1 — and not for anything of mine**, see below |
| WP109 suite | — | **12 / 12** |
| break-table set | — | **96 / 96**, 11 rows, 0 copy-aside leftovers |

**The `+57 / +3` is not all mine.** My package adds **12 tests in 1 file**. The remainder is W3d's WP110,
live in the same working copy: at the moment of the after-run the tree also carried their edits to
`canvas-sync.ts`, `empty-write-guard.ts`, `file-ops.ts`, `manifest.ts`, `vault-events.ts`,
`wp93/test_tp01…` and a new `v2/wp110/` directory. **A whole-suite figure taken in a shared tree measures
both workers**, and I am not going to present it as if it measured one. What is attributable is the
break-table set (six files, all of them mine or my direct neighbours) and the WP109 suite.

**Failure set, before → after.** Every after-failure is in the `S74` / `S85` / `S88` families — wall-clock
bands and censuses that read the live working copy — and the set SHRANK:

| file | before | after |
|---|---|---|
| `dataloss/test_s119_empty_text_write_truncates_a_note` | 1 | **0** |
| `dataloss/test_s129_opening_a_note_cannot_empty_it` | 2 | **0** |
| `w4-canvas-integrity` | 1 | **0** |
| `wp46/test_probe_side_effect_free_visible` | 1 | **0** |
| `wp5/cold-arrival-dataloss` | 1 | **0** |
| `v2/wp101/test_s123_canvas_mirror_race` | 4 | 4 |
| `v2/wp87/test_tp01_surface_route_census` | 4 | 2 |
| `v2/wp92/test_tp06_no_collateral_visible` | 2 | 1 |
| `v2/wp93/test_tp01…` | 1 | 1 |
| `v2/wp93/test_tp03…` | 2 | 2 |
| `wp5/cold-arrival` | 2 | 2 |
| `wp5/latency` | 0 | **1** |

The one file that appears in the after column and not the before column is `wp5/latency.test.ts`, and the
row is *"reconnecting holder re-claims only still-free nodes — no split lock (US4 AC3/AC4, GAP-4)"* — which
is **`S85` by name**: a fixed `sleep` used as a settle, so under load the re-claim has not arrived when the
assertion runs. It is the register's own example of the class and it touches nothing this package changed.

`check_signal_register.py` exits **1** on exactly one new violation key:
`UNKNOWN  ImplementationReport_WP110.md  S141  0 -> 1  (line 315)` — **the sibling's report citing the
next-free number**, which is §5's canonical trap and needs their `<!-- signal-register: meta -->` marker.
Nothing under WP109 is named. I did not edit their file.

---

## 5. What I rejected, and why

- **Waiting longer in `activateForFile`.** The charter forbids it and it is the wrong shape anyway: the
  document was never going to arrive, because nothing was ever going to put anything in it.
- **Adding a retry/backoff around `subscribe()`.** `subscribe()`'s `catch { return; }` on a rejected
  `waitForSync` is a permanent, silent give-up with no retry anywhere — a genuine weakness, and I considered
  repairing it. Rejected for this package: with the seed hole closed I have no reproduction in which that
  `catch` fires, and building a retry against an unreproduced failure is how a green that cannot fail gets
  written. **Recorded in §6 instead.**
- **Removing the active-file guard entirely.** That would let the disk-write branch run for the file the
  editor owns — a second writer, and precisely what the guard exists for. W4 is the row that proves the
  distinction was kept.
- **Gating the seed on tombstones unconditionally.** It would be more consistent, but it changes behaviour
  on a path that already worked (a non-active file whose doc was emptied). Widening a pre-existing branch
  under cover of a different repair is not this package's to do silently. The gate applies **only** to the
  newly-reachable active-file case; the non-active case is byte-unchanged.
- **Adding rows to `s115_break_table.py`.** A shared file in a tree with a live sibling. See §3.

---

## 6. New findings (prose only — I allocate no numbers)

**6.1 — The empty-write floor on the manifest arm can be DEFEATED by the host publishing an empty hash, and
`setActiveFile` is a producer of exactly that.** `background-sync.ts`'s `setActiveFile`, when the user
switches away from a file, does:

```ts
const content = docHandle.text.toString();
void this.writeToDisk(oldActive, content, this.currentSeq(oldActive));   // floored (S119/S126)
if (this.role === "host") {
  const file = getFileByPath(this.vault, toLocalPath(oldActive));
  if (file) void this.manifestManager.updateFile(file, content);          // NOT floored
}
```

If the document is empty, the host publishes `hash("")` **for a file that has bytes**. `syncFromManifest`'s
floor takes its evidence from `intentional: (await hashContent(content)) === entry.hash` — which is now
`true` — so it **ALLOWS** the write, and every guest runs `vault.modify(localFile, "")`. That is `S119`,
reachable again, through the front door of its own guard. Traced link by link and **stated as traced, not
measured** — I did not execute it, because with the seed hole closed I could no longer produce the empty
document that starts it. The repair in this package removes the only producer I know of; **the route is
still there** and it deserves its own package: *a peer must not publish a manifest hash derived from a
document it cannot show ever held anything.*

**6.2 — `subscribe()`'s GUEST arm has no active-file guard at all.** The host arm had one (too broad); the
guest arm has none, and it calls `writeToDisk(path, remoteContent)` unconditionally. So a guest that
subscribes a file the user currently has open writes that file's disk copy from background-sync — the same
single-writer violation the host guard exists to prevent, on the other role. Pre-existing, untouched here
(changing it could regress the guest's first-materialisation path, which is load-bearing), and reported
rather than folded in.

**6.3 — A rejected `waitForSync` inside `subscribe()` is permanent.** `catch { return; }`: no observer, no
retry, no counter, no log, and the path is never revisited until the next `startAll` — i.e. until the user
leaves and rejoins. Whatever caused the live `synced: false`, **this is the amplifier that made it last all
day.** The cheapest instrument is the one this package just built for the editor: count it and log it.

**6.4 — The live probe's `observers` / `synced` reading could not be reconciled with the code, and its
provenance is not in the repo.** See §1. Recording it as an unresolved discrepancy rather than explaining it
away.

**6.5 — A sibling is writing into `plugin/src/__tests__/zzprobe/` during this batch.** `probe.test.ts` and
`probe2.test.ts` appeared there mid-run (W3d's WP110 rename probes). They are untracked, they are not mine,
and I have not touched them — but they are **collected by vitest**, so they are inside anybody's full-suite
figure. `S88`'s point one level up: the gate number is a function of who else is typing, and now of what
else they left on disk.

---

## 7. Residuals I deliberately left

1. **6.1, 6.2 and 6.3 are not fixed.** Each is a distinct defect with its own blast radius, and 6.1 in
   particular re-opens a landed P0's territory — it should be chartered, not bolted on.
2. **No live validation.** The charter forbids rebuilding or deploying; the rig is pinned and W4 owns the
   vaults. Everything here is unit/harness evidence over the real relay. §1's guest-born-note prediction is
   the row to run first.
3. **The `EditorView` double.** Part B uses the same CodeMirror double S129's suite uses, for the same
   reason: `yCollab`'s own reconciliation is upstream library behaviour. What the suite controls instead is
   whether the binding is **reached** — the vacuity control asserts a successful activation genuinely
   reconfigures the compartment, so the failure rows are not passing because nothing in the file ever binds.
4. **The vault double in Part A** does not exercise Obsidian's file watcher or `TFile` metadata refresh.
   Neither is reachable from `subscribe()`, which takes only `read`, `getAbstractFileByPath` and
   `adapter.write` from the vault. Stated rather than implied (method rule 1).

### 7.1 Charter corrections

- **Base commit.** The charter says `26581d2`; the branch was already at `ed0307c` (`26581d2` → `b3d5704` →
  `ed0307c` → `8736744`) when I picked it up. I worked from the branch tip, not from `26581d2`. The gate
  figure the charter quotes still holds exactly (3000 / 407), so nothing depends on it — recorded rather
  than quietly worked around.
- **The mechanism.** §1. "No peer ever subscribes the document" is false; "no peer ever seeds it" is true.
- **The baseline is not green.** 21 pre-existing failures at the base commit, 2 of them reproducible in
  isolation. A charter that says "gate: 3000 tests / 407 files" without that reads as *3000 passing*.
