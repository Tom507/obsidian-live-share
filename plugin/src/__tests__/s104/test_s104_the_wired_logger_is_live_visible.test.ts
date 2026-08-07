// S104 — THE WIRED LOGGER IS LIVE.
//
// WHAT THIS FILE IS FOR. `main.ts`'s `onload()` handed `FileOpsManager` its
// logger BEFORE `this.logger` was assigned, so the manager was given
// `undefined` and — because `setLogger` stores whatever it is handed and is
// never called again for that manager — kept `undefined` for the whole life of
// the plugin. Two language features hid it, and neither is a defect on its own:
//
//   - `logger!: DebugLogger` (`main.ts:167`) — the definite-assignment `!` is
//     why `tsc` never objected to reading the field before it is assigned.
//   - `this.logger?.warn(...)` at every emitter — the optional `?.` is why the
//     dead channel never threw. It degraded to silence instead of to a crash.
//
// CONSEQUENCE, AND WHY IT OUTRANKS THE ONE-LINE REPAIR IT PINS.
// `FileOpsManager` owns two production log signatures:
//
//   - `MUTE OVERRUN:`                                    (`file-ops.ts:531`)
//   - `PROTECTED PATH REFUSED: arm=apply-remote-op ...`  (`file-ops.ts:654`)
//
// Neither could ever reach a sink in a real Obsidian session, so an observation
// of the form "that signature never fired" was reading a DEAD CHANNEL and was
// worth nothing. Both emitters read the SAME `this.logger` field on the SAME
// manager instance, so one of them is sufficient to pin the wiring; T1 uses the
// refusal because it needs no clock.
//
// WHY THIS TEST GOES THROUGH THE REAL `onload()`.
// `src/__tests__/v2/wp93/` already asserts `MUTE OVERRUN:` is emitted, and it
// passed throughout the entire period the production channel was dead, because
// its harness calls `setLogger` itself and gets the order right. `wp88`'s suite
// imports `main.ts` but ASSEMBLES the plugin field by field and never calls
// `onload()`, so it could not see this either. A test that wires its own
// subject cannot observe a wiring-order defect in the wiring. Running the real
// `onload()` and asserting on the real `plugin.logger` ring buffer is the only
// vantage point from which this is visible at all.
//
// WHAT WOULD MAKE EACH ROW FAIL:
//   T1  a logger consumer in `onload()` is handed `this.logger` before the
//       assignment again — i.e. this exact defect returns. RED before repair.
//   T2  the same, derived from the file rather than from behaviour, so it also
//       catches a NEW eager consumer added above the assignment — not only this
//       one coming back. RED before repair.

import { afterEach, describe, expect, it, vi } from "vitest";

// The shared `__mocks__/obsidian.ts` declares only what the modules already
// under test need, and `main.ts`'s import graph reaches further. Filled in HERE
// rather than in the shared double, so no other suite's surface moves — the
// same posture `wp88` took for the same reason.
vi.mock("obsidian", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../__mocks__/obsidian");
  class Stub {
    // biome-ignore lint/suspicious/noExplicitAny: an inert stand-in.
    constructor(..._args: any[]) {}
    open() {}
    close() {}
    onOpen() {}
    onClose() {}
    addItem() {
      return this;
    }
    addSeparator() {
      return this;
    }
    showAtMouseEvent() {}
    setIcon() {
      return this;
    }
    setTooltip() {
      return this;
    }
    onClick() {
      return this;
    }
  }
  return {
    FuzzySuggestModal: Stub,
    Menu: Stub,
    ExtraButtonComponent: Stub,
    SettingGroup: Stub,
    WorkspaceLeaf: Stub,
    setIcon: () => {},
    requestUrl: async () => ({ status: 200, json: {}, text: "" }),
    ...actual,
  };
});

const LiveSharePlugin = (await import("../../main")).default;

// ---------------------------------------------------------------------------
// Scaffolding. The smallest `App` + `Plugin` surface `onload()` actually
// touches, all of it inert: the subject under test is the ORDER of two
// statements, so any behaviour these stubs invented would be noise.
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: a test double, shape-only.
function createApp(): any {
  const ref = { __eventRef: true };
  return {
    vault: {
      configDir: ".obsidian",
      adapter: {
        exists: async () => false,
        read: async () => "",
        write: async () => {},
        mkdir: async () => {},
        append: async () => {},
        stat: async () => null,
      },
      on: () => ref,
      off: () => {},
      getAbstractFileByPath: () => null,
      getFiles: () => [],
      getMarkdownFiles: () => [],
      getRoot: () => ({ path: "/", children: [] }),
      read: async () => "",
      readBinary: async () => new ArrayBuffer(0),
      create: async () => ({ path: "" }),
      createBinary: async () => ({ path: "" }),
      createFolder: async () => {},
      modify: async () => {},
      modifyBinary: async () => {},
      delete: async () => {},
      trash: async () => {},
    },
    fileManager: { renameFile: async () => {}, trashFile: async () => {} },
    workspace: {
      on: () => ref,
      off: () => {},
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
      onLayoutReady: () => {},
      getRightLeaf: () => null,
      revealLeaf: () => {},
      detachLeavesOfType: () => {},
    },
    metadataCache: { on: () => ref, off: () => {} },
  };
}

/** The `Plugin` base methods the shared double does not carry. Assigned as
 * INSTANCE properties, so the shared class is untouched. */
// biome-ignore lint/suspicious/noExplicitAny: a test double, shape-only.
function scaffold(plugin: any): void {
  plugin.app = createApp();
  plugin.manifest = { id: "live-share", version: "0.0.0-test" };
  plugin.register = () => {};
  plugin.registerEvent = () => {};
  plugin.registerObsidianProtocolHandler = () => {};
  plugin.registerDomEvent = () => {};
  plugin.registerInterval = () => 0;
  plugin.addRibbonIcon = () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    addClass: () => {},
  });
  plugin.addStatusBarItem = () => ({
    setText: () => {},
    addEventListener: () => {},
    addClass: () => {},
    style: {},
  });
}

// biome-ignore lint/suspicious/noExplicitAny: the real class, minimally wired.
async function bootPlugin(): Promise<any> {
  // biome-ignore lint/suspicious/noExplicitAny: the real class, minimally wired.
  const plugin: any = new (LiveSharePlugin as any)();
  scaffold(plugin);
  await plugin.onload();
  return plugin;
}

/** `main.ts` as TEXT, for the derived row. Read from disk rather than from the
 * import, because the subject is source ORDER and the module object has none. */
async function readMainSource(): Promise<string[]> {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "..", "..", "main.ts"), "utf8").split(/\r?\n/);
}

describe("S104 — the logger main.ts wires into FileOpsManager is the live one", () => {
  // biome-ignore lint/suspicious/noExplicitAny: the real class, minimally wired.
  let plugin: any;

  afterEach(() => {
    try {
      plugin?.fileOpsManager?.destroy?.();
      plugin?.syncManager?.destroy?.();
      plugin?.logger?.destroy?.();
    } catch {
      /* teardown must never mask the assertion above it */
    }
    plugin = undefined;
  });

  it("T1 — after the real onload(), a protected-path refusal from FileOpsManager reaches plugin.logger", async () => {
    plugin = await bootPlugin();

    // The logger the plugin ended up with must be a real DebugLogger, or the
    // rest of this row would be asserting against the wrong object.
    expect(plugin.logger).toBeDefined();
    expect(typeof plugin.logger.getEntries).toBe("function");

    // A REAL producer: an inbound op at a protected path. `applyRemoteOp`
    // refuses it and — via `this.logger?.warn(...)` — is supposed to say so.
    // I11 holds either way: a refusal is taken ABOVE `mutePathEvents` and above
    // every vault call, so this drives no write on any tree.
    await plugin.fileOpsManager.applyRemoteOp({
      type: "create",
      path: ".obsidian/plugins/evil/main.js",
      content: "x",
    });

    const refusals = plugin.logger
      .getEntries()
      // biome-ignore lint/suspicious/noExplicitAny: the ring entry shape.
      .map((e: any) => String(e.message))
      .filter((m: string) => m.startsWith("PROTECTED PATH REFUSED: arm=apply-remote-op"));

    // BEFORE THE REPAIR this is `[]` — and NOT because the refusal did not
    // happen. It did: the op was refused and no byte was written either way.
    // The manager's logger is `undefined` and `?.` swallowed the sentence.
    expect(refusals).toHaveLength(1);
  });

  it("T2 — no logger consumer in onload() is handed `this.logger` above its assignment", async () => {
    const all = await readMainSource();

    const onloadAt = all.findIndex((l) => /^\s{2}async onload\(\)/.test(l));
    const onunloadAt = all.findIndex((l) => /^\s{2}async onunload\(\)/.test(l));
    expect(onloadAt).toBeGreaterThan(-1);
    expect(onunloadAt).toBeGreaterThan(onloadAt);

    const body = all.slice(onloadAt, onunloadAt);
    const assignAt = body.findIndex((l) => /this\.logger\s*=\s*new DebugLogger\(/.test(l));
    expect(assignAt).toBeGreaterThan(-1);

    // Every EAGER hand-off of `this.logger` in the body. A line inside a
    // deferred callback is excluded by INDENTATION: `onload`'s own statements
    // sit at exactly four spaces and anything a callback owns is deeper. That
    // is what makes `view.setLogger(this.logger)` inside the `registerView`
    // factory legitimate — it does not run until a view is created, long after
    // the assignment.
    const eager = body
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /^ {4}\S/.test(line))
      .filter(({ line }) => /\.setLogger\(this\.logger\)|logger:\s*this\.logger/.test(line));

    // If this ever reads zero the row has stopped measuring anything — the
    // shape it greps for would have been renamed out from under it.
    expect(eager.length).toBeGreaterThan(0);

    const tooEarly = eager
      .filter(({ i }) => i < assignAt)
      .map(({ line, i }) => `main.ts:${onloadAt + i + 1}: ${line.trim()}`);

    expect(tooEarly).toEqual([]);
  });
});
