import type { Env } from "./types";
import { identify } from "./auth";
import { handleGetEntries, handleGetTodayEntry, handlePutEntry } from "./entries";
import { handleGetInsight } from "./insight";
import { handleChat, handleGetChatHistory } from "./chat";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(req);
    }

    const ident = await identify(req, env);
    if (!ident) return json(401, { error: "unauthorised" });

    if (url.pathname === "/api/entries" && req.method === "GET") {
      return handleGetEntries(req, env, ident);
    }
    if (url.pathname === "/api/entries/today" && req.method === "GET") {
      return handleGetTodayEntry(req, env, ident);
    }
    const putEntryMatch = url.pathname.match(/^\/api\/entries\/(\d{4}-\d{2}-\d{2})$/);
    if (putEntryMatch && req.method === "PUT") {
      return handlePutEntry(req, env, ident, putEntryMatch[1], ctx);
    }

    if (url.pathname === "/api/insight" && req.method === "GET") {
      return handleGetInsight(req, env, ident);
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      return handleChat(req, env, ident, ctx);
    }
    const chatHistMatch = url.pathname.match(/^\/api\/chat\/([A-Za-z0-9_-]+)$/);
    if (chatHistMatch && req.method === "GET") {
      return handleGetChatHistory(req, env, ident, chatHistMatch[1]);
    }

    return json(404, { error: "not found" });
  },
} satisfies ExportedHandler<Env>;
