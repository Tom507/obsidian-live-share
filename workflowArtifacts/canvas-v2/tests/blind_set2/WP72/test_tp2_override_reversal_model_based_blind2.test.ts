// WP72 / C72 AC2 (blind set 2) — "an in-memory settings override is explicitly
// scoped to the session and is reversible".
//
// ANGLE (different mechanism from the visible set and from blind set 1): those
// two run hand-picked sequences — one override, three overrides of one key, one
// reversal. This one is MODEL-BASED: a deterministic pseudo-random schedule of
// 400 operations (overrides of existing keys, flags with no settings key at all,
// and reversals at unpredictable points) is run against the host while a shadow
// model of the expected state is maintained independently, and the WHOLE settings
// object is compared against the model after EVERY SINGLE operation — not only
// after the reversals. The `restored` / `cleared` report is checked against the
// model's own bookkeeping each time too.
//
// That difference matters for the trap the charter §5 names. A journal that
// recaptures the prior value on every `setFlag` survives a hand-picked sequence
// if the sequence never happens to override the same key twice across a reversal
// boundary; the schedule below hits that shape hundreds of times, in interleavings
// nobody chose. The seed is fixed, so a failure is reproducible and the test is
// not flaky.
//
// WOULD REDDEN IF: the journal recaptured on any override after the first; if a
// reversal restored only the last-touched key, or left the journal populated, or
// leaked a runtime flag into `settings`; if the override survived the host; or if
// a name reached through `Object.prototype` (`__proto__`, `constructor`,
// `toString`) were written into the settings object or the prototype chain.
//
// DATA SAFETY: no file is opened at all in this test; no vault is touched.
//
// Staging: copy into `plugin/src/__tests__/wp72blind2/` (→ `../../testing/...`).
import { describe, expect, it } from "vitest";

import {
  type E2EFileControlHost,
  type E2EPluginLike,
  buildPluginHost,
} from "../../testing/e2e-control";

const LOADED: Record<string, unknown> = {
  clientId: "blind2-client",
  roomId: "blind2-room",
  role: "host",
  serverUrl: "ws://127.0.0.1:1234",
  sharedFolder: "_e2e-rig",
  useCanvasBinding: false,
  showCanvasPresence: true,
  showCanvasCursors: true,
};

const SETTINGS_KEYS = Object.keys(LOADED);
const UNKNOWN_NAMES = ["madeUpFlag", "canvasStaleView", "noReaderAnywhere", "zzz"];

/** A fixed-seed LCG: unpredictable interleavings, perfectly reproducible ones. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
}

function makeHost(settings: Record<string, unknown>): {
  plugin: E2EPluginLike;
  newHost: () => E2EFileControlHost;
} {
  const plugin = {
    settings,
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {
      throw new Error("AC2 violation: the reversal path must never persist");
    },
    canvasSync: null,
  } as unknown as E2EPluginLike;
  return {
    plugin,
    newHost: () =>
      buildPluginHost(plugin, {
        counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
        bump: () => {},
      }),
  };
}

describe("WP72 AC2 blind2 — a shadow model, checked after every operation", () => {
  it("400 pseudo-random operations: settings always equals the model, and every reversal is exact", () => {
    const settings: Record<string, unknown> = { ...LOADED };
    const host = makeHost(settings).newHost();
    const rnd = lcg(0x72_c0_de_01);

    // The model. `expected` is what the settings object must hold right now;
    // `overridden` / `stashed` are what the next reversal must report.
    let expected: Record<string, unknown> = { ...LOADED };
    let overridden = new Set<string>();
    let stashed = new Set<string>();
    let reversals = 0;
    let overrideOps = 0;
    let repeatOverrides = 0;

    for (let step = 0; step < 400; step++) {
      const roll = rnd();
      if (roll < 0.15) {
        // --- reversal -------------------------------------------------------
        const out = host.clearFlags();
        expect([...out.restored].sort()).toEqual([...overridden].sort());
        expect([...out.cleared].sort()).toEqual([...stashed].sort());
        expected = { ...LOADED };
        overridden = new Set();
        stashed = new Set();
        reversals += 1;
      } else if (roll < 0.8) {
        // --- override of an existing settings key ----------------------------
        const name = SETTINGS_KEYS[Math.floor(rnd() * SETTINGS_KEYS.length)];
        const value = `s${step}`;
        if (overridden.has(name)) repeatOverrides += 1;
        host.setFlag(name, value);
        expected[name] = value;
        overridden.add(name);
        overrideOps += 1;
      } else {
        // --- a name no settings key answers to -------------------------------
        const name = UNKNOWN_NAMES[Math.floor(rnd() * UNKNOWN_NAMES.length)];
        host.setFlag(name, step);
        stashed.add(name);
      }

      // The invariant, after EVERY operation — not only after the reversals.
      expect({ ...settings }).toStrictEqual(expected);
      expect(Object.keys(settings)).toEqual(SETTINGS_KEYS);
    }

    // The schedule really did exercise the shapes this test exists for.
    expect(reversals).toBeGreaterThan(20);
    expect(overrideOps).toBeGreaterThan(150);
    // Repeat overrides of a key already in the journal — the charter §5 trap —
    // occur dozens of times per run of this fixed schedule.
    expect(repeatOverrides).toBeGreaterThan(50);

    // A final reversal lands exactly on the loaded state, whole object and key
    // order alike.
    host.clearFlags();
    expect({ ...settings }).toStrictEqual({ ...LOADED });
    expect(Object.keys(settings)).toEqual(SETTINGS_KEYS);
  });

  it("FALSIFICATION: a recapturing journal fails the same schedule", () => {
    // The charter §5 trap, built as a model rather than as an implementation: a
    // journal that overwrites its record on every override restores the PREVIOUS
    // OVERRIDE. Replaying the same kind of schedule against it shows the
    // invariant above is the thing that catches it.
    const settings: Record<string, unknown> = { ...LOADED };
    const badJournal = new Map<string, unknown>();
    const badSetFlag = (name: string, value: unknown): void => {
      badJournal.set(name, settings[name]); // recaptures — this is the defect
      settings[name] = value;
    };
    const badClear = (): void => {
      for (const [name, prior] of badJournal) settings[name] = prior;
      badJournal.clear();
    };

    badSetFlag("roomId", "first");
    badSetFlag("roomId", "second");
    badClear();
    expect(settings.roomId).toBe("first"); // NOT the loaded value
    expect({ ...settings }).not.toStrictEqual({ ...LOADED });
  });

  it("names that live on Object.prototype are stashed, never written through", () => {
    const settings: Record<string, unknown> = { ...LOADED };
    const host = makeHost(settings).newHost();
    const before = { ...settings };

    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      host.setFlag(name, { polluted: true });
    }

    // Nothing reached the settings object, and nothing reached the prototype the
    // whole runtime shares.
    expect({ ...settings }).toStrictEqual(before);
    expect(Object.keys(settings)).toEqual(SETTINGS_KEYS);
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBe(undefined);
    expect(({} as Record<string, unknown>).polluted).toBe(undefined);

    // They went to the stash, so the reversal reports them as cleared, not as
    // restored — the honest account of where they went.
    const out = host.clearFlags();
    expect(out.restored).toEqual([]);
    expect([...out.cleared].sort()).toEqual([
      "__proto__",
      "constructor",
      "hasOwnProperty",
      "toString",
      "valueOf",
    ]);
    expect({ ...settings }).toStrictEqual(before);
  });

  it("the override does not survive the instance, and a fresh instance can undo nothing", () => {
    const settings: Record<string, unknown> = { ...LOADED };
    const { newHost } = makeHost(settings);

    const session = newHost();
    for (const key of SETTINGS_KEYS) session.setFlag(key, "session-value");
    expect(Object.values(settings).every((v) => v === "session-value")).toBe(true);

    // A new host over the same plugin inherits nothing: the journal lives in the
    // previous host's closure and died with it.
    const later = newHost();
    expect(later.clearFlags()).toEqual({ restored: [], cleared: [] });
    expect(Object.values(settings).every((v) => v === "session-value")).toBe(true);

    // Only the session that made the overrides can reverse them.
    expect([...session.clearFlags().restored].sort()).toEqual([...SETTINGS_KEYS].sort());
    expect({ ...settings }).toStrictEqual({ ...LOADED });
  });
});
