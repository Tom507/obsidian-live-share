// WP117 — THE WIRING, and it is the half every previous file in this suite
// takes on trust.
//
// tp01–tp05 drive the coordinator, the decisions and a three-peer world. All of
// them are satisfied in full by a plugin in which NOTHING EVER CALLS ANY OF IT:
// a `create` event that never reaches `requestCreate`, a control message nobody
// registers a handler for, a payload that goes over the relay in plaintext. Each
// of those has a line here.
//
// THE OPTIONALITY THIS PINS. `files/vault-events.ts` calls
// `plugin.requestCanvasCreate?.(...)` with a `?.`, because ten harnesses in this
// suite build a partial `plugin` double and a hard call turns each of them into
// a `TypeError`. An optional call is allowed to tolerate a DOUBLE; it is not
// allowed to become a silent no-op in the product. The row below is what keeps
// those two apart: rename or delete the method and this file reddens, naming it.
//
// SOURCE-DERIVED, and the comment strip is load-bearing for the same reason
// `wp83-source-derivation.ts` states: every identifier here is also named in
// prose somewhere in the tree, and a derivation that did not strip comments
// would go green on a sentence.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CANVAS_CREATE_MAX_BYTES } from "../../../files/canvas-create";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

/** Block comments first, then line comments — the shared helper's shape. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MAIN = stripComments(source("../../../main.ts"));
const VAULT_EVENTS = stripComments(source("../../../files/vault-events.ts"));
const CONTROL_HANDLERS = stripComments(source("../../../sync/control-handlers.ts"));
const CONTROL_WS = stripComments(source("../../../sync/control-ws.ts"));
const TYPES = stripComments(source("../../../types.ts"));
const RELAY = stripComments(source("../../../../../server/src/control-handler.ts"));

describe("WP117 — the detector is not vacuous (positive control)", () => {
  it("every file it reads is present and non-trivial after the comment strip", () => {
    const files: Array<[string, string]> = [
      ["main.ts", MAIN],
      ["files/vault-events.ts", VAULT_EVENTS],
      ["sync/control-handlers.ts", CONTROL_HANDLERS],
      ["sync/control-ws.ts", CONTROL_WS],
      ["types.ts", TYPES],
      ["server/src/control-handler.ts", RELAY],
    ];
    for (const [name, text] of files) {
      expect(text.length, `${name} is missing or was stripped to nothing`).toBeGreaterThan(500);
    }
    // …and the strip demonstrably removes a comment: a pattern that matches only
    // in prose must NOT be found. `canvasCreate` appears in a comment in
    // `vault-events.ts` and in no statement there.
    expect(source("../../../files/vault-events.ts")).toContain("coordinator (S155)");
    expect(VAULT_EVENTS).not.toContain("coordinator (S155)");
  });
});

describe("WP117 — the guest's door is reachable from a vault event", () => {
  it("`vault-events.ts` calls `requestCanvasCreate` from the `create` handler", () => {
    expect(VAULT_EVENTS).toMatch(/plugin\.requestCanvasCreate\?\.\(/);
    // It sits in the `create` registration, not somewhere else in the file.
    const createBlock = VAULT_EVENTS.slice(
      VAULT_EVENTS.indexOf('vault.on("create"'),
      VAULT_EVENTS.indexOf('vault.on("delete"'),
    );
    expect(createBlock.length).toBeGreaterThan(100);
    expect(createBlock).toMatch(/requestCanvasCreate/);
  });

  it("`main.ts` DECLARES `requestCanvasCreate` — the `?.` above cannot become a no-op", () => {
    // The whole point of this row. Renaming the method leaves `vault-events.ts`
    // compiling, leaves every other test in this suite green, and silently
    // removes the feature from the product.
    expect(MAIN).toMatch(/async\s+requestCanvasCreate\s*\(/);
    expect(MAIN).toMatch(/coordinator\.requestCreate\(/);
  });

  it("`main.ts` builds the coordinator and clears it with the session", () => {
    expect(MAIN).toMatch(/new\s+CanvasCreateCoordinator\(/);
    expect(MAIN).toMatch(/this\.canvasCreate\?\.reset\(\)/);
    expect(MAIN).toMatch(/this\.canvasCreate\s*=\s*null/);
  });

  it("`main.ts` states no canvas subscribe of its own (WP6 AC8 still holds)", () => {
    // The host's seed subscribe lives in `files/canvas-create.ts`, which takes
    // `CanvasSync` as an injected object — the same shape `canvas-mirror.ts`
    // uses, and for the same reason.
    expect(MAIN).not.toMatch(/canvasSync\??\.subscribe\(/);
    expect(stripComments(source("../../../files/canvas-create.ts"))).toMatch(
      /sync\.subscribe\(path,\s*"host"\)/,
    );
  });
});

describe("WP117 — both control messages are carried, and the payload is not in the clear", () => {
  it("both handlers are registered on the control channel", () => {
    expect(CONTROL_HANDLERS).toMatch(/channel\.on\("canvas-create-request"/);
    expect(CONTROL_HANDLERS).toMatch(/channel\.on\("canvas-create-result"/);
    expect(CONTROL_HANDLERS).toMatch(/canvasCreate\?\.handleRequest\(/);
    expect(CONTROL_HANDLERS).toMatch(/canvasCreate\?\.handleResult\(/);
  });

  it("both types exist on the wire union and in the handler map", () => {
    expect(TYPES).toMatch(/CanvasCreateRequestMessage/);
    expect(TYPES).toMatch(/CanvasCreateResultMessage/);
    expect(TYPES).toMatch(/"canvas-create-request":\s*CanvasCreateRequestMessage/);
    expect(TYPES).toMatch(/"canvas-create-result":\s*CanvasCreateResultMessage/);
  });

  it("I8 — the request is ENCRYPTABLE, and both its path and its content are encrypted", () => {
    // A whole user file crosses the relay in this frame. Off the encryptable
    // list it would travel in plaintext through a relay this project's own
    // invariant I8 says is content-blind.
    const encryptable = CONTROL_WS.slice(
      CONTROL_WS.indexOf("const encryptable ="),
      CONTROL_WS.indexOf("const encryptable =") + 500,
    );
    expect(encryptable).toContain('msg.type === "canvas-create-request"');
    expect(CONTROL_WS).toMatch(/encryptString\(msg\.content\)/);
    expect(CONTROL_WS).toMatch(/decryptString\(msg\.content\)/);
  });

  it("the relay carries both types, treats the request as a WRITE, and lets only the host answer", () => {
    expect(RELAY).toMatch(/"canvas-create-request"/);
    expect(RELAY).toMatch(/"canvas-create-result"/);
    // A read-only guest may not reach the host with a request to write a file
    // into the shared tree.
    const isFileWrite = RELAY.slice(
      RELAY.indexOf("const isFileWrite ="),
      RELAY.indexOf("const isFileWrite =") + 400,
    );
    expect(isFileWrite).toContain('msg.type === "canvas-create-request"');
    // …and only the host may put a RESULT on the wire, independently of the
    // plugin's own `not-host` clause.
    const hostOnly = RELAY.slice(
      RELAY.indexOf("HOST_ONLY_TYPES = new Set("),
      RELAY.indexOf("HOST_ONLY_TYPES = new Set(") + 400,
    );
    expect(hostOnly).toContain('"canvas-create-result"');
  });
});

describe("WP117 — the size bound is stated against the relay's real ceiling", () => {
  it("the bound sits below the relay's `maxPayload`, with room for the encrypted form", () => {
    const maxPayload = /maxPayload:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(RELAY);
    expect(maxPayload, "the relay no longer states a maxPayload this bound was derived from")
      .not.toBeNull();
    const ceilingBytes = Number(maxPayload?.[1]) * 1024 * 1024;
    // Base64 plus an IV is roughly 1.4x; the assertion keeps a factor of two on
    // top of that, so the bound cannot drift into the ceiling unnoticed.
    expect(CANVAS_CREATE_MAX_BYTES * 3).toBeLessThan(ceilingBytes);
  });
});
