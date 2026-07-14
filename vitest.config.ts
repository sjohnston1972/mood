import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
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
