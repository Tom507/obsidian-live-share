# P6 orphan-lifecycle structural RED — raw N=3

- Branch: `fix-bugs-and-raceconditions`
- HEAD: `a53ec515eb3272c41179914575f1033f37d2caeb`
- Deployed diagnostic `main.js`: `9A2A7F8983E6FE9D73AE6D47F5C38351D23694B4AF143B321381FE0B286C267A`
- Protocol: `4`
- Authorized Canvas: `_liveshare-test/SyncTesting.canvas`
- Stable surviving leaf in every reading: `leaf-4`, attached and active
- Receiver proof: A and C were valid maximized owned windows and C handle `789580` was foreground after a 10,000 ms occlusion settle.
- Restoration proof: every run reports exact full-record equality on A and C, exact text equality, original geometry `(900,-2340,620,150)`, and same-leaf paint/model GREEN after restoration.
- Security: the raw JSON deliberately excludes doc/file node records; node text, credentials, and `data.json` never enter the artifacts.

## Raw artifacts

- `run1.console.log` — SHA-256 `A5505630EA4CE2A1BC409919AC52BF7E21D3D4B5F00C2F6BB796E479C312987A`
- `run2.console.log` — SHA-256 `797FB2553C3B240B28813349EF81C9C53549C50FD3E54877DE52BC803796F27C`
- `run3.console.log` — SHA-256 `4F3A7A12727FDA6BF78F6767E4DD77AF8352B3FA5C94B9EB2023859C8B5ADB29`

Each log contains the exact protocol-4 arm, precursor arrival/+3 s, structural arrival/+3 s, post-activation, and restoration counter/leaf subtrees emitted by the live probe.

## Exact repeated result

- Ordinary remote precursor: model x=930, inline paint x=900 at arrival and +3 s, `DIVERGENT` in 3/3.
- Structural remote update: model x=960, inline paint x=900 at arrival and +3 s, `DIVERGENT` in 3/3.
- Structural seam delta: attempts `+1`, deferred `+1` in 3/3.
- Event sweep: event runs `+1` in 3/3; every selected node was deferred in runs 1 and 2, and 5/6 were deferred in run 3. No sweep repair was recorded.
- Activating A without another model change aligned paint/model at x=960 in 3/3.
- Exact original record and geometry restoration: PASS on A and C in 3/3.
