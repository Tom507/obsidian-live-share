// WP4 / AC4 — a save that is stale for a peer's field writes nothing for that
// field, and the discard is observable under the `SHADOW STALE:` signature.
//
// AC4: "A save that is stale for a peer's field (the field equals the shadow
// while the CRDT has moved on) produces **zero** writes for that field, and the
// discarded staleness is observable in the debug log under a dedicated
// signature."
//
// State is the oracle; the signature is for humans (BUILD_SPEC §8). Every case
// below asserts the CRDT first and the log line second — and the log assertions
// live in THIS file only, because this is the one AC that is about the signature.
//
// The signature is deliberately NOT emitted for every discarded field. A save
// re-states every unchanged field, and each of those is a discard by C2's rule 2;
// logging them would bury the one line that matters. `SHADOW STALE:` marks the
// DIVERGENT discards — the fields where the CRDT has genuinely moved on, i.e.
// exactly the fields that would have been reverted before V2.
//
//   ├── T1 the stale field is not written, a sibling field's real change is,
//   │      and one signature line names the field.
//   ├── T2 no divergence → no signature, even though the save re-states many
//   │      fields that C2 discards.
//   ├── T3 edges are named in their own id space.
//   └── T4 the line carries no user data — ids and field NAMES only.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "board.canvas";
const SIGNATURE = "SHADOW STALE:";

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
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

function applyRemoteDelta(
  doc: Y.Doc,
  build: (nodes: Y.Map<Y.Map<unknown>>, edges: Y.Map<Y.Map<unknown>>) => void,
): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"), remote.getMap<Y.Map<unknown>>("edges"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "peer");
  remote.destroy();
}

function field(doc: Y.Doc, which: "nodes" | "edges", id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>(which).get(id)?.get(key);
}

async function settle(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
}

const SECRET = "confidential minutes";
const NODE = { id: "n1", type: "text", x: 30, y: 20, width: 260, height: 90, text: SECRET };
const OTHER = { id: "n2", type: "text", x: 500, y: 20, width: 260, height: 90, text: "b" };
const EDGE = { id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left" };

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  const debugs: string[] = [];
  cs.setLogger({ debug: (_c: string, m: string) => debugs.push(m), warn: () => {} });
  const surface = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  cs.setSurfaceStateProvider((): SurfaceState => surface);
  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  cs.noteExternalDiskWrite(PATH, diskJson);
  await settle();
  return { vault, cs, doc, debugs, surface };
}

function signatures(lines: string[]): string[] {
  return lines.filter((m) => m.includes(SIGNATURE));
}

describe("WP4 AC4 — zero writes for a stale field, under the SHADOW STALE signature", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 the stale field is not written while a real change in the same record is", async () => {
    const p = await makePeer(canvasJson([NODE, OTHER], [EDGE]));

    // A peer retyped the card. This client's surface never saw it.
    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("text", "peer version");
    });

    p.debugs.length = 0;
    // Obsidian saves the surface it has: the OLD text plus a genuine move.
    p.vault.files.set(PATH, canvasJson([{ ...NODE, y: 44 }, OTHER], [EDGE]));
    await p.cs.handleLocalModify(PATH);

    // State oracle first.
    expect(field(p.doc, "nodes", "n1", "text"), "the stale text reverted a peer").toBe(
      "peer version",
    );
    expect(field(p.doc, "nodes", "n1", "y"), "the real move was swallowed").toBe(44);

    // Then the signature.
    const hits = signatures(p.debugs);
    expect(hits).toHaveLength(1);
    expect(hits[0].startsWith(SIGNATURE)).toBe(true);
    expect(hits[0]).toContain(PATH);
    expect(hits[0]).toContain("node/n1.text");
  });

  it("T2 no divergent field → no signature at all", async () => {
    const p = await makePeer(canvasJson([NODE, OTHER], [EDGE]));

    p.debugs.length = 0;
    // Every re-stated field equals the shadow AND the CRDT: routine, not stale.
    p.vault.files.set(PATH, canvasJson([{ ...NODE, y: 21 }, OTHER], [EDGE]));
    await p.cs.handleLocalModify(PATH);

    expect(field(p.doc, "nodes", "n1", "y")).toBe(21);
    expect(
      signatures(p.debugs),
      "the signature must mark real staleness, not every unchanged field",
    ).toHaveLength(0);
  });

  it("T3 a stale edge field is named in the edge id space", async () => {
    const p = await makePeer(canvasJson([NODE, OTHER], [EDGE]));

    applyRemoteDelta(p.doc, (_nodes, edges) => {
      edges.get("e1")?.set("toSide", "top");
    });

    p.debugs.length = 0;
    p.vault.files.set(PATH, canvasJson([NODE, { ...OTHER, x: 501 }], [EDGE]));
    await p.cs.handleLocalModify(PATH);

    expect(field(p.doc, "edges", "e1", "toSide"), "a stale edge re-route was pushed").toBe("top");
    expect(field(p.doc, "nodes", "n2", "x")).toBe(501);

    const hits = signatures(p.debugs);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("edge/e1.toSide");
    expect(hits[0]).not.toContain("node/e1");
  });

  it("T4 the signature carries ids and field names, never values", async () => {
    const p = await makePeer(canvasJson([NODE, OTHER], [EDGE]));

    applyRemoteDelta(p.doc, (nodes) => {
      nodes.get("n1")?.set("text", "peer version");
    });

    p.debugs.length = 0;
    p.vault.files.set(PATH, canvasJson([{ ...NODE, x: 31 }, OTHER], [EDGE]));
    await p.cs.handleLocalModify(PATH);

    const hits = signatures(p.debugs);
    expect(hits).toHaveLength(1);
    expect(hits[0], "user text must never reach the debug log").not.toContain(SECRET);
    expect(hits[0]).toContain("node/n1.text");
  });
});
