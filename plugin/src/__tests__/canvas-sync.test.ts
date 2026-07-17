import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

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

const { CanvasSync } = await import("../files/canvas-sync");

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

  it("subscribe as guest writes Y.Map content to disk when data exists", async () => {
    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    const node = new Y.Map<unknown>();
    node.set("id", "n1");
    node.set("x", 50);
    node.set("y", 50);
    nodesMap.set("n1", node);

    await canvasSync.subscribe("test.canvas", "guest");

    expect(vault.adapter.write).toHaveBeenCalled();
    const writtenContent = vault.adapter.write.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].x).toBe(50);
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
        nodes: [{ id: "new-node", x: 100, y: 200 }],
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
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 100, y: 100 },
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
          { id: "n1", x: 0, y: 0 },
          { id: "n2", x: 100, y: 100 },
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
          { id: "n1", x: 50, y: 0 },
          { id: "n2", x: 100, y: 100 },
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
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0 }], edges: [] }),
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
          { id: "n1", x: 0, y: 0 },
          { id: "n2", x: 200, y: 200 },
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
          { id: "n1", x: 0, y: 0 },
          { id: "n2", x: 100, y: 100 },
        ],
        edges: [],
      }),
    );
    await canvasSync.subscribe("test.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:test.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");

    // Local user deletes n2.
    vault._files.set(
      "test.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0 }], edges: [] }),
    );
    await canvasSync.handleLocalModify("test.canvas");

    expect(nodesMap.size).toBe(1);
    expect(nodesMap.get("n2")).toBeUndefined();
  });

  // Bug G: when the injected canWrite guard returns false, local edits must not
  // be pushed into the shared Y doc.
  it("read-only guard prevents pushing local edits", async () => {
    vault._files.set(
      "ro.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 0, y: 0 }], edges: [] }),
    );
    await canvasSync.subscribe("ro.canvas", "host");
    canvasSync.setCanWrite(() => false);

    // Local user tries to move n1.
    vault._files.set(
      "ro.canvas",
      JSON.stringify({ nodes: [{ id: "n1", x: 500, y: 0 }], edges: [] }),
    );
    await canvasSync.handleLocalModify("ro.canvas");

    const docHandle = syncManager.getDoc("__canvas__:ro.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");
    expect((nodesMap.get("n1") as Y.Map<unknown>).get("x")).toBe(0); // unchanged
  });

  // Bug L1: with the max-wait cap, a continuous stream of remote updates still
  // flushes to disk within ~MAX_WAIT_MS rather than resetting forever.
  it("max-wait cap flushes remote stream to disk under ~500ms of churn", async () => {
    vault._files.set("stream.canvas", JSON.stringify({ nodes: [], edges: [] }));
    await canvasSync.subscribe("stream.canvas", "host");

    const docHandle = syncManager.getDoc("__canvas__:stream.canvas");
    const nodesMap = docHandle.doc.getMap<Y.Map<unknown>>("nodes");

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
  });
});
