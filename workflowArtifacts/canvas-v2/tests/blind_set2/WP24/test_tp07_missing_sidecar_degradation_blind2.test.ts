// WP24 / AC3 (missing) blind2 — the degradation REPORT itself is the subject,
// not the doc.
//
// Different angle: AC3 says "reports the degradation". WP25 and WP29 will
// branch on that report — WP29's seed decision in particular has to distinguish
// "this doc has no history because it is new" from "this doc has no history
// because we lost it". So the report has to be a discriminating value, and the
// four cases must be pairwise distinguishable. This test asserts exactly that:
// the four degradation constants are distinct, `isSidecarDegraded` agrees with
// them, and the same store returns a different verdict for missing, torn,
// garbage and healthy inputs — driven through one table so no case can quietly
// collapse into another.
//
// A store that returns a single boolean, or that reports CORRUPT for
// everything, passes every "did it throw?" test and fails here.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DEGRADATION,
  createSidecarStore,
  isSidecarDegraded,
  sidecarCheckpointPath,
  sidecarHistoryPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUID = "blind2-missing";

function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

function healthyHistory(): Uint8Array {
  const doc = new Y.Doc();
  const captured: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => captured.push(Uint8Array.from(u)));
  doc.getMap("nodes").set("ok", { v: 1 });
  return frame(captured[0]);
}

function makeStore(files: Record<string, Uint8Array>) {
  const disk = new Map(Object.entries(files).map(([p, b]) => [p, Uint8Array.from(b)]));
  return createSidecarStore({
    ensureDir: async (): Promise<void> => undefined,
    exists: async (p: string): Promise<boolean> => disk.has(p),
    read: async (p: string): Promise<Uint8Array> => {
      const found = disk.get(p);
      if (found === undefined) throw new Error(`ENOENT ${p}`);
      return Uint8Array.from(found);
    },
    write: async (): Promise<void> => undefined,
    append: async (): Promise<void> => undefined,
    truncate: async (): Promise<void> => undefined,
    remove: async (): Promise<void> => undefined,
  });
}

describe("WP24 AC3 blind2 — the four verdicts are distinguishable", () => {
  it("the constants are four distinct values", () => {
    const values = Object.values(SIDECAR_DEGRADATION);
    expect(values).toHaveLength(4);
    expect(new Set(values).size).toBe(4);
  });

  it("isSidecarDegraded is false for NONE and true for the other three", async () => {
    const cases: Array<[string, Record<string, Uint8Array>, string, boolean]> = [
      ["healthy", { [sidecarHistoryPath(GUID)]: healthyHistory() }, SIDECAR_DEGRADATION.NONE, false],
      ["absent", {}, SIDECAR_DEGRADATION.MISSING, true],
      [
        "torn",
        { [sidecarHistoryPath(GUID)]: healthyHistory().slice(0, 6) },
        SIDECAR_DEGRADATION.TRUNCATED,
        true,
      ],
      [
        "garbage",
        { [sidecarHistoryPath(GUID)]: frame(new TextEncoder().encode("plain text, not CRDT")) },
        SIDECAR_DEGRADATION.CORRUPT,
        true,
      ],
    ];

    const verdicts: string[] = [];
    for (const [label, files, expected, degraded] of cases) {
      const result = await makeStore(files).load(GUID, new Y.Doc());
      expect(result.degradation, label).toBe(expected);
      expect(isSidecarDegraded(result), label).toBe(degraded);
      verdicts.push(result.degradation);
    }

    // The four inputs must not collapse onto fewer than four verdicts.
    expect(new Set(verdicts).size).toBe(4);
  });

  it("an absent sidecar and a healthy empty one are reported differently", async () => {
    // The distinction WP29's seed decision depends on.
    const absent = await makeStore({}).load(GUID, new Y.Doc());
    const compacted = await makeStore({
      [sidecarHistoryPath(GUID)]: new Uint8Array(0),
      [sidecarCheckpointPath(GUID)]: Y.encodeStateAsUpdate(new Y.Doc()),
    }).load(GUID, new Y.Doc());

    expect(absent.degradation).toBe(SIDECAR_DEGRADATION.MISSING);
    expect(compacted.degradation).toBe(SIDECAR_DEGRADATION.NONE);
    expect(compacted.checkpointApplied).toBe(true);
  });

  it("the result carries only the pinned fields, all of the pinned types", async () => {
    const result = await makeStore({}).load(GUID, new Y.Doc());

    expect(typeof result.degradation).toBe("string");
    expect(typeof result.checkpointApplied).toBe("boolean");
    expect(typeof result.historyEntriesApplied).toBe("number");
    expect(Number.isInteger(result.historyEntriesApplied)).toBe(true);
    const extras = Object.keys(result).filter(
      (key) =>
        !["degradation", "checkpointApplied", "historyEntriesApplied", "detail"].includes(key),
    );
    expect(extras).toEqual([]);
  });
});
