// WP63 / AC3 — blind counterpart 1. Same claim as the visible probe, derived
// independently and attacked from the other end:
//
//   ├── the repair arrives as a SIDE-LESS edge (`fromNode` + `toNode`, no
//   │   sides). That is a legal JSON Canvas edge under WP10 AC5, so the lift's
//   │   "is it valid NOW?" question has to ask the real gate rather than a
//   │   remembered shape — a lift keyed on "the record looks like the one in the
//   │   file again" would never fire here.
//   ├── the early-lift leg restates the record TWICE, still incomplete both
//   │   times (once byte-identical to the file's version, once with an extra
//   │   unrelated field), so a lift that fires on "the id came back" is caught,
//   │   and
//   └── the reset leg rebuilds the writer over a file the user repaired OFFLINE,
//       which is the case where the previous verdict describes a file that no
//       longer exists.
//
// AC3 is as load-bearing as AC1: a canvas stuck withheld stops persisting the
// user's real edits, which is the same data loss arriving from the other
// direction. FILE BYTES stay the oracle — the lift is proven by the record
// reaching disk through the ordinary canonical projection, never by a flag.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { serializeCanvas } from "../../../files/canvas-sync";

const DISK = "boards/wiring.canvas";

const NODE_A = { id: "n-alpha", type: "text", x: 0, y: 0, width: 200, height: 90, text: "alpha" };
const NODE_B = { id: "n-beta", type: "text", x: 400, y: 0, width: 200, height: 90, text: "beta" };
const HALF_EDGE = { id: "e-half", fromNode: "n-alpha", fromSide: "right", color: "4" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges });
}

interface FakeIO extends PersistenceIO {
  files: Map<string, string>;
}

function createIO(initial: Record<string, string>): FakeIO {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
}

function recordingLogger(): {
  lines: string[];
  debug(c: string, m: string): void;
  warn(c: string, m: string): void;
} {
  const lines: string[] = [];
  return {
    lines,
    debug: (_c: string, m: string) => void lines.push(m),
    warn: (_c: string, m: string) => void lines.push(m),
  };
}

function edgeIdsIn(content: string): string[] {
  const parsed = JSON.parse(content) as { edges?: { id?: string }[] };
  return (parsed.edges ?? []).map((e) => String(e.id));
}

/** A peer states the edge — the remote half of "a later delta made it valid". */
function peerStatesEdge(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  const edges = remote.getMap<Y.Map<unknown>>("edges");
  const existing = edges.get(id);
  const record = existing ?? new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) record.set(k, v);
  if (!existing) edges.set(id, record);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

describe("WP63 AC3 blind1 — the withhold is temporary and lifts on the write trigger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a SIDE-LESS repair lifts the withhold, and the first write is the ordinary projection", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([NODE_A, NODE_B], [HALF_EDGE]);
    const io = createIO({ [DISK]: before });
    const logger = recordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, { logger });

    expect(await p.coldOpen()).toBe("seeded-from-file");

    // Still broken → still withheld. Without this leg the lift below could be
    // "it never armed in the first place".
    await p.flush();
    expect(io.files.get(DISK), "the file was written while the refusal stood").toBe(before);
    expect(p.isWriteWithheld()).toBe(true);

    // The repair: the arrow is completed, and it names NO side — legal JSON
    // Canvas (WP10 AC5), so the gate must admit it.
    peerStatesEdge(doc, "e-half", { id: "e-half", fromNode: "n-alpha", toNode: "n-beta" });

    // Same trigger as the write; nothing else happened in between.
    await p.flush();

    const after = io.files.get(DISK) as string;
    expect(after, "the withhold never lifted: the canvas stopped persisting for good").not.toBe(
      before,
    );
    expect(after, "the first write after the lift is not the ordinary canonical projection").toBe(
      serializeCanvas(doc.getMap<Y.Map<unknown>>("nodes"), doc.getMap<Y.Map<unknown>>("edges")),
    );
    expect(edgeIdsIn(after), "the repaired edge is not in the file").toEqual(["e-half"]);
    expect(p.isWriteWithheld(), "the withhold is still armed after the refused set emptied").toBe(
      false,
    );
    expect(p.seedRefusals()).toEqual([]);

    const restored = logger.lines.find((line) => line.startsWith("SEED RESTORED:"));
    expect(restored, "no distinct lift signature was emitted").toBeDefined();
    expect(restored ?? "", "the lift signature does not name the path").toContain(DISK);

    p.destroy();
    doc.destroy();
  });

  it("a record restated while STILL incomplete does not lift the withhold", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([NODE_A, NODE_B], [HALF_EDGE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");

    // 1) The id comes back, exactly as broken as it was.
    peerStatesEdge(doc, "e-half", { id: "e-half", fromNode: "n-alpha", fromSide: "right" });
    await p.flush();
    expect(p.isWriteWithheld(), "the withhold lifted because the id merely reappeared").toBe(true);

    // 2) It is touched again, with an unrelated field — still no `toNode`.
    peerStatesEdge(doc, "e-half", { color: "6", label: "still half" });
    await p.flush();
    await p.flush();

    expect(io.files.get(DISK), "the withhold lifted on a record that is still invalid").toBe(before);
    expect(p.isWriteWithheld()).toBe(true);
    expect(io.write).not.toHaveBeenCalled();

    p.destroy();
    doc.destroy();
  });

  it("a re-seed of the path resets the refused set — a stale verdict never outlives its file", async () => {
    const doc = new Y.Doc();
    const io = createIO({ [DISK]: canvasJson([NODE_A, NODE_B], [HALF_EDGE]) });
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    expect(p.isWriteWithheld()).toBe(true);
    expect(p.seedRefusals().map((r) => r.id)).toEqual(["e-half"]);

    // The user repairs the file offline and the path is seeded again into a
    // fresh doc — the earlier verdict is about a file that no longer exists.
    const reseeded = new Y.Doc();
    io.files.set(
      DISK,
      canvasJson([NODE_A, NODE_B], [{ ...HALF_EDGE, toNode: "n-beta", toSide: "left" }]),
    );
    const rebuilt = new CanvasPersistence(reseeded, io, DISK);
    expect(await rebuilt.coldOpen()).toBe("seeded-from-file");

    expect(rebuilt.seedRefusals(), "a rebuilt writer inherited a stale refusal").toEqual([]);
    expect(rebuilt.isWriteWithheld()).toBe(false);
    await rebuilt.flush();
    expect(edgeIdsIn(io.files.get(DISK) as string)).toEqual(["e-half"]);

    p.destroy();
    rebuilt.destroy();
    doc.destroy();
    reseeded.destroy();
  });
});
