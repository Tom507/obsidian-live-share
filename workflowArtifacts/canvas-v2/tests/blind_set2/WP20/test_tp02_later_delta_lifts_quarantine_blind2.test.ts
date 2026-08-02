// WP20 AC2 blind2 — the repair arrives from a THIRD party, and only the record
// it actually repaired is released.
//
// The angle: the auditing client is not the one that broke the record and not
// the one that fixes it. Replica A injects two broken records, the client
// quarantines both, and then replica B — which has never seen the quarantine —
// sends a delta that completes ONE of them. That is the real shape of the
// repair path: quarantine and repair have different authors, and the repairing
// peer has no idea a quarantine exists.
//
// It is also the shape that catches a batch-flavoured release. An auditor that
// re-validates on "something in this pass changed" and then clears every
// quarantine it holds passes a one-record test and, here, resurrects the record
// that is still broken — straight into the user's file.
//
// The LAMPORT stamp is the second thing being watched. The release has to
// strictly dominate the quarantine it lifts, or the merge that WP12 defines
// leaves the record suppressed on any peer that sees the two ops in the other
// order. The stamps have a single author (this client) and a causal chain
// (quarantine observed, then release issued), so asserting `release.t >
// quarantine.t` is legitimate — this is not a concurrent same-key write.

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
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "shared/board.canvas";

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

function audit(): void {
  vi.runOnlyPendingTimers();
}

describe("WP20 AC2 blind2 — a third party's repair releases exactly the record it repaired", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("releases the repaired record, leaves the still-broken one quarantined, and stamps the release above the quarantine", async () => {
    const client = await auditingClient(PATH);
    const nodes = client.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = client.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = client.doc.getMap<unknown>("deleted");

    // REPLICA A — the one that introduced the damage.
    const replicaA = new Y.Doc();
    replicaA.transact(() => {
      const space = replicaA.getMap<Y.Map<unknown>>("nodes");
      space.set(
        "steady",
        record({
          id: "steady",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(240, 120),
          text: "steady",
        }),
      );
      // Both `text` nodes are missing their `text` — INVALID for now.
      space.set(
        "mended",
        record({ id: "mended", type: "text", pos: encodePos(300, 0), size: encodeSize(240, 120) }),
      );
      space.set(
        "lingering",
        record({
          id: "lingering",
          type: "text",
          pos: encodePos(600, 0),
          size: encodeSize(240, 120),
        }),
      );
    });
    Y.applyUpdate(client.doc, Y.encodeStateAsUpdate(replicaA), "remote");

    audit();

    const quarantine = readTombstoneEntry(deleted, "mended");
    expect(
      isTombstoneQuarantined(quarantine),
      "the invalid record was never quarantined, so there is no quarantine to lift",
    ).toBe(true);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "lingering")),
      "the second invalid record was never quarantined",
    ).toBe(true);

    // REPLICA B — has replica A's records, has NEVER seen the quarantine, and
    // repairs exactly one of them.
    const replicaB = new Y.Doc();
    Y.applyUpdate(replicaB, Y.encodeStateAsUpdate(replicaA), "peer");
    replicaB.transact(() => {
      replicaB.getMap<Y.Map<unknown>>("nodes").get("mended")?.set("text", "supplied elsewhere");
    });
    Y.applyUpdate(client.doc, Y.encodeStateAsUpdate(replicaB), "remote");

    audit();
    audit();

    const release = readTombstoneEntry(deleted, "mended");
    expect(
      isTombstoneSuppressed(release),
      "the record repaired by a third party was not released",
    ).toBe(false);
    expect(
      release?.t,
      "the release does not strictly dominate the quarantine it lifts — the merge can leave the record suppressed on a peer that sees the ops in the other order",
    ).toBeGreaterThan(quarantine?.t as number);

    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "lingering")),
      "the still-broken record was released as collateral — a batch release resurrects invalid records",
    ).toBe(true);
    expect(
      readTombstoneEntry(deleted, "steady"),
      "the untouched healthy record acquired a tombstone",
    ).toBeUndefined();

    expect(
      buildCanvasData(nodes, edges, deleted).nodes.map((node) => node.id).sort(),
      "the rendered set is wrong after the third-party repair",
    ).toEqual(["mended", "steady"]);
    expect(
      nodes.get("mended")?.toJSON(),
      "the released record does not carry the third party's repair plus its original fields",
    ).toEqual({
      id: "mended",
      type: "text",
      pos: [300, 0],
      size: [240, 120],
      text: "supplied elsewhere",
    });

    client.cs.destroy();
  });
});
