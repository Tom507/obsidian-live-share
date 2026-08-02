import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { RECONCILE_GEOMETRY_KEYS } from "../canvas/reconcile-plan";
// WP19 AC1: deletion is a VALUE, not an absence — the oracles below read
// suppression + projection visibility, never raw key presence.
import { isTombstoneSuppressed, readTombstoneEntry } from "../canvas/canvas-tombstone";

function createMockVault() {
  const files = new Map<string, string>();
  return {
    read: vi.fn(async (file: any) => files.get(file.path) ?? ""),
    readBinary: vi.fn(),
    adapter: {
      write: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      writeBinary: vi.fn(),
      read: vi.fn(async (path: string) => files.get(path) ?? ""),
    },
    getAbstractFileByPath: vi.fn((path: string) => {
      if (files.has(path)) {
        const f = new TFile();
        f.path = path;
        return f;
      }
      return null;
    }),
    _files: files,
  };
}

function createMockSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, {
          doc,
          text: doc.getText("content"),
          awareness: { setLocalStateField: vi.fn() },
        });
      }
      return docs.get(docId)!;
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  };
}

function createMockFileOps() {
  return {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  };
}

const { buildCanvasData, CanvasSync, GEOMETRY_KEYS, PROTECTED_KEYS } = await import(
  "../files/canvas-sync"
);

// WP7 (US5 AC13): CanvasSync no longer writes `.canvas` bytes from the CRDT —
// `CanvasPersistence` is the single writer. The three cases below that asserted
// the RETIRED writer are re-pointed at the component that owns those writes now,
// so the properties they cover (guest seed reaches disk, the max-wait cap still
// forces a flush under continuous churn, a dangling edge is never serialized)
// stay under test against the real production composition.
const { attachCanvasPersistence, createVaultPersistenceIO } = await import(
  "../files/canvas-persistence"
);

function makePersistenceIO(
  vault: ReturnType<typeof createMockVault>,
  fileOps: ReturnType<typeof createMockFileOps>,
) {
  return createVaultPersistenceIO(
    {
      read: (p: string) => vault.adapter.read(p),
      write: (p: string, c: string) => vault.adapter.write(p, c),
      exists: async (p: string) => vault._files.has(p),
    },
    fileOps,
    { isPathSafe: () => true, ensureFolder: async () => {} },
  );
}

// Apply a NON-LOCAL (remote) mutation to a canvas doc, exactly as the yjs sync
// protocol would when integrating an in-flight remote update. `build` mutates a
// remote replica that has first been synced with `doc`, so a delete references
// the SAME item and actually removes it on `doc`.
function applyRemoteCanvasDelta(
  doc: Y.Doc,
  build: (nodes: Y.Map<Y.Map<unknown>>, edges: Y.Map<Y.Map<unknown>>) => void,
) {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(
    remote.getMap<Y.Map<unknown>>("nodes"),
    remote.getMap<Y.Map<unknown>>("edges"),
  );
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

function remoteNode(fields: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return m;
}

describe("CanvasSync", () => {
  let vault: ReturnType<typeof createMockVault>;
  let syncManager: ReturnType<typeof createMockSyncManager>;
  let fileOps: ReturnType<typeof createMockFileOps>;
  let canvasSync: InstanceType<typeof CanvasSync>;

  beforeEach(() => {
    vi.useFakeTimers();
    vault = createMockVault();
    syncManager = createMockSyncManager();
    fileOps = createMockFileOps();
    canvasSync = new CanvasSync(vault as any, syncManager as any, fileOps as any);
  });

  it("subscribe as host populates Y.Map from file content", async () => {
    const canvasContent = JSON.stringify({
      nodes: [
        {
          id: "n1",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          type: "text",
          text: "Hello",
        },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n1" }],
    });
    vault._files.set("test.canvas", canvasContent);

    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap("nodes");
    const edgesMap = docHandle.doc.getMap("edges");

    expect(nodesMap.size).toBe(1);
    expect(edgesMap.size).toBe(1);
    const node = nodesMap.get("n1") as Y.Map<unknown>;
    expect(node.get("text")).toBe("Hello");
  });

  // WP7 (US5 AC13/AC17) — CORRECTED: the guest seed write moved out of
  // CanvasSync into `CanvasPersistence.coldOpen()` ("doc-wins"), which the
  // wiring layer runs after `waitForSync` and before `start()`. Same property,
  // new owner — and CanvasSync writing nothing here is now itself an assertion.
  it("subscribe as guest writes Y.Map content to disk when data exists (via coldOpen)", async () => {
    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const node = new Y.Map<unknown>();
    node.set("id", "n1");
    node.set("x", 50);
    node.set("y", 50);
    nodesMap.set("n1", node);

    await canvasSync.subscribe("test.canvas", "guest");
    expect(vault.adapter.write).not.toHaveBeenCalled(); // CanvasSync is not a writer

    const { persistence, coldOpen } = await attachCanvasPersistence(
      docHandle.doc,
      makePersistenceIO(vault, fileOps),
      "test.canvas",
    );
    expect(coldOpen).toBe("doc-wins");

    expect(vault.adapter.write).toHaveBeenCalled();
    const writtenContent = vault.adapter.write.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].x).toBe(50);
    persistence.destroy();
  });

  it("isSubscribed returns true after subscribe", async () => {
    expect(canvasSync.isSubscribed("test.canvas")).toBe(false);
    vault._files.set("test.canvas", '{"nodes":[],"edges":[]}');
    await canvasSync.subscribe("test.canvas", "host");
    expect(canvasSync.isSubscribed("test.canvas")).toBe(true);
  });

  it("unsubscribe removes the subscription", async () => {
    vault._files.set("test.canvas", '{"nodes":[],"edges":[]}');
    await canvasSync.subscribe("test.canvas", "host");
    canvasSync.unsubscribe("test.canvas");

    expect(canvasSync.isSubscribed("test.canvas")).toBe(false);
    expect(syncManager.releaseDoc).toHaveBeenCalledWith("__canvas__:test.canvas");
  });

  it("handleLocalModify updates Y.Map from disk content", async () => {
    vault._files.set("test.canvas", '{"nodes":[],"edges":[]}');
    await canvasSync.subscribe("test.canvas", "host");

    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [{ id: "new-node", x: 100, y: 200, width: 100, height: 50, type: "text", text: "" }],
        edges: [],
      }),
    );

    await canvasSync.handleLocalModify("test.canvas");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap("nodes");
    expect(nodesMap.size).toBe(1);
    const node = nodesMap.get("new-node") as Y.Map<unknown>;
    expect(node.get("x")).toBe(100);
    expect(node.get("y")).toBe(200);
  });

  it("isRecentDiskWrite returns false initially", () => {
    expect(canvasSync.isRecentDiskWrite("test.canvas")).toBe(false);
  });

  it("destroy cleans up all subscriptions and timers", async () => {
    vault._files.set("a.canvas", '{"nodes":[],"edges":[]}');
    vault._files.set("b.canvas", '{"nodes":[],"edges":[]}');
    await canvasSync.subscribe("a.canvas", "host");
    await canvasSync.subscribe("b.canvas", "host");

    canvasSync.destroy();

    expect(canvasSync.isSubscribed("a.canvas")).toBe(false);
    expect(canvasSync.isSubscribed("b.canvas")).toBe(false);
    expect(syncManager.releaseDoc).toHaveBeenCalledTimes(2);
  });

  it("concurrent node moves merge correctly via shared Y.Doc", async () => {
    const canvasContent = JSON.stringify({
      nodes: [
        { id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
        { id: "n2", x: 100, y: 100, width: 100, height: 50, type: "text", text: "" },
      ],
      edges: [],
    });
    vault._files.set("test.canvas", canvasContent);

    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");

    docHandle.doc.transact(() => {
      const n1 = nodesMap.get("n1")!;
      n1.set("x", 50);
    });

    docHandle.doc.transact(() => {
      const n2 = nodesMap.get("n2")!;
      n2.set("y", 200);
    });

    const n1 = nodesMap.get("n1") as Y.Map<unknown>;
    const n2 = nodesMap.get("n2") as Y.Map<unknown>;
    expect(n1.get("x")).toBe(50);
    expect(n2.get("y")).toBe(200);
  });

  it("handles malformed canvas JSON gracefully", async () => {
    vault._files.set("bad.canvas", "not valid json");
    await canvasSync.subscribe("bad.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:bad.canvas");
    const nodesMap = docHandle.doc.getMap("nodes");
    expect(nodesMap.size).toBe(0);
  });

  // Bug C: a local modify of one node must NOT revert an un-flushed remote move
  // of a DIFFERENT node just because that remote delta is not yet on disk.
  it("local move of one node does not clobber an un-flushed remote move of another", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
          { id: "n2", x: 100, y: 100, width: 100, height: 50, type: "text", text: "" },
        ],
        edges: [],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");

    // Un-flushed remote move of n2 (mutate the Y map, do NOT flush to disk).
    docHandle.doc.transact(() => {
      (nodesMap.get("n2") as Y.Map<unknown>).set("y", 999);
    });

    // Local user drags n1 only; on-disk file is stale for n2 (still y:100).
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 50, y: 0, width: 100, height: 50, type: "text", text: "" },
          { id: "n2", x: 100, y: 100, width: 100, height: 50, type: "text", text: "" },
        ],
        edges: [],
      }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    const n1 = nodesMap.get("n1") as Y.Map<unknown>;
    const n2 = nodesMap.get("n2") as Y.Map<unknown>;
    expect(n1.get("x")).toBe(50); // local change applied
    expect(n2.get("y")).toBe(999); // un-flushed remote move preserved, NOT reverted
  });

  // Bug C: adding a node locally must not clobber an un-flushed remote key edit
  // on an existing node.
  it("local add-node does not clobber an un-flushed remote key edit", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" }], edges: [] }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");

    // Un-flushed remote edit: n1 gains text.
    docHandle.doc.transact(() => {
      (nodesMap.get("n1") as Y.Map<unknown>).set("text", "remote");
    });

    // Local user adds n2; on-disk n1 is stale (no text).
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
          { id: "n2", x: 200, y: 200, width: 100, height: 50, type: "text", text: "" },
        ],
        edges: [],
      }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    expect(nodesMap.size).toBe(2);
    expect((nodesMap.get("n1") as Y.Map<unknown>).get("text")).toBe("remote");
    expect((nodesMap.get("n2") as Y.Map<unknown>).get("x")).toBe(200);
  });

  // Bug C: a genuine local delete must still propagate (delete the node in Y).
  it("genuine local delete removes the node from the Y map", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
          { id: "n2", x: 100, y: 100, width: 100, height: 50, type: "text", text: "" },
        ],
        edges: [],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");
    // WP4: a delete intent needs the surface to PROVE the record is gone — an
    // open view plus a hand-over receipt. Same property, stated preconditions.
    canvasSync.setSurfaceStateProvider(() => ({
      viewOpen: true,
      handedToView: { node: new Set<string>(["n1", "n2"]), edge: new Set<string>() },
    }));

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");

    // Local user deletes n2.
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" }], edges: [] }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    // WP19 AC1 — the delete still propagates, but as a VALUE: `n2` is
    // tombstone-suppressed and gone from the projection, while its field
    // container survives intact (which is what makes the undo lossless).
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    const deletedMap = docHandle.doc.getMap<unknown>("deleted");
    expect(isTombstoneSuppressed(readTombstoneEntry(deletedMap, "n2"))).toBe(true);
    expect(buildCanvasData(nodesMap, edgesMap, deletedMap).nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(nodesMap.size).toBe(2);
    const deletedN2 = nodesMap.get("n2") as Y.Map<unknown>;
    expect(deletedN2.get("x")).toBe(100);
    expect(deletedN2.get("y")).toBe(100);
    expect(deletedN2.get("type")).toBe("text");
  });

  // Bug G: when the injected canWrite guard returns false, local edits must not
  // be pushed into the shared Y doc.
  it("read-only guard prevents pushing local edits", async () => {
    vault._files.set(
      "ro.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" }], edges: [] }),
    );
    await canvasSync.subscribe("ro.canvas", "host");
    canvasSync.setCanWrite(() => false);

    // Local user tries to move n1.
    vault._files.set(
      "ro.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 500, y: 0, width: 100, height: 50, type: "text", text: "" }], edges: [] }),
    );
    await canvasSync.handleLocalModify("ro.canvas");

    const docHandle = syncManager.getDoc("__canvas__:ro.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    expect((nodesMap.get("n1") as Y.Map<unknown>).get("x")).toBe(0); // unchanged
  });

  // Bug L1: with the max-wait cap, a continuous stream of remote updates still
  // flushes to disk within ~MAX_WAIT_MS rather than resetting forever.
  // WP7 — CORRECTED: the debounce+cap moved to the single writer, which imports
  // the SAME DEBOUNCE_MS / MAX_WAIT_MS constants from this module, so the cap
  // property is genuinely preserved rather than re-implemented.
  it("max-wait cap flushes remote stream to disk under ~500ms of churn", async () => {
    vault._files.set("stream.canvas", JSON.stringify({ nodes: [], edges: [] }));
    await canvasSync.subscribe("stream.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:stream.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const { persistence } = await attachCanvasPersistence(
      docHandle.doc,
      makePersistenceIO(vault, fileOps),
      "stream.canvas",
    );

    // Seed a node remotely so there is something to flush.
    docHandle.doc.transact(() => {
      const n = new Y.Map<unknown>();
      n.set("id", "n1");
      n.set("x", 0);
      nodesMap.set("n1", n);
    });

    vault.adapter.write.mockClear();
    // Churn every 100ms (< DEBOUNCE_MS=200) for 600ms; a pure trailing debounce
    // would never fire. The max-wait cap (500ms) must force at least one flush.
    for (let i = 1; i <= 6; i++) {
      docHandle.doc.transact(() => {
        (nodesMap.get("n1") as Y.Map<unknown>).set("x", i);
      });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(300);

    expect(vault.adapter.write).toHaveBeenCalled();
    persistence.destroy();
  });

  // --- WP3: delete-wins / no-resurrect (US3 AC6, GAP-2, fix of :304-311) ---
  it("does NOT resurrect a remote-deleted node even when the local user edits it", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0 }], edges: [] }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");

    // Remote delete of n1 (non-local transaction removes it from the shared doc).
    applyRemoteCanvasDelta(docHandle.doc, (nodes) => nodes.delete("n1"));
    expect(nodesMap.get("n1")).toBeUndefined();

    // Local user edits n1 on disk (stale — still present locally).
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 500, y: 0 }], edges: [] }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    // Delete wins: the node stays deleted (never resurrected).
    expect(nodesMap.get("n1")).toBeUndefined();
  });

  // --- WP3: diff-inferred fallback fires on first key change (US3 AC2) ---
  it("onLocalNodeChange fires on the first local key change (diff-inferred fallback, private API absent)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0 }], edges: [] }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    const claimed: string[] = [];
    canvasSync.setOnLocalNodeChange((_p, nodeId) => claimed.push(nodeId));

    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 42, y: 0 }], edges: [] }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    expect(claimed).toContain("n1"); // lock acquired on first key change, no private API
  });

  // --- WP4 (US5 AC3): edge cascade/prune ---
  it("prunes edges in the shared doc when their endpoint node is locally deleted (GAP-5)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 0, y: 0 },
          { id: "n2", x: 1, y: 1 },
        ],
        edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");
    // WP4: the delete rule is gated on an open view + a hand-over receipt.
    canvasSync.setSurfaceStateProvider(() => ({
      viewOpen: true,
      handedToView: { node: new Set<string>(["n1", "n2"]), edge: new Set<string>(["e1"]) },
    }));

    // Local user deletes n2 (edge e1 left in the file to prove cascade-prune).
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [{ id: "n1", x: 0, y: 0 }],
        edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
      }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    const cascadeDoc = syncManager.getDoc("__canvas__:test.canvas").doc;
    const edgesMap = cascadeDoc.getMap<Y.Map<unknown>>("edges");
    const cascadeNodes = cascadeDoc.getMap<Y.Map<unknown>>("nodes");
    const cascadeDeleted = cascadeDoc.getMap<unknown>("deleted");

    // WP19 AC3 — the cascade is expressed through `buildCanvasData`'s
    // visibleNodeIds set, NOT by removing the edge key and NOT by tombstoning
    // the edge: a cascaded edge carries no tombstone of its own.
    expect(buildCanvasData(cascadeNodes, edgesMap, cascadeDeleted).edges).toEqual([]);
    expect(isTombstoneSuppressed(readTombstoneEntry(cascadeDeleted, "e1"))).toBe(false);
    // AC1 — the cascade destroys nothing: container and endpoints survive.
    const cascadedE1 = edgesMap.get("e1") as Y.Map<unknown>;
    expect(cascadedE1).toBeDefined();
    expect(cascadedE1.get("fromNode")).toBe("n1");
    expect(cascadedE1.get("toNode")).toBe("n2");
  });

  // WP7 — CORRECTED: same property, asserted on the single writer's bytes. The
  // dangling-edge prune lives in `buildCanvasData`/`serializeCanvas`, which
  // `CanvasPersistence` imports from this module, so nothing was re-implemented.
  it("never serializes a dangling edge to disk (US5 AC3)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" }], edges: [] }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const { persistence } = await attachCanvasPersistence(
      docHandle.doc,
      makePersistenceIO(vault, fileOps),
      "test.canvas",
    );
    vault.adapter.write.mockClear();
    // A remote delta adds an edge whose toNode never existed. It also moves the
    // node, so the serialized snapshot genuinely differs from the one the cold
    // open already wrote — otherwise the (correct) redundant-write skip fires and
    // there are no bytes to inspect.
    applyRemoteCanvasDelta(docHandle.doc, (nodes, edges) => {
      (nodes.get("n1") as Y.Map<unknown>).set("x", 11);
      edges.set("e2", remoteNode({ id: "e2", fromNode: "n1", toNode: "ghost" }));
    });

    await vi.advanceTimersByTimeAsync(600);

    expect(vault.adapter.write).toHaveBeenCalled();
    const written = vault.adapter.write.mock.calls.at(-1)![1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.edges).toHaveLength(0); // dangling edge pruned on serialize
    expect(parsed.nodes).toHaveLength(1);
    persistence.destroy();
  });

  // --- WP4 (US5 AC1): canvas flush version/sequence gate ---
  it("a stale canvas flush yields to an in-flight remote delta (US5 AC1)", async () => {
    vault._files.set("test.canvas", JSON.stringify({ nodes: [], edges: [] }));
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    // Remote delta integrated -> per-path sequence advances past the snapshot 0.
    applyRemoteCanvasDelta(docHandle.doc, (nodes) => {
      nodes.set("n1", remoteNode({ id: "n1", x: 1 }));
    });
    vault.adapter.write.mockClear();

    // A flush snapshotted at seq 0 (stale) must NOT clobber the newer remote state.
    await (canvasSync as unknown as {
      writeToDisk: (p: string, c: string, s?: number) => Promise<void>;
    }).writeToDisk("test.canvas", "STALE", 0);

    expect(vault.adapter.write).not.toHaveBeenCalledWith(expect.anything(), "STALE");

    // A flush whose snapshot sequence still matches writes normally.
    const seq = (canvasSync as unknown as { currentSeq: (p: string) => number }).currentSeq(
      "test.canvas",
    );
    await (canvasSync as unknown as {
      writeToDisk: (p: string, c: string, s?: number) => Promise<void>;
    }).writeToDisk("test.canvas", "FRESH", seq);

    expect(vault.adapter.write).toHaveBeenCalledWith(expect.anything(), "FRESH");
  });

  // --- Initial-sync fix: freshly-mounted view must be reconcilable from shared truth ---
  it("getCanvasSnapshot returns the dangling-edge-pruned shared snapshot", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [{ id: "n1", x: 5, y: 6, width: 100, height: 80, type: "text", text: "" }],
        edges: [
          { id: "e1", fromNode: "n1", toNode: "n1" }, // valid
          { id: "e2", fromNode: "n1", toNode: "ghost" }, // dangling -> pruned
        ],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    const snap = canvasSync.getCanvasSnapshot("test.canvas");
    expect(snap).not.toBeNull();
    expect(snap!.nodes).toHaveLength(1);
    expect((snap!.nodes[0] as { id: string }).id).toBe("n1");
    expect(snap!.edges).toHaveLength(1); // dangling e2 pruned
    expect((snap!.edges[0] as { id: string }).id).toBe("e1");
  });

  it("getCanvasSnapshot returns null when not subscribed or shared doc empty", async () => {
    expect(canvasSync.getCanvasSnapshot("nope.canvas")).toBeNull();
    vault._files.set("empty.canvas", JSON.stringify({ nodes: [], edges: [] }));
    await canvasSync.subscribe("empty.canvas", "host");
    expect(canvasSync.getCanvasSnapshot("empty.canvas")).toBeNull(); // subscribed but empty
  });

  it("guest subscribe fires onRemoteCanvasUpdate so an already-open view snaps to shared truth", async () => {
    // Pre-seed the shared doc as if the host already populated it.
    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    nodesMap.set("n1", remoteNode({ id: "n1", x: 50, y: 60, width: 100, height: 80 }));
    vault._files.set("test.canvas", JSON.stringify({ nodes: [], edges: [] }));

    const seen: Array<{ nodes: unknown[]; edges: unknown[] }> = [];
    canvasSync.setOnRemoteCanvasUpdate((_p, data) => seen.push(data));

    await canvasSync.subscribe("test.canvas", "guest");

    expect(seen).toHaveLength(1); // fired exactly once on the seed
    expect(seen[0].nodes).toHaveLength(1);
    expect((seen[0].nodes[0] as { id: string }).id).toBe("n1");
  });

  it("host subscribe does NOT fire onRemoteCanvasUpdate (its own view is source of truth)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0 }], edges: [] }),
    );
    const seen: unknown[] = [];
    canvasSync.setOnRemoteCanvasUpdate((_p, data) => seen.push(data));

    await canvasSync.subscribe("test.canvas", "host");

    expect(seen).toHaveLength(0);
  });

  // =========================================================================
  // WP4 — node + edge locking (US2). Edge writes go through the SAME lock seam
  // as nodes (both endpoints must be writable), a changed edge is merged per key
  // instead of re-created, a remote-deleted edge is never resurrected, and a pass
  // that suffered ANY denial holds its diff baseline back.
  // =========================================================================

  // Baseline (lastWrittenContent) is private state with a public consequence; the
  // consequence is asserted too, but reading it directly pins AC4 precisely.
  const baselineOf = (path: string) =>
    (canvasSync as unknown as { lastWrittenContent: Map<string, string> }).lastWrittenContent.get(
      path,
    );

  const captureWarnings = () => {
    const warns: string[] = [];
    canvasSync.setLogger({ debug: () => {}, warn: (_c, m) => warns.push(m) });
    return warns;
  };

  const twoNodesOneEdge = (toSide: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      nodes: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 100, y: 100 },
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2", toSide, ...extra }],
    });

  it("edge write is allowed while both endpoint nodes are free (US2 AC1, default-allow)", async () => {
    vault._files.set("test.canvas", twoNodesOneEdge("left"));
    await canvasSync.subscribe("test.canvas", "host");
    const warns = captureWarnings();

    vault._files.set("test.canvas", twoNodesOneEdge("right"));
    await canvasSync.handleLocalModify("test.canvas");

    const edgesMap = syncManager
      .getDoc("__canvas__:test.canvas")
      .doc.getMap<Y.Map<unknown>>("edges");
    expect((edgesMap.get("e1") as Y.Map<unknown>).get("toSide")).toBe("right");
    expect(warns.filter((m) => m.startsWith("LOCK DENIED:"))).toHaveLength(0);
    expect(baselineOf("test.canvas")).toBe(twoNodesOneEdge("right")); // baseline advanced
  });

  // --- US2 AC2: a changed, still-present edge is merged PER KEY, never replaced
  it("a changed edge that still exists is merged per key, never re-created (US2 AC2)", async () => {
    vault._files.set("test.canvas", twoNodesOneEdge("left"));
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    const edgeItem = edgesMap.get("e1");
    // Peer B concurrently sets `color` on e1 (un-flushed to our disk).
    applyRemoteCanvasDelta(docHandle.doc, (_nodes, edges) => {
      (edges.get("e1") as Y.Map<unknown>).set("color", "4");
    });

    // Peer A (us) moves the same edge's toSide.
    vault._files.set("test.canvas", twoNodesOneEdge("right"));
    await canvasSync.handleLocalModify("test.canvas");

    const e1 = edgesMap.get("e1") as Y.Map<unknown>;
    expect(e1.get("toSide")).toBe("right"); // our change applied
    expect(e1.get("color")).toBe("4"); // peer's concurrent key survived
    expect(e1).toBe(edgeItem); // same Y.Map — never detached by a re-create
  });

  // --- US2 AC3: delete-wins for EDGES (no resurrect), matching the node path --
  it("does NOT resurrect a remote-deleted EDGE when the local user edits it (US2 AC3)", async () => {
    vault._files.set("test.canvas", twoNodesOneEdge("left"));
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const edgesMap = docHandle.doc.getMap<Y.Map<unknown>>("edges");
    applyRemoteCanvasDelta(docHandle.doc, (_nodes, edges) => edges.delete("e1"));
    expect(edgesMap.get("e1")).toBeUndefined();

    // Local user edits e1 on the (now stale) disk file.
    vault._files.set("test.canvas", twoNodesOneEdge("right"));
    await canvasSync.handleLocalModify("test.canvas");

    expect(edgesMap.get("e1")).toBeUndefined(); // delete wins
    expect(edgesMap.size).toBe(0);
  });

  // =========================================================================
  // WP5 — structural key protection (US3 AC9-AC11) + the audit's third
  // signature (US3 AC12/AC13, US6 `NO TYPE signature:`).
  //
  // `GEOMETRY_KEYS` only ever protected x/y/width/height, so a stale or partial
  // local read could DELETE a node's `type` or an edge's endpoints out of the
  // CRDT. Obsidian's importData skips any node whose `type` is not
  // file|text|link|group and creates an edge only when both endpoints exist, so
  // one such delete makes every peer silently drop the node AND all its edges.
  // =========================================================================

  const nodesOf = (path = "test.canvas") =>
    syncManager.getDoc(`__canvas__:${path}`).doc.getMap<Y.Map<unknown>>("nodes");
  const edgesOf = (path = "test.canvas") =>
    syncManager.getDoc(`__canvas__:${path}`).doc.getMap<Y.Map<unknown>>("edges");
  const deletedOf = (path = "test.canvas") =>
    syncManager.getDoc(`__canvas__:${path}`).doc.getMap<unknown>("deleted");

  // --- US3 AC9/AC10: the two key sets ----------------------------------------
  it("GEOMETRY_KEYS keeps exactly {x,y,width,height}; PROTECTED_KEYS is the wider superset (US3 AC9/AC10)", () => {
    expect([...GEOMETRY_KEYS].sort()).toEqual(["height", "width", "x", "y"]);
    // The wider set is a NEW export and must contain `type` plus the edge
    // structural keys, without changing GEOMETRY_KEYS' membership.
    for (const key of GEOMETRY_KEYS) expect(PROTECTED_KEYS.has(key)).toBe(true);
    for (const key of ["type", "fromNode", "toNode", "fromSide", "toSide"]) {
      expect(PROTECTED_KEYS.has(key)).toBe(true);
    }
    // Content keys stay deletable — only structure is protected.
    for (const key of ["text", "color", "label", "file", "url", "id"]) {
      expect(PROTECTED_KEYS.has(key)).toBe(false);
    }
    // Drift guard: the reconcile classifier keeps a private mirror of the geometry
    // keys (it must not import the Obsidian-bound canvas-sync module). Pin them.
    expect([...RECONCILE_GEOMETRY_KEYS].sort()).toEqual([...GEOMETRY_KEYS].sort());
  });

  // --- US3 AC11 (PRIMARY RED): applyKeyDiff must not delete `type` ------------
  it("keeps a node's `type` when a stale/partial local read omits it (US3 AC11)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 60, type: "text", text: "hi" }],
        edges: [],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");
    expect((nodesOf().get("n1") as Y.Map<unknown>).get("type")).toBe("text");

    // The local user moved the card, but this read of the file lost `type`.
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [{ id: "n1", x: 40, y: 0, width: 100, height: 60, text: "hi" }],
        edges: [],
      }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    const n1 = nodesOf().get("n1") as Y.Map<unknown>;
    expect(n1.get("x")).toBe(40); // the genuine local change still lands
    expect(n1.get("type")).toBe("text"); // AC11: `type` survives the key diff
  });

  // --- US3 AC9 (SPEC-DELTA RED): applyToYMap must not delete edge endpoints ---
  it("keeps an edge's fromNode/toNode when the full-merge branch sees a partial local record (US3 AC9)", async () => {
    // Baseline has NO edge, so the incoming e1 hits the `!baseObj && existing`
    // full-merge branch (applyToYMap), which deletes every key the local record
    // lacks — for an edge that includes the endpoints themselves.
    const twoNodes = [
      { id: "n1", x: 0, y: 0, width: 100, height: 50, type: "text", text: "" },
      { id: "n2", x: 100, y: 100, width: 100, height: 50, type: "text", text: "" },
    ];
    vault._files.set("test.canvas", JSON.stringify({ nodes: twoNodes, edges: [] }));
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    // A peer adds e1: present in the CRDT, still absent from our diff baseline.
    applyRemoteCanvasDelta(docHandle.doc, (_nodes, edges) => {
      edges.set("e1", remoteNode({ id: "e1", fromNode: "n1", toNode: "n2", toSide: "left" }));
    });

    // Our disk now shows e1 too, but as a partial record without endpoints.
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: twoNodes, edges: [{ id: "e1", color: "4" }] }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    const e1 = edgesOf().get("e1") as Y.Map<unknown>;
    expect(e1.get("fromNode")).toBe("n1"); // endpoints are structural: never deleted
    expect(e1.get("toNode")).toBe("n2");
    expect(e1.get("toSide")).toBe("left"); // the peer's routing survives too
    expect(e1.get("color")).toBe("4"); // and our real change still lands
    // The dangling-edge serialization guard cannot catch an endpoint-LESS edge
    // (it requires a string), so without the guard above this edge reaches disk
    // and every peer drops it on import.
    // WP64 — 3-arg: the projection this oracle reads must be the one production
    // writes, so a tombstoned edge is suppressed here exactly as it would be on
    // disk rather than silently read back as a live record.
    expect(
      (
        buildCanvasData(nodesOf(), edgesOf(), deletedOf()).edges[0] as Record<string, unknown>
      ).fromNode,
    ).toBe("n1");
  });

  it("keeps an edge's endpoints when the key-diff branch sees a partial local record (US3 AC9)", async () => {
    // Same protection, other branch: e1 IS in our baseline, so applyKeyDiff runs.
    const twoNodes = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 100, y: 100 },
    ];
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: twoNodes,
        edges: [{ id: "e1", fromNode: "n1", toNode: "n2", toSide: "left" }],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: twoNodes, edges: [{ id: "e1", color: "4" }] }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    const e1 = edgesOf().get("e1") as Y.Map<unknown>;
    expect(e1.get("fromNode")).toBe("n1");
    expect(e1.get("toNode")).toBe("n2");
    expect(e1.get("color")).toBe("4");
  });

  it("a genuine local DELETE of a whole record is still honoured (protection is per-key only)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 0, y: 0, type: "text", width: 100, height: 50, text: "" },
          { id: "n2", x: 9, y: 9, type: "text", width: 100, height: 50, text: "" },
        ],
        edges: [],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");
    // WP4: the delete rule is gated on an open view + a hand-over receipt.
    canvasSync.setSurfaceStateProvider(() => ({
      viewOpen: true,
      handedToView: { node: new Set<string>(["n1", "n2"]), edge: new Set<string>() },
    }));

    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0, type: "text", width: 100, height: 50, text: "" }], edges: [] }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    // WP19 AC1 — the whole-record delete is still honoured, spelled as a
    // tombstone: PROTECTED_KEYS is a per-key guard and does not block it.
    expect(isTombstoneSuppressed(readTombstoneEntry(deletedOf(), "n2"))).toBe(true);
    expect(buildCanvasData(nodesOf(), edgesOf(), deletedOf()).nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(nodesOf().size).toBe(2);
    const wholeRecordN2 = nodesOf().get("n2") as Y.Map<unknown>;
    expect(wholeRecordN2.get("x")).toBe(9);
    expect(wholeRecordN2.get("y")).toBe(9);
    expect(wholeRecordN2.get("type")).toBe("text");
  });

  // --- US3 AC12/AC13 + US6: the `NO TYPE signature:` audit line ---------------
  it("audits a live node missing `type` and a type:file node missing `file` (US3 AC12/AC13)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 0, y: 0, type: "text", text: "hi", width: 100, height: 50 },
          { id: "n2", x: 9, y: 9, type: "file", file: "a.md", width: 100, height: 50 },
          { id: "n3", x: 5, y: 5, type: "text", text: "fine", width: 100, height: 50 },
        ],
        edges: [],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");
    const warns = captureWarnings();

    // A remote delta strips n1's `type` and n2's `file` — invisible to the
    // SCATTER (x/y) and DETACH (dangling endpoint) checks at HEAD.
    applyRemoteCanvasDelta(syncManager.getDoc("__canvas__:test.canvas").doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).delete("type");
      (nodes.get("n2") as Y.Map<unknown>).delete("file");
    });
    await vi.advanceTimersByTimeAsync(600); // let the debounced flush + audit run

    const noType = warns.filter((m) => m.startsWith("NO TYPE signature:"));
    expect(noType.length).toBeGreaterThanOrEqual(1);
    expect(noType.join(" | ")).toContain("n1"); // missing type
    expect(noType.join(" | ")).toContain("n2"); // type:file without file
    expect(noType.join(" | ")).not.toContain("n3"); // healthy node not named
    // The two pre-existing signatures keep their exact text (US6 AC3).
    expect(warns.filter((m) => m.startsWith("SCATTER signature:"))).toHaveLength(0);
    expect(warns.filter((m) => m.startsWith("DETACH signature:"))).toHaveLength(0);
  });

  it("emits NO signature for a fully healthy canvas (no false positives)", async () => {
    vault._files.set(
      "test.canvas",
      JSON.stringify({
        nodes: [
          { id: "n1", x: 0, y: 0, type: "text", text: "hi", width: 100, height: 50 },
          { id: "n2", x: 9, y: 9, type: "file", file: "a.md", width: 100, height: 50 },
        ],
        edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");
    const warns = captureWarnings();

    applyRemoteCanvasDelta(syncManager.getDoc("__canvas__:test.canvas").doc, (nodes) => {
      (nodes.get("n1") as Y.Map<unknown>).set("text", "peer edit");
    });
    await vi.advanceTimersByTimeAsync(600);

    expect(warns.filter((m) => m.startsWith("NO TYPE signature:"))).toHaveLength(0);
  });
});
