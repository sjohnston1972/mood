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

// Relative to "now" rather than a fixed calendar date, so these tests keep
// working no matter when they're run (runInsightJob's 14-day lookback and
// handleGetInsight's freshness window are both relative to the real clock).
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("runInsightJob", () => {
  it("writes a non-NONE insight to D1 and KV", async () => {
    await seedEntry(EMAIL, daysAgo(1));
    mockAi("Sleep dipped Wed.");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT text FROM insights WHERE email=?").bind(EMAIL).first<{ text: string }>();
    expect(row?.text).toBe("Sleep dipped Wed.");
    const kv = await env.KV.get(`insight:${EMAIL}`, "json") as any;
    expect(kv.text).toBe("Sleep dipped Wed.");
  });

  it("writes nothing when AI returns NONE", async () => {
    await seedEntry(EMAIL, daysAgo(1));
    mockAi("NONE");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT * FROM insights WHERE email=?").bind(EMAIL).first();
    expect(row).toBeNull();
    expect(await env.KV.get(`insight:${EMAIL}`)).toBeNull();
  });

  it("clears a previously stored insight when AI returns NONE", async () => {
    await seedEntry(EMAIL, daysAgo(1));
    mockAi("Sleep dipped Wed.");
    await runInsightJob(env, EMAIL);
    // Sanity check: the earlier insight really is there before we clear it.
    expect(await env.KV.get(`insight:${EMAIL}`)).not.toBeNull();
    const before = await env.DB.prepare("SELECT * FROM insights WHERE email=?").bind(EMAIL).first();
    expect(before).not.toBeNull();

    mockAi("NONE");
    await runInsightJob(env, EMAIL);

    expect(await env.KV.get(`insight:${EMAIL}`)).toBeNull();
    const after = await env.DB.prepare("SELECT * FROM insights WHERE email=?").bind(EMAIL).first();
    expect(after).toBeNull();

    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    expect(await res.json()).toBeNull();
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
    await env.KV.put(`insight:${EMAIL}`, JSON.stringify({ date: daysAgo(1), text: "hi" }));
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    const body = await res.json() as any;
    expect(body.text).toBe("hi");
  });

  it("falls back to D1 if KV is empty", async () => {
    await env.DB.prepare(
      "INSERT INTO insights (email,date,text,created_at) VALUES (?,?,?,?)"
    ).bind(EMAIL, daysAgo(1), "from db", Math.floor(Date.now() / 1000)).run();
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    const body = await res.json() as any;
    expect(body.text).toBe("from db");
  });

  it("returns null when nothing exists", async () => {
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    expect(await res.json()).toBeNull();
  });
});
