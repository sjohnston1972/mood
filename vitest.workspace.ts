import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // Pure TS unit tests — no Workers runtime needed
  {
    test: {
      name: "unit",
      include: ["test/schema.test.ts"],
      environment: "node",
      pool: "forks",
    },
  },
  // Workers integration tests — require Cloudflare Workers runtime
  "./vitest.config.ts",
]);
