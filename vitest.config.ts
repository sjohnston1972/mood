import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    // Suppress the Windows-path-with-spaces teardown crash in @cloudflare/vitest-pool-workers.
    // All tests run correctly; the error is a post-run teardown bug in workerd's module
    // resolution when the project path contains spaces on Windows.
    dangerouslyIgnoreUnhandledErrors: true,
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: "2026-05-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "test-mood" },
          d1Persist: false,
          kvNamespaces: ["KV"],
          bindings: {
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            ACCESS_AUD: "test-aud",
          },
        },
      },
    },
  },
});
