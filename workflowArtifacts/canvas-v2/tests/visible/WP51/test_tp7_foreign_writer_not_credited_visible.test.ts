// WP51 / C51 AC2 — the oracle must tell "the instance saved" apart from "some
// other writer saved".
//
// This is not hypothetical — but the engine named here was originally the wrong
// one. CORRECTED 2026-08-04: `lan-vault-sync` is installed in both vaults and
// **not enabled**, so it cannot write anything. The enabled foreign writer is
// `obsidian-git`, with `autoPullOnBoot: true` over dirty work trees with
// `origin` remotes — a stronger case for this test, not a weaker one, because it
// fires at launch, before a gesture is even made. (The rig disables it for the
// duration of a gate run under WP70's reversible borrow; this test covers the
// class, and the class outlives that one mitigation.) A `canvas.save` whose
// oracle is "the file changed" credits the instance for a foreign write and
// produces a green demonstration of a save that never happened.
//
// The discrimination is byte equality — V2's own echo breaker — between what the
// instance handed to Obsidian's writer and what is on disk afterwards. No
// timing, no window, no sleep.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  type CanvasSaveChannelLike,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

const PATH = "_e2e-rig/e2e-scratch-20260803T101010Z-7-g.canvas";
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const INSTANCE_BYTES = JSON.stringify({ nodes: [{ id: "n1", x: 10, y: 0 }], edges: [] });
/** What a second sync engine puts on disk: same board, its own serialisation. */
const FOREIGN_BYTES = JSON.stringify({ nodes: [{ id: "n1", y: 0, x: 10 }], edges: [] }, null, "\t");

interface SaveBehaviour {
  /** Does the instance's own save actually write? (`false` = Obsidian coalesced it away.) */
  instanceWrites: boolean;
  /** Does `lan-vault-sync` land its own bytes in the same window? */
  foreignWrites: boolean;
}

function harness(seed: string, behaviour: SaveBehaviour) {
  const files = new Map<string, string>([[PATH, seed]]);
  let requested = 0;

  const channel: CanvasSaveChannelLike = {
    path: () => PATH,
    requestSave: async () => {
      requested++;
      if (behaviour.instanceWrites) files.set(PATH, INSTANCE_BYTES);
      // The foreign engine reacts to the same file event and lands last.
      if (behaviour.foreignWrites) files.set(PATH, FOREIGN_BYTES);
      // The instance always reports what IT handed to Obsidian's writer.
      return INSTANCE_BYTES;
    },
  };

  const plugin = {
    settings: { clientId: "e2e-a", roomId: "canvas-v2-t3", role: "host" },
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
  } as unknown as E2EPluginLike;

  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  return { host, files, requested: () => requested };
}

async function save(host: ReturnType<typeof harness>["host"]) {
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

describe("WP51 AC2 — a foreign writer is never credited to the instance", () => {
  it("instance writes, nobody else → byInstance:true", async () => {
    const { host, files } = harness("{}", { instanceWrites: true, foreignWrites: false });
    const result = await save(host);
    expect(result.byInstance).toBe(true);
    expect(result.sha256After).toBe(sha(INSTANCE_BYTES));
    expect(files.get(PATH)).toBe(INSTANCE_BYTES);
  });

  it("`lan-vault-sync` lands after the instance's save → byInstance:false", async () => {
    const { host, files } = harness("{}", { instanceWrites: true, foreignWrites: true });
    const result = await save(host);

    expect(files.get(PATH)).toBe(FOREIGN_BYTES);
    expect(result.sha256After).toBe(sha(FOREIGN_BYTES));
    expect(result.byInstance).toBe(false);
    // The file DID change — an oracle keyed on "the digest moved" would have
    // reported a successful instance save here. That is the defect.
    expect(result.sha256After).not.toBe(result.sha256Before);
  });

  it("only the foreign writer wrote → byInstance:false even though the file changed", async () => {
    // Obsidian coalesced the save away; the digest still moves, because someone
    // else moved it. `saved` may report that the channel was invoked, but
    // attribution must not.
    const { host } = harness("{}", { instanceWrites: false, foreignWrites: true });
    const result = await save(host);
    expect(result.sha256Before).not.toBe(result.sha256After);
    expect(result.byInstance).toBe(false);
  });

  it("the save was coalesced away and nobody else wrote → byInstance:false", async () => {
    const { host, files } = harness('{"nodes":[],"edges":[]}', {
      instanceWrites: false,
      foreignWrites: false,
    });
    const before = files.get(PATH);
    const result = await save(host);
    expect(files.get(PATH)).toBe(before);
    expect(result.sha256Before).toBe(result.sha256After);
    // Nothing failed loudly — the command returned 200 — but what is on disk is
    // NOT what the instance handed to the writer, so the demonstration has not
    // happened and must not be recorded as if it had.
    expect(result.byInstance).toBe(false);
  });

  it("an unmoved digest is not by itself a failure: an idempotent re-save still counts", async () => {
    // The bytes on disk already ARE what the instance saves. Byte equality is
    // the oracle (V2's echo breaker), so the honest answer is `true` — pretending
    // otherwise would make a correct re-issue of the command look like a defect.
    const { host } = harness(INSTANCE_BYTES, { instanceWrites: true, foreignWrites: false });
    const result = await save(host);
    expect(result.sha256Before).toBe(result.sha256After);
    expect(result.byInstance).toBe(true);
  });

  it("attribution is byte equality, not shape equality", async () => {
    // The two serialisations describe the SAME board and differ only in key order
    // and whitespace. Normalising them together is exactly how a second writer
    // becomes invisible (charter §3: an oracle never re-serialises or normalises).
    expect(JSON.parse(FOREIGN_BYTES)).toEqual(JSON.parse(INSTANCE_BYTES));
    expect(FOREIGN_BYTES).not.toBe(INSTANCE_BYTES);

    const { host } = harness("{}", { instanceWrites: true, foreignWrites: true });
    expect((await save(host)).byInstance).toBe(false);
  });

  it("an absent file before the save is reported honestly, not as an empty one", async () => {
    const files = new Map<string, string>();
    const channel: CanvasSaveChannelLike = {
      path: () => PATH,
      requestSave: async () => {
        files.set(PATH, INSTANCE_BYTES);
        return INSTANCE_BYTES;
      },
    };
    const plugin = {
      settings: { clientId: "e2e-a", roomId: "r", role: "host" },
      canvasSync: null,
      app: {
        vault: {
          adapter: {
            exists: async (p: string) => files.has(p),
            read: async (p: string) => files.get(p) ?? "",
          },
        },
      },
      canvasSaveChannel: () => channel,
    } as unknown as E2EPluginLike;
    const host = buildPluginHost(plugin, {
      counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
      bump: () => {},
    });

    const result = await save(host);
    expect(result.sha256Before).toBe(""); // absent ≠ empty (WP49 contract)
    expect(result.sha256After).toBe(sha(INSTANCE_BYTES));
    expect(result.byInstance).toBe(true);
  });
});
