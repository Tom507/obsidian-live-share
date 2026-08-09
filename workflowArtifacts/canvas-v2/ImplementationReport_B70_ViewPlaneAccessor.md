# B70 — The View-Plane Accessor

**Batch:** `B70` · **Worker:** W3 · **Branch:** `fix-bugs-and-raceconditions`
**Charter:** none. Owner's instruction, verbatim — *"lets continue by fixing the testing rig of the plugin,
cause it currently cant look into the view, send a fixing agent, no blueprint, just let him figure it out"*.
**Unblocks:** `S189` — the line-level attribution of `H8`.
**Signals allocated by this batch:** `S190` (the root cause, closed here), `S191` (a sibling instance, left open). <!-- signal-register: meta -->
**Test mandate:** suspended for this tooling work by owner order. No vitest test was written, amended,
weakened or skipped.

---

## 0. The one sentence

The view plane was not failing to *find* the canvas view — it was failing to **call** the accessor that
holds it. `e2e-control.ts` invoked `plugin.canvasDiagTargets` **with the receiver detached**, so the
prototype method ran with `this === undefined`, threw on its first line, and a bare `catch` rendered the
throw as the sentence *"no canvas view is mounted for this path on this peer."* The board was open the
whole time.

---

## 1. The actual root cause of `VIEW UNAVAILABLE`

### 1.1 It is not the empty-host judge bridge

The brief asked me to establish this before changing anything. **It is not the bridge.**
`plugin/src/__tests__/e2e/judge-entry.ts` boots an empty host for headless judging and never participates in
the live path: the three vaults run `maybeStartE2EControlServer(this)` from `main.ts:1567-1569`, where `this`
is the real `LiveSharePlugin`. The proof is positive rather than inferential — on the same live peers, in the
same command surface, the **doc** plane (`plugin.canvasSync`) and the **awareness** block both returned real
data, and `canvas.editingSignal` returned eleven real node ids off the very map the view plane could not
read. An empty host answers none of that.

### 1.2 The two lines

```text
plugin/src/main.ts:3659            canvasDiagTargets(rawPath?) { … this.canvasAdapters … }   ← PROTOTYPE METHOD
plugin/src/testing/e2e-control.ts  const accessor = plugin.canvasDiagTargets;                 ← receiver dropped here
  (pre-fix :3373-3380)             raw = accessor(rawPath);                                   ← called with none
```

`canvasDiagTargets` is a class method whose entire body is `this.canvasAdapters` / `this.canvasPresences`.
The e2e bundle esbuild emits begins with `"use strict"` (verified on the shipped artefact), so a detached
call runs with `this === undefined` and the `for (const [path, adapter] of this.canvasAdapters)` line throws:

```text
TypeError: Cannot read properties of undefined (reading 'canvasAdapters')
```

The `catch` was bare — `catch { return []; }` — so the throw became an empty target list, and
`diagViewCensus` rendered the empty list with the words reserved for a peer that genuinely has no board open.

**This is why `main.ts` finds canvas leaves and `e2e-control.ts` does not, and the contrast in the brief was
the right thread to pull — but the answer is not about leaf enumeration at all.** `main.ts` calls
`this.app.workspace.getLeavesOfType("canvas")` *from inside the class*, receiver intact.
`e2e-control.ts:3041 resolveCanvasViews` — the leaf-enumeration helper the anchors pointed at — is **not on
the view-plane path** and was never the problem. The view plane never reaches a leaf; it reads
`canvasAdapters`, a map `syncCanvasPresences` populates at `main.ts:3842` when it mounts a presence.

### 1.3 The live measurement that settles it

`mountedPaths` is computed by calling the accessor with **no path filter**, so a canonicalisation mismatch
cannot explain an empty result — an unfiltered read returns every entry whatever its key. That leaves
exactly two candidates: the map is empty, or the call failed. This distinguishes them, read-only, on the
three running vaults, in one script (`h:/tmp/b70_view_plane_probe.py`):

| read | how e2e-control invokes it | A | B | C |
|---|---|---|---|---|
| `canvas.editingSignal` → `hasAdapter` | `plugin.canvasEditingSignal(path)` — **method call** (`:5113`) | `True` | `True` | `True` |
| `canvas.editingSignal` → `adapterAvailable` | same | `True` | `True` | `True` |
| `canvas.editingSignal` → `len(liveNodeIds)` | same | **11** | **11** | **11** |
| `canvas.diag` → `mountedPaths` | `accessor(rawPath)` — **detached** | `[]` | `[]` | `[]` |
| `canvas.diag` → `census.view.available` | same | `False` | `False` | `False` |

Verbatim, peer A (B and C identical):

```text
===== PEER A (port 39431) =====
  canvas.editingSignal ->
    available      = True
    path           = _liveshare-test/smoke.canvas
    hasAdapter     = True
    adapterAvailable = True
    liveNodeIds    = ['208541a49dc66c4c', '90943d0a189fd75a', 'b41O-023800-01-M', 'b41O-023800-01-n',
                      'card1', 'card2', 'ee601e293437bced', 'from-guest', 'from-guest-011125',
                      'w4e040790', 'w4e041809']
    hasWriter      = True
  canvas.diag op=census ->
    mountedPaths   = []
    view available=False count=0 reason='no canvas view is mounted for this path on this peer'
    doc  available=True count=11 reason=''
    file available=True count=11 reason=''
```

**Same map. Same process. Same millisecond. Only the call shape differs.** The map was never empty.

### 1.4 The second half of the defect, and the more expensive one

The receiver loss is a one-line bug. What made it cost a whole measurement session is that the instrument
**reported the failure as a successful reading of an absent board**. That is a direct violation of the
diagnostic's own R7, written at the top of the same block:

> *R7 … An empty reading and a missing instrument never look alike.*

`resolveDiagTargets` collapsed four distinct facts — *no accessor on this build* / *the accessor threw* /
*the accessor returned a non-array* / *no board is mounted* — into one empty array, and the caller picked
the most reassuring of the four to print. `S189`'s note *"the rig reports VIEW UNAVAILABLE … it cannot find
the mounted canvas view to hook"* is that sentence being believed.

### 1.5 Why no gate caught it

`canvasDiagTargets` has **zero test files and zero fixtures in the tree**:

```text
$ grep -rl canvasDiagTargets . --exclude-dir=node_modules --exclude-dir=.git
./plugin/main.js                                        (build output)
./plugin/src/main.ts
./plugin/src/testing/e2e-control.ts
./workflowArtifacts/canvas-v2/DIAGNOSTIC_SPEC_CanvasDisjoint.md
$ grep -rl canvasDiagTargets plugin/src/__tests__ | wc -l
0
```

`tsc` is structural and a lost receiver is not a type error — `accessor(rawPath)` type-checks perfectly.
B68's own rehearsal drove the reader against fake control ports, but a hand-rolled fake plugin is an object
literal whose accessor closes over its data lexically; detaching such a function loses nothing. **A test
double of this shape cannot reproduce the production failure**, which is §3.11 (*"wiring can be uncovered
while every gate reports green"*) in a new costume: the composition-root seam was reachable only by a live
bundle, and nothing exercised it.

---

## 2. What I changed, and what I rejected

**One file. `plugin/src/testing/e2e-control.ts`. No production source touched.**

| # | change | why |
|---|---|---|
| 1 | `resolveDiagTargets` → `resolveDiagTargetsResult`, returning `{ targets, accessorError }`; the old name kept as a thin `.targets` wrapper for the two call sites that cannot render a refusal (`:3609` awareness `lockMeta`, `:3820` `mountedPaths`) | the fix and the honesty repair land in one function without churning four call sites |
| 2 | `raw = plugin.canvasDiagTargets(rawPath);` | **the bug.** Method-call form, receiver intact |
| 3 | `catch` now returns `accessorError: "canvasDiagTargets threw: <message>"`; a non-array return names its own type | R7 — a throw and an unmounted board must never render alike again |
| 4 | `diagViewCensus` reports `accessorError` when present, before the "no canvas view is mounted" branch | the plane says which of the two happened |
| 5 | `install()`'s note does the same for the arm-time message | that note is the first thing a live session reads, and it was the sentence that misled B69 |

### Alternatives considered and rejected

- **`accessor.call(plugin, rawPath)` or `.bind(plugin)`.** Both work. Both keep a detached function handle
  in a variable, which is the shape that made the defect possible. The handle is gone instead of repaired.
- **Change `main.ts` to an arrow-function property** (`canvasDiagTargets = (rawPath) => {…}`). This would
  bind the receiver at construction and fix it from the other side, but it edits production source for a
  rig bug, changes a class member's shape for every future caller, and leaves the rig's detached-handle
  idiom in place to bite the next accessor. Rejected; the brief's preference for a rig-side fix and the
  minimality rule both point the same way.
- **Fall back to `resolveCanvasViews`/`getLeavesOfType` when the accessor yields nothing.** Rejected
  outright, and this is the one worth naming: it would have produced a *working-looking* view plane that
  reads a **different object** from the one the product mutates, and it would have permanently hidden the
  real bug behind a fallback. A second definition of "the mounted canvas" is exactly the drift `S189`'s
  attribution cannot afford.
- **Fix `S191`'s two sibling sites while I was in the file.** Rejected — declared out of scope. Reported
  instead (§6).

### Gates

| gate | command actually run | result |
|---|---|---|
| `tsc` | `./node_modules/.bin/tsc -noEmit -skipLibCheck` (from `plugin/`) | **exit 0, clean** |
| suite | `./node_modules/.bin/vitest run` (from `plugin/`) | **444 files / 3375 tests passed, 0 failed** |
| e2e bundle | `npm --prefix plugin run build:e2e` | clean · 5 834 351 B · `sha256[:16] 02ea8ceea23f9a2b` |
| register | `python workflowArtifacts/canvas-v2/check_signal_register.py` | see §7 |

The suite figure is measured on the restored (fixed) tree in this session, not quoted from memory. It
matches B68's recorded 444/3375 exactly, so nothing was added or lost.

---

## 3. Falsifiability — plant, RED, byte-identical restore, GREEN

### 3.1 The instrument used

`h:/tmp/b70_falsify.py` does **not** re-implement anything. It brace-matches four blocks out of a **real
shipped `main.js`** — `diagErrorText`, `narrowDiagAdapter`, the resolver, and `LiveSharePlugin`'s
`canvasDiagTargets` method — pastes them unmodified into a `"use strict"` module, and runs them against a
stub whose `canvasAdapters` map holds the board with the **same eleven node ids the live peers reported**.
The only variable between a RED run and a GREEN run is which bundle the text came from.

It carries its own positive control: `plugin.canvasDiagTargets()` is called in **method form** first and
must return 1, proving the map is populated in *both* runs. A RED that came from an empty stub would prove
nothing.

### 3.2 BK1 — plant the receiver loss back into the fixed tree

Full cycle, run end to end by `h:/tmp/b70_plant_restore.py`. Restoration is **copy-aside** from
`h:/tmp/b70_backup/e2e-control.ts.FIXED` — no `git checkout`, no `git stash`, no `git restore` (workflow §5.2).

```text
# STEP 0 — baseline (fixed tree, already built)
  source sha256 = 9d9a224443caddebff8d8c67e2f92ad0421bc456e397e4a5d3fff28a8b33cc7d
  bundle sha256 = 02ea8ceea23f9a2bee6366fabc470d823d99734741727c044c16ba9411788698

# STEP 1 — PLANT BK1: detach the receiver again (the original defect)
  planted. source sha256 = f69517ed109d11c33821ae2efeb0a5132029b1ab05c730704d621ccb77032cad  (differs: True)
  rebuilt. bundle sha256 = 19ae1d1833054a3ff4f966b656d8bad3a065159d8e8fb54b5a3510db5ed844af

--- the invocation line, verbatim from the bundle: ---
    const accessor = plugin.canvasDiagTargets;
    raw = accessor(rawPath);

CONTROL  plugin.canvasAdapters.size          = 1
CONTROL  plugin.canvasDiagTargets().length   = 1    (method-call form, receiver intact)
RESULT   resolver targets                   = 0
RESULT   resolver accessorError             = "canvasDiagTargets threw: Cannot read properties of undefined (reading 'canvasAdapters')"
RESULT   mountedPaths                       = []
RESULT   VIEW plane node count              = 0
VERDICT   RED   — the view plane is blind (VIEW UNAVAILABLE)

# STEP 2 — RESTORE by copy-aside
  source sha256 = 9d9a224443caddebff8d8c67e2f92ad0421bc456e397e4a5d3fff28a8b33cc7d
  SOURCE BYTE-IDENTICAL TO BASELINE: True
  bundle sha256 = 02ea8ceea23f9a2bee6366fabc470d823d99734741727c044c16ba9411788698
  BUNDLE BYTE-IDENTICAL TO BASELINE: True

--- the invocation line, verbatim from the bundle: ---
    raw = plugin.canvasDiagTargets(rawPath);

CONTROL  plugin.canvasAdapters.size          = 1
CONTROL  plugin.canvasDiagTargets().length   = 1    (method-call form, receiver intact)
RESULT   resolver targets                   = 1
RESULT   resolver accessorError             = null
RESULT   mountedPaths                       = ["_liveshare-test/smoke.canvas"]
RESULT   VIEW plane node count              = 11
VERDICT   GREEN — the view plane reads the mounted board
```

The **bundle** digest returning to `02ea8cee…` after a full rebuild is the stronger half of the restore
proof: it shows the compiler saw byte-identical input, not merely that a file was copied over a file.

**A confound I hit and am reporting rather than hiding (§3.6).** My first run of this cycle died mid-way on
a cp1252 `UnicodeDecodeError` while decoding npm's output — `S186` wearing the same hat it wore in B68 — and
left the **planted** bundle on disk. The next run therefore read a contaminated STEP-0 baseline and printed
`BUNDLE BYTE-IDENTICAL: False`, which was **false**: the restored digest was correct, the baseline reading
was not. I restored the source by copy-aside immediately, re-ran the whole cycle from a clean tree, and the
transcript above is that clean run. The earlier run's `False` is a measurement artefact of my own harness
and is recorded here so it is not mistaken for a finding.

### 3.3 BK2 — the R7 split is live, not decorative

Same harness, second control: the stub's accessor is replaced with one returning a string, and the resolver
is asked again.

| bundle | `targets` | `accessorError` |
|---|---|---|
| pre-fix `5054fde3…` | `0` | field does not exist — silently indistinguishable from "nothing mounted" |
| post-fix `02ea8cee…` | `0` | `"canvasDiagTargets returned string, not an array"` |

Both bundles go to zero targets. **Only the fixed one can say why.** That is the difference between the
plane refusing and the plane lying, and it is the property that actually cost B69 its attribution.

### 3.4 BK3 — the live behavioural control, NOT YET RUN

The plant above proves the plane can go red for a *broken accessor*. It does not prove the plane still goes
red for a **genuinely closed board** — the reading that would otherwise become a green that cannot fail.
That control needs the owner's hands and is step 3 of the runbook in §5. **I am reporting it as
outstanding, not as done.**

### 3.5 Breaks that reddened nothing

None planted that reddened nothing. Both plants reddened, and both reddened the thing they were aimed at.

---

## 4. Live evidence — status, stated exactly

| claim | status |
|---|---|
| The map is populated while the view plane reads unavailable — **live, three vaults** | ✅ **demonstrated** (§1.3, verbatim output) |
| The detached call is what empties it — **executed from the shipped bundle text** | ✅ **demonstrated** (§3.2, with a positive control) |
| The fixed bundle reads 11 nodes on the view plane — **executed from the shipped bundle text** | ✅ **demonstrated** (§3.2) |
| The fixed bundle reads 11 nodes **inside a running Obsidian** | ⏳ **NOT YET MEASURED — blocked on a reload I cannot perform** |

**I want this one stated plainly rather than softened.** The fixed bundle is staged on all three vaults and
verified byte-for-byte on disk (§5.1), but all three processes are still running the **old** bundle from
memory. There is no reload route in the control surface — I checked every one of the 43 `case` handlers in
`routeCommand`; `canvas.undo` invokes one specific registered Obsidian command id and nothing exposes an
arbitrary command or an app reload. So the last row is the owner's to close, and §5 is written so it takes
about ninety seconds.

Live evidence that the *staging* is correct, taken after the copy:

```text
--- BEFORE ---
  A  5054fde30be2c209    5828488 B  == expected old
  B  5054fde30be2c209    5828488 B  == expected old
  C  5054fde30be2c209    5828488 B  == expected old
--- AFTER ---
  A  02ea8ceea23f9a2b    5834351 B  OK
  B  02ea8ceea23f9a2b    5834351 B  OK
  C  02ea8ceea23f9a2b    5834351 B  OK
```

---

## 5. What the Dispatcher must ask the owner to do

### 5.1 State the vaults are in right now

- `main.js` on **A**, **B** and **C** is the fixed e2e bundle `02ea8ceea23f9a2b`, 5 834 351 B.
- The previous bundle `5054fde30be2c209` is backed up at `h:/tmp/b70_backup_5054fde/` (one file per vault,
  digests verified after copy).
- `manifest.json`, `styles.css` and `data.json` were **not touched, not read and not copied**.
- All three processes are still executing the old bundle. **Nothing about the vaults' behaviour has changed
  yet**, and the live-share session is still up (room `32883766-ec33-473d-b34a-e62a4685f293`, A host, B and
  C guests — re-read `session.info`, roles migrate, `S139`).

### 5.2 The ask — reload, then three checks

> **Step 1 — Reload all three Obsidian windows.**
> `Ctrl+P` → **"Reload app without saving"** in each of the three windows (A, B, C). A full app restart also
> works. All three must be on the new bundle before anything is armed, or the dump mixes two builds.

> **Step 2 — Confirm the fix, 10 seconds, no gestures needed.**
> ```bash
> python h:/tmp/b70_view_plane_probe.py
> ```
> **Expected:** `mountedPaths = ['_liveshare-test/smoke.canvas']` and
> `view available=True count=11` on all three peers.
> **If instead** `view available=False reason='canvasDiagTargets threw: …'` — the fix did not land or the
> reload did not take; the reason will now say which.
> **If** `reason='no canvas view is mounted…'` — the board simply is not open on that peer; open it
> (`canvas.open`, runbook §2 STEP 0+1) and re-run.

> **Step 3 — BK3, the live negative control (§3.4). Please do not skip this one.**
> On **C only**: close the `smoke.canvas` tab, re-run the probe, then reopen it and re-run.
> **Expected:** C flips to `available=False reason='no canvas view is mounted for this path on this peer'`
> while A and B stay at 11 — then back to 11 on reopen. That is the plane proving it can still say *no*,
> and proving it says *no* for the right reason. Without it, an 11 on every peer is a green nobody has
> shown can fail.

> **Step 4 — the `H8` attribution run.** Standard B68 runbook (`ImplementationReport_B68_Diagnostics.md` §2),
> unchanged, with the board open on all three:
> ```bash
> cd "h:/My Code/AgenticWorkspace/Projects/_external/liveshareCollab/obsidian-live-share"
> BOARD="_liveshare-test/smoke.canvas"
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op arm  --label b70-h8-drag
> #   owner: ONE drag of card1 on the HOST, ~100 px. Nothing else. No scroll, no pan. Wait ~3 s.
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --path "$BOARD" --op dump --label b70-h8-drag
> python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --op clear --label teardown
> ```
> **`card1` is the right card to drag** — it is the one `S189` already characterised, and its board carries
> the 6 edges `H8` needs.
>
> **What to read in the dump, and it is now readable for the first time:** the VIEW rows in the delta table.
> `H8` predicts that on the **guests**, a drag of an edge-endpoint node moves **more nodes on the view plane
> than on the doc plane** — the doc shows one node moving (`S189` measured exactly that), while a
> `reloadCanvasData`/`setData` repaint touches the whole board. **A view delta on a node whose doc and file
> geometry did not change is `H8` caught in the act**, and it will appear as an `UNATTRIBUTED` view row.
> The ledger's `viewSinksPatched` rows should now also be populated, since `patchedPaths` was empty on every
> previous dump for the same reason the census was.

> **Step 5 — if the owner wants the vaults back on the old build for any reason:** copy the three files from
> `h:/tmp/b70_backup_5054fde/` back over `<vault>/.obsidian/plugins/live-share/main.js` and reload. Nothing
> else needs undoing.

---

## 6. Found and not fixed

### 6.1 `S191` — the same call shape survives at two more sites *(allocated, open)*

`safeCall(fn)` (`e2e-control.ts:2809`) invokes its argument with no receiver, and two callers pass an
**Obsidian method** rather than an object:

```text
resolveVaultPath : safeCall(adapter?.getBasePath)              e2e-control.ts:2831
resolveVaultName : safeCall(plugin.app?.vault?.getName)        e2e-control.ts:2840
```

**Demonstrated** (`h:/tmp/b70_sibling_probe.py`) with `safeCall`, `resolveVaultName`, `resolveVaultPath` and
`nonEmptyString` extracted verbatim from the shipped bundle and run against a prototype method that reads
`this`:

```text
CONTROL  method-call form vault.getName()        = "ObsidianOrga"
CONTROL  method-call form adapter.getBasePath()  = "H:/Developement/_NeuralAngels/ObsidianOrga"
RESULT   resolveVaultName(plugin)                = ""
RESULT   resolveVaultPath(plugin)                = null
```

Which is exactly what the live rig reports, on all three peers, while `vaultId` — `app.appId`, a **property**
read — comes back populated:

```text
A  "vaultId": "703aa794cc73a117", "vaultName": "", "vaultPath": null
B  "vaultId": "55a4253eb7a90dde", "vaultName": "", "vaultPath": null
C  "vaultId": "c44c0000947c0000", "vaultName": "", "vaultPath": null
```

**Not separated, and it matters:** I did not read Obsidian's own source, so "the members exist and lose
`this`" and "the members are absent on this build" are both consistent with a blank. The *shape* is proven
vulnerable; the *cause of these particular blanks* is strongly indicated, not proven. Left unfixed because
the batch's scope is the view-plane accessor. One-line fix at each site: `safeCall(() => vault.getName())`.
Consequence today: a three-vault session labels dumps `A`/`B`/`C` by **port order**, and the one field that
could independently name which vault a dump came from is empty.

There is a third instance of the shape at `:2852`, `safeCall(plugin.hasCanvasSurface)`, which is **currently
harmless** — `hasCanvasSurface` does not exist on `LiveSharePlugin` at all, so `safeCall` returns
`undefined` and the intended `Boolean(plugin.canvasSync)` fallback runs. It becomes a live bug the day
anyone implements that member as a method. Folded into `S191`.

### 6.2 The exhaustiveness claim, and how it was made

§3.4 says grep cannot support an exhaustiveness claim, so I did not make one from grep. I enumerated the
**44 function-typed members of `E2EPluginLike`** by parsing the interface body, then checked every
`plugin.<member>` occurrence in the file that is not immediately followed by `(`. Result: 30 hits, of which
24 are `typeof … === "function"` guards (no invocation, safe), 4 are comment prose, 1 was the defect, and 1
is `safeCall(plugin.hasCanvasSurface)` (§6.1). **The method's limit, stated:** this follows the declared
interface, so it covers members reached through `plugin`. It does **not** cover a function detached from an
object obtained *from* the plugin (the `safeCall(adapter?.getBasePath)` shape) — I found those two by
reading `safeCall`'s call sites directly, which is a different method with a different blind spot. Anything
detached through a third variable would be missed by both.

### 6.3 Residuals I deliberately left alone

- **`mountedPaths()` still returns a bare `string[]`** and so still cannot express an accessor failure in
  the dump's top-level field. It is now unreachable as a *silent* failure — `install()`'s note and the view
  plane's `reason` both surface the throw on the same dump — so I left the field's shape alone rather than
  widen a dump's schema (`CANVAS_DIAG_PROTO` would have to bump) for a case that is now reported twice
  elsewhere. Worth a line in a future package, not a signal.
- **`H8` itself is untouched**, as instructed. `main.ts:3231-3235` still escalates a moved edge-endpoint
  node into a whole-board `reloadCanvasData`/`setData`, and `main.ts:4095` (`applyCanvasNodeRevert`, no
  mute) still differs from `main.ts:3176` (`reconcileLiveCanvas`, mute armed). Neither was read beyond
  confirming they are where the brief said they are.
- **No test was added for the accessor**, per the suspended mandate. I note without acting on it that
  `S190`'s real lesson is a *seam* with no coverage, and that the natural closure — a source-census test in
  the §3.11 style asserting the rig calls its plugin accessors in method form — would be a good candidate
  the day the mandate lifts.

---

## 7. Register

`S190` and `S191` allocated and written into `SIGNAL_REGISTER.md` §3a; `NEXT_FREE` bumped `190 → 192` at
`check_signal_register.py:53`. The checker was run **after** every file this report covers was on disk —
including this report — so the result covers the change it is supposed to cover (§3.2's second Dispatcher
error, not repeated here):

```text
$ python workflowArtifacts/canvas-v2/check_signal_register.py
scanned 255 files under canvas-v2/  (control: all classes proved)
baselined debt: 136 citations across 62 keys
clean - no NEW violations. (29 baselined citations have since gone)
EXIT=0
```

`control: all classes proved` is the line that matters — the checker reports nothing at all if its own
positive control fails, so a clean run with the control silent would be worthless.

### Final gate re-measurement

Re-run on the restored tree after the plant cycle and after every artefact was written, in this session:

```text
TSC_OK
 Test Files  444 passed (444)
      Tests  3375 passed (3375)
```

Integrity check at close: `plugin/src/testing/e2e-control.ts` = `9d9a224443caddeb…`, byte-identical to the
copy-aside; `plugin/main.js` = `02ea8ceea23f9a2b…`, the bundle staged on all three vaults.
`S180` NUL scan: **0** NUL bytes in each of the four changed text files.

---

## 8. Files changed

| file | change |
|---|---|
| `plugin/src/testing/e2e-control.ts` | the fix (§2). `sha256 9d9a224443caddeb…` |
| `workflowArtifacts/canvas-v2/SIGNAL_REGISTER.md` | `S190`, `S191` rows |
| `workflowArtifacts/canvas-v2/check_signal_register.py` | `NEXT_FREE = 192` |
| `workflowArtifacts/canvas-v2/ImplementationReport_B70_ViewPlaneAccessor.md` | this file |
| `plugin/main.js` | rebuilt e2e bundle (build output) |
| `<3 vaults>/.obsidian/plugins/live-share/main.js` | staged, backed up to `h:/tmp/b70_backup_5054fde/` |

Not committed — the Dispatcher verifies and commits on this project.

**Secrets:** no `data.json` was read, copied, hashed or referenced. No credential, token or passphrase
appears in this report, in any script written for it, or in any tool call made during it.
