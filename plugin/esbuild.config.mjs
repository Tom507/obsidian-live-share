import process from "node:process";
import esbuild from "esbuild";

// Mode selection, argv[2]. Three modes, one branch point:
//   ├── "production" → one-shot, __LS_E2E__ "false", no sourcemap   (npm run build)
//   ├── "e2e"        → one-shot, options IDENTICAL to the watch mode (npm run build:e2e)
//   └── anything else / absent → watch, never returns                (npm run dev)
// The `e2e` mode exists because the instrumented build was previously reachable only
// through `ctx.watch()`, which never terminates; an automated gate cannot use it, and a
// killed watcher can leave a truncated bundle. It differs from the default watch mode in
// one-shot versus watch and in nothing else.
const E2E_MODE = "e2e";

const mode = process.argv[2];
const prod = mode === "production";
const oneShot = prod || mode === E2E_MODE;

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/language",
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  // Build-time flag for the WP4 E2E control server. `false` in the production
  // build folds the flag-gated dynamic import in main.ts to dead code, so the
  // entire `src/testing/` module is eliminated from `main.js` (US7 AC1). In dev
  // the module is bundled but only listens when its runtime port flag is set.
  define: {
    __LS_E2E__: prod ? "false" : "true",
  },
  outfile: "main.js",
  platform: "node",
});

if (oneShot) {
  // A rejected rebuild() is a rejected top-level await: node reports it and exits
  // non-zero, so a failed build is never mistaken for a bundle.
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
