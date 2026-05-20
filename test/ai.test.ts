import { describe, it, expect, vi } from "vitest";
import { chatComplete, streamChat, generateInsight } from "../src/ai";

function makeAi(impl: (model: string, opts: any) => any): Ai {
  return { run: vi.fn(impl) } as unknown as Ai;
}

describe("chatComplete", () => {
  it("uses the primary model on success", async () => {
    const ai = makeAi(async (_, __) => ({ response: "hello" }));
    const out = await chatComplete(ai, [{ role: "user", content: "hi" }]);
    expect(out).toBe("hello");
    expect((ai.run as any).mock.calls[0][0]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("falls back to the small model on primary failure", async () => {
    let calls = 0;
    const ai = makeAi(async (model) => {
      calls++;
      if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") throw new Error("boom");
      return { response: "fallback ok" };
    });
    const out = await chatComplete(ai, [{ role: "user", content: "hi" }]);
    expect(out).toBe("fallback ok");
    expect(calls).toBe(2);
  });

  it("throws when both models fail", async () => {
    const ai = makeAi(async () => { throw new Error("nope"); });
    await expect(chatComplete(ai, [{ role: "user", content: "hi" }])).rejects.toThrow();
  });
});

describe("generateInsight", () => {
  const entries = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, "0")}`,
    mood: 3, energy: 3, anxiety: 2, sleep: 3, note: null,
  }));

  it("returns the AI text when it isn't NONE", async () => {
    const ai = makeAi(async () => ({ response: "Sleep dipped Wed-Thu." }));
    expect(await generateInsight(ai, entries as any)).toBe("Sleep dipped Wed-Thu.");
  });

  it("returns null when AI replies NONE", async () => {
    const ai = makeAi(async () => ({ response: "NONE" }));
    expect(await generateInsight(ai, entries as any)).toBeNull();
  });

  it("trims to 140 chars", async () => {
    const ai = makeAi(async () => ({ response: "x".repeat(200) }));
    const out = await generateInsight(ai, entries as any);
    expect(out!.length).toBeLessThanOrEqual(140);
  });
});

describe("streamChat", () => {
  it("returns a ReadableStream from the AI binding", async () => {
    const fakeStream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: hi\n\n")); controller.close(); },
    });
    const ai = makeAi(async () => fakeStream);
    const stream = await streamChat(ai, [{ role: "user", content: "hi" }]);
    expect(stream).toBeInstanceOf(ReadableStream);
  });
});
