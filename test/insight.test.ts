import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { runInsightJob, handleGetInsight } from "../src/insight";
import { applyMigrations, seedEntry } from "./helpers";

const EMAIL = "u@example.com";

beforeEach(async () => {
  await applyMigrations();
  await env.KV.delete(`insight:${EMAIL}`);
});

function mockAi(response: string) {
  (env as any).AI = { run: vi.fn().mockResolvedValue({ response }) };
}

// Seed within the 14-day window that runInsightJob reads relative to the real
// current date, so these tests don't rot as wall-clock time advances.
const today = new Date().toISOString().slice(0, 10);

describe("runInsightJob", () => {
  it("writes a non-NONE insight to D1 and KV", async () => {
    await seedEntry(EMAIL, today);
    mockAi("Sleep dipped Wed.");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT text FROM insights WHERE email=?").bind(EMAIL).first<{ text: string }>();
    expect(row?.text).toBe("Sleep dipped Wed.");
    const kv = await env.KV.get(`insight:${EMAIL}`, "json") as any;
    expect(kv.text).toBe("Sleep dipped Wed.");
  });

  it("writes nothing when AI returns NONE", async () => {
    await seedEntry(EMAIL, today);
    mockAi("NONE");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT * FROM insights WHERE email=?").bind(EMAIL).first();
    expect(row).toBeNull();
    expect(await env.KV.get(`insight:${EMAIL}`)).toBeNull();
  });

  it("preserves the last insight when AI returns NONE", async () => {
    await seedEntry(EMAIL, today);
    // A prior insight is cached. Per design, /api/insight shows the latest on next
    // open, so a NONE result must NOT wipe it.
    await env.KV.put(`insight:${EMAIL}`, JSON.stringify({ date: "2026-05-19", text: "keep me" }));
    mockAi("NONE");
    await runInsightJob(env, EMAIL);
    const kv = await env.KV.get(`insight:${EMAIL}`, "json") as any;
    expect(kv?.text).toBe("keep me");
  });

  it("no-ops when no entries exist", async () => {
    mockAi("something");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT * FROM insights WHERE email=?").bind(EMAIL).first();
    expect(row).toBeNull();
  });
});

describe("handleGetInsight", () => {
  it("returns the KV-cached value when present", async () => {
    await env.KV.put(`insight:${EMAIL}`, JSON.stringify({ date: "2026-05-20", text: "hi" }));
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    const body = await res.json() as any;
    expect(body.text).toBe("hi");
  });

  it("falls back to D1 if KV is empty", async () => {
    await env.DB.prepare(
      "INSERT INTO insights (email,date,text,created_at) VALUES (?,?,?,?)"
    ).bind(EMAIL, "2026-05-19", "from db", Math.floor(Date.now() / 1000)).run();
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    const body = await res.json() as any;
    expect(body.text).toBe("from db");
  });

  it("returns null when nothing exists", async () => {
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    expect(await res.json()).toBeNull();
  });
});
