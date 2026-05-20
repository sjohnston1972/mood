# Mood

A single-user mood tracker on Cloudflare Workers. Log daily 1–5 ratings across mood, energy, anxiety, and sleep, with a floating AI chat companion. Deployed at `mood.clydeford.net` behind Cloudflare Access.

## Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **Storage:** D1 (SQLite) for entries, chat turns, and insights
- **Cache:** KV for the Access JWKS and the latest proactive insight
- **AI:** Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with `@cf/meta/llama-3.1-8b-instruct` fallback
- **Identity:** Cloudflare Access (Zero Trust) — JWT email claim, verified against cached JWKS
- **Frontend:** vanilla JS + CSS, served by the same Worker via static assets
- **Tests:** vitest with `@cloudflare/vitest-pool-workers`

## Project layout

```
src/        Worker code (router, handlers, db, auth, ai)
public/     SPA shell (HTML / CSS / JS, no build step)
migrations/ D1 SQL migrations
test/       vitest tests for every src module
docs/       design spec, implementation plan, runbook
```

## Local development

```bash
npm install
npm run migrate:local
npm run dev
```

The dev server bypasses Access and falls back to `DEV_FAKE_EMAIL` from `.dev.vars`.

## Tests

```bash
npm test          # 58 tests across 8 files
npm run typecheck
```

## Deploy

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `.env` (gitignored).

```bash
set -a; source .env; set +a
npm run migrate:remote
npm run deploy
```

See `docs/runbook.md` for the production runbook (resources, Access app, deploy steps).

## Architecture

One Worker serves the SPA, a JSON API under `/api/*`, and proxies streaming chat to Workers AI. Every API request is gated by an Access JWT, verified against the team's JWKS (cached in KV for 1h). The user's email from the JWT scopes all reads and writes.

Proactive insights run as a `ctx.waitUntil` job after each entry save: the last 14 days of entries are sent to the model, which either returns a short observation or the literal string `NONE`. Non-NONE responses are persisted to D1 and cached in KV.

Chat is SSE — the AI stream is teed: one branch goes to the client, the other accumulates the full assistant turn and persists it after `[DONE]`.
