import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { handleGetEntries, handleGetTodayEntry, handlePutEntry } from "../src/entries";
import { applyMigrations, seedEntry } from "./helpers";

const IDENT = { email: "u@example.com" };

beforeEach(applyMigrations);

describe("GET /api/entries", () => {
  it("returns the last 60 days by default", async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yDate = new Date(now); yDate.setUTCDate(now.getUTCDate() - 1);
    const yesterday = yDate.toISOString().slice(0, 10);
    await seedEntry(IDENT.email, today);
    await seedEntry(IDENT.email, yesterday);
    const req = new Request("https://x/api/entries");
    const res = await handleGetEntries(req, env, IDENT);
    expect(res.status).toBe(200);
    const json = await res.json() as any[];
    expect(json.map(r => r.date)).toEqual([today, yesterday]);
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

  it("uses the client tz to resolve the local date", async () => {
    const dateIn = (tz: string) => new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const utcToday = dateIn("UTC");
    // At any hour, at least one of these extremes has a local date != UTC's.
    const zone = dateIn("Pacific/Kiritimati") !== utcToday ? "Pacific/Kiritimati" : "Etc/GMT+12";
    const localDate = dateIn(zone);
    expect(localDate).not.toBe(utcToday);

    await seedEntry(IDENT.email, localDate, { mood: 7 });

    // Default UTC handler misses the entry saved under the client's local date.
    const utcRes = await handleGetTodayEntry(new Request("https://x/api/entries/today"), env, IDENT);
    expect(await utcRes.json()).toBeNull();

    // With the client tz, the local entry is found.
    const tzReq = new Request(`https://x/api/entries/today?tz=${encodeURIComponent(zone)}`);
    const tzRes = await handleGetTodayEntry(tzReq, env, IDENT);
    const json = await tzRes.json() as any;
    expect(json.mood).toBe(7);
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
