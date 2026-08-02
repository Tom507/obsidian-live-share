// WP63 / AC3 — blind counterpart 2. Same claim, attacked through PARTIAL
// repair and through the repair ARRIVING AS A REMOTE DELTA:
//
//   ├── TWO records are refused, then ONE is repaired. AC3 lifts when the
//   │   refused set becomes EMPTY — a lift keyed on "a repair happened", or on
//   │   the most recent refusal, fires here and loses the second record. Every
//   │   single-refusal probe is blind to this.
//   ├── the repair arrives as a REMOTE delta rather than a local re-seed, so
//   │   the lift has to re-ask the real gate about the record as the DOC now
//   │   holds it, not compare against a remembered file shape, and
//   └── the lift is checked ON THE WRITE TRIGGER: after the second repair the
//       withhold is only expected to clear once a write is actually attempted,
//       which is what "checked on the same trigger as the write, not on a
//       timer" means operationally.
//
// AC3 is as load-bearing as AC1: a canvas stuck withheld stops persisting the
// user's real edits — the same data loss arriving from the other direction.
// FILE BYTES stay the oracle: the lift is proven by the repaired content
// reaching disk as the ordinary canonical projection, never by a flag alone.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";

const DISK = "vault/lifting.canvas";

/** Both invalid at the seed: no `text` key at all, and a non-numeric `y`. */
const NO_TEXT = { id: "n-notext", type: "text", x: 0, y: 0, width: 200, height: 100 };
const BAD_Y = { id: "n-bady", type: "text", x: 300, y: "0", width: 200, height: 100, text: "x" };
const GOOD = { id: "n-good", type: "text", x: 600, y: 0, width: 200, height: 100, text: "fine" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
  return JSON.stringify({ nodes, edges });
}

interface FakeIO extends PersistenceIO {
  files: Map<string, string>;
}

function ioOver(files: Map<string, string>): FakeIO {
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

/** Land a record in the doc the way a remote peer would — a whole detached map. */
function landRemote(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) m.set(k, v);
    nodes.set(id, m);
  });
}

function nodeIdsIn(content: string): string[] {
  const parsed = JSON.parse(content) as { nodes?: { id?: string }[] };
  return (parsed.nodes ?? []).map((n) => String(n.id));
}

const START = canvasJson([NO_TEXT, BAD_Y, GOOD]);

describe("WP63 AC3 blind2 — the set must EMPTY, and the repair may come from a peer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("repairing ONE of two refused records does NOT lift the withhold", async () => {
    const doc = new Y.Doc();
    const io = ioOver(new Map([[DISK, START]]));
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    expect(p.seedRefusals().map((r) => r.id).sort()).toEqual(["n-bady", "n-notext"]);
    expect(p.isWriteWithheld()).toBe(true);

    // A peer supplies the missing text — one of the two is now legal.
    landRemote(doc, "n-notext", {
      id: "n-notext",
      type: "text",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      text: "",
    });

    await p.flush();

    // One down, one to go: the set is NOT empty, so the withhold STANDS and the
    // user's file is still byte-identical. A lift on "a repair happened" would
    // have written here and dropped `n-bady`.
    expect(p.isWriteWithheld(), "the withhold lifted while a record was still refused").toBe(true);
    expect(io.files.get(DISK), "the file was rewritten while a record was still refused").toBe(
      START,
    );
    expect(p.seedRefusals().map((r) => r.id)).toEqual(["n-bady"]);

    p.destroy();
    doc.destroy();
  });

  it("repairing BOTH lifts the withhold, and the first write is the ordinary projection", async () => {
    const doc = new Y.Doc();
    const io = ioOver(new Map([[DISK, START]]));
    const logger = recordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, { logger });

    await p.coldOpen();
    expect(p.isWriteWithheld()).toBe(true);

    landRemote(doc, "n-notext", {
      id: "n-notext",
      type: "text",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      text: "",
    });
    landRemote(doc, "n-bady", {
      id: "n-bady",
      type: "text",
      x: 300,
      y: 0,
      width: 200,
      height: 100,
      text: "x",
    });

    await p.flush();

    // The set is empty → the write proceeds as the ORDINARY canonical
    // projection: every record present, including the two repaired ones.
    expect(p.isWriteWithheld(), "the withhold never lifted after every record was repaired").toBe(
      false,
    );
    expect(p.seedRefusals()).toEqual([]);
    expect(io.write, "no write followed the lift — the canvas is stuck").toHaveBeenCalled();

    const written = io.files.get(DISK) as string;
    expect(written, "the file was never updated after the lift").not.toBe(START);
    expect(nodeIdsIn(written).sort()).toEqual(["n-bady", "n-good", "n-notext"]);

    // AC3: lifting emits a DISTINCT signature — not the refusal one again.
    const lift = logger.lines.find((l) => l.startsWith("SEED RESTORED:")) ?? "";
    expect(lift, "no distinct lift signature was emitted").not.toBe("");
    expect(lift).toContain(DISK);
    expect(lift.startsWith("SEED REFUSED:")).toBe(false);

    p.destroy();
    doc.destroy();
  });

  it("a rebuilt writer over a repaired file starts clean — a stale verdict never outlives its file", async () => {
    const files = new Map<string, string>([[DISK, START]]);

    const doc1 = new Y.Doc();
    const io1 = ioOver(files);
    const p1 = new CanvasPersistence(doc1, io1, DISK);
    await p1.coldOpen();
    expect(p1.isWriteWithheld()).toBe(true);
    await p1.flush();
    expect(files.get(DISK)).toBe(START);
    p1.destroy();
    doc1.destroy();

    // The user repairs the file outside the session, then it is reopened.
    const REPAIRED = canvasJson([
      { ...NO_TEXT, text: "" },
      { ...BAD_Y, y: 0 },
      GOOD,
    ]);
    files.set(DISK, REPAIRED);

    const doc2 = new Y.Doc();
    const io2 = ioOver(files);
    const p2 = new CanvasPersistence(doc2, io2, DISK);
    expect(await p2.coldOpen()).toBe("seeded-from-file");

    expect(p2.seedRefusals(), "a rebuilt writer inherited a verdict about an old file").toEqual([]);
    expect(p2.isWriteWithheld()).toBe(false);

    await p2.flush();
    expect(io2.write, "the rebuilt writer never wrote").toHaveBeenCalled();
    expect(nodeIdsIn(files.get(DISK) as string).sort()).toEqual(["n-bady", "n-good", "n-notext"]);

    p2.destroy();
    doc2.destroy();
  });
});
