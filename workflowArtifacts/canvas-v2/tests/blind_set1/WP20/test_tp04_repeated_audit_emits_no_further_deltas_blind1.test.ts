// WP20 AC3 blind1 — idempotence measured on the ENCODED DOCUMENT, and on a
// doc that never needed repairing in the first place.
//
// Two angles the update counter cannot reach:
//
//   ├── THE HEALTHY DOC. "Repeated audits produce no further deltas" has a
//   │      degenerate case the fault-injection tests never visit: a canvas with
//   │      nothing wrong with it. An auditor that writes `{on:false}` for every
//   │      record it validated — a perfectly natural way to express "release
//   │      whatever might be quarantined" — is idempotent from the SECOND pass
//   │      onwards and therefore passes a pass-1-vs-pass-2 comparison, while
//   │      the first pass alone floods the room with one tombstone per record
//   │      and puts a `deleted` entry on every healthy card in the vault.
//   └── THE ENCODED STATE. `Y.encodeStateAsUpdate` is the whole document as it
//          would be sent, so comparing its bytes across passes catches a write
//          that changed nothing semantically but still produced an item — which
//          is exactly what an unconditional re-write of an identical tombstone
//          is. A `toJSON()` comparison of the maps cannot see it.
//
// Neither `it` sleeps or introduces a timing constant: a pass is
// `runOnlyPendingTimers`, and a timer scheduled BY a pass belongs to the next
// one.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { encodeEndpoint, encodePos, encodeSize } from "../../../canvas/canvas-registers";
import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneQuarantined, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "steady-state.canvas";

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

async function auditingClient(path: string) {
  const vault = createVault();
  const syncManager = createSyncManager();
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: false,
      handedToView: { node: new Set<string>(), edge: new Set<string>() },
    }),
  );
  await cs.subscribe(path, "guest");
  return { cs, doc: syncManager.getDoc(`__canvas__:${path}`).doc };
}

function record(fields: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) map.set(key, value);
  return map;
}

function makePeer(target: Y.Doc) {
  const peer = new Y.Doc();
  return (mutate: (doc: Y.Doc) => void) => {
    peer.transact(() => mutate(peer));
    Y.applyUpdate(target, Y.encodeStateAsUpdate(peer), "remote");
  };
}

function audit(): void {
  vi.runOnlyPendingTimers();
}

function encoded(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

function healthyBoard(peer: Y.Doc): void {
  const nodes = peer.getMap<Y.Map<unknown>>("nodes");
  nodes.set(
    "intro",
    record({
      id: "intro",
      type: "text",
      pos: encodePos(0, 0),
      size: encodeSize(300, 150),
      text: "welcome",
    }),
  );
  nodes.set(
    "doc",
    record({
      id: "doc",
      type: "file",
      pos: encodePos(400, 0),
      size: encodeSize(300, 400),
      file: "notes/spec.md",
    }),
  );
  nodes.set(
    "frame",
    record({
      id: "frame",
      type: "group",
      pos: encodePos(-50, -50),
      size: encodeSize(900, 600),
      label: "everything",
    }),
  );
  peer.getMap<Y.Map<unknown>>("edges").set(
    "link",
    record({
      id: "link",
      from: encodeEndpoint("intro", "right"),
      to: encodeEndpoint("doc", "left"),
    }),
  );
}

describe("WP20 AC3 blind1 — the audit is a fixed point on the encoded document", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a doc with nothing wrong with it survives its FIRST audit completely untouched", async () => {
    const client = await auditingClient(PATH);
    const push = makePeer(client.doc);
    push(healthyBoard);

    const before = encoded(client.doc);
    let updates = 0;
    client.doc.on("update", () => {
      updates += 1;
    });

    audit();
    audit();
    audit();

    expect(
      updates,
      "the audit wrote to a doc that had nothing wrong with it — every healthy record now carries a tombstone and every peer received it",
    ).toBe(0);
    expect(
      encoded(client.doc),
      "the encoded document changed even though the canvas was already valid",
    ).toBe(before);
    expect(
      [...client.doc.getMap<unknown>("deleted").keys()],
      "the audit populated the tombstone container for a healthy canvas",
    ).toEqual([]);

    client.cs.destroy();
  });

  it("after the repair pass the encoded document stops changing, byte for byte", async () => {
    const client = await auditingClient(PATH);
    const push = makePeer(client.doc);

    push((peer) => {
      healthyBoard(peer);
      // Two faults, so the repair pass has to write more than one entry.
      peer
        .getMap<Y.Map<unknown>>("nodes")
        .set("wraith", record({ id: "wraith", type: "text", pos: encodePos(0, 800) }));
      peer
        .getMap<Y.Map<unknown>>("edges")
        .set("tether", record({ id: "tether", from: encodeEndpoint("intro", "bottom") }));
    });

    const beforeRepair = encoded(client.doc);
    audit();
    const afterRepair = encoded(client.doc);

    expect(
      afterRepair,
      "the repair pass changed nothing at all — there is no fixed point to demonstrate",
    ).not.toBe(beforeRepair);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(client.doc.getMap<unknown>("deleted"), "wraith")),
    ).toBe(true);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(client.doc.getMap<unknown>("deleted"), "tether")),
    ).toBe(true);

    for (const pass of [2, 3, 4, 5]) {
      audit();
      expect(
        encoded(client.doc),
        `audit pass ${pass} changed the encoded document: the repair is not a fixed point and every peer's audit re-triggers it`,
      ).toBe(afterRepair);
    }

    client.cs.destroy();
  });
});
