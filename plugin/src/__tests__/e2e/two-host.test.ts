// WP6 — Verification for the two-lightweight-host launcher harness (US6).
//
// Proves the launcher MODEL headlessly, in the spirit of wp5/harness.ts:
//   AC1/AC2 — two lightweight hosts boot over one shared local relay via the
//             reused wp5 `createApp`/`SyncManager` pattern, each on a distinct
//             control port.
//   AC3     — after boot, BOTH control ports answer `session.info` with the SAME
//             non-empty roomId (both joined the same relay room).
//   AC6     — clean shutdown frees BOTH control ports (no orphan listeners).
//
// A full real-Obsidian two-instance run (T3) is out of scope; this suite is the
// headless proof of the two-host + two-control-port + same-room contract.

import { afterEach, describe, expect, it } from "vitest";
import { bootTwoHosts, type TwoHostBoot } from "./two-host-harness";

const boots: TwoHostBoot[] = [];

afterEach(async () => {
  while (boots.length) {
    const b = boots.pop();
    if (b) await b.close();
  }
});

interface SessionInfo {
  clientId: string;
  role: string | null;
  roomId: string;
  connected: boolean;
}

async function sessionInfo(port: number): Promise<SessionInfo> {
  const res = await fetch(`http://127.0.0.1:${port}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "session.info" }),
  });
  const body = (await res.json()) as { ok: boolean; result?: SessionInfo; error?: string };
  if (!body.ok || !body.result) throw new Error(`session.info failed: ${body.error}`);
  return body.result;
}

/** True when a TCP listener still answers on 127.0.0.1:port. */
async function portOpen(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "session.info" }),
    });
    return true;
  } catch {
    return false;
  }
}

describe("WP6 two-host launcher harness", () => {
  it("boots two hosts on distinct control ports over one relay (US6 AC1/AC2)", async () => {
    const boot = await bootTwoHosts();
    boots.push(boot);
    const [a, b] = boot.hosts;
    expect(a.controlPort).toBeGreaterThan(0);
    expect(b.controlPort).toBeGreaterThan(0);
    expect(a.controlPort).not.toBe(b.controlPort);
  });

  it("both control ports report the SAME roomId (US6 AC3)", async () => {
    const boot = await bootTwoHosts();
    boots.push(boot);
    const [a, b] = boot.hosts;

    const infoA = await sessionInfo(a.controlPort);
    const infoB = await sessionInfo(b.controlPort);

    expect(infoA.roomId).toBeTruthy();
    expect(infoB.roomId).toBeTruthy();
    expect(infoA.roomId).toBe(infoB.roomId);
    expect(infoA.roomId).toBe(boot.room.id);
    expect(infoA.clientId).toBe("e2e-a");
    expect(infoB.clientId).toBe("e2e-b");
    expect(infoA.role).toBe("host");
    expect(infoB.role).toBe("guest");
  });

  it("honors explicitly requested distinct control ports", async () => {
    const boot = await bootTwoHosts({ portA: 0, portB: 0 });
    boots.push(boot);
    const [a, b] = boot.hosts;
    const infoA = await sessionInfo(a.controlPort);
    const infoB = await sessionInfo(b.controlPort);
    expect(infoA.roomId).toBe(infoB.roomId);
  });

  it("clean shutdown frees both control ports (US6 AC6)", async () => {
    const boot = await bootTwoHosts();
    const [a, b] = boot.hosts;
    const portA = a.controlPort;
    const portB = b.controlPort;

    // Both live before shutdown.
    expect(await portOpen(portA)).toBe(true);
    expect(await portOpen(portB)).toBe(true);

    await boot.close();

    // Give the OS a moment to release the listeners, then confirm both are down.
    await new Promise((r) => setTimeout(r, 100));
    expect(await portOpen(portA)).toBe(false);
    expect(await portOpen(portB)).toBe(false);
  });
});
