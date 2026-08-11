# Live Share 0.7.2 release handoff

## Scope

This handoff packages the independently accepted CANVAS-VIEW-REGRESSION-071 owner-handover fix as version 0.7.2. The release edit is metadata-only; no additional product behavior changed after the W4 `ACCEPTED` verdict.

## Version metadata

The following files were changed consistently from 0.7.1 to 0.7.2, matching the prior 0.7.1 release pattern:

- `plugin/package.json`
- `plugin/package-lock.json`, both the top-level version and root package entry
- `plugin/manifest.json`
- root `manifest.json`
- `versions.json`, mapping 0.7.2 to minimum Obsidian 1.11.0

The metadata consistency check passed and found no remaining 0.7.1 package/manifest version fields.

## Gates and artifacts

- Focused handover, attach-seam, and leaf-census tests: 3 files, 11 tests, all passed.
- TypeScript: passed.
- Production build: passed, `main.js` SHA-256 `DC6A9224FBDCF817D04F65367CB53CEBC53A8AA1D33B8C6FF91A62B1CFD7E026`, 1,121,172 bytes.
- Diagnostic E2E build: passed, `main.js` SHA-256 `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025`, 6,006,911 bytes.
- The E2E hash is unchanged because the release version is manifest metadata and the accepted product source is byte-identical.

Raw gate evidence is under `release_0_7_2/`:

- `metadata.console.log` — SHA-256 `7848CBB1AD4808F0227ED2712884D5471385F732C80DD32374CAAF8516A75569`
- `focused_tests_typecheck.console.log` — `2692339490C45A2376786236EB94BB8AEFEE66294F19CE32612866F566315FA4`
- `builds.console.log` — `AA1753471C60BCB3669ACE0DD6EA84479848A399831A909FFEEB80D55AA257B4`

## Backup and deployment

The pre-deployment A/B/C bundle state is preserved at `H:\tmp\w5_release_072_predeploy_c47_20260812` with separate A/B/C directories and `BACKUP_MANIFEST.md`. Only `main.js`, `manifest.json`, and `styles.css` were copied.

- Backup `main.js`: C47 hash above in all three vaults.
- Backup 0.7.1 manifest: `63C1533A72C101BF72AB203E6951F80D74FAE0B734A4405B31D9855E598132E2`.
- Backup styles: `1BBA03E9695719ECC31549C6B7382D8BB3FDF23D97996CD753F7B1C4A516E453`.

The 0.7.2 E2E bundle was copied to `.obsidian/plugins/live-share` in the authorized A/B/C test vaults. Post-copy disk census is identical across all three:

- `main.js`: `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025`
- `manifest.json`: version 0.7.2, SHA-256 `EB9C5B975F7C759CA85A61BE5476649CD5EBCAA25A3155501C623DFF1FFBD132`
- `styles.css`: `1BBA03E9695719ECC31549C6B7382D8BB3FDF23D97996CD753F7B1C4A516E453`

Backup and deploy logs are `predeploy_backup.console.log` (`02F1300C...`) and `deploy.console.log` (`9ACF0840...`).

## Runtime and baseline

The A command palette was inspected visibly in German. The highlighted row was exactly `Anwendung neu laden, ohne zu speichern`. Selecting it produced a monitored endpoint-down to protocol-4 transition in 828 ms with disk manifest 0.7.2 (`reload_a_success.console.log`, SHA-256 `17FA9874...`).

B is a secondary window and visibly exposed no reload command (`Keine Befehle gefunden`) for either German or English search. A monitored Ctrl+R fallback also produced no endpoint transition. A second inspected A app reload proved only A restarted; B and C remained continuously available at protocol 4. Per the primary's explicit instruction, no force, process kill, close/reopen, or unsupported secondary-window reload was attempted.

Therefore the exact runtime handoff is:

- A: 0.7.2 disk metadata, inspected reload completed, protocol 4 returned.
- B/C: 0.7.2 disk metadata is installed; running code remains the already verified byte-identical C47 protocol-4 bundle and will read the new manifest metadata on their next natural app restart.

The post-deployment P5 baseline passed on the authorized A/C pair: one active attached leaf per port, registry mounted, 10 model nodes, 10 painted nodes, and no detached, unpainted, style-divergent, or rect/style-divergent IDs (`p5_baseline.console.log`, SHA-256 `10AE0688...`).

## Security and restoration

- No `data.json`, credential, token, salt, or passphrase was read, printed, copied, staged, or modified.
- No non-test vault was contacted.
- No process was killed, adopted, or force-restarted.
- Release deployment touched only `main.js`, `manifest.json`, and `styles.css` in the authorized A/B/C test-vault plugin directories.
- No Canvas content mutation was needed during the release handoff; the preceding accepted live verification already restored exact text, records, and geometry.
