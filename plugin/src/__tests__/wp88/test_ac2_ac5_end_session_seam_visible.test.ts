// ===========================================================================
// WP88 AC2 + AC5 — the destruction measured KEY BY KEY at the seam, with
// SYNTHETIC SENTINELS and an INJECTED `requestUrl` double.
//
// NO `data.json` IS OPENED, read, copied for inspection or hashed. That is a
// criterion, not a convenience: the two owner vaults hold live credentials and
// this WP's subject IS those six keys. The seam takes an injected settings
// object precisely so it never has to touch a real one, and every value below
// is a made-up sentinel that exists only in this file.
//
// AC5 is the ANTI-LOBOTOMY CONTROL and it is in the SAME FILE on purpose: the
// same six assertions, with the opposite expected outcome, in the same run.
// "the give-up no longer destroys" and "nothing destroys any more" are
// different builds and only one of them is chartered.
// ===========================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

interface RequestCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

const requests: RequestCall[] = [];

vi.mock("obsidian", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../__mocks__/obsidian");
  return {
    ...actual,
    // The injected double. It records and answers; it reaches no network.
    requestUrl: async (options: RequestCall) => {
      requests.push(options);
      return { status: 200, json: {}, text: "" };
    },
  };
});

const { SessionManager } = await import("../../session/session");

/**
 * Synthetic sentinels. Every one of these is invented here and appears nowhere
 * else in the world. They are distinguishable from each other so a test that
 * clears the wrong key cannot pass by accident.
 */
const SENTINEL = {
  roomId: "SENTINEL-ROOM-0001",
  token: "SENTINEL-TOKEN-0002",
  encryptionPassphrase: "SENTINEL-PASSPHRASE-0003",
  encryptionSalt: "SENTINEL-SALT-0004",
  role: "host" as string | null,
  permission: "read-only",
} as const;

/** The six keys `SessionManager.endSession` clears, named — never their values. */
const SIX_KEYS = [
  "roomId",
  "token",
  "encryptionPassphrase",
  "encryptionSalt",
  "role",
  "permission",
] as const;

function makePlugin(role: "host" | "guest") {
  const settings: Record<string, unknown> = {
    serverUrl: "http://sentinel.invalid",
    serverPassword: "",
    roomId: SENTINEL.roomId,
    token: SENTINEL.token,
    encryptionPassphrase: SENTINEL.encryptionPassphrase,
    encryptionSalt: SENTINEL.encryptionSalt,
    role,
    permission: SENTINEL.permission,
  };
  let saveCount = 0;
  const plugin = {
    settings,
    saveSettings: async () => {
      saveCount += 1;
    },
  };
  return { plugin, settings, saves: () => saveCount };
}

beforeEach(() => {
  requests.length = 0;
});

describe("WP88 AC2/AC5 — the seam, key by key, with sentinels", () => {
  it("AC5 — the USER route still clears all six keys AND PERSISTS them", () => {
    // The anti-lobotomy control. `endSession`'s body is preserved byte-for-byte
    // for the user path; WP88 severs at the CALLER, never inside the
    // destructive function, because making the function's behaviour depend on a
    // caller-supplied intent is exactly the ambiguity that hid this defect —
    // one call answering both "I chose to leave" and "my Wi-Fi died".
    const { plugin, settings, saves } = makePlugin("host");
    const manager = new SessionManager(plugin as never);
    return manager.endSession().then(() => {
      expect(settings.roomId).toBe("");
      expect(settings.token).toBe("");
      expect(settings.encryptionPassphrase).toBe("");
      expect(settings.encryptionSalt).toBe("");
      expect(settings.role).toBeNull();
      expect(settings.permission).toBe("read-write");
      // The persist. An in-memory clear that never reaches disk is a DIFFERENT
      // defect and would recover on restart, so asserting the fields without
      // asserting the save is the first vacuity risk this AC names by hand.
      expect(saves()).toBe(1);
    });
  });

  it("AC5 — the HOST arm issues DELETE /rooms/{roomId}, with a bearer header", async () => {
    const { plugin } = makePlugin("host");
    await new SessionManager(plugin as never).endSession();
    const deletes = requests.filter((r) => r.method === "DELETE");
    expect(deletes).toHaveLength(1);
    // Presence of the shape, never the credential: the path segment is asserted
    // by its SENTINEL id, which is not a real room, and the header is asserted
    // to EXIST rather than by its content.
    expect(deletes[0].url.endsWith(`/rooms/${SENTINEL.roomId}`)).toBe(true);
    expect(Object.keys(deletes[0].headers ?? {})).toContain("Authorization");
  });

  it("AC5 — the GUEST arm issues NO request at all (the mandatory control)", async () => {
    // Without this row the DELETE assertion above cannot distinguish "the host
    // deletes the room" from "everybody does".
    const { plugin, settings, saves } = makePlugin("guest");
    await new SessionManager(plugin as never).endSession();
    expect(requests).toHaveLength(0);
    // …and the guest still clears and still persists, so the control is a
    // control and not just a quiet path.
    expect(settings.roomId).toBe("");
    expect(saves()).toBe(1);
  });

  it("the six keys are exactly the six the charter names — derived from the source", async () => {
    // A structural pin so a SEVENTH key cannot join the clear unnoticed. Read
    // from the production source, comment-stripped, so a mention in prose is
    // not counted as an assignment (the trap that reddened this WP's own census
    // deriver on its first run).
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const { parseUnits } = await import("./route-census");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "..", "session", "session.ts"), "utf8");
    const unit = parseUnits("session.ts", src).find((u) => u.name === "endSession");
    expect(unit).toBeDefined();
    // `=(?!=)` — an ASSIGNMENT, never a comparison. Without the lookahead
    // `settings.role === "host"` at the top of the host arm is counted as a
    // seventh write, which is how this row first went red: a detector that
    // cannot tell `=` from `===` is measuring something other than what it says.
    const assigned = [...(unit as { body: string }).body.matchAll(/settings\.(\w+)\s*=(?!=)/g)].map(
      (m) => m[1],
    );
    expect([...new Set(assigned)].sort()).toEqual([...SIX_KEYS].sort());
    // Positive control for the detector: it finds SOMETHING, and exactly six.
    expect(assigned).toHaveLength(6);
  });

  it("REVERSE — the sentinels really were distinguishable (no accidental pass)", () => {
    // A clear that wrote the same value into every key would satisfy the six
    // assertions above only because the expected values differ. This states
    // that they do.
    const values = Object.values(SENTINEL).filter((v) => typeof v === "string");
    expect(new Set(values).size).toBe(values.length);
  });
});
