# CANVAS-VIEW-REGRESSION-071 Hunt Harness

- Mode: INITIAL
- Bug ID: `CANVAS-VIEW-REGRESSION-071`
- Finding probed: deployed v0.7.1 made the Obsidian Canvas view-layer bug worse; cards previously eventually self-healed, now they never do.
- Timing/order bound: `N=3` periodic sweep ticks everywhere in this harness.
- Runner: `python workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/run --all`
- Product baseline: clean `fix-bugs-and-raceconditions` at `a53ec515eb3272c41179914575f1033f37d2caeb` when the hunt began.

The RED oracle is paint against model, not doc against file. P1 and P2 use the repository's source-derived Obsidian render double: `moveAndResize` changes the Canvas node model without writing `nodeEl.style.transform`, while `render()` is the only paint writer. P4 reads that same separation from the real mounted Electron DOM through diagnostic protocol 3.

| Probe ID | Kind | Framework | What it asserts | Invoke | Fired during hunt |
|---|---|---|---|---|---|
| P1 | code-level | Vitest + source-derived Obsidian render double | An adapter that owns its periodic sweep repairs a stale card whose lock revert sees an already-correct model within `N=3` ticks. | `python workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/run --probes P1` | NO |
| P2 | code-level | Vitest + shipped `LiveSharePlugin` lifecycle + source-derived Obsidian render double | Replacing an adapter for the same path retains a restoring sweep, so a correct model and stale visible transform converge within `N=3` ticks. | `python workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/run --probes P2` | YES |
| P3 | code-level | Vitest + real Canvas adapter | The connected-node order `applyNodeGeometry -> repaintNode -> reloadCanvasData/setData` leaves visible paint and the model aligned. | `python workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/run --probes P3` | NO |
| P4 | integration | Python unittest-style live diagnostic | The current mounted authorized Canvas exposes protocol-3 paint data and has no style-transform divergence or never-painted attached cards. | `python workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/run --probes P4` | NO |
| P5 | integration | Python HTTP diagnostic over protocol 4 | Every mounted Obsidian Canvas leaf for the authorized path is independently visible, with model and inline paint aligned per leaf. | `python workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/run --probes P5` | NO (not live-run: deployed rig remains protocol 3) |

## Current-build RED

P2 fails on the pinned v0.7.1 build with a concrete two-plane reading: the replacement Canvas node model is `{x:45,y:0}` while its visible transform remains `{x:0,y:0}` after `N=3` ticks. It also asserts that the replacement adapter is the active entry in `canvasAdapters` and that this active adapter received no periodic sweep. P1 proves the same stale-paint shape heals when the adapter still owns the sweep, so the RED is not produced merely by withholding the animation frame.

The measured order is:

- The original adapter owns the path's sweep state.
- A replacement adapter becomes the live registry value for the same path.
- Starting its sweep returns because state for the path already exists.
- The original interval observes that its adapter is no longer live and stops the path's shared state.
- A lock-revert-shaped apply sees the replacement model already equal to shared geometry, returns `unchanged`, and therefore does not issue the per-node repaint.
- After `N=3` periodic opportunities, paint is still stale while the model is right.

This is a synthetic current-build lifecycle failure mode, not yet an authoritative reproduction of the user's real UI sequence and not version attribution. The test drives the shipped private lifecycle methods but constructs the same-path adapter handover directly; the normal `syncCanvasPresences` route guards an already-present path. A safe source comparison with pre-WP125 commit `77ff96c` found the same start-if-present and stop-on-adapter-mismatch guards there. Therefore P2 alone does not support the claim that WP125 introduced the worsening; it only supplies a concrete mechanism for “never heals” if a same-path adapter handover occurred through some route not yet demonstrated.

Current source anchors are `plugin/src/main.ts:4127-4128` for `startCanvasRepaintSweep` returning when the path already has state, and `plugin/src/main.ts:4147-4148` for the old interval stopping when the registry adapter differs. WP125 changed the map value from an interval handle to the event/periodic state object and added event scheduling/counters; it did not change either lifecycle guard.

## Controls and observations

- P3 is CLEAR: the connected-node geometry/repaint/`setData` order itself did not reproduce a visible split.
- A live current-build connected-node move through the real capture path was also CLEAR during the hunt: paint, model, doc, and file converged on both measured peers.
- P4 was CLEAR on the mounted `_liveshare-test/SyncTesting.canvas` surfaces: the real protocol-3 paint plane reported no style-transform-divergent or never-painted attached cards. Rect-only divergences are deliberately excluded because the known S198 coordinate bias does not show a stale inline transform.
- A request to open `_liveshare-test/second-011125.canvas` reported opened/subscribed while the diagnostic still listed only `_liveshare-test/SyncTesting.canvas` as mounted. That is an observation about view/adapter lifecycle, not paint divergence and not a causal verdict.
- The two live instances answered locally but were not in the same relay room during this hunt, so no remote selection/awareness collision was claimed from that run.
- The increment added protocol-4 `leafCensus` to `canvas.diag` census/arm/dump. It reads `workspace.getLeavesOfType("canvas")`, exact-normalizes the requested and view paths, and inspects only matching leaves. Diagnostic-local leaf IDs remain stable across arm/dump without constructing or patching a production Canvas adapter.
- A focused fake-workspace Vitest fixture holds two same-path leaves while the adapter registry points at an empty destroyed surface. It proves the leaves remain distinct, the survivor keeps the same diagnostic ID after the first leaf closes, a planted stale inline transform fires, and a non-authorized Canvas getter is never touched.

## Runner behavior

- `--all` runs every probe.
- `--probes P1 P3` or `--probes P1,P3` selects exact probe IDs.
- `--kind code-level` and `--kind integration` select by kind.
- One outcome line is printed per selected probe.
- Exit status is nonzero when any selected probe fires.
- P4 is read-only and uses ports `39431,39433` by default. Override with `CANVAS_E2E_PORTS`; it skips, without claiming GREEN, when the safe rig or requested mounted path is unavailable.
- P5 uses the same read-only ports and authorized-path override. It requires protocol 4, prints one compact entry per leaf, and skips rather than claiming GREEN when the running bundle has not been reloaded to expose the new protocol.

## Historical P1-P5 boundary before the live continuation

- At this initial boundary, no automated real-mouse selection gesture was available through the existing safe control surface, so the live selection/awareness callback order was not manufactured.
- At this initial boundary, no same-path real Electron leaf replacement was forced. The later P6 continuation performed the authorized real-leaf lifecycle and supersedes this limitation.
- No connected relay-room selection collision was run because the available A/C instances advertised different rooms.
- No non-authorized Canvas, credential, or plugin configuration file was read or changed.
- No product fix, revert, or bundle deployment had been performed at this initial boundary. Later sections record the authorized one-change fix, test-vault rollback smoke, deployment, and live verification.
- Historical increment boundary: P5 initially stopped before protocol-4 deployment. The Worker 5 continuation later deployed the diagnostic bundle reversibly and records the live results below.

## P6 live structural cause discriminator

- Command: `python harness/probes/p6_live_structural_cause.py`
- Mutating scope: only the authorized `_liveshare-test/SyncTesting.canvas` target node; the exact source record is restored in `finally`, and text is never printed.
- RED oracle: the same stable protocol-4 leaf is attached with live model x at the structural target while inline style transform remains at the baseline after three seconds.
- Cause oracle: structural-seam and sweep source deltas report `deferred`, not `repaired` or `repainted`; activating the occluded receiver without a model mutation restores paint.
- The clean mounted lifecycle is a GREEN control: structural seam attempts repair the attached target immediately.
- RED precondition: create a same-path split, close the originally tracked leaf(s) until one stable surviving leaf remains while the registry view/paint census is zero, then send an ordinary remote geometry update before the structural update.
- Preserved authoritative current-build `N=3`: `evidence/p6_orphan_structural_n3/`. Each raw log carries protocol-4 arm, precursor arrival/+3 s, structural arrival/+3 s, post-activation, and restoration snapshots.

## Ownership-fix verification boundary

- The persisted live `N=3` RED was accepted by a fresh stateless verdict runner.
- A focused same-path close/survivor test proves the new owner handover behavior and passed together with the existing attach-seam coverage.
- Copy-aside, ownership-predicate-only RED, byte-identical restore, and GREEN causation proof completed locally.
- Full Vitest passed `452` files and `3432` tests; TypeScript, production build, and protocol-4 diagnostic E2E build passed.
- The fixed diagnostic bundle hash is `C47EF17EEC4809FA9DD864DB4069ED6AA5150467EFBEF2AB31998413486F5025`.
- The test-vault-only rollback exception preserves the isolated pinned-source bundle `977C37225134D113CD9CDC8F526DC0E5572771889D95D15C7BDE55C03E2F6D3A` as the primary functional rollback and `A3A438EC49A73041B0BEB30EC6B71EAA165C0DE53F32E52F757A70C32B02C916` as secondary fallback under `H:\tmp\w5_test_rollback_exception_20260811`. The exact historical `23DE849386069C435CFBAD8F18B0CFE5D2F78B1F0B5A38A6DF0B7A49C6E6D615` binary remains unavailable; the mismatch is documented as toolchain-induced.
- The primary rollback booted as protocol 3 on owned test window B, then the fixed bundle restored byte-exact and booted as protocol 4. A/B/C subsequently reloaded the fixed C47 bundle; C used the visible German `Anwendung neu laden, ohne zu speichern` command and an observed endpoint-down to protocol-4 transition.
- The live duplicate-owner-stays control passed: closing a newly opened duplicate did not replace the still-mounted original owner.
- Exact accepted-RED order rerun on the surviving same-path leaf is GREEN `N=3`; raw artifacts and hashes are in `evidence/p6_owner_fix_green_n3/`. Each run preserved protocol-4 arm/ordinary arrival/+3 s/structural arrival/+3 s/activation/restoration snapshots. Model and inline paint agreed at all points on stable attached `leaf-3`, and exact A/C record, text, and geometry restoration passed.
- `python harness/probes/verify_p6_owner_fix_green.py` independently parses the three raw logs and fails on any protocol, identity, attachment, paint/model, structural-counter, occlusion, or restoration mismatch.
- Fresh stateless W4 final review: `ACCEPTED`. It independently matched all six RED/GREEN run hashes, verified one JSON payload per run, confirmed the one-change owner-handover scope and no-churn control, accepted the explicit test-vault rollback exception, and found restoration/security evidence sufficient.
