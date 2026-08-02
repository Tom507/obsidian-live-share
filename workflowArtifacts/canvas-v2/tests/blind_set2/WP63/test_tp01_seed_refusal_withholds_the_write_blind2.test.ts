// WP63 / AC1 — blind counterpart 2. Same claim, third angle:
//
//   ├── TWO records are refused in the same seed, with DIFFERENT reasons
//   │   (MISSING_TYPE_SPECIFIC on a `link` node that names no `url`, and
//   │   MISSING_SIZE on a node whose `width` arrived as a string). AC1 says the
//   │   signature names "each refused id and its reason" — a signature built
//   │   from the first refusal, or a ledger that keeps one entry per path,
//   │   passes every single-refusal probe.
//   ├── the canvas also carries an EMPTY TEXT CARD (`"text": ""`), which is a
//   │   legal JSON Canvas node under the WP14 amendment and must be ADMITTED, so
//   │   this probe cannot be satisfied by refusing everything, and
//   └── the withhold is checked as OBSERVABLE STATE as well as through the file
//       bytes: AC2 forbids a silent no-op, so "nothing happened" is not enough.
//
// FILE BYTES ARE THE ORACLE (charter §7); the signature is AC1's secondary check.

import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import { TFile } from "obsidian";

const DISK = "vault/roadmap.canvas";

/** An empty card the user has not typed into yet — legal (WP14 amendment). */
const EMPTY_CARD = { id: "n-empty", type: "text", x: 0, y: 0, width: 240, height: 100, text: "" };
const FULL_CARD = { id: "n-full", type: "text", x: 300, y: 0, width: 240, height: 100, text: "hi" };

/** `link` demands a `url` and the key was never written → MISSING_TYPE_SPECIFIC. */
const URL_LESS_LINK = { id: "n-link", type: "link", x: 0, y: 200, width: 300, height: 120 };

/** `width` arrived as a string, so no size register can be built → MISSING_SIZE. */
const WARPED_CARD = {
  id: "n-warp",
  type: "text",
  x: 300,
  y: 200,
  width: "240",
  height: 100,
  text: "the user's other card",
};

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

const FULL_FILE = canvasJson([EMPTY_CARD, URL_LESS_LINK, FULL_CARD, WARPED_CARD]);

describe("WP63 AC1 blind2 — two refusals, two reasons, one untouched file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cold-open seed: a real flush leaves every refused record where the user left it", async () => {
    const doc = new Y.Doc();
    const io = ioOver(new Map([[DISK, FULL_FILE]]));
    const logger = recordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, { logger });

    expect(await p.coldOpen()).toBe("seeded-from-file");

    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    // WP18 AC1 is untouched: both invalid local records stay OUT of the doc...
    expect(nodes.has("n-link")).toBe(false);
    expect(nodes.has("n-warp")).toBe(false);
    // ...and the legal empty card is admitted, so this is not "refuse all".
    expect(nodes.has("n-empty"), "a legal empty text card was refused at the seed").toBe(true);
    expect(nodes.has("n-full")).toBe(true);

    await p.flush();

    expect(io.files.get(DISK), "the user's file was rewritten after a seed refusal").toBe(FULL_FILE);
    expect(nodeIdsIn(io.files.get(DISK) as string).sort()).toEqual([
      "n-empty",
      "n-full",
      "n-link",
      "n-warp",
    ]);
    expect(io.write, "a write reached the disk while refusals stood").not.toHaveBeenCalled();
    expect(p.isWriteWithheld(), "the withhold is not observable state").toBe(true);

    // AC1: the signature names the path, EACH refused id and its reason.
    const signature = logger.lines.find((line) => line.startsWith("SEED REFUSED:")) ?? "";
    expect(signature, "no SEED REFUSED: signature was emitted").not.toBe("");
    expect(signature).toContain(DISK);
    for (const fragment of [
      "n-link",
      "MISSING_TYPE_SPECIFIC",
      "n-warp",
      "MISSING_SIZE",
    ]) {
      expect(signature, `the signature does not name ${fragment}`).toContain(fragment);
    }

    // ...and the ledger carries both as DATA, not only as prose.
    expect(
      p
        .seedRefusals()
        .map((r) => `${r.kind}:${r.id}:${r.reason}`)
        .sort(),
    ).toEqual(["node:n-link:MISSING_TYPE_SPECIFIC", "node:n-warp:MISSING_SIZE"]);

    p.destroy();
    doc.destroy();
  });

  it("host seed: both refusals reach the writer through the shared ledger", async () => {
    const files = new Map<string, string>([[DISK, FULL_FILE]]);
    const vault = createVault(files);
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });

    await cs.subscribe(DISK, "host");
    const doc = syncManager.getDoc(`__canvas__:${DISK}`).doc;
    expect(
      doc.getMap<Y.Map<unknown>>("nodes").has("n-empty"),
      "the host seed never ran — the probe would be vacuous",
    ).toBe(true);

    const io = ioOver(files);
    const logger = recordingLogger();
    const p = new CanvasPersistence(doc, io, DISK, {
      logger,
      seedRefusals: cs.seedRefusalLedger(DISK),
    });

    expect(await p.coldOpen()).toBe("doc-wins");

    expect(files.get(DISK), "the host's own file was rewritten after a seed refusal").toBe(
      FULL_FILE,
    );
    expect(p.seedRefusals().map((r) => r.id).sort()).toEqual(["n-link", "n-warp"]);
    expect(logger.lines.some((line) => line.startsWith("SEED REFUSED:"))).toBe(true);

    p.destroy();
    cs.destroy();
  });

  it("a canvas whose every record is legal — including an empty card — persists normally", async () => {
    const doc = new Y.Doc();
    const before = canvasJson([EMPTY_CARD, FULL_CARD]);
    const io = ioOver(new Map([[DISK, before]]));
    const p = new CanvasPersistence(doc, io, DISK);

    expect(await p.coldOpen()).toBe("seeded-from-file");
    await p.flush();

    expect(p.isWriteWithheld(), "a canvas with nothing refused must not be withheld").toBe(false);
    expect(io.write, "the writer stopped writing for a canvas with no refusals").toHaveBeenCalled();
    expect(nodeIdsIn(io.files.get(DISK) as string).sort()).toEqual(["n-empty", "n-full"]);

    p.destroy();
    doc.destroy();
  });
});
