// WP72 / C72 AC1 (blind set 1) — "a control command cannot rewrite the borrowed
// settings file".
//
// ANGLE (different mechanism from the visible set): the visible test calls the
// host method and the router with already-parsed objects, and detects persistence
// by a *silent* `saveSettings` that writes. Here nothing is called directly at
// all — every command arrives as a RAW JSON BODY through `parseAndRoute`, exactly
// the bytes an off-host driver puts on the wire — and the plugin's `saveSettings`
// is made LOUD in two independent ways at once: it corrupts the file with a poison
// payload AND throws. A thrown persistence call cannot hide: `routeCommand`'s
// catch turns it into a structured 400, so the command's own status code becomes
// a second, wholly independent detector alongside the sha256. The sweep then
// drives EVERY key of a realistic settings shape, not a representative subset.
//
// WOULD REDDEN IF: `setFlag` (or `clearFlags`, or the router on its way to them)
// reached `plugin.saveSettings` by any path — the response would become a 400
// carrying the poison marker, `saveCalls` would be non-zero, and the file's
// sha256 would move. It also reddens if the `persist` refusal is softened into a
// silently-ignored argument (the refusal assertions), or if the refusal starts
// reaching the host before refusing (the `setFlag` call counter).
//
// DATA SAFETY: sha256-of-bytes only. The file below is a throwaway created in the
// OS temp dir with deliberately non-secret placeholder contents; no real vault and
// no real `data.json` is opened, read, printed or fixtured.
//
// Staging: copy into `plugin/src/__tests__/wp72blind1/` (→ `../../testing/...`).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type CommandResult,
  type E2EControlHost,
  type E2EPluginLike,
  buildPluginHost,
  parseAndRoute,
} from "../../testing/e2e-control";

/** sha256 over the file's BYTES. Never over, and never revealing, its content. */
function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * A realistic settings shape — every canvas-relevant key the gate touches, plus
 * the hidden port key and a credential-SHAPED key name. Every value here is an
 * obvious placeholder invented for this test; nothing was copied from any vault.
 * The credential-shaped name is present precisely to show that even the keys the
 * borrow exists to protect do not move the file.
 */
const LOADED: Record<string, unknown> = {
  clientId: "blind1-client",
  roomId: "blind1-room",
  role: "host",
  serverUrl: "ws://127.0.0.1:1234",
  sharedFolder: "_e2e-rig",
  useCanvasBinding: false,
  showCanvasPresence: true,
  showCanvasCursors: true,
  debug: false,
  e2eControlPort: 0,
  encryptionPassphrase: "PLACEHOLDER-NOT-A-SECRET",
};

const POISON = '{"poisoned":"a persistence call reached the borrowed file"}';

let dir: string;
let dataJson: string;

interface Fixture {
  plugin: E2EPluginLike;
  settings: Record<string, unknown>;
  host: E2EControlHost;
  saveCalls: () => number;
}

/**
 * `saveSettings` here is deliberately hostile: it destroys the file and then
 * throws. Both halves matter — the write makes the sha256 oracle able to fail,
 * and the throw makes the *status code* of whichever command reached it able to
 * fail, so neither detector depends on the other.
 */
function fixture(): Fixture {
  let calls = 0;
  const settings: Record<string, unknown> = { ...LOADED };
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {
      calls += 1;
      writeFileSync(dataJson, POISON, "utf8");
      throw new Error("AC1_VIOLATION: saveSettings reached from the control surface");
    },
    canvasSync: null,
  } as unknown as E2EPluginLike;

  // Seed the "borrowed" file WITHOUT going through the hostile writer.
  writeFileSync(dataJson, JSON.stringify(LOADED, null, 2), "utf8");

  const host = buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
  return { plugin, settings, host, saveCalls: () => calls };
}

/** The error text of a `{ok:false}` body, or `""`. */
function errorOf(body: CommandResult): string {
  return body.ok === false ? body.error : "";
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wp72-b1-"));
  dataJson = join(dir, "data.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("WP72 AC1 blind1 — raw wire bodies, and a persistence call that cannot hide", () => {
  it("every key of the settings shape, one raw body each: no 400, no save, no byte moved", async () => {
    const f = fixture();
    const before = sha256OfFile(dataJson);

    const statuses: number[] = [];
    for (const name of Object.keys(LOADED)) {
      const raw = JSON.stringify({
        cmd: "canvas.setFlag",
        args: { name, value: `overridden-${name}` },
      });
      const out = await parseAndRoute(f.host, raw);
      statuses.push(out.status);
      // A persistence call would surface HERE, as its own error text.
      expect(errorOf(out.body)).not.toContain("AC1_VIOLATION");
    }

    // Every one of them succeeded — the sweep is not passing because the router
    // rejected the lot before reaching the branch under test.
    expect(statuses).toEqual(Object.keys(LOADED).map(() => 200));
    expect(f.saveCalls()).toBe(0);
    expect(sha256OfFile(dataJson)).toBe(before);
    // ...and the in-memory effect really did happen for every key.
    for (const name of Object.keys(LOADED)) {
      expect(f.settings[name]).toBe(`overridden-${name}`);
    }
  });

  it("the reversal command is on the same wire and is just as silent", async () => {
    const f = fixture();
    const before = sha256OfFile(dataJson);

    await parseAndRoute(
      f.host,
      '{"cmd":"canvas.setFlag","args":{"name":"roomId","value":"elsewhere"}}',
    );
    await parseAndRoute(f.host, '{"cmd":"canvas.setFlag","args":{"name":"newFlag","value":7}}');
    const cleared = await parseAndRoute(f.host, '{"cmd":"canvas.clearFlags"}');

    expect(cleared.status).toBe(200);
    expect(errorOf(cleared.body)).not.toContain("AC1_VIOLATION");
    expect(f.saveCalls()).toBe(0);
    expect(sha256OfFile(dataJson)).toBe(before);
  });

  it("value payloads a naive implementation might treat specially still write nothing", async () => {
    const f = fixture();
    const before = sha256OfFile(dataJson);

    const payloads: string[] = [
      '{"cmd":"canvas.setFlag","args":{"name":"roomId","value":null}}',
      '{"cmd":"canvas.setFlag","args":{"name":"useCanvasBinding","value":{"deep":{"deeper":[1,2,3]}}}}',
      '{"cmd":"canvas.setFlag","args":{"name":"sharedFolder","value":["a","b","c"]}}',
      '{"cmd":"canvas.setFlag","args":{"name":"debug","value":"() => require(\'fs\')"}}',
      '{"cmd":"canvas.setFlag","args":{"name":"e2eControlPort","value":65535}}',
      '{"cmd":"canvas.setFlag","args":{"name":"encryptionPassphrase","value":"still-not-a-secret"}}',
    ];
    for (const raw of payloads) {
      const out = await parseAndRoute(f.host, raw);
      expect(out.status).toBe(200);
    }

    expect(f.saveCalls()).toBe(0);
    expect(sha256OfFile(dataJson)).toBe(before);
  });

  it("`persist` is refused in EVERY JSON form it can take, and never reaches the host", async () => {
    const f = fixture();
    // Count host arrivals independently of the file: I11 REFUSAL NEVER DESTROYS
    // means the refusal happens before anything can half-apply.
    let hostCalls = 0;
    const counted: E2EControlHost = {
      ...f.host,
      setFlag: (name: string, value: unknown) => {
        hostCalls += 1;
        return f.host.setFlag(name, value);
      },
    };

    const before = sha256OfFile(dataJson);
    // `undefined` is not representable in JSON, so this is genuinely every form a
    // wire caller can send. All of them are refused: the behaviour is REMOVED,
    // not gated, so there is no value of the argument that switches it on or off.
    const forms = ["true", "false", "0", "1", '""', '"no"', "null", "[]", "{}"];
    for (const form of forms) {
      const raw = `{"cmd":"canvas.setFlag","args":{"name":"roomId","value":"x","persist":${form}}}`;
      const out = await parseAndRoute(counted, raw);
      expect(out.status).toBe(400);
      expect(errorOf(out.body)).toContain("refused:");
      expect(errorOf(out.body)).toContain("persistence-requires-file-write");
    }

    expect(hostCalls).toBe(0);
    expect(f.settings.roomId).toBe(LOADED.roomId);
    expect(f.saveCalls()).toBe(0);
    expect(sha256OfFile(dataJson)).toBe(before);
  });

  it("FALSIFICATION: both detectors really do fire when persistence is reached", async () => {
    const f = fixture();
    const before = sha256OfFile(dataJson);

    // Detector 1 — the file. Detector 2 — the status code and error text of a
    // command that reached it. Neither can be satisfied vacuously.
    expect(() => f.plugin.saveSettings?.()).toThrow(/AC1_VIOLATION/);
    expect(f.saveCalls()).toBe(1);
    expect(sha256OfFile(dataJson)).not.toBe(before);

    // A host whose `setFlag` DOES persist — the pre-WP72 shape, re-created by
    // hand — turns the wire response into a 400 naming the violation. That is
    // the exact signal the sweep above asserts never appears.
    const clobbering: E2EControlHost = {
      ...f.host,
      setFlag: (name: string, value: unknown) => {
        const r = f.host.setFlag(name, value);
        f.plugin.saveSettings?.();
        return r;
      },
    };
    const out = await parseAndRoute(
      clobbering,
      '{"cmd":"canvas.setFlag","args":{"name":"roomId","value":"x"}}',
    );
    expect(out.status).toBe(400);
    expect(errorOf(out.body)).toContain("AC1_VIOLATION");
  });
});
