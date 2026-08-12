// B75 harness — vitest config.
//
// TWO THINGS HERE ARE DELIBERATE AND BOTH ARE ABOUT THE HARNESS LIVING OUTSIDE
// `plugin/`:
//
//  1. NO `import { defineConfig } from "vitest/config"`. This file sits in
//     `workflowArtifacts/`, which has no `node_modules` above it that carries
//     vitest, so that import cannot resolve. A plain object is a valid vitest
//     config and needs nothing.
//  2. `root` is `plugin/`, not this directory. Root is what Vite resolves bare
//     specifiers (`vitest`, `yjs`, …) against; pointing it at the plugin makes
//     the probes resolve exactly what `plugin/vitest.config.ts` resolves. Only
//     `test.include` reaches out to this directory.
//
// Consequence, and it is the point: a probe that survives is moved into
// `plugin/src/__tests__/` and runs under the project's own config unchanged.
import { fileURLToPath } from "node:url";

// Forward slashes throughout: the glob matcher behind `test.include` does not
// accept Windows separators, and a mixed-separator pattern silently matches
// nothing ("No test files found") rather than erroring.
const posix = (u) => fileURLToPath(u).replace(/\\/g, "/");

const HARNESS = posix(new URL(".", import.meta.url));
const PLUGIN = posix(new URL("../../../../plugin/", import.meta.url));
const REPO = posix(new URL("../../../../", import.meta.url));

export default {
  root: PLUGIN,
  test: {
    include: [`${HARNESS}probes/probe_*.test.ts`],
  },
  server: {
    fs: { allow: [REPO] },
  },
  resolve: {
    alias: {
      obsidian: `${PLUGIN}src/__mocks__/obsidian.ts`,
    },
  },
};
