# Harness — B75-CanvasPaintDisjoint

- **Built at:** `fix-bugs-and-raceconditions` @ `d22cdba` ("fix(canvas): hand off presence ownership and release 0.7.2").
  Tree DIRTY: 38 untracked `workflowArtifacts/canvas-v2/diag/w5-*.json` from a prior session (read as
  evidence, never touched). This harness adds only files under
  `workflowArtifacts/debug/B75-CanvasPaintDisjoint/harness/`.
- **Reported expectation probed:** *"Panning and moving nodes disjoints the canvas … the bug is purely
  visual — the canvas RENDERING was the real problem."*
  **Reading chosen (the report is vague about what "disjointed" means):** the most literal one —
  **a card is painted somewhere other than where its model says it is.** Everything here measures the
  gap between *where a card belongs* and *where its element actually sits*, or a mechanism that can
  open that gap. The alternative readings (edges detaching from cards; peers disagreeing about the
  model) are covered only insofar as P5 compares peers; edge geometry is not probed at all.
- **Runner:** `python run --all` (from this directory)

  ```text
  python run --all                  every probe
  python run --probes P1,P4         a named subset
  python run --kind code-level      the vitest probes (no live app needed)
  python run --kind integration     the live-rig probes
  python run --list                 the registry
  ```

  Exit code is non-zero if any probe failed. Each probe prints exactly one `<id> PASS|FAIL` line.
  Unrecognised extra arguments are forwarded to the probe, so
  `python run --probes P6 --settle 30` and `python run --probes P4 --path "_liveshare-test/Other.canvas"`
  both work.

## Probes

| Probe ID | Kind | Framework | What it asserts | Invoke | Fired during hunt |
|---|---|---|---|---|---|
| P1 | code-level | vitest | No rule in `plugin/styles.css` declares a layout-affecting property (`position`, `display`, `width`, `margin`, `transform`, …) for a class the canvas code attaches to an element **Obsidian owns**. The set of such classes is derived, not hardcoded: classes passed to `classList.add(...)` minus classes put on elements the plugin created itself. | `python run --probes P1` | **YES** |
| P2 | code-level | vitest | Driving the real `CanvasPresence` with one remote hold writes **nothing** into the host card element — no class, no inline custom property, no appended child. Independent of P1: it would still fire if the ring were applied as an inline style instead of a class. | `python run --probes P2` | **YES** |
| P3 | code-level | vitest | Every private Obsidian member `canvas-adapter.ts` reaches for (`wrapperEl`, `canvasEl`, `nodeEl`, `markMoved`, `requestSave`, `getData`, `setData`, `startEditing`, `isEditing`, `posFromEvt`, `requestFrame`, `.canvas-node`, `.canvas-node-container`) exists in the **running** Obsidian bundle. Reads the live extracted bundle when present, else `fixtures/obsidian-symbols.json`, and prints which. | `python run --probes P3` | NO |
| P4 | integration | python + the plugin's `canvas.diag` HTTP surface | On every peer, every live card's **painted** rect (de-transformed back into canvas units) matches its model `x/y` within the instrument's own tolerance. Detached (off-screen) cards are excluded; never-painted and unreadable cards fail. | `python run --probes P4` | **YES** |
| P5 | integration | python + `canvas.diag` | The three peers agree with **each other** about where each card is painted. Catches the failure mode P4 is blind to: a peer whose model is wrong too, so its paint and its model agree while the board is visibly disjointed. | `python run --probes P5` | NO |
| P6 | integration | python + `canvas.diag` | On a board nobody is touching, the plugin's repaint sweep does not `repair` anything — a card that reseats itself with no user action is the reported symptom. Also fails on `ticks == 0` (a sweep that never ran cannot report an honest zero). | `python run --probes P6` | **YES** (see caveat) |
| P7 | integration | python + `canvas.diag` | Re-opening the board (the one real user action the control surface can drive) moves no card's painted position on any peer. | `python run --probes P7` | NO |

`Kind` is what the probe **is**: `code-level` runs anywhere with `plugin/node_modules` installed;
`integration` needs the live three-vault rig on ports 39431/39432/39433.

## What fired, and what it showed

- **P1** — `plugin/styles.css` line 323: `.ls-canvas-held-ring { … position: relative; }`, and
  `ls-canvas-held-ring` is attached to `node.nodeEl` (an Obsidian `.canvas-node`).
- **P2** — three writes into the host card element per hold:
  `classList.add("ls-canvas-held-ring")`, `style.setProperty("--ls-hold-color", …)`,
  `appendChild(<div class="ls-canvas-held-tag">)`.
- **P4** — exactly one card diverged, on two of three peers, at the moment of measurement:

  | | node `89681e8cb3361317` |
  |---|---|
  | model | `x=2480 y=-1870 w=720 h=230` |
  | `nodeEl.style.transform` | `translate(2480px, -1870px)` — **agrees with the model** |
  | painted rect (peer B, scale 0.212) | `x=2480.0  y=-1590.3` → **dy = +279.71** |
  | painted rect (peer C, scale 0.293) | `x=2480.0  y=-1590.2` → **dy = +279.79** |

  Every other card on B and C agreed to within 0.3 canvas units. `x` is exact; the displacement is
  purely vertical. The card is detached (off-screen) on peer A, so A neither confirms nor denies.
- **P6** — inconclusive in this environment, and it says so: `ticks` did not advance on any peer
  during the settle window because all three Obsidian windows were backgrounded (Electron throttling).
  What the accumulated counters do show: `sweep.repairs = 0` on all three peers across
  1134 / 2205 / 1548 sweep attempts, while the event seams have repaired 3 (A, `perNodeSeam`) and
  14 (C, 8 `perNodeSeam` + 6 `structuralSeam`).

## Layout

```text
harness/
├── run                       ← the runner (python; --all / --probes / --kind / --list)
├── HARNESS.md                ← this file
├── vitest.config.mjs         ← root=plugin/, include=this harness. No `vitest/config` import:
│                               nothing above workflowArtifacts/ can resolve it.
├── lib_peers.py              ← shared HTTP envelope for the integration probes; same shape and
│                               same refusal discipline as tools/e2e/canvas_diag.py
├── probes/                   ← one file per probe
├── fixtures/
│   ├── extract_obsidian_fixture.py   ← regenerate after every Obsidian update
│   ├── obsidian-canvas.css           ← every `.canvas*` rule from Obsidian 1.13.6
│   └── obsidian-symbols.json         ← private-member census of the 1.13.6 bundle
├── evidence/                 ← raw peer responses, written before anything is printed
├── _orient.py                ← scratch: live peer state + prior-session diag summary (not a probe)
└── _analyse.py               ← scratch: renders the P4 evidence as a per-node table (not a probe)
```

## Promotion notes

- `vitest.config.mjs` sets `root` to `plugin/`, so P1–P3 already resolve exactly what the project's
  own config resolves. Promotion is a `git mv` into `plugin/src/__tests__/` with the four
  `../../../../../plugin/src/...` import prefixes shortened; no rewrite.
- P4–P7 use the same `post()` envelope as `tools/e2e/canvas_diag.py` and belong beside it in
  `tools/e2e/` if they survive.
- `fixtures/obsidian-*.{css,json}` are snapshots of an **auto-updating** application. P3 prefers the
  live bundle and prints which source it read; a green P3 read from a stale fixture is not a reading.

## Operating notes

- No probe writes to a vault, to the repository, or to the plugin. P7 sends `canvas.open`, which
  re-opens a board that is already open; nothing else leaves a mark.
- Run everything through the visible-console MCP server (`run_python` → `await_console`), never as a
  Bash background process.
- The rig must not be rebuilt. If a peer stops answering, use
  `python h:/tmp/liveshare_debug/restart_obsidian.py --list` to look before touching anything.
