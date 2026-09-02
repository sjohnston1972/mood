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

  it("does not orphan the user turn when both models fail to start a stream", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (env as any).AI = { run: vi.fn().mockRejectedValue(new Error("model unavailable")) };
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", {
      method: "POST", body: JSON.stringify({ session_id: "s2", message: "hi" }),
    });
    const res = await handleChat(req, env, IDENT, ctx);
    // The client gets a clear failure, not a hung 200 stream.
    expect(res.ok).toBe(false);
    await waitOnExecutionContext(ctx);

    const turns = await env.DB.prepare(
      "SELECT role, content FROM chat_turns WHERE email=? AND session_id=? ORDER BY id"
    ).bind(IDENT.email, "s2").all();
    // The critical assertion: no lone user turn with no assistant reply.
    expect(turns.results).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("does not orphan the user turn when the stream yields no text", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAiStream([]); // only the [DONE] marker, no response chunks
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", {
      method: "POST", body: JSON.stringify({ session_id: "s3", message: "hi" }),
    });
    const res = await handleChat(req, env, IDENT, ctx);
    expect(res.status).toBe(200);
    await readAll(res.body!);
    await waitOnExecutionContext(ctx);

    const turns = await env.DB.prepare(
      "SELECT role, content FROM chat_turns WHERE email=? AND session_id=? ORDER BY id"
    ).bind(IDENT.email, "s3").all();
    expect(turns.results).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("does not orphan the user turn when the stream errors mid-response with no text yet", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (env as any).AI = {
      run: vi.fn().mockImplementation(async () => new ReadableStream({
        start(controller) { controller.error(new Error("mid-stream boom")); },
      })),
    };
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", {
      method: "POST", body: JSON.stringify({ session_id: "s4", message: "hi" }),
    });
    const res = await handleChat(req, env, IDENT, ctx);
    expect(res.status).toBe(200);
    // The client-facing stream also errors — just make sure reading it doesn't hang.
    await readAll(res.body!).catch(() => {});
    await waitOnExecutionContext(ctx);

    const turns = await env.DB.prepare(
      "SELECT role, content FROM chat_turns WHERE email=? AND session_id=? ORDER BY id"
    ).bind(IDENT.email, "s4").all();
    expect(turns.results).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("persists a partial reply (and its user turn) when the stream errors after some text arrived", async () => {
    (env as any).AI = {
      run: vi.fn().mockImplementation(async () => {
        // Use pull() rather than doing both in start(): enqueuing then
        // erroring within the same start() tick discards the queued chunk
        // before any reader has consumed it (per the streams spec, an
        // errored stream's queue is reset). pull() lets a real read happen
        // in between, so this genuinely exercises "some text arrived, then
        // the stream failed" rather than "nothing was ever readable".
        let pulls = 0;
        return new ReadableStream({
          pull(controller) {
            pulls++;
            if (pulls === 1) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: "Partial" })}\n\n`));
            } else {
              controller.error(new Error("mid-stream boom"));
            }
          },
        });
      }),
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", {
      method: "POST", body: JSON.stringify({ session_id: "s5", message: "hi" }),
    });
    const res = await handleChat(req, env, IDENT, ctx);
    expect(res.status).toBe(200);
    await readAll(res.body!).catch(() => {});
    await waitOnExecutionContext(ctx);

    const turns = await env.DB.prepare(
      "SELECT role, content FROM chat_turns WHERE email=? AND session_id=? ORDER BY id"
    ).bind(IDENT.email, "s5").all();
    // Either both turns are there (never a lone user turn), or neither is.
    expect(turns.results.map((r: any) => r.role)).toEqual(["user", "assistant"]);
    expect((turns.results[1] as any).content).toBe("Partial");
    errSpy.mockRestore();
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
