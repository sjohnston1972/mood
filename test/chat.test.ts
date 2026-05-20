import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { handleChat, handleGetChatHistory } from "../src/chat";
import { applyMigrations, seedEntry } from "./helpers";

const IDENT = { email: "u@example.com" };

beforeEach(applyMigrations);

function mockAiStream(chunks: string[]) {
  (env as any).AI = {
    run: vi.fn().mockImplementation(async () => {
      return new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: c })}\n\n`));
          controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
    }),
  };
}

async function readAll(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe("POST /api/chat", () => {
  it("streams SSE and persists both user + assistant turns", async () => {
    await seedEntry(IDENT.email, "2026-05-20", { note: "ok" });
    mockAiStream(["Hi ", "there"]);
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", {
      method: "POST", body: JSON.stringify({ session_id: "s1", message: "hi" }),
    });
    const res = await handleChat(req, env, IDENT, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/event-stream/);
    const text = await readAll(res.body!);
    expect(text).toContain("Hi ");
    expect(text).toContain("there");
    await waitOnExecutionContext(ctx);
    const turns = await env.DB.prepare(
      "SELECT role, content FROM chat_turns WHERE email=? AND session_id=? ORDER BY id"
    ).bind(IDENT.email, "s1").all();
    expect(turns.results.map((r: any) => r.role)).toEqual(["user", "assistant"]);
    expect((turns.results[1] as any).content).toBe("Hi there");
  });

  it("400s on missing fields", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", { method: "POST", body: JSON.stringify({}) });
    const res = await handleChat(req, env, IDENT, ctx);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/chat/:session_id", () => {
  it("returns turns for the user's session", async () => {
    await env.DB.prepare(
      "INSERT INTO chat_turns (email,session_id,role,content,created_at) VALUES (?,?,?,?,?)"
    ).bind(IDENT.email, "s1", "user", "hi", 1).run();
    const res = await handleGetChatHistory(new Request("https://x/api/chat/s1"), env, IDENT, "s1");
    const json = await res.json() as any[];
    expect(json).toHaveLength(1);
    expect(json[0].content).toBe("hi");
  });
});
