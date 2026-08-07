#!/usr/bin/env python3
"""S65 — retrofit every offset-based debug-log reader in H:\\tmp.

Each of these scripts has exactly ONE helper that reads the debug log from a
remembered byte offset. Every call site of that helper was preceded, somewhere,
by a fixed `time.sleep(2.0)`-class margin. Rather than chase the call sites, the
guard goes INSIDE the helper: the reader itself now refuses to return until it
has positively established that the log is flushed past the moment of the call,
and raises `FlushNotProven` if it cannot.

That is strictly stronger than fixing the call sites, because a future call site
cannot forget it.

Idempotent: re-running detects the marker and skips.
"""

import re
import sys
from pathlib import Path

TMP = Path(r"H:\tmp")
MARK = "# --- S65 guard ---"

IMPORT_BLOCK = '''
# --- S65 guard ---
# The debug log's stamp-to-flush lag was measured at 0.50 s unthrottled and
# 60.0 s when the Obsidian renderer's timers are clamped (bimodal; 25% of
# samples exceeded 2.5 s). Every reader below used a fixed 2-2.5 s margin and
# would read ZERO LINES in the clamped regime - an empty read that has been
# reported as "the signature never fired". See workflowArtifacts/canvas-v2/
# S65_ABSENCE_AUDIT.md.
sys.path.insert(0, r"H:\\tmp")
from ls_logwait import wait_for_flush as _s65_wait_for_flush  # noqa: E402
'''

# file -> (helper name, the line after which the guard call is inserted,
#          expression giving {role: path})
TARGETS = {
    "liveshare_b41_ladder.py": ("log_since", "        return []", '{role: p}', "role"),
    "liveshare_b41_observe_then_write.py": ("log_since", "        return []", '{role: p}', "role"),
    "liveshare_b41_shapes.py": ("log_since", "        return []", '{role: p}', "role"),
    "liveshare_b41_schedule_dependence.py": ("log_since", "        return []", '{role: p}', "role"),
    "liveshare_b41_suite_with_receipts.py": ("since", "        return []", '{role: p}', "role"),
    "liveshare_b44_mute_burst.py": ("log_since", "        return []", '{role: p}', "role"),
    "liveshare_wp82.py": ("log_delta", "        return []", '{vault: p}', "vault"),
    "liveshare_wp83_e2e.py": ("log_since", '        return ""', '{role: p}', "role"),
    "liveshare_wp85_e2e.py": ("log_tail", '        return ""', '{role: p}', "role"),
    "liveshare_wp87_e2e.py": ("log_since", "        return []", '{role: p}', "role"),
}


def patch(path: Path, helper: str, anchor: str, pathexpr: str, var: str) -> str:
    src = path.read_text(encoding="utf-8")
    if MARK in src:
        return "SKIP (already patched)"

    # 1) import block, after the last top-level import
    lines = src.split("\n")
    last_import = 0
    for i, ln in enumerate(lines[:120]):
        if re.match(r"^(import |from )\S", ln):
            last_import = i
    if not any(re.match(r"^import sys\b", l) for l in lines[:120]):
        lines.insert(last_import + 1, "import sys")
        last_import += 1
    lines.insert(last_import + 1, IMPORT_BLOCK)
    src = "\n".join(lines)

    # 2) the guard inside the helper, right after its not-exists early return
    m = re.search(r"^def %s\(" % re.escape(helper), src, re.M)
    if not m:
        return "FAIL (helper %s not found)" % helper
    start = m.start()
    idx = src.find(anchor, start)
    if idx < 0 or idx - start > 400:
        return "FAIL (anchor not found in %s)" % helper
    end = idx + len(anchor)
    guard = (
        "\n    # S65: prove the sink flushed past THIS MOMENT before reading. An\n"
        "    # empty read must be indistinguishable from nothing, never reportable\n"
        "    # as an absence. Raises FlushNotProven rather than returning [].\n"
        "    _s65_wait_for_flush(%s, label=\"%s(%%s)\" %% %s)"
        % (pathexpr, helper, var)
    )
    src = src[:end] + guard + src[end:]
    path.write_text(src, encoding="utf-8")
    return "PATCHED"


def main():
    print("S65 reader retrofit")
    print("=" * 70)
    results = {}
    for name, (helper, anchor, pathexpr, var) in TARGETS.items():
        p = TMP / name
        if not p.exists():
            results[name] = "MISSING"
        else:
            results[name] = patch(p, helper, anchor, pathexpr, var)
        print("  %-42s %s" % (name, results[name]))

    print("\nVerification — every patched file must import the guard and call it:")
    bad = 0
    for name in TARGETS:
        p = TMP / name
        if not p.exists():
            continue
        src = p.read_text(encoding="utf-8")
        ok = ("_s65_wait_for_flush" in src) and (src.count("_s65_wait_for_flush") >= 2)
        compiles = True
        try:
            compile(src, str(p), "exec")
        except SyntaxError as exc:
            compiles = False
            print("     SYNTAX ERROR in %s: %s" % (name, exc))
        if not (ok and compiles):
            bad += 1
        print("  %-42s guard=%s compiles=%s" % (name, ok, compiles))
    print("\n%d file(s) failed verification" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
