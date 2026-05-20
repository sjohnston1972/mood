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
       mood=?3, energy=?4, anxiety=?5, sleep=?6, note=?7, tz=?8, updated_at=?9`,
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
       FROM entries WHERE email = ?1 AND date = ?2`,
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
      ORDER BY date DESC`,
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
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(email, session_id, role, content, now).run();
}

export async function listChatTurns(
  db: D1Database, email: string, session_id: string,
): Promise<ChatTurn[]> {
  const { results } = await db.prepare(
    `SELECT id, session_id, role, content, created_at
       FROM chat_turns
      WHERE email = ?1 AND session_id = ?2
      ORDER BY id ASC`,
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
     ON CONFLICT(email, date) DO UPDATE SET text=?3, created_at=?4`,
  ).bind(email, date, text, now).run();
}

export async function getLatestInsight(
  db: D1Database, email: string,
): Promise<Insight | null> {
  const row = await db.prepare(
    `SELECT date, text, created_at
       FROM insights
      WHERE email = ?
      ORDER BY date DESC LIMIT 1`,
  ).bind(email).first<Insight>();
  return row ?? null;
}
