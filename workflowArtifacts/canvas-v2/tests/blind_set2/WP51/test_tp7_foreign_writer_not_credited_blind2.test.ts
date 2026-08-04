// WP51 AC2 — blind set 2 (attribution).
//
// Angle: two instances and one shared folder, which is what the gate run
// actually is. Vault A saves; vault B's copy of `lan-vault-sync` then
// propagates its own serialisation into the same file. Each instance is asked
// separately, and each must answer for ITSELF: A must not claim B's bytes, and
// B must not claim A's.
//
// The failure this guards against is an attribution keyed on "did the digest
// change since I last looked", which gives both instances a green answer for a
// single write by one of them — a two-vault run that looks converged because one
// side saved twice.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  type CanvasSaveChannelLike,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const PATH = "_e2e-rig/e2e-scratch-20260803T134500Z-b2-two.canvas";
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const BYTES_A = '{"nodes":[{"id":"n1","x":10}],"edges":[]}';
const BYTES_B = '{"nodes":[{"id":"n1","x":10}],"edges":[],"meta":{"from":"b"}}';

/** One shared folder, seen by both vaults. */
const sharedVault = () => new Map<string, string>([[PATH, '{"nodes":[],"edges":[]}']]);

/**
 * One instance over the shared folder. `onSave` is the instance's OWN save
 * behaviour: it decides what (if anything) reaches disk, and returns the bytes
 * the instance handed to Obsidian's writer.
 */
function instance(files: Map<string, string>, id: string, onSave: () => string) {
  const channel: CanvasSaveChannelLike = {
    path: () => PATH,
    requestSave: async () => onSave(),
  };
  return buildPluginHost(
    {
      settings: { clientId: id, roomId: "canvas-v2-t3", role: id === "a" ? "host" : "guest" },
      canvasSync: null,
      app: {
        vault: {
          adapter: {
            exists: async (p: string) => files.has(p),
            read: async (p: string) => files.get(p) ?? "",
          },
        },
      },
      canvasSaveChannel: (p: string) => (p === PATH ? channel : null),
    } as unknown as E2EPluginLike,
    { counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 }, bump: () => {} },
  );
}

/** The normal case: Obsidian writes what the view holds. */
const writes = (files: Map<string, string>, bytes: string) => () => {
  files.set(PATH, bytes);
  return bytes;
};

async function save(host: ReturnType<typeof instance>) {
  const out = await routeCommand(host, { cmd: "canvas.save", args: { path: PATH } });
  expect(out.status).toBe(200);
  if (!out.body.ok) throw new Error(out.body.error);
  return out.body.result as {
    saved: boolean;
    sha256Before: string;
    sha256After: string;
    size: number;
    byInstance: boolean;
  };
}

describe("WP51 AC2 (blind2) — two instances, one file, separate attribution", () => {
  it("A saves, then B saves: each answers about its own write", async () => {
    const files = sharedVault();
    const ra = await save(instance(files, "a", writes(files, BYTES_A)));
    expect(ra.byInstance).toBe(true);
    expect(files.get(PATH)).toBe(BYTES_A);

    const rb = await save(instance(files, "b", writes(files, BYTES_B)));
    expect(rb.byInstance).toBe(true);
    expect(rb.sha256Before).toBe(sha(BYTES_A)); // it saw A's bytes going in
    expect(files.get(PATH)).toBe(BYTES_B);
  });

  it("B's propagation lands inside A's save window → A does not claim it", async () => {
    const files = sharedVault();
    const contested = await save(
      instance(files, "a", () => {
        files.set(PATH, BYTES_A); // A's own save
        files.set(PATH, BYTES_B); // lan-vault-sync reacts and lands last
        return BYTES_A;
      }),
    );
    expect(contested.byInstance).toBe(false);
    expect(contested.sha256After).toBe(sha(BYTES_B));
    expect(files.get(PATH)).toBe(BYTES_B);
  });

  it("asking A again after B wrote does not credit A for B's bytes", async () => {
    const files = sharedVault();
    await save(instance(files, "a", writes(files, BYTES_A)));
    await save(instance(files, "b", writes(files, BYTES_B)));

    // A is asked again, and Obsidian coalesces the save away: the channel runs
    // and reports A's bytes, but nothing reaches disk.
    const result = await save(instance(files, "a", () => BYTES_A));
    expect(files.get(PATH)).toBe(BYTES_B);
    expect(result.byInstance).toBe(false);
    expect(result.sha256Before).toBe(result.sha256After);
  });

  it("an idempotent re-save by the same instance is still its own", async () => {
    const files = sharedVault();
    await save(instance(files, "a", writes(files, BYTES_A)));
    const again = await save(instance(files, "a", writes(files, BYTES_A)));
    expect(again.sha256Before).toBe(again.sha256After);
    expect(again.byInstance).toBe(true);
  });

  it("`byInstance` never depends on whether the digest moved", async () => {
    const files = sharedVault();
    // Digest moved, wrong author → false.
    const moved = await save(
      instance(files, "a", () => {
        files.set(PATH, BYTES_B);
        return BYTES_A;
      }),
    );
    expect(moved.sha256Before).not.toBe(moved.sha256After);
    expect(moved.byInstance).toBe(false);

    // Digest unmoved, right author → true.
    const unmoved = await save(instance(files, "b", writes(files, BYTES_B)));
    expect(unmoved.sha256Before).toBe(unmoved.sha256After);
    expect(unmoved.byInstance).toBe(true);
  });

  it("both instances read the same file and report the same digests", async () => {
    const files = sharedVault();
    const ra = await save(instance(files, "a", writes(files, BYTES_A)));
    const rb = await save(instance(files, "b", writes(files, BYTES_B)));
    expect(ra.sha256After).toBe(sha(BYTES_A));
    expect(rb.sha256Before).toBe(ra.sha256After);
    expect(rb.sha256After).toBe(sha(BYTES_B));
    expect(rb.size).toBe(Buffer.byteLength(BYTES_B, "utf8"));
  });
});
