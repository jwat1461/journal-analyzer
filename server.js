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

// ── Schema (journal tables — NAS tables already exist in nas_db) ──────────────
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
  image       TEXT
);
CREATE TABLE IF NOT EXISTS habits (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  emoji         TEXT    DEFAULT '⭐',
  color         TEXT    DEFAULT '#6366f1',
  display_order INTEGER DEFAULT 0
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
  created_at      BIGINT
);
CREATE TABLE IF NOT EXISTS na_meeting_attendance (
  id            TEXT PRIMARY KEY,
  meeting_id    TEXT REFERENCES na_meetings(id) ON DELETE CASCADE,
  attended_date DATE NOT NULL,
  UNIQUE(meeting_id, attended_date)
);
CREATE TABLE IF NOT EXISTS na_sponsor (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  years_clean  TEXT,
  notes        TEXT,
  current_step SMALLINT DEFAULT 1
);
CREATE TABLE IF NOT EXISTS na_steps (
  step_number  SMALLINT PRIMARY KEY,
  notes        TEXT     DEFAULT '',
  completed_at BIGINT
);
CREATE TABLE IF NOT EXISTS na_daily_tasks (
  id           TEXT    PRIMARY KEY,
  task_text    TEXT    NOT NULL,
  sort_order   INTEGER DEFAULT 0,
  is_preset    BOOLEAN DEFAULT false,
  created_at   BIGINT  DEFAULT 0
);
CREATE TABLE IF NOT EXISTS na_daily_task_completions (
  id             TEXT PRIMARY KEY,
  task_id        TEXT REFERENCES na_daily_tasks(id) ON DELETE CASCADE,
  completed_date DATE NOT NULL,
  UNIQUE(task_id, completed_date)
);
CREATE TABLE IF NOT EXISTS na_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS na_resources (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  description TEXT,
  category    TEXT DEFAULT 'general',
  created_at  BIGINT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quit_habits (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  quit_date TEXT,
  color     TEXT DEFAULT '#ef4444',
  notes     TEXT,
  created_at BIGINT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS na_sponsees (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  phone    TEXT,
  step     SMALLINT DEFAULT 0,
  notes    TEXT,
  added_at BIGINT DEFAULT 0
);
CREATE TABLE IF NOT EXISTS step_notes (
  id         TEXT PRIMARY KEY,
  step_num   SMALLINT NOT NULL,
  content    TEXT NOT NULL,
  created_at BIGINT DEFAULT 0
);
`;

// Local-timezone date string — avoids UTC rollover for self-hosted apps
// (new Date().toISOString() advances to "tomorrow" at 7 PM ET; this stays on local day)
function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Next calendar date that falls on a given day-of-week (0=Sun … 6=Sat); returns today if it matches
function nextMeetingDate(dayOfWeek) {
  const now = new Date();
  const diff = (dayOfWeek - now.getDay() + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
}

// ── Calendar auto-sync helper ─────────────────────────────────────────────────
const JOURNAL_CAL_COLOR = '#6366f1';

async function syncEntryToCalendar(date, content, mood) {
  const moodEmoji = ['','😔','😕','😐','🙂','😄'][mood] || '';
  const title = `📓 Journal${moodEmoji ? ' ' + moodEmoji : ''}`;
  const snippet = content ? content.substring(0, 200) : null;
  const start = `${date}T00:00:00`;
  const end   = `${date}T23:59:59`;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM calendar_events WHERE all_day=true AND start_time::date=$1::date AND title LIKE '📓%'`,
      [date]
    );
    if (rows.length) {
      await pool.query(
        `UPDATE calendar_events SET title=$1, description=$2 WHERE id=$3`,
        [title, snippet, rows[0].id]
      );
      return 'updated';
    } else {
      await pool.query(
        `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color)
         VALUES ($1,$2,$3,$4,true,$5)`,
        [title, snippet, start, end, JOURNAL_CAL_COLOR]
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
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2 GB

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS));
app.use(express.static(__dirname)); // serves index.html, app.js, style.css

// ── Auth helpers ──────────────────────────────────────────────────────────────
let userCountCache = null; // null = unknown, true/false = cached

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
  // If no users exist yet, allow full access without token (setup mode)
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

// ── Row mappers ───────────────────────────────────────────────────────────────
function rowToEntry(r) {
  // Normalize date: pg may return DATE column as a JS Date object (local-midnight)
  const dateVal = r.date instanceof Date
    ? [r.date.getFullYear(),
       String(r.date.getMonth() + 1).padStart(2, '0'),
       String(r.date.getDate()).padStart(2, '0')].join('-')
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
    userCountCache = true; // invalidate cache
    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
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
    const user = { id: row.id, name: row.name, email: row.email, role: row.role };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '30d' });
    res.json({ user, token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

// ── Journal Entries ───────────────────────────────────────────────────────────
app.get('/api/entries', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM entries ORDER BY created_at DESC');
    res.json(rows.map(rowToEntry));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/entries', requireAuth, async (req, res) => {
  const { id, date, content, mood, tags, habits, wordCount, createdAt, image } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO entries (id, date, content, mood, tags, habits, word_count, created_at, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE
         SET content=$3, mood=$4, tags=$5, habits=$6, word_count=$7, image=$9
       RETURNING *`,
      [id, date, content ?? '', mood ?? null, tags ?? [], JSON.stringify(habits ?? {}),
       wordCount ?? 0, createdAt, image ?? null]
    );
    // Auto-create/update calendar event for this journal entry
    syncEntryToCalendar(date, content, mood).catch(() => {});
    res.status(201).json(rowToEntry(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM entries WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries', requireAuth, async (_req, res) => {
  try { await pool.query('DELETE FROM entries'); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Habits ────────────────────────────────────────────────────────────────────
app.get('/api/habits', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM habits ORDER BY display_order');
    res.json(rows.map(rowToHabit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/habits', requireAuth, async (req, res) => {
  const { id, name, emoji, color } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO habits (id, name, emoji, color, display_order)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(display_order)+1,0) FROM habits))
       RETURNING *`,
      [id, name, emoji ?? '⭐', color ?? '#6366f1']
    );
    res.status(201).json(rowToHabit(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/habits/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM habits WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/habits', requireAuth, async (_req, res) => {
  try { await pool.query('DELETE FROM habits'); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calendar Events ───────────────────────────────────────────────────────────
app.get('/api/calendar-events', requireAuth, async (req, res) => {
  try {
    const { start, end } = req.query;
    let q = 'SELECT * FROM calendar_events';
    const params = [];
    if (start && end) {
      q += ' WHERE start_time >= $1 AND start_time <= $2';
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
         (title, description, start_time, end_time, all_day, color, is_shared, recurrence_rule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [title, description || null, startTime, endTime,
       allDay || false, color || '#3b82f6', isShared || false, recurrenceRule || null]
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
       WHERE id=$9 RETURNING *`,
      [title, description || null, startTime, endTime,
       allDay || false, color || '#3b82f6', isShared || false, recurrenceRule || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json(rowToEvent(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/calendar-events/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM calendar_events WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Folders ───────────────────────────────────────────────────────────────────
app.get('/api/folders', requireAuth, async (req, res) => {
  try {
    const { parentId } = req.query;
    const { rows } = parentId
      ? await pool.query('SELECT * FROM folders WHERE parent_id=$1 ORDER BY name', [parentId])
      : await pool.query('SELECT * FROM folders WHERE parent_id IS NULL ORDER BY name');
    res.json(rows.map(rowToFolder));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/folders', requireAuth, async (req, res) => {
  const { name, parentId, isShared } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO folders (name, parent_id, is_shared) VALUES ($1,$2,$3) RETURNING *',
      [name, parentId || null, isShared || false]
    );
    res.status(201).json(rowToFolder(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/folders/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM folders WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Files ─────────────────────────────────────────────────────────────────────
app.get('/api/files', requireAuth, async (req, res) => {
  try {
    const { folderId } = req.query;
    const { rows } = folderId
      ? await pool.query('SELECT * FROM files WHERE folder_id=$1 ORDER BY name', [folderId])
      : await pool.query('SELECT * FROM files WHERE folder_id IS NULL ORDER BY name');
    res.json(rows.map(rowToFile));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/files', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { folderId, isShared } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO files (name, original_name, stored_name, size, mime_type, folder_id, is_shared)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.file.originalname, req.file.originalname, req.file.filename,
       req.file.size, req.file.mimetype, folderId || null, isShared === 'true']
    );
    res.status(201).json(rowToFile(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files/:id/download', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const file = rows[0];
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
    res.sendFile(path.join(UPLOADS, file.stored_name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/files/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM files WHERE id=$1 RETURNING stored_name', [req.params.id]);
    if (rows.length) {
      const fp = path.join(UPLOADS, rows[0].stored_name);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Journal → Calendar backfill ───────────────────────────────────────────────
app.post('/api/entries/sync-calendar', requireAuth, async (_req, res) => {
  try {
    const { rows: allEntries } = await pool.query(
      'SELECT id, date, content, mood FROM entries ORDER BY date'
    );
    let created = 0, updated = 0, errors = 0;
    for (const e of allEntries) {
      const result = await syncEntryToCalendar(e.date, e.content, e.mood);
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
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!upstream.ok) {
      const message = payload?.error?.message || payload?.message || `Claude upstream error (HTTP ${upstream.status})`;
      return res.status(upstream.status).json({
        error: {
          message,
          status: upstream.status,
          type: payload?.error?.type || 'upstream_error',
        },
      });
    }

    if (!payload || typeof payload !== 'object') {
      return res.status(502).json({ error: { message: 'Invalid response from Claude upstream.' } });
    }

    res.status(upstream.status).json(payload);
  } catch (err) {
    res.status(502).json({ error: { message: `Unable to reach Claude upstream: ${err.message}` } });
  }
});

// ── NA Settings (sobriety date, etc.) ────────────────────────────────────────
app.get('/api/na/settings', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM na_settings');
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/settings', requireAuth, async (req, res) => {
  const updates = req.body; // { key: value, ... }
  try {
    for (const [k, v] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO na_settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value=$2`,
        [k, v === null ? null : String(v)]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Meetings ───────────────────────────────────────────────────────────────
app.get('/api/na/meetings', requireAuth, async (_req, res) => {
  try {
    const today = localDateStr();
    const { rows: mtgs } = await pool.query(
      'SELECT * FROM na_meetings ORDER BY day_of_week, meeting_time'
    );
    const { rows: att } = await pool.query(
      'SELECT meeting_id FROM na_meeting_attendance WHERE attended_date=$1', [today]
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
      `INSERT INTO na_meetings (id,name,day_of_week,meeting_time,location,commitment_type,notes,recurring,color,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, name, dayOfWeek, meetingTime||null, location||null,
       commitmentType||'member', notes||null, recurring!==false,
       color||'#6366f1', Date.now()]
    );
    const m = rows[0];
    // Create a calendar event for the next occurrence so it appears in Upcoming Events
    try {
      const nextDate = nextMeetingDate(dayOfWeek);
      const title = `🤝 ${name}`;
      const st = meetingTime ? `${nextDate}T${meetingTime}:00` : `${nextDate}T00:00:00`;
      const [hh, mm] = (meetingTime || '00:00').split(':').map(Number);
      const endH = String((hh + 1) % 24).padStart(2, '0');
      const et = meetingTime ? `${nextDate}T${endH}:${String(mm).padStart(2,'0')}:00` : `${nextDate}T23:59:59`;
      await pool.query(
        `INSERT INTO calendar_events (title,description,start_time,end_time,all_day,color)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [title, location || null, st, et, !meetingTime, color || '#6366f1']
      );
    } catch {} // calendar failure must not block meeting creation
    res.status(201).json({ id:m.id, name:m.name, dayOfWeek:m.day_of_week, meetingTime:m.meeting_time,
      location:m.location, commitmentType:m.commitment_type, notes:m.notes,
      recurring:m.recurring, color:m.color, createdAt:Number(m.created_at), attendedToday:false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/meetings/:id', requireAuth, async (req, res) => {
  const { name, dayOfWeek, meetingTime, location, commitmentType, notes, recurring, color } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE na_meetings SET name=$1,day_of_week=$2,meeting_time=$3,location=$4,
       commitment_type=$5,notes=$6,recurring=$7,color=$8 WHERE id=$9 RETURNING *`,
      [name, dayOfWeek, meetingTime||null, location||null,
       commitmentType||'member', notes||null, recurring!==false,
       color||'#6366f1', req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const m = rows[0];
    const { rows: att } = await pool.query(
      'SELECT meeting_id FROM na_meeting_attendance WHERE attended_date=$1 AND meeting_id=$2',
      [localDateStr(), m.id]
    );
    res.json({ id:m.id, name:m.name, dayOfWeek:m.day_of_week, meetingTime:m.meeting_time,
      location:m.location, commitmentType:m.commitment_type, notes:m.notes,
      recurring:m.recurring, color:m.color, createdAt:Number(m.created_at),
      attendedToday: att.length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/meetings/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM na_meetings WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/meetings/:id/attend', requireAuth, async (req, res) => {
  const today = localDateStr();
  const { attended } = req.body;
  try {
    if (attended) {
      await pool.query(
        `INSERT INTO na_meeting_attendance (id, meeting_id, attended_date)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [uuidv4(), req.params.id, today]
      );
      // Sync to calendar so the attended meeting appears in Upcoming Events
      try {
        const { rows: [m] } = await pool.query('SELECT * FROM na_meetings WHERE id=$1', [req.params.id]);
        if (m) {
          const title = `🤝 ${m.name}`;
          const st = m.meeting_time ? `${today}T${m.meeting_time}:00` : `${today}T00:00:00`;
          const [hh, mm] = (m.meeting_time || '00:00').split(':').map(Number);
          const endH = String((hh + 1) % 24).padStart(2, '0');
          const et = m.meeting_time ? `${today}T${endH}:${String(mm).padStart(2,'0')}:00` : `${today}T23:59:59`;
          const { rows: ex } = await pool.query(
            `SELECT id FROM calendar_events WHERE title=$1 AND start_time::date=$2::date`, [title, today]
          );
          if (!ex.length) {
            await pool.query(
              `INSERT INTO calendar_events (title,description,start_time,end_time,all_day,color)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [title, m.location || null, st, et, !m.meeting_time, m.color || '#6366f1']
            );
          }
        }
      } catch {} // calendar failure must not block attendance save
    } else {
      await pool.query(
        'DELETE FROM na_meeting_attendance WHERE meeting_id=$1 AND attended_date=$2',
        [req.params.id, today]
      );
    }
    res.json({ ok: true, attended });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/na/meetings/attendance', requireAuth, async (_req, res) => {
  try {
    const [{ rows: dateRows }, { rows: [cnt] }] = await Promise.all([
      pool.query(`SELECT DISTINCT attended_date FROM na_meeting_attendance ORDER BY attended_date DESC LIMIT 365`),
      pool.query(`SELECT COUNT(*) AS total FROM na_meeting_attendance`),
    ]);
    const dates = dateRows.map(r => {
      // pg returns DATE columns as JS Date objects at UTC midnight — use UTC accessors to avoid day-shift
      return r.attended_date instanceof Date
        ? [r.attended_date.getUTCFullYear(),
           String(r.attended_date.getUTCMonth()+1).padStart(2,'0'),
           String(r.attended_date.getUTCDate()).padStart(2,'0')].join('-')
        : String(r.attended_date).slice(0,10);
    });
    res.json({ dates, total: parseInt(cnt.total) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Sponsor ────────────────────────────────────────────────────────────────
app.get('/api/na/sponsor', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM na_sponsor WHERE id=$1', ['main']);
    if (!rows.length) return res.json(null);
    const r = rows[0];
    res.json({ id:r.id, name:r.name, phone:r.phone, email:r.email,
      yearsClean:r.years_clean, notes:r.notes, currentStep:r.current_step });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/sponsor', requireAuth, async (req, res) => {
  const { name, phone, email, yearsClean, notes, currentStep } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO na_sponsor (id,name,phone,email,years_clean,notes,current_step)
       VALUES ('main',$1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE
         SET name=$1,phone=$2,email=$3,years_clean=$4,notes=$5,current_step=$6
       RETURNING *`,
      [name||null, phone||null, email||null, yearsClean||null, notes||null, currentStep||1]
    );
    const r = rows[0];
    res.json({ id:r.id, name:r.name, phone:r.phone, email:r.email,
      yearsClean:r.years_clean, notes:r.notes, currentStep:r.current_step });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA 12 Steps ───────────────────────────────────────────────────────────────
app.get('/api/na/steps', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM na_steps ORDER BY step_number');
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
  try {
    const { rows } = await pool.query(
      `INSERT INTO na_steps (step_number, notes, completed_at) VALUES ($1,$2,$3)
       ON CONFLICT (step_number) DO UPDATE SET notes=$2, completed_at=$3 RETURNING *`,
      [n, notes||'', completedAt]
    );
    const r = rows[0];
    res.json({ stepNumber:r.step_number, notes:r.notes,
      completedAt: r.completed_at ? Number(r.completed_at) : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Daily Tasks ────────────────────────────────────────────────────────────
app.get('/api/na/daily-tasks', requireAuth, async (_req, res) => {
  try {
    const today = localDateStr();
    const { rows: tasks } = await pool.query(
      'SELECT * FROM na_daily_tasks ORDER BY sort_order, created_at'
    );
    const { rows: done } = await pool.query(
      'SELECT task_id FROM na_daily_task_completions WHERE completed_date=$1', [today]
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
      `INSERT INTO na_daily_tasks (id, task_text, is_preset, sort_order, created_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, taskText, isPreset||false, sortOrder||0, Date.now()]
    );
    const t = rows[0];
    res.status(201).json({ id:t.id, taskText:t.task_text, isPreset:t.is_preset,
      sortOrder:t.sort_order, completedToday:false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/daily-tasks/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM na_daily_tasks WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/daily-tasks/:id/complete', requireAuth, async (req, res) => {
  const today = localDateStr();
  const { completed } = req.body;
  try {
    if (completed) {
      await pool.query(
        `INSERT INTO na_daily_task_completions (id, task_id, completed_date)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [uuidv4(), req.params.id, today]
      );
    } else {
      await pool.query(
        'DELETE FROM na_daily_task_completions WHERE task_id=$1 AND completed_date=$2',
        [req.params.id, today]
      );
    }
    res.json({ ok: true, completed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── NA Resources ─────────────────────────────────────────────────────────────
app.get('/api/na/resources', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM na_resources ORDER BY created_at');
    res.json(rows.map(r => ({ id:r.id, title:r.title, url:r.url, description:r.description, category:r.category })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/resources', requireAuth, async (req, res) => {
  const { id, title, url, description, category } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO na_resources (id, title, url, description, category, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, title, url, description||null, category||'general', Date.now()]
    );
    const r = rows[0];
    res.status(201).json({ id:r.id, title:r.title, url:r.url, description:r.description, category:r.category });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/resources/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM na_resources WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Per-meeting attendance stats ──────────────────────────────────────────────
app.get('/api/na/meetings/:id/stats', requireAuth, async (req, res) => {
  const mid = req.params.id;
  try {
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fmt = d => d.toISOString().split('T')[0];
    const [total, week, month] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM na_meeting_attendance WHERE meeting_id=$1', [mid]),
      pool.query('SELECT COUNT(*) FROM na_meeting_attendance WHERE meeting_id=$1 AND attended_date>=$2', [mid, fmt(weekStart)]),
      pool.query('SELECT COUNT(*) FROM na_meeting_attendance WHERE meeting_id=$1 AND attended_date>=$2', [mid, fmt(monthStart)]),
    ]);
    res.json({
      total:   parseInt(total.rows[0].count),
      thisWeek: parseInt(week.rows[0].count),
      thisMonth: parseInt(month.rows[0].count),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Quit Habits ───────────────────────────────────────────────────────────────
app.get('/api/quit-habits', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM quit_habits ORDER BY created_at');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/quit-habits', requireAuth, async (req, res) => {
  const { id, name, quit_date, color, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO quit_habits (id,name,quit_date,color,notes,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [id, name, quit_date || null, color || '#ef4444', notes || null, Date.now()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/quit-habits/:id', requireAuth, async (req, res) => {
  const { name, quit_date, color, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE quit_habits SET name=$1,quit_date=$2,color=$3,notes=$4 WHERE id=$5 RETURNING *',
      [name, quit_date || null, color || '#ef4444', notes || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/quit-habits/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM quit_habits WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sponsees ──────────────────────────────────────────────────────────────────
app.get('/api/na/sponsees', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM na_sponsees ORDER BY added_at');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/sponsees', requireAuth, async (req, res) => {
  const { id, name, phone, step, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO na_sponsees (id,name,phone,step,notes,added_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [id, name, phone || null, step || 0, notes || null, Date.now()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/na/sponsees/:id', requireAuth, async (req, res) => {
  const { name, phone, step, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE na_sponsees SET name=$1,phone=$2,step=$3,notes=$4 WHERE id=$5 RETURNING *',
      [name, phone || null, step || 0, notes || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/sponsees/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM na_sponsees WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Step Notes ────────────────────────────────────────────────────────────────
app.get('/api/na/steps/:num/notes', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM step_notes WHERE step_num=$1 ORDER BY created_at',
      [parseInt(req.params.num)]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/na/steps/:num/notes', requireAuth, async (req, res) => {
  const { id, content } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO step_notes (id,step_num,content,created_at) VALUES ($1,$2,$3,$4) RETURNING *',
      [id, parseInt(req.params.num), content, Date.now()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/na/steps/:num/notes/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM step_notes WHERE id=$1 AND step_num=$2', [req.params.id, parseInt(req.params.num)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Profile Picture ───────────────────────────────────────────────────────────
app.post('/api/profile/picture', requireAuth, async (req, res) => {
  const { image } = req.body;
  if (!image || !image.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image' });
  try {
    const base64 = image.replace(/^data:image\/[^;]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 5 MB)' });
    if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS, 'avatar.jpg'), buf);
    res.json({ url: '/uploads/avatar.jpg?t=' + Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/profile/picture', requireAuth, (_req, res) => {
  const f = path.join(UPLOADS, 'avatar.jpg');
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

app.get('/api/profile', requireAuth, (_req, res) => {
  const f = path.join(UPLOADS, 'avatar.jpg');
  res.json({ avatarUrl: fs.existsSync(f) ? '/uploads/avatar.jpg' : null });
});

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('[DB] Connected');
    await pool.query(JOURNAL_SCHEMA);
    console.log('[DB] Schema ready (entries + habits tables ensured)');
  } catch (err) {
    console.error(`[DB] Startup error: ${err.message}`);
  }

  console.log(`[Config] PORT=${PORT}`);
  console.log(`[Config] Claude key source=${process.env.ANTHROPIC_API_KEY ? 'env:ANTHROPIC_API_KEY' : 'request:x-api-key'}`);

  // Seed default NA daily tasks on first run
  try {
    const { rows: taskCheck } = await pool.query('SELECT COUNT(*) FROM na_daily_tasks');
    if (parseInt(taskCheck[0].count) === 0) {
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
          `INSERT INTO na_daily_tasks (id, task_text, is_preset, sort_order, created_at)
           VALUES ($1,$2,true,$3,$4) ON CONFLICT DO NOTHING`,
          [uuidv4(), text, i, Date.now() + i]
        );
      }
      console.log('[NA] Seeded default daily tasks');
    }
  } catch (err) {
    console.error('[NA] Task seed error:', err.message);
  }

  app.listen(PORT, () => {
    console.log(`AI Recovery Tracker running at http://localhost:${PORT}`);
  });
}

startServer();
