// test/schema.test.ts
import { describe, it, expect } from "vitest";
import { parseEntryInput, parseChatInput, parseDateParam } from "../src/schema";

describe("parseEntryInput", () => {
  const valid = { mood: 4, energy: 3, anxiety: 2, sleep: 4, tz: "Europe/London" };

  it("accepts a valid body", () => {
    expect(parseEntryInput(valid)).toEqual({ ...valid, note: undefined });
  });

  it("accepts an optional note", () => {
    expect(parseEntryInput({ ...valid, note: "ok day" }).note).toBe("ok day");
  });

  it.each(["mood", "energy", "anxiety", "sleep"])("rejects %s out of 1..5", (k) => {
    expect(() => parseEntryInput({ ...valid, [k]: 0 })).toThrow(/1..5/);
    expect(() => parseEntryInput({ ...valid, [k]: 6 })).toThrow(/1..5/);
    expect(() => parseEntryInput({ ...valid, [k]: 2.5 })).toThrow(/integer/);
  });

  it("rejects missing tz", () => {
    const { tz, ...rest } = valid;
    expect(() => parseEntryInput(rest)).toThrow(/tz/);
  });

  it("rejects unrecognised tz", () => {
    expect(() => parseEntryInput({ ...valid, tz: "Mars/Olympus" })).toThrow(/tz/);
  });

  it("rejects a note over 2000 chars", () => {
    expect(() => parseEntryInput({ ...valid, note: "x".repeat(2001) })).toThrow(/note/);
  });

  it("rejects non-object body", () => {
    expect(() => parseEntryInput(null)).toThrow();
    expect(() => parseEntryInput("hi")).toThrow();
  });
});

describe("parseChatInput", () => {
  it("accepts a valid body", () => {
    expect(parseChatInput({ session_id: "abc", message: "hello" }))
      .toEqual({ session_id: "abc", message: "hello" });
  });

  it("rejects empty message", () => {
    expect(() => parseChatInput({ session_id: "abc", message: "" })).toThrow(/message/);
  });

  it("rejects message over 4000 chars", () => {
    expect(() => parseChatInput({ session_id: "abc", message: "x".repeat(4001) })).toThrow();
  });

  it("rejects missing session_id", () => {
    expect(() => parseChatInput({ message: "hi" })).toThrow(/session_id/);
  });
});

describe("parseDateParam", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(parseDateParam("2026-05-20")).toBe("2026-05-20");
  });

  it("rejects malformed dates", () => {
    expect(() => parseDateParam("2026/05/20")).toThrow();
    expect(() => parseDateParam("20-05-2026")).toThrow();
    expect(() => parseDateParam("not-a-date")).toThrow();
  });

  it("rejects impossible dates", () => {
    expect(() => parseDateParam("2026-13-01")).toThrow();
    expect(() => parseDateParam("2026-02-30")).toThrow();
  });
});
