// WP20 / AC1 — "A record in the doc that violates the ingest schema is
// quarantined (`on:true, q:true`) rather than logged only; it is never
// serialised and never rendered, and its field containers are preserved."
//
// The AC has two halves and only the SECOND one costs anything:
//
//   ├── the auditor writes a quarantine tombstone through WP12's map, so the
//   │      record stops reaching the file and the view, and
//   └── the record's `Y.Map` is STILL THERE, is the SAME OBJECT, and still
//          holds every field it held before the quarantine.
//
// Container IDENTITY is the oracle for the second half, exactly as in WP19: a
// `delete(id)` + `set(id, …)` would restore presence and even the values but
// not the object, and it is that detach which throws away the repair delta AC2
// depends on. A key-set comparison alone cannot see it.
//
// The fault is injected as a REMOTE delta, which is the only way an invalid
// record can be in the doc at all: WP18 refuses an invalid LOCAL proposal at
// the boundary, and WP14 forbids refusing a remote one (`reject: false`) —
// quarantining it afterwards is precisely the job this WP exists to do.
//
// The fault is MISSING_TYPE_SPECIFIC (a `text` node with no `text`) rather than
// missing geometry, so nothing here can be satisfied by the pre-existing
// SCATTER / DETACH / NO TYPE telemetry: those three cannot see this class at
// all, which is the "logged only" state the AC replaces.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  isTombstoneQuarantined,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "atlas.canvas";

function createVault() {
  const files = new Map<string, string>();
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

/** A subscribed client with a logger, so the audit is reachable at all. */
async function auditingClient(path: string) {
  const vault = createVault();
  const syncManager = createSyncManager();
  const warns: string[] = [];
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: (_c: string, m: string) => warns.push(m) });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, warns, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
}

function record(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

/** The BUILD_SPEC's fault-injection op: a peer writes the record, we receive it. */
function makePeer(target: Y.Doc) {
  const peer = new Y.Doc();
  return (mutate: (doc: Y.Doc) => void) => {
    peer.transact(() => mutate(peer));
    Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "remote");
  };
}

/** One settled audit pass (the debounce the doc observer already drives). */
function audit(): void {
  vi.runOnlyPendingTimers();
}

describe("WP20 AC1 — a schema-invalid record is quarantined, never destroyed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the invalid record lands as `on:true, q:true` while its Y.Map keeps its identity and every field", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const space = peer.getMap<Y.Map<unknown>>("nodes");
      space.set(
        "keep",
        record({
          id: "keep",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(240, 120),
          text: "a healthy card",
          color: "4",
        }),
      );
      // A `text` node with no `text` — MISSING_TYPE_SPECIFIC. Geometry and type
      // are intact, so none of the legacy signatures can see it.
      space.set(
        "torn",
        record({
          id: "torn",
          type: "text",
          pos: encodePos(600, 40),
          size: encodeSize(300, 180),
          color: "1",
        }),
      );
    });

    const containerBefore = nodes.get("torn");
    expect(containerBefore, "the fault injection never reached the doc").toBeDefined();
    const fieldsBefore = containerBefore?.toJSON();
    expect(
      readTombstoneEntry(deleted, "torn"),
      "something quarantined the record before the audit ran",
    ).toBeUndefined();

    audit();

    const entry = readTombstoneEntry(deleted, "torn");
    expect(entry, "the audit wrote no tombstone at all — it is still detection-only").toBeDefined();
    expect(entry?.on, "the quarantine does not suppress the record").toBe(true);
    expect(entry?.q, "the suppression is not marked as a quarantine (`q:true`)").toBe(true);
    expect(
      isTombstoneQuarantined(entry),
      "WP12's shared predicate does not read this entry as a quarantine",
    ).toBe(true);

    // NEVER DESTROYED — the half AC2 depends on.
    expect(nodes.has("torn"), "the quarantine removed the record key from `nodes`").toBe(true);
    expect(
      nodes.get("torn"),
      "the record container was replaced — a detach loses the delta that would lift the quarantine",
    ).toBe(containerBefore);
    expect(
      nodes.get("torn")?.toJSON(),
      "field values were lost by the quarantine; the record is no longer restorable",
    ).toEqual(fieldsBefore);

    // NEVER RENDERED, NEVER SERIALISED.
    expect(
      buildCanvasData(nodes, edges, deleted).nodes.map((node) => node.id),
      "the quarantined record is still rendered",
    ).toEqual(["keep"]);
    const onDisk = JSON.parse(serializeCanvas(nodes, edges, deleted)) as {
      nodes: Record<string, unknown>[];
    };
    expect(
      onDisk.nodes.map((node) => String(node.id)),
      "the quarantined record still reaches the file",
    ).toEqual(["keep"]);

    // The healthy neighbour is untouched — this is a quarantine, not a purge.
    expect(
      readTombstoneEntry(deleted, "keep"),
      "the audit quarantined a perfectly valid record",
    ).toBeUndefined();

    client.cs.destroy();
  });

  it("the audit emits no key removal on the record map at all", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const push = makePeer(client.doc);

    push((peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").set(
        "torn",
        record({
          id: "torn",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(200, 100),
        }),
      );
    });

    const removals: string[] = [];
    nodes.observe((event: Y.YMapEvent<Y.Map<unknown>>) => {
      for (const [key, change] of event.changes.keys) {
        if (change.action === "delete") removals.push(key);
      }
    });

    audit();

    expect(
      removals,
      "the audit called `nodesMap.delete(...)`: quarantine destroyed the record instead of suppressing it",
    ).toEqual([]);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(client.doc.getMap<unknown>("deleted"), "torn")),
      "nothing was removed, but nothing was quarantined either — the invalid record is still live",
    ).toBe(true);

    client.cs.destroy();
  });
});
