// WP6 — Long-lived launcher entry (US6).
//
// Boots two lightweight plugin hosts (A + B) on distinct control ports against a
// single local relay, prints both control ports + the shared roomId, then stays
// alive until Ctrl-C / SIGTERM and shuts BOTH hosts down cleanly (frees ports).
//
// Runtime: this file is bundled to ESM by esbuild (see tools/launch_liveshare_e2e.py)
// and run with `node`. It is test/launcher-only and is NEVER imported by main.ts,
// so it stays out of the production `main.js` bundle (US7).
//
// Env knobs (all optional):
//   LIVESHARE_E2E_PORT_A   control port for host A          (default 39421)
//   LIVESHARE_E2E_PORT_B   control port for host B          (default 39422)
//   LIVESHARE_RELAY_PORT   connect to an EXISTING local relay on this port
//                          instead of booting one in-process
//   LIVESHARE_ROOM_NAME    relay room name                  (default auto)

import { bootTwoHosts, type TwoHostBoot } from "./two-host-harness";

function intEnv(name: string, dflt: number): number {
  const raw = process.env[name];
  if (!raw) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

async function main(): Promise<void> {
  const portA = intEnv("LIVESHARE_E2E_PORT_A", 39421);
  const portB = intEnv("LIVESHARE_E2E_PORT_B", 39422);
  const relayEnv = process.env.LIVESHARE_RELAY_PORT;
  const externalRelayPort = relayEnv ? Number(relayEnv) : undefined;
  const roomName = process.env.LIVESHARE_ROOM_NAME;

  const boot: TwoHostBoot = await bootTwoHosts({
    portA,
    portB,
    externalRelayPort:
      typeof externalRelayPort === "number" && Number.isFinite(externalRelayPort)
        ? externalRelayPort
        : undefined,
    roomName,
  });

  const [a, b] = boot.hosts;
  const relayMode = boot.relay ? "in-process" : `external :${boot.relayPort}`;

  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      "=== liveshare-e2e two-host launcher (WP6) =============================",
      `  relay          : ${relayMode} (127.0.0.1:${boot.relayPort})`,
      `  room id        : ${boot.room.id}`,
      `  host A control : http://127.0.0.1:${a.controlPort}   (clientId=${a.clientId}, role=${a.role})`,
      `  host B control : http://127.0.0.1:${b.controlPort}   (clientId=${b.clientId}, role=${b.role})`,
      "",
      "  Drive via the liveshare-e2e MCP:",
      `    e2e_connect(a={host:"127.0.0.1",port:${a.controlPort}}, b={host:"127.0.0.1",port:${b.controlPort}})`,
      "    open_canvas(path=\"board.canvas\") -> edit(...) -> assert_converged / run_matrix",
      "",
      "  Press Ctrl-C to stop (frees both control ports).",
      "======================================================================",
      "",
    ].join("\n"),
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`\n[launcher] ${signal} received — shutting down both hosts...`);
    boot
      .close()
      .then(() => {
        // eslint-disable-next-line no-console
        console.log("[launcher] both control ports freed. bye.");
        process.exit(0);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[launcher] shutdown error:", err);
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep the event loop alive even if all sockets were somehow idle.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[launcher] failed to start:", err);
  process.exit(1);
});
