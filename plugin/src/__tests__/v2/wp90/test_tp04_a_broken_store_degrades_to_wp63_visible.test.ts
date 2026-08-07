// WP90 — A CORRUPT, ABSENT OR PARTIAL STORE MUST NOT BECOME A NEW FAILURE MODE.
//
// The second-largest risk in this work package (charter §5) is that a "durable"
// store is one more thing that can be wrong. The rule it has to obey has two
// halves and both are easy to get half-right:
//
//   ├── a store that cannot be read degrades to EXACTLY WP63's in-memory
//   │   behaviour — never a throw, never a failed cold open, and
//   └── never a SILENT full-trust "no refusals". Silence is what turns an
//       unreadable file into permission to overwrite the user's `.canvas`, and
//       "absence of information translated into a destructive action" is the
//       composition rule this whole run has been chasing.
//
// And one more, which is why an unreadable store is QUARANTINED rather than
// simply ignored: a read that failed must not be able to launder itself into
// the file. If the store rewrote itself from a set derived from a failed read,
// the corruption would become the new truth on the first write, and whatever
// was in those bytes — possibly a standing refusal protecting a record — would
// be gone for good.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ────────────────────────────────────────────
// BREAK A. Make `SeedRefusalStore.loadFile`'s `catch` rethrow instead of calling
//   `quarantine()`. Cases 2 and 4 go RED (`describeHealth()` reads `absent`, and
//   nothing is narrated). VERIFIED RED.
// BREAK A2, on top of A. Also remove the defence-in-depth `try`/`catch` around
//   `store.load` in `CanvasPersistence.hydrateDurableRefusals`. Cases 2, 3 AND 4
//   go RED — `coldOpen()` now REJECTS instead of returning a `ColdOpenResult`,
//   which is the "never a crash" half of the rule failing outright. VERIFIED
//   RED, then both restored. The two together are why the catch exists in both
//   places: removing either one alone is survivable, removing both is not.
// BREAK B (case 3). Neutralise the `if (this.quarantined) { … return; }` guard
//   in `SeedRefusalStore.persist`. The unreadable bytes are overwritten by a set
//   derived from the failed read — the laundering. VERIFIED RED, then restored.
// BREAK C (case 4). Drop the `logger?.warn?.(…)` from `quarantine()`. The store
//   degrades silently, which is the half of the rule that has no visible
//   symptom until a user's file is gone. VERIFIED RED, then restored.
// BREAK D (case 6). Make `writeFile`'s `catch` rethrow. The failed write is no
//   longer narrated and the promise chain carries the rejection. VERIFIED RED,
//   then restored.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence } from "../../../files/canvas-persistence";
import { seedRefusalStorePath } from "../../../files/canvas-sidecar";
import { SeedRefusalStore } from "../../../files/seed-refusal-store";
import {
  TYPELESS_NODE,
  VALID_NODE,
  canvasJson,
  createIO,
  createRecordingLogger,
  createStoreIO,
  nodeIdsIn,
} from "./harness";

const DISK = "board.canvas";
const STORE = seedRefusalStorePath();

const GOOD_ENTRY = {
  boundary: "cold-open-seed",
  kind: "node",
  id: "n-bad",
  reason: "MISSING_TYPE",
};

describe("WP90 — a store that cannot answer degrades to WP63, loudly, and never launders", () => {
  it("ABSENT — no store file at all behaves exactly as WP63, and creates one only on a refusal", async () => {
    const storeIO = createStoreIO();
    const store = new SeedRefusalStore(storeIO, {});
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK, { durableRefusals: store });

    expect(await p.coldOpen()).toBe("seeded-from-file");
    expect(store.describeHealth()).toBe("absent");
    expect(store.isQuarantined()).toBe(false);

    // WP63's behaviour, unchanged: the refusal withholds in-session.
    await p.flush();
    expect(io.files.get(DISK)).toBe(before);
    expect(p.isWriteWithheld()).toBe(true);

    await store.idle();
    expect(storeIO.written, "the store wrote somewhere other than its one path").toEqual(
      Array(storeIO.written.length).fill(STORE),
    );
    expect(storeIO.text() ?? "", "the refusal never became durable").toContain("n-bad");

    p.destroy();
    doc.destroy();
  });

  it("UNREADABLE — cold open still returns a result, and the in-memory withhold still works", async () => {
    const corrupt = '{"version": 1, "paths": {"board.canvas": [ <<< truncated';
    const storeIO = createStoreIO({ [STORE]: corrupt });
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK, { logger: log, durableRefusals: store });

    // NOT a rejected promise, and not a fourth outcome.
    const result = await p.coldOpen();
    expect(result).toBe("seeded-from-file");
    expect(store.describeHealth()).toBe("unreadable");
    expect(store.isQuarantined()).toBe(true);

    // Exactly WP63: this session's own seed refused, so this session withholds.
    await p.flush();
    expect(io.files.get(DISK), "a broken store cost the user their record").toBe(before);
    expect(nodeIdsIn(io.files.get(DISK) as string)).toContain("n-bad");
    expect(p.isWriteWithheld()).toBe(true);

    p.destroy();
    doc.destroy();
  });

  it("UNREADABLE — the bytes are LEFT ALONE, so a failed read cannot launder itself", async () => {
    const corrupt = '{"version": 1, "paths": {"board.canvas": [ <<< truncated';
    const storeIO = createStoreIO({ [STORE]: corrupt });
    const store = new SeedRefusalStore(storeIO, {});
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: canvasJson([VALID_NODE, TYPELESS_NODE]) });
    const p = new CanvasPersistence(doc, io, DISK, { durableRefusals: store });

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await p.flush();
    await store.idle();

    expect(storeIO.text(), "the unreadable store was overwritten from a failed read").toBe(corrupt);
    expect(storeIO.write, "a quarantined store wrote anyway").not.toHaveBeenCalled();

    p.destroy();
    doc.destroy();
  });

  it("UNREADABLE — and it says so. A silent degrade is the failure this rule exists to stop", async () => {
    const storeIO = createStoreIO({ [STORE]: "not json at all" });
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });

    expect(await store.load(DISK)).toEqual([]);

    const line = log.lines.find((l) => l.startsWith("SEED REFUSAL STORE:"));
    expect(line, "the store degraded in silence").toBeDefined();
    expect(line ?? "", "the narration does not name the file").toContain(STORE);
    expect(line ?? "", "the narration does not say it is unreadable").toContain("UNREADABLE");
  });

  it("PARTIAL — good entries are kept, bad ones are dropped and named, other paths survive a rewrite", async () => {
    const initial = JSON.stringify({
      version: 1,
      paths: {
        [DISK]: [GOOD_ENTRY, { garbage: true }, "n-bad"],
        // Another canvas's entry, and it is unreadable. Rewriting OUR path must
        // not take it with us: we cannot interpret it, so we cannot decide it is
        // gone either.
        "other.canvas": "this is not a list",
      },
    });
    const storeIO = createStoreIO({ [STORE]: initial });
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });

    const restored = await store.load(DISK);
    expect(restored, "the readable entry was thrown away with the unreadable ones").toEqual([
      GOOD_ENTRY,
    ]);
    expect(store.describeHealth()).toBe("partial");
    expect(store.isQuarantined(), "a partial read must not stop the store working").toBe(false);
    expect(
      log.lines.some((l) => l.startsWith("SEED REFUSAL STORE:") && l.includes("dropped 2")),
      "the dropped entries were not named",
    ).toBe(true);

    // A rewrite of OUR path only.
    await store.saveNow(DISK, []);
    const after = JSON.parse(storeIO.text() as string) as { paths: Record<string, unknown> };
    expect(after.paths[DISK], "the emptied path should have no entry at all").toBeUndefined();
    expect(after.paths["other.canvas"], "another path's entry was collateral damage").toBe(
      "this is not a list",
    );
  });

  it("A STORE THAT CANNOT BE WRITTEN degrades too — the session stays on WP63's behaviour", async () => {
    const storeIO = createStoreIO();
    storeIO.write = async () => {
      throw new Error("EROFS: read-only file system");
    };
    const log = createRecordingLogger();
    const store = new SeedRefusalStore(storeIO, { logger: log });
    const doc = new Y.Doc();
    const before = canvasJson([VALID_NODE, TYPELESS_NODE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK, { logger: log, durableRefusals: store });

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await p.flush();
    await store.idle();

    expect(io.files.get(DISK), "a failing store cost the user their record").toBe(before);
    expect(p.isWriteWithheld()).toBe(true);
    expect(
      log.lines.some((l) => l.startsWith("SEED REFUSAL STORE:") && l.includes("FAILED")),
      "the failed write was not narrated",
    ).toBe(true);

    p.destroy();
    doc.destroy();
  });
});
