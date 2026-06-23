require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const { Pool } = require('pg');

const app  = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── DB helpers ────────────────────────────────────────────────────────────────
function rowToEntry(r) {
  return {
    id: r.id, date: r.date, content: r.content ?? '',
    mood: r.mood, tags: r.tags ?? [], habits: r.habits ?? {},
    wordCount: r.word_count, createdAt: Number(r.created_at),
    ...(r.image ? { image: r.image } : {}),
  };
}

function rowToHabit(r) {
  return { id: r.id, name: r.name, emoji: r.emoji, color: r.color };
}

// ── Entries ───────────────────────────────────────────────────────────────────
app.get('/api/entries', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM entries ORDER BY created_at DESC');
    res.json(rows.map(rowToEntry));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/entries', async (req, res) => {
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
    res.status(201).json(rowToEntry(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM entries WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/entries', async (_req, res) => {
  try {
    await pool.query('DELETE FROM entries');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Habits ────────────────────────────────────────────────────────────────────
app.get('/api/habits', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM habits ORDER BY display_order');
    res.json(rows.map(rowToHabit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/habits', async (req, res) => {
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

app.delete('/api/habits/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM habits WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/habits', async (_req, res) => {
  try {
    await pool.query('DELETE FROM habits');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Claude proxy ──────────────────────────────────────────────────────────────
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: { message: 'No API key — set ANTHROPIC_API_KEY in .env or enter it in app Settings.' } });
  }
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
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: err.message } });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
