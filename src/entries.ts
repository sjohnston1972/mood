import type { Env, Identity } from "./types";
import { parseEntryInput, parseDateParam, ValidationError } from "./schema";
import { listEntries, getEntryByDate, upsertEntry } from "./db";
import { runInsightJob } from "./insight";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function todayInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function handleGetEntries(req: Request, env: Env, ident: Identity): Promise<Response> {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const tzParam = url.searchParams.get("tz");
  try {
    const tz = tzParam && isValidTz(tzParam) ? tzParam : "UTC";
    const today = todayInTz(tz);
    const dToday = new Date(`${today}T00:00:00Z`);
    const defaultFrom = new Date(dToday); defaultFrom.setUTCDate(dToday.getUTCDate() - 60);
    const from = fromParam ? parseDateParam(fromParam) : defaultFrom.toISOString().slice(0, 10);
    const to = toParam ? parseDateParam(toParam) : today;
    const rows = await listEntries(env.DB, ident.email, from, to);
    return json(200, rows);
  } catch (e) {
    if (e instanceof ValidationError) return json(400, { error: e.message });
    throw e;
  }
}

export async function handleGetTodayEntry(req: Request, env: Env, ident: Identity): Promise<Response> {
  const tzParam = new URL(req.url).searchParams.get("tz");
  const tz = tzParam && isValidTz(tzParam) ? tzParam : "UTC";
  const today = todayInTz(tz);
  const entry = await getEntryByDate(env.DB, ident.email, today);
  return json(200, entry);
}

export async function handlePutEntry(
  req: Request, env: Env, ident: Identity, dateParam: string, ctx: ExecutionContext,
): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  try {
    const date = parseDateParam(dateParam);
    const input = parseEntryInput(body);
    await upsertEntry(env.DB, ident.email, date, input);
    const saved = await getEntryByDate(env.DB, ident.email, date);
    ctx.waitUntil(runInsightJob(env, ident.email).catch((e) => console.error("insight job failed", e)));
    return json(200, saved);
  } catch (e) {
    if (e instanceof ValidationError) return json(400, { error: e.message });
    throw e;
  }
}
