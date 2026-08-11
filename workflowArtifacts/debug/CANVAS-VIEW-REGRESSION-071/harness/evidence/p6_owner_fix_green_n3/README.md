# P6 owner-handover fix live GREEN, N=3

The fixed diagnostic bundle `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025` was running on the authorized A/C test-vault pair. The originally tracked same-path Canvas leaf was closed, leaving the surviving attached runtime `leaf-3`. Every repetition used the same order as the accepted RED: ordinary remote move, structural remote update while A was occluded by C for 10 seconds, then A activation.

- `run1.console.log` — SHA-256 `0702D7A42F95DE3D0CE3869219FA43149D96ED41826E5F47CE16821AD6325469`
- `run2.console.log` — SHA-256 `A8E9FC78182103F1CD5988DEF9864BABB07D20B2C0BA4563121D00D15746B314`
- `run3.console.log` — SHA-256 `193AC8FC2A2781DCE3F1C6B031EFAAD3C57F2B9B0F93E313AFEBD6F969E8E98F`
- `verification.console.log` — machine-check result over the three raw logs
- `duplicate_owner_stays.console.log` — duplicate-open/duplicate-close control proving the original owner remains mounted
- `orphan_setup.console.log` — exact live same-path handover setup
- `reload_c_german.console.log` — German command-palette reload transition evidence
- `rollback_smoke_b.console.log` — test-vault-only functional rollback and fixed-bundle boot smoke
- `deployment_hashes.console.log` — final A/B/C disk census; all three `main.js` files are 6,006,911 bytes and SHA-256 `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025` (log SHA-256 `1305202C3A0161D88202D087B8B5F0970DBB40B687EA9B363619CD617FC0F6D4`)

All three repetitions are protocol 4 and GREEN:

- Stable survivor: `leaf-3`, active and attached at every sampled point.
- Baseline: model and inline paint x `1520`.
- Ordinary arrival and +3 seconds: model and inline paint x `1550`.
- Structural arrival and +3 seconds: model and inline paint x `1580`.
- After activation: model and inline paint remain x `1580`; activation does not provide a hidden repair.
- Structural arrival delta: one changed ID, one structural-seam attempt, one structural-seam repair.
- Exact restoration in every repetition: A/C record equality, A/C text equality, and geometry equality at x `1520`, y `-2280`, width `620`, height `150`.

Run `python harness/probes/verify_p6_owner_fix_green.py` from the bug directory's repository root to recheck the raw artifacts. It requires exactly one JSON payload per run and fails on any protocol, identity, attachment, paint/model, occlusion, structural-counter, or restoration mismatch.

Fresh stateless W4 verdict: `ACCEPTED`. The reviewer independently matched the RED and GREEN hashes, validated the lifecycle and causation chain, confirmed the production diff contains only the ownership-handover behavior, and accepted the security/restoration evidence.
