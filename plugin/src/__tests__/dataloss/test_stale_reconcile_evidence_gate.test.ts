// D1/D2/D3 — the data-loss chain that destroyed `hello.md` and `second.canvas`
// from a real vault on 2026-08-05.
//
// The E2E suite (`H:\tmp\liveshare_dataloss_e2e.py`) reproduces the incident
// against two live Obsidian instances and is the primary oracle. These unit
// tests exist for the half the E2E rig CANNOT reach any more: once D1 is fixed,
// a lone instance is told by the server that it is the host and promotes, so the
// "session with no host" state is no longer reachable by restarting anything.
// That is the desired outcome — and it would leave D2/D3 pinned by nothing but
// D1's correctness, i.e. by a single point of failure in front of an
// irreversible operation. These tests pin the evidence gate directly, so the
// deletion rule stays enforced even if the role machinery regresses.
//
// The subject is `ManifestManager`'s publication attestation, which is the whole
// of the new evidence: `cleanupStaleFiles` is a straight-line consumer of
// `hasFreshPublication()` plus a live-host peer, and the attestation is the part
// with the interesting states.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { ManifestManager } from "../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../types";

function settings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return { ...DEFAULT_SETTINGS, clientId: "me", sharedFolder: "shared", ...overrides };
}

function vault() {
  return {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
  };
}

/**
 * A ManifestManager wired to a real `Y.Doc`, connected through the real
 * `connect()` so the freshness baseline is taken exactly as it is in production.
 * `preexisting` is written BEFORE connecting — it stands for whatever the relay
 * replays at a peer that has just arrived.
 */
async function connected(preexisting?: { hostId: string; seq: number }) {
  const doc = new Y.Doc();
  if (preexisting) {
    doc.getMap("meta").set("publication", { ...preexisting, publishedAt: 1 });
  }
  const manager = new ManifestManager(vault() as never, settings());
  const sync = {
    getDoc: () => ({ doc, text: doc.getText("content"), awareness: {} }),
    waitForSync: async () => {},
    releaseDoc: vi.fn(),
  };
  await manager.connect(sync as never);
  return { manager, doc };
}

/** What a remote host publishing looks like from this peer's point of view. */
function remotePublish(doc: Y.Doc, hostId: string, seq: number) {
  doc.getMap("meta").set("publication", { hostId, seq, publishedAt: Date.now() });
}

describe("D2 — the manifest publication attestation is the evidence gate", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("a room nobody ever published in offers no evidence", async () => {
    const { manager } = await connected();
    expect(manager.getPublication()).toBeNull();
    expect(manager.hasFreshPublication("me")).toBe(false);
  });

  it("THE INCIDENT: a stale attestation replayed by the relay is not evidence", async () => {
    // This is the exact state vault B was in. A previous session's host had
    // published; the relay replayed both the entries and (now) the attestation;
    // no host was alive. Before the fix the entries alone licensed deletion,
    // because a non-empty map read as "the host says this is everything".
    const { manager } = await connected({ hostId: "the-old-host", seq: 7 });
    expect(manager.getPublication()?.seq).toBe(7);
    expect(manager.hasFreshPublication("me")).toBe(false);
  });

  it("a live host publishing after we connected IS evidence", async () => {
    const { manager, doc } = await connected({ hostId: "the-old-host", seq: 7 });
    remotePublish(doc, "a-live-host", 8);
    expect(manager.hasFreshPublication("me")).toBe(true);
  });

  it("a republication at the SAME seq is not evidence", async () => {
    // Guards against a host that rewrites the attestation without advancing it,
    // and against any replay that re-delivers the value we baselined on.
    const { manager, doc } = await connected({ hostId: "h", seq: 7 });
    remotePublish(doc, "h", 7);
    expect(manager.hasFreshPublication("me")).toBe(false);
  });

  it("a peer cannot be its own witness", async () => {
    // A peer that published (because it was, or believed it was, the host) must
    // not then read its own attestation as proof that somebody else is alive.
    const { manager, doc } = await connected({ hostId: "h", seq: 7 });
    remotePublish(doc, "me", 8);
    expect(manager.hasFreshPublication("me")).toBe(false);
    expect(manager.hasFreshPublication("someone-else")).toBe(true);
  });

  it("a malformed attestation is refused rather than trusted", async () => {
    const { manager, doc } = await connected();
    for (const junk of [null, {}, { hostId: "h" }, { seq: 9 }, { hostId: 5, seq: 9 }]) {
      doc.getMap("meta").set("publication", junk as never);
      expect(manager.getPublication()).toBeNull();
      expect(manager.hasFreshPublication("me")).toBe(false);
    }
    // …and a well-formed one after the junk is still accepted.
    remotePublish(doc, "h", 1);
    expect(manager.hasFreshPublication("me")).toBe(true);
  });

  it("connecting re-baselines, so a reconnect cannot inherit the old freshness", async () => {
    const { manager, doc } = await connected({ hostId: "h", seq: 7 });
    remotePublish(doc, "h", 8);
    expect(manager.hasFreshPublication("me")).toBe(true);

    const sync = {
      getDoc: () => ({ doc, text: doc.getText("content"), awareness: {} }),
      waitForSync: async () => {},
      releaseDoc: vi.fn(),
    };
    await manager.connect(sync as never);
    expect(manager.hasFreshPublication("me")).toBe(false);
    remotePublish(doc, "h", 9);
    expect(manager.hasFreshPublication("me")).toBe(true);
  });

  it("publishing writes the attestation, advances seq, and stamps the publisher", async () => {
    const { manager } = await connected({ hostId: "someone", seq: 41 });
    await manager.publishManifest({ purge: true });
    const pub = manager.getPublication();
    expect(pub?.seq).toBe(42);
    expect(pub?.hostId).toBe("me");
    expect(typeof pub?.publishedAt).toBe("number");
  });

  it("the attestation lands in the SAME transaction as the entries it vouches for", async () => {
    // A peer must never observe a purged entry set without the statement that
    // vouches for it — that ordering reads as "the host says these files are
    // gone" for a purge nobody attested. One transaction makes it impossible.
    const { manager, doc } = await connected();
    const seen: Array<{ files: boolean; meta: boolean }> = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => {
      const touched = Array.from(tr.changed.keys()).map((t) =>
        // biome-ignore lint/suspicious/noExplicitAny: reading the internal type tag
        (t as any)._item === null ? (doc.share.get("files") === t ? "files" : "meta") : "other",
      );
      if (touched.length > 0) {
        seen.push({ files: touched.includes("files"), meta: touched.includes("meta") });
      }
    });
    await manager.publishManifest({ purge: true });
    // With no shared files there is nothing to write to `files`, so the only
    // assertion available is the one that matters: the attestation never arrives
    // in a transaction of its own that a `files` write is still pending behind.
    expect(seen.length).toBe(1);
    expect(seen[0]?.meta).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * S115 — THE DIMENSION THIS FIXTURE WAS MISSING.
 *
 * Every assertion above is about whether the reconcile MAY run. None is about
 * what it SELECTS once it does, and the two are independent: the gate can be
 * perfectly correct while the candidate set is the guest's entire vault.
 *
 * The omission was invisible here for a structural reason worth recording.
 * `settings()` at the top of this file hardcodes `sharedFolder: "shared"` — the
 * SAFE value, matching the notional host. The dangerous value is the shipped
 * default, `""`, which means "the whole vault"; it was never in the fixture, so
 * no green in this file could ever have failed for the S115 reason. The scope
 * is added HERE, beside the attestation, because it now IS part of the
 * attestation: the same `meta` write, the same transaction, the same freshness
 * rule. The end-to-end selection behaviour — the `trashFile` loop actually
 * executing — lives in
 * `../v2/ux01/test_s115_stale_reconcile_is_scoped_by_the_host.test.ts`, which
 * drives the real `cleanupStaleFiles`; this file's subject stays
 * `ManifestManager`.
 */
describe("S115 — the attestation states the scope the entry set describes", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("publishing states the publisher's shared folder alongside the entries", async () => {
    const { manager } = await connected({ hostId: "someone", seq: 41 });
    await manager.publishManifest({ purge: true });
    // `settings()` above sets `sharedFolder: "shared"`, so that is what a host
    // running this fixture governs — and now says so.
    expect(manager.getPublication()?.sharedRoot).toBe("shared");
  });

  it("the scope a consumer reads is the HOST's, never this peer's own setting", async () => {
    // The whole defect in one assertion. This peer's `sharedFolder` is
    // "shared" (the fixture's hardcoded value); the host published "elsewhere".
    // A consumer must answer "elsewhere". Under the old code there was nothing
    // to answer with, and the reconcile used "shared".
    const { manager, doc } = await connected();
    doc.getMap("meta").set("publication", {
      hostId: "a-live-host",
      seq: 1,
      publishedAt: Date.now(),
      sharedRoot: "elsewhere",
    });
    const scope = manager.getHostSharedScope();
    expect(scope.known).toBe(true);
    expect(scope.root).toBe("elsewhere");
    expect(scope.root).not.toBe("shared");
  });

  it("a host that states no scope is FRESH but unknown — the two never merge", async () => {
    // An older host. Freshness must be unaffected: that peer is alive and has
    // published, and every behaviour keyed on liveness must keep working. Only
    // the destructive question answers "I don't know".
    const { manager, doc } = await connected({ hostId: "h", seq: 7 });
    remotePublish(doc, "a-live-host", 8); // the pre-S115 shape: no `sharedRoot`
    expect(manager.hasFreshPublication("me")).toBe(true);
    const scope = manager.getHostSharedScope();
    expect(scope.known).toBe(false);
    expect(scope.root).toBeNull();
  });

  it("a whitespace-only shared folder is published trimmed, not as a scope matching nothing", async () => {
    // S114's value, one hop further out. `"  "` is truthy, so an untrimmed
    // value would cross the wire and build the prefix `"   /"` at the consumer
    // — a stated scope that matches no path in any vault.
    const doc = new Y.Doc();
    const manager = new ManifestManager(vault() as never, settings({ sharedFolder: "   " }));
    const sync = {
      getDoc: () => ({ doc, text: doc.getText("content"), awareness: {} }),
      waitForSync: async () => {},
      releaseDoc: vi.fn(),
    };
    await manager.connect(sync as never);
    await manager.publishManifest({ purge: true });
    expect(manager.getPublication()?.sharedRoot).toBe("");
    expect(manager.getHostSharedScope()).toEqual({ known: true, root: "" });
  });

  it("a malformed sharedRoot is refused rather than coerced", async () => {
    // Same discipline `getPublication` applies to `hostId`/`seq`. A non-string
    // here is a host this peer cannot understand, and `""` — the coercion a
    // `String(x)` or a `?? ""` would produce — means THE ENTIRE VAULT.
    const { manager, doc } = await connected();
    for (const junk of [5, null, {}, ["shared"], true]) {
      doc.getMap("meta").set("publication", {
        hostId: "h",
        seq: 1,
        publishedAt: 1,
        sharedRoot: junk,
      } as never);
      const scope = manager.getHostSharedScope();
      expect(scope.known).toBe(false);
      expect(scope.root).toBeNull();
    }
  });
});
