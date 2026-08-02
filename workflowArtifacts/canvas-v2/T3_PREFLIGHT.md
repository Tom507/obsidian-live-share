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

Other plugins present in both vaults (**must survive the run untouched**): `lan-vault-sync`, `obsidian-git`.
`lan-vault-sync` is a second sync engine — if it is enabled during the gate it can move files underneath
the test and produce a failure that has nothing to do with Canvas V2. **WP50 must decide explicitly**
whether it is disabled for the run, and if so, restore it afterwards.

---

## Installed build — production, as expected

Both vaults carry an **identical** install (byte-identical sizes, same timestamps):

| | |
|---|---|
| `manifest.json` | id `live-share`, version **0.6.1**, `minAppVersion` 1.11.0 |
| `main.js` | 626 711 bytes, dated 2026-07-26 |
| `__LS_E2E__` occurrences in `main.js` | **zero** |

Zero occurrences is the *expected* production signature, not an anomaly: the flag is folded to `false`
at build time and the whole `src/testing/` tree is dead-code-eliminated. It **confirms** the standing
claim that the installed build cannot host the control server, and it doubles as W4-1's C46
production-bundle counter-check evidence (`src/testing/` does tree-shake out).

Pre-existing backups already in both plugin dirs — **not ours, do not overwrite**:
`main.js.bak`, `main.js.0.5.9.bak`, `manifest.json.bak`.
The rig has its own backup namespace (`data.json.e2e-original`, `.e2e-provision.json`); use it.

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

## Open questions for WP50/WP51 (not answered here)

1. One-shot dev build — which option above (recommend 1, chartered with its own AC).
2. `lan-vault-sync` — disabled for the run and restored, or left live and accepted as noise?
3. Do both vaults currently point at the **same** `roomId` / `serverUrl`? Not inspected — values are
   adjacent to secrets in the same file, so the rig should read them itself rather than a human echoing them.
4. Relay: reuse the deployed NeuralAngels relay, or a local one? User has authorised deploying to
   NeuralAngels for testing (`name: liveshare`, never `--remove-orphans`, `neural-angels-access`/`n8n` protected).

---

## What this pre-flight does NOT establish

Nothing here has **run**. It establishes that the preconditions are as assumed except for the dev-build
hang, and it gives the batch a restore baseline. The gate itself remains **unexecuted**, and every green
in this run is still headless.
