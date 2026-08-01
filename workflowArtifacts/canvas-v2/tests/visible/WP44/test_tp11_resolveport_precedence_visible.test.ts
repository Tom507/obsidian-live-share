// WP44 / AC4 — `resolvePort` keeps its existing precedence, unchanged.
//
// The precedence is frozen (T3_SharedContract §4):
//   1. process.env.LIVESHARE_E2E, numeric      → that port
//   2. loose setting `e2eControlPort`          → number or numeric string
//   3. truthy non-numeric env                  → 0 (ephemeral)
//   4. otherwise                               → null, the server never listens
//
// `resolvePort` is private, so it is exercised through the only exported thing
// that depends on it — `maybeStartE2EControlServer` — and the oracle is the
// state that matters to the rig: WHICH port answers a `session.info` command.
// The listening log line is used only to learn the ephemeral port; the assertion
// is always a live request/response.
//
//   ├── T1 numeric env wins and binds exactly that port.
//   ├── T2 numeric env beats a differing setting — and nothing binds the setting.
//   ├── T3 the setting binds when there is no env flag (number and numeric string).
//   ├── T4 the setting beats a truthy non-numeric env (order 2 above order 3).
//   └── T5 a truthy non-numeric env alone binds an ephemeral port (order 3).
//
// Data safety: this suite binds loopback sockets only. It reads no vault, no
// settings file and no Obsidian state.

import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type E2EPluginLike,
  maybeStartE2EControlServer,
} from "../../../testing/e2e-control";

const LISTENING_RE = /listening on 127\.0\.0\.1:(\d+)/;
const PROBE_TIMEOUT_MS = 4000; // failure guard only; never waited for on success

const openHandles: { close(): void }[] = [];
const savedEnv = process.env.LIVESHARE_E2E;

afterEach(() => {
  while (openHandles.length > 0) openHandles.pop()?.close();
  if (savedEnv === undefined) delete process.env.LIVESHARE_E2E;
  else process.env.LIVESHARE_E2E = savedEnv;
  vi.restoreAllMocks();
});

function fakePlugin(extra: Record<string, unknown> = {}): E2EPluginLike {
  return {
    settings: {
      clientId: "e2e-a",
      roomId: "fixture-room",
      role: "host",
      ...extra,
    } as E2EPluginLike["settings"],
    muxConnected: true,
    controlConnected: true,
    canvasSync: null,
  };
}

/** An unused loopback port: bind ephemerally, read the number, release it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Start the control server and resolve once it reports the port it bound. */
function startAndAwaitBind(plugin: E2EPluginLike): Promise<number> {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(
      () => reject(new Error("control server never reported a bound port")),
      PROBE_TIMEOUT_MS,
    );
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const match = LISTENING_RE.exec(String(args[0] ?? ""));
      if (!match) return;
      clearTimeout(guard);
      spy.mockRestore();
      resolve(Number(match[1]));
    });
    openHandles.push(maybeStartE2EControlServer(plugin));
  });
}

/** POST /command → the parsed body, proving a real control server owns the port. */
function sessionInfo(port: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ cmd: "session.info" });
    const req = net.createConnection({ port, host: "127.0.0.1" }, () => {
      req.write(
        `POST /command HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n` +
          `Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`,
      );
    });
    const chunks: Buffer[] = [];
    req.setTimeout(PROBE_TIMEOUT_MS, () => req.destroy(new Error("control request timed out")));
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("error", reject);
    req.on("close", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (err) {
        reject(new Error(`no JSON control response on ${port}: ${String(err)}`));
      }
    });
  });
}

/** True when nothing at all accepts a connection on the port. */
function isRefused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    sock.setTimeout(PROBE_TIMEOUT_MS, () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => resolve(true));
  });
}

describe("WP44 AC4 — resolvePort precedence, observed through the control server", () => {
  it("binds the numeric LIVESHARE_E2E port (order 1)", async () => {
    const port = await freePort();
    process.env.LIVESHARE_E2E = String(port);

    const bound = await startAndAwaitBind(fakePlugin());

    expect(bound).toBe(port);
    expect(await sessionInfo(port)).toEqual({
      ok: true,
      result: { clientId: "e2e-a", role: "host", roomId: "fixture-room", connected: true },
    });
  });

  it("the numeric env beats the setting, and the setting's port stays free", async () => {
    const envPort = await freePort();
    const settingPort = await freePort();
    expect(settingPort).not.toBe(envPort);
    process.env.LIVESHARE_E2E = String(envPort);

    const bound = await startAndAwaitBind(fakePlugin({ e2eControlPort: settingPort }));

    expect(bound).toBe(envPort);
    expect(await isRefused(settingPort)).toBe(true);
  });

  it("binds the setting when no env flag is set — as a number and as a numeric string", async () => {
    delete process.env.LIVESHARE_E2E;

    const numberPort = await freePort();
    expect(await startAndAwaitBind(fakePlugin({ e2eControlPort: numberPort }))).toBe(numberPort);
    expect(await sessionInfo(numberPort)).toMatchObject({ ok: true });

    const stringPort = await freePort();
    expect(await startAndAwaitBind(fakePlugin({ e2eControlPort: String(stringPort) }))).toBe(
      stringPort,
    );
    expect(await sessionInfo(stringPort)).toMatchObject({ ok: true });
  });

  it("the setting beats a truthy non-numeric env (order 2 above order 3)", async () => {
    const settingPort = await freePort();
    process.env.LIVESHARE_E2E = "yes";

    const bound = await startAndAwaitBind(fakePlugin({ e2eControlPort: settingPort }));

    expect(bound).toBe(settingPort);
    expect(await sessionInfo(settingPort)).toMatchObject({ ok: true });
  });

  it("a truthy non-numeric env with no setting binds an ephemeral port (order 3)", async () => {
    process.env.LIVESHARE_E2E = "on";

    const bound = await startAndAwaitBind(fakePlugin());

    expect(bound).toBeGreaterThan(0);
    expect(await sessionInfo(bound)).toMatchObject({ ok: true });
  });
});
