import process from "node:process";
import esbuild from "esbuild";

const prod = process.argv[2] === "production";

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

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
