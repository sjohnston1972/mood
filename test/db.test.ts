// test/db.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  upsertEntry,
  getEntryByDate,
  listEntries,
  insertChatTurn,
  listChatTurns,
  upsertInsight,
  getLatestInsight,
} from "../src/db";
import { applyMigrations, seedEntry } from "./helpers";

beforeEach(applyMigrations);

const EMAIL = "u@example.com";

describe("upsertEntry / getEntryByDate", () => {
  it("inserts a new entry and reads it back", async () => {
    await upsertEntry(env.DB, EMAIL, "2026-05-20", {
      mood: 4,
      energy: 3,
      anxiety: 2,
      sleep: 4,
      tz: "Europe/London",
      note: "ok",
    });
    const got = await getEntryByDate(env.DB, EMAIL, "2026-05-20");
    expect(got).toMatchObject({ date: "2026-05-20", mood: 4, note: "ok" });
  });

  it("updates on conflict and bumps updated_at", async () => {
    await upsertEntry(env.DB, EMAIL, "2026-05-20", {
      mood: 4,
      energy: 3,
      anxiety: 2,
      sleep: 4,
      tz: "Europe/London",
    });
    const first = await getEntryByDate(env.DB, EMAIL, "2026-05-20");
    await new Promise((r) => setTimeout(r, 1100));
    await upsertEntry(env.DB, EMAIL, "2026-05-20", {
      mood: 5,
      energy: 3,
      anxiety: 2,
      sleep: 4,
      tz: "Europe/London",
    });
    const second = await getEntryByDate(env.DB, EMAIL, "2026-05-20");
    expect(second!.mood).toBe(5);
    expect(second!.updated_at).toBeGreaterThan(first!.updated_at);
    expect(second!.created_at).toBe(first!.created_at);
  });

  it("scopes by email", async () => {
    await upsertEntry(env.DB, "a@x", "2026-05-20", {
      mood: 4,
      energy: 3,
      anxiety: 2,
      sleep: 4,
      tz: "UTC",
    });
    expect(await getEntryByDate(env.DB, "b@x", "2026-05-20")).toBeNull();
  });
});

describe("listEntries", () => {
  it("returns the date range for the user, newest first", async () => {
    await seedEntry(EMAIL, "2026-05-18");
    await seedEntry(EMAIL, "2026-05-19");
    await seedEntry(EMAIL, "2026-05-20");
    const rows = await listEntries(env.DB, EMAIL, "2026-05-19", "2026-05-20");
    expect(rows.map((r) => r.date)).toEqual(["2026-05-20", "2026-05-19"]);
  });
});

describe("chat turns", () => {
  it("appends and lists by session", async () => {
    await insertChatTurn(env.DB, EMAIL, "s1", "user", "hi");
    await insertChatTurn(env.DB, EMAIL, "s1", "assistant", "hello");
    await insertChatTurn(env.DB, EMAIL, "s2", "user", "other");
    const s1 = await listChatTurns(env.DB, EMAIL, "s1");
    expect(s1.map((t) => t.content)).toEqual(["hi", "hello"]);
    expect(s1[0].role).toBe("user");
  });
});

describe("insights", () => {
  it("upserts and reads latest by created_at", async () => {
    await upsertInsight(env.DB, EMAIL, "2026-05-19", "sleep dipped");
    await upsertInsight(env.DB, EMAIL, "2026-05-20", "back on track");
    const latest = await getLatestInsight(env.DB, EMAIL);
    expect(latest?.date).toBe("2026-05-20");
    expect(latest?.text).toBe("back on track");
  });

  it("returns null when no insights exist", async () => {
    expect(await getLatestInsight(env.DB, EMAIL)).toBeNull();
  });
});
