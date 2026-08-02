// WP20 AC4 blind1 — the signatures have to be attributable PER RECORD.
//
// "Each quarantine/release emits a distinct signature" is a per-EVENT claim, and
// the cheapest way to satisfy the visible test is a per-PASS summary line: one
// "n record(s) quarantined" and one "n record(s) released". Those are distinct
// strings and they even name the ids. They are also useless for the only thing
// an operator ever does with this narration — take one id out of a bug report
// and find out what happened to it — and they collapse entirely when the two
// events happen in the SAME pass, which is the situation here.
//
// Two records are quarantined together; later one is repaired while the other is
// not, so the release pass is a pass in which one record changed state and
// another did not. The assertions:
//
//   ├── every quarantined id is named by a signature line in the pass that
//   │      quarantined it,
//   ├── the released id is named by a signature line in the pass that released
//   │      it, and that line is not one of the quarantine lines,
//   └── the id that did NOT change state is not the subject of a release line —
//          the narration reports events, not inventory.
//
// State is asserted first throughout; the signature is a human's aid, never the
// oracle. The exact wording is not pinned, only the established
// `<NAME> signature: …` shape this file already uses everywhere.

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
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "audit-log.canvas";

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
  const warns: string[] = [];
  const cs = new CanvasSync(
    vault as never,
    syncManager as never,
    { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() } as never,
  );
  cs.setLogger({ debug: () => {}, warn: (_c: string, message: string) => warns.push(message) });
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

function signaturesFor(lines: readonly string[], id: string): string[] {
  return lines.filter((line) => /\bsignature:/.test(line) && line.includes(id));
}

describe("WP20 AC4 blind1 — each record's quarantine and release are narrated for that record", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("names both quarantined records, then names only the one it released", async () => {
    const client = await auditingClient(PATH);
    const deleted = client.doc.getMap<unknown>("deleted");
    const push = makePeer(client.doc);

    push((peer) => {
      const space = peer.getMap<Y.Map<unknown>>("nodes");
      space.set(
        "well",
        record({
          id: "well",
          type: "text",
          pos: encodePos(0, 0),
          size: encodeSize(200, 100),
          text: "fine",
        }),
      );
      // Two `link` nodes with no `url`.
      space.set(
        "shortlived",
        record({ id: "shortlived", type: "link", pos: encodePos(300, 0), size: encodeSize(200, 100) }),
      );
      space.set(
        "persistent",
        record({ id: "persistent", type: "link", pos: encodePos(600, 0), size: encodeSize(200, 100) }),
      );
    });

    client.warns.length = 0;
    audit();
    const raisePass = [...client.warns];

    for (const id of ["shortlived", "persistent"]) {
      expect(
        isTombstoneQuarantined(readTombstoneEntry(deleted, id)),
        `${id} was not quarantined, so there is nothing to narrate`,
      ).toBe(true);
      expect(
        signaturesFor(raisePass, id).length,
        `the quarantine of ${id} was not narrated by any '<NAME> signature: …' line naming it; the pass logged: ${JSON.stringify(raisePass)}`,
      ).toBeGreaterThan(0);
    }
    expect(
      signaturesFor(raisePass, "well"),
      "a healthy record was named in a quarantine signature",
    ).toEqual([]);

    // Settle, then repair exactly one of the two.
    audit();
    client.warns.length = 0;
    push((peer) => {
      peer
        .getMap<Y.Map<unknown>>("nodes")
        .get("shortlived")
        ?.set("url", "https://example.invalid/found");
    });
    audit();
    const releasePass = [...client.warns];

    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "shortlived")),
      "the repaired record was not released, so there is nothing to narrate",
    ).toBe(false);
    expect(
      isTombstoneQuarantined(readTombstoneEntry(deleted, "persistent")),
      "the still-broken record was released as well",
    ).toBe(true);

    const releaseLines = signaturesFor(releasePass, "shortlived");
    expect(
      releaseLines.length,
      `the release of shortlived was not narrated; the pass logged: ${JSON.stringify(releasePass)}`,
    ).toBeGreaterThan(0);
    expect(
      releaseLines.filter((line) => raisePass.includes(line)),
      "the release re-emitted a quarantine line verbatim — the two events are not distinct",
    ).toEqual([]);
    expect(
      signaturesFor(releasePass, "persistent"),
      "the record that did not change state was narrated anyway — the signature reports inventory, not events",
    ).toEqual([]);

    client.cs.destroy();
  });
});
