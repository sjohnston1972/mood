import type { Env, Identity } from "./types";
import { listEntries, upsertInsight, getLatestInsight, deleteInsightsForEmail } from "./db";
import { generateInsight } from "./ai";

// Freshness window: an insight older than this many days is treated as stale
// and is no longer surfaced, even if it's still sitting in KV or D1.
const INSIGHT_MAX_AGE_DAYS = 3;

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoUtc(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function runInsightJob(env: Env, email: string): Promise<void> {
  const entries = await listEntries(env.DB, email, daysAgoUtc(14), todayUtc());
  if (entries.length === 0) return;
  const text = await generateInsight(env.AI, entries);
  if (!text) {
    // Nothing notable today — clear any previously stored insight so a stale
    // observation doesn't keep showing.
    await deleteInsightsForEmail(env.DB, email);
    await env.KV.delete(`insight:${email}`);
    return;
  }
  const today = todayUtc();
  await upsertInsight(env.DB, email, today, text);
  // Belt-and-braces: TTL the KV cache so it self-expires, AND (in
  // handleGetInsight below) check the stored date on read — a TTL alone
  // leaves a window where an expired-but-not-yet-evicted value can still be
  // served.
  await env.KV.put(
    `insight:${email}`,
    JSON.stringify({ date: today, text }),
    { expirationTtl: INSIGHT_MAX_AGE_DAYS * 86400 },
  );
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function isFresh(date: string): boolean {
  return date >= daysAgoUtc(INSIGHT_MAX_AGE_DAYS);
}

export async function handleGetInsight(_req: Request, env: Env, ident: Identity): Promise<Response> {
  const cached = await env.KV.get(`insight:${ident.email}`, "json") as { date: string; text: string } | null;
  if (cached) return json(200, isFresh(cached.date) ? cached : null);
  const row = await getLatestInsight(env.DB, ident.email);
  if (!row) return json(200, null);
  if (!isFresh(row.date)) return json(200, null);
  return json(200, { date: row.date, text: row.text });
}
