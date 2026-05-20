// Separate vitest config for pure-TS unit tests that don't need the Workers runtime.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/schema.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
