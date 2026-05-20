// test/env.d.ts
// Augment the cloudflare:test ProvidedEnv to match vitest.config.ts miniflare bindings.
declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    KV: KVNamespace;
    AI: Ai;
    ASSETS: Fetcher;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    DEV_FAKE_EMAIL?: string;
  }
}

// Vite ?raw imports return a string.
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
