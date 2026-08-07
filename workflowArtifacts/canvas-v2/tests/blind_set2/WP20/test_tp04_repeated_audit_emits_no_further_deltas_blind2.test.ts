// WP20 AC3 blind2 — the fixed point AFTER A RELEASE, and on a peer that only
// ever RECEIVES a repair it did not make.
//
// Every idempotence test so far settles on a quarantine. The release is the
// other resting state and it is the fragile one, because after a release the
// record is valid and its `deleted` entry still exists, reading `{on:false}`.
// An auditor whose release rule is "this record is valid and it has an entry →
// write `on:false`" is stable while a record is quarantined and writes forever
// once it is released — one delta per pass, per record, per peer, and the doc
// state never changes so nothing but an update count can see it.
//
// The second replica is the other half of the same property. It receives the
// first replica's repair traffic and audits with the SAME rule; if the rule is
// "did anything change?" rather than "is there work to do?", the two clients
// keep waking each other up. Two clients cannot show that on their own — the
// audit is driven by the doc observer, so a delta from either one re-arms the
// other — which is why the arriving traffic is replayed and the receiving
// replica is measured separately.
//
// The record travels the whole cycle: broken → quarantined → repaired →
// released → and then must sit still.

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
import { CanvasSync, serializeCanvas } from "../../../files/canvas-sync";

const PATH = "cycle.canvas";

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

describe("WP20 AC3 blind2 — a released record is as much a fixed point as a quarantined one", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("neither the repairing client nor the receiving one keeps writing after the release", async () => {
    const alpha = await auditingClient(PATH);
    const beta = await auditingClient(PATH);

    // A fourth party authors the broken board; both clients receive it.
    const origin = new Y.Doc();
    origin.transact(() => {
      const nodes = origin.getMap<Y.Map<unknown>>("nodes");
      nodes.set(
        "solid",
        record({
          id: "solid",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(240, 120),
          text: "solid",
        }),
      );
      nodes.set(
        "cycler",
        record({ id: "cycler", type: "text", pos: encodePos(400, 0), size: encodeSize(240, 120) }),
      );
    });
    const seed = Y.encodeStateAsUpdate(origin);
    Y.applyUpdate(alpha.doc, seed, "remote");
    Y.applyUpdate(beta.doc, seed, "remote");

    audit();
    expect(
      isTombstoneQuarantined(readTombstoneEntry(alpha.doc.getMap<unknown>("deleted"), "cycler")),
      "alpha never quarantined the invalid record",
    ).toBe(true);

    // The repair, authored by the same fourth party, reaches alpha only.
    origin.transact(() => {
      origin.getMap<Y.Map<unknown>>("nodes").get("cycler")?.set("text", "repaired");
    });
    Y.applyUpdate(alpha.doc, Y.encodeStateAsUpdate(origin), "remote");

    audit();
    audit();

    expect(
      isTombstoneSuppressed(readTombstoneEntry(alpha.doc.getMap<unknown>("deleted"), "cycler")),
      "alpha did not release the repaired record — there is no released state to test",
    ).toBe(false);

    // ALPHA has settled on a RELEASE. It must now sit still.
    let alphaUpdates = 0;
    alpha.doc.on("update", () => {
      alphaUpdates += 1;
    });
    const alphaFile = serializeCanvas(
      alpha.doc.getMap<Y.Map<unknown>>("nodes"),
      alpha.doc.getMap<Y.Map<unknown>>("edges"),
      alpha.doc.getMap<unknown>("deleted"),
    );
    audit();
    audit();
    audit();
    expect(
      alphaUpdates,
      "the auditor keeps re-writing `on:false` over a released record: a permanent delta stream that no state assertion can see",
    ).toBe(0);

    // BETA now receives everything alpha ever produced — the quarantine, the
    // repair and the release, all at once — and audits with the same rule.
    Y.applyUpdate(beta.doc, Y.encodeStateAsUpdate(alpha.doc), "remote");
    audit();
    audit();

    let betaUpdates = 0;
    beta.doc.on("update", () => {
      betaUpdates += 1;
    });
    audit();
    audit();
    audit();
    expect(
      betaUpdates,
      "the receiving replica keeps writing after ingesting another client's finished repair — the two clients wake each other forever",
    ).toBe(0);

    expect(
      serializeCanvas(
        beta.doc.getMap<Y.Map<unknown>>("nodes"),
        beta.doc.getMap<Y.Map<unknown>>("edges"),
        beta.doc.getMap<unknown>("deleted"),
      ),
      "the two replicas disagree about the file after the whole cycle",
    ).toBe(alphaFile);

    alpha.cs.destroy();
    beta.cs.destroy();
  });
});
