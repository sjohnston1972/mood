import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { applyMigrations } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
  (env as any).DEV_FAKE_EMAIL = "u@example.com";
  (env as any).ASSETS = { fetch: vi.fn().mockResolvedValue(new Response("<html>app</html>", { headers: { "content-type": "text/html" } })) };
});

describe("router", () => {
  it("serves static asset for /", async () => {
    const req = new Request("https://x/");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    expect((await res.text()).includes("app")).toBe(true);
  });

  it("401s API calls when no JWT and no dev fallback", async () => {
    (env as any).DEV_FAKE_EMAIL = undefined;
    const req = new Request("https://x/api/entries");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(401);
  });

  it("routes GET /api/entries", async () => {
    const req = new Request("https://x/api/entries");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
  });

  it("routes PUT /api/entries/:date", async () => {
    const req = new Request("https://x/api/entries/2026-05-20", {
      method: "PUT",
      body: JSON.stringify({ mood: 3, energy: 3, anxiety: 2, sleep: 3, tz: "UTC" }),
    });
    const ctx = createExecutionContext();
    (env as any).AI = { run: vi.fn().mockResolvedValue({ response: "NONE" }) };
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    await waitOnExecutionContext(ctx);
  });

  it("returns 404 for unknown /api/* paths", async () => {
    const req = new Request("https://x/api/wat");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});
