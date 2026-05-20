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
