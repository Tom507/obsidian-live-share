#!/usr/bin/env python3
"""WP117 falsifiability harness (Dispatcher Rule 11).

For each row: copy the file aside, plant ONE defect, run the named tests, record
whether they went RED and on which assertion, restore the file BYTE-IDENTICALLY
from the copy, and verify the restore with a sha256 comparison. A row whose
restore does not compare equal aborts the whole run.

Run from the repo root:  python workflowArtifacts/canvas-v2/wp117_break_table.py
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugin"
SRC = PLUGIN / "src"
WP117 = "src/__tests__/v2/wp117"

# (id, file, old, new, tests, what it should prove)
ROWS = [
    (
        "B1",
        "files/canvas-create-decision.ts",
        '  if (probe.role !== "host") {\n    return refuse(\n      CANVAS_CREATE_VERDICT.NOT_HOST,\n      "only the host materialises a canvas creation request",\n    );\n  }',
        '  if (false) {\n    return refuse(\n      CANVAS_CREATE_VERDICT.NOT_HOST,\n      "only the host materialises a canvas creation request",\n    );\n  }',
        [f"{WP117}/test_tp01_the_host_validates_before_it_acts.test.ts",
         f"{WP117}/test_tp02_a_guest_canvas_becomes_real_for_every_peer.test.ts"],
        "the AUTHORITY clause: without it every guest answers every request",
    ),
    (
        "B2",
        "files/canvas-create-decision.ts",
        "  if (probe.protectedPath !== false) {",
        "  if (false) {",
        [f"{WP117}/test_tp01_the_host_validates_before_it_acts.test.ts"],
        "the PROTECTED clause: a peer could name a path inside .obsidian or .git",
    ),
    (
        "B3",
        "files/canvas-create-decision.ts",
        "  if (!Number.isFinite(bytes) || !Number.isFinite(max) || max <= 0 || bytes > max) {",
        "  if (false) {",
        [f"{WP117}/test_tp01_the_host_validates_before_it_acts.test.ts",
         f"{WP117}/test_tp03_a_refusal_reaches_the_user.test.ts"],
        "the SIZE clause on the host: a peer's word on size would be taken as evidence",
    ),
    (
        "B4",
        "files/canvas-create-decision.ts",
        "  if (probe.localFileExists !== false) {",
        "  if (false) {",
        [f"{WP117}/test_tp01_the_host_validates_before_it_acts.test.ts",
         f"{WP117}/test_tp03_a_refusal_reaches_the_user.test.ts"],
        "the COLLISION clause: a request would overwrite a file the host already holds",
    ),
    (
        "B5",
        "files/canvas-seed-decision.ts",
        '  if (probe.role !== undefined && probe.role !== "host") {\n    return load(SEED_RULE.LOAD_NOT_THE_SEEDER);\n  }',
        '  if (false) {\n    return load(SEED_RULE.LOAD_NOT_THE_SEEDER);\n  }',
        [f"{WP117}/test_tp04_no_peers_a_guest_never_seeds.test.ts"],
        "the residual's repair: a stale guest seeds again under NO_PEERS",
    ),
    (
        "B6",
        "files/canvas-mirror-decision.ts",
        "    if (probe.originatedHere === true && probe.identityResolves === true) {\n      return MIRROR_VERDICT.ADOPT_LOCAL_FILE;\n    }",
        "    if (false) {\n      return MIRROR_VERDICT.ADOPT_LOCAL_FILE;\n    }",
        [f"{WP117}/test_tp05_the_mirror_adopts_exactly_one_case.test.ts",
         f"{WP117}/test_tp02_a_guest_canvas_becomes_real_for_every_peer.test.ts"],
        "the ADOPT verdict: the originating guest keeps a private copy again",
    ),
    (
        "B7",
        "files/canvas-mirror-decision.ts",
        "    verdict === MIRROR_VERDICT.ADOPT_LOCAL_FILE\n  );",
        "    false\n  );",
        [f"{WP117}/test_tp05_the_mirror_adopts_exactly_one_case.test.ts",
         f"{WP117}/test_tp02_a_guest_canvas_becomes_real_for_every_peer.test.ts"],
        "the ADMISSION gate: an armed adoption is skipped before the verdict is asked",
    ),
    (
        "B8",
        "files/canvas-create.ts",
        "    if (content.length > this.maxBytes) {",
        "    if (false) {",
        [f"{WP117}/test_tp03_a_refusal_reaches_the_user.test.ts"],
        "the guest-side bound: an oversized frame reaches the relay's 2 MB ceiling",
    ),
    (
        "B9",
        "files/canvas-create.ts",
        "    this.env.notify(\n      `Live Share: the host did not add ${entry.path} to the session",
        "    void 0 && this.env.notify(\n      `Live Share: the host did not add ${entry.path} to the session",
        [f"{WP117}/test_tp03_a_refusal_reaches_the_user.test.ts"],
        "A4: the refusal stops reaching the user and the creation vanishes silently",
    ),
    (
        "B10",
        "files/canvas-create.ts",
        "      await this.env.attachWriter(path);",
        "      await Promise.resolve();",
        [f"{WP117}/test_tp02_a_guest_canvas_becomes_real_for_every_peer.test.ts"],
        "the host's own projection: the host keeps the guest's spelling and bytes diverge",
    ),
    (
        "B11",
        "files/vault-events.ts",
        "        void plugin.requestCanvasCreate?.(originalPath);",
        "        void 0;",
        [f"{WP117}/test_tp06_the_door_is_wired_into_the_product.test.ts"],
        "the vault-event door: the feature exists and nothing ever calls it",
    ),
    (
        "B12",
        "sync/control-ws.ts",
        '      msg.type === "canvas-create-request";',
        "      false;",
        [f"{WP117}/test_tp06_the_door_is_wired_into_the_product.test.ts"],
        "I8: a whole user file would cross the relay in plaintext",
    ),
    (
        "B13",
        "files/canvas-create.ts",
        "    if (this.env.manifestKnows(path)) return decline(CANVAS_CREATE_LOCAL_REFUSAL.ALREADY_SHARED);",
        "    if (false) return decline(CANVAS_CREATE_LOCAL_REFUSAL.ALREADY_SHARED);",
        [f"{WP117}/test_tp03_a_refusal_reaches_the_user.test.ts"],
        "the echo guard: every mirrored canvas would ask the host to create it again",
    ),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_tests(tests: list[str]) -> tuple[bool, str]:
    proc = subprocess.run(
        ["npx", "vitest", "run", *tests],
        cwd=PLUGIN,
        capture_output=True,
        text=True,
        shell=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    failed = proc.returncode != 0
    lines = [ln.strip() for ln in out.splitlines() if " FAIL " in ln or "Tests " in ln]
    return failed, " | ".join(lines[:6])


def main() -> int:
    results = []
    tmp = Path(tempfile.mkdtemp(prefix="wp117-break-"))
    for row_id, rel, old, new, tests, claim in ROWS:
        target = SRC / rel
        original = target.read_text(encoding="utf-8")
        before = sha256(target)
        aside = tmp / f"{row_id}-{target.name}"
        shutil.copy2(target, aside)

        if old not in original:
            results.append(
                {"row": row_id, "file": rel, "status": "ANCHOR-MISSING", "claim": claim}
            )
            print(f"{row_id}: ANCHOR MISSING in {rel}", flush=True)
            continue

        target.write_text(original.replace(old, new, 1), encoding="utf-8", newline="")
        red, detail = run_tests(tests)

        shutil.copy2(aside, target)
        after = sha256(target)
        if after != before:
            print(f"{row_id}: RESTORE FAILED for {rel} — aborting", flush=True)
            return 2

        results.append(
            {
                "row": row_id,
                "file": rel,
                "claim": claim,
                "red": red,
                "detail": detail,
                "restored": after == before,
            }
        )
        print(f"{row_id}: {'RED' if red else 'STILL GREEN'} — {claim}", flush=True)

    print(json.dumps(results, indent=2))
    shutil.rmtree(tmp, ignore_errors=True)
    return 0 if all(r.get("red") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
