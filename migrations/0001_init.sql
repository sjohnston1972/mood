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
