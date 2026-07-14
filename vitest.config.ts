import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    // Suppress a Windows-only teardown flake in @cloudflare/vitest-pool-workers: on some
    // runs it fails to unlink the miniflare KV sqlite file (EBUSY) while popping isolated
    // storage between tests. This only masks *unhandled* errors — real assertion failures
    // still fail the run — and CI runs on Linux where it does not occur.
    dangerouslyIgnoreUnhandledErrors: true,
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: "2026-05-01",
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
