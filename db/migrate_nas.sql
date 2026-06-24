-- Migrate NAS data into journal_analyzer
-- Run: psql -U justin -d journal_analyzer -f db/migrate_nas.sql

-- ── NAS tables (no auth/owner columns — single-user personal app) ─────────────
CREATE TABLE IF NOT EXISTS folders (
  id         SERIAL  PRIMARY KEY,
  name       TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS files (
  id            SERIAL  PRIMARY KEY,
  name          TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  stored_name   TEXT    NOT NULL,
  size          BIGINT  NOT NULL,
  mime_type     TEXT,
  folder_id     INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id          SERIAL  PRIMARY KEY,
  title       TEXT    NOT NULL,
  description TEXT,
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  all_day     BOOLEAN DEFAULT false,
  color       TEXT    DEFAULT '#3b82f6',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_folder  ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_start  ON calendar_events(start_time);

-- ── Migrate folders from nas_db ───────────────────────────────────────────────
INSERT INTO folders (id, name, parent_id, created_at)
SELECT id, name, parent_id, created_at
FROM dblink('dbname=nas_db user=postgres password=postgres',
  'SELECT id, name, parent_id, created_at FROM folders')
AS t(id int, name text, parent_id int, created_at timestamptz)
ON CONFLICT (id) DO NOTHING;

-- Reset sequence after manual id insert
SELECT setval('folders_id_seq', (SELECT MAX(id) FROM folders));

-- ── Migrate files from nas_db ─────────────────────────────────────────────────
INSERT INTO files (id, name, original_name, stored_name, size, mime_type, folder_id, created_at)
SELECT id, name, original_name, stored_name, size, mime_type, folder_id, created_at
FROM dblink('dbname=nas_db user=postgres password=postgres',
  'SELECT id, name, original_name, stored_name, size, mime_type, folder_id, created_at FROM files')
AS t(id int, name text, original_name text, stored_name text, size bigint, mime_type text, folder_id int, created_at timestamptz)
ON CONFLICT (id) DO NOTHING;

SELECT setval('files_id_seq', (SELECT MAX(id) FROM files));

-- ── Migrate calendar events from nas_db ───────────────────────────────────────
INSERT INTO calendar_events (id, title, description, start_time, end_time, all_day, color, created_at)
SELECT id, title, description, start_time, end_time, all_day, color, created_at
FROM dblink('dbname=nas_db user=postgres password=postgres',
  'SELECT id, title, description, start_time, end_time, all_day, color, created_at FROM calendar_events')
AS t(id int, title text, description text, start_time timestamptz, end_time timestamptz, all_day bool, color text, created_at timestamptz)
ON CONFLICT (id) DO NOTHING;

SELECT setval('calendar_events_id_seq', (SELECT MAX(id) FROM calendar_events));
