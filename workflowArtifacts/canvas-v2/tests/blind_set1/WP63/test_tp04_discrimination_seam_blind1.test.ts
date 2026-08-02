// WP63 / AC4 — DISCRIMINATION, blind counterpart 1.
//
// This is the regression pin for a silent data-loss defect that reached a live
// path, so it is built to the charter's §7 rule and nothing else:
//
//   ├── the oracle is FILE BYTES BEFORE vs. AFTER A REAL FLUSH — never a
//   │   signature, never a doc assertion, never "the write was not called";
//   ├── the armed and disarmed runs differ in EXACTLY ONE thing, the seam
//   │   (`withholdOnSeedRefusal`); everything else is one shared function; and
//   └── the disarmed run is shown to ACTUALLY LOSE THE RECORD.
//
// Derived independently of the visible probe: the record at risk is an EDGE
// (MISSING_TO) rather than a node, the canvas also carries a legal side-less
// edge that must survive under BOTH settings, and the loss is asserted on the
// edge id space — a withhold wired only for the node container would leave every
// node-shaped discrimination test green while still deleting the user's arrows.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import { TFile } from "obsidian";

const DISK = "boards/wiring.canvas";

const NODE_A = { id: "n-alpha", type: "text", x: 0, y: 0, width: 200, height: 90, text: "alpha" };
const NODE_B = { id: "n-beta", type: "text", x: 400, y: 0, width: 200, height: 90, text: "beta" };
const SIDELESS_EDGE = { id: "e-sideless", fromNode: "n-alpha", toNode: "n-beta" };
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

function edgeIdsIn(content: string): string[] {
  const parsed = JSON.parse(content) as { edges?: { id?: string }[] };
  return (parsed.edges ?? []).map((e) => String(e.id));
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

interface Run {
  before: string;
  after: string;
  wrote: boolean;
}

/** ONE cold-open scenario, parameterised by the seam and by nothing else. */
async function runColdOpenSeed(withholdOnSeedRefusal: boolean): Promise<Run> {
  const doc = new Y.Doc();
  const before = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE, HALF_EDGE]);
  const files = new Map<string, string>([[DISK, before]]);
  const io = ioOver(files);
  const p = new CanvasPersistence(doc, io, DISK, { withholdOnSeedRefusal });

  const result = await p.coldOpen();
  if (result !== "seeded-from-file") throw new Error(`seed branch not taken: ${result}`);
  await p.flush();

  const after = files.get(DISK) as string;
  const wrote = (io.write as unknown as { mock: { calls: unknown[] } }).mock.calls.length > 0;
  p.destroy();
  doc.destroy();
  return { before, after, wrote };
}

/** The same single difference on the HOST path — the production composition. */
async function runHostSeed(withholdOnSeedRefusal: boolean): Promise<Run> {
  const before = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE, HALF_EDGE]);
  const files = new Map<string, string>([[DISK, before]]);
  const vault = createVault(files);
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  await cs.subscribe(DISK, "host");

  const doc = syncManager.getDoc(`__canvas__:${DISK}`).doc;
  const io = ioOver(files);
  const p = new CanvasPersistence(doc, io, DISK, {
    seedRefusals: cs.seedRefusalLedger(DISK),
    withholdOnSeedRefusal,
  });

  const result = await p.coldOpen();
  if (result !== "doc-wins") throw new Error(`doc-wins branch not taken: ${result}`);
  await p.flush();

  const after = files.get(DISK) as string;
  const wrote = (io.write as unknown as { mock: { calls: unknown[] } }).mock.calls.length > 0;
  p.destroy();
  cs.destroy();
  return { before, after, wrote };
}

describe("WP63 AC4 blind1 — the seam is what keeps the user's arrow in the file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("COLD-OPEN seed: armed → byte-identical; disarmed → the edge is deleted", async () => {
    const armed = await runColdOpenSeed(true);
    const disarmed = await runColdOpenSeed(false);

    // The disarmed leg must reproduce the defect, or the armed leg proves nothing.
    expect(disarmed.wrote, "the disarmed flush never wrote — the probe would be vacuous").toBe(
      true,
    );
    expect(disarmed.after, "the disarmed run did not rewrite the file").not.toBe(disarmed.before);
    expect(
      edgeIdsIn(disarmed.after),
      "the disarmed seam must reproduce the loss: `e-half` should be gone",
    ).not.toContain("e-half");

    expect(armed.after, "the armed seam did not keep the file byte-identical").toBe(armed.before);
    expect(edgeIdsIn(armed.after)).toContain("e-half");
    expect(armed.after).not.toBe(disarmed.after);
  });

  it("HOST seed: armed → byte-identical; disarmed → the edge is deleted", async () => {
    const armed = await runHostSeed(true);
    const disarmed = await runHostSeed(false);

    expect(disarmed.wrote, "the disarmed flush never wrote — the probe would be vacuous").toBe(
      true,
    );
    expect(
      edgeIdsIn(disarmed.after),
      "the disarmed seam must reproduce the loss on the host path",
    ).not.toContain("e-half");

    expect(armed.after, "the armed seam did not keep the host's file byte-identical").toBe(
      armed.before,
    );
    expect(edgeIdsIn(armed.after)).toContain("e-half");
    expect(armed.after).not.toBe(disarmed.after);
  });

  it("the armed mode is the DEFAULT — the seam cannot ship switched off", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE, HALF_EDGE]);
    const files = new Map<string, string>([[DISK, before]]);
    const io = ioOver(files);
    // No `withholdOnSeedRefusal` at all.
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await p.flush();

    expect(files.get(DISK), "the default configuration deletes the user's arrow").toBe(before);

    p.destroy();
    doc.destroy();
  });

  it("the seam only suppresses the REFUSAL case — a legal side-less canvas writes under both settings", async () => {
    const results: Record<string, string> = {};
    for (const withholdOnSeedRefusal of [true, false]) {
      const doc = new Y.Doc();
      const files = new Map<string, string>([
        [DISK, canvasJson([NODE_A, NODE_B], [SIDELESS_EDGE])],
      ]);
      const io = ioOver(files);
      const p = new CanvasPersistence(doc, io, DISK, { withholdOnSeedRefusal });
      expect(await p.coldOpen()).toBe("seeded-from-file");
      await p.flush();
      results[String(withholdOnSeedRefusal)] = files.get(DISK) as string;
      p.destroy();
      doc.destroy();
    }

    expect(
      results.true,
      "the armed seam suppressed a write that had nothing to do with a refusal",
    ).toBe(results.false);
    expect(edgeIdsIn(results.true)).toEqual(["e-sideless"]);
  });
});
