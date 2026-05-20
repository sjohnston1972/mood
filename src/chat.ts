import type { Env, Identity } from "./types";
import { parseChatInput, ValidationError } from "./schema";
import { insertChatTurn, listChatTurns, listEntries } from "./db";
import { streamChat, SYSTEM_PROMPT_CHAT, type ChatMessage } from "./ai";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function daysAgoUtc(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }

async function buildMessages(env: Env, email: string, session_id: string, userMessage: string): Promise<ChatMessage[]> {
  const entries = await listEntries(env.DB, email, daysAgoUtc(30), todayUtc());
  const compact = entries.map(e => ({
    date: e.date, mood: e.mood, energy: e.energy, anxiety: e.anxiety, sleep: e.sleep,
    note: e.note ? e.note.slice(0, 120) : null,
  }));
  const history = await listChatTurns(env.DB, email, session_id);
  const lastSix = history.slice(-6);
  return [
    { role: "system", content: SYSTEM_PROMPT_CHAT },
    { role: "system", content: `Recent entries (last 30d): ${JSON.stringify(compact)}` },
    ...lastSix.map(t => ({ role: t.role, content: t.content }) as ChatMessage),
    { role: "user", content: userMessage },
  ];
}

export async function handleChat(req: Request, env: Env, ident: Identity, ctx: ExecutionContext): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  let parsed;
  try { parsed = parseChatInput(body); }
  catch (e) {
    if (e instanceof ValidationError) return json(400, { error: e.message });
    throw e;
  }
  await insertChatTurn(env.DB, ident.email, parsed.session_id, "user", parsed.message);

  const messages = await buildMessages(env, ident.email, parsed.session_id, parsed.message);
  const aiStream = await streamChat(env.AI, messages);

  const [forClient, forPersist] = aiStream.tee();

  ctx.waitUntil((async () => {
    const reader = forPersist.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const event = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const line = event.split("\n").find(l => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload) as { response?: string };
          if (obj.response) full += obj.response;
        } catch { /* tolerate */ }
      }
    }
    if (full.length > 0) {
      await insertChatTurn(env.DB, ident.email, parsed.session_id, "assistant", full);
    }
  })().catch((e) => console.error("chat persist failed", e)));

  return new Response(forClient, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  });
}

export async function handleGetChatHistory(
  _req: Request, env: Env, ident: Identity, session_id: string,
): Promise<Response> {
  const turns = await listChatTurns(env.DB, ident.email, session_id);
  return json(200, turns);
}
