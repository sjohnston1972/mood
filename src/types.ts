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
