# Implementation Report — WP72 / C72

**`canvas.setFlag`: the borrow-clobber and the inert flag map**

Batch **B10b** · Worker 3 · 2026-08-04
Charter: `workflowArtifacts/canvas-v2/TaskCharter_WP72_SetFlagBorrowClobber.md`
Status: **DONE** · risk_flag: **NONE**

---

## 1. Verification against the current tree (hard-won rule 12)

The charter's §3 description was written by another batch. Re-traced against the tree at the B10b
baseline (`fd7de1f`, `plugin/` clean) before anything was changed. **Both defects confirmed exactly
as described; one detail corrected and one addition found.**

| Claim | Verified | Where |
|---|---|---|
| `setFlag` tests `Object.prototype.hasOwnProperty.call(plugin.settings, name)` and, on the true branch, assigns and calls `plugin.saveSettings?.()` | **CONFIRMED** | `e2e-control.ts:991–1002` (pre-repair) |
| `runtimeFlags` is written at exactly one site and read by nothing in `plugin/src` | **CONFIRMED** | declared `:803`, written `:999`; a repo-wide grep for `runtimeFlags` returns **only those two lines** |
| `setFlag` returns `{set:true}` for any name whatsoever | **CONFIRMED** | the single unconditional `return` at `:1001` |
| `E2EControlHost.setFlag` at `:286`, the `case "canvas.setFlag"` route at `:392–393` | **CONFIRMED**, line numbers exact | — |
| **C51 AC3 and the clobber are cleanly separable, and the tree proves it** | **CONFIRMED** | C51 AC3 is unimplemented (WP51 has generated tests under `workflowArtifacts/`, reverted from `plugin/src/` at `6b20c17`) while the clobber exists independently — i.e. today's state is exactly "AC3 unsatisfied *and* `data.json` rewritten for every accepted name" |

**Correction to the charter's §3:** it lists `useCanvasBinding`, `showCanvasPresence`,
`showCanvasCursors`, `sharedFolder`, `roomId`, `serverUrl` as "existing keys" that take the
persisting branch. That is right about the *production* settings shape, but the branch is decided by
`hasOwnProperty` on the **live object**, not by the declared type — so which names clobber depends on
what the instance actually loaded, not on `LiveShareSettings`. It makes the defect broader, not
narrower, and the repair is unaffected.

**Addition found while tracing, and it is what made the whole WP implementable without a §7
licence** — see §3.

---

## 2. What changed

One file: `plugin/src/testing/e2e-control.ts`. Nothing outside `plugin/src/testing/`.

- **`setFlag` no longer persists, by any path, for any name.** `void plugin.saveSettings?.()` is
  **removed**, not guarded behind a caller-supplied option. AC1 says removed for a reason the charter
  spells out: a guard leaves the clobber one argument away and makes the gate's data safety depend on
  every future caller remembering.
- **`plugin.saveSettings` stays on `E2EPluginLike`.** It is the plugin's own legitimate persistence
  API and the interface describes the plugin, not this host's use of it. Removing the field would
  also have broken the object literals in inherited fixtures (`e2e-control.test.ts:177`) on an
  excess-property check — a type change dressed as a cleanup. Nothing in `buildPluginHost` calls it,
  and `tp1` pins that structurally.
- **`settingsOverrides`** — the session-scoped override journal, one entry per overridden key holding
  the value the instance held **before the first** override. It lives in the `buildPluginHost`
  closure, so it dies with the host.
- **`clearFlags()`** — the reversal. Restores each overridden key in memory, drops keys that did not
  exist before, empties the runtime-flag stash, and is idempotent. It deliberately does **not** call
  `saveSettings` either: writing the restore to disk would be a second clobber of the borrowed file.
- **`flagConsumer(name)`** — read-only, total, pure classification: `"plugin.settings"` for an
  existing settings key, `null` for everything else (because `runtimeFlags` is read by nothing).
- **Router — `case "canvas.setFlag"`** gained (a) a refusal of any request carrying `persist`, under
  the distinct named reason `persistence-requires-file-write`, refused *before* the host is reached;
  and (b) the three-way disposition of §3.
- **Router — `case "canvas.clearFlags"`**, on the existing `POST /command` envelope. No new
  transport, no new import, still exactly one `.listen(`.

---

## 3. AC3 without a §7 licence — the seam that made it possible

**This was the sharpest question in the WP, and I nearly escalated it.**

`plugin/src/__tests__/e2e-control.test.ts:253` — inherited, pre-existing at the batch baseline —
pins the *defective* behaviour by name:

```
it("setFlag writes a known setting and stashes unknown flags without touching settings", () => {
  expect(host.setFlag("debug", true)).toEqual({ set: true });      // applied class — fine
  expect(host.setFlag("madeUpFlag", 1)).toEqual({ set: true });    // INERT class — AC3 forbids
```

AC3 forbids `{set:true}` for a name accepted only into a store nothing reads, and `toEqual` is exact,
so no added field and no changed value survives it. **WP72 holds no §7 licence of any class**, and
the standing instruction is to escalate rather than amend.

**The resolution came from the tree, not from a ruling.** B9b's own generated WP51 suite
(`workflowArtifacts/canvas-v2/tests/visible/WP51/test_tp4_unknown_flag_rejected_visible.test.ts:10-13`)
had already hit the identical collision on the adjacent criterion and recorded its answer in a header
comment:

> *"The boundary is `routeCommand` — the only path a driver can reach. The direct host method keeps
> its pre-WP51 behaviour, which `e2e-control.test.ts` … pins and which this WP holds no licence to
> change."*

That precedent applies verbatim here. AC3's subject is *"the return value"* of the **command**, and
the command surface is `routeCommand`; the control server routes every request through it and no
driver can reach `host.setFlag` directly. **So the three dispositions are rendered at the router, the
direct host method is left exactly as it was, and no inherited assertion is touched, amended,
weakened, retitled or skipped.** Zero §7 licences requested; zero needed.

Checked, not assumed — the two inherited assertions that could have collided:

| Inherited assertion | Path | Class | After WP72 |
|---|---|---|---|
| `e2e-control.test.ts:257/260` — `host.setFlag("debug"…)`, `host.setFlag("madeUpFlag"…)` | **direct host method** | untouched by this WP | `{set:true}` both — **unchanged, green** |
| `wp46/test_probe_side_effect_free_visible.test.ts:111` — `routeCommand(… name:"debugFlag" …)` `.toEqual({status:200, body:{ok:true, result:{set:true}}})` | router | `debugFlag` **is** a settings key in that fixture (`:19`) ⇒ **applied** class | `{set:true}`, exact shape preserved — **green** |
| `e2e-control.test.ts:78` — `routeCommand` on a *fake* host with a `setFlag` spy | router | fake host has no `flagConsumer` ⇒ "cannot classify" ⇒ pre-WP72 answer verbatim | asserts only `status===200` — **green** |

The applied class's response is **byte-identical to before** (`{set:true}`, no added keys). That is
deliberate: it costs AC3 nothing (the three still differ) and it keeps every existing consumer valid.

**This is NOT C51 AC3 and does not re-implement it.** C51 AC3 is the *rejection rule* — which names
get refused. WP72 changes only the *truthfulness of the answer*: the value is still stored exactly as
before, and it is now **reported** as inert instead of as success. When WP51 lands, names it rejects
move from the `inert` disposition into `refused`; nothing here has to move for that to happen.
Deciding here which names are rejected would have absorbed WP51's criterion, which this WP is
forbidden to do.

### The three responses, measured (AC3's own falsification)

One call per class, all three compared as whole responses:

| Class | Call | Response |
|---|---|---|
| **applied** | `{name:"useCanvasBinding", value:true}` | `{status:200, body:{ok:true, result:{set:true}}}` |
| **inert** | `{name:"madeUpFlag", value:1}` | `{status:200, body:{ok:true, result:{set:false, disposition:"inert", consumer:null, reason:"no code path consults the flag 'madeUpFlag'; it was stored in the host's runtime-flag map, which nothing reads"}}}` |
| **refused** | `{name:"useCanvasBinding", value:true, persist:true}` | `{status:400, body:{ok:false, error:"refused: persistence-requires-file-write — canvas.setFlag never writes data.json for any name; the settings file is borrowed by the rig"}}` |

The oracle is `new Set([...].map(JSON.stringify)).size === 3` over the **whole** responses, not a
single negative case — the charter warns that a repair answering `{set:true}`/`{set:false}`/
`{set:false}` has merged two of the three and would go green against a test that only checked "not
always true". A merged pair reddens here even if every individual expectation still passed. Blind
set 1 attacks the same criterion as an **equivalence partition** over twelve calls with the names
erased from the response signatures, so a "distinguishable per *name*" fake fails it too; blind set 2
runs the three calls against a real `createControlServer` on `127.0.0.1:0` and compares status code,
`Content-Type` and decoded body — i.e. what a driver actually sees on the wire. Mutation-checked: the
charter's `{true}/{false}/{false}` fake reddens **6** blind tests, and merging inert into applied
reddens **4**.

**⚠ Precision the criterion deserves — the demonstrated triple is not three *name* classes.** AC3's
recipe says *"calling `setFlag` with a name in each class"*, and today **no name produces a
refusal**: WP72's only refusal is triggered by an **argument** (`persist`), and the empty-name 400 is
a pre-existing malformed-argument error, not a disposition. So what is demonstrated above is
*existing key* / *unknown key* / *any key + `persist`*. That is defensible — §2 hands name-rejection
to WP51, and refusing names here would have re-implemented C51 AC3 — but stating it as three name
classes would overclaim. **The third class becomes name-reachable when WP51 lands**, and that is the
point at which AC3's recipe is satisfiable to the letter.

---

## 4. AC1 — the sha256 demonstration

**Hash-only, and no credential anywhere.** No real vault was opened, no real `data.json` was read,
and no byte, key value or credential appears in this report, in any fixture, in any log or in any
test. Both Obsidian vaults are owned by the sibling batch B10a this run and were not touched.

The fixture is a throwaway `data.json` created per test in the OS temp dir with deliberately
non-secret contents, written by a `saveSettings` that really does serialise the live in-memory
settings over the file — exactly as the production one does. That is what makes the oracle **able to
fail**.

| Measurement | Result |
|---|---|
| sha256 before / after `setFlag` of five existing settings keys (`useCanvasBinding`, `showCanvasPresence`, `sharedFolder`, `roomId`, `serverUrl`) | **match** |
| `saveSettings` spy across those five calls | **0 calls** |
| the in-memory effect over the same five calls | **applied** — so the match above is not "nothing happened" |
| sha256 before / after `setFlag` of an unknown name | **match**, 0 `saveSettings` calls |
| sha256 across the whole command path — four `canvas.setFlag` routes plus `canvas.clearFlags` | **match**, 0 `saveSettings` calls |
| **FALSIFICATION** — the same oracle, with the call the old `setFlag` made, made explicitly | **sha256 differs.** The oracle reddens under exactly the removed behaviour. A perturbation that changed nothing would have been a finding, not a null result. |
| `persist:true` at the router | 400, named reason, `setFlag` spy **0 calls**, settings unchanged, sha256 **match** — I11 REFUSAL NEVER DESTROYS |
| `persist:false` | also 400 — the behaviour is removed, not gated; no argument value turns it on |

### Grep evidence that no `saveSettings` call remains reachable from `setFlag`

Asserted in-suite (`tp1`, "STRUCTURAL"), over the module source with block and line comments
stripped — the module documents the removed call at length and a prose mention must neither satisfy
nor break the oracle:

- `/saveSettings\s*\?\.\s*\(/` → **0 matches**
- `/\.saveSettings\s*\(/` → **0 matches**
- `saveSettings?` (the interface field) → still present

---

## 5. AC2 — session-scoped and reversible

| Property | Evidence |
|---|---|
| applied to in-memory state only | `tp1`, `tp2` — every sha256 pair matches |
| recorded so the instance can be returned through the protocol | `routeCommand(… "canvas.clearFlags")` → `{restored:["sharedFolder","useCanvasBinding"], cleared:[]}`, settings back to loaded values |
| the prior value is the **loaded** one, not the previous override | three successive `setFlag("roomId", …)` then `clearFlags()` restores the original, not `"second-override"`. A journal that recaptures on every call fails this and silently loses the loaded value. |
| does not survive the instance | a second `buildPluginHost` over the same plugin holds no journal (`{restored:[], cleared:[]}`) and cannot reverse the first host's override; the original host still can |
| **"a plugin whose `saveSettings` is invoked by an unrelated code path must still restore to the borrowed bytes"** | after `setFlag` × 2 + `clearFlags`, an unrelated `plugin.saveSettings()` writes bytes whose **sha256 equals the borrowed baseline** |
| **FALSIFICATION of that clause** | the same sequence *without* `clearFlags` → the unrelated save writes a **different** sha256. Preventing the write is not enough; the in-memory copy has to be un-poisoned, and this pair proves the difference is real. |
| idempotent | a second `clearFlags()` is `{restored:[], cleared:[]}`, not an error |
| a host that cannot reverse | structured 400, never a crash |

**⚠ AC2's "a key that did not exist is removed, not left as `undefined`" is satisfied *vacuously*,
and that is recorded rather than glossed.** The journal was deliberately simplified from
`Map<string, {existed, prior}>` to `Map<string, unknown>`, because the `existed: false` branch was
**unreachable through the protocol**: `setFlag` journals only keys that already exist on
`plugin.settings`, and an unknown name goes to `runtimeFlags` instead. An untestable branch is an
invitation to a test that cannot fail, so it was removed and the reason written into the code. The
strongest available observable is pinned instead — unknown names never enter `settings`, and
`Object.keys(settings)` is identical (same members, same order) before and after a full
setFlag/clearFlags cycle. **Consequence to carry forward: if WP51 or a later WP ever lets `setFlag`
create a settings key, `clearFlags` will leave `key: undefined` behind and the journal must regain
the `existed` flag at that moment.**

---

## 6. AC4 — the production bundle, freshly built

Measured on a bundle built in this batch, not on an inherited measurement. Re-run at close with the
hash pinned, because `plugin/main.js` turned out to be an unreliable oracle — see the warning below:

```
npm run build   → BUILD_EXIT=0
main.js         → 759 892 bytes, mtime 15:09:22
sha256          → 58FDA6F8A9F2534FB4C4D08D4B45AC3C4DB6BFC8BD06B47BA84899E9F23946BC
__LS_E2E__        = 0      e2eControlPort    = 0
LIVESHARE_E2E     = 0      e2e-control       = 0
flagConsumer      = 0      clearFlags        = 0
settingsOverrides = 0      runtimeFlags      = 0
canvas.setFlag    = 0      canvas.clearFlags = 0
buildPluginHost   = 0      sourceMappingURL  = 0
```

`sourceMappingURL = 0` is carried deliberately: it is the cheapest positive proof that the bytes
measured are the **production** bundle and not the ~3.6 MB inline-sourcemap e2e one.

> **⚠ `plugin/main.js` is a shared mutable artefact and is NOT a safe AC4 oracle on its own.** It is
> untracked, and whichever of `build` / `build:e2e` / `dev` ran last wins — including a build started
> by a **concurrent batch**. During this batch's blind-set authoring the file was observed as a
> 3.6 MB **e2e** bundle containing `e2e-control`, `settingsOverrides`, `runtimeFlags` and
> `canvas.clearFlags`; the sibling batch B10a was building at the time. A report or test that greps
> it without rebuilding in the same breath is red-or-green **by accident**, which is the vacuity class
> this run exists to eliminate. The block above was produced by a single command that builds and then
> immediately hashes and scans, and the hash is recorded so the measurement is checkable rather than
> merely asserted. WP72's blind set 2 avoids the file entirely: it builds the production bundle **in
> memory** with esbuild (`write:false`, `__LS_E2E__:"false"`), scans 16 markers, and falsifies itself
> against the e2e bundle (0/16 vs 16/16). **Recommendation for W4 and for C46's W4-1 counter-check:
> use the in-memory build, not the file.**

The whole of `src/testing/` still tree-shakes out, and the four symbols WP72 added are absent from
the production bundle. Per the Dispatcher's 2026-08-04 correction, `__LS_E2E__ = 0` on its own is
**not** a distinguishing check (esbuild's `define` substitutes the identifier in every mode); the
marker triple and the four new symbols are what carry the claim here.

Structurally (`tp4`): `e2e-control.ts` imports nothing outside WP49's frozen allow-list, still opens
exactly one socket and creates exactly one server, no canvas module mentions `setFlag` / `clearFlags`
/ `flagConsumer` / `runtimeFlags` / `settingsOverrides` / `e2e-control` / `__LS_E2E__`, no canvas
module imports `testing/`, and `main.ts` is untouched. `git status` confirms the only changed source
file is `plugin/src/testing/e2e-control.ts`.

---

## 7. Test status and gates

Visible set: `workflowArtifacts/canvas-v2/tests/visible/WP72/`, mirrored to
`plugin/src/__tests__/wp72/` **after** implementation (the B9b lesson: mirroring a
generated-but-unimplemented suite breaks `npm run build` repo-wide).

| Gate | Result |
|---|---|
| `tsc --noEmit -skipLibCheck` | **clean** (`TSC_EXIT=0`) |
| `npm run build` | **PASS** |
| `npm test` (full plugin suite) | **303 files / 1856 passed / 0 failed** — baseline was 299 / 1833, and 1833 + 23 = 1856 reconciles exactly against this WP's four visible files (6 + 7 + 5 + 5) |
| targeted run — `wp72` + `e2e-control` + `wp46` + `wp47` + `wp49` | **24 files / 166 tests, 0 failed** |
| blind sets 1 and 2 (staged, run, removed) | **20 / 0** and **19 / 0** — both green on the first implementation attempt |

---

## 8. Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| **AC1** — no `saveSettings()` and no other write to `data.json`, by any path, for any name; the behaviour removed rather than guarded; a flag requiring persistence refused under a distinct named reason; demonstrated by sha256 before/after | **MET** | §4 |
| **AC2** — in-memory override scoped to the session, recorded, reversible through the protocol, does not survive the instance; nothing on the applied path reaches persistence; an unrelated `saveSettings` still restores the borrowed bytes | **MET** | §5 |
| **AC3** — the return value distinguishes applied / refused / inert; `{set:true}` only for a name applied to a path that consumes it; three responses shown to differ | **MET** | §3 — and met **without** amending any inherited assertion, via the router boundary B9b's WP51 suite had already established |
| **AC4** — no production canvas module gains a branch; production bundle unchanged; nothing outside `plugin/src/testing/` modified | **MET** | §6 |

---

## 9. Risks and notes for Worker 4

- **Unexercised on a real host.** No control endpoint has ever answered here. Every criterion is
  decided under the `plugin/` vitest gate and nothing is claimed about a live instance.
- **`host.setFlag` called directly still answers `{set:true}` for an inert name.** This is the
  deliberate boundary (§3) and no driver can reach it, but it is the one place where the old
  vacuity survives. **When WP51 lands its rejection rule, the two should be reconciled at that
  point** — WP51 is the WP with the licence question already on its table.
- **`flagConsumer` returns `null` for every non-settings name, including future genuine flags.**
  That is correct *today* (nothing reads `runtimeFlags`) and is the register WP51 will populate. If
  WP51 introduces a real runtime flag without extending `flagConsumer`, the command will report a
  working flag as inert — annoying, but fail-closed, and never the reverse.
- **⚠ RESIDUAL DESIGN RISK, not an AC violation: the window between `setFlag` and `clearFlags`.**
  AC1 stops the *command* writing the file, but `setFlag` still mutates `plugin.settings` in place,
  and **nothing enforces that `clearFlags` is ever called.** Any unrelated `saveSettings()` in that
  window — the settings tab, an autosave, `onunload` — writes the override into the borrowed
  `data.json`. AC2's last clause acknowledges exactly this and §5's falsification pair *demonstrates*
  the sha256 moving when the reversal is skipped, so the risk is measured rather than suspected.
  **`clearFlags` is a protocol command and the rig has to issue it in teardown; WP70/WP7 own that
  sequencing.** A gate run that sets a flag and never clears it is a run whose data-safety verdict is
  one unrelated save away from failing.
- **Foreign edits observed in the tree, not touched and not fixed:** the sibling batch B10a has
  `workflowArtifacts/canvas-v2/WP70_PinnedDecisions.md` modified and
  `workflowArtifacts/canvas-v2/tests/visible/WP70/` untracked. Reported per the batch contract; not
  staged in this batch's commit.
