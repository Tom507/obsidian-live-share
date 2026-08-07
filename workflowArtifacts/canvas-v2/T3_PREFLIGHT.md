# T3 Real-Obsidian Gate — Pre-flight (measured 2026-08-02, Dispatcher)

> Measured facts for batch **B9b** (WP50, WP51, WP7). Everything here was **observed on this host**,
> not inferred. Read this before writing the WP50/WP51 charters or touching the rig — three of these
> facts contradict a plausible assumption and one of them is a hang.

---

## Host coordinates

| | |
|---|---|
| Obsidian binary | `C:\Users\tschm\AppData\Local\Programs\Obsidian\Obsidian.exe` |
| Obsidian running? | **No** — 0 processes at measurement time. The rig must launch it. |
| Vault A | `H:\Developement\_NeuralAngels\ObsidianOrga` (registry id `703aa794cc73a117`) |
| Vault B | `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie` (registry id `55a4253eb7a90dde`) |
| Vault registry | `C:\Users\tschm\AppData\Roaming\obsidian\obsidian.json` |

**Vault B's path contains spaces.** Every invocation must quote it. This host already has a recorded
`run_command` nested-quote trap; combined with the space this is the single most likely mechanical
failure of the batch. Prefer `run_python` with an absolute script path (BUILD_SPEC §7 already mandates this).

### Stray registry entry — do not "clean it up"

`obsidian.json` registers a **third** vault: `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie\.obsidian`,
i.e. vault B's own `.obsidian` folder registered as if it were a vault (hence the nested `.obsidian/.obsidian`
visible in vault B). It is `open: false` and harmless. **Leave it alone** — it is user state, it is not
ours to repair, and a rig that rewrites the vault registry is a rig that can lose the user's vault list.
Recorded only so a later agent does not read it as rig damage it caused.

---

## Plugin identity — the trap the infra already dodged

- **Plugin id is `live-share`.** The install path is `<vault>/.obsidian/plugins/live-share/`.
- **`obsidian-live-share` is the *repo folder* name, not the plugin id.** A charter that says
  `.obsidian/plugins/obsidian-live-share` is wrong and will silently install nothing.
- The T3 infra is **already correct** on this point — `tools/obsidian_e2e/constants.py:84` pins
  `PLUGIN_ID = "live-share"` with that exact warning in a comment. No fix needed; verified, not assumed.

Other plugins **installed** in both vaults (must survive the run untouched): `lan-vault-sync`, `obsidian-git`.

> ### ⚠ CORRECTION (2026-08-04) — this section was wrong, and it was wrong in the dangerous direction
>
> The original text named **`lan-vault-sync`** as the second sync engine to disposition. **That is false.**
> `community-plugins.json` is Obsidian's *enabled* list, it is byte-identical in both vaults, and it
> contains exactly `obsidian-git` and `live-share`. **`lan-vault-sync` is installed but NOT enabled and
> cannot run.** The error propagated from here into `DISPATCHER_STATE.md` and four charters.
>
> **The engine that IS enabled and was never dispositioned is `obsidian-git`** — and it is a worse hazard
> than the one I named. Measured in both vaults:
>
> | | vault A | vault B |
> |---|---|---|
> | `autoPullOnBoot` | **true** | **true** |
> | working tree | **13 dirty entries** | **14 dirty entries** |
> | `origin` remote | configured | configured |
>
> Both vaults are **real git working trees with remotes**, already dirty, set to **pull automatically at
> launch** — which is precisely the moment the gate starts Obsidian. An auto-pull onto a dirty tree can
> merge, conflict, or check out over local state, and it does so *before* any Canvas V2 code runs. A
> failure caused this way would look like a sync bug and would not be one.
>
> **Ruling: `obsidian-git` is disabled in both vaults for the duration of the gate run and restored
> afterwards, and the disposition is recorded.** This is not the discretionary call the original text
> described. `autoSaveInterval` and `autoPushInterval` are both `0`, so nothing is pushed — but the
> boot-time pull alone is disqualifying.
>
> Standing lesson: **"installed" is not "enabled".** Read `community-plugins.json`, not the plugins
> directory listing. I read the directory and reported it as the enabled set.

---

## Installed build — production, as expected

Both vaults carry an **identical** install (byte-identical sizes, same timestamps):

| | |
|---|---|
| `manifest.json` | id `live-share`, version **0.6.1**, `minAppVersion` 1.11.0 |
| `main.js` | 626 711 bytes, dated 2026-07-26 |
| `__LS_E2E__` occurrences in `main.js` | **zero** |

> ### ⚠ CORRECTION (2026-08-04) — this evidence was NOT distinguishing
>
> The original text read that zero `__LS_E2E__` occurrences *"confirms the installed build cannot host
> the control server"* and *"doubles as W4-1's C46 production-bundle counter-check evidence"*.
> **Both claims rested on a test that cannot tell the two builds apart.**
>
> Measured by WP69: **`__LS_E2E__` occurs zero times in the e2e bundle too.** esbuild's `define`
> substitutes the identifier at compile time, so the *name* never survives into any bundle, in either
> mode. A count of zero is therefore consistent with **every** build and distinguishes nothing.
>
> The **distinguishing** signature is the marker triple (`e2eControlPort`, `LIVESHARE_E2E`,
> `e2e-control`): production is **0 / 0 / 0**, e2e is **1 / 1 / 2**. Together with the size difference
> (626 711 B production vs ~3.6 MB inline-sourcemap e2e) that is what actually establishes which build
> is installed.
>
> **The conclusion was right and the reasoning was weak** — the installed builds *are* production, on
> the marker triple and the size. But **W4-1 is NOT discharged by this file**; it must be re-established
> against the marker triple on a freshly built bundle. I recorded it as partially discharged on the
> strength of a check that could not fail. That is the same class of error this whole run exists to find,
> committed in the pre-flight itself.

Pre-existing backups already in both plugin dirs — **not ours, do not overwrite**:
<!-- Updated: styles.css.bak added — the list was THREE and the measured directory contains FOUR; found by B9b's vault measurement 2026-08-04 -->
`main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`, **`styles.css.bak`**.
The rig has its own backup namespace (`data.json.e2e-original`, `.e2e-provision.json`); use it.

**⚠ This list was wrong until 2026-08-04 — it named three backups and there are four.** The full
measured plugin-directory listing, identical in both vaults, is:

```
data.json · main.js · main.js.0.5.9.bak · main.js.bak · manifest.json · manifest.json.bak
styles.css · styles.css.bak
```

The omission mattered: a WP69 install that reasoned *"the backup set is the three the pre-flight
names, so `styles.css.bak` must be mine to reuse"* would have written over an owner file. Any
future reader should treat this list as **measured on the day**, not as a fixed fact — the same
class of error as the `lan-vault-sync`/`obsidian-git` correction below.

---

## ⚠ The dev build has no one-shot mode — this WILL hang the batch

`plugin/esbuild.config.mjs` decides everything on `process.argv[2] === "production"`:

```js
if (prod) { await ctx.rebuild(); process.exit(0); }
else      { await ctx.watch(); }          // ← never returns
```

| Command | `__LS_E2E__` | Terminates? |
|---|---|---|
| `npm run build` (`… production`) | `"false"` | yes |
| `npm run dev` (no argv[2]) | `"true"` | **NO — watch mode, runs forever** |

So the build that the gate needs is exactly the build that **never exits**. A `run_python` /
`run_command` followed by `await_console` on `npm run dev` will block until the timeout, and the
obvious diagnosis ("the build is slow") is wrong.

**There is currently no supported one-shot dev build.** WP50 must resolve this deliberately. Ranked:

1. **Add an explicit one-shot E2E mode to `esbuild.config.mjs`** (e.g. `argv[2] === "e2e"` →
   `__LS_E2E__: "true"` + `rebuild()` + `exit(0)`). Cleanest and reproducible. It edits a build config,
   so it needs its own AC and must leave `production` and default-watch behaviour **byte-identical**.
2. Fire-and-forget `npm run dev` and poll for `plugin/main.js` mtime, then kill the watcher. Works, but
   it is a race, and a killed watcher can leave a half-written bundle — the exact class of defect this
   run exists to eliminate. Only acceptable with an integrity check on the emitted file.

Recommend option 1, chartered.

Also true of the dev build, and worth stating so nobody reads it as corruption: dev sets
`sourcemap: "inline"`, so `main.js` will be **substantially larger** than the 626 KB production file.
Install artefacts are `plugin/main.js` + `plugin/manifest.json` + `plugin/styles.css`.

---

## `data.json` — live credentials, integrity baseline

Both vaults' `data.json` contain **real credentials**. Standing rule, unchanged: never printed, never
logged, never echoed into a report, never placed in a fixture. Comparison is **sha256-of-bytes only**.

Secret-bearing keys present in both files: `encryptionPassphrase`, `encryptionSalt`, `jwt`,
`serverPassword`, `token`.

**Restore-verification baseline — taken before any gate work, so a post-run mismatch is provable:**

| Vault | sha256 of `data.json` |
|---|---|
| `ObsidianOrga` | `c2c4db2dc8eeb2fd183d0adea62ca6338d1a8e16a0acf2d092a54a1ca18e4162` |
| `ObsidianOrga - Kopie` | `070e3f3abe81a57f02e590e8d957438c56b828da11944dc9d0b0b6f30fa9030f` |

The two hashes **differ**, which is correct — per-vault identity keys (`clientId`, `displayName`, …).
Do not "converge" them.

**Gate exit condition:** both hashes match the values above after teardown, or the rig restored
settings wrongly. The rig provisions its own settings and restores from `data.json.e2e-original`;
this table is the independent check on whether that actually worked.

Canvas-relevant settings keys that exist and that the gate will care about (names only):
`useCanvasBinding`, `showCanvasPresence`, `showCanvasCursors`, `sharedFolder`, `roomId`, `serverUrl`.

---

## ⚠ The rig cannot launch Obsidian (measured 2026-08-04)

`tools/obsidian_e2e/lifecycle.py` exposes **`PlanOnlyConsole` as its only console backend**, and there is
**no `subprocess`, `Popen` or any other process-spawn anywhere in `tools/obsidian_e2e/`**. WP43–WP49 are
recorded as "infra done", and they are — but what was built is a **plan-only** rig. It can compute what
should happen; it cannot start Obsidian.

**Consequence: the gate run is necessarily agent-mediated, not a single `run_python` that returns a
verdict.** An agent launches both Obsidian instances through `visible-console`, then drives the control
endpoints. Any charter language implying the entrypoint runs the gate end-to-end is wrong and must be
corrected before WP7 is attempted. This does not invalidate the rig — the planning, port, readiness,
scratch and teardown modules are all still the right pieces — but it does mean **nobody has ever
exercised the launch path, because there is no launch path.**

---

## Open questions for WP50/WP51 (not answered here)

1. One-shot dev build — which option above (recommend 1, chartered with its own AC).
2. ~~`lan-vault-sync` — disabled for the run and restored, or left live and accepted as noise?~~
   **Void — wrong plugin, and no longer a question.** `lan-vault-sync` is **not enabled**. The engine
   that is enabled is **`obsidian-git` with `autoPullOnBoot: true`**, and it is **ruled disabled for the
   run and restored afterwards** — a precondition, not a disposition. See the correction block above.
3. Do both vaults currently point at the **same** `roomId` / `serverUrl`? Not inspected — values are
   adjacent to secrets in the same file, so the rig should read them itself rather than a human echoing them.
4. Relay: reuse the deployed NeuralAngels relay, or a local one? User has authorised deploying to
   NeuralAngels for testing (`name: liveshare`, never `--remove-orphans`, `neural-angels-access`/`n8n` protected).

---

## What this pre-flight does NOT establish

Nothing here has **run**. It establishes that the preconditions are as assumed except for the dev-build
hang, and it gives the batch a restore baseline. The gate itself remains **unexecuted**, and every green
in this run is still headless.
