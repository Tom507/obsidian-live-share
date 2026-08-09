// S147 — THE THROTTLED-TIMER TEST FACILITY.
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// Obsidian is Electron, and Chromium clamps timers in a BACKGROUNDED renderer.
// Measured live on this project's own three-vault rig (WP111/W4c), with 30
// chained `setTimeout(…, 0)` hops inside each renderer:
//
//   ├── foreground .................................  12 ms per hop
//   ├── ~1 min hidden ..............................  907 ms per hop
//   └── ~10 min hidden ............................. 9 004 ms per hop,
//         and a nominal `setTimeout(1000)` fired at 27 844 ms.
//
// The clamp GROWS the longer the window stays hidden, so no fixed timeout is
// long enough and no fixed hop count has a bounded cost. In the ordinary
// three-window setup ALL THREE renderers report `visibilityState: "hidden"` —
// merely stacking the windows is enough — so this is the state a real user runs
// in, not an edge case.
//
// The suite could not express any of that: its timers are punctual, which is
// the same coverage hole `S130` names for latency. A repair for this class that
// cannot be run under a clamp regresses unnoticed, because the only other
// instrument is a ten-minute live run with the windows hidden.
//
// WHAT IT MODELS, AND WHAT IT DELIBERATELY DOES NOT
// ---------------------------------------------------------------------------
//   ├── DOES  raise every `setTimeout` / `setInterval` delay to a FLOOR, which
//   │         is exactly Chromium's nested-timer clamp;
//   ├── DOES  optionally GROW that floor per clamped fire, which is the part
//   │         that makes "just use a longer timeout" not a fix;
//   ├── DOES  optionally perturb ORDER within a clamped tick, because under a
//   │         uniform floor two timers armed 50 ms apart land in the same tick
//   │         and code that is correct only because A's delay is shorter than
//   │         B's is broken there;
//   └── DOES NOT touch microtasks, promise resolution, or SOCKET DELIVERY.
//         Chromium does not throttle inbound frames, and that asymmetry IS the
//         defect class: message-driven work keeps running while timer-driven
//         work stops. A facility that slowed both would hide the very thing it
//         is built to show.
//
// SCOPING, AND WHY IT IS NOT OPTIONAL
// ---------------------------------------------------------------------------
// The patch is on the global, so an unscoped clamp would also slow vitest's own
// scheduler, undici's WebSocket internals and the in-process relay — the test
// would then measure the harness, not the subject. Every call is attributed to
// its CALL SITE from a captured stack and clamped only when that site matches
// `scope`. The default scope is this plugin's production source.
//
// PROVE THE INSTRUMENT BEFORE READING IT
// ---------------------------------------------------------------------------
// `S65`/`S113`/`S133`/`S112` are four separate occasions in this project where a
// reader that could not match its subject was quoted as a result. So the clamp
// counts what it clamped and WHERE, and {@link TimerClamp.assertClamped} fails
// loudly when nothing was clamped at all. A scenario that "passes under the
// clamp" without the clamp having fired is not a measurement.
//
// NOTE: not named `*.test.ts` on purpose — vitest must not collect it.

/** A single clamped call site, keyed by the frame that armed the timer. */
export interface ClampedSite {
  /** `file.ts:line:col` of the caller, as captured from the stack. */
  site: string;
  count: number;
  maxRequestedMs: number;
  maxAppliedMs: number;
}

export interface TimerClampStats {
  /** Timer arms seen by the wrapper, in scope or not. */
  seen: number;
  /** Timer arms whose delay this clamp actually raised. */
  clamped: number;
  /** Largest delay any in-scope caller ASKED for. */
  maxRequestedMs: number;
  /** Largest delay actually handed to the real timer. */
  maxAppliedMs: number;
  /** The floor as it stands now (it grows when `growthPerFireMs` is set). */
  floorMs: number;
  /** Per-call-site breakdown, most-clamped first. */
  sites: ClampedSite[];
}

export interface TimerClampOptions {
  /**
   * Every in-scope delay is raised to at least this. 907 ms is the measured
   * one-minute-hidden clamp; 9 004 ms is the ten-minute one. Tests normally use
   * something far smaller and rely on the RATIO, not the absolute number.
   */
  floorMs: number;
  /**
   * The clamp grows the longer a window stays hidden. Each clamped fire raises
   * the floor by this much, capped at `maxFloorMs`. Default 0 (a fixed clamp).
   */
  growthPerFireMs?: number;
  /** Ceiling for `growthPerFireMs`. Default `floorMs * 4`. */
  maxFloorMs?: number;
  /**
   * Deterministic ordering perturbation: 0..jitterMs is added after the floor,
   * from a seeded generator. Two timers armed close together therefore do NOT
   * reliably fire in arming order — which is what a real uniform clamp does to
   * code that relies on one delay being shorter than another.
   */
  jitterMs?: number;
  /** Seed for the jitter generator, so a failure is reproducible. Default 1. */
  seed?: number;
  /**
   * Which call sites are inside the backgrounded renderer. Matched against the
   * captured stack frame. Default: this plugin's production source.
   */
  scope?: RegExp;
}

export interface TimerClamp {
  stats(): TimerClampStats;
  /**
   * Rule 15 / `S113`: prove the instrument matched its subject before reading
   * anything it reports.
   *
   * @param minimum        how many arms must have been clamped
   * @param sitePattern    optional — at least one clamped site must match, so a
   *                       clamp that only ever hit some unrelated module cannot
   *                       be quoted as having throttled the subject.
   */
  assertClamped(minimum?: number, sitePattern?: RegExp): void;
  uninstall(): void;
}

const DEFAULT_SCOPE = /[\\/]src[\\/](files|sync|editor|session|canvas)[\\/]|[\\/]src[\\/]main\.ts/;

/** Deterministic 32-bit LCG. Reproducible ordering perturbation, never `Math.random`. */
function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * The frame that armed this timer, skipping the wrapper itself. Returns `""`
 * when no stack is available, which is treated as OUT of scope — an
 * unattributable arm is never clamped, so the facility can never silently
 * throttle something it cannot name.
 */
function callerFrame(): string {
  const stack = new Error("timer-clamp probe").stack;
  if (!stack) return "";
  const lines = stack.split("\n");
  // [0] is the message, [1] is `callerFrame`, [2] is the wrapper, [3] is the
  // real caller. Scan from [3] and take the first frame that is not this file.
  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.includes("timer-clamp.ts")) continue;
    return line.trim();
  }
  return "";
}

/** `path/file.ts:line:col`, or the raw frame when it does not parse. */
function shortSite(frame: string): string {
  const m = frame.match(/([^\s()/\\]+\.[cm]?[jt]s):(\d+):(\d+)/);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : frame || "<unattributed>";
}

export function installTimerClamp(options: TimerClampOptions): TimerClamp {
  const scope = options.scope ?? DEFAULT_SCOPE;
  const growth = options.growthPerFireMs ?? 0;
  const maxFloor = options.maxFloorMs ?? options.floorMs * 4;
  const jitterMs = options.jitterMs ?? 0;
  const nextJitter = lcg(options.seed ?? 1);

  let floorMs = options.floorMs;
  let seen = 0;
  let clamped = 0;
  let maxRequestedMs = 0;
  let maxAppliedMs = 0;
  const sites = new Map<string, ClampedSite>();

  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;

  function apply(requestedRaw: unknown): number {
    const requested = typeof requestedRaw === "number" && requestedRaw > 0 ? requestedRaw : 0;
    seen++;
    const frame = callerFrame();
    if (!frame || !scope.test(frame)) return requested;

    let applied = Math.max(requested, floorMs);
    if (jitterMs > 0) applied += Math.floor(nextJitter() * (jitterMs + 1));
    if (applied <= requested) return requested;

    clamped++;
    if (requested > maxRequestedMs) maxRequestedMs = requested;
    if (applied > maxAppliedMs) maxAppliedMs = applied;
    const key = shortSite(frame);
    const entry = sites.get(key) ?? {
      site: key,
      count: 0,
      maxRequestedMs: 0,
      maxAppliedMs: 0,
    };
    entry.count++;
    entry.maxRequestedMs = Math.max(entry.maxRequestedMs, requested);
    entry.maxAppliedMs = Math.max(entry.maxAppliedMs, applied);
    sites.set(key, entry);

    if (growth > 0 && floorMs < maxFloor) {
      floorMs = Math.min(maxFloor, floorMs + growth);
    }
    return applied;
  }

  // biome-ignore lint/suspicious/noExplicitAny: patching the platform global.
  const g = globalThis as any;
  g.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    realSetTimeout(handler as never, apply(delay), ...(args as []));
  g.setInterval = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    realSetInterval(handler as never, apply(delay), ...(args as []));

  return {
    stats: () => ({
      seen,
      clamped,
      maxRequestedMs,
      maxAppliedMs,
      floorMs,
      sites: [...sites.values()].sort((a, b) => b.count - a.count),
    }),
    assertClamped(minimum = 1, sitePattern?: RegExp) {
      if (clamped < minimum) {
        throw new Error(
          `timer-clamp: DEAD INSTRUMENT — clamped ${clamped} of ${seen} timer arms, ` +
            `expected at least ${minimum}. Nothing in scope armed a timer, so any ` +
            "result read from this window is not a measurement under a clamp.",
        );
      }
      if (sitePattern && ![...sites.keys()].some((s) => sitePattern.test(s))) {
        throw new Error(
          `timer-clamp: DEAD INSTRUMENT — no clamped call site matches ${sitePattern}. ` +
            `Clamped sites were: ${[...sites.keys()].join(", ") || "(none)"}.`,
        );
      }
    },
    uninstall() {
      g.setTimeout = realSetTimeout;
      g.setInterval = realSetInterval;
    },
  };
}

/**
 * Run `body` with the clamp installed, and uninstall it even on a throw. The
 * clamp is a global patch; leaking one poisons every later file in the same
 * vitest worker, so no test may install it without this.
 */
export async function underTimerClamp<T>(
  options: TimerClampOptions,
  body: (clamp: TimerClamp) => Promise<T>,
): Promise<T> {
  const clamp = installTimerClamp(options);
  try {
    return await body(clamp);
  } finally {
    clamp.uninstall();
  }
}
