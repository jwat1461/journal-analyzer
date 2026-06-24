// Restores NAS uploaded files from disk into the nas_db files table.
// Run: node db/restore_files.js
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const pool    = new Pool({ connectionString: process.env.DATABASE_URL });

const MIME = {
  '.7z':   'application/x-7z-compressed',
  '.md':   'text/markdown',
  '.py':   'text/x-python',
  '.mp4':  'video/mp4',
  '.MP4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.MOV':  'video/quicktime',
  '.exe':  'application/x-msdownload',
  '.msi':  'application/x-msi',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.heic': 'image/heic',
  '.txt':  'text/plain',
  '.zip':  'application/zip',
  '.json': 'application/json',
  '.csv':  'text/csv',
};

async function run() {
  if (!fs.existsSync(UPLOADS)) {
    console.log('Uploads directory not found:', UPLOADS);
    process.exit(1);
  }

  const files = fs.readdirSync(UPLOADS).filter(f => !f.startsWith('.'));
  console.log(`Found ${files.length} files in ${UPLOADS}`);

  // Get already-known stored names so we don't double-insert
  const { rows: existing } = await pool.query('SELECT stored_name FROM files');
  const known = new Set(existing.map(r => r.stored_name));

  let inserted = 0, skipped = 0;
  for (const filename of files) {
    if (known.has(filename)) { skipped++; continue; }

    const fullPath = path.join(UPLOADS, filename);
    const stat     = fs.statSync(fullPath);
    if (!stat.isFile()) continue;

    const ext      = path.extname(filename);
    const mime     = MIME[ext] || 'application/octet-stream';
    // Use the extension as a hint in the display name
    const name     = filename; // original name unknown — use stored name as fallback

    await pool.query(
      `INSERT INTO files (name, original_name, stored_name, size, mime_type, folder_id, is_shared, created_at)
       VALUES ($1,$2,$3,$4,$5,NULL,false,$6)`,
      [name, name, filename, stat.size, mime, new Date(stat.mtime).toISOString()]
    );
    console.log(`  + ${filename}  (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    inserted++;
  }

  console.log(`\nDone — inserted ${inserted}, skipped ${skipped} already-present.`);
  await pool.end();
}

run().catch(err => { console.error(err.message); process.exit(1); });
