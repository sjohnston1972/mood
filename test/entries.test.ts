import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { handleGetEntries, handleGetTodayEntry, handlePutEntry } from "../src/entries";
import { applyMigrations, seedEntry } from "./helpers";

const IDENT = { email: "u@example.com" };

beforeEach(applyMigrations);
afterEach(() => { vi.useRealTimers(); });

describe("GET /api/entries", () => {
  it("returns the last 60 days by default", async () => {
    // Pin "now" so this doesn't bit-rot as the real clock moves past the
    // seeded dates (they're more than 60 days in the past otherwise).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T00:00:00Z"));
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

describe("GET /api/entries/today - timezone boundary", () => {
  // These pin "now" to real instants where the caller's local calendar date
  // differs from the UTC calendar date, so a UTC-hardcoded implementation
  // looks up the wrong day. Instants were verified independently:
  //   node -e 'console.log(new Intl.DateTimeFormat("en-CA",
  //     {timeZone:"Pacific/Auckland", year:"numeric",month:"2-digit",day:"2-digit"})
  //     .format(new Date("2026-07-07T12:30:00Z")))'  -> 2026-07-08

  it("Pacific/Auckland: local date is already tomorrow relative to UTC", async () => {
    // 2026-07-07T12:30:00Z is 2026-07-08 00:30 in Pacific/Auckland (UTC+12, no DST in July).
    // UTC's date is still 2026-07-07. The entry was saved under the LOCAL date, 2026-07-08.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:30:00Z"));

    await seedEntry(IDENT.email, "2026-07-08", { mood: 4 });

    const req = new Request("https://x/api/entries/today?tz=Pacific/Auckland");
    const res = await handleGetTodayEntry(req, env, IDENT);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).not.toBeNull();
    expect(json.date).toBe("2026-07-08");
    expect(json.mood).toBe(4);
  });

  it("America/Los_Angeles: local date is still yesterday relative to UTC", async () => {
    // 2026-07-08T01:00:00Z is 2026-07-07 18:00 in America/Los_Angeles (PDT, UTC-7).
    // UTC's date is already 2026-07-08. The entry was saved under the LOCAL date, 2026-07-07.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T01:00:00Z"));

    await seedEntry(IDENT.email, "2026-07-07", { mood: 2 });

    const req = new Request("https://x/api/entries/today?tz=America/Los_Angeles");
    const res = await handleGetTodayEntry(req, env, IDENT);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).not.toBeNull();
    expect(json.date).toBe("2026-07-07");
    expect(json.mood).toBe(2);
  });

  it("falls back to UTC when tz is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T01:00:00Z"));

    await seedEntry(IDENT.email, "2026-07-08", { mood: 3 }); // UTC "today"

    const req = new Request("https://x/api/entries/today");
    const res = await handleGetTodayEntry(req, env, IDENT);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).not.toBeNull();
    expect(json.date).toBe("2026-07-08");
  });

  it("falls back to UTC when tz is invalid, without 500ing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T01:00:00Z"));

    await seedEntry(IDENT.email, "2026-07-08", { mood: 3 }); // UTC "today"

    const req = new Request("https://x/api/entries/today?tz=Not/AZone");
    const res = await handleGetTodayEntry(req, env, IDENT);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).not.toBeNull();
    expect(json.date).toBe("2026-07-08");
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
