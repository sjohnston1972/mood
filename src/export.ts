import type { Env, Identity } from "./types";

// GET /api/export — returns the caller's complete data (entries, chat, insights)
// as a downloadable JSON file. Read-only; scoped to the verified email.
export async function handleExport(_req: Request, env: Env, ident: Identity): Promise<Response> {
  const email = ident.email;
  const [entries, chat, insights] = await Promise.all([
    env.DB.prepare(
      `SELECT date,mood,energy,anxiety,sleep,note,tz,created_at,updated_at
         FROM entries WHERE email = ?1 ORDER BY date ASC`,
    ).bind(email).all(),
    env.DB.prepare(
      `SELECT id,session_id,role,content,created_at
         FROM chat_turns WHERE email = ?1 ORDER BY id ASC`,
    ).bind(email).all(),
    env.DB.prepare(
      `SELECT date,text,created_at
         FROM insights WHERE email = ?1 ORDER BY date ASC`,
    ).bind(email).all(),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    email,
    entries: entries.results,
    chat_turns: chat.results,
    insights: insights.results,
  };

  const filename = `mood-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
