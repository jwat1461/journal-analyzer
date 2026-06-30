require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const multer     = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Pool }   = require('pg');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');

const app        = express();
const pool       = new Pool({ connectionString: process.env.DATABASE_URL });
const UPLOADS    = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const JWT_SECRET = process.env.JWT_SECRET  || 'ja-nas-secret-change-in-production';

if (!process.env.JWT_SECRET) {
  console.warn('[Config] WARNING: JWT_SECRET not set — using insecure default. Set it in .env for production.');
}

// Trust Cloudflare/reverse-proxy headers so req.ip and HTTPS detection work correctly
app.set('trust proxy', 1);

// ── Schema ────────────────────────────────────────────────────────────────────
const JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id          TEXT     PRIMARY KEY,
  date        TEXT     NOT NULL,
  content     TEXT     DEFAULT '',
  mood        SMALLINT,
  tags        TEXT[]   DEFAULT '{}',
  habits      JSONB    DEFAULT '{}',
  word_count  INTEGER  DEFAULT 0,
  created_at  BIGINT   NOT NULL,
  image       TEXT,
  user_id     INTEGER
);
CREATE TABLE IF NOT EXISTS habits (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  emoji         TEXT    DEFAULT '⭐',
  color         TEXT    DEFAULT '#6366f1',
  display_order INTEGER DEFAULT 0,
  user_id       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE TABLE IF NOT EXISTS na_meetings (
  id              TEXT     PRIMARY KEY,
  name            TEXT     NOT NULL,
  day_of_week     SMALLINT NOT NULL,
  meeting_time    TEXT,
  location        TEXT,
  commitment_type TEXT     DEFAULT 'member',
  notes           TEXT,
  recurring       BOOLEAN  DEFAULT true,
  color           TEXT     DEFAULT '#6366f1',
  created_at      BIGINT,
  user_id         INTEGER
);
CREATE TABLE IF NOT EXISTS na_meeting_attendance (
  id            TEXT PRIMARY KEY,
  meeting_id    TEXT REFERENCES na_meetings(id) ON DELETE CASCADE,
  attended_date DATE NOT NULL,
  user_id       INTEGER,
  UNIQUE(meeting_id, attended_date)
);
CREATE TABLE IF NOT EXISTS na_sponsor (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  years_clean  TEXT,
  notes        TEXT,
  current_step SMALLINT DEFAULT 1,
  user_id      INTEGER
);
CREATE TABLE IF NOT EXISTS na_steps (
  step_number  SMALLINT,
  notes        TEXT     DEFAULT '',
  completed_at BIGINT,
  user_id      INTEGER,
  PRIMARY KEY (step_number, user_id)
);
CREATE TABLE IF NOT EXISTS na_daily_tasks (
  id           TEXT    PRIMARY KEY,
  task_text    TEXT    NOT NULL,
  sort_order   INTEGER DEFAULT 0,
  is_preset    BOOLEAN DEFAULT false,
  created_at   BIGINT  DEFAULT 0,
  user_id      INTEGER
);
CREATE TABLE IF NOT EXISTS na_daily_task_completions (
  id             TEXT PRIMARY KEY,
  task_id        TEXT REFERENCES na_daily_tasks(id) ON DELETE CASCADE,
  completed_date DATE NOT NULL,
  user_id        INTEGER,
  UNIQUE(task_id, completed_date)
);
CREATE TABLE IF NOT EXISTS na_settings (
  key     TEXT,
  value   TEXT,
  user_id INTEGER,
  PRIMARY KEY (key, user_id)
);
CREATE TABLE IF NOT EXISTS na_resources (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  description TEXT,
  category    TEXT DEFAULT 'general',
  created_at  BIGINT DEFAULT 0,
  user_id     INTEGER
);
CREATE TABLE IF NOT EXISTS quit_habits (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  quit_date TEXT,
  color     TEXT DEFAULT '#ef4444',
  notes     TEXT,
  created_at BIGINT DEFAULT 0,
  user_id   INTEGER
);
CREATE TABLE IF NOT EXISTS na_sponsees (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  phone    TEXT,
  step     SMALLINT DEFAULT 0,
  notes    TEXT,
  added_at BIGINT DEFAULT 0,
  user_id  INTEGER
);
CREATE TABLE IF NOT EXISTS step_notes (
  id         TEXT PRIMARY KEY,
  step_num   SMALLINT NOT NULL,
  content    TEXT NOT NULL,
  created_at BIGINT DEFAULT 0,
  user_id    INTEGER
);
`;

// Migration SQL — runs safely on existing databases
const MIGRATION_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count   INTEGER     DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE entries              ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE habits               ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_meetings          ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_meeting_attendance ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_sponsor           ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_steps             ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_daily_tasks       ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_daily_task_completions ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_settings          ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_resources         ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE quit_habits          ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE na_sponsees          ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE step_notes           ADD COLUMN IF NOT EXISTS user_id INTEGER;

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE folders         ADD COLUMN IF NOT EXISTS user_id INTEGER;
ALTER TABLE files           ADD COLUMN IF NOT EXISTS user_id INTEGER;

-- Assign existing orphan data to first registered user
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = 1) THEN
    UPDATE entries              SET user_id = 1 WHERE user_id IS NULL;
    UPDATE habits               SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_meetings          SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_meeting_attendance SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_sponsor           SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_steps             SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_daily_tasks       SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_daily_task_completions SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_settings          SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_resources         SET user_id = 1 WHERE user_id IS NULL;
    UPDATE quit_habits          SET user_id = 1 WHERE user_id IS NULL;
    UPDATE na_sponsees          SET user_id = 1 WHERE user_id IS NULL;
    UPDATE step_notes           SET user_id = 1 WHERE user_id IS NULL;
    UPDATE calendar_events      SET user_id = 1 WHERE user_id IS NULL;
    UPDATE folders              SET user_id = 1 WHERE user_id IS NULL;
    UPDATE files                SET user_id = 1 WHERE user_id IS NULL;
  END IF;
END $$;

-- Unique constraint for na_sponsor (one sponsor per user)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'na_sponsor_user_id_key') THEN
    ALTER TABLE na_sponsor ADD CONSTRAINT na_sponsor_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- na_steps: migrate single-column PK (step_number) → composite PK (step_number, user_id)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='na_steps' AND constraint_name='na_steps_pkey' AND constraint_type='PRIMARY KEY'
  ) AND (
    SELECT COUNT(*) FROM information_schema.key_column_usage
    WHERE constraint_name='na_steps_pkey' AND table_name='na_steps'
  ) = 1 THEN
    -- Deduplicate: keep only one row per (step_number, user_id) before changing PK
    DELETE FROM na_steps a USING na_steps b
      WHERE a.ctid > b.ctid
        AND a.step_number = b.step_number
        AND a.user_id IS NOT DISTINCT FROM b.user_id;
    ALTER TABLE na_steps DROP CONSTRAINT na_steps_pkey;
    ALTER TABLE na_steps ADD PRIMARY KEY (step_number, user_id);
  END IF;
END $$;

-- na_settings: migrate single-column PK (key) → composite PK (key, user_id)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='na_settings' AND constraint_name='na_settings_pkey' AND constraint_type='PRIMARY KEY'
  ) AND (
    SELECT COUNT(*) FROM information_schema.key_column_usage
    WHERE constraint_name='na_settings_pkey' AND table_name='na_settings'
  ) = 1 THEN
    DELETE FROM na_settings a USING na_settings b
      WHERE a.ctid > b.ctid
        AND a.key = b.key
        AND a.user_id IS NOT DISTINCT FROM b.user_id;
    ALTER TABLE na_settings DROP CONSTRAINT na_settings_pkey;
    ALTER TABLE na_settings ADD PRIMARY KEY (key, user_id);
  END IF;
END $$;

-- na_meeting_attendance: include user_id in unique constraint so different users can attend same meeting
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'na_meeting_attendance_meeting_id_attended_date_key') THEN
    ALTER TABLE na_meeting_attendance DROP CONSTRAINT na_meeting_attendance_meeting_id_attended_date_key;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'na_meeting_attendance_user_meeting_date_key') THEN
    ALTER TABLE na_meeting_attendance ADD CONSTRAINT na_meeting_attendance_user_meeting_date_key
      UNIQUE (meeting_id, attended_date, user_id);
  END IF;
END $$;
`;

// Local-timezone date string — avoids UTC rollover for self-hosted apps
function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Calendar auto-sync helper — scoped to a specific user
const JOURNAL_CAL_COLOR = '#6366f1';

async function syncEntryToCalendar(date, content, mood, userId) {
  const moodEmoji = ['','😔','😕','😐','🙂','😄'][mood] || '';
  const title = `📓 Journal${moodEmoji ? ' ' + moodEmoji : ''}`;
  const snippet = content ? content.substring(0, 200) : null;
  const start = `${date}T00:00:00`;
  const end   = `${date}T23:59:59`;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM calendar_events
       WHERE all_day=true AND start_time::date=$1::date AND title LIKE '📓%'
         AND user_id IS NOT DISTINCT FROM $2`,
      [date, userId]
    );
    if (rows.length) {
      await pool.query(
        `UPDATE calendar_events SET title=$1, description=$2 WHERE id=$3`,
        [title, snippet, rows[0].id]
      );
      return 'updated';
    } else {
      await pool.query(
        `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, user_id)
         VALUES ($1,$2,$3,$4,true,$5,$6)`,
        [title, snippet, start, end, JOURNAL_CAL_COLOR, userId]
      );
      return 'created';
    }
  } catch (err) {
    console.error('[Calendar sync]', err.message);
    return 'error';
  }
}

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS,
  filename: (_req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS));
app.use(express.static(__dirname));

// ── Auth helpers ──────────────────────────────────────────────────────────────
let userCountCache = null;

async function hasRegisteredUsers() {
  if (userCountCache === null) {
    try {
      const { rows } = await pool.query('SELECT COUNT(*) FROM users');
      userCountCache = parseInt(rows[0].count) > 0;
    } catch { userCountCache = false; }
  }
  return userCountCache;
}

async function requireAuth(req, res, next) {
  if (!(await hasRegisteredUsers())) {
    req.user = { id: null, name: 'Admin', role: 'admin' };
    return next();
  }
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Shorthand: current user's id (null in setup mode)
const uid = req => req.user?.id ?? null;

// ── Row mappers ───────────────────────────────────────────────────────────────
function rowToEntry(r) {
  const dateVal = r.date instanceof Date
    ? [r.date.getFullYear(), String(r.date.getMonth()+1).padStart(2,'0'), String(r.date.getDate()).padStart(2,'0')].join('-')
    : String(r.date).slice(0, 10);
  return {
    id: r.id, date: dateVal, content: r.content ?? '',
    mood: r.mood, tags: r.tags ?? [], habits: r.habits ?? {},
    wordCount: r.word_count, createdAt: Number(r.created_at),
    ...(r.image ? { image: r.image } : {}),
  };
}
function rowToHabit(r) {
  return { id: r.id, name: r.name, emoji: r.emoji, color: r.color };
}
function rowToEvent(r) {
  return {
    id: r.id, title: r.title, description: r.description || '',
    startTime: r.start_time, endTime: r.end_time,
    allDay: r.all_day, color: r.color || '#3b82f6',
    isShared: r.is_shared || false,
    recurrenceRule: r.recurrence_rule || null,
  };
}
function rowToFolder(r) {
  return { id: r.id, name: r.name, parentId: r.parent_id, isShared: r.is_shared || false };
}
function rowToFile(r) {
  return {
    id: r.id, name: r.name, originalName: r.original_name,
    storedName: r.stored_name, size: Number(r.size),
    mimeType: r.mime_type, folderId: r.folder_id,
    isShared: r.is_shared || false,
    createdAt: r.created_at,
  };
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.get('/api/auth/status', async (_req, res) => {
  const needsAuth = await hasRegisteredUsers();
  res.json({ needsAuth, claudeReady: !!process.env.ANTHROPIC_API_KEY });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email, and password are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,role',
      [name, email, hash]
    );
    userCountCache = true;
    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });

    // Claim any orphan data (user_id IS NULL) left from setup mode
    const newId = user.id;
    await Promise.all([
      pool.query('UPDATE entries SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE habits SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE calendar_events SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE folders SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE files SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_meetings SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_meeting_attendance SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_sponsor SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_steps SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_daily_tasks SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_daily_task_completions SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_settings SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_resources SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE quit_habits SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE na_sponsees SET user_id=$1 WHERE user_id IS NULL', [newId]),
      pool.query('UPDATE step_notes SET user_id=$1 WHERE user_id IS NULL', [newId]),
    ]).catch(err => console.error('[Register] orphan claim error:', err.message));

    // Seed default daily tasks for this new user if they have none
    const { rows: tc } = await pool.query('SELECT COUNT(*) FROM na_daily_tasks WHERE user_id=$1', [newId]);
    if (parseInt(tc[0].count) === 0) await seedDefaultTasks(newId);

    res.status(201).json({ user, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query(
      'SELECT id,name,email,password_hash,role FROM users WHERE email=$1', [email]
    );
    const row = rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });
    await pool.query(
      'UPDATE users SET login_count = login_count + 1, last_login_at = NOW() WHERE id=$1',
      [row.id]
    );
    const user = { id: row.id, name: row.name, email: row.email, role: row.role };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

app.get('/api/admin/users', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== null) {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, created_at, login_count, last_login_at
       FROM users ORDER BY id`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Journal Entries ───────────────────────────────────────────────────────────
app.get('/api/entries', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM entries WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY created_at DESC',
      [uid(req)]
    );
    res.json(rows.map(rowToEntry));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/entries', requireAuth, async (req, res) => {
  const { id, date, content, mood, tags, habits, wordCount, createdAt, image } = req.body;
  const u = uid(req);
  try {
    const { rows } = await pool.query(
      `INSERT INTO entries (id, date, content, mood, tags, habits, word_count, created_at, image, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE
         SET content=$3, mood=$4, tags=$5, habits=$6, word_count=$7, image=$9
       RETURNING *`,
      [id, date, content ?? '', mood ?? null, tags ?? [], JSON.stringify(habits ?? {}),
       wordCount ?? 0, createdAt, image ?? null, u]
    );
    syncEntryToCalendar(date, content, mood, u).catch(() => {});
    res.status(201).json(rowToEntry(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM entries WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM entries WHERE user_id IS NOT DISTINCT FROM $1', [uid(req)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Habits ────────────────────────────────────────────────────────────────────
app.get('/api/habits', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM habits WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY display_order',
      [uid(req)]
    );
    res.json(rows.map(rowToHabit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/habits', requireAuth, async (req, res) => {
  const { id, name, emoji, color } = req.body;
  const u = uid(req);
  try {
    const { rows } = await pool.query(
      `INSERT INTO habits (id, name, emoji, color, display_order, user_id)
       VALUES ($1,$2,$3,$4,
         (SELECT COALESCE(MAX(display_order)+1,0) FROM habits WHERE user_id IS NOT DISTINCT FROM $5),
         $5)
       RETURNING *`,
      [id, name, emoji ?? '⭐', color ?? '#6366f1', u]
    );
    res.status(201).json(rowToHabit(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/habits/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM habits WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/habits', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM habits WHERE user_id IS NOT DISTINCT FROM $1', [uid(req)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calendar Events ───────────────────────────────────────────────────────────
app.get('/api/calendar-events', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    const { start, end } = req.query;
    let q = 'SELECT * FROM calendar_events WHERE user_id IS NOT DISTINCT FROM $1';
    const params = [u];
    if (start && end) {
      q += ' AND start_time >= $2 AND start_time <= $3';
      params.push(start, end);
    }
    q += ' ORDER BY start_time';
    const { rows } = await pool.query(q, params);
    res.json(rows.map(rowToEvent));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/calendar-events', requireAuth, async (req, res) => {
  const { title, description, startTime, endTime, allDay, color, isShared, recurrenceRule } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO calendar_events
         (title, description, start_time, end_time, all_day, color, is_shared, recurrence_rule, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [title, description || null, startTime, endTime,
       allDay || false, color || '#3b82f6', isShared || false, recurrenceRule || null, uid(req)]
    );
    res.status(201).json(rowToEvent(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/calendar-events/:id', requireAuth, async (req, res) => {
  const { title, description, startTime, endTime, allDay, color, isShared, recurrenceRule } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE calendar_events
       SET title=$1, description=$2, start_time=$3, end_time=$4,
           all_day=$5, color=$6, is_shared=$7, recurrence_rule=$8
       WHERE id=$9 AND user_id IS NOT DISTINCT FROM $10 RETURNING *`,
      [title, description || null, startTime, endTime,
       allDay || false, color || '#3b82f6', isShared || false,
       recurrenceRule || null, req.params.id, uid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json(rowToEvent(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/calendar-events/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM calendar_events WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Folders ───────────────────────────────────────────────────────────────────
app.get('/api/folders', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    const { parentId } = req.query;
    const { rows } = parentId
      ? await pool.query(
          'SELECT * FROM folders WHERE parent_id=$1 AND user_id IS NOT DISTINCT FROM $2 ORDER BY name',
          [parentId, u]
        )
      : await pool.query(
          'SELECT * FROM folders WHERE parent_id IS NULL AND user_id IS NOT DISTINCT FROM $1 ORDER BY name',
          [u]
        );
    res.json(rows.map(rowToFolder));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/folders', requireAuth, async (req, res) => {
  const { name, parentId, isShared } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO folders (name, parent_id, is_shared, user_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, parentId || null, isShared || false, uid(req)]
    );
    res.status(201).json(rowToFolder(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/folders/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM folders WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Files ─────────────────────────────────────────────────────────────────────
app.get('/api/files', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    const { folderId } = req.query;
    const { rows } = folderId
      ? await pool.query(
          'SELECT * FROM files WHERE folder_id=$1 AND user_id IS NOT DISTINCT FROM $2 ORDER BY name',
          [folderId, u]
        )
      : await pool.query(
          'SELECT * FROM files WHERE folder_id IS NULL AND user_id IS NOT DISTINCT FROM $1 ORDER BY name',
          [u]
        );
    res.json(rows.map(rowToFile));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/files', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { folderId, isShared } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO files (name, original_name, stored_name, size, mime_type, folder_id, is_shared, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.file.originalname, req.file.originalname, req.file.filename,
       req.file.size, req.file.mimetype, folderId || null, isShared === 'true', uid(req)]
    );
    res.status(201).json(rowToFile(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files/:id/download', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM files WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const file = rows[0];
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.sendFile(path.join(UPLOADS, file.stored_name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/files/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM files WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2 RETURNING stored_name',
      [req.params.id, uid(req)]
    );
    if (rows.length) {
      const fp = path.join(UPLOADS, rows[0].stored_name);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Journal → Calendar backfill ───────────────────────────────────────────────
app.post('/api/entries/sync-calendar', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    const { rows: allEntries } = await pool.query(
      'SELECT id, date, content, mood FROM entries WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY date',
      [u]
    );
    let created = 0, updated = 0, errors = 0;
    for (const e of allEntries) {
      const result = await syncEntryToCalendar(e.date, e.content, e.mood, u);
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
      else errors++;
    }
    res.json({ ok: true, total: allEntries.length, created, updated, errors });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Claude proxy ──────────────────────────────────────────────────────────────
app.post('/api/claude', requireAuth, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: { message: 'No API key configured.' } });
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const raw = await upstream.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (!upstream.ok) {
      const message = payload?.error?.message || `Claude upstream error (HTTP ${upstream.status})`;
      return res.status(upstream.status).json({ error: { message, status: upstream.status, type: payload?.error?.type || 'upstream_error' } });
    }
    if (!payload || typeof payload !== 'object')
      return res.status(502).json({ error: { message: 'Invalid response from Claude upstream.' } });
    res.status(upstream.status).json(payload);
  } catch (err) {
    res.status(502).json({ error: { message: `Unable to reach Claude upstream: ${err.message}` } });
  }
});

// ── NA Settings ───────────────────────────────────────────────────────────────
app.get('/api/na/settings', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT key, value FROM na_settings WHERE user_id IS NOT DISTINCT FROM $1',
      [uid(req)]
    );
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/settings', requireAuth, async (req, res) => {
  const updates = req.body;
  const u = uid(req);
  try {
    for (const [k, v] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO na_settings (key, value, user_id) VALUES ($1,$2,$3)
         ON CONFLICT (key, user_id) DO UPDATE SET value=$2`,
        [k, v === null ? null : String(v), u]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Meetings ───────────────────────────────────────────────────────────────
app.get('/api/na/meetings', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    const today = localDateStr();
    const { rows: mtgs } = await pool.query(
      'SELECT * FROM na_meetings WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY day_of_week, meeting_time',
      [u]
    );
    const { rows: att } = await pool.query(
      'SELECT meeting_id FROM na_meeting_attendance WHERE attended_date=$1 AND user_id IS NOT DISTINCT FROM $2',
      [today, u]
    );
    const todaySet = new Set(att.map(r => r.meeting_id));
    res.json(mtgs.map(m => ({
      id: m.id, name: m.name, dayOfWeek: m.day_of_week,
      meetingTime: m.meeting_time, location: m.location,
      commitmentType: m.commitment_type, notes: m.notes,
      recurring: m.recurring, color: m.color || '#6366f1',
      createdAt: Number(m.created_at),
      attendedToday: todaySet.has(m.id),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/meetings', requireAuth, async (req, res) => {
  const { id, name, dayOfWeek, meetingTime, location, commitmentType, notes, recurring, color } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO na_meetings (id,name,day_of_week,meeting_time,location,commitment_type,notes,recurring,color,created_at,user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, name, dayOfWeek, meetingTime||null, location||null,
       commitmentType||'member', notes||null, recurring!==false,
       color||'#6366f1', Date.now(), uid(req)]
    );
    const m = rows[0];
    res.status(201).json({ id:m.id, name:m.name, dayOfWeek:m.day_of_week, meetingTime:m.meeting_time,
      location:m.location, commitmentType:m.commitment_type, notes:m.notes,
      recurring:m.recurring, color:m.color, createdAt:Number(m.created_at), attendedToday:false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/meetings/:id', requireAuth, async (req, res) => {
  const { name, dayOfWeek, meetingTime, location, commitmentType, notes, recurring, color } = req.body;
  const u = uid(req);
  try {
    const { rows } = await pool.query(
      `UPDATE na_meetings SET name=$1,day_of_week=$2,meeting_time=$3,location=$4,
       commitment_type=$5,notes=$6,recurring=$7,color=$8
       WHERE id=$9 AND user_id IS NOT DISTINCT FROM $10 RETURNING *`,
      [name, dayOfWeek, meetingTime||null, location||null,
       commitmentType||'member', notes||null, recurring!==false,
       color||'#6366f1', req.params.id, u]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const m = rows[0];
    const { rows: att } = await pool.query(
      'SELECT meeting_id FROM na_meeting_attendance WHERE attended_date=$1 AND meeting_id=$2 AND user_id IS NOT DISTINCT FROM $3',
      [localDateStr(), m.id, u]
    );
    res.json({ id:m.id, name:m.name, dayOfWeek:m.day_of_week, meetingTime:m.meeting_time,
      location:m.location, commitmentType:m.commitment_type, notes:m.notes,
      recurring:m.recurring, color:m.color, createdAt:Number(m.created_at),
      attendedToday: att.length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/meetings/:id', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    await pool.query(
      'DELETE FROM na_meetings WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, u]
    );
    await pool.query(
      'DELETE FROM calendar_events WHERE recurrence_rule=$1 AND user_id IS NOT DISTINCT FROM $2',
      [`meeting:${req.params.id}`, u]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/meetings/:id/attend', requireAuth, async (req, res) => {
  const today = localDateStr();
  const { attended } = req.body;
  const u = uid(req);
  let calendarEvent = null;
  try {
    if (attended) {
      await pool.query(
        `INSERT INTO na_meeting_attendance (id, meeting_id, attended_date, user_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [uuidv4(), req.params.id, today, u]
      );
      try {
        const { rows: [m] } = await pool.query(
          'SELECT * FROM na_meetings WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
          [req.params.id, u]
        );
        if (m) {
          const title = `🤝 ${m.name}`;
          const st = m.meeting_time ? `${today}T${m.meeting_time}:00` : `${today}T00:00:00`;
          const [hh, mm] = (m.meeting_time || '00:00').split(':').map(Number);
          const endH = String((hh + 1) % 24).padStart(2, '0');
          const et = m.meeting_time ? `${today}T${endH}:${String(mm).padStart(2,'0')}:00` : `${today}T23:59:59`;
          const { rows: ex } = await pool.query(
            `SELECT id FROM calendar_events WHERE title=$1 AND start_time::date=$2::date AND user_id IS NOT DISTINCT FROM $3`,
            [title, today, u]
          );
          if (!ex.length) {
            const { rows: [calRow] } = await pool.query(
              `INSERT INTO calendar_events (title,description,start_time,end_time,all_day,color,recurrence_rule,user_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [title, m.location || null, st, et, !m.meeting_time, m.color || '#6366f1', `meeting:${req.params.id}`, u]
            );
            calendarEvent = rowToEvent(calRow);
          }
        }
      } catch (calErr) {
        console.error('[CalendarSync] attend error:', calErr.message);
      }
    } else {
      await pool.query(
        'DELETE FROM na_meeting_attendance WHERE meeting_id=$1 AND attended_date=$2 AND user_id IS NOT DISTINCT FROM $3',
        [req.params.id, today, u]
      );
    }
    res.json({ ok: true, attended, calendarEvent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/na/meetings/attendance', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    // Monday of current week (server local time)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = (dayOfWeek + 6) % 7;  // days since last Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().slice(0, 10);

    const [{ rows: dateRows }, { rows: [cnt] }, { rows: [weekCnt] }] = await Promise.all([
      pool.query(
        `SELECT DISTINCT attended_date FROM na_meeting_attendance WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY attended_date DESC LIMIT 365`,
        [u]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM na_meeting_attendance WHERE user_id IS NOT DISTINCT FROM $1`,
        [u]
      ),
      pool.query(
        `SELECT COUNT(*) AS week_total FROM na_meeting_attendance WHERE user_id IS NOT DISTINCT FROM $1 AND attended_date >= $2`,
        [u, mondayStr]
      ),
    ]);
    const dates = dateRows.map(r => {
      return r.attended_date instanceof Date
        ? [r.attended_date.getUTCFullYear(),
           String(r.attended_date.getUTCMonth()+1).padStart(2,'0'),
           String(r.attended_date.getUTCDate()).padStart(2,'0')].join('-')
        : String(r.attended_date).slice(0,10);
    });
    res.json({ dates, total: parseInt(cnt.total), thisWeek: parseInt(weekCnt.week_total) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Sponsor ────────────────────────────────────────────────────────────────
app.get('/api/na/sponsor', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM na_sponsor WHERE user_id IS NOT DISTINCT FROM $1 LIMIT 1',
      [uid(req)]
    );
    if (!rows.length) return res.json(null);
    const r = rows[0];
    res.json({ id:r.id, name:r.name, phone:r.phone, email:r.email,
      yearsClean:r.years_clean, notes:r.notes, currentStep:r.current_step });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/sponsor', requireAuth, async (req, res) => {
  const { name, phone, email, yearsClean, notes, currentStep } = req.body;
  const u = uid(req);
  try {
    // Try update first; if no existing row, insert
    const { rowCount } = await pool.query(
      `UPDATE na_sponsor SET name=$1,phone=$2,email=$3,years_clean=$4,notes=$5,current_step=$6
       WHERE user_id IS NOT DISTINCT FROM $7`,
      [name||null, phone||null, email||null, yearsClean||null, notes||null, currentStep||1, u]
    );
    if (!rowCount) {
      await pool.query(
        `INSERT INTO na_sponsor (id,name,phone,email,years_clean,notes,current_step,user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [uuidv4(), name||null, phone||null, email||null, yearsClean||null, notes||null, currentStep||1, u]
      );
    }
    const { rows } = await pool.query(
      'SELECT * FROM na_sponsor WHERE user_id IS NOT DISTINCT FROM $1 LIMIT 1', [u]
    );
    const r = rows[0];
    res.json({ id:r.id, name:r.name, phone:r.phone, email:r.email,
      yearsClean:r.years_clean, notes:r.notes, currentStep:r.current_step });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA 12 Steps ───────────────────────────────────────────────────────────────
app.get('/api/na/steps', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM na_steps WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY step_number',
      [uid(req)]
    );
    const map = {};
    rows.forEach(r => { map[r.step_number] = r; });
    const all = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      const r = map[n];
      return { stepNumber: n, notes: r?.notes || '', completedAt: r?.completed_at ? Number(r.completed_at) : null };
    });
    res.json(all);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/steps/:num', requireAuth, async (req, res) => {
  const n = parseInt(req.params.num);
  if (n < 1 || n > 12) return res.status(400).json({ error: 'Step must be 1–12' });
  const { notes, completed } = req.body;
  const completedAt = completed ? Date.now() : null;
  const u = uid(req);
  try {
    const { rows } = await pool.query(
      `INSERT INTO na_steps (step_number, notes, completed_at, user_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, step_number) DO UPDATE SET notes=$2, completed_at=$3 RETURNING *`,
      [n, notes||'', completedAt, u]
    );
    const r = rows[0];
    res.json({ stepNumber:r.step_number, notes:r.notes, completedAt: r.completed_at ? Number(r.completed_at) : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Daily Tasks ────────────────────────────────────────────────────────────
app.get('/api/na/daily-tasks', requireAuth, async (req, res) => {
  const u = uid(req);
  try {
    const today = localDateStr();
    const { rows: tasks } = await pool.query(
      'SELECT * FROM na_daily_tasks WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY sort_order, created_at',
      [u]
    );
    const { rows: done } = await pool.query(
      'SELECT task_id FROM na_daily_task_completions WHERE completed_date=$1 AND user_id IS NOT DISTINCT FROM $2',
      [today, u]
    );
    const doneSet = new Set(done.map(r => r.task_id));
    res.json(tasks.map(t => ({
      id: t.id, taskText: t.task_text, isPreset: t.is_preset,
      sortOrder: t.sort_order, completedToday: doneSet.has(t.id)
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/daily-tasks', requireAuth, async (req, res) => {
  const { id, taskText, isPreset, sortOrder } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO na_daily_tasks (id, task_text, is_preset, sort_order, created_at, user_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, taskText, isPreset||false, sortOrder||0, Date.now(), uid(req)]
    );
    const t = rows[0];
    res.status(201).json({ id:t.id, taskText:t.task_text, isPreset:t.is_preset,
      sortOrder:t.sort_order, completedToday:false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/daily-tasks/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM na_daily_tasks WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/daily-tasks/:id/complete', requireAuth, async (req, res) => {
  const today = localDateStr();
  const { completed } = req.body;
  const u = uid(req);
  try {
    if (completed) {
      await pool.query(
        `INSERT INTO na_daily_task_completions (id, task_id, completed_date, user_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [uuidv4(), req.params.id, today, u]
      );
    } else {
      await pool.query(
        'DELETE FROM na_daily_task_completions WHERE task_id=$1 AND completed_date=$2 AND user_id IS NOT DISTINCT FROM $3',
        [req.params.id, today, u]
      );
    }
    res.json({ ok: true, completed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Resources ──────────────────────────────────────────────────────────────
app.get('/api/na/resources', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM na_resources WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY created_at',
      [uid(req)]
    );
    res.json(rows.map(r => ({ id:r.id, title:r.title, url:r.url, description:r.description, category:r.category })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/resources', requireAuth, async (req, res) => {
  const { id, title, url, description, category } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO na_resources (id, title, url, description, category, created_at, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, title, url, description||null, category||'general', Date.now(), uid(req)]
    );
    const r = rows[0];
    res.status(201).json({ id:r.id, title:r.title, url:r.url, description:r.description, category:r.category });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/resources/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM na_resources WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Per-meeting attendance stats ──────────────────────────────────────────────
app.get('/api/na/meetings/:id/stats', requireAuth, async (req, res) => {
  const mid = req.params.id;
  const u = uid(req);
  try {
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fmt = d => d.toISOString().split('T')[0];
    const [total, week, month] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM na_meeting_attendance WHERE meeting_id=$1 AND user_id IS NOT DISTINCT FROM $2', [mid, u]),
      pool.query('SELECT COUNT(*) FROM na_meeting_attendance WHERE meeting_id=$1 AND attended_date>=$2 AND user_id IS NOT DISTINCT FROM $3', [mid, fmt(weekStart), u]),
      pool.query('SELECT COUNT(*) FROM na_meeting_attendance WHERE meeting_id=$1 AND attended_date>=$2 AND user_id IS NOT DISTINCT FROM $3', [mid, fmt(monthStart), u]),
    ]);
    res.json({
      total:    parseInt(total.rows[0].count),
      thisWeek: parseInt(week.rows[0].count),
      thisMonth: parseInt(month.rows[0].count),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Quit Habits ───────────────────────────────────────────────────────────────
app.get('/api/quit-habits', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM quit_habits WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY created_at',
      [uid(req)]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/quit-habits', requireAuth, async (req, res) => {
  const { id, name, quit_date, color, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO quit_habits (id,name,quit_date,color,notes,created_at,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [id, name, quit_date || null, color || '#ef4444', notes || null, Date.now(), uid(req)]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/quit-habits/:id', requireAuth, async (req, res) => {
  const { name, quit_date, color, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE quit_habits SET name=$1,quit_date=$2,color=$3,notes=$4 WHERE id=$5 AND user_id IS NOT DISTINCT FROM $6 RETURNING *',
      [name, quit_date || null, color || '#ef4444', notes || null, req.params.id, uid(req)]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/quit-habits/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM quit_habits WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sponsees ──────────────────────────────────────────────────────────────────
app.get('/api/na/sponsees', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM na_sponsees WHERE user_id IS NOT DISTINCT FROM $1 ORDER BY added_at',
      [uid(req)]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/sponsees', requireAuth, async (req, res) => {
  const { id, name, phone, step, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO na_sponsees (id,name,phone,step,notes,added_at,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [id, name, phone || null, step || 0, notes || null, Date.now(), uid(req)]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/sponsees/:id', requireAuth, async (req, res) => {
  const { name, phone, step, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE na_sponsees SET name=$1,phone=$2,step=$3,notes=$4 WHERE id=$5 AND user_id IS NOT DISTINCT FROM $6 RETURNING *',
      [name, phone || null, step || 0, notes || null, req.params.id, uid(req)]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/sponsees/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM na_sponsees WHERE id=$1 AND user_id IS NOT DISTINCT FROM $2',
      [req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Step Notes ────────────────────────────────────────────────────────────────
app.get('/api/na/steps/:num/notes', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM step_notes WHERE step_num=$1 AND user_id IS NOT DISTINCT FROM $2 ORDER BY created_at',
      [parseInt(req.params.num), uid(req)]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/steps/:num/notes', requireAuth, async (req, res) => {
  const { id, content } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO step_notes (id,step_num,content,created_at,user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, parseInt(req.params.num), content, Date.now(), uid(req)]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/steps/:num/notes/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM step_notes WHERE id=$1 AND step_num=$2 AND user_id IS NOT DISTINCT FROM $3',
      [req.params.id, parseInt(req.params.num), uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Profile Picture ───────────────────────────────────────────────────────────
// Per-user avatar: stored as avatar-<userId>.jpg (or avatar.jpg for setup mode)
function avatarFilename(req) {
  const u = uid(req);
  return u ? `avatar-${u}.jpg` : 'avatar.jpg';
}

app.post('/api/profile/picture', requireAuth, async (req, res) => {
  const { image } = req.body;
  if (!image || !image.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image' });
  try {
    const base64 = image.replace(/^data:image\/[^;]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 5 MB)' });
    if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
    const fname = avatarFilename(req);
    fs.writeFileSync(path.join(UPLOADS, fname), buf);
    res.json({ url: `/uploads/${fname}?t=` + Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/profile/picture', requireAuth, (req, res) => {
  const f = path.join(UPLOADS, avatarFilename(req));
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

app.get('/api/profile', requireAuth, (req, res) => {
  const fname = avatarFilename(req);
  const f = path.join(UPLOADS, fname);
  res.json({ avatarUrl: fs.existsSync(f) ? `/uploads/${fname}` : null });
});

const PORT = process.env.PORT || 3001;

// ── Default daily tasks seed ──────────────────────────────────────────────────
async function seedDefaultTasks(userId) {
  const defaults = [
    'Call my sponsor',
    'Pray or meditate',
    'Read the NA Basic Text',
    'Send a gratitude list',
    'Attend a meeting',
    'Reach out to another addict in recovery',
    'Write in my journal',
  ];
  for (const [i, text] of defaults.entries()) {
    await pool.query(
      `INSERT INTO na_daily_tasks (id, task_text, is_preset, sort_order, created_at, user_id)
       VALUES ($1,$2,true,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uuidv4(), text, i, Date.now() + i, userId]
    );
  }
}

async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('[DB] Connected');
    await pool.query(JOURNAL_SCHEMA);
    await pool.query(MIGRATION_SQL);
    console.log('[DB] Schema + user isolation migration complete');
  } catch (err) {
    console.error(`[DB] Startup error: ${err.message}`);
  }

  console.log(`[Config] PORT=${PORT}`);
  console.log(`[Config] Claude key source=${process.env.ANTHROPIC_API_KEY ? 'env:ANTHROPIC_API_KEY' : 'request:x-api-key'}`);

  // Seed default tasks for setup mode (no users) so first-time experience works
  try {
    const { rows: taskCheck } = await pool.query(
      'SELECT COUNT(*) FROM na_daily_tasks WHERE user_id IS NULL'
    );
    if (parseInt(taskCheck[0].count) === 0) {
      await seedDefaultTasks(null);
      console.log('[NA] Seeded default daily tasks for setup mode');
    }
  } catch (err) {
    console.error('[NA] Task seed error:', err.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Recovery Tracker running on port ${PORT}`);
    console.log(`  Local:   http://localhost:${PORT}`);
    if (process.env.PUBLIC_URL) console.log(`  Public:  ${process.env.PUBLIC_URL}`);
  });
}

startServer();
