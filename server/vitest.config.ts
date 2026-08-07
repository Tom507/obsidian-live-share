import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Exercise the production path where a real JWT secret is configured, so
    // verifyJWT actually validates tokens (see github-auth.ts).
    env: {
      JWT_SECRET: "test-secret-value",
    },
  },
});
