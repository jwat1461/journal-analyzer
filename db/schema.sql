CREATE TABLE IF NOT EXISTS habits (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  emoji         TEXT    NOT NULL DEFAULT '⭐',
  color         TEXT    NOT NULL DEFAULT '#6366f1',
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entries (
  id          TEXT    PRIMARY KEY,
  date        TEXT    NOT NULL,
  content     TEXT    DEFAULT '',
  mood        INTEGER,
  tags        TEXT[]  DEFAULT '{}',
  habits      JSONB   DEFAULT '{}',
  word_count  INTEGER DEFAULT 0,
  created_at  BIGINT  NOT NULL,
  image       TEXT
);
