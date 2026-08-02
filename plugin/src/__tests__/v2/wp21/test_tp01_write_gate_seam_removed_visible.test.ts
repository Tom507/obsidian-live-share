// WP21 / AC1 — "`canWriteEntity` and its baseline-hold behaviour no longer
// exist; no capture path consults a lock before writing, and no code path holds
// a diff baseline because a write was denied."
//
// THIS IS A REMOVAL, SO THE ORACLE IS ABSENCE.
//
// The gate is default-allow (`() => true` until injected), which means the
// behaviour of an UNWIRED `CanvasSync` is identical before and after the
// deletion. A purely behavioural test therefore cannot see this AC at all: the
// only thing that changes is that there is no longer a seam for `main.ts` to
// inject a denial through. That claim is falsifiable in exactly two places, and
// both are checked here:
//
//   ├── the INSTANCE surface — `setCanWriteNode` / `setCanDeleteNode` are gone
//   │      from `CanvasSync`, so no caller can hand it a lock predicate, and
//   └── the SOURCE of the two files the charter names, scanned the way this repo
//          already scans `main.ts` for file-level claims (`v2/wp5v2/
//          test_tp07_wiring_only_visible.test.ts`, `canvas-single-writer.test.ts`).
//
// The scan is DISCRIMINATING, not a blanket "the word is gone": every assertion
// that something must be absent is paired with one that a NEIGHBOUR must still
// be present. `setCanWrite` (WP21 AC3 — authorisation, not locking),
// `setOnLocalNodeChange` (the diff-inferred lock CLAIM, which is UX and stays
// per AC2) and WP18's `rejected` signature list all sit inside the same few
// lines as the deleted code, and an over-deletion that took one of them with it
// is the single most likely way this WP goes wrong.

import { readFileSync } from "node:fs";

import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { CanvasSync } from "../../../files/canvas-sync";

const CANVAS_SYNC_SOURCE = readFileSync(
  new URL("../../../files/canvas-sync.ts", import.meta.url),
  "utf8",
);
const MAIN_SOURCE = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");

/** Strip comments so a scan reads CODE, not prose (the wp5v2 precedent). */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CANVAS_SYNC_CODE = codeOf(CANVAS_SYNC_SOURCE);
const MAIN_CODE = codeOf(MAIN_SOURCE);

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

function makeCanvasSync(): CanvasSync {
  return new CanvasSync(createVault() as never, createSyncManager() as never, {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  } as never);
}

describe("WP21 AC1 — the lock write-denial seam is gone from CanvasSync", () => {
  it("no per-node write gate can be injected, while the neighbouring seams survive", () => {
    const cs = makeCanvasSync();
    const surface = cs as unknown as Record<string, unknown>;

    expect(
      typeof surface.setCanWriteNode,
      "`CanvasSync.setCanWriteNode` still exists — main.ts can still inject a lock write-gate",
    ).toBe("undefined");
    expect(
      typeof surface.setCanDeleteNode,
      "`CanvasSync.setCanDeleteNode` still exists — a lock can still deny a local delete",
    ).toBe("undefined");

    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(cs) as object);
    expect(proto, "the write-gate setter is still on the prototype").not.toContain(
      "setCanWriteNode",
    );
    expect(proto, "the delete-gate setter is still on the prototype").not.toContain(
      "setCanDeleteNode",
    );

    // The over-deletion guard: three seams that live in the same few lines and
    // must NOT have been taken with the gate.
    expect(
      typeof surface.setCanWrite,
      "AC3: the read-only permission seam was deleted along with the lock gate",
    ).toBe("function");
    expect(
      typeof surface.setOnLocalNodeChange,
      "AC2: the diff-inferred lock CLAIM hook was deleted — locks no longer acquire from a save",
    ).toBe("function");
    expect(
      typeof surface.setSurfaceStateProvider,
      "the WP5 surface-state seam was deleted along with the lock gate",
    ).toBe("function");

    cs.destroy();
  });

  it("canvas-sync.ts holds no canWriteEntity, no lock predicate and no LOCK DENIED emitter", () => {
    expect(
      CANVAS_SYNC_SOURCE,
      "`canWriteEntity` is still named in canvas-sync.ts — the removal is incomplete",
    ).not.toMatch(/\bcanWriteEntity\b/);
    expect(
      CANVAS_SYNC_SOURCE,
      "the `LOCK DENIED:` signature can still be emitted — the baseline hold is still reachable",
    ).not.toContain("LOCK DENIED:");

    expect(
      CANVAS_SYNC_CODE,
      "canvas-sync.ts still declares or calls a `canWriteNode` lock predicate",
    ).not.toMatch(/\bcanWriteNode\b/);
    expect(
      CANVAS_SYNC_CODE,
      "canvas-sync.ts still declares or calls a `canDeleteNode` lock predicate",
    ).not.toMatch(/\bcanDeleteNode\b/);
    expect(
      CANVAS_SYNC_CODE,
      "the applied-intent `denied` list survives — a write can still be recorded as denied",
    ).not.toMatch(/\bdenied\b/);

    // Neighbours that must survive the deletion.
    expect(
      CANVAS_SYNC_CODE,
      "AC3: `setCanWrite` (read-only permission) was deleted with the lock gate",
    ).toMatch(/\bsetCanWrite\s*\(/);
    expect(
      CANVAS_SYNC_CODE,
      "AC2: `onLocalNodeChange` (the lock claim from a local diff) was deleted with the gate",
    ).toMatch(/\bonLocalNodeChange\b/);
    expect(
      CANVAS_SYNC_CODE,
      "WP18's rejection-signature list was deleted along with the denial list",
    ).toMatch(/\brejected\b/);
  });

  it("main.ts wires no per-node lock gate on either capture path", () => {
    expect(
      MAIN_CODE,
      "main.ts still injects a lock write-gate into CanvasSync",
    ).not.toMatch(/setCanWriteNode\s*\(/);
    expect(MAIN_CODE, "main.ts still injects a lock delete-gate into CanvasSync").not.toMatch(
      /setCanDeleteNode\s*\(/,
    );
    expect(
      MAIN_CODE,
      "the binding-side mirror `canWriteNode:` is still handed to CanvasBinding",
    ).not.toMatch(/\bcanWriteNode\s*:/);
    expect(
      MAIN_CODE,
      "the binding-side mirror `canDeleteNode:` is still handed to CanvasBinding",
    ).not.toMatch(/\bcanDeleteNode\s*:/);

    // AC3 + AC2 neighbours in the very same wiring block.
    expect(MAIN_CODE, "AC3: main.ts no longer injects the read-only guard").toMatch(
      /setCanWrite\s*\(/,
    );
    expect(MAIN_CODE, "AC3: `canWriteCanvasPath` was deleted from main.ts").toMatch(
      /\bcanWriteCanvasPath\b/,
    );
    expect(
      MAIN_CODE,
      "AC3: the binding no longer receives the read-only guard (`canWrite:`)",
    ).toMatch(/\bcanWrite\s*:/);
    expect(
      MAIN_CODE,
      "AC2: the diff-inferred lock claim wiring was deleted from main.ts",
    ).toMatch(/setOnLocalNodeChange\s*\(/);
    expect(MAIN_CODE, "AC2: the loser's view revert was deleted from main.ts").toMatch(
      /\brevertCanvasNode\b/,
    );
  });
});
