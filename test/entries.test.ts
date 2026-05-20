import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { handleGetEntries, handleGetTodayEntry, handlePutEntry } from "../src/entries";
import { applyMigrations, seedEntry } from "./helpers";

const IDENT = { email: "u@example.com" };

beforeEach(applyMigrations);

describe("GET /api/entries", () => {
  it("returns the last 60 days by default", async () => {
    await seedEntry(IDENT.email, "2026-05-20");
    await seedEntry(IDENT.email, "2026-05-19");
    const req = new Request("https://x/api/entries");
    const res = await handleGetEntries(req, env, IDENT);
    expect(res.status).toBe(200);
    const json = await res.json() as any[];
    expect(json.map(r => r.date)).toEqual(["2026-05-20", "2026-05-19"]);
  });

  it("honours from/to", async () => {
    await seedEntry(IDENT.email, "2026-05-18");
    await seedEntry(IDENT.email, "2026-05-19");
    await seedEntry(IDENT.email, "2026-05-20");
    const req = new Request("https://x/api/entries?from=2026-05-19&to=2026-05-19");
    const res = await handleGetEntries(req, env, IDENT);
    const json = await res.json() as any[];
    expect(json.map(r => r.date)).toEqual(["2026-05-19"]);
  });

  it("400s on malformed date params", async () => {
    const req = new Request("https://x/api/entries?from=bad");
    const res = await handleGetEntries(req, env, IDENT);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/entries/today", () => {
  it("returns today's entry if present", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await seedEntry(IDENT.email, today, { mood: 5 });
    const req = new Request("https://x/api/entries/today");
    const res = await handleGetTodayEntry(req, env, IDENT);
    const json = await res.json() as any;
    expect(json.mood).toBe(5);
  });

  it("returns null body 200 if no entry today", async () => {
    const req = new Request("https://x/api/entries/today");
    const res = await handleGetTodayEntry(req, env, IDENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

describe("PUT /api/entries/:date", () => {
  it("inserts and returns the new entry", async () => {
    const ctx = createExecutionContext();
    const body = JSON.stringify({ mood: 4, energy: 3, anxiety: 2, sleep: 4, note: "hi", tz: "Europe/London" });
    const req = new Request("https://x/api/entries/2026-05-20", { method: "PUT", body });
    const res = await handlePutEntry(req, env, IDENT, "2026-05-20", ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({ date: "2026-05-20", mood: 4, note: "hi" });
    await waitOnExecutionContext(ctx);
  });

  it("rejects invalid bodies with 400", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/entries/2026-05-20", {
      method: "PUT", body: JSON.stringify({ mood: 9 }),
    });
    const res = await handlePutEntry(req, env, IDENT, "2026-05-20", ctx);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid date in the URL", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/entries/bad", {
      method: "PUT",
      body: JSON.stringify({ mood: 4, energy: 3, anxiety: 2, sleep: 4, tz: "UTC" }),
    });
    const res = await handlePutEntry(req, env, IDENT, "bad", ctx);
    expect(res.status).toBe(400);
  });
});
