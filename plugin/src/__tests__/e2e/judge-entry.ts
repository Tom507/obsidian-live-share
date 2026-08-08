// WP124 — THE HEADLESS JUDGE BRIDGE (`S179`).
//
// WHY THIS FILE EXISTS AT ALL
// ---------------------------
// WP123 gave `ExpectedContent` a `records` clause, but the thing that has to be
// proven now is a *driver* property: that `tools/e2e/ls_records.py` sends a
// records expectation and refuses to score a round green when the rig did not
// judge it. That property is only worth anything if it is measured against the
// REAL oracle — a python test that asserts a python driver against a python fake
// of the rig proves that the author's idea of the rig is self-consistent, which
// is not the question.
//
// So this entry boots the PRODUCTION control server (`createControlServer` from
// `src/testing/e2e-control.ts`) on an EPHEMERAL 127.0.0.1 port and prints the
// port it bound. The python driver then POSTs `/command` exactly as it does to a
// live Obsidian instance. Everything from the HTTP envelope through
// `parseAndRoute` -> `routeCommand` -> `judgeConvergence` -> `parseCanvasReport`
// is the real, shipped code path.
//
// WHAT IS A DOUBLE HERE, STATED RATHER THAN HIDDEN
// -----------------------------------------------
// The `host` object is empty. `convergence.judge` is a PURE case in
// `routeCommand` — it reads `args` and calls `judgeConvergence`, and touches no
// member of `E2EControlHost` — so this bridge answers that one command exactly
// as a live instance does, and answers EVERY OTHER COMMAND WRONG (a structured
// 400/`ok:false`, because the host method is absent). That is deliberate and it
// is asserted by the driver's own test as a positive control: a bridge that
// answered `session.info` would be a general-purpose fake and nothing measured
// through it would mean anything.
//
// This file is launcher-only. It is never imported by `main.ts`, so it stays out
// of the production bundle exactly as `launch-entry.ts` does, and it is not a
// `*.test.ts` so vitest does not collect it.
//
// Runtime: bundled to ESM by esbuild and run with node — see
// `tools/e2e/judge_bridge.py`, which owns the bundling and the lifecycle.
//
// Protocol with the python side, deliberately minimal:
//   stdout  `JUDGE_BRIDGE_PORT <n>` once, when the socket is bound
//   stdin   closing stdin shuts the server down and exits 0 (so an abandoned
//           python process can never leave a listener behind)

import { createControlServer, type E2EControlHost } from "../../testing/e2e-control";

/**
 * The empty host. See the header: `convergence.judge` reads none of it, and
 * every other command failing structurally is the property that keeps this
 * bridge honest rather than a fake rig.
 */
const host = {} as unknown as E2EControlHost;

function main(): void {
  const raw = process.env.LS_JUDGE_BRIDGE_PORT;
  const requested = raw === undefined ? 0 : Number(raw);
  const port = Number.isFinite(requested) && requested >= 0 ? requested : 0;

  const handle = createControlServer(host, {
    port,
    onListening: (bound: number) => {
      process.stdout.write(`JUDGE_BRIDGE_PORT ${bound}\n`);
    },
  });

  let closed = false;
  const shutdown = (code: number): void => {
    if (closed) return;
    closed = true;
    try {
      handle.close();
    } finally {
      process.exit(code);
    }
  };

  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  // The owner of this process is the python driver. When it goes away, so does
  // the listener — an orphaned control port is exactly the failure US6 AC6 named.
  process.stdin.on("end", () => shutdown(0));
  process.stdin.on("close", () => shutdown(0));
  process.stdin.resume();
}

main();
