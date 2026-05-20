// test/helpers.ts
import { env } from "cloudflare:test";
import migrations from "../migrations/0001_init.sql?raw";

// Applies the migration file if needed, then truncates between tests.
// We check whether the tables exist rather than relying on a module-level flag,
// because ViteNode may re-evaluate this module across test executions.
export async function applyMigrations(): Promise<void> {
  // Check if the tables already exist by querying sqlite_master
  const tableCheck = await env.DB.prepare(
    "SELECT count(*) as n FROM sqlite_master WHERE type='table' AND name='entries'",
  ).first<{ n: number }>();
  const tablesExist = (tableCheck?.n ?? 0) > 0;

  if (!tablesExist) {
    // Split the SQL file on ";" to produce individual statements, strip
    // SQL line comments from each chunk, then run each statement directly.
    const stmts = migrations
      .split(/;/)
      .map((s: string) =>
        s
          .split("\n")
          .filter((line: string) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((s: string) => s.length > 0);
    for (const stmt of stmts) {
      await env.DB.prepare(stmt).run();
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM entries"),
    env.DB.prepare("DELETE FROM chat_turns"),
    env.DB.prepare("DELETE FROM insights"),
  ]);
}

export async function seedEntry(
  email: string,
  date: string,
  overrides: Partial<{
    mood: number;
    energy: number;
    anxiety: number;
    sleep: number;
    note: string | null;
  }> = {},
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO entries (email,date,mood,energy,anxiety,sleep,note,tz,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      email,
      date,
      overrides.mood ?? 3,
      overrides.energy ?? 3,
      overrides.anxiety ?? 2,
      overrides.sleep ?? 3,
      overrides.note ?? null,
      "Europe/London",
      now,
      now,
    )
    .run();
}
