-- ── Journal Analyzer + NAS — Unified Schema ──────────────────────────────────
-- Run: psql -U <user> -d <dbname> -f db/schema_full.sql
-- Safe to run on existing databases (uses IF NOT EXISTS + ALTER TABLE IF NOT EXISTS).

-- ── Users (from NAS) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL       PRIMARY KEY,
  name          TEXT         NOT NULL,
  email         TEXT         UNIQUE NOT NULL,
  password_hash TEXT         NOT NULL,
  role          TEXT         DEFAULT 'user',
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── Journal Entries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT     PRIMARY KEY,
  date       DATE     NOT NULL,
  content    TEXT     DEFAULT '',
  mood       SMALLINT,
  tags       TEXT[]   DEFAULT '{}',
  habits     JSONB    DEFAULT '{}',
  word_count INTEGER  DEFAULT 0,
  created_at BIGINT   NOT NULL,
  image      TEXT
);

-- ── Habits ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS habits (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  emoji         TEXT    DEFAULT '⭐',
  color         TEXT    DEFAULT '#6366f1',
  display_order INTEGER DEFAULT 0
);

-- ── Calendar Events (journal + NAS merged) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id              SERIAL      PRIMARY KEY,
  title           TEXT        NOT NULL,
  description     TEXT,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  all_day         BOOLEAN     DEFAULT false,
  color           TEXT        DEFAULT '#3b82f6',
  is_shared       BOOLEAN     DEFAULT false,
  owner_id        INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  recurrence_rule TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Folders ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS folders (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL,
  parent_id  INTEGER     REFERENCES folders(id) ON DELETE CASCADE,
  owner_id   INTEGER     REFERENCES users(id)   ON DELETE SET NULL,
  is_shared  BOOLEAN     DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Files ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id            SERIAL      PRIMARY KEY,
  name          TEXT        NOT NULL,
  original_name TEXT        NOT NULL,
  stored_name   TEXT        NOT NULL,
  size          BIGINT      NOT NULL,
  mime_type     TEXT,
  folder_id     INTEGER     REFERENCES folders(id) ON DELETE SET NULL,
  owner_id      INTEGER     REFERENCES users(id)   ON DELETE SET NULL,
  is_shared     BOOLEAN     DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Upgrade existing tables (safe on fresh DB too) ───────────────────────────
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_shared       BOOLEAN DEFAULT false;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;
ALTER TABLE folders         ADD COLUMN IF NOT EXISTS is_shared       BOOLEAN DEFAULT false;
ALTER TABLE folders         ADD COLUMN IF NOT EXISTS owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE files           ADD COLUMN IF NOT EXISTS is_shared       BOOLEAN DEFAULT false;
ALTER TABLE files           ADD COLUMN IF NOT EXISTS owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE files           ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entries_date    ON entries(date);
CREATE INDEX IF NOT EXISTS idx_files_folder    ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_owner     ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent  ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_owner   ON folders(owner_id);
CREATE INDEX IF NOT EXISTS idx_events_start    ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_events_owner    ON calendar_events(owner_id);
