"""Generate the 42 TaskCharter files for the canvas-V2 initiative.

ACs, interfaces, change type, DoD, fuzzer link and schema impact are PARSED out of
BUILD_SPEC_CanvasV2.md so they are copied verbatim (no paraphrase, per the
Atomic Orchestrator TaskCharter contract). Phase / title / dependencies are parsed
out of the section 9 breakdown table. Only the per-WP scope boundaries, entry
points and required files are authored here.

Run once. Idempotent: overwrites its own output.

!!! DO NOT RE-RUN (guard added 2026-08-01, Worker 2, T3 amendment) !!!
    Two reasons, either sufficient:
      1. Worker 3 has since filled sections 8-10 of several WP1-WP7 charters (and WP7 carries
         its BLOCKED risk notes). Re-running would overwrite that state with empty templates.
      2. The BUILD_SPEC now carries 54 components and 54 section-9 rows, so the asserts below
         fail anyway.
    The T3 charters (WP43-WP54) are produced by the sibling `_generate_charters_t3.py`, which
    touches only its own range. If WP1-WP42 ever need regeneration, do it per-WP deliberately.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

raise SystemExit(
    "REFUSING TO RUN: this generator overwrites TaskCharter_WP1..WP42, several of which now "
    "carry Worker 3 implementation state (sections 8-10). See the module docstring. For the T3 "
    "range use _generate_charters_t3.py. Remove this guard only with a deliberate decision."
)

HERE = Path(__file__).resolve().parent
SPEC = HERE / "BUILD_SPEC_CanvasV2.md"
SPEC_REL = "workflowArtifacts/canvas-v2/BUILD_SPEC_CanvasV2.md"

# --------------------------------------------------------------------------
# Parse the BUILD_SPEC
# --------------------------------------------------------------------------

text = SPEC.read_text(encoding="utf-8")

# --- section 9 table: WP -> (phase, title, scope summary, depends) ---------
row_re = re.compile(
    r"^\|\s*(WP\d+)\s*\|\s*(P\d)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*planned\s*\|$",
    re.MULTILINE,
)
table: dict[str, dict[str, str]] = {}
for m in row_re.finditer(text):
    wp, phase, title, scope, deps = m.groups()
    table[wp] = {
        "phase": phase,
        "title": title.strip(),
        "scope": scope.strip(),
        "deps": deps.strip(),
    }

# --- component blocks ------------------------------------------------------
block_re = re.compile(r"^#### (C\d+) — (.+?)$", re.MULTILINE)
marks = list(block_re.finditer(text))
components: dict[str, dict] = {}

for i, m in enumerate(marks):
    start = m.end()
    end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
    body = text[start:end]

    def field(name: str) -> str:
        f = re.search(rf"^- {re.escape(name)}:\s*(.+?)$", body, re.MULTILINE)
        return f.group(1).strip() if f else ""

    sub = {}
    for key in ("Input", "Output"):
        f = re.search(rf"^  - {key}:\s*(.+?)$", body, re.MULTILINE)
        sub[key] = f.group(1).strip() if f else ""

    ac_block = re.search(
        r"^- Acceptance Criteria:\s*$\n((?:^  \d+\. .+$\n?)+)", body, re.MULTILINE
    )
    acs: list[str] = []
    if ac_block:
        for line in ac_block.group(1).splitlines():
            acs.append(re.sub(r"^\s*\d+\.\s*", "", line).strip())

    wp = re.search(r"^- Assigned to work package: \*\*(WP\d+)\*\*", body, re.MULTILINE)
    if not wp:
        continue

    components[wp.group(1)] = {
        "cid": m.group(1),
        "cname": m.group(2).strip(),
        "change_type": field("Change type"),
        "responsibility": field("Responsibility"),
        "input": sub["Input"],
        "output": sub["Output"],
        "acs": acs,
        "dod": field("Definition of Done"),
        "fuzzer": field("Fuzzer link"),
        "schema": field("Schema impact"),
    }

assert len(table) == 42, f"expected 42 table rows, got {len(table)}"
assert len(components) == 42, f"expected 42 components, got {len(components)}"

# --------------------------------------------------------------------------
# Authored per-WP data: filename slug, scope boundaries, entry points, files
# --------------------------------------------------------------------------

PHASE_SCHEMA = {
    "P0": (
        "No `meta.schemaVersion` change and no `.canvas` file-format change. P0 is a pure "
        "logic change in the capture and serialisation paths, which is exactly why it ships "
        "first (CONCEPT_V2 Teil 13). Mixed-version behaviour: a P0 client and a pre-P0 client "
        "interoperate unchanged at the doc level."
    ),
    "P1": (
        "**`meta.schemaVersion = 2`.** The *doc* format changes; the `.canvas` *file* format "
        "does not. Mixed-version rule (CONCEPT_V2 Teil 12): a client whose major schema version "
        "differs from the doc's goes to Receive-and-Persist rather than guessing a translation. "
        "In P1 that degradation is local — capture disabled for the path, persistence continues — "
        "and it is unified with the room-level mode in WP32."
    ),
    "P2": (
        "No `schemaVersion` bump. Adds `meta.guid`, `meta.epoch` and `meta.path`, the sidecar "
        "files, and changes the doc-id namespace from path-based to guid-based. Mixed-version "
        "rule: a client that cannot resolve a guid for a path treats the doc as unknown and asks "
        "peers or the manifest — it never seeds a second doc for the same file."
    ),
    "P3": (
        "No `schemaVersion` bump. The manifest doc gains `path → {mode, guid}`. Mixed-version "
        "rule: a schema-major mismatch resolves through this phase's Receive-and-Persist mode, "
        "which becomes the single degradation state for both causes."
    ),
    "P4": (
        "No `schemaVersion` bump, but node `text` and edge `label` change representation inside "
        "schema major 2 from a plain LWW value to a nested `Y.Text`. Mixed-version rule: reads "
        "MUST tolerate both shapes (a plain string and a `Y.Text`) within major 2. If a tolerant "
        "read proves impossible, ESCALATE for a schema-major bump — do not guess and do not "
        "silently coerce."
    ),
    "P5": (
        "No schema change. Only the origin of captured writes changes (`CAPTURE_OP` in addition "
        "to `CAPTURE_NET`); both write the same V2 registers, so a mixed room is unaffected."
    ),
    "P6": (
        "No doc schema change. Adds a checkpoint frame type to the mux protocol; every existing "
        "frame type keeps its meaning and encoding, and a relay or client without blob support "
        "must keep working (graceful fallback)."
    ),
}

COMMON_HARD = [
    "Invariants I1–I5 (`ARCHITECTURE.md`) and I6–I10 (CONCEPT_V2 Teil 3) are binding and must not be weakened.",
    "Yjs stays. No CRDT library swap, no alternative CRDT introduced anywhere.",
    "`CanvasPersistence` remains the single CRDT→disk writer; it emits zero CRDT writes; `coldOpen` runs after `waitForSync` and before `start()`.",
    "**Zero new runtime dependencies.** Any dependency at all requires a publish date >= 7 days old (`npm view <pkg>@<version> time.created`); `npm ci` in build/deploy contexts, never `npm install`.",
    "`GEOMETRY_KEYS` keeps exactly `{x, y, width, height}` and stays exported (it now describes the *file* schema). Changing membership or removing the export is an ESCALATE.",
    "`plugin/src/canvas/canvas-presence.ts` is not modified by this initiative. If a WP believes it must, that is an ESCALATE.",
    "`plugin/src/main.ts` may hold wiring only, never logic — it has no test file.",
    "`canvas-binding.ts` / `canvas-model-bridge.ts` stay frozen and `useCanvasBinding` stays `false` until WP39/WP40 (only WP22 makes a narrow removal there).",
    "Do not bump the plugin version. Do not hand-edit `plugin/main.js` or `server/dist/`. Do not read or edit `plugin/manifest.json` (broken symlink).",
    "`server/` source is off limits except in WP41. Deployment, `docker/.env` and any secret are out of scope entirely.",
]

COMMON_FLAKY = [
    "No timing-based echo suppression: no new `setTimeout` waits and no new timing constants. V2's echo breaker is byte equality.",
    "No wall-clock sleeps in new tests (the existing 33.5 s sleeper in `wp5/latency.test.ts` is legacy, not a pattern to copy).",
    "Never reason from two peers only — interleaving classes from three peers upward are distinct.",
    "Do not assert on log strings as the primary oracle; state is the oracle, signatures are for humans.",
    "Biome reports a whole-file `format` finding per touched file (CRLF environment artifact). Advisory locally, gating in CI — do not mass-reformat.",
]

COMMON_ENV = (
    "Windows dev host; run all plugin commands from `plugin/` (never the repo root). "
    "Runner is Vitest 4.0.18 — the `basic` reporter was removed, use the default or `--reporter=dot`. "
    "Budget >= 90 s for any automated `npm test` invocation (a 33.5 s sleeper makes ~41 s the floor, not a hang). "
    "No Graphify graph exists for this project (declared FALLBACK mode) — `workflowArtifacts/RepoMap.md` is the structural map."
)

# slug, out-of-scope bullets, entry points, required files
D: dict[str, dict] = {
"WP1": dict(slug="SurfaceShadowCore",
  out=["Any change to the capture path, the reconcile path or `main.ts` — this WP creates the module only.",
       "Persisting the shadow to disk; the shadow is in-memory state rebuilt from the surfaces.",
       "V2 register granularity (`pos`/`size`/`from`/`to`) — that is WP15."],
  entry=["`plugin/src/canvas/canvas-shadow.ts` (new)",
         "`plugin/src/canvas/reconcile-plan.ts:163–185` — the precedent for a zero-import pure module",
         "`plugin/src/main.ts:114` — `canvasApplied`, the record-granular shadow this module replaces (read for shape only; do not edit here)"],
  files=["`plugin/src/canvas/canvas-shadow.ts` (new)"]),

"WP2": dict(slug="ShadowIntentDiff",
  out=["Writing anything to the CRDT — this WP returns a plan, it does not apply it.",
       "Reading files or parsing `.canvas` content; the parsed save is an input.",
       "Tombstone *writing*; the tombstone view is an input parameter here."],
  entry=["`plugin/src/canvas/canvas-shadow.ts` (from WP1)",
         "`plugin/src/files/canvas-sync.ts:496–619` — `handleLocalModify`, the consumer this plan will serve (read only; wiring is WP4)",
         "CONCEPT_V2 Teil 5, the four-rule table"],
  files=["`plugin/src/canvas/canvas-shadow.ts`"]),

"WP3": dict(slug="CanonicalFormCore",
  out=["`(ord, id)` sorting and register expansion — that is WP17 (`ord` does not exist until P1).",
       "Changing the tab indentation or the overall file shape Obsidian expects.",
       "Any change to `parseCanvas` — that is WP16."],
  entry=["`plugin/src/files/canvas-sync.ts:98–130` — `buildCanvasData`",
         "`plugin/src/files/canvas-sync.ts:132–137` — `serializeCanvas`",
         "`plugin/src/files/canvas-persistence.ts:388` — the re-export, and `:229` — the only disk-writing call site"],
  files=["`plugin/src/files/canvas-sync.ts`"]),

"WP4": dict(slug="CaptureShadowRebase",
  out=["Removing `lastWrittenContent` entirely — it may remain as an echo/telemetry aid; only its role as the *intent basis* is removed.",
       "The lock write-denial seam (`canWriteEntity`) — that is WP21.",
       "Reconcile-side shadow advancement — that is WP5."],
  entry=["`plugin/src/files/canvas-sync.ts:496–619` — `handleLocalModify` (guards `:498`, `:499`, `:502`; read `:511`; parse `:512`)",
         "`plugin/src/files/canvas-sync.ts:520–521` — the baseline read and three-way base construction (the exact seam being replaced)",
         "`plugin/src/files/canvas-sync.ts:526–538` — the semantic echo breaker",
         "`plugin/src/files/canvas-sync.ts:620–704` — `applyLocalDiffToYMaps`",
         "`plugin/src/files/canvas-sync.ts:856–879` — `noteExternalDiskWrite`",
         "`plugin/src/files/canvas-sync.ts:251` — `lastWrittenContent` and its writers `:400`, `:535`, `:579`, `:858`"],
  files=["`plugin/src/files/canvas-sync.ts`"]),

"WP5": dict(slug="PerFieldApplyReceipt",
  out=["Any canvas decision logic inside `main.ts` — wiring only.",
       "Changing `planReconcile`'s classification algorithm; only the shadow it classifies against changes.",
       "The editing-aware `isBusy()` extension — that is WP37."],
  entry=["`plugin/src/main.ts:114` — `canvasApplied`",
         "`plugin/src/main.ts:1046–1175` — `reconcileLiveCanvas` (adapter gate `:1053`, busy gate `:1054–1059`, plan call `:1071–1077`, noop early-out `:1080`)",
         "`plugin/src/main.ts:1110` / `:1146` — the two apply-ok shadow writes; `:1029` / `:1425` — the deletes",
         "`plugin/src/canvas/reconcile-plan.ts:33–55` — `ReconcilePlanInput`"],
  files=["`plugin/src/main.ts`", "`plugin/src/canvas/canvas-shadow.ts`", "`plugin/src/canvas/reconcile-plan.ts` (only if its input shape must follow)"]),

"WP6": dict(slug="ChaosSuiteI",
  out=["Production code changes — if a scenario cannot be built without one, ESCALATE rather than modify behaviour to fit the test.",
       "The P2/P3 scenarios (host rejoin, fallback coexistence) — that is WP35.",
       "Live Obsidian runs — that is WP7."],
  entry=["`plugin/src/__tests__/harness/two-peer.ts` (545 L) and its self-test",
         "`plugin/src/__tests__/harness/canvas-double.ts` (318 L)",
         "`plugin/src/__tests__/harness/interaction-driver.ts` (145 L)"],
  files=["new suites under `plugin/src/__tests__/`"]),

"WP7": dict(slug="E2ERigMandatoryGate",
  out=["Verifying the `CAPTURE_TRIGGERS` table — that is WP40 (it requires the binding path).",
       "Enabling `useCanvasBinding`.",
       "Any relay deployment; the rig runs against a local relay."],
  entry=["`tools/launch_liveshare_e2e.py` — `preflight()` `:73`, `build_bundle()` `:90`, `run_bundle()` `:117`, `main()` `:161`; constants `:38–57`; ports 39421/39422",
         "`plugin/src/__tests__/e2e/launch-entry.ts` (98 L) — the bundled TS entry",
         "`plugin/src/testing/e2e-control.ts` — `createControlServer` `:185`, `buildPluginHost` `:356`, `maybeStartE2EControlServer` `:481`",
         "`plugin/esbuild.config.mjs:26` — the `__LS_E2E__` production gate",
         "`workflowArtifacts/e2e-infra/E2E_USAGE.md`"],
  files=["`tools/launch_liveshare_e2e.py`", "`plugin/src/testing/e2e-control.ts` (only if the run reveals a rig defect)", "`workflowArtifacts/e2e-infra/E2E_USAGE.md`"]),

"WP8": dict(slug="MetaSchemaVersionMigration",
  out=["Populating `meta.guid` / `meta.epoch` — those arrive in P2 (the keys may be declared, not filled).",
       "The full Receive-and-Persist mode — WP32; P1 only disables local capture for a mismatched path.",
       "Changing the doc id (still path-based until WP27)."],
  entry=["`plugin/src/files/canvas-sync.ts:16` — `CANVAS_DOC_PREFIX`, and the doc-id sites `:334`, `:348`, `:367`, `:493`, `:504`",
         "`plugin/src/files/canvas-sync.ts:360–467` — `subscribe`, incl. the host seed `:388–401`",
         "`plugin/src/files/canvas-persistence.ts:363–387` — `seedDocFromCanvasData`",
         "map names `\"nodes\"`/`\"edges\"` at `canvas-sync.ts:350–351, 384–385`; `canvas-persistence.ts:147–148, 365–366`"],
  files=["`plugin/src/files/canvas-sync.ts`", "a new migration module under `plugin/src/canvas/` or `plugin/src/files/`"]),

"WP9": dict(slug="AtomicPosSizeRegisters",
  out=["Changing `GEOMETRY_KEYS` membership or its export (hard constraint).",
       "The serializer's expansion of these registers back into the file — that is WP17.",
       "The shadow's register granularity — that is WP15."],
  entry=["`plugin/src/files/canvas-sync.ts:29` — `GEOMETRY_KEYS` (file schema, unchanged)",
         "`plugin/src/canvas/reconcile-plan.ts:56–63` — `RECONCILE_GEOMETRY_KEYS`, the drift-guarded mirror",
         "`plugin/src/canvas/canvas-model-bridge.ts:94` — the third geometry-key copy",
         "CONCEPT_V2 Teil 4, the field-by-field merge policy table"],
  files=["a new register module under `plugin/src/canvas/`", "`plugin/src/files/canvas-sync.ts` (type shapes only)"]),

"WP10": dict(slug="AtomicEndpointRegisters",
  out=["The dangling-edge prune and cascade behaviour — that is WP19.",
       "Serializer expansion — WP17.",
       "The lock seam's edge endpoint double-check — that is removed in WP21."],
  entry=["`plugin/src/files/canvas-sync.ts:53–62` — `PROTECTED_KEYS`, which currently carries the endpoint keys",
         "`plugin/src/files/canvas-sync.ts:723–739` — `pruneEdgesForDeletedNodes` (read for the endpoint contract)",
         "CONCEPT_V2 Teil 4, the `from`/`to` rows"],
  files=["a new register module under `plugin/src/canvas/`", "`plugin/src/files/canvas-sync.ts` (type shapes only)"]),

"WP11": dict(slug="WriteOnceTypeGuard",
  out=["Wiring the guard into the write boundaries — that is WP18.",
       "Removing `PROTECTED_KEYS`, which stays as defence in depth without carrying correctness."],
  entry=["`plugin/src/files/canvas-sync.ts:53–62` — `PROTECTED_KEYS`",
         "`plugin/src/files/canvas-sync.ts:171–195` / `:210–234` — `applyToYMap` and `applyKeyDiff`, the two existing delete guards",
         "`ARCHITECTURE.md` Appendix A.2/17 — the `type`-loss silent-drop case"],
  files=["the ingest/guard module under `plugin/src/canvas/`"]),

"WP12": dict(slug="TombstoneMapCore",
  out=["Wiring tombstones into capture, reconcile and serialisation — that is WP19.",
       "The quarantine auditor's decision logic — that is WP20 (this WP provides the `q` flag mechanics only).",
       "Sidecar tombstone GC — that is WP25."],
  entry=["CONCEPT_V2 Teil 4 — the `deleted` row and the undo argument",
         "`plugin/src/files/canvas-sync.ts:620–704` — the current delete-by-diff logic being replaced (read only)",
         "`ARCHITECTURE.md` Appendix A.2/11 — delete-vs-edit semantics to preserve"],
  files=["a new tombstone module under `plugin/src/canvas/`"]),

"WP13": dict(slug="FractionalOrdAllocator",
  out=["Deciding *when* to reallocate `ord` from an Obsidian save — that is WP16.",
       "Writing `ord` into the `.canvas` file (it must never be written).",
       "Any tree/hierarchy modelling — Obsidian groups are geometric, there is no tree CRDT."],
  entry=["CONCEPT_V2 Teil 4 (the `ord` row) and Teil 10 (the conservative capture rule)",
         "`plugin/src/files/canvas-sync.ts:98–130` — `buildCanvasData`, whose unspecified Y.Map iteration order this replaces"],
  files=["a new fractional-index module under `plugin/src/canvas/`"]),

"WP14": dict(slug="IngestSchemaValidator",
  out=["Calling the validator at write boundaries — that is WP18.",
       "Repairing invalid records already in the doc — that is WP20.",
       "Rejecting remote deltas (explicitly forbidden: it would cause divergence)."],
  entry=["CONCEPT_V2 Teil 11 — the two validity rules",
         "`plugin/src/files/canvas-sync.ts:880–948` — `auditCanvasState`, whose current detection categories (`noGeo`, `noType`, `fileNodesWithoutFile`, `danglingEdges`) define the same invariants",
         "`ARCHITECTURE.md` Appendix A.2/16–18"],
  files=["a new validator module under `plugin/src/canvas/`"]),

"WP15": dict(slug="ShadowRegisterGranularity",
  out=["Creating the registers themselves (WP9/WP10) — this WP consumes them.",
       "Writing tombstones — the tombstone view is an input.",
       "Any change to the capture wiring — WP4 already owns that seam."],
  entry=["`plugin/src/canvas/canvas-shadow.ts` (WP1/WP2)",
         "the register modules from WP9 and WP10",
         "CONCEPT_V2 Teil 5 and Teil 6.1 — one shadow, two consumers"],
  files=["`plugin/src/canvas/canvas-shadow.ts`"]),

"WP16": dict(slug="ParseCanvasV2OrdCapture",
  out=["Serialisation — that is WP17.",
       "Allocating `ord` values (the allocator is WP13; this WP decides when to call it).",
       "Changing the silent-failure behaviour on malformed JSON (it must be preserved)."],
  entry=["`plugin/src/files/canvas-sync.ts:74–94` — `parseCanvas` (JSON error path `:91–93`)",
         "`plugin/src/files/canvas-sync.ts:69–73` — `CanvasData`",
         "CONCEPT_V2 Teil 10 — the conservative reordering rule and its R2-class caveat"],
  files=["`plugin/src/files/canvas-sync.ts`"]),

"WP17": dict(slug="CanonicalSerializerV2",
  out=["Changing what Obsidian expects in the file — the output schema is fixed by Obsidian, not by us.",
       "Writing `ord` into the file.",
       "The tombstone *decision*; this WP consumes the suppression predicate from WP12."],
  entry=["`plugin/src/files/canvas-sync.ts:98–130` — `buildCanvasData` (dangling-edge prune `:120–126`)",
         "`plugin/src/files/canvas-sync.ts:132–137` — `serializeCanvas`",
         "`plugin/src/files/canvas-persistence.ts:388` (re-export) and `:229` (the only call site)"],
  files=["`plugin/src/files/canvas-sync.ts`"]),

"WP18": dict(slug="IngestCreateOnceWiring",
  out=["The validator's rules themselves — WP14.",
       "The `CAPTURE_OP` boundary — that is P5 (WP39); wire the seam so it can be added without redesign.",
       "Quarantining records already in the doc — WP20."],
  entry=["`plugin/src/files/canvas-sync.ts:388–401` — the host seed transaction",
         "`plugin/src/files/canvas-persistence.ts:363–387` — `seedDocFromCanvasData`",
         "`plugin/src/files/canvas-sync.ts:620–704` — `applyLocalDiffToYMaps`, the `CAPTURE_NET` writer",
         "`plugin/src/files/canvas-sync.ts:171–195` / `:210–234` — `applyToYMap` / `applyKeyDiff` (the delete guards)"],
  files=["`plugin/src/files/canvas-sync.ts`", "`plugin/src/files/canvas-persistence.ts`"]),

"WP19": dict(slug="TombstoneWiring",
  out=["Undo (WP38) — this WP only guarantees the data is restorable.",
       "Sidecar-time GC of old tombstones — WP25.",
       "Quarantine decisions — WP20."],
  entry=["`plugin/src/files/canvas-sync.ts:620–704` — the delete branch of `applyLocalDiffToYMaps` (`:688`)",
         "`plugin/src/files/canvas-sync.ts:723–739` — `pruneEdgesForDeletedNodes` (cascade)",
         "`plugin/src/files/canvas-sync.ts:98–130` — the serializer's dangling-edge drop",
         "`plugin/src/canvas/reconcile-plan.ts:122–162` — `diffRecords`, which must see suppressed records as absent"],
  files=["`plugin/src/files/canvas-sync.ts`", "`plugin/src/canvas/reconcile-plan.ts`", "the tombstone module from WP12"]),

"WP20": dict(slug="QuarantineAuditor",
  out=["Changing the audit's debounce/scheduling contract beyond what repair requires.",
       "Rejecting remote deltas at ingest (forbidden — repair is the remote-side answer).",
       "Removing `PROTECTED_KEYS` (it stays as defence in depth)."],
  entry=["`plugin/src/files/canvas-sync.ts:880–948` — `auditCanvasState` (currently log-only; `noGeo` `:894`, `noType` `:896`, `fileNodesWithoutFile` `:898`, `danglingEdges` `:899+`)",
         "`plugin/src/files/canvas-sync.ts:814–855` — `scheduleCanvasAudit` (calls the audit at `:836`)",
         "`plugin/src/files/canvas-sync.ts:444` — the single call site, inside the doc observer"],
  files=["`plugin/src/files/canvas-sync.ts`"]),

"WP21": dict(slug="RemoveLockWriteDenial",
  out=["`plugin/src/canvas/canvas-presence.ts` — must stay byte-unchanged; locks keep working as UX.",
       "`canWriteCanvasPath` (read-only permission and guest globs) — that is authorisation, not locking, and stays.",
       "The `LOCK REVERT:` view-revert path, which is retained.",
       "The awareness liveness machinery (deadline pulse, reconnect reclaim defer, tiebreak) — unchanged."],
  entry=["`plugin/src/files/canvas-sync.ts:705–722` — `canWriteEntity` and its three call sites `:642`, `:660`, `:688`",
         "`plugin/src/files/canvas-sync.ts:576` — the `LOCK DENIED:` emitter",
         "`plugin/src/files/canvas-sync.ts:256`, `:259`, `:260`, `:264` — the injected predicates and their setters `:297`, `:304`, `:308`, `:313`",
         "`plugin/src/main.ts:792`, `:796–799`, `:800–803`, `:804–806` — the predicate wiring; `:1279–1285` — the binding-side mirrors",
         "`plugin/src/main.ts:1176–1185` — `canWriteCanvasPath` (KEEP)",
         "`plugin/src/main.ts:1364–1381` — `revertCanvasNode` (KEEP)"],
  files=["`plugin/src/files/canvas-sync.ts`", "`plugin/src/main.ts`", "test files pinning the removed behaviour (enumerated in the report)"]),

"WP22": dict(slug="RemoveWriteRecordMinimalDeletion",
  out=["Flipping `useCanvasBinding` — that is WP40 only.",
       "The wider op-capture contract renewal — that is WP39.",
       "Any other change to `canvas-binding.ts`; this is the one narrowly permitted edit before WP39."],
  entry=["`plugin/src/canvas/canvas-binding.ts:126–143` — `writeRecordMinimal` (sets changed keys, deletes absent ones; no `PROTECTED_KEYS` guard)",
         "`plugin/src/canvas/canvas-binding.ts:260–309` — `captureLocal`, which calls it at `:294`",
         "`plugin/src/testing/e2e-control.ts:338–355` — `upsertRecord`, the rig's mirror of the same write shape",
         "`ARCHITECTURE.md` Part IX R1 — the exact mechanism being removed"],
  files=["`plugin/src/canvas/canvas-binding.ts`", "`plugin/src/testing/e2e-control.ts`"]),

"WP23": dict(slug="ConvergenceFuzzer",
  out=["Changing production behaviour to make the fuzzer pass — a fuzzer failure is a finding, not a test defect.",
       "Ops that require mechanisms not yet built (text-edit, undo) — they are registered by WP36 and WP38.",
       "Live Obsidian — the fuzzer is headless."],
  entry=["`plugin/src/__tests__/harness/two-peer.ts` (545 L) — the existing multi-peer harness",
         "`plugin/src/__tests__/harness/canvas-double.ts` (318 L)",
         "CONCEPT_V2 Teil 14 item 1 — the four assertion families",
         "CONCEPT_V2 Teil 4 — the convergence argument the fuzzer is checking"],
  files=["new fuzzer harness + suite under `plugin/src/__tests__/`"]),

"WP24": dict(slug="SidecarStoreCore",
  out=["Wiring the store into the doc lifecycle — WP25.",
       "Excluding the files from manifest/sync — WP26.",
       "The relay-side blob store — WP41 (a separate, composable layer)."],
  entry=["CONCEPT_V2 Teil 7 — the sidecar log, its file names and the compaction/truncation rule",
         "`plugin/src/files/canvas-persistence.ts:47–60`, `:61–66`, `:420–430` — `PersistenceIO`, `PersistenceScheduler`, `PersistenceGuards`: the established injected-IO pattern to follow",
         "`plugin/src/files/canvas-persistence.ts:431–454` — `createVaultPersistenceIO`"],
  files=["a new sidecar module under `plugin/src/files/`"]),

"WP25": dict(slug="SidecarLifecycleCompaction",
  out=["Changing the `coldOpen` ordering contract (it must be preserved verbatim).",
       "The seed-once rule itself — WP29.",
       "GUID-based file naming beyond consuming what WP27 provides."],
  entry=["`plugin/src/files/canvas-sync.ts:360–467` — `subscribe` (waitForSync `:375`, observer install `:446–447`)",
         "`plugin/src/files/canvas-sync.ts:468–495` — `unsubscribe` (releases the doc `:493`)",
         "`plugin/src/files/canvas-persistence.ts:470–480` — `attachCanvasPersistence` and its ordering contract",
         "`plugin/src/sync/sync.ts:281–312` — `waitForSync`"],
  files=["`plugin/src/files/canvas-sync.ts`", "the sidecar module from WP24"]),

"WP26": dict(slug="SidecarExclusion",
  out=["Changing the existing `.canvas` exclusion behaviour.",
       "Closing the `BackgroundSync.subscribe` door for `.canvas` — that is WP33."],
  entry=["`plugin/src/utils.ts:258` — `skipsAutoTextSync` and its four-consumer rationale comment",
         "`plugin/src/files/background-sync.ts:72` (startAll / manifest replay), `:195` (onFileAdded), `:248` (onFileRenamed)",
         "`plugin/src/files/manifest.ts:174` — `syncFromManifest`, the fourth consumer"],
  files=["`plugin/src/utils.ts`", "`plugin/src/files/background-sync.ts`", "`plugin/src/files/manifest.ts`"]),

"WP27": dict(slug="GuidDocIdentity",
  out=["Re-keying any in-memory registry, the ownership predicate or the awareness field shape — all stay path-keyed.",
       "The epoch comparison rule — WP28.",
       "Changing `SyncManager.getDoc`'s create-on-demand behaviour for non-canvas docs."],
  entry=["`plugin/src/files/canvas-sync.ts:16` — `CANVAS_DOC_PREFIX` (module-private, not exported) and the five construction sites `:334`, `:348`, `:367`, `:493`, `:504`, plus `:768`",
         "`plugin/src/sync/sync.ts:200–252` — `getDoc` creates a `Y.Doc` + `Y.Text(\"content\")` on demand (`:210`, `:249`)",
         "`plugin/src/files/background-sync.ts:173` — unguarded bare-path `getDoc` inside `setActiveFile`",
         "`plugin/src/editor/collab.ts:62` — unguarded bare-path `getDoc` inside `activateForFile`",
         "`plugin/src/files/manifest.ts` — the manifest doc and `syncFromManifest`",
         "`plugin/src/files/vault-events.ts:53–63` — `canvasOwned` (stays path-based)"],
  files=["`plugin/src/files/canvas-sync.ts`", "`plugin/src/files/manifest.ts`", "`plugin/src/files/background-sync.ts`", "`plugin/src/editor/collab.ts`", "the sidecar index from WP24"]),

"WP28": dict(slug="EpochRuleConflictArchive",
  out=["The user-triggered import that increments the epoch — WP30.",
       "Merging unrelated histories silently (explicitly forbidden).",
       "Deleting or overwriting a user's file without an archive copy."],
  entry=["CONCEPT_V2 Teil 7 — the GUID + epoch section",
         "`plugin/src/files/canvas-sync.ts:360–467` — `subscribe`, where two replicas first meet",
         "`plugin/src/files/file-ops.ts` — vault file operations for writing the archive copy"],
  files=["`plugin/src/files/canvas-sync.ts`", "a new epoch/conflict module", "`plugin/src/files/file-ops.ts` (only if a new vault operation is needed)"]),

"WP29": dict(slug="SeedOnceRemoveDestructiveReseed",
  out=["The explicit import command — WP30.",
       "Changing `ColdOpenResult`'s observable outcomes or the `coldOpen` ordering contract.",
       "`CanvasSync.writeToDisk` and its `remoteSeq` gate, which remain retained-with-no-caller."],
  entry=["`plugin/src/files/canvas-persistence.ts:310–327` — `coldOpen` (emptiness test `:312`)",
         "`plugin/src/files/canvas-persistence.ts:79–83` — `ColdOpenResult`",
         "`plugin/src/files/canvas-sync.ts:776–813` — `applyCanvasToYMaps`, destructive at `:791–793` (the R4 path)",
         "`plugin/src/files/canvas-sync.ts:388–401` — the host seed that calls it"],
  files=["`plugin/src/files/canvas-sync.ts`", "`plugin/src/files/canvas-persistence.ts`"]),

"WP30": dict(slug="ImportFromFileCommand",
  out=["Any implicit or automatic path to overwriting a living doc — this command is the only one.",
       "Changing the epoch comparison rule itself — WP28."],
  entry=["`plugin/src/session/commands.ts` (183 L) — the command registration pattern",
         "`plugin/src/ui/` — the existing modal patterns (approval/audit modals)",
         "CONCEPT_V2 Teil 7 — the named import action and its confirmation requirement"],
  files=["`plugin/src/session/commands.ts`", "a new modal under `plugin/src/ui/`", "`plugin/src/main.ts` (wiring only)"]),

"WP31": dict(slug="RoomModeConsensus",
  out=["The degradation behaviour itself — WP32.",
       "Removing the text fallback door — WP33.",
       "Changing manifest replay semantics or its `.canvas` guard."],
  entry=["`plugin/src/files/manifest.ts` (347 L) — the manifest doc, `syncFromManifest` `:174` guard, `getDoc(\"__manifest__\")` `:62`, `getDoc` `:201`",
         "CONCEPT_V2 Teil 8 — mode as shared, host-authorised state",
         "`plugin/src/files/vault-events.ts:53–63` — `canvasOwned`, the local predicate that must now follow the announced mode"],
  files=["`plugin/src/files/manifest.ts`", "`plugin/src/files/vault-events.ts`"]),

"WP32": dict(slug="ReceiveAndPersistMode",
  out=["Removing the old fallback door — WP33 (this WP builds the replacement first).",
       "The degraded *view* banner for a missing private API — WP34 (a different degradation axis).",
       "Any private-API dependency: this mode must work without one."],
  entry=["`plugin/src/files/vault-events.ts:101–117` — `subscribeCanvasWithHandover`",
         "`plugin/src/files/canvas-sync.ts:360–467` — `subscribe`, incl. the `waitForSync` timeout at `:375`",
         "`plugin/src/files/canvas-persistence.ts:470–480` — persistence attach, which must keep running in this mode",
         "CONCEPT_V2 Teil 8 — Receive-and-Persist"],
  files=["`plugin/src/files/vault-events.ts`", "`plugin/src/files/canvas-sync.ts`", "`plugin/src/main.ts` (wiring only)"]),

"WP33": dict(slug="RemoveTextFallbackDoor",
  out=["Changing generic `Y.Text` sync for genuine text files — only the `.canvas` door closes.",
       "The Receive-and-Persist mode itself — WP32 must already be in place."],
  entry=["`plugin/src/files/vault-events.ts:67–79` / `:80–83` — `warnCanvasTextFallback` and its reset (warn set `:64`)",
         "`plugin/src/files/vault-events.ts:101–117` — the failure branch calling `warnCanvasTextFallback` `:113` then `backgroundSync.subscribe`",
         "`plugin/src/files/vault-events.ts:224–271` — the modify fan-out and its `else` text branch",
         "`plugin/src/files/background-sync.ts:88` — `subscribe`, the deliberate door that does not consult `skipsAutoTextSync`",
         "`plugin/src/utils.ts:258` — `skipsAutoTextSync` (gains a fifth consumer)",
         "`ARCHITECTURE.md` Part IX R6 — the orphaned `Y.Text` to release"],
  files=["`plugin/src/files/vault-events.ts`", "`plugin/src/files/background-sync.ts`", "`plugin/src/utils.ts`", "test files pinning the removed fallback (enumerated in the report)"]),

"WP34": dict(slug="HonestDegradedReconcileMode",
  out=["Restoring reconcile without the private API — impossible by construction; this WP makes the state honest, not functional.",
       "Any canvas logic inside `main.ts` — wiring only; the state machine belongs in a module.",
       "The mode-consensus degradation (WP32), which is a different axis."],
  entry=["`plugin/src/main.ts:1046–1175` — `reconcileLiveCanvas`, adapter availability gate at `:1053`",
         "`plugin/src/main.ts` ≈`:1236–1363` — `mountCanvasPresence`",
         "`plugin/src/canvas/canvas-overlay.ts` (92 L) — the dumb DOM renderer pattern for the banner",
         "`plugin/src/canvas/canvas-adapter.ts` — the availability surface",
         "CONCEPT_V2 Teil 6.4"],
  files=["`plugin/src/main.ts` (wiring)", "a new banner/state module under `plugin/src/canvas/`"]),

"WP35": dict(slug="ChaosSuiteII",
  out=["Production changes to make a scenario pass — a red scenario is a finding.",
       "The P0 scenarios — WP6.",
       "Live Obsidian runs — WP7/WP40."],
  entry=["`plugin/src/__tests__/harness/two-peer.ts` and `harness/canvas-double.ts`",
         "the sidecar module (WP24) and the mode machinery (WP31/WP32) as injected seams",
         "CONCEPT_V2 Teil 14 item 3 — the named chaos scenarios"],
  files=["new suites under `plugin/src/__tests__/`"]),

"WP36": dict(slug="YTextNodeText",
  out=["Binding to Obsidian's private inline editor — explicitly out of scope for this initiative.",
       "The blur-merge deferral mechanism — WP37.",
       "Undo integration — WP38."],
  entry=["`plugin/src/editor/collab.ts` (135 L) — the existing `Y.Text` binding pattern",
         "`plugin/src/files/background-sync.ts` — the existing minimal text diff incl. surrogate snapping (the mechanism to reuse)",
         "map names `\"nodes\"`/`\"edges\"` at `canvas-sync.ts:350–351, 384–385` — where the nested `Y.Text` will live",
         "CONCEPT_V2 Teil 4 (the `text` row) and W8"],
  files=["`plugin/src/files/canvas-sync.ts`", "the register/record modules from P1"]),

"WP37": dict(slug="EditingAwareBusyBlurMerge",
  out=["Changing the drag watchdog behaviour or `DRAG_WATCHDOG_MS`.",
       "Modifying `canvas-presence.ts`.",
       "Real-time co-typing inside one card (out of scope for the initiative)."],
  entry=["`plugin/src/canvas/canvas-adapter.ts:87` (interface), `:572` (impl), doc `:310` — `isBusy`; `DRAG_WATCHDOG_MS = 5000` at `:260`; second consumer at `:589`",
         "`plugin/src/main.ts:1054–1059` — the busy gate in `reconcileLiveCanvas`",
         "CONCEPT_V2 Teil 6.2"],
  files=["`plugin/src/canvas/canvas-adapter.ts`", "`plugin/src/main.ts` (wiring)", "a deferral-queue module"]),

"WP38": dict(slug="UndoManager",
  out=["Replacing Obsidian's file-based undo for non-owned canvases.",
       "Undoing a peer's action under any circumstance.",
       "Changing the tombstone mechanics themselves — WP12/WP19."],
  entry=["`plugin/src/canvas/canvas-binding.ts:68` — `CANVAS_BINDING_ORIGIN`; `plugin/src/files/canvas-persistence.ts:76` — `CANVAS_SEED_ORIGIN` (the two existing transaction origins)",
         "`plugin/src/session/commands.ts` — command registration",
         "CONCEPT_V2 Teil 9 — the undo section"],
  files=["a new undo module under `plugin/src/canvas/`", "`plugin/src/session/commands.ts`", "`plugin/src/main.ts` (wiring)"]),

"WP39": dict(slug="OpCaptureContractV2",
  out=["Flipping `useCanvasBinding` — WP40 only.",
       "Verifying the trigger table empirically — WP40.",
       "Any file I/O or Obsidian import inside the binding (it stays headless)."],
  entry=["`plugin/src/canvas/canvas-binding.ts:260–309` — `captureLocal` (calls `writeRecordMinimal` at `:294`)",
         "`plugin/src/canvas/canvas-binding.ts:100–109` / `:110–125` — `recordsEqual` / `ymapToRecord`",
         "`plugin/src/canvas/canvas-model-bridge.ts:88–93` — `CAPTURE_TRIGGERS`; `:97`, `:111`, `:121–136` — the geometry helpers",
         "`plugin/src/canvas/canvas-model-bridge.ts:137` — `createCanvasModelBridge`",
         "`plugin/src/canvas/canvas-binding.ts:81–99` — the instrumentation hook"],
  files=["`plugin/src/canvas/canvas-binding.ts`", "`plugin/src/canvas/canvas-model-bridge.ts`"]),

"WP40": dict(slug="PromoteOpCapturePrimary",
  out=["Removing the `CAPTURE_NET` shadow diff — it stays as the safety net permanently.",
       "Promotion without empirical verification — an unconfirmed trigger blocks this WP."],
  entry=["`plugin/src/types.ts:36` (declaration) and `:65` (default `false`) — `useCanvasBinding`",
         "`plugin/src/main.ts:814` — the legacy reconcile bypass; `:1262` — binding construction gate",
         "`tools/launch_liveshare_e2e.py` and `plugin/src/testing/e2e-control.ts` — the verification rig",
         "`ARCHITECTURE.md` Part IX R2 — the exact list of unverified trigger assumptions"],
  files=["`plugin/src/types.ts`", "`plugin/src/main.ts`", "a recorded verification log under `workflowArtifacts/canvas-v2/`"]),

"WP41": dict(slug="RelayBlobStore",
  out=["Any change to rooms, permissions, auth or audit-log behaviour.",
       "Parsing, decrypting or inspecting frame contents — the relay stays content-blind.",
       "Deployment of the relay; this WP changes source only."],
  entry=["`server/src/persistence.ts` — the existing LevelDB persistence layer",
         "`server/src/ws-handler.ts` — the frame path",
         "`server/src/mux-protocol.ts` — the frame types",
         "`server/src/__tests__/` — 10 suites / 122 tests that must stay green",
         "CONCEPT_V2 Teil 7 — the relay persistence section and its idempotence argument"],
  files=["`server/src/persistence.ts`", "`server/src/ws-handler.ts`", "`server/src/mux-protocol.ts`", "new tests under `server/src/__tests__/`"]),

"WP42": dict(slug="ClientCheckpointReplay",
  out=["Changing the meaning or encoding of any existing frame type.",
       "Requiring a blob-capable relay; the client must degrade gracefully.",
       "Replacing the sidecar; the two layers compose."],
  entry=["`plugin/src/sync/mux-protocol.ts` (35 L) — the client frame definitions",
         "`plugin/src/sync/sync.ts:200–252` (`getDoc`), `:253–280` (`releaseDoc`), `:281–312` (`waitForSync`)",
         "`plugin/src/sync/sync.ts:87–94` — `DocHandle`",
         "the sidecar module from WP24 (the composing layer)"],
  files=["`plugin/src/sync/mux-protocol.ts`", "`plugin/src/sync/sync.ts`"]),
}

assert set(D) == set(table), f"authored data mismatch: {set(D) ^ set(table)}"

# --------------------------------------------------------------------------
# Emit
# --------------------------------------------------------------------------

TPL = """# Task Charter — {wp}: {title}

**Charter Status:** `SPEC_COMPLETE`
**WP:** {wp}
**Phase:** {phase}
**task_mode:** `standard`
**Depends on:** {deps}
**W4 Test Targets:** `0`

> **Metadata block** — Worker 3 Core reads only these fields to determine execution order and routing. Worker 4 checks `W4 Test Targets` before deciding whether to read section 7b. Full charter content is loaded by sub-agents in their own context windows.

---

## 1. Task Objective

- **Outcome:** {dod}
- **BUILD_SPEC reference:** `{spec}` — section 5, component **{cid} — {cname}** (work package {wp}); phase **{phase}**.

---

## 2. Scope and Boundaries

- **In scope:**
  - Change type: {change_type}
  - Responsibility: {responsibility}
{in_scope_extra}
- **Out of scope / non-goals:**
{out_scope}
- **Known interfaces / dependencies:**
  - Input: {input}
  - Output: {output}
  - Depends on work packages: {deps}
{fuzzer_bullet}
---

## 3. Architecture Context

*Task-local architecture guidance only.*

- **Component(s) being changed:** {cname}
- **Interfaces involved:**
  - Input: {input}
  - Output: {output}
- **Constraints from BUILD_SPEC (invariants — what must not change):**
{hard}
- **Technology / framework / config constraints:**
  - TypeScript + Yjs (`yjs ^13.6.0`); Obsidian's Canvas view is private and untyped — only `canvas-adapter.ts` may touch its internals.
  - Pure cores must import nothing from Obsidian, the filesystem or a clock; the precedent is `plugin/src/canvas/reconcile-plan.ts` (zero imports).
  - {schema_line}
- **Entry points / relevant files (from `workflowArtifacts/RepoMap.md`, V2 Touchpoint Inventory):**
{entry}
- **Structure references:** *(intentionally empty — no Graphify graph exists for this project; FALLBACK mode is declared in the BUILD_SPEC section 3. Worker 3 fills this in after implementation. Do not invent paths here.)*

If structure references conflict with the BUILD_SPEC or explicit task scope, the BUILD_SPEC and TaskCharter win. Escalate instead of following the map.

---

## 4. Acceptance Criteria

*Exact copy from BUILD_SPEC section 5, component {cid}. No paraphrasing.*

{acs}

**Definition of Done:** {dod}

---

## 5. Constraints and Known Risks

- **Permission / environment limits:** {env}
- **Known flaky patterns:**
{flaky}
- **External dependency risks:** No new runtime dependency is permitted. Yjs, `y-protocols`, `lib0` and `minimatch` are already present and are the only libraries available. Obsidian's private Canvas API may vanish at any release — degrade, never break (I5).
- **Hard constraints:**
{hard}

---

## 6. Definition of Done Artifacts

- **Required changed files:**
{files}
- **Required report:** `ImplementationReport_{wp}.md` (in `workflowArtifacts/canvas-v2/`)
- **BUILD_SPEC updates required:** no — unless implementation invalidates an architecture decision, in which case ESCALATE rather than editing the spec.
- **Gate status required at handover:** `npm run build` PASS and `npm test` with 0 failures, run from `plugin/`{server_gate}. All visible tests PASS.

---

## 7. Visible Test Cases / Producer Artifacts

*Filled by Worker 3's Unit Test Sub-Agent. Worker 2 leaves this section empty.*

---

## 7b. W4 Test Targets (filled by Worker 3's Unit Test Sub-Agent, if any)

*Empty at handover.*

---

## 8. Autonomous Execution Plan (filled by Coder Sub-Agent, attempt 1)

- **Observed current behavior:**
- **Approach:**
- **Fallback path if all attempts fail:**

---

## 9. Handover Summary (filled by Coder Sub-Agent on completion)

- **What is complete:**
- **What remains open:**
- **Final status:**

---

## 10. Risk Notes for Worker 4 (filled by Worker 3 Core)

- **Risk flag:** NONE
"""


def bullets(items: list[str], indent: str = "  - ") -> str:
    return "\n".join(f"{indent}{i}" for i in items)


written: list[str] = []
for n in range(1, 43):
    wp = f"WP{n}"
    t = table[wp]
    c = components[wp]
    d = D[wp]

    acs = "\n".join(f"{i}. {a}" for i, a in enumerate(c["acs"], start=1))
    schema_line = c["schema"] or PHASE_SCHEMA[t["phase"]]
    fuzzer_bullet = ""
    if c["fuzzer"]:
        fuzzer_bullet = (
            "  - **Convergence-fuzzer link (required by the BUILD_SPEC):** "
            + c["fuzzer"]
            + "\n"
        )

    in_scope_extra = f"  - Scope summary: {t['scope']}"
    server_gate = (
        " and, for the relay change, `npm run build` + `npm test` from `server/`"
        if wp == "WP41"
        else ""
    )

    body = TPL.format(
        wp=wp,
        title=t["title"],
        phase=t["phase"],
        deps=t["deps"] if t["deps"] != "—" else "`none`",
        spec=SPEC_REL,
        cid=c["cid"],
        cname=c["cname"],
        change_type=c["change_type"],
        responsibility=c["responsibility"],
        in_scope_extra=in_scope_extra,
        out_scope=bullets(d["out"]),
        input=c["input"],
        output=c["output"],
        fuzzer_bullet=fuzzer_bullet,
        hard=bullets(COMMON_HARD),
        schema_line="**Schema impact:** " + schema_line,
        entry=bullets(d["entry"]),
        acs=acs,
        dod=c["dod"],
        env=COMMON_ENV,
        flaky=bullets(COMMON_FLAKY),
        files=bullets(d["files"]),
        server_gate=server_gate,
    )

    name = f"TaskCharter_{wp}_{d['slug']}.md"
    (HERE / name).write_text(body, encoding="utf-8")
    written.append(f"{wp} [{t['phase']}] {name} :: {t['title']}")

print(f"BUILD_SPEC parsed: {len(components)} components, {len(table)} table rows")
print(f"charters written: {len(written)}")
for line in written:
    print("  " + line)
