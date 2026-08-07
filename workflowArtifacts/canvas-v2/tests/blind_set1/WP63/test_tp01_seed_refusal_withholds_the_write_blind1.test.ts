// WP63 / AC1 — blind counterpart 1. Same claim as the visible probe, derived
// independently from the AC and attacked with different data:
//
//   ├── the refused record is an EDGE, not a node. AC1 says "any record read
//   │   from a `.canvas` file", and the edge space is a separate container, a
//   │   separate id space and a separate validator branch — a withhold wired
//   │   only for nodes would satisfy every node-shaped probe and still delete
//   │   the user's arrows.
//   ├── the refusal reason is MISSING_TO (a half-written edge, `toNode` never
//   │   present) rather than a missing node `type`, and
//   └── the canvas also carries a SIDE-LESS but fully connected edge, which is
//       legal JSON Canvas and must be admitted — so the probe cannot pass by an
//       implementation that simply refuses everything and withholds forever.
//
// FILE BYTES ARE THE ORACLE (charter §7). The `SEED REFUSED:` signature is the
// secondary check AC1 names by hand.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import { TFile } from "obsidian";

const DISK = "boards/wiring.canvas";

const NODE_A = { id: "n-alpha", type: "text", x: 0, y: 0, width: 200, height: 90, text: "alpha" };
const NODE_B = { id: "n-beta", type: "text", x: 400, y: 0, width: 200, height: 90, text: "beta" };

/**
 * A fully connected edge that names NO side. Legal JSON Canvas (WP10 AC5), so
 * it must be ADMITTED — the control that keeps this probe honest.
 */
const SIDELESS_EDGE = { id: "e-sideless", fromNode: "n-alpha", toNode: "n-beta" };

/**
 * The user's half-written arrow: `toNode` was never written, so WP10 builds no
 * `to` register and WP14 diagnoses MISSING_TO. WP18 AC1 refuses it locally —
 * correctly — and the composition used to DELETE it from the user's own file.
 */
const HALF_EDGE = { id: "e-half", fromNode: "n-alpha", fromSide: "right", color: "4" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[]): string {
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

function createIO(initial: Record<string, string>): FakeIO {
  return ioOver(new Map(Object.entries(initial)));
}

function recordingLogger(): { lines: string[]; debug(c: string, m: string): void; warn(c: string, m: string): void } {
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

function nodeIdsIn(content: string): string[] {
  const parsed = JSON.parse(content) as { nodes?: { id?: string }[] };
  return (parsed.nodes ?? []).map((n) => String(n.id));
}

function createVault(files: Map<string, string>) {
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

describe("WP63 AC1 blind1 — a refused EDGE withholds the write instead of vanishing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cold-open seed: a real flush leaves the user's file byte-identical", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE, HALF_EDGE]);
    const io = createIO({ [DISK]: before });
    const logger = recordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, { logger });

    expect(await p.coldOpen(), "the seed branch was not taken — the probe would be vacuous").toBe(
      "seeded-from-file",
    );

    // WP18 AC1 is untouched: the half-written edge is still kept OUT of the doc.
    expect(doc.getMap<Y.Map<unknown>>("edges").has("e-half")).toBe(false);
    // ...and the side-less one is admitted, so the withhold is not "refuse all".
    expect(
      doc.getMap<Y.Map<unknown>>("edges").has("e-sideless"),
      "a legal side-less edge was refused at the seed",
    ).toBe(true);

    await p.flush();

    expect(io.files.get(DISK), "the user's file was rewritten after a seed refusal").toBe(before);
    expect(
      edgeIdsIn(io.files.get(DISK) as string),
      "the refused edge was deleted from the user's own file",
    ).toContain("e-half");
    expect(io.write, "a write reached the disk while a refusal stood").not.toHaveBeenCalled();
    expect(p.isWriteWithheld()).toBe(true);
    expect(p.seedRefusals().map((r) => `${r.kind}:${r.id}:${r.reason}`)).toEqual([
      "edge:e-half:MISSING_TO",
    ]);

    const signature = logger.lines.find((line) => line.startsWith("SEED REFUSED:"));
    expect(signature, "no SEED REFUSED: signature was emitted").toBeDefined();
    expect(signature ?? "", "the signature does not name the path").toContain(DISK);
    expect(signature ?? "", "the signature does not name the refused id").toContain("e-half");
    expect(signature ?? "", "the signature does not name the reason").toContain("MISSING_TO");

    p.destroy();
    doc.destroy();
  });

  it("host seed: the refusal reaches the writer through the shared ledger and the file survives", async () => {
    const before = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE, HALF_EDGE]);
    const files = new Map<string, string>([[DISK, before]]);
    const vault = createVault(files);
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    await cs.subscribe(DISK, "host");
    const doc = syncManager.getDoc(`__canvas__:${DISK}`).doc;
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("n-alpha"),
      "the host seed never ran — the probe would be vacuous",
    ).toBe(true);
    expect(doc.getMap<Y.Map<unknown>>("edges").has("e-half")).toBe(false);

    const io = ioOver(files);
    const logger = recordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, {
      logger,
      seedRefusals: cs.seedRefusalLedger(DISK),
    });

    // The doc holds records, so cold open takes the doc-wins branch and flushes
    // straight away — the exact live moment the arrow used to disappear.
    expect(await p.coldOpen()).toBe("doc-wins");

    expect(files.get(DISK), "the host's own file was rewritten after a seed refusal").toBe(before);
    expect(edgeIdsIn(files.get(DISK) as string)).toContain("e-half");
    expect(logger.lines.some((line) => line.startsWith("SEED REFUSED:"))).toBe(true);

    p.destroy();
    cs.destroy();
  });

  it("nothing refused, nothing withheld: a canvas of only legal records still persists", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE]);
    const io = createIO({ [DISK]: before });
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await p.flush();

    expect(p.isWriteWithheld()).toBe(false);
    expect(io.write, "the writer stopped writing for a canvas with no refusals").toHaveBeenCalled();
    expect(nodeIdsIn(io.files.get(DISK) as string).sort()).toEqual(["n-alpha", "n-beta"]);
    expect(edgeIdsIn(io.files.get(DISK) as string)).toEqual(["e-sideless"]);

    p.destroy();
    doc.destroy();
  });
});
