import { fileURLToPath } from "node:url";
import { defineConfig } from "../../../../plugin/node_modules/vitest/dist/config.js";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

export default defineConfig({
  root: repo,
  test: {
    include: [
      "workflowArtifacts/debug/CANVAS-VIEW-REGRESSION-071/harness/probes/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("../../../../plugin/src/__mocks__/obsidian.ts", import.meta.url)),
    },
  },
});
