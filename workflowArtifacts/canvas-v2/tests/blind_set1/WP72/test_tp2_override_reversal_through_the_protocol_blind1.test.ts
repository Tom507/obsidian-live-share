// WP72 / C72 AC2 (blind set 1) — "an in-memory settings override is explicitly
// scoped to the session and is reversible".
//
// ANGLE (different mechanism from the visible set): the visible test names the
// keys it checks, one `expect` per key. Here the oracle is the WHOLE settings
// object plus its KEY LIST: after the reversal, `{...settings}` must deep-equal
// the loaded snapshot and `Object.keys(settings)` must equal the loaded key list
// *in order*. That is a strictly stronger statement than any per-key check — it
// catches a key the reversal forgot, a key it invented, a key left holding
// `undefined`, and a key deleted-and-reinserted (which changes insertion order) —
// none of which a named-key assertion can see. Everything is driven over
// `parseAndRoute` raw bodies rather than the host method.
//
// It also pins the two traps the charter §5 names:
//   ├── the journal must capture the LOADED value, not the previous override
//   └── the reversal must itself never persist
// and one the visible set does not reach: a key that did NOT exist before must
// leave no trace at all — not a key holding `undefined`.
//
// WOULD REDDEN IF: the journal re-captured the prior value on every `setFlag`
// (the whole-object compare, and the two-cycle case); if `clearFlags` restored
// by `delete` + reassign (the key-ORDER assertion); if an unknown name were
// written into `settings` as `undefined`; if `clearFlags` gained a
// `saveSettings` call; or if the journal outlived `clearFlags` or the host.
//
// DATA SAFETY: sha256-of-bytes only, over a throwaway temp file with obviously
// non-secret contents. No vault is touched.
//
// Staging: copy into `plugin/src/__tests__/wp72blind1/` (→ `../../testing/...`).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type CommandResult,
  type E2EFileControlHost,
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
} from "../../testing/e2e-control";

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Note `maybeUnset`: a key that EXISTS on the loaded object while holding
 * `undefined`. It is the one shape that tells "restore the prior value" apart
 * from "delete the key", and no per-key equality check can distinguish them.
 */
const LOADED: Record<string, unknown> = {
  clientId: "blind1-client",
  roomId: "blind1-room",
  role: "host",
  serverUrl: "ws://127.0.0.1:1234",
  sharedFolder: "_e2e-rig",
  useCanvasBinding: false,
  showCanvasPresence: true,
  maybeUnset: undefined,
};

const LOADED_KEYS = Object.keys(LOADED);

let dir: string;
let dataJson: string;
let saveCalls: number;

interface Fixture {
  plugin: E2EPluginLike;
  settings: Record<string, unknown>;
  newHost: () => E2EFileControlHost;
}

function fixture(): Fixture {
  const settings: Record<string, unknown> = { ...LOADED };
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {
      saveCalls += 1;
      writeFileSync(dataJson, JSON.stringify(settings, null, 2), "utf8");
    },
    canvasSync: null,
  } as unknown as E2EPluginLike;
  writeFileSync(dataJson, JSON.stringify(LOADED, null, 2), "utf8");
  return {
    plugin,
    settings,
    newHost: () =>
      buildPluginHost(plugin, {
        counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
        bump: () => {},
      }),
  };
}

function resultOf<T>(body: CommandResult): T {
  if (body.ok !== true) throw new Error(`expected ok:true, got ${JSON.stringify(body)}`);
  return body.result as T;
}

async function setFlag(
  host: E2EFileControlHost,
  name: string,
  value: unknown,
): Promise<{ status: number; body: CommandResult }> {
  return parseAndRoute(host, JSON.stringify({ cmd: "canvas.setFlag", args: { name, value } }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wp72-b1c-"));
  dataJson = join(dir, "data.json");
  saveCalls = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("WP72 AC2 blind1 — the whole object comes back, over the protocol", () => {
  it("twenty interleaved overrides, then one clearFlags: object and key order identical", async () => {
    const f = fixture();
    const host = f.newHost();

    // A fixed, interleaved schedule — the same key overridden repeatedly, with
    // other keys touched in between, which is exactly the traffic pattern that
    // breaks a journal that recaptures.
    const schedule: Array<[string, unknown]> = [
      ["roomId", "r1"],
      ["useCanvasBinding", true],
      ["roomId", "r2"],
      ["sharedFolder", "s1"],
      ["showCanvasPresence", false],
      ["roomId", "r3"],
      ["useCanvasBinding", false],
      ["clientId", "c1"],
      ["sharedFolder", "s2"],
      ["maybeUnset", "now-set"],
      ["roomId", "r4"],
      ["role", "guest"],
      ["serverUrl", "ws://127.0.0.1:9999"],
      ["useCanvasBinding", true],
      ["clientId", "c2"],
      ["maybeUnset", 0],
      ["sharedFolder", "s3"],
      ["showCanvasPresence", true],
      ["role", null],
      ["roomId", "r5"],
    ];
    for (const [name, value] of schedule) {
      expect((await setFlag(host, name, value)).status).toBe(200);
    }
    // The overrides really landed — the reversal below is undoing something.
    expect(f.settings.roomId).toBe("r5");
    expect(f.settings.maybeUnset).toBe(0);

    const out = await parseAndRoute(host, '{"cmd":"canvas.clearFlags"}');
    expect(out.status).toBe(200);
    const restored = resultOf<{ restored: string[]; cleared: string[] }>(out.body);
    expect([...restored.restored].sort()).toEqual([
      "clientId",
      "maybeUnset",
      "role",
      "roomId",
      "serverUrl",
      "sharedFolder",
      "showCanvasPresence",
      "useCanvasBinding",
    ]);
    expect(restored.cleared).toEqual([]);

    // The whole object, and the key list in order. Nothing added, nothing lost,
    // nothing left as `undefined`-by-accident, nothing re-inserted.
    expect({ ...f.settings }).toStrictEqual({ ...LOADED });
    expect(Object.keys(f.settings)).toEqual(LOADED_KEYS);
    // `maybeUnset` came back as PRESENT-with-undefined, not as deleted.
    expect("maybeUnset" in f.settings).toBe(true);
    expect(f.settings.maybeUnset).toBe(undefined);
  });

  it("the journal is emptied by the reversal, not replayed: a second cycle restores the loaded value", async () => {
    const f = fixture();
    const host = f.newHost();

    await setFlag(host, "roomId", "cycle-1");
    await parseAndRoute(host, '{"cmd":"canvas.clearFlags"}');
    expect(f.settings.roomId).toBe(LOADED.roomId);

    // If `clearFlags` had left the journal in place, this second override would
    // capture nothing and the second reversal would be a no-op — or worse, the
    // first cycle's record would still name `cycle-1` as the prior value.
    await setFlag(host, "roomId", "cycle-2");
    expect(f.settings.roomId).toBe("cycle-2");
    const out = await parseAndRoute(host, '{"cmd":"canvas.clearFlags"}');
    expect(resultOf<{ restored: string[] }>(out.body).restored).toEqual(["roomId"]);
    expect(f.settings.roomId).toBe(LOADED.roomId);
    expect({ ...f.settings }).toStrictEqual({ ...LOADED });
  });

  it("a name that is not a settings key leaves the object byte-for-byte alone, before and after", async () => {
    const f = fixture();
    const host = f.newHost();

    const snapshot = { ...f.settings };
    for (const name of ["madeUpFlag", "canvasStale", "staleView", "roomID", "RoomId"]) {
      expect((await setFlag(host, name, "whatever")).status).toBe(200);
    }
    // Not created, and — the sharper half — not created as `undefined` either.
    expect(Object.keys(f.settings)).toEqual(LOADED_KEYS);
    expect({ ...f.settings }).toStrictEqual(snapshot);

    const out = await parseAndRoute(host, '{"cmd":"canvas.clearFlags"}');
    const r = resultOf<{ restored: string[]; cleared: string[] }>(out.body);
    expect(r.restored).toEqual([]);
    expect([...r.cleared].sort()).toEqual(["RoomId", "canvasStale", "madeUpFlag", "roomID", "staleView"]);
    expect(Object.keys(f.settings)).toEqual(LOADED_KEYS);
    expect({ ...f.settings }).toStrictEqual(snapshot);
  });

  it("the override does not survive the instance — two hosts hold two independent journals", () => {
    const f = fixture();

    // h1 sees the LOADED value as prior; h2, built later, sees h1's override as
    // prior. That ordering is the observable form of "scoped to the session":
    // a journal that outlived its host would make these two indistinguishable.
    const h1 = f.newHost();
    h1.setFlag("roomId", "from-h1");
    const h2 = f.newHost();
    h2.setFlag("roomId", "from-h2");
    expect(f.settings.roomId).toBe("from-h2");

    expect(h2.clearFlags()).toEqual({ restored: ["roomId"], cleared: [] });
    expect(f.settings.roomId).toBe("from-h1");

    expect(h1.clearFlags()).toEqual({ restored: ["roomId"], cleared: [] });
    expect(f.settings.roomId).toBe(LOADED.roomId);
    expect({ ...f.settings }).toStrictEqual({ ...LOADED });

    // And a third host, which overrode nothing, can reverse nothing.
    expect(f.newHost().clearFlags()).toEqual({ restored: [], cleared: [] });
  });

  it("the reversal is itself in-memory only: clearFlags never persists", async () => {
    const f = fixture();
    const host = f.newHost();
    const before = sha256OfFile(dataJson);

    await setFlag(host, "roomId", "overridden");
    await setFlag(host, "useCanvasBinding", true);
    await setFlag(host, "madeUpFlag", 1);
    await parseAndRoute(host, '{"cmd":"canvas.clearFlags"}');
    await parseAndRoute(host, '{"cmd":"canvas.clearFlags"}'); // idempotent second run

    expect(saveCalls).toBe(0);
    expect(sha256OfFile(dataJson)).toBe(before);

    // AC2's sharpest clause, reached from the other side: because the reversal
    // happened IN MEMORY, a later unrelated persistence writes the borrowed
    // state back, byte for byte.
    f.plugin.saveSettings?.();
    expect(saveCalls).toBe(1);
    expect(sha256OfFile(dataJson)).toBe(before);
  });

  it("FALSIFICATION: the same oracle moves when the reversal is skipped", async () => {
    const f = fixture();
    const host = f.newHost();
    const before = sha256OfFile(dataJson);

    await setFlag(host, "roomId", "left-poisoned");
    // `canvas.clearFlags` deliberately NOT sent. The unrelated persistence now
    // writes the OVERRIDE. If this sha256 did not move, the check in the test
    // above would be unfalsifiable and would prove nothing.
    f.plugin.saveSettings?.();
    expect(saveCalls).toBe(1);
    expect(sha256OfFile(dataJson)).not.toBe(before);
  });
});
