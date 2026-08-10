# WP125 Deployment Report

**Date:** 2026-08-10  
**Release:** `0.7.1`  
**Deployment status:** `DEPLOYED`  
**Live verification status:** `OPERATOR_RELOAD_REQUIRED`

## Release gates

- `npm ci`: PASS (`447` packages installed)
- `npm audit signatures`: PASS (`447` verified registry signatures, `118` verified attestations)
- Full Vitest suite: PASS (`450` files, `3430` tests)
- `npm run build`: PASS (TypeScript plus production bundle)
- `npm run build:e2e`: PASS (final deployed bundle)
- Dependency audit observation: the existing lock contains `12` advisories (`2` moderate, `9` high, `1` critical). No dependency versions were changed in this patch release.

## Release metadata

The patch version was advanced from `0.7.0` to `0.7.1` in:

- `manifest.json`
- `plugin/manifest.json`
- `plugin/package.json`
- both root-package version fields in `plugin/package-lock.json` (these had remained stale at `0.5.2`)
- `versions.json` with minimum Obsidian version `1.11.0`

## Deployed artifacts

The final E2E-capable build was copied to `.obsidian/plugins/live-share` in:

- A: `H:\Developement\_NeuralAngels\ObsidianOrga`
- B: `H:\Developement\_NeuralAngels\ObsidianOrga - Kopie`
- C: `H:\Developement\_NeuralAngels\ObsidianOrga - W4TestC`

All three deployed copies match the build byte-for-byte:

| Artifact | SHA256 |
|---|---|
| `main.js` | `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615` |
| `manifest.json` | `63C1533A72C101BF72AB203E6951F80D74FAE0B734A4405B31D9855E598132E2` |
| `styles.css` | `1BBA03E9695719ECC31549C6B7382D8BB3FDF23D97996CD753F7B1C4A516E453` |

Each deployed manifest reports `0.7.1`.

## Recovery and safety

Byte-exact pre-deployment copies of `main.js`, `manifest.json`, and `styles.css` for A/B/C are stored at:

`H:\tmp\wp125_deploy_20260810_201513`

The old artifact hashes were identical in all vaults:

| Artifact | Pre-deployment SHA256 |
|---|---|
| `main.js` | `A3A438EC49A73041B0BEB30EC6B71EAA165C0DE53F32E52F757A70C32B02C916` |
| `manifest.json` | `50E1C7A7601A1EF8C24A910BD3F4EDECF451457FA457131DE81EAA04BBBE41D6` |
| `styles.css` | `1BBA03E9695719ECC31549C6B7382D8BB3FDF23D97996CD753F7B1C4A516E453` |

`data.json` was never opened, printed, copied, or modified. Its SHA256 was measured before and after deployment only; all three hashes remained unchanged.

The named canvas files were hashed immediately before and after deployment and remained byte-identical. A and C contain `SyncTesting.canvas`; all three vaults contain `second-011125.canvas`. B does not contain `_liveshare-test/SyncTesting.canvas`.

## Live endpoint state

Six Obsidian processes were already running. The official real-Obsidian rig confirmed that vaults A and B are registered and that Live Share is installed, enabled, and E2E-capable. However:

- CDP port `9222`: closed
- A control port `39431`: closed
- B control port `39432`: closed
- C control port `39433`: closed

The rig's safe `--allow-launch --no-reclaim` route produced launch plans only because no visible-console backend was available to that subprocess. It did not reload the existing operator-owned Obsidian processes, did not rewrite settings, and did not terminate any process.

Therefore a live W4 E2E verdict is not claimed. The operator must reload or restart the three Obsidian test windows so the newly installed bundle is evaluated. Once ports `39431`–`39433` answer, W4 can run the occluded structural-update scenario and paint-plane diagnostics.
