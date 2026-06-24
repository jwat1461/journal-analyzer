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
`;

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

  app.listen(PORT, () => {
    console.log(`AI Journal Analyzer + NAS running at http://localhost:${PORT}`);
  });
}

startServer();
