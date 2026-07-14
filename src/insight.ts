import type { Env, Identity } from "./types";
import { listEntries, upsertInsight, getLatestInsight } from "./db";
import { generateInsight } from "./ai";

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoUtc(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function runInsightJob(env: Env, email: string): Promise<void> {
  const entries = await listEntries(env.DB, email, daysAgoUtc(14), todayUtc());
  if (entries.length === 0) return;
  const text = await generateInsight(env.AI, entries);
  // Model said NONE: keep the last insight in place. Per the design, /api/insight
  // "shows the latest on next open", so we intentionally do not clobber it here.
  if (!text) return;
  const today = todayUtc();
  await upsertInsight(env.DB, email, today, text);
  await env.KV.put(
    `insight:${email}`,
    JSON.stringify({ date: today, text }),
    { expirationTtl: 60 * 60 * 24 * 40 },
  );
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function handleGetInsight(_req: Request, env: Env, ident: Identity): Promise<Response> {
  const cached = await env.KV.get(`insight:${ident.email}`, "json") as { date: string; text: string } | null;
  if (cached) return json(200, cached);
  const row = await getLatestInsight(env.DB, ident.email);
  if (!row) return json(200, null);
  return json(200, { date: row.date, text: row.text });
}
