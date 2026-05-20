import type { Entry } from "./types";

const PRIMARY = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK = "@cf/meta/llama-3.1-8b-instruct";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

export const SYSTEM_PROMPT_CHAT = `You are a warm, brief mood companion. The user logs daily metrics on 1-5 scales (mood, energy, anxiety, sleep) plus an optional note. Note: anxiety polarity is "5 = very anxious, 1 = calm". Reflect on what they share, ask one gentle follow-up, and offer evidence-based coping when helpful (breathing, walks, journaling, sleep hygiene). Never give clinical or medical advice — if the user describes self-harm or crisis, gently signpost a relevant helpline and suggest speaking to a professional. Keep replies to 2-4 sentences unless asked to elaborate.`;

const SYSTEM_PROMPT_INSIGHT = `You are reading 14 days of mood-tracker entries. Write ONE short, kind, specific observation (max 140 characters). If nothing notable, output exactly the word NONE.`;

async function runWithFallback(
  ai: Ai, messages: ChatMessage[], opts: { stream?: boolean } = {},
): Promise<unknown> {
  try {
    return await ai.run(PRIMARY as any, { messages, ...opts });
  } catch {
    return await ai.run(FALLBACK as any, { messages, ...opts });
  }
}

export async function chatComplete(ai: Ai, messages: ChatMessage[]): Promise<string> {
  const out = await runWithFallback(ai, messages) as { response?: string };
  if (!out || typeof out.response !== "string") throw new Error("AI returned no response");
  return out.response;
}

export async function streamChat(ai: Ai, messages: ChatMessage[]): Promise<ReadableStream> {
  const stream = await runWithFallback(ai, messages, { stream: true });
  return stream as ReadableStream;
}

export async function generateInsight(ai: Ai, entries: Entry[]): Promise<string | null> {
  const compact = entries.map(e => ({
    date: e.date, mood: e.mood, energy: e.energy, anxiety: e.anxiety, sleep: e.sleep,
    note: e.note ? e.note.slice(0, 120) : null,
  }));
  const text = await chatComplete(ai, [
    { role: "system", content: SYSTEM_PROMPT_INSIGHT },
    { role: "user", content: JSON.stringify(compact) },
  ]);
  const trimmed = text.trim();
  if (trimmed.toUpperCase() === "NONE" || trimmed === "") return null;
  return trimmed.length > 140 ? trimmed.slice(0, 137).trimEnd() + "..." : trimmed;
}
