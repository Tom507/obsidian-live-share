#!/usr/bin/env python3
"""S65 — measure the Live Share debug log's stamp-to-flush lag ON DISK.

Purely passive. Opens the two live vault debug logs read-only, polls their size,
and every time the file grows reads only the newly appended bytes. For each new
line it compares the line's OWN ISO stamp (written by DebugLogger.record() at the
moment the event happened) against two independent observation clocks:

  t_mtime    - the file's st_mtime at the moment growth was detected. Set by the
               OS when the append landed. Free of this script's polling error.
  t_poll     - wall clock at the moment this script noticed the growth. Carries
               up to one poll interval of error, and is only a sanity check.

lag_mtime = t_mtime - stamp  is the number that answers S65.

Writes JSONL to H:/tmp/s65_flush_samples.jsonl. Never writes to the vaults.
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

VAULTS = {
    "A": r"H:\Developement\_NeuralAngels\ObsidianOrga\.obsidian\live-share-debug.md",
    "B": r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie\.obsidian\live-share-debug.md",
}
OUT = r"H:\tmp\s65_flush_samples.jsonl"

STAMP_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s")


def parse_stamp(line):
    m = STAMP_RE.match(line)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S.%fZ").replace(
        tzinfo=timezone.utc
    ).timestamp()


def main():
    duration = float(sys.argv[1]) if len(sys.argv) > 1 else 900.0
    poll = float(sys.argv[2]) if len(sys.argv) > 2 else 0.2

    offsets = {}
    for key, path in VAULTS.items():
        try:
            offsets[key] = os.path.getsize(path)
        except OSError as exc:
            print("cannot stat %s: %s" % (path, exc))
            offsets[key] = None

    print("S65 flush probe: duration=%.0fs poll=%.2fs" % (duration, poll))
    print("start offsets: %s" % offsets)
    sys.stdout.flush()

    out = open(OUT, "a", encoding="utf-8")
    out.write(json.dumps({"_run_start": time.time(), "offsets": offsets}) + "\n")
    out.flush()

    deadline = time.time() + duration
    n = 0
    while time.time() < deadline:
        for key, path in VAULTS.items():
            if offsets[key] is None:
                continue
            try:
                st = os.stat(path)
            except OSError:
                continue
            t_poll = time.time()
            if st.st_size <= offsets[key]:
                continue
            t_mtime = st.st_mtime
            try:
                with open(path, "rb") as fh:
                    fh.seek(offsets[key])
                    chunk = fh.read(st.st_size - offsets[key])
            except OSError:
                continue
            # Only consume up to the last complete line.
            cut = chunk.rfind(b"\n")
            if cut < 0:
                continue
            offsets[key] += cut + 1
            text = chunk[: cut + 1].decode("utf-8", "replace")
            lines = [ln for ln in text.split("\n") if ln.strip()]
            stamps = [parse_stamp(ln) for ln in lines]
            stamps = [s for s in stamps if s is not None]
            if not stamps:
                continue
            rec = {
                "vault": key,
                "t_poll": t_poll,
                "t_mtime": t_mtime,
                "n_lines": len(lines),
                "n_stamped": len(stamps),
                "batch_bytes": cut + 1,
                "stamp_first": stamps[0],
                "stamp_last": stamps[-1],
                # the number that answers S65: newest line in the batch vs the
                # moment the OS recorded the append.
                "lag_mtime_last": t_mtime - stamps[-1],
                "lag_mtime_first": t_mtime - stamps[0],
                "lag_poll_last": t_poll - stamps[-1],
                "batch_span": stamps[-1] - stamps[0],
                # categories present, to tell heartbeat batches from real work
                "cats": sorted({(ln.split("] [", 1)[1].split("]", 1)[0]
                                 if "] [" in ln else "?") for ln in lines})[:6],
            }
            out.write(json.dumps(rec) + "\n")
            out.flush()
            n += 1
            print("[%s] batch n_lines=%d lag_mtime_last=%.3fs lag_poll_last=%.3fs cats=%s"
                  % (key, len(lines), rec["lag_mtime_last"], rec["lag_poll_last"],
                     ",".join(rec["cats"])))
            sys.stdout.flush()
        time.sleep(poll)

    out.write(json.dumps({"_run_end": time.time(), "batches": n}) + "\n")
    out.close()
    print("done: %d batches" % n)


if __name__ == "__main__":
    main()
