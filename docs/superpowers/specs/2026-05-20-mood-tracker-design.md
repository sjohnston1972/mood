# Mood Tracker — Design Spec

**Date:** 2026-05-20
**Domain:** `mood.clydeford.net`
**Stack:** Cloudflare Workers + D1 + Workers AI + Access (MFA)

## 1. Goal

A single-user mood tracker, deployed to Cloudflare, that:

- Captures a daily entry on four 1–5 scales (mood, energy, anxiety, sleep) plus an optional note.
- Surfaces history at a glance (calendar heatmap + trend chart).
- Hosts an AI chat companion (floating "chat-head" bubble) that reflects, analyses trends, suggests coping strategies, and proactively flags patterns.
- Is mobile-first, simple, and gated behind the user's existing Cloudflare Access MFA policy.

## 2. Architecture

```
Browser (mobile-first SPA)
   └─ HTTPS → mood.clydeford.net
        └─ Cloudflare Access (MFA policy) — injects Cf-Access-Jwt-Assertion + email header
             └─ Worker  (single project: mood-tracker)
                  ├─ static assets (index.html, app.js, styles.css)
                  ├─ JSON API (/api/*)
                  ├─ D1 binding         → entries, chat_turns, insights
                  ├─ KV binding         → JWKS cache + latest insight cache
                  └─ AI binding         → @cf/meta/llama-3.3-70b-instruct-fp8-fast
                                          (fallback: @cf/meta/llama-3.1-8b-instruct)
```

One Worker only. Static assets ship in the bundle via the Workers `assets` binding; no separate Pages project. The custom domain route `mood.clydeford.net/*` is bound to the Worker.

## 3. Identity & auth

- The whole hostname sits behind a Cloudflare Access application using the user's existing MFA policy.
- Every Worker request is expected to carry `Cf-Access-Jwt-Assertion`.
- The Worker verifies the JWT against the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`). JWKS are cached in KV for 1 hour.
- The verified `email` claim is the user identifier on every row. JWT verification (not just trusting the email header) prevents header-spoof if Access is ever bypassed or misconfigured.
- Requests without a valid JWT return `401`. There is no app-level login UI.

## 4. Data model (D1)

```sql
-- One row per (user, day). PUT is upsert.
CREATE TABLE entries (
  email      TEXT NOT NULL,
  date       TEXT NOT NULL,            -- 'YYYY-MM-DD' in user's TZ
  mood       INTEGER NOT NULL,         -- 1-5  (1=low,  5=great)
  energy     INTEGER NOT NULL,         -- 1-5  (1=drained, 5=buzzing)
  anxiety    INTEGER NOT NULL,         -- 1-5  (1=calm,    5=very anxious)
  sleep      INTEGER NOT NULL,         -- 1-5  (1=poor,    5=excellent)
  note       TEXT,                     -- optional, max 2000 chars
  tz         TEXT NOT NULL,            -- IANA tz at save time
  created_at INTEGER NOT NULL,         -- unix seconds
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, date)
);
CREATE INDEX entries_by_email_date ON entries(email, date DESC);

-- Chat turns, grouped by session_id. A new session starts each cold-open of the bubble.
CREATE TABLE chat_turns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,            -- 'user' | 'assistant'
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX chat_by_session ON chat_turns(email, session_id, id);

-- Proactive insights generated after each entry save.
CREATE TABLE insights (
  email      TEXT NOT NULL,
  date       TEXT NOT NULL,
  text       TEXT NOT NULL,            -- one-liner, <= 140 chars
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, date)
);
```

Notes:
- All four metrics use a uniform 1–5 scale so the UI can render five-emoji rows for each and the AI receives consistent inputs.
- `anxiety` is stored with the natural-language polarity (5 = very anxious), and the AI prompt makes that explicit so it doesn't invert.
- KV stores the latest insight under `insight:<email>` as `{date,text}` for cheap reads on app open.

## 5. API

All routes scoped to the verified Access email.

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/entries` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (default last 60 days) | `Entry[]` |
| GET | `/api/entries/today` | — | `Entry \| null` |
| PUT | `/api/entries/:date` | `{mood,energy,anxiety,sleep,note?,tz}` | `Entry` (and triggers async insight job) |
| GET | `/api/insight` | — | `{date,text} \| null` |
| POST | `/api/chat` | `{session_id, message}` | Server-Sent Events stream of assistant tokens |
| GET | `/api/chat/:session_id` | — | `ChatTurn[]` |

Validation: a small schema checker rejects PUTs where any of `mood/energy/anxiety/sleep` is not an integer in 1..5, where `note` exceeds 2000 chars, or where `tz` is not a recognisable IANA string (parsed via `Intl.DateTimeFormat(tz)`).

Errors:
- 400 — validation failure
- 401 — missing / invalid Access JWT
- 404 — chat session not owned by caller
- 500 — surface a generic JSON `{error: "..."}`; log structured error via `console.error` (collected by Workers logs / Logpush)

## 6. AI behaviour

**Primary model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
**Fallback:** `@cf/meta/llama-3.1-8b-instruct` if the primary returns a non-2xx after one retry.

**System prompt (chat):**
> You are a warm, brief mood companion. The user logs daily metrics on 1–5 scales (mood, energy, anxiety, sleep) plus an optional note. Note: anxiety polarity is "5 = very anxious, 1 = calm". Reflect on what they share, ask one gentle follow-up, and offer evidence-based coping when helpful (breathing, walks, journaling, sleep hygiene). Never give clinical or medical advice — if the user describes self-harm or crisis, gently signpost a relevant helpline and suggest speaking to a professional. Keep replies to 2–4 sentences unless asked to elaborate.

**Context passed to each chat turn:**
- Compact JSON of the last 30 days of entries (`[{date,mood,energy,anxiety,sleep,note}]`).
- Last 6 messages of the current session (user + assistant combined, oldest dropped first). Keeps token cost flat as a session grows.

**Proactive insight job** (runs after each PUT, fire-and-forget via `ctx.waitUntil`):
1. Fetch last 14 entries.
2. Call AI with a small prompt: *"Given these 14 days of mood/energy/anxiety/sleep entries, write one short, kind, specific observation (≤140 chars). If nothing notable, output exactly `NONE`."*
3. If response is not `NONE`, write to `insights` table and mirror to KV.
4. Frontend `/api/insight` returns the cached value; banner shows on next open, dismissable per-day.

Coping suggestions are part of normal chat — steered by the system prompt — not a separate surface.

## 7. Frontend

Vanilla JS (no framework) + a single CSS file. Mobile-first; tested at 360 × 640 minimum.

**Layout:**
- One viewport, three screens reachable via a bottom segmented control: **Today**, **History**, (chat is the floating bubble, always present).
- Floating chat-head: 48 px circle, bottom-right, 16 px from edge; tap → slide-up panel covering 70 % of viewport; pull-down or backdrop tap to dismiss.

**Today view (matches mockup A):**
- Greeting + date.
- Four labelled rows of 5 emoji buttons each (mood, energy, anxiety, sleep).
- Optional multi-line note field.
- Single "Save" button at the bottom; on save → confetti-free success state, panel slides to show today's recorded entry plus the proactive insight (if any).
- If today's entry already exists, the view pre-fills and the button reads "Update".

**History view (combines mockups A + B):**
- Top half: 8-week calendar heatmap with a metric toggle (Mood / Energy / Anxiety / Sleep). Cells coloured on a 5-step gradient.
- Bottom half: 30-day trend chart with all four metrics overlaid; tappable legend toggles individual lines. AI insight banner appears above the chart when present.

**Chat bubble panel:**
- Header: avatar + "Mood companion" label + close.
- Scrolling message list, newest at bottom, streamed token-by-token via SSE.
- Composer: single-line input + send. Enter sends; Shift+Enter newline on desktop.
- Cold-open of the bubble starts a new `session_id` (UUIDv4). The session persists for as long as the panel stays open in this tab; closing the panel doesn't end it, but a page reload does.

**Accessibility:**
- All emoji buttons have an `aria-label` describing the level (e.g. "Mood: 4 of 5 — good").
- Colour is never the only signal — heatmap legend includes text labels, chart lines have distinct strokes.
- Tap targets ≥ 44 × 44 px.

**Theme:** warm-neutral background (`#f7f5ef`), ink near-black (`#1a1a1a`), accents: amber (`#ffd166`), slate-blue (`#6c8ead`), coral (`#e8a08a`).

## 8. Project structure

```
mental/
├─ wrangler.toml
├─ package.json
├─ tsconfig.json
├─ migrations/
│   └─ 0001_init.sql                  # the CREATE TABLEs above
├─ public/                            # static assets bundled into Worker
│   ├─ index.html
│   ├─ app.js
│   └─ styles.css
├─ src/
│   ├─ index.ts                       # Worker entry: routing
│   ├─ auth.ts                        # Access JWT verification + JWKS cache
│   ├─ entries.ts                     # GET/PUT entry handlers
│   ├─ chat.ts                        # SSE chat handler
│   ├─ insight.ts                     # proactive insight job + GET handler
│   ├─ ai.ts                          # Workers AI wrapper with fallback
│   ├─ db.ts                          # D1 query helpers
│   ├─ schema.ts                      # request validation
│   └─ types.ts                       # shared types
├─ test/
│   ├─ auth.test.ts
│   ├─ entries.test.ts
│   ├─ chat.test.ts
│   └─ insight.test.ts
└─ docs/superpowers/specs/
    └─ 2026-05-20-mood-tracker-design.md
```

Each `src/*.ts` file does one thing and is independently testable. `index.ts` is a thin router.

## 9. Deployment

**`wrangler.toml`** declares:
- `name = "mood-tracker"`
- `main = "src/index.ts"`
- `compatibility_date` (current)
- `assets = { directory = "./public", binding = "ASSETS" }`
- `[[d1_databases]]` — `binding = "DB"`, `database_name = "mood"`
- `[[kv_namespaces]]` — `binding = "KV"`
- `[ai] binding = "AI"`
- `routes = [{ pattern = "mood.clydeford.net/*", custom_domain = true }]`

**Setup steps (one-time, manual but documented):**
1. `wrangler d1 create mood` → paste id into `wrangler.toml`.
2. `wrangler kv:namespace create MOOD_KV` → paste id.
3. `wrangler d1 migrations apply mood --remote`.
4. Add the `mood.clydeford.net` DNS record (proxied) in the Cloudflare dashboard.
5. Create a Cloudflare Access application on `mood.clydeford.net` with the existing MFA policy.
6. `wrangler deploy`.

A `mood-staging.clydeford.net` route is used for verification before swapping traffic.

## 10. Testing

- **Unit:** validation, JWT verifier (with mocked JWKS), prompt builders, D1 query helpers — via `vitest` + `@cloudflare/vitest-pool-workers`.
- **Integration:** Worker request handlers against an in-memory D1 (provided by the vitest pool). AI binding is replaced with a deterministic stub returning canned responses.
- **Manual smoke test:** deploy to `mood-staging`, log a real entry, open the chat bubble, confirm streaming works end-to-end and that the proactive insight appears after a fresh entry.

## 11. Out of scope (deliberate)

- Multi-user / sharing / social features.
- Push notifications. Proactive insights appear in-app on next open.
- Streak counters or gamification — design choice to keep the tool calm.
- Native mobile apps. Mobile web only; the SPA can be added to the home screen as a PWA later (separate spec).
- Export / backup UI. D1 SQL access via `wrangler d1 export` is the backup path for now.
- Editing entries from past days more than 7 days back. The UI lets the user backfill or correct up to 7 days; older corrections require a direct DB edit. (Keeps the UI simple.)

## 12. Open questions (none blocking)

- Eventually: should chat sessions auto-summarise into a memory blob older than 6 turns? Defer until token costs become a concern.
- Eventually: should the heatmap show "no entry" cells differently from "low mood" cells? Yes — use a hatched / striped fill. Documented here, implemented in the plan.
