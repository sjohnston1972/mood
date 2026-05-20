# Mood Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user mood tracker on Cloudflare Workers — daily 1–5 entries across four metrics with a floating AI chat companion — deployed to `mood.clydeford.net` behind Cloudflare Access MFA.

**Architecture:** One Worker serves a vanilla-JS SPA, a JSON API, and proxies chat to Workers AI. D1 stores entries / chat turns / insights. KV caches the JWKS for Access JWT verification and the latest proactive insight. Identity comes from the verified Access JWT email claim.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), KV, Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` with `@cf/meta/llama-3.1-8b-instruct` fallback), vitest + `@cloudflare/vitest-pool-workers`, vanilla JS + CSS frontend.

**Spec:** `docs/superpowers/specs/2026-05-20-mood-tracker-design.md`

---

## File map

| Path | Responsibility |
|---|---|
| `wrangler.toml` | Worker config: bindings (DB, KV, AI, ASSETS), routes, compatibility date |
| `package.json` | Dependencies + scripts |
| `tsconfig.json` | TypeScript config |
| `vitest.config.ts` | Vitest with the Cloudflare workers pool |
| `migrations/0001_init.sql` | D1 schema (entries, chat_turns, insights) |
| `src/types.ts` | Shared TS types (Entry, ChatTurn, Insight, Env) |
| `src/schema.ts` | Pure request-body validators |
| `src/db.ts` | D1 query helpers |
| `src/auth.ts` | Access JWT verification + JWKS cache (Web Crypto, no deps) |
| `src/ai.ts` | Workers AI wrapper with model fallback |
| `src/entries.ts` | GET/PUT entries handlers |
| `src/insight.ts` | Insight generation job + GET handler |
| `src/chat.ts` | SSE chat handler |
| `src/index.ts` | Router + 401 / 404 fallback |
| `public/index.html` | SPA shell |
| `public/styles.css` | Theme + layout |
| `public/app.js` | Today, History, Chat behaviour |
| `test/helpers.ts` | Shared test fixtures (mock env, signed JWT, seed data) |
| `test/*.test.ts` | One file per `src/*.ts` unit-or-integration test |

---

## Task 1: Scaffold project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `vitest.config.ts`
- Create: `.dev.vars`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mood-tracker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "migrate:local": "wrangler d1 migrations apply mood --local",
    "migrate:remote": "wrangler d1 migrations apply mood --remote"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240725.0",
    "typescript": "^5.4.0",
    "vitest": "~1.5.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `wrangler.toml`**

```toml
name = "mood-tracker"
main = "src/index.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./public"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "mood"
database_id = "REPLACE_WITH_ID_FROM_WRANGLER_D1_CREATE"
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "KV"
id = "REPLACE_WITH_ID_FROM_WRANGLER_KV_CREATE"

[ai]
binding = "AI"

[vars]
ACCESS_TEAM_DOMAIN = "REPLACE_WITH_<team>.cloudflareaccess.com"
ACCESS_AUD = "REPLACE_WITH_APPLICATION_AUD"

[[routes]]
pattern = "mood.clydeford.net/*"
custom_domain = true
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
          kvNamespaces: ["KV"],
          bindings: {
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            ACCESS_AUD: "test-aud",
          },
        },
      },
    },
  },
});
```

- [ ] **Step 5: Create `.dev.vars`**

```
# Used only by `wrangler dev` locally; in prod, Access provides these.
DEV_FAKE_EMAIL=stevie.johnston@gmail.com
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: dependencies resolve, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml vitest.config.ts .dev.vars
git commit -m "chore: scaffold worker project (wrangler, vitest, tsconfig)"
```

Note: `.dev.vars` is in `.gitignore`; if `git add` skips it, that's correct. The example block above is documentation for the engineer to recreate it locally.

---

## Task 2: D1 schema migration

**Files:**
- Create: `migrations/0001_init.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/0001_init.sql

CREATE TABLE entries (
  email      TEXT NOT NULL,
  date       TEXT NOT NULL,
  mood       INTEGER NOT NULL,
  energy     INTEGER NOT NULL,
  anxiety    INTEGER NOT NULL,
  sleep      INTEGER NOT NULL,
  note       TEXT,
  tz         TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email, date)
);

CREATE INDEX entries_by_email_date ON entries(email, date DESC);

CREATE TABLE chat_turns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX chat_by_session ON chat_turns(email, session_id, id);

CREATE TABLE insights (
  email      TEXT NOT NULL,
  date       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (email, date)
);
```

- [ ] **Step 2: Verify migration parses by running it locally**

Run: `npx wrangler d1 migrations apply mood --local`
Expected: applies cleanly. If `mood` doesn't exist yet locally, the local SQLite file is created.

- [ ] **Step 3: Commit**

```bash
git add migrations/0001_init.sql
git commit -m "feat(db): initial schema for entries, chat_turns, insights"
```

---

## Task 3: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create the types module**

```ts
// src/types.ts

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_FAKE_EMAIL?: string;
}

export interface Entry {
  date: string;
  mood: number;
  energy: number;
  anxiety: number;
  sleep: number;
  note: string | null;
  tz: string;
  created_at: number;
  updated_at: number;
}

export interface EntryInput {
  mood: number;
  energy: number;
  anxiety: number;
  sleep: number;
  note?: string;
  tz: string;
}

export interface ChatTurn {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

export interface Insight {
  date: string;
  text: string;
  created_at: number;
}

export interface Identity {
  email: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): shared domain types"
```

---

## Task 4: Validation schema

**Files:**
- Create: `src/schema.ts`
- Create: `test/schema.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/schema.test.ts
import { describe, it, expect } from "vitest";
import { parseEntryInput, parseChatInput, parseDateParam } from "../src/schema";

describe("parseEntryInput", () => {
  const valid = { mood: 4, energy: 3, anxiety: 2, sleep: 4, tz: "Europe/London" };

  it("accepts a valid body", () => {
    expect(parseEntryInput(valid)).toEqual({ ...valid, note: undefined });
  });

  it("accepts an optional note", () => {
    expect(parseEntryInput({ ...valid, note: "ok day" }).note).toBe("ok day");
  });

  it.each(["mood", "energy", "anxiety", "sleep"])("rejects %s out of 1..5", (k) => {
    expect(() => parseEntryInput({ ...valid, [k]: 0 })).toThrow(/1..5/);
    expect(() => parseEntryInput({ ...valid, [k]: 6 })).toThrow(/1..5/);
    expect(() => parseEntryInput({ ...valid, [k]: 2.5 })).toThrow(/integer/);
  });

  it("rejects missing tz", () => {
    const { tz, ...rest } = valid;
    expect(() => parseEntryInput(rest)).toThrow(/tz/);
  });

  it("rejects unrecognised tz", () => {
    expect(() => parseEntryInput({ ...valid, tz: "Mars/Olympus" })).toThrow(/tz/);
  });

  it("rejects a note over 2000 chars", () => {
    expect(() => parseEntryInput({ ...valid, note: "x".repeat(2001) })).toThrow(/note/);
  });

  it("rejects non-object body", () => {
    expect(() => parseEntryInput(null)).toThrow();
    expect(() => parseEntryInput("hi")).toThrow();
  });
});

describe("parseChatInput", () => {
  it("accepts a valid body", () => {
    expect(parseChatInput({ session_id: "abc", message: "hello" }))
      .toEqual({ session_id: "abc", message: "hello" });
  });

  it("rejects empty message", () => {
    expect(() => parseChatInput({ session_id: "abc", message: "" })).toThrow(/message/);
  });

  it("rejects message over 4000 chars", () => {
    expect(() => parseChatInput({ session_id: "abc", message: "x".repeat(4001) })).toThrow();
  });

  it("rejects missing session_id", () => {
    expect(() => parseChatInput({ message: "hi" })).toThrow(/session_id/);
  });
});

describe("parseDateParam", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(parseDateParam("2026-05-20")).toBe("2026-05-20");
  });

  it("rejects malformed dates", () => {
    expect(() => parseDateParam("2026/05/20")).toThrow();
    expect(() => parseDateParam("20-05-2026")).toThrow();
    expect(() => parseDateParam("not-a-date")).toThrow();
  });

  it("rejects impossible dates", () => {
    expect(() => parseDateParam("2026-13-01")).toThrow();
    expect(() => parseDateParam("2026-02-30")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npm test -- schema`
Expected: failures because `src/schema.ts` doesn't exist.

- [ ] **Step 3: Implement `src/schema.ts`**

```ts
// src/schema.ts
import type { EntryInput } from "./types";

export class ValidationError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ValidationError(msg);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertIntInRange(v: unknown, name: string, lo: number, hi: number): asserts v is number {
  assert(typeof v === "number" && Number.isFinite(v), `${name} must be a number`);
  assert(Number.isInteger(v), `${name} must be an integer`);
  assert(v >= lo && v <= hi, `${name} must be in ${lo}..${hi}`);
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseEntryInput(body: unknown): EntryInput {
  assert(isPlainObject(body), "body must be an object");
  for (const k of ["mood", "energy", "anxiety", "sleep"] as const) {
    assertIntInRange(body[k], k, 1, 5);
  }
  assert(typeof body.tz === "string" && body.tz.length > 0, "tz is required");
  assert(isValidTz(body.tz), `tz "${body.tz}" is not recognised`);
  let note: string | undefined;
  if (body.note !== undefined && body.note !== null) {
    assert(typeof body.note === "string", "note must be a string");
    assert(body.note.length <= 2000, "note must be <= 2000 chars");
    note = body.note;
  }
  return {
    mood: body.mood as number,
    energy: body.energy as number,
    anxiety: body.anxiety as number,
    sleep: body.sleep as number,
    tz: body.tz,
    note,
  };
}

export interface ChatInput {
  session_id: string;
  message: string;
}

export function parseChatInput(body: unknown): ChatInput {
  assert(isPlainObject(body), "body must be an object");
  assert(typeof body.session_id === "string" && body.session_id.length > 0, "session_id is required");
  assert(typeof body.message === "string", "message must be a string");
  assert(body.message.trim().length > 0, "message must not be empty");
  assert(body.message.length <= 4000, "message must be <= 4000 chars");
  return { session_id: body.session_id, message: body.message };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateParam(s: string): string {
  const m = DATE_RE.exec(s);
  assert(m, `date must be YYYY-MM-DD, got "${s}"`);
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  assert(
    !Number.isNaN(date.getTime())
      && date.getUTCFullYear() === Number(y)
      && date.getUTCMonth() + 1 === Number(mo)
      && date.getUTCDate() === Number(d),
    `date "${s}" is not a real calendar date`,
  );
  return s;
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `npm test -- schema`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts test/schema.test.ts
git commit -m "feat(schema): request body and date validators"
```

---

## Task 5: D1 query helpers

**Files:**
- Create: `src/db.ts`
- Create: `test/db.test.ts`
- Create: `test/helpers.ts`

- [ ] **Step 1: Create `test/helpers.ts` with seed utilities**

```ts
// test/helpers.ts
import { env } from "cloudflare:test";

export async function applyMigrations(): Promise<void> {
  // Migrations are auto-applied by the workers pool from `migrations_dir`.
  // This helper exists for explicit truncation between tests.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entries"),
    env.DB.prepare("DELETE FROM chat_turns"),
    env.DB.prepare("DELETE FROM insights"),
  ]);
}

export async function seedEntry(email: string, date: string, overrides: Partial<{
  mood: number; energy: number; anxiety: number; sleep: number; note: string | null;
}> = {}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO entries (email,date,mood,energy,anxiety,sleep,note,tz,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    email, date,
    overrides.mood ?? 3,
    overrides.energy ?? 3,
    overrides.anxiety ?? 2,
    overrides.sleep ?? 3,
    overrides.note ?? null,
    "Europe/London",
    now, now,
  ).run();
}
```

- [ ] **Step 2: Write failing tests for `db.ts`**

```ts
// test/db.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { upsertEntry, getEntryByDate, listEntries, insertChatTurn, listChatTurns, upsertInsight, getLatestInsight } from "../src/db";
import { applyMigrations, seedEntry } from "./helpers";

beforeEach(applyMigrations);

const EMAIL = "u@example.com";

describe("upsertEntry / getEntryByDate", () => {
  it("inserts a new entry and reads it back", async () => {
    await upsertEntry(env.DB, EMAIL, "2026-05-20", {
      mood: 4, energy: 3, anxiety: 2, sleep: 4, tz: "Europe/London", note: "ok",
    });
    const got = await getEntryByDate(env.DB, EMAIL, "2026-05-20");
    expect(got).toMatchObject({ date: "2026-05-20", mood: 4, note: "ok" });
  });

  it("updates on conflict and bumps updated_at", async () => {
    await upsertEntry(env.DB, EMAIL, "2026-05-20", {
      mood: 4, energy: 3, anxiety: 2, sleep: 4, tz: "Europe/London",
    });
    const first = await getEntryByDate(env.DB, EMAIL, "2026-05-20");
    await new Promise((r) => setTimeout(r, 1100)); // ensure unix second tick
    await upsertEntry(env.DB, EMAIL, "2026-05-20", {
      mood: 5, energy: 3, anxiety: 2, sleep: 4, tz: "Europe/London",
    });
    const second = await getEntryByDate(env.DB, EMAIL, "2026-05-20");
    expect(second!.mood).toBe(5);
    expect(second!.updated_at).toBeGreaterThan(first!.updated_at);
    expect(second!.created_at).toBe(first!.created_at);
  });

  it("scopes by email", async () => {
    await upsertEntry(env.DB, "a@x", "2026-05-20", { mood: 4, energy: 3, anxiety: 2, sleep: 4, tz: "UTC" });
    expect(await getEntryByDate(env.DB, "b@x", "2026-05-20")).toBeNull();
  });
});

describe("listEntries", () => {
  it("returns the date range for the user, newest first", async () => {
    await seedEntry(EMAIL, "2026-05-18");
    await seedEntry(EMAIL, "2026-05-19");
    await seedEntry(EMAIL, "2026-05-20");
    const rows = await listEntries(env.DB, EMAIL, "2026-05-19", "2026-05-20");
    expect(rows.map(r => r.date)).toEqual(["2026-05-20", "2026-05-19"]);
  });
});

describe("chat turns", () => {
  it("appends and lists by session", async () => {
    await insertChatTurn(env.DB, EMAIL, "s1", "user", "hi");
    await insertChatTurn(env.DB, EMAIL, "s1", "assistant", "hello");
    await insertChatTurn(env.DB, EMAIL, "s2", "user", "other");
    const s1 = await listChatTurns(env.DB, EMAIL, "s1");
    expect(s1.map(t => t.content)).toEqual(["hi", "hello"]);
    expect(s1[0].role).toBe("user");
  });
});

describe("insights", () => {
  it("upserts and reads latest by created_at", async () => {
    await upsertInsight(env.DB, EMAIL, "2026-05-19", "sleep dipped");
    await upsertInsight(env.DB, EMAIL, "2026-05-20", "back on track");
    const latest = await getLatestInsight(env.DB, EMAIL);
    expect(latest?.date).toBe("2026-05-20");
    expect(latest?.text).toBe("back on track");
  });

  it("returns null when no insights exist", async () => {
    expect(await getLatestInsight(env.DB, EMAIL)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests, confirm failure**

Run: `npm test -- db`
Expected: failures because `src/db.ts` doesn't exist.

- [ ] **Step 4: Implement `src/db.ts`**

```ts
// src/db.ts
import type { Entry, EntryInput, ChatTurn, Insight } from "./types";

export async function upsertEntry(
  db: D1Database, email: string, date: string, input: EntryInput,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO entries (email,date,mood,energy,anxiety,sleep,note,tz,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)
     ON CONFLICT(email,date) DO UPDATE SET
       mood=?3, energy=?4, anxiety=?5, sleep=?6, note=?7, tz=?8, updated_at=?9`
  ).bind(
    email, date, input.mood, input.energy, input.anxiety, input.sleep,
    input.note ?? null, input.tz, now,
  ).run();
}

export async function getEntryByDate(
  db: D1Database, email: string, date: string,
): Promise<Entry | null> {
  const row = await db.prepare(
    `SELECT date,mood,energy,anxiety,sleep,note,tz,created_at,updated_at
       FROM entries WHERE email = ?1 AND date = ?2`
  ).bind(email, date).first<Entry>();
  return row ?? null;
}

export async function listEntries(
  db: D1Database, email: string, from: string, to: string,
): Promise<Entry[]> {
  const { results } = await db.prepare(
    `SELECT date,mood,energy,anxiety,sleep,note,tz,created_at,updated_at
       FROM entries
      WHERE email = ?1 AND date >= ?2 AND date <= ?3
      ORDER BY date DESC`
  ).bind(email, from, to).all<Entry>();
  return results;
}

export async function insertChatTurn(
  db: D1Database, email: string, session_id: string,
  role: "user" | "assistant", content: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO chat_turns (email, session_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(email, session_id, role, content, now).run();
}

export async function listChatTurns(
  db: D1Database, email: string, session_id: string,
): Promise<ChatTurn[]> {
  const { results } = await db.prepare(
    `SELECT id, session_id, role, content, created_at
       FROM chat_turns
      WHERE email = ?1 AND session_id = ?2
      ORDER BY id ASC`
  ).bind(email, session_id).all<ChatTurn>();
  return results;
}

export async function upsertInsight(
  db: D1Database, email: string, date: string, text: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO insights (email, date, text, created_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(email, date) DO UPDATE SET text=?3, created_at=?4`
  ).bind(email, date, text, now).run();
}

export async function getLatestInsight(
  db: D1Database, email: string,
): Promise<Insight | null> {
  const row = await db.prepare(
    `SELECT date, text, created_at
       FROM insights
      WHERE email = ?
      ORDER BY date DESC LIMIT 1`
  ).bind(email).first<Insight>();
  return row ?? null;
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npm test -- db`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/db.ts test/db.test.ts test/helpers.ts
git commit -m "feat(db): D1 query helpers for entries, chat, insights"
```

---

## Task 6: Access JWT verification

**Files:**
- Create: `src/auth.ts`
- Create: `test/auth.test.ts`

The Cloudflare Access JWT is signed with RS256. We verify the signature against the team's JWKS (cached in KV), check `iss`, `aud`, `exp`, and return the `email` claim. In `wrangler dev`, when no JWT is present we fall back to `env.DEV_FAKE_EMAIL` so the developer can test locally without Access.

- [ ] **Step 1: Write failing tests**

```ts
// test/auth.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { verifyAccessJwt, AuthError } from "../src/auth";

// Test helper: generate an RSA keypair and sign a JWT with it; mock fetch for JWKS.
async function makeKey() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { publicKey, privateKey, jwk };
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid };
  const part = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, new TextEncoder().encode(part));
  return `${part}.${b64url(sig)}`;
}

const FETCH = globalThis.fetch;

beforeEach(() => { globalThis.fetch = FETCH; env.KV.delete("jwks").catch(() => {}); });

describe("verifyAccessJwt", () => {
  it("accepts a valid token, returns email", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "k1";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`,
      aud: env.ACCESS_AUD,
      email: "ok@example.com",
      exp: now + 60, iat: now,
    });
    const ident = await verifyAccessJwt(env, token);
    expect(ident.email).toBe("ok@example.com");
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "k1";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email: "ok@example.com", exp: now - 10, iat: now - 60,
    });
    await expect(verifyAccessJwt(env, token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a wrong audience", async () => {
    const { privateKey, jwk } = await makeKey();
    const kid = "k1";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, kid, {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: "wrong-aud",
      email: "ok@example.com", exp: now + 60, iat: now,
    });
    await expect(verifyAccessJwt(env, token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a token signed with an unknown key", async () => {
    const { privateKey } = await makeKey();        // sign with this
    const other = await makeKey();                  // but JWKS only has this
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...other.jwk, kid: "other" }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, "missing-kid", {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email: "ok@example.com", exp: now + 60, iat: now,
    });
    await expect(verifyAccessJwt(env, token)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a tampered signature", async () => {
    const { privateKey, jwk } = await makeKey();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] }), { status: 200 }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(privateKey, "k1", {
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`, aud: env.ACCESS_AUD,
      email: "ok@example.com", exp: now + 60, iat: now,
    });
    const tampered = token.slice(0, -4) + "AAAA";
    await expect(verifyAccessJwt(env, tampered)).rejects.toBeInstanceOf(AuthError);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test -- auth`
Expected: failures because `src/auth.ts` doesn't exist.

- [ ] **Step 3: Implement `src/auth.ts`**

```ts
// src/auth.ts
import type { Env, Identity } from "./types";

export class AuthError extends Error {}

interface JwkRsa { kid: string; kty: "RSA"; alg?: string; n: string; e: string; use?: string; }

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function b64urlDecodeJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s))) as T;
}

async function loadJwks(env: Env): Promise<JwkRsa[]> {
  const cached = await env.KV.get("jwks", "json") as { keys: JwkRsa[]; fetched_at: number } | null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.fetched_at < 3600) return cached.keys;
  const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new AuthError(`JWKS fetch failed: ${res.status}`);
  const body = await res.json<{ keys: JwkRsa[] }>();
  await env.KV.put("jwks", JSON.stringify({ keys: body.keys, fetched_at: now }), { expirationTtl: 3600 });
  return body.keys;
}

interface JwtHeader { alg: string; kid: string; typ?: string; }
interface JwtClaims { iss: string; aud: string | string[]; email?: string; exp: number; iat?: number; }

export async function verifyAccessJwt(env: Env, token: string): Promise<Identity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = b64urlDecodeJson<JwtHeader>(headerB64);
    claims = b64urlDecodeJson<JwtClaims>(payloadB64);
  } catch {
    throw new AuthError("malformed token");
  }
  if (header.alg !== "RS256") throw new AuthError("unsupported alg");

  const keys = await loadJwks(env);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError("unknown signing key");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true } as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["verify"],
  );
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, b64urlDecode(sigB64), signed);
  if (!ok) throw new AuthError("invalid signature");

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new AuthError("token expired");
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new AuthError("bad iss");
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(env.ACCESS_AUD)) throw new AuthError("bad aud");
  if (!claims.email) throw new AuthError("no email claim");

  return { email: claims.email };
}

export async function identify(req: Request, env: Env): Promise<Identity | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (token) {
    try { return await verifyAccessJwt(env, token); }
    catch { return null; }
  }
  // Dev fallback: only honoured when DEV_FAKE_EMAIL is set (local wrangler dev).
  if (env.DEV_FAKE_EMAIL) return { email: env.DEV_FAKE_EMAIL };
  return null;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test -- auth`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat(auth): verify Cloudflare Access JWT against cached JWKS"
```

---

## Task 7: Workers AI wrapper

**Files:**
- Create: `src/ai.ts`
- Create: `test/ai.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/ai.test.ts
import { describe, it, expect, vi } from "vitest";
import { chatComplete, streamChat, generateInsight } from "../src/ai";

function makeAi(impl: (model: string, opts: any) => any): Ai {
  return { run: vi.fn(impl) } as unknown as Ai;
}

describe("chatComplete", () => {
  it("uses the primary model on success", async () => {
    const ai = makeAi(async (_, __) => ({ response: "hello" }));
    const out = await chatComplete(ai, [{ role: "user", content: "hi" }]);
    expect(out).toBe("hello");
    expect((ai.run as any).mock.calls[0][0]).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("falls back to the small model on primary failure", async () => {
    let calls = 0;
    const ai = makeAi(async (model) => {
      calls++;
      if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") throw new Error("boom");
      return { response: "fallback ok" };
    });
    const out = await chatComplete(ai, [{ role: "user", content: "hi" }]);
    expect(out).toBe("fallback ok");
    expect(calls).toBe(2);
  });

  it("throws when both models fail", async () => {
    const ai = makeAi(async () => { throw new Error("nope"); });
    await expect(chatComplete(ai, [{ role: "user", content: "hi" }])).rejects.toThrow();
  });
});

describe("generateInsight", () => {
  const entries = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-05-${String(i+1).padStart(2,"0")}`,
    mood: 3, energy: 3, anxiety: 2, sleep: 3, note: null,
  }));

  it("returns the AI text when it isn't NONE", async () => {
    const ai = makeAi(async () => ({ response: "Sleep dipped Wed-Thu." }));
    expect(await generateInsight(ai, entries as any)).toBe("Sleep dipped Wed-Thu.");
  });

  it("returns null when AI replies NONE", async () => {
    const ai = makeAi(async () => ({ response: "NONE" }));
    expect(await generateInsight(ai, entries as any)).toBeNull();
  });

  it("trims to 140 chars", async () => {
    const ai = makeAi(async () => ({ response: "x".repeat(200) }));
    const out = await generateInsight(ai, entries as any);
    expect(out!.length).toBeLessThanOrEqual(140);
  });
});

describe("streamChat", () => {
  it("returns a ReadableStream from the AI binding", async () => {
    const fakeStream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: hi\n\n")); controller.close(); },
    });
    const ai = makeAi(async () => fakeStream);
    const stream = await streamChat(ai, [{ role: "user", content: "hi" }]);
    expect(stream).toBeInstanceOf(ReadableStream);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test -- ai`
Expected: fails because `src/ai.ts` doesn't exist.

- [ ] **Step 3: Implement `src/ai.ts`**

```ts
// src/ai.ts
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
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test -- ai`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ai.ts test/ai.test.ts
git commit -m "feat(ai): Workers AI wrapper with model fallback and insight generator"
```

---

## Task 8: Entries handlers

**Files:**
- Create: `src/entries.ts`
- Create: `test/entries.test.ts`

- [ ] **Step 1: Write failing integration tests**

```ts
// test/entries.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { handleGetEntries, handleGetTodayEntry, handlePutEntry } from "../src/entries";
import { applyMigrations, seedEntry } from "./helpers";

const IDENT = { email: "u@example.com" };

beforeEach(applyMigrations);

describe("GET /api/entries", () => {
  it("returns the last 60 days by default", async () => {
    await seedEntry(IDENT.email, "2026-05-20");
    await seedEntry(IDENT.email, "2026-05-19");
    const req = new Request("https://x/api/entries");
    const res = await handleGetEntries(req, env, IDENT);
    expect(res.status).toBe(200);
    const json = await res.json() as any[];
    expect(json.map(r => r.date)).toEqual(["2026-05-20", "2026-05-19"]);
  });

  it("honours from/to", async () => {
    await seedEntry(IDENT.email, "2026-05-18");
    await seedEntry(IDENT.email, "2026-05-19");
    await seedEntry(IDENT.email, "2026-05-20");
    const req = new Request("https://x/api/entries?from=2026-05-19&to=2026-05-19");
    const res = await handleGetEntries(req, env, IDENT);
    const json = await res.json() as any[];
    expect(json.map(r => r.date)).toEqual(["2026-05-19"]);
  });

  it("400s on malformed date params", async () => {
    const req = new Request("https://x/api/entries?from=bad");
    const res = await handleGetEntries(req, env, IDENT);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/entries/today", () => {
  it("returns today's entry if present", async () => {
    const today = new Date().toISOString().slice(0,10);
    await seedEntry(IDENT.email, today, { mood: 5 });
    const req = new Request("https://x/api/entries/today");
    const res = await handleGetTodayEntry(req, env, IDENT);
    const json = await res.json() as any;
    expect(json.mood).toBe(5);
  });

  it("returns null body 200 if no entry today", async () => {
    const req = new Request("https://x/api/entries/today");
    const res = await handleGetTodayEntry(req, env, IDENT);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});

describe("PUT /api/entries/:date", () => {
  it("inserts and returns the new entry", async () => {
    const ctx = createExecutionContext();
    const body = JSON.stringify({ mood: 4, energy: 3, anxiety: 2, sleep: 4, note: "hi", tz: "Europe/London" });
    const req = new Request("https://x/api/entries/2026-05-20", { method: "PUT", body });
    const res = await handlePutEntry(req, env, IDENT, "2026-05-20", ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({ date: "2026-05-20", mood: 4, note: "hi" });
    await waitOnExecutionContext(ctx);
  });

  it("rejects invalid bodies with 400", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/entries/2026-05-20", {
      method: "PUT", body: JSON.stringify({ mood: 9 }),
    });
    const res = await handlePutEntry(req, env, IDENT, "2026-05-20", ctx);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid date in the URL", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/entries/bad", {
      method: "PUT",
      body: JSON.stringify({ mood: 4, energy: 3, anxiety: 2, sleep: 4, tz: "UTC" }),
    });
    const res = await handlePutEntry(req, env, IDENT, "bad", ctx);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test -- entries`
Expected: fails because `src/entries.ts` doesn't exist.

- [ ] **Step 3: Implement `src/entries.ts`**

```ts
// src/entries.ts
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
  return fmt.format(new Date());     // en-CA gives YYYY-MM-DD
}

export async function handleGetEntries(req: Request, env: Env, ident: Identity): Promise<Response> {
  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  try {
    const today = todayInTz("UTC");
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

export async function handleGetTodayEntry(_req: Request, env: Env, ident: Identity): Promise<Response> {
  // Use UTC today; the client supplies its tz on save, so this is a best-effort default.
  const today = todayInTz("UTC");
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
```

- [ ] **Step 4: Stub `src/insight.ts` minimally so entries compile**

Create a placeholder so the import resolves; the real impl is the next task.

```ts
// src/insight.ts (temporary stub — replaced in Task 9)
import type { Env } from "./types";
export async function runInsightJob(_env: Env, _email: string): Promise<void> { /* implemented next */ }
export async function handleGetInsight(_req: Request, _env: Env, _ident: { email: string }): Promise<Response> {
  return new Response("null", { headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 5: Run tests, confirm pass**

Run: `npm test -- entries`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/entries.ts src/insight.ts test/entries.test.ts
git commit -m "feat(entries): GET/PUT entry handlers with validation"
```

---

## Task 9: Insight job and handler

**Files:**
- Modify: `src/insight.ts` (replace stub)
- Create: `test/insight.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/insight.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { runInsightJob, handleGetInsight } from "../src/insight";
import { applyMigrations, seedEntry } from "./helpers";

const EMAIL = "u@example.com";

beforeEach(async () => {
  await applyMigrations();
  await env.KV.delete(`insight:${EMAIL}`);
});

function mockAi(response: string) {
  (env as any).AI = { run: vi.fn().mockResolvedValue({ response }) };
}

describe("runInsightJob", () => {
  it("writes a non-NONE insight to D1 and KV", async () => {
    await seedEntry(EMAIL, "2026-05-20");
    mockAi("Sleep dipped Wed.");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT text FROM insights WHERE email=?").bind(EMAIL).first<{ text: string }>();
    expect(row?.text).toBe("Sleep dipped Wed.");
    const kv = await env.KV.get(`insight:${EMAIL}`, "json") as any;
    expect(kv.text).toBe("Sleep dipped Wed.");
  });

  it("writes nothing when AI returns NONE", async () => {
    await seedEntry(EMAIL, "2026-05-20");
    mockAi("NONE");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT * FROM insights WHERE email=?").bind(EMAIL).first();
    expect(row).toBeNull();
    expect(await env.KV.get(`insight:${EMAIL}`)).toBeNull();
  });

  it("no-ops when no entries exist", async () => {
    mockAi("something");
    await runInsightJob(env, EMAIL);
    const row = await env.DB.prepare("SELECT * FROM insights WHERE email=?").bind(EMAIL).first();
    expect(row).toBeNull();
  });
});

describe("handleGetInsight", () => {
  it("returns the KV-cached value when present", async () => {
    await env.KV.put(`insight:${EMAIL}`, JSON.stringify({ date: "2026-05-20", text: "hi" }));
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    const body = await res.json() as any;
    expect(body.text).toBe("hi");
  });

  it("falls back to D1 if KV is empty", async () => {
    await env.DB.prepare(
      "INSERT INTO insights (email,date,text,created_at) VALUES (?,?,?,?)"
    ).bind(EMAIL, "2026-05-19", "from db", Math.floor(Date.now()/1000)).run();
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    const body = await res.json() as any;
    expect(body.text).toBe("from db");
  });

  it("returns null when nothing exists", async () => {
    const res = await handleGetInsight(new Request("https://x/api/insight"), env, { email: EMAIL });
    expect(await res.json()).toBeNull();
  });
});
```

- [ ] **Step 2: Replace `src/insight.ts`**

```ts
// src/insight.ts
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
  if (!text) return;
  const today = todayUtc();
  await upsertInsight(env.DB, email, today, text);
  await env.KV.put(`insight:${email}`, JSON.stringify({ date: today, text }));
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
```

- [ ] **Step 3: Run tests, confirm pass**

Run: `npm test -- insight`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/insight.ts test/insight.test.ts
git commit -m "feat(insight): proactive insight generation + GET handler"
```

---

## Task 10: Chat handler with SSE

**Files:**
- Create: `src/chat.ts`
- Create: `test/chat.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/chat.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { handleChat, handleGetChatHistory } from "../src/chat";
import { applyMigrations, seedEntry } from "./helpers";

const IDENT = { email: "u@example.com" };

beforeEach(applyMigrations);

function mockAiStream(chunks: string[]) {
  (env as any).AI = {
    run: vi.fn().mockImplementation(async () => {
      return new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({response:c})}\n\n`));
          controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
    }),
  };
}

async function readAll(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe("POST /api/chat", () => {
  it("streams SSE and persists both user + assistant turns", async () => {
    await seedEntry(IDENT.email, "2026-05-20", { note: "ok" });
    mockAiStream(["Hi ", "there"]);
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", {
      method: "POST", body: JSON.stringify({ session_id: "s1", message: "hi" }),
    });
    const res = await handleChat(req, env, IDENT, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/event-stream/);
    const text = await readAll(res.body!);
    expect(text).toContain("Hi ");
    expect(text).toContain("there");
    await waitOnExecutionContext(ctx);
    const turns = await env.DB.prepare(
      "SELECT role, content FROM chat_turns WHERE email=? AND session_id=? ORDER BY id"
    ).bind(IDENT.email, "s1").all();
    expect(turns.results.map((r: any) => r.role)).toEqual(["user", "assistant"]);
    expect((turns.results[1] as any).content).toBe("Hi there");
  });

  it("400s on missing fields", async () => {
    const ctx = createExecutionContext();
    const req = new Request("https://x/api/chat", { method: "POST", body: JSON.stringify({}) });
    const res = await handleChat(req, env, IDENT, ctx);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/chat/:session_id", () => {
  it("returns turns for the user's session", async () => {
    await env.DB.prepare(
      "INSERT INTO chat_turns (email,session_id,role,content,created_at) VALUES (?,?,?,?,?)"
    ).bind(IDENT.email, "s1", "user", "hi", 1).run();
    const res = await handleGetChatHistory(new Request("https://x/api/chat/s1"), env, IDENT, "s1");
    const json = await res.json() as any[];
    expect(json).toHaveLength(1);
    expect(json[0].content).toBe("hi");
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test -- chat`
Expected: fails because `src/chat.ts` doesn't exist.

- [ ] **Step 3: Implement `src/chat.ts`**

```ts
// src/chat.ts
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

// Workers AI streams SSE lines like `data: {"response":"tok"}\n\n` and ends with `data: [DONE]\n\n`.
// We pipe to the client unchanged, and tee a parser to assemble the full assistant message for persistence.
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
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test -- chat`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat.ts test/chat.test.ts
git commit -m "feat(chat): SSE chat handler with rolling-window history"
```

---

## Task 11: Worker router

**Files:**
- Create: `src/index.ts`
- Create: `test/index.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/index.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { applyMigrations } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
  (env as any).DEV_FAKE_EMAIL = "u@example.com";
  (env as any).ASSETS = { fetch: vi.fn().mockResolvedValue(new Response("<html>app</html>", { headers: { "content-type": "text/html" } })) };
});

describe("router", () => {
  it("serves static asset for /", async () => {
    const req = new Request("https://x/");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    expect((await res.text()).includes("app")).toBe(true);
  });

  it("401s API calls when no JWT and no dev fallback", async () => {
    (env as any).DEV_FAKE_EMAIL = undefined;
    const req = new Request("https://x/api/entries");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(401);
  });

  it("routes GET /api/entries", async () => {
    const req = new Request("https://x/api/entries");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
  });

  it("routes PUT /api/entries/:date", async () => {
    const req = new Request("https://x/api/entries/2026-05-20", {
      method: "PUT",
      body: JSON.stringify({ mood: 3, energy: 3, anxiety: 2, sleep: 3, tz: "UTC" }),
    });
    const ctx = createExecutionContext();
    (env as any).AI = { run: vi.fn().mockResolvedValue({ response: "NONE" }) };
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    await waitOnExecutionContext(ctx);
  });

  it("returns 404 for unknown /api/* paths", async () => {
    const req = new Request("https://x/api/wat");
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test -- index`
Expected: fails because `src/index.ts` doesn't exist.

- [ ] **Step 3: Implement `src/index.ts`**

```ts
// src/index.ts
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

    // /api/entries
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

    // /api/insight
    if (url.pathname === "/api/insight" && req.method === "GET") {
      return handleGetInsight(req, env, ident);
    }

    // /api/chat
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
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: all tests pass across all suites.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat(worker): router with auth gating and 404 fallback"
```

---

## Task 12: Frontend shell, theme, and stub

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

The frontend is vanilla JS, no build step. Tests for frontend logic are limited; we rely on `wrangler dev` for manual verification.

- [ ] **Step 1: Create `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#f7f5ef" />
  <title>Mood</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main id="app" aria-live="polite">
    <section id="view-today" class="view active" hidden></section>
    <section id="view-history" class="view" hidden></section>
  </main>

  <nav id="tabs" aria-label="Primary">
    <button data-view="today" class="tab active">Today</button>
    <button data-view="history" class="tab">History</button>
  </nav>

  <button id="chat-fab" aria-label="Open mood companion chat">💬</button>

  <div id="chat-panel" hidden aria-modal="true" role="dialog" aria-labelledby="chat-title">
    <header>
      <h2 id="chat-title">Mood companion</h2>
      <button id="chat-close" aria-label="Close chat">×</button>
    </header>
    <ol id="chat-log" aria-live="polite"></ol>
    <form id="chat-form">
      <input id="chat-input" type="text" autocomplete="off" placeholder="How are you?" required maxlength="4000" />
      <button type="submit" aria-label="Send">↑</button>
    </form>
  </div>

  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/styles.css`**

```css
:root {
  --bg: #f7f5ef;
  --ink: #1a1a1a;
  --muted: #6b6b6b;
  --card: #ffffff;
  --line: #e0ddd2;
  --accent: #ffd166;
  --accent-2: #6c8ead;
  --accent-3: #e8a08a;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
body { min-height: 100vh; min-height: 100dvh; padding-bottom: env(safe-area-inset-bottom); }

main#app { padding: 16px 14px 90px; max-width: 480px; margin: 0 auto; }
.view { display: none; }
.view.active { display: block; }

.metric-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 14px 0 6px; }
.emoji-row { display: flex; gap: 6px; justify-content: space-between; }
.emoji-btn {
  flex: 1; min-width: 44px; min-height: 44px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; background: var(--card); border: 1px solid var(--line);
  border-radius: 999px; cursor: pointer;
  transition: transform 80ms ease, background 80ms ease, border-color 80ms ease;
}
.emoji-btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); transform: scale(1.07); }
.emoji-btn:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

#note { width: 100%; margin-top: 14px; min-height: 60px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font: inherit; resize: vertical; }
#save-btn {
  margin-top: 14px; width: 100%; padding: 14px; border: none;
  background: var(--ink); color: var(--bg); font-weight: 600; border-radius: 10px; font-size: 15px;
}
#save-btn:disabled { opacity: 0.5; }

.insight-banner { margin-top: 16px; padding: 12px 14px; background: #fff8e6; border-left: 4px solid var(--accent); border-radius: 8px; font-size: 13px; line-height: 1.4; display: flex; gap: 8px; align-items: flex-start; }
.insight-banner button { margin-left: auto; background: none; border: none; font-size: 16px; color: var(--muted); }

.tabs-row { display: flex; gap: 6px; margin: 12px 0; }
.history-tab { padding: 4px 12px; border-radius: 14px; background: var(--card); border: 1px solid var(--line); font-size: 12px; }
.history-tab.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }

.heatmap { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.heatmap .cell { aspect-ratio: 1; border-radius: 4px; background: var(--line); }
.heatmap .cell.empty { background: repeating-linear-gradient(45deg, var(--line), var(--line) 2px, #f0ede2 2px, #f0ede2 4px); }
.legend { display: flex; gap: 6px; align-items: center; font-size: 10px; color: var(--muted); margin-top: 8px; }
.legend .sq { width: 12px; height: 12px; border-radius: 3px; }

.chart-wrap { margin-top: 18px; }
.chart-wrap svg { width: 100%; height: 140px; display: block; background: var(--card); border-radius: 8px; border: 1px solid var(--line); }
.chart-legend { font-size: 11px; display: flex; gap: 10px; justify-content: center; margin-top: 6px; }

nav#tabs {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: var(--bg);
  border-top: 1px solid var(--line);
  display: flex; padding: 8px 14px calc(8px + env(safe-area-inset-bottom));
  gap: 8px; z-index: 5;
}
nav#tabs .tab {
  flex: 1; padding: 10px; background: transparent; border: none; font: inherit;
  color: var(--muted); border-radius: 8px;
}
nav#tabs .tab.active { background: var(--card); color: var(--ink); border: 1px solid var(--line); }

#chat-fab {
  position: fixed; right: 16px; bottom: calc(72px + env(safe-area-inset-bottom));
  width: 52px; height: 52px; border-radius: 50%; border: none;
  background: linear-gradient(135deg, var(--accent-2), var(--accent));
  color: #fff; font-size: 22px; cursor: pointer;
  box-shadow: 0 6px 14px rgba(0,0,0,0.18);
  z-index: 6;
}

#chat-panel {
  position: fixed; left: 0; right: 0; bottom: 0; top: 30vh;
  background: var(--card); border-top-left-radius: 18px; border-top-right-radius: 18px;
  display: flex; flex-direction: column; z-index: 10;
  box-shadow: 0 -8px 24px rgba(0,0,0,0.18);
}
#chat-panel header { padding: 14px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 10px; }
#chat-panel h2 { margin: 0; font-size: 15px; }
#chat-close { margin-left: auto; background: none; border: none; font-size: 22px; color: var(--muted); }
#chat-log { list-style: none; margin: 0; padding: 12px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
#chat-log li { padding: 8px 12px; border-radius: 12px; max-width: 80%; font-size: 14px; line-height: 1.35; }
#chat-log li.user { background: var(--ink); color: var(--bg); align-self: flex-end; }
#chat-log li.assistant { background: #f0ede2; color: var(--ink); align-self: flex-start; }
#chat-form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--line); }
#chat-input { flex: 1; min-height: 44px; padding: 10px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); font: inherit; }
#chat-form button { width: 44px; height: 44px; border-radius: 50%; border: none; background: var(--ink); color: var(--bg); font-size: 18px; }
```

- [ ] **Step 3: Create a minimal `public/app.js`**

```js
// public/app.js — entry; modules implemented in subsequent tasks.
import { mountToday } from "./today.js";
import { mountHistory } from "./history.js";
import { mountChat } from "./chat.js";

const tabs = document.querySelectorAll("nav#tabs .tab");
const views = {
  today: document.getElementById("view-today"),
  history: document.getElementById("view-history"),
};

function show(name) {
  for (const v of Object.values(views)) { v.classList.remove("active"); v.hidden = true; }
  views[name].classList.add("active"); views[name].hidden = false;
  for (const t of tabs) t.classList.toggle("active", t.dataset.view === name);
}

for (const t of tabs) t.addEventListener("click", () => show(t.dataset.view));

mountToday(views.today);
mountHistory(views.history);
mountChat();

show("today");
```

- [ ] **Step 4: Create stub modules so imports resolve**

```js
// public/today.js (stub — implemented in Task 13)
export function mountToday(root) { root.textContent = "Today view (stub)"; }
```

```js
// public/history.js (stub — implemented in Task 14)
export function mountHistory(root) { root.textContent = "History view (stub)"; }
```

```js
// public/chat.js (stub — implemented in Task 15)
export function mountChat() { /* implemented later */ }
```

- [ ] **Step 5: Smoke-run locally**

Run: `npm run dev`
In a browser, open `http://localhost:8787/`. Expected: shell loads, you see "Today view (stub)", can switch tabs to "History view (stub)", chat bubble visible.
Press Ctrl+C to stop.

- [ ] **Step 6: Commit**

```bash
git add public/
git commit -m "feat(ui): SPA shell, theme, and module stubs"
```

---

## Task 13: Today view

**Files:**
- Modify: `public/today.js`

- [ ] **Step 1: Implement `public/today.js`**

```js
// public/today.js
const METRICS = [
  { key: "mood",    label: "Mood",    emojis: ["😢","😕","😐","🙂","😊"] },
  { key: "energy",  label: "Energy",  emojis: ["🥱","😴","🙂","💪","⚡"] },
  { key: "anxiety", label: "Anxiety", emojis: ["😌","🙂","😐","😟","😰"] },
  { key: "sleep",   label: "Sleep",   emojis: ["😵","😪","😐","🙂","😴"] },
];

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function mountToday(root) {
  root.innerHTML = "";
  const state = { mood: null, energy: null, anxiety: null, sleep: null, note: "" };

  const heading = el("h1", { style: "font-size:20px;margin:8px 0 12px;" }, "How are you today?");
  root.append(heading);

  const insightSlot = el("div", { id: "insight-slot" });
  root.append(insightSlot);

  for (const m of METRICS) {
    root.append(el("div", { class: "metric-label" }, m.label));
    const row = el("div", { class: "emoji-row", role: "radiogroup", "aria-label": m.label });
    m.emojis.forEach((emoji, i) => {
      const val = i + 1;
      const b = el("button", {
        type: "button",
        class: "emoji-btn",
        role: "radio",
        "aria-checked": "false",
        "aria-label": `${m.label}: ${val} of 5`,
        "aria-pressed": "false",
      }, emoji);
      b.addEventListener("click", () => {
        state[m.key] = val;
        for (const sib of row.querySelectorAll(".emoji-btn")) {
          sib.setAttribute("aria-pressed", "false");
          sib.setAttribute("aria-checked", "false");
        }
        b.setAttribute("aria-pressed", "true");
        b.setAttribute("aria-checked", "true");
        updateSaveEnabled();
      });
      row.append(b);
    });
    root.append(row);
  }

  const note = el("textarea", { id: "note", placeholder: "Note (optional)", maxlength: "2000" });
  note.addEventListener("input", () => { state.note = note.value; });
  root.append(note);

  const save = el("button", { id: "save-btn", type: "button", disabled: true }, "Save entry");
  root.append(save);

  function updateSaveEnabled() {
    save.disabled = !(state.mood && state.energy && state.anxiety && state.sleep);
    save.textContent = save.dataset.update === "1" ? "Update entry" : "Save entry";
  }

  save.addEventListener("click", async () => {
    save.disabled = true; save.textContent = "Saving…";
    try {
      const date = todayLocalISO();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/entries/${date}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mood: state.mood, energy: state.energy, anxiety: state.anxiety, sleep: state.sleep,
          note: state.note || undefined, tz,
        }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      save.dataset.update = "1";
      save.textContent = "Saved ✓";
      await loadInsight(insightSlot);
      setTimeout(updateSaveEnabled, 1500);
    } catch (err) {
      console.error(err);
      save.textContent = "Try again";
      save.disabled = false;
    }
  });

  // Prefill if today's entry exists
  try {
    const res = await fetch("/api/entries/today");
    if (res.ok) {
      const entry = await res.json();
      if (entry) {
        state.mood = entry.mood; state.energy = entry.energy;
        state.anxiety = entry.anxiety; state.sleep = entry.sleep;
        state.note = entry.note || "";
        note.value = state.note;
        for (const m of METRICS) {
          const row = root.querySelectorAll(".emoji-row")[METRICS.indexOf(m)];
          const buttons = row.querySelectorAll(".emoji-btn");
          buttons.forEach((b, i) => {
            const on = i + 1 === entry[m.key];
            b.setAttribute("aria-pressed", on ? "true" : "false");
            b.setAttribute("aria-checked", on ? "true" : "false");
          });
        }
        save.dataset.update = "1";
        updateSaveEnabled();
      }
    }
  } catch (e) { /* ignore */ }

  await loadInsight(insightSlot);
}

async function loadInsight(slot) {
  slot.innerHTML = "";
  try {
    const res = await fetch("/api/insight");
    if (!res.ok) return;
    const body = await res.json();
    if (!body) return;
    const dismissedFor = localStorage.getItem("insight-dismissed-for");
    if (dismissedFor === body.date) return;
    const banner = document.createElement("div");
    banner.className = "insight-banner";
    banner.innerHTML = `<span>✨</span><span><strong>AI noticed:</strong> ${escape(body.text)}</span>`;
    const dismiss = document.createElement("button");
    dismiss.textContent = "×"; dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.addEventListener("click", () => {
      localStorage.setItem("insight-dismissed-for", body.date);
      banner.remove();
    });
    banner.append(dismiss);
    slot.append(banner);
  } catch { /* ignore */ }
}

function escape(s) {
  return String(s).replace(/[<>&"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;"})[c]);
}
```

- [ ] **Step 2: Smoke-test locally**

Run: `npm run dev`
Open the browser, log a mood entry. Confirm: tapping a face highlights it, Save enables when all four are set, save returns 200, banner appears below the heading if AI produces an insight.

- [ ] **Step 3: Commit**

```bash
git add public/today.js
git commit -m "feat(ui): today view with emoji rows, note, save, and insight banner"
```

---

## Task 14: History view

**Files:**
- Modify: `public/history.js`

- [ ] **Step 1: Implement `public/history.js`**

```js
// public/history.js
const METRICS = ["mood", "energy", "anxiety", "sleep"];
const COLORS = {
  mood: { 1:"#e8a08a", 2:"#f4d29a", 3:"#dfead4", 4:"#a8c98a", 5:"#5b8c3f" },
  energy:{ 1:"#e8a08a", 2:"#f4d29a", 3:"#dfead4", 4:"#a8c98a", 5:"#5b8c3f" },
  anxiety:{ 5:"#e8a08a", 4:"#f4d29a", 3:"#dfead4", 2:"#a8c98a", 1:"#5b8c3f" }, // inverted polarity
  sleep:  { 1:"#e8a08a", 2:"#f4d29a", 3:"#dfead4", 4:"#a8c98a", 5:"#5b8c3f" },
};
const LINE_COLORS = { mood: "#6c8ead", energy: "#ffd166", anxiety: "#e8a08a", sleep: "#5b8c3f" };

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - n);
  return d;
}

export async function mountHistory(root) {
  root.innerHTML = "";
  root.append(el("h1", { style: "font-size:20px;margin:8px 0 6px;" }, "History"));

  const tabsRow = el("div", { class: "tabs-row" });
  const tabs = METRICS.map(m => {
    const b = el("button", { class: "history-tab", type: "button" }, m[0].toUpperCase() + m.slice(1));
    b.dataset.metric = m;
    return b;
  });
  tabs[0].classList.add("on");
  tabs.forEach(b => tabsRow.append(b));
  root.append(tabsRow);

  const heatmap = el("div", { class: "heatmap" });
  root.append(heatmap);
  const legend = el("div", { class: "legend" },
    "Less",
    el("span", { class: "sq", style: "background:#e8a08a" }),
    el("span", { class: "sq", style: "background:#f4d29a" }),
    el("span", { class: "sq", style: "background:#dfead4" }),
    el("span", { class: "sq", style: "background:#a8c98a" }),
    el("span", { class: "sq", style: "background:#5b8c3f" }),
    "More",
    el("span", { class: "sq empty", style: "background: repeating-linear-gradient(45deg,#e0ddd2,#e0ddd2 2px,#f0ede2 2px,#f0ede2 4px)" }),
    "No entry",
  );
  root.append(legend);

  const chartWrap = el("div", { class: "chart-wrap" });
  root.append(chartWrap);

  const from = isoDate(daysAgo(55));
  const to = isoDate(new Date());
  const res = await fetch(`/api/entries?from=${from}&to=${to}`);
  const entries = res.ok ? await res.json() : [];
  const byDate = Object.fromEntries(entries.map(e => [e.date, e]));

  let activeMetric = "mood";
  function renderHeatmap() {
    heatmap.innerHTML = "";
    // 56 cells = 8 weeks, ordered oldest → newest, by column = week
    const cells = [];
    for (let i = 55; i >= 0; i--) {
      const d = daysAgo(i);
      const k = isoDate(d);
      const e = byDate[k];
      const c = el("div", { class: "cell", title: k });
      if (e) c.style.background = COLORS[activeMetric][e[activeMetric]];
      else c.classList.add("empty");
      cells.push(c);
    }
    cells.forEach(c => heatmap.append(c));
  }

  tabs.forEach(b => b.addEventListener("click", () => {
    tabs.forEach(t => t.classList.toggle("on", t === b));
    activeMetric = b.dataset.metric;
    renderHeatmap();
  }));
  renderHeatmap();

  // Trend chart: 30-day overlaid lines
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const k = isoDate(daysAgo(i));
    last30.push({ date: k, e: byDate[k] });
  }
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 300 120");
  svg.setAttribute("preserveAspectRatio", "none");
  function points(metric) {
    return last30.map((d, i) => {
      if (!d.e) return null;
      const x = (i / 29) * 300;
      const v = d.e[metric];
      const y = 120 - ((v - 1) / 4) * 100 - 10;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(" ");
  }
  for (const m of METRICS) {
    const poly = document.createElementNS(svgNS, "polyline");
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", LINE_COLORS[m]);
    poly.setAttribute("stroke-width", "2");
    poly.setAttribute("points", points(m));
    poly.setAttribute("data-metric", m);
    svg.append(poly);
  }
  chartWrap.append(svg);
  const chartLegend = el("div", { class: "chart-legend" });
  for (const m of METRICS) {
    chartLegend.append(el("span", { style: `color:${LINE_COLORS[m]}` }, `━ ${m}`));
  }
  chartWrap.append(chartLegend);
}
```

- [ ] **Step 2: Smoke-test locally**

Run: `npm run dev`
Open the browser → History tab. Confirm: heatmap renders with 56 cells (mix of coloured + striped), metric toggle changes colours, trend chart renders four lines.

- [ ] **Step 3: Commit**

```bash
git add public/history.js
git commit -m "feat(ui): history view with heatmap and 30-day trend chart"
```

---

## Task 15: Chat bubble UI with SSE

**Files:**
- Modify: `public/chat.js`

- [ ] **Step 1: Implement `public/chat.js`**

```js
// public/chat.js
const fab = document.getElementById("chat-fab");
const panel = document.getElementById("chat-panel");
const closeBtn = document.getElementById("chat-close");
const log = document.getElementById("chat-log");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");

let sessionId = null;

function ensureSession() {
  if (!sessionId) sessionId = crypto.randomUUID();
  return sessionId;
}

function appendMessage(role, text) {
  const li = document.createElement("li");
  li.className = role;
  li.textContent = text;
  log.append(li);
  log.scrollTop = log.scrollHeight;
  return li;
}

function escape(s) { return String(s); }

async function sendMessage(message) {
  const session_id = ensureSession();
  appendMessage("user", message);
  const li = appendMessage("assistant", "…");

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id, message }),
  });
  if (!res.ok || !res.body) { li.textContent = "Sorry, something went wrong."; return; }

  li.textContent = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
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
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        if (obj.response) {
          li.textContent += obj.response;
          log.scrollTop = log.scrollHeight;
        }
      } catch { /* ignore */ }
    }
  }
}

export function mountChat() {
  fab.addEventListener("click", () => {
    panel.hidden = false;
    setTimeout(() => input.focus(), 50);
  });
  closeBtn.addEventListener("click", () => { panel.hidden = true; });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    try { await sendMessage(message); }
    catch (e) { console.error(e); appendMessage("assistant", "Sorry, something went wrong."); }
  });

  // Reset session on full page reload (spec behaviour).
  sessionId = crypto.randomUUID();
}
```

- [ ] **Step 2: Smoke-test locally**

Run: `npm run dev`
Open the chat bubble, send "hello". Confirm: a streamed assistant reply appears word-by-word. Close and reopen — new conversation, the panel's log is the same session within the page lifetime; reloading the page starts a new session.

- [ ] **Step 3: Commit**

```bash
git add public/chat.js
git commit -m "feat(ui): floating chat bubble with SSE streaming"
```

---

## Task 16: Provision Cloudflare resources

This task is manual but documented inline. The engineer will need to run these against the user's account using the credentials in `.env`.

**Files:**
- Modify: `wrangler.toml` (paste real IDs)

- [ ] **Step 1: Authenticate wrangler against the user's account**

Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the shell environment, not from `.env`. Export them first (PowerShell shown — adjust for the engineer's shell):

```powershell
$env:CLOUDFLARE_API_TOKEN  = (Get-Content .env | Select-String 'CLOUDFLARE_API_TOKEN=').ToString().Split('=')[1]
$env:CLOUDFLARE_ACCOUNT_ID = (Get-Content .env | Select-String 'CLOUDFLARE_ACCOUNT_ID=').ToString().Split('=')[1]
```

Then: `npx wrangler whoami`
Expected: the user identity prints, no auth prompt.

- [ ] **Step 2: Create the D1 database**

Run: `npx wrangler d1 create mood`
Expected output ends with a `database_id`. Copy it.

Edit `wrangler.toml`: replace `REPLACE_WITH_ID_FROM_WRANGLER_D1_CREATE` with the real id.

- [ ] **Step 3: Create the KV namespace**

Run: `npx wrangler kv namespace create MOOD_KV`
Expected: prints an `id`.

Edit `wrangler.toml`: replace `REPLACE_WITH_ID_FROM_WRANGLER_KV_CREATE` with the real id.

- [ ] **Step 4: Apply migrations to remote D1**

Run: `npm run migrate:remote`
Expected: migration `0001_init.sql` applies successfully.

- [ ] **Step 5: Commit the wrangler config**

```bash
git add wrangler.toml
git commit -m "chore: bind real D1 + KV ids in wrangler.toml"
```

---

## Task 17: Configure Cloudflare Access (manual)

This is a Cloudflare dashboard task, not a code task. Document it in `docs/runbook.md` for future-you.

**Files:**
- Create: `docs/runbook.md`

- [ ] **Step 1: In the Cloudflare dashboard**

1. Open **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application name: `Mood`. Session duration: 24h.
3. Application domain: `mood.clydeford.net`.
4. Identity providers: include the user's existing primary IdP (One-Time PIN or Google etc.) **and** require an MFA method per the existing policy.
5. **Policies**: add a single policy named `Owner`, action **Allow**, include rule: emails matches `stevie.johnston@gmail.com`. Require: `Authentication method` includes the MFA factor that the existing policy uses.
6. Save the application. Open it again and copy the **Application Audience (AUD) Tag** and the **Team domain** (`<team>.cloudflareaccess.com`).

- [ ] **Step 2: Plug AUD + team domain into wrangler.toml**

Edit `wrangler.toml`: replace the placeholders under `[vars]`:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"
ACCESS_AUD = "<the-aud-tag>"
```

- [ ] **Step 3: Capture in `docs/runbook.md`**

```markdown
# Runbook

## Cloudflare Access

App: `Mood` (Zero Trust → Access → Applications)
- Domain: `mood.clydeford.net`
- Policy: Owner — allow email `stevie.johnston@gmail.com` with MFA factor required
- Identity providers: <list>
- AUD Tag: stored in `wrangler.toml` under `ACCESS_AUD`
- Team domain: stored in `wrangler.toml` under `ACCESS_TEAM_DOMAIN`

## Resources

- D1: `mood` (id pinned in `wrangler.toml`)
- KV: `MOOD_KV` (id pinned in `wrangler.toml`)
- Worker: `mood-tracker`

## Deploy

1. `npm run migrate:remote` if there are new migrations.
2. `npm run deploy`.

## Local dev

1. `npm run migrate:local`
2. `npm run dev`
3. The dev server bypasses Access; it falls back to `DEV_FAKE_EMAIL` from `.dev.vars`.
```

- [ ] **Step 4: Commit**

```bash
git add wrangler.toml docs/runbook.md
git commit -m "chore: wire Access AUD/team domain + write runbook"
```

---

## Task 18: Deploy and end-to-end smoke

- [ ] **Step 1: Deploy the Worker**

Run: `npm run deploy`
Expected: the deploy succeeds and prints the worker URL `https://mood-tracker.<subdomain>.workers.dev` plus the custom domain binding.

- [ ] **Step 2: Confirm DNS**

In Cloudflare dashboard, confirm a proxied record exists for `mood.clydeford.net` pointing to the Worker (Wrangler's `custom_domain = true` auto-creates this; if it didn't, add a CNAME `mood` → `mood-tracker.<subdomain>.workers.dev` with proxy on).

- [ ] **Step 3: Hit the app over HTTPS**

Open `https://mood.clydeford.net` in a browser. Expected: Cloudflare Access challenge appears, MFA required, then the app loads.

- [ ] **Step 4: Full user journey**

1. Log a mood: select all four metrics, optional note, Save. Expect 200 and "Saved ✓".
2. Open History — confirm today's cell shows the chosen mood colour.
3. Open the chat bubble, ask "How am I doing?". Expect a streamed reply that reflects today's entry.
4. Force a refresh. Expect: today's entry pre-fills the form; chat session has reset.
5. Wait ~10s after the entry, refresh; check History — if the AI returned a non-NONE insight, the banner appears under the heading.

- [ ] **Step 5: Verify the API is gated**

In an incognito window without auth, `curl -i https://mood.clydeford.net/api/entries`. Expected: redirected to Access (HTML challenge) or 302 to `<team>.cloudflareaccess.com`. The Worker is never reached without a JWT.

- [ ] **Step 6: Tag the release**

```bash
git tag v0.1.0
git push --tags
```

(If there is no remote yet, set one first: `git remote add origin <repo>` then `git push -u origin master --tags`.)

---

## Self-review summary

- **Spec coverage**
  - §2 architecture → Tasks 1, 11, 16, 18.
  - §3 identity & auth → Task 6 + Task 17.
  - §4 data model → Task 2 (schema), Task 5 (helpers).
  - §5 API → Tasks 8, 9, 10, 11.
  - §6 AI behaviour → Tasks 7, 9, 10.
  - §7 frontend → Tasks 12, 13, 14, 15.
  - §8 project structure → Task 1.
  - §9 deployment → Tasks 16, 17, 18.
  - §10 testing → Tasks 4–11 each include vitest tests.
  - §11 out-of-scope: respected — no PWA, no push, no streaks, no past-date editing UI.
  - §12 open questions: "hatched cell for no-entry" is implemented in Task 14 via `.cell.empty` CSS class.

- **No placeholders** — every code step contains the full code to write.

- **Type consistency** — `Entry`, `EntryInput`, `ChatTurn`, `Insight`, `Identity`, `Env` are declared in Task 3 and used unchanged throughout. The function `runInsightJob(env, email)` is stubbed in Task 8 and replaced in Task 9 with the same signature.
