# Debug Report — CANVAS-VIEW-REGRESSION-071

- Status: `CONTINUATION_REQUEST`
- Finding: deployed v0.7.1 was reported to make Canvas view corruption persistent instead of eventually self-healing.
- Evidence rule: an authoritative current-build visible paint failure is now reproduced; no product fix or rollback is allowed until its cause is isolated with a falsifier.
- Branch: `fix-bugs-and-raceconditions`
- HEAD: `a53ec515eb3272c41179914575f1033f37d2caeb`
- Deployed A/B/C version: `0.7.1`
- Original deployed `main.js` SHA-256: `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615`
- Diagnostic-only deployed `main.js` SHA-256: `9A2A7F8983E6FE9D73AE6D47F5C38351D23694B4AF143B321381FE0B286C267A`
- Byte-exact diagnostic rollback backup: `H:\\tmp\\w5_leaf_diag_20260811_125537`

## Outcome first

An authoritative current-build RED is now caught on the real application. In `N=3/3` true structural remote reconciles on an occluded receiver, the same attached leaf's live model moved from x=900 to x=960/1020/1080 while its inline transform remained x=900 both at arrival and after three seconds. Every repetition proved the structural seam was active (`structuralChangedIds > 0`, structural attempt delta `+1`). The authorized node's geometry and exact original text were restored and independently verified paint/model GREEN.

The ordinary per-node paths remain green: two valid connected-card mouse drags, including one with the receiving Obsidian window fully occluded, converged across inline paint transform, live Canvas model, shared document, and file. The current Obsidian 1.13.6 renderer also confirms that synchronous `CanvasNode.render()` is a supported operation and still uses the lifecycle assumed by the plugin.

A separate real lifecycle defect was first pinned: when the same Canvas is open in multiple tabs and the originally tracked tab closes, another Canvas tab remains visibly open while the plugin keeps sweeping the destroyed adapter. The initial remote controls happened to refresh the survivor, so that early rung did not yet establish causation. The later persisted P6 order recreated the same lifecycle exactly and then caught the user's visible paint RED in `N=3/3`, converting that lifecycle observation into the supported cause described below.

The continuation closed that inference gap with protocol-4 all-leaf instrumentation. It directly observed the surviving duplicate while the registry adapter reported zero nodes. The first real remote update rebuilt the leaf, remounted a 10-node adapter, and aligned model and inline paint in 363 ms. Two further repetitions and three valid mouse-held interaction races also stayed aligned immediately and after `N=3` recovery periods. The multi-tab ownership gap is real, but these live falsifiers show it is not sufficient to cause the reported persistent view corruption.

## Phase 0 pin

- Repository resolved to `H:\\Developement\\_NeuralAngels\\liveshareCollab\\obsidian-live-share`.
- Git branch and HEAD remained unchanged throughout the hunt.
- Initial product tree was clean. Hunt diagnostics and harness artefacts are untracked workflow evidence only.
- A/B/C deployed bundles were byte-identical v0.7.1 builds.
- Existing v0.7.0 rollback backup was present at `H:\\tmp\\wp125_deploy_20260810_201513`.
- Ports 39431-39433 initially had no listener and no Obsidian process was running. Owned A/B/C Obsidian windows were launched without terminating or adopting an ambiguous process.

## Evidence ladder

### Prior validation boundary

The WP125 deployment and live-validation reports did not execute the live A7/BK11 arm. They explicitly stopped at operator reload / human-observable status and extrapolated from headless tests. No prior report demonstrated the owner's visible failure on v0.7.1.

### Actual Obsidian 1.13.6 lifecycle

Read-only inspection of the installed `obsidian-1.13.6.asar` established:

- `markMoved(node)` adds the node to `moved` and requests a frame.
- The frame transfers moved nodes to dirty, virtualizes, and calls `render()` only for attached dirty nodes.
- `CanvasNode.setData()` and `moveAndResize()` update model geometry and enqueue movement.
- `CanvasNode.render()` is the actual inline style writer, and Obsidian itself calls it directly at other lifecycle sites.

This rejects the hypothesis that WP125 became incompatible because direct `node.render()` is unsupported or because Obsidian 1.13.6 changed the relevant interface.

### Live ordinary-path repetitions

Two attempts that hit Canvas background were excluded rather than counted; their ledger contained viewport movement and zero node delta. After measuring the 2560x1440 desktop coordinate system, two valid mouse drags were run:

- UI drag 1: connected node `15dd9e620b7b6805`, delta `(+296,+195)`, A and C visible.
- UI drag 2: same connected node, delta `(+360,+200)`, receiving C window fully occluded by maximized A.

Both runs showed:

- local origin `canvas-capture-origin`;
- remote apply on C;
- paint style transform = live model = shared doc = file on both peers;
- per-node seam repairs on the receiving peer;
- no style-transform-divergent or attached-never-painted card.

The C rect cross-check repeatedly showed a constant-offset subset while `nodeEl.style.transform` agreed. That is the already-open S198 coordinate-bias class and was not promoted to a product failure.

### Connected `setData` order

A real control edit and harness P3 both exercised `applyNodeGeometry -> repaintNode -> reloadCanvasData/setData`. The moved card remained paint/model aligned. Diagnostics also showed `structuralSeam.changedIds=0` because per-node geometry had already advanced before the edge-reflow `setData`; that makes WP125's structural repaint redundant on this path, but it did not produce the reported failure.

### Real same-path tab lifecycle RED

The authorized `SyncTesting.canvas` was opened in three real Obsidian tabs. While all tabs existed, diagnostics continued to census the originally tracked adapter. After closing that original tab while a duplicate remained visibly open:

- A paint plane: 0 nodes;
- A view plane: 0 nodes;
- A doc plane: 10 nodes;
- A file plane: 10 nodes;
- repaint state kept ticking against the destroyed adapter;
- `skippedEmpty` rose to 12 and the sweep batch became `0/0`.

This is an actual current-build lifecycle failure, not a test-double assertion. It proves the plugin can lose ownership of every visible card while a Canvas tab remains open.

Three remote moves were then applied while a surviving duplicate remained, including moves while the window had been occluded. In each exercised case, Obsidian's external-file reload moved the visible card. Thus the lifecycle RED is real, but the final visible paint/model split was not caught live.

## Hunt harness

Harness: `workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/`

Command:

```text
python workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/run --all
```

Runner-confirmed result:

- P1 CLEAR — an owned sweep heals the source-derived stale-paint shape.
- P2 FIRED — after same-path adapter handover and N=3 ticks: active replacement=true, replacement sweep driven=false, calls=0, paint `(0,0)`, model `(45,0)`.
- P3 CLEAR — connected geometry/repaint/setData remains aligned.
- P4 CLEAR — live protocol-3 style-transform census had no authoritative divergence.

P2 is a contributing synthetic mechanism, not an authoritative reproduction of the user's UI sequence. It directly constructs the lifecycle handover. Safe source comparison shows the two decisive guards existed before WP125 at commit `77ff96c`, so P2 cannot attribute the reported worsening to WP125.

### Protocol-4 all-leaf continuation

The diagnostic-only continuation changed no production Canvas behavior. It added an E2E-only leaf census that reads every `workspace.getLeavesOfType("canvas")` entry matching the exact normalized authorized path, assigns a diagnostic-local stable leaf identity, and reuses the existing inline paint oracle without constructing or patching a production adapter.

Validation before deployment:

- TypeScript `--noEmit --skipLibCheck`: PASS.
- Existing E2E-control regression: PASS, 22/22.
- Focused duplicate-leaf fixture: PASS, 1/1. It holds two same-path leaves while the registry surface is destroyed, detects a planted inline-transform split, preserves the survivor identity after the first leaf closes, and proves a non-matching Canvas getter is never inspected.
- Predeployment P5: honest SKIP because the live bundle exposed protocol 3.

The E2E bundle was then deployed reversibly to A/B/C and reloaded only through Obsidian's `Reload app without saving` command in the three already-owned windows. All three copies hash to `9A2A7F8983E6FE9D73AE6D47F5C38351D23694B4AF143B321381FE0B286C267A`; their prior byte-exact copies are under `H:\\tmp\\w5_leaf_diag_20260811_125537`.

The first live P5 pass enumerated one leaf on A and one on C, both inline-style/model GREEN. Opening a real same-path duplicate on A produced two distinct readings (`leaf-1`, `leaf-2`). After the tracked leaf closed, one mounted leaf remained with 10 model/paint nodes while the registry census reported zero nodes; the destroyed sweep's `skippedEmpty` counter continued rising. This is the earlier lifecycle RED, now observed directly rather than inferred.

One P5 draft initially fired on three C nodes because it consumed the combined rect/style verdict. Inspection showed all three had `styleVerdict=agree` and only the known S198 rect offset. The P5 RED oracle was corrected before any product conclusion: it now uses only `nodesDetail.styleVerdict == DIVERGENT`, reports rect-or-style rows separately, and reran GREEN.

### Live falsifiers, explicit `N=3`

Occluded remote-move order, same surviving leaf, target node `15dd9e620b7b6805`:

- target x=960: model and inline paint first agreed after 363 ms and still agreed after 3 seconds;
- target x=1020: agreed after 240 ms and after 3 seconds;
- target x=1080: agreed after 260 ms and after 3 seconds.

On the first update the registry census changed from zero to 10 nodes and `skippedEmpty` stopped rising. That is the falsifier for the lifecycle hypothesis: the external-file rebuild remounted the adapter before any visible split existed.

Interaction-race order used three actual mouse-held card drags on A. Each was valid because the live Canvas model moved from x=900 to x=1029/y=-2280 while the button remained held. A C-side remote same-card update then targeted x=1200, x=1260, and x=1320 respectively. For all three repetitions:

- held-before-remote model and inline paint agreed;
- held-after-remote model and inline paint agreed at the target;
- first target arrival model and inline paint agreed;
- after 3 seconds model and inline paint still agreed;
- the same leaf stayed attached and the registry remained live at 10 nodes.

The console wrapper reported a status-file access error only after emitting all three complete result rows; the underlying UI-run data and the subsequent independent restore check were complete. The node was restored to x=900 and independently verified `modelX=paintX=900`, `styleVerdict=agree`.

### Authoritative structural-reconcile RED, explicit `N=3`

The next order came directly from the surviving distinction between the green per-node path and the previously unexercised structural geometry path. Before mutation, the hypothesis was: a remote update that changes geometry and a non-geometry field together forces whole-board `setData`; on an occluded receiver, the live Canvas model can advance while the same attached leaf's inline transform remains stale despite WP125's structural repaint. The falsifier required all three repetitions to prove a structural seam and then stay style/model aligned both at first arrival and after three seconds.

The authorized node `15dd9e620b7b6805` started at x=900/y=-2340, width=620, height=150. The sender applied a reversible structural change by appending one, two, then three spaces to the existing text while moving x. The original text was held only in-process, never printed, and restored by exact case-sensitive equality.

- Repetition 1: target x=960; first arrival 1155 ms; same attached leaf model x=960, inline paint x=900, `styleVerdict=DIVERGENT`; still divergent after three seconds; `structuralChangedIds=1`; structural attempt delta `+1`.
- Repetition 2: target x=1020; first arrival 971 ms; model x=1020, inline paint x=900; still divergent after three seconds; same attached leaf; structural attempt delta `+1`.
- Repetition 3: target x=1080; first arrival 1078 ms; model x=1080, inline paint x=900; still divergent after three seconds; same attached leaf; structural attempt delta `+1`.

The cumulative `structuralChangedIds` values increased because each reversible text change also replaced the structural record; validity did not depend on the absolute counter, only its positive delta and the per-run structural-attempt delta. After restoration, the same leaf reported model x=900, inline paint x=900, `styleVerdict=agree`, and exact original text equality.

This is the reporter's failure class on the shipped v0.7.1 code: right model, stale visible inline transform, attached real Electron leaf, no recovery after the prior three-second window. It is not a rect-oracle inference or a synthetic handover.

The current cause hypothesis, declared before the next mutation, is narrower: immediately after `canvas.setData`, `repaintNode(id, "structuralSeam")` sees the replacement node element detached and records `deferred`; the single microtask event sweep also runs before reattachment, while occlusion throttles later recovery, leaving the subsequently attached element stale. It is falsified by no positive structural-deferred delta, a successful structural repair/repaint outcome despite stale style (which would instead support a wrong-object path), or a later event/sweep repair while the receiver stays occluded.

### Cause discriminator: detached structural repaint survives its falsifier

Probe: `harness/probes/p6_live_structural_cause.py`. This performed one more reversible structural update with source-specific counter snapshots, kept A occluded through the three-second recovery window, then activated A without another model mutation.

- Baseline on `leaf-3`: model x=900, inline paint x=900, attached, style GREEN.
- First model arrival at 906 ms: same `leaf-3`, model x=960, inline paint x=900, attached, style RED.
- After three seconds: same `leaf-3`, still model x=960/paint x=900, attached, style RED.
- Structural source delta: attempts `+1`, deferred `+1`, repairs `+0`, repaints `+0`.
- Trigger delta before arrival: event requests `+2`, coalesced requests `+1`, event runs `+1`.
- Sweep source delta: attempts `+3`, deferred `+3`, repairs `+0`, repaints `+0`.
- Activating A, without any model edit, made the first census at 0 ms GREEN at x=960. No plugin repair/repaint counter advanced; Obsidian's native visibility/frame lifecycle supplied the paint that the occluded path never completed.
- Restoration completed in 250 ms: same `leaf-3`, model x=900, inline paint x=900, exact original text equality on A and C.

The first discriminator rejected the unsupported-render alternative, but its scheduling-only conclusion was incomplete. After visibility/restoration returned the registry to a clean mounted lifecycle, repeated structural updates stayed GREEN and the structural seam reported repair `+1`. Even a ten-second proven occlusion did not make that clean state fail. Therefore `setData` plus early scheduling is not sufficient by itself.

### Persisted orphan-lifecycle RED and final cause discriminator

The exact earlier lifecycle precursor was recreated through real Obsidian UI:

- split the same Canvas into two mounted leaves (`leaf-3`, `leaf-4`);
- close the originally tracked leaf and the prior tab it revealed;
- retain the single stable visible survivor `leaf-4`;
- verify registry view/paint count `0/0` while leaf census still reads the attached survivor, with `skippedEmpty=24`.

Only then was P6 run three times. Raw protocol-4 artifacts are preserved under `harness/evidence/p6_orphan_structural_n3/` with SHA-256 hashes in its README.

All `N=3/3` repetitions show:

- receiver A positively occluded by the valid maximized foreground C window for 10 seconds;
- stable same leaf `leaf-4`, attached and active throughout;
- ordinary remote precursor model x=930 / inline paint x=900 at arrival and after three seconds;
- structural remote update model x=960 / inline paint x=900 at arrival and after three seconds;
- structural source attempts `+1`, deferred `+1`;
- one event sweep ran; its selected nodes were wholly or overwhelmingly deferred and no repair was recorded;
- activating A without a model mutation immediately aligned paint/model at x=960;
- exact full-record and text equality on A and C after restoration, with geometry restored to x=900/y=-2340/620x150.

This discriminates the cause: the same-path lifecycle leaves the plugin registry applying and sweeping an adapter whose node elements are detached while the surviving leaf owns a different, attached Canvas runtime. The clean-state GREEN control proves the structural repaint itself works when registry ownership is current. The orphan-state RED proves microtask and periodic retries cannot repair the visible leaf because they keep addressing detached nodes in the stale adapter. Visibility heals through Obsidian's surviving runtime, not through a plugin repair counter.

## Hypotheses rejected

- Direct `CanvasNode.render()` is unsupported or version-incompatible.
- A normal connected-node remote move is broken on v0.7.1.
- Receiver occlusion alone defeats the targeted repaint.
- `applyNodeGeometry -> repaintNode -> setData` corrupts the moved card.
- Opening duplicate tabs alone leaves visible paint stuck.
- The measured multi-tab orphan state is sufficient to keep a remote-moved card corrupt; the first remote update remounted the adapter and painted the card.
- A same-card remote update overlapping a valid local mouse-held drag leaves inline paint behind; all `N=3` live repetitions stayed aligned.
- The rect-only constant offset is evidence of stale inline transform.
- WP125 introduced the same-path sweep lifecycle guards; both guards predate it.

## Remaining boundary

The current build has produced the reporter's visible inline-transform/model split on the same-path orphan lifecycle, including both an ordinary remote move and a true structural reconcile. The counter discriminator attributes it to stale adapter ownership after leaf handover: plugin repaint paths address detached nodes while the stable visible leaf remains attached and divergent.

The refined lifecycle-ownership cause has survived its falsifier, while the earlier scheduling-only hypothesis did not. A fresh stateless verdict must accept the persisted protocol-4 `N=3` artifacts before any production edit. If accepted, the next rung may propose exactly one ownership/rebinding change, with this lifecycle order held fixed for equal-`N` GREEN; no scheduling, fairness, cleanup, or unrelated repaint behavior may be bundled.

## Why no fix or rollback was made

- A WP125 rollback is not justified: no current-vs-pre-WP125 live A/B demonstrated that WP125 caused the worsening.
- A new production fix is not yet justified under the user's evidence-only order: the reported visible split is now observed, but the exact repaint failure mode is not yet isolated.
- Consequently no copy-aside GREEN -> RED -> byte-identical GREEN verdict sequence was commissioned; there is no proposed production change to adjudicate.

## Test-vault state

Only the authorized test Canvas was mutated. Target node `15dd9e620b7b6805` was restored to x=900/y=-2340 and independently verified paint/model GREEN. The named C `second-011125.canvas` retained hash `DA6B20B02FA82CEBFE61D6E86E408AC30C9B0CBD11DAD0A1ADF0204C2FBD8913`. A `SyncTesting.canvas` did not remain byte-identical after the authorized UI/capture and sync repetitions (final hash `AA58979D9342B0FEFB6E7C25CF272A9292DEB3179A64231A82A091C9DBB59965`); its exercised geometry was restored semantically. No non-authorized Canvas was inspected or changed.

## Security and scope declaration

- Never read, exposed, or modified `data.json`, credentials, passphrases, tokens, or salts.
- No dependency, settings, production Canvas behavior, `main.ts`, or Canvas-adapter change was made. The only source change is E2E diagnostic instrumentation plus its focused test/harness.
- No ambiguous process was killed or adopted.
- Deployed-state contact was limited to the reversible E2E diagnostic bundle, owned-window Obsidian reload commands, authorized Canvas tab/view operations, authorized test-card moves, read-only diagnostics, and screenshots under `H:\\tmp`.
- Branch remained `fix-bugs-and-raceconditions`; no reset, stash, checkout, rebase, or amend occurred.

## Accepted cause, one-change implementation, and rollback gate

The fresh stateless review of `harness/evidence/p6_orphan_structural_n3/` accepted the persisted protocol-4 `N=3` RED. The accepted cause is stale same-path adapter ownership after the originally tracked Canvas leaf closes while another attached leaf for the same path survives. Remote model updates continue through the detached owner's adapter, so its repaint/event/sweep work cannot paint the surviving leaf's inline transform.

Exactly one production behavior change was implemented in `plugin/src/main.ts`: path presence now retains the exact Obsidian view that owns it, and the existing workspace lifecycle seam remounts that path only when the recorded owner has disappeared and a same-path survivor exists. Opening a duplicate while the current owner remains mounted does not remount. No timer, repaint, sweep, fairness, or unrelated cleanup behavior changed.

Focused causation proof:

- The new same-path close/survivor ownership test first failed on the pre-change behavior because the survivor was not mounted.
- With the ownership change, the ownership-focused and existing attach-seam tests passed `10/10`.
- The fixed `main.ts` was copied aside with SHA-256 `7B8C1B6ED695DEFAC586EF1514CECBC12C3D24D09C2206E004640A2508A93796`.
- Disabling only the new owner-handover predicate reproduced the focused RED.
- Restoring the copied file byte-identically restored SHA-256 `7B8C1B6ED695DEFAC586EF1514CECBC12C3D24D09C2206E004640A2508A93796` and the focused tests returned GREEN.
- Final ownership plus leaf-census focus passed `11/11`; TypeScript passed; full Vitest passed `452` files and `3432` tests; production and diagnostic E2E builds passed.

The fixed diagnostic bundle has SHA-256 `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025`. It was copied to the A/B/C test-vault plugin directories, but no Obsidian process was reloaded after that copy. The running instances therefore still hold the preceding protocol-4 diagnostic runtime in memory; no live fixed-build GREEN is claimed.

Deployment stopped at the rollback gate. The preceding protocol-4 runtime bundle hash `9A2A7F8983E6FE9D73AE6D47F5C38351D23694B4AF143B321381FE0B286C267A` was not present in located backups. An isolated reconstruction from pre-fix HEAD `main.ts` plus the current diagnostic source produced `EB5F1AE386278BA22A517D66844D4529002025877F5EDC642A7D719C5BBC0102`, proving it was not byte-identical. Source and build were then restored byte-identically to the fixed hashes above.

The release-backup floor at `H:\tmp\wp125_deploy_20260810_201513` was also checked without reading any settings or credentials. All A/B/C `main.js` copies match each other at SHA-256 `A3A438EC49A73041B0BEB30EC6B71EAA165C0DE53F32E52F757A70C32B02C916`, not the required known v0.7.1 release hash `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615`. Their manifests match at `50E1C7A7601A1EF8C24A910BD3F4EDECF451457FA457131DE81EAA04BBBE41D6`, and styles match at `1BBA03E9695719ECC31549C6B7382D8BB3FDF23D97996CD753F7B1C4A516E453`. Because the explicit rollback floor failed the required main-bundle identity check, reload and live fixed-build `N=3` verification remain blocked.

### Current security and restoration declaration

- No `data.json`, credential, token, salt, or passphrase was read, printed, copied, or modified.
- No process was killed, adopted, or reloaded after the fixed-bundle copy.
- No further Canvas mutation occurred during rollback verification; the previously exercised node remains semantically restored to x=900/y=-2340/620x150 with exact text/record restoration evidence preserved in the `N=3` artifacts.
- Branch remained `fix-bugs-and-raceconditions`; no reset, stash, checkout, rebase, or amend occurred.
- Status is `BLOCKED`, not `FIX_VERIFIED`: local causal proof is GREEN, but required live fixed-build GREEN and final stateless W4 review cannot be claimed before a verified rollback artifact permits reload.

### Bounded pinned-commit rollback reconstruction

One final isolated reconstruction was performed under `H:\tmp\w5_pinned_release_rebuild_20260811` without touching the shared checkout. Commit `a53ec515eb3272c41179914575f1033f37d2caeb` was exported with `git archive`, its committed `plugin/package-lock.json` was installed with `npm ci`, and its documented `npm run build:e2e` command (`node esbuild.config.mjs e2e`) ran under Node `v24.9.0` and npm `11.6.0`.

- Produced artifact length: `6078135` bytes.
- Produced SHA-256: `977C37225134D113CD9CDC8F526DC0E5572771889D95D15C7BDE55C03E2F6D3A`.
- Required rollback SHA-256: `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615`.

The single controlled reconstruction therefore failed exact identity and was not promoted as a rollback artifact. Shared fixed source and bundle remained byte-identical at `7B8C1B6ED695DEFAC586EF1514CECBC12C3D24D09C2206E004640A2508A93796` and `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025`. No vault, process, or deployed file was touched. Status remains `BLOCKED`; reload, live fixed `N=3`, and final W4 validation were not run.

## Test-vault rollback exception and live fixed-build verification

The primary authorized a documented test-vault-only rollback exception after the exact historical v0.7.1 binary could not be recovered. Two functional rollback artifacts, with matching manifests/styles and an explicit provenance note, are preserved under `H:\tmp\w5_test_rollback_exception_20260811`:

- Primary: isolated pinned-source a53ec515 E2E bundle, SHA-256 `977C37225134D113CD9CDC8F526DC0E5572771889D95D15C7BDE55C03E2F6D3A`.
- Secondary: existing release-backup bundle, SHA-256 `A3A438EC49A73041B0BEB30EC6B71EAA165C0DE53F32E52F757A70C32B02C916`.

The exact historical `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615` binary remains unavailable. The preserved manifest states that the pinned-source binary mismatch is toolchain-induced and that rollback loses protocol-4 diagnostics. On owned test window B, the primary rollback booted as protocol 3 and the restored fixed C47 bundle then booted as protocol 4, proving the exception's functional rollback/restore path without touching a non-test vault.

The fixed C47 diagnostic bundle was then reloaded on A/B/C. C was reloaded only after visible German command-palette inspection identified `Anwendung neu laden, ohne zu speichern`; the monitor observed endpoint unavailability followed by protocol-4 return. No process was killed.

The duplicate-owner-stays control passed first: opening and closing a same-path duplicate left original runtime `658ddd0bcb1ea436` mounted, active, attached, and paint/model aligned. The accepted failing lifecycle was then recreated by closing the originally tracked leaf. Surviving runtime `40e7715821b39478`, diagnostic `leaf-3`, was active, attached, registry-mounted, and paint/model aligned before mutation.

The exact accepted-RED order was rerun `N=3` against stable attached `leaf-3`. Raw artifacts are preserved under `harness/evidence/p6_owner_fix_green_n3/` and verified by `harness/probes/verify_p6_owner_fix_green.py`:

- Every raw sample reports diagnostic protocol 4 and the same attached leaf identity.
- Baseline model/inline paint x was `1520`.
- Ordinary remote arrival and +3 seconds were `1550/1550`, verdict `agree`, in all three repetitions.
- Structural remote arrival and +3 seconds were `1580/1580`, verdict `agree`, in all three repetitions.
- Structural arrival recorded one changed ID, one structural-seam attempt, and one structural-seam repair in each repetition.
- Activating A did not change the already-GREEN `1580/1580` state.
- Arrival times were ordinary `63/63/78 ms` and structural `16/63/63 ms`.
- Every repetition restored exact A/C record and text equality and exact geometry x `1520`, y `-2280`, width `620`, height `150`; final paint/model was `1520/1520`.

This is the required live causation result: current-build same-path handover produced RED `N=3`; disabling only the ownership predicate reproduced focused RED; byte-identical restoration returned local GREEN; and the fixed deployed bundle makes the same live order GREEN `N=3` on the surviving leaf. A fresh stateless W4 review of the code diff, focused/full gates, prior RED, and fixed raw artifacts is the only remaining verdict gate.

### Final security and restoration declaration before W4

- No `data.json`, credential, token, salt, or passphrase was read, printed, copied, or modified.
- Deployed-state contact was restricted to the authorized A/B/C test-vault plugin bundles and owned Obsidian windows.
- No non-test vault was read or modified; no process was killed or adopted.
- Authorized Canvas mutations were restored exactly in every live repetition, including text, complete records, and geometry on A/C.
- Branch remained `fix-bugs-and-raceconditions`; no reset, stash, checkout, rebase, or amend occurred.
- Status is `CONTINUATION_REQUEST` pending the required fresh stateless W4 verdict; the live GREEN evidence itself is complete.

## Fresh stateless W4 final verdict

`ACCEPTED` — no blocker.

The independent reviewer verified the pinned branch/HEAD, the singular owner-handover production change, focused and live duplicate-owner no-churn controls, all six raw RED/GREEN hashes, exactly one protocol-4 JSON payload per run, stable attached leaf identities, inline paint/model readings, structural/event counter discriminators, activation behavior, and exact A/C text/record/geometry restoration.

The accepted causation chain is:

- Current-build live RED `N=3` on the same-path orphan lifecycle.
- Focused owner-handover GREEN.
- Ownership-predicate-only RED.
- Byte-identical source restoration at SHA-256 `7B8C1B6ED695DEFAC586EF1514CECBC12C3D24D09C2206E004640A2508A93796` and focused GREEN.
- Same-order fixed deployed live GREEN `N=3` with bundle SHA-256 `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025` on A/B/C.

The reviewer also accepted the explicitly authorized test-vault-only rollback exception: primary `977C37225134D113CD9CDC8F526DC0E5572771889D95D15C7BDE55C03E2F6D3A`, secondary `A3A438EC49A73041B0BEB30EC6B71EAA165C0DE53F32E52F757A70C32B02C916`, and the documented unavailability of historical `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615`.

Final debug status: `FIX_VERIFIED` for CANVAS-VIEW-REGRESSION-071.

After that verdict, the primary explicitly authorized a release-only handoff outside the one-behavior constraint. Version metadata was bumped consistently to 0.7.2 without further product behavior changes. Production and E2E builds, focused tests, and TypeScript passed. The 0.7.2 disk bundle is installed on A/B/C; A completed an inspected German reload with endpoint-down to protocol-4 proof. B/C continue running the already verified byte-identical C47 protocol-4 code and have 0.7.2 manifests on disk pending their next natural app restart; forced secondary-window reload was explicitly declined. The post-deployment P5 baseline is GREEN. Full details are in `ReleaseHandoff_0.7.2.md`.
