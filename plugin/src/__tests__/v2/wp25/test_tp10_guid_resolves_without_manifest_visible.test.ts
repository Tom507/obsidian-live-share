// WP25 — the ORDERING RISK WP27 NAMED, and the reason `sidecar: null` is not an
// acceptable way to close the wiring gap.
//
// `ImplementationReport_WP27.md` Escalation 2, verbatim in substance: *"wiring
// manifest-only would drop a guest that subscribes before the host's manifest
// entry has replicated into the R10 raw-text fallback — with no automatic retry.
// That is a worse production state than the path-keyed status quo."*
//
// That is an ORDERING claim about two asynchronous publications — the manifest
// entry replicating from the host, and the local `index.json` written by this
// client's previous session — and it has a discriminating pair:
//
//   ├── manifest EMPTY + index.json HAS the mapping
//   │      wired with the sidecar   → the guid resolves, the canvas is owned
//   │      wired with `sidecar:null`→ resolves NOTHING, the guest falls through
//   │                                 to `backgroundSync.subscribe` (R10) and
//   │                                 never comes back
//   └── manifest EMPTY + index.json EMPTY
//          BOTH wirings fall through, which is correct: with no mapping
//          anywhere, minting on the guest is the two-document defect.
//
// The second row is what stops this being a test that merely prefers one wiring:
// it pins that the sidecar does not paper over a genuinely unresolvable path.
//
// `CanvasIdentityStore.unbind` has no clean spelling either — WP27's
// `Pick<ManifestManager, "getCanvasGuid" | "setCanvasGuid">` exposes only
// `setCanvasGuid`, so a BLANK guid is how the mapping is cleared. That is
// load-bearing and undocumented outside the report, so it is pinned here.
//
// PRODUCTION LINE ↔ ASSERTION: reddened by `wireCanvasSidecar` constructing
// `createCanvasIdentityStore({ manifest, sidecar: null })`, and by any
// resolution order that consults only the manifest.

import { describe, expect, it, vi } from "vitest";

import { createSidecarStore } from "../../../files/canvas-sidecar";
import {
  createSidecarLifecycle,
  createVaultSidecarIO,
  wireCanvasSidecar,
} from "../../../files/canvas-sidecar-lifecycle";
import {
  CANVAS_DOC_PREFIX,
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
} from "../../../files/canvas-sync";
import { subscribeCanvasWithHandover } from "../../../files/vault-events";
import {
  CANVAS_PATH,
  FIXED_GUID,
  NODE_A,
  canvasJson,
  createDataAdapter,
  createFileOps,
  createManifest,
  createSyncManager,
  createTrace,
  createVault,
} from "./harness";

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

function fakeBackgroundSync() {
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  return {
    subscribed,
    unsubscribed,
    unsubscribe: vi.fn((path: string) => {
      unsubscribed.push(path);
    }),
    subscribe: vi.fn(async (path: string) => {
      subscribed.push(path);
    }),
  };
}

/** A guest whose manifest has not yet received the host's entry. */
async function guestWithSidecarIndex(seedIndex: boolean) {
  const trace = createTrace();
  const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
  const sync = createSyncManager(trace);
  const manifest = await createManifest(vault, sync);
  const adapter = createDataAdapter();
  const io = createVaultSidecarIO(adapter);
  if (seedIndex) {
    await createSidecarStore(io).writeIndex({ [FIXED_GUID]: CANVAS_PATH });
  }
  const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
  const wiring = wireCanvasSidecar({ canvasSync: canvasSync as never, manifest, io });
  // The premise of the whole scenario: the host's entry has NOT replicated.
  expect(manifest.getCanvasGuid(CANVAS_PATH)).toBeFalsy();
  return { trace, vault, sync, manifest, io, canvasSync, wiring };
}

describe("WP25 — a guest resolves the guid offline, before the manifest replicates", () => {
  it("the sidecar index alone is enough: the canvas is owned, not text-fallback", async () => {
    const { sync, canvasSync, wiring } = await guestWithSidecarIndex(true);
    const backgroundSync = fakeBackgroundSync();

    const owned = await subscribeCanvasWithHandover({
      path: CANVAS_PATH,
      role: "guest",
      backgroundSync: backgroundSync as never,
      canvasSync,
    });
    await settle();

    expect(owned, "the guest dropped to the raw-text fallback").toBe(true);
    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);
    expect(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toContain(
      canvasDocId(FIXED_GUID),
    );
    expect(
      backgroundSync.subscribed,
      "the R10 text fallback was installed over a canvas we could resolve",
    ).toEqual([]);

    await wiring.lifecycle.destroy();
    canvasSync.destroy();
  });

  it("MANIFEST-ONLY wiring drops the same guest into R10, and never retries", async () => {
    // The control that gives the test above its meaning. Identical fixture, one
    // difference: the identity store has no sidecar. This is exactly the wiring
    // WP27 refused to ship, and this is what it costs.
    const trace = createTrace();
    const vault = createVault({ [CANVAS_PATH]: canvasJson([NODE_A]) });
    const sync = createSyncManager(trace);
    const manifest = await createManifest(vault, sync);
    const io = createVaultSidecarIO(createDataAdapter());
    await createSidecarStore(io).writeIndex({ [FIXED_GUID]: CANVAS_PATH });

    const canvasSync = new CanvasSync(vault as never, sync as never, createFileOps() as never);
    canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: null }));
    const backgroundSync = fakeBackgroundSync();

    const owned = await subscribeCanvasWithHandover({
      path: CANVAS_PATH,
      role: "guest",
      backgroundSync: backgroundSync as never,
      canvasSync,
    });
    await settle();

    expect(owned).toBe(false);
    expect(canvasSync.isSubscribed(CANVAS_PATH)).toBe(false);
    expect(backgroundSync.subscribed).toEqual([CANVAS_PATH]);
    // "No automatic retry": nothing re-arms. A second identical attempt is only
    // possible because a caller made it, and it still fails the same way.
    expect(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([]);

    canvasSync.destroy();
  });

  it("with NO mapping anywhere, a guest still opens nothing — the sidecar is not a mint", async () => {
    // The other half of the pair. If the sidecar path made an unresolvable guest
    // succeed, it would be minting, and minting on a guest is the two-document
    // defect: a healthy converging doc that the peer's healthy converging doc
    // can never meet.
    const { sync, canvasSync, wiring } = await guestWithSidecarIndex(false);
    const backgroundSync = fakeBackgroundSync();

    const owned = await subscribeCanvasWithHandover({
      path: CANVAS_PATH,
      role: "guest",
      backgroundSync: backgroundSync as never,
      canvasSync,
    });
    await settle();

    expect(owned).toBe(false);
    expect(canvasSync.getCanvasGuid(CANVAS_PATH)).toBeNull();
    expect(sync.requested.filter((id) => id.startsWith(CANVAS_DOC_PREFIX))).toEqual([]);
    expect(backgroundSync.subscribed).toEqual([CANVAS_PATH]);

    await wiring.lifecycle.destroy();
    canvasSync.destroy();
  });

  it("a HOST with no mapping mints, and publishes to both stores", async () => {
    // The role split, which is what makes "the guest opens nothing" safe: the
    // host is the one client entitled to name a board nobody has named yet, and
    // it must leave the name where the next guest will find it.
    const { manifest, canvasSync, wiring } = await guestWithSidecarIndex(false);

    await canvasSync.subscribe(CANVAS_PATH, "host");
    await settle();

    const guid = canvasSync.getCanvasGuid(CANVAS_PATH);
    expect(guid).toMatch(/^[0-9a-f]{32}$/);
    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBe(guid);
    expect(await wiring.store.readIndex()).toEqual({ [guid as string]: CANVAS_PATH });

    await wiring.lifecycle.destroy();
    canvasSync.destroy();
  });

  it("a resolved guid is REPUBLISHED to the manifest, so the next peer need not wait", async () => {
    // The offline resolution is not just for this client. Once the sidecar has
    // answered, the mapping goes back into the manifest, which is what makes the
    // R10 window close instead of recurring every session.
    const { manifest, canvasSync, wiring } = await guestWithSidecarIndex(true);

    await canvasSync.subscribe(CANVAS_PATH, "guest");
    await settle();

    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);

    await wiring.lifecycle.destroy();
    canvasSync.destroy();
  });

  it("unbind's only spelling is a BLANK guid, and it clears without deleting the entry", async () => {
    // Recorded in `ImplementationReport_WP27.md` and nowhere in the code's
    // signature: `CanvasIdentityStore.unbind` can only reach the manifest
    // through `setCanvasGuid`, so it clears with `""`. A future refactor that
    // "tidies" that into a delete removes the entry itself and takes the file's
    // manifest row with it.
    const { manifest, wiring } = await guestWithSidecarIndex(true);

    manifest.setCanvasGuid(CANVAS_PATH, FIXED_GUID);
    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBe(FIXED_GUID);

    await wiring.identityStore.unbind(CANVAS_PATH);

    expect(manifest.getCanvasGuid(CANVAS_PATH)).toBeFalsy();
    expect(
      manifest.getEntries().has(CANVAS_PATH),
      "unbind removed the manifest ENTRY, not just its guid",
    ).toBe(true);
    expect(await wiring.store.readIndex()).toEqual({});

    await wiring.lifecycle.destroy();
  });
});
