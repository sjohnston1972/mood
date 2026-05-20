import type { Env } from "./types";

export async function runInsightJob(_env: Env, _email: string): Promise<void> { /* implemented next */ }

export async function handleGetInsight(_req: Request, _env: Env, _ident: { email: string }): Promise<Response> {
  return new Response("null", { headers: { "content-type": "application/json" } });
}
