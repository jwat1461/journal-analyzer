'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let entries = [];
let habits  = [];
let currentTags = [];
let selectedMood = null;
let charts = {};
let apiKey = '';
let serverClaudeReady = false; // true when ANTHROPIC_API_KEY is set in server .env

// Auth state
let authToken = localStorage.getItem('ja_token') || '';
let authUser  = null;

// Calendar state
let calEvents  = [];
let calYear    = new Date().getFullYear();
let calMonth   = new Date().getMonth();
let editingEventId  = null;
let selectedEventColor = '#3b82f6';
let selectedCalDate = null;

// Sobriety counter
let sobrietyDate   = null;
let sobrietyTicker = null;

// NA Recovery data
let naMeetings        = [];
let naAttendanceDates = [];  // distinct attended dates (YYYY-MM-DD)
let naTotalMeetings   = 0;   // total attendance records (multiple meetings per day count separately)
let naSponsor         = null;
let naSteps           = [];
let naDailyTasks      = [];
let editingMeetingId  = null;
let selectedMtgColor  = '#6366f1';
let openStepNumber    = null;

// Phase 3 state
let naProgram     = 'NA';
let avatarUrl     = null;
let quitHabits    = [];
let naSponsees    = [];
let editingQhId   = null;
let editingSponseeId = null;
let selectedQhColor  = '#ef4444';
let currentStepNotes = [];

const NA_STEP_TITLES = [
  'Powerless & Unmanageable',
  'Power Greater Than Ourselves',
  'Decision to Turn Our Will Over',
  'Fearless Moral Inventory',
  'Admitting the Exact Nature of Our Wrongs',
  'Ready to Have Defects Removed',
  'Humbly Asked to Remove Our Shortcomings',
  'List of All Persons We Had Harmed',
  'Making Direct Amends',
  'Continuing Personal Inventory',
  'Prayer, Meditation & Conscious Contact',
  'Carrying the Message to Addicts',
];
const NA_STEP_DESC = [
  'We admitted that we were powerless over our addiction — that our lives had become unmanageable.',
  'We came to believe that a Power greater than ourselves could restore us to sanity.',
  'We made a decision to turn our will and our lives over to the care of God as we understood Him.',
  'We made a searching and fearless moral inventory of ourselves.',
  'We admitted to God, to ourselves, and to another human being the exact nature of our wrongs.',
  'We were entirely ready to have God remove all these defects of character.',
  'We humbly asked Him to remove our shortcomings.',
  'We made a list of all persons we had harmed, and became willing to make amends to them all.',
  'We made direct amends to such people wherever possible, except when to do so would injure them or others.',
  'We continued to take personal inventory and when we were wrong, promptly admitted it.',
  'We sought through prayer and meditation to improve our conscious contact with God as we understood Him.',
  'Having had a spiritual awakening as a result of these steps, we tried to carry this message to addicts, and to practice these principles in all our affairs.',
];
const MTG_COMMIT_LABELS = { member:'Member', chair:'🎙️ Chair', read:'📖 Read', greet:'🤝 Greet', share:'💬 Share', speaker:'🎤 Speaker' };
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const NA_QUOTES = [
  'One day at a time.',
  'It works if you work it.',
  'Progress, not perfection.',
  'You are not alone.',
  'Keep coming back.',
  'Easy does it, but do it.',
  'You didn\'t come this far to only come this far.',
  'Stay strong — one more day clean.',
  'Every day sober is a victory.',
  'Recovery is a journey, not a destination.',
  'Courage to change the things I can.',
  'Your worst day in recovery beats your best day in addiction.',
  'The miracle is in the moment — right now.',
  'Keep your side of the street clean.',
  'It gets easier, one day at a time.',
];

// Files state
let currentFolderId = null;
let folderStack     = [];

const API_BASE = (() => {
  const override = localStorage.getItem('ja_api_base')?.trim();
  if (override) return override.replace(/\/+$/, '');
  // When served by Express on port 3001, use relative paths (same origin).
  // When opened as file:// or via any other server (e.g. VS Code Live Server),
  // point directly at the Express backend.
  if (window.location.protocol === 'file:' || window.location.port !== '3001')
    return 'http://localhost:3001';
  return '';
})();

const MOOD_LABEL = ['','Terrible 😔','Bad 😕','Okay 😐','Good 🙂','Great 😄'];
const MOOD_EMOJI  = ['','😔','😕','😐','🙂','😄'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','was','are','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','it','its','this',
  'that','these','those','i','me','my','we','our','you','your','he','she','him',
  'her','they','them','their','his','what','which','who','all','am','as','if',
  'so','not','no','up','out','then','than','when','where','how','just','also',
  'more','very','too','can','get','got','like','some','about','there','here',
  'now','today','day','time','think','know','feel','felt','want','need','really',
  'into','over','back','after','before','much','still','even','made','make',
  'went','going','good','great','little','every','never','always','again',
  'though','through','because','between','since','while','during','each','few',
  'most','other','same','such','own','off','down','only','under','last','long',
  'find','see','well','saw','something','someone','thing','things','way','ways',
  'any','one','two','three','four','five','six','seven','eight','nine','ten',
  'said','says','told','tell','came','come','come','had','has','have','let',
  'put','take','took','look','looked','looks','went','been','got','getting'
]);

// ── API helper ────────────────────────────────────────────────────────────────
async function safeJson(res) {
  const text = await res.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    showAuthScreen();
    throw new Error('Please log in');
  }
  if (!res.ok) {
    const err = await safeJson(res);
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return safeJson(res);
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupForm();
  setupFileUpload();
  setupSearch();
  setupTheme();
  setupAuth();

  document.getElementById('currentDate').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const authed = await initAuth();
  if (authed) {
    await loadData();
    renderAll();
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function setupAuth() {
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
}

async function initAuth() {
  try {
    const status = await fetch(`${API_BASE}/api/auth/status`).then(safeJson);
    serverClaudeReady = !!status.claudeReady;
    if (!status.needsAuth) {
      hideAuthScreen();
      return true;
    }
    if (authToken) {
      try {
        authUser = await api('GET', '/api/auth/me');
        hideAuthScreen();
        return true;
      } catch {
        authToken = '';
        localStorage.removeItem('ja_token');
      }
    }
    showAuthScreen();
    return false;
  } catch {
    showToast('Cannot reach server — run: node server.js', 'error');
    return false;
  }
}

function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
}

function hideAuthScreen() {
  document.getElementById('authScreen').style.display = 'none';
  const el = document.getElementById('userDisplay');
  if (el && authUser) el.textContent = authUser.name;
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  clearAuthError();
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Login failed');
    authToken = data.token;
    authUser  = data.user;
    localStorage.setItem('ja_token', authToken);
    hideAuthScreen();
    await loadData();
    renderAll();
  } catch (err) { showAuthError(err.message); }
}

async function handleRegister(e) {
  e.preventDefault();
  const name     = document.getElementById('registerName').value.trim();
  const email    = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  clearAuthError();
  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    authToken = data.token;
    authUser  = data.user;
    localStorage.setItem('ja_token', authToken);
    hideAuthScreen();
    await loadData();
    renderAll();
  } catch (err) { showAuthError(err.message); }
}

function logout() {
  authToken = '';
  authUser  = null;
  localStorage.removeItem('ja_token');
  entries = []; habits = []; calEvents = [];
  showAuthScreen();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg; el.style.display = ''; }
}
function clearAuthError() {
  const el = document.getElementById('authError');
  if (el) el.style.display = 'none';
}
function showLogin() {
  document.getElementById('loginForm').style.display = '';
  document.getElementById('registerForm').style.display = 'none';
  clearAuthError();
}
function showRegister() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = '';
  clearAuthError();
}

// ── Data Persistence ─────────────────────────────────────────────────────────
async function loadData() {
  try {
    [entries, habits, calEvents] = await Promise.all([
      api('GET', '/api/entries'),
      api('GET', '/api/habits'),
      api('GET', '/api/calendar-events'),
    ]);
  } catch {
    showToast('Cannot reach server — run: node server.js', 'error');
    entries = []; habits = []; calEvents = [];
  }

  if (!habits.length) {
    const defaults = [
      { id: 'h1', name: 'Exercise',   emoji: '🏃', color: '#22c55e' },
      { id: 'h2', name: 'Meditation', emoji: '🧘', color: '#6366f1' },
      { id: 'h3', name: 'Reading',    emoji: '📚', color: '#f59e0b' },
      { id: 'h4', name: 'Water',      emoji: '💧', color: '#38bdf8' },
    ];
    habits = await Promise.all(defaults.map(h => api('POST', '/api/habits', h)));
  }

  await loadNAData();
  apiKey = localStorage.getItem('ja_apikey') || '';
  const claudeAvailable = apiKey || serverClaudeReady;
  if (apiKey) document.getElementById('apiKeyInput').value = apiKey;
  if (claudeAvailable) {
    document.getElementById('generateInsightsBtn').style.display = '';
    document.getElementById('goInsightsBtn').style.display = '';
    document.getElementById('aiPlaceholder').style.display = 'none';
  }
  if (serverClaudeReady && !apiKey) {
    const hint = document.getElementById('apiKeyHint');
    if (hint) hint.textContent = 'Claude API key is configured on the server — no key needed here.';
  }
}

// ── Full Render ───────────────────────────────────────────────────────────────
function renderAll() {
  renderStats();
  renderHeatmap();
  renderSobrietyCounter();
  renderRecoveryStatsRow();
  renderRecoveryToday();
  renderDashCalPreview();
  renderRecentEntries();
  renderAllEntries();
  renderWordCloud();
  renderPatterns();
  renderHabitsList();
  renderHabitsCheckboxes();
  if (document.getElementById('tab-insights').classList.contains('active')) {
    renderCharts();
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
  if (tab === 'insights') setTimeout(renderCharts, 30);
  if (tab === 'habits')   renderHabitsTab();
  if (tab === 'calendar') loadCalendarEvents();
  if (tab === 'meetings')  renderMeetingsTab();
  if (tab === 'sponsor')   renderSponsorTab();
  if (tab === 'files')     loadFiles();
  if (tab === 'resources') renderResourcesTab();
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function setupTheme() {
  const saved = localStorage.getItem('ja_theme') || 'dark';
  applyTheme(saved);

  document.getElementById('themeToggle').addEventListener('click', () => {
    const order = ['dark', 'light', 'na'];
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = order[(order.indexOf(current) + 1) % order.length];
    applyTheme(next);
    localStorage.setItem('ja_theme', next);
    setTimeout(renderCharts, 80);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icons = { dark: '☀️', light: '🌙', na: '💙' };
  const btn = document.getElementById('themeToggle');
  btn.textContent = icons[theme] || '☀️';
  btn.title = theme === 'na' ? 'NA Recovery Theme — click for dark' : 'Toggle theme';
}

// ── Dashboard Calendar Preview ────────────────────────────────────────────────
function renderDashCalPreview() {
  const el = document.getElementById('dashCalPreview');
  if (!el) return;

  const todayStr = dateStr(new Date());

  // Filter: upcoming (today+), exclude auto-journal entries, sort by start time
  const upcoming = calEvents
    .filter(ev => {
      if (!ev.startTime) return false;
      const local = new Date(ev.startTime);
      const evDate = `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
      return evDate >= todayStr && !ev.title.startsWith('📓');
    })
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .slice(0, 8);

  if (!upcoming.length) {
    el.innerHTML = '<p class="muted" style="font-size:13px;padding:4px 0">No upcoming events. <button class="btn btn-ghost" style="padding:2px 8px;font-size:13px" onclick="switchTab(\'calendar\')">Open Calendar</button></p>';
    return;
  }

  // Group by local date
  const groups = {};
  upcoming.forEach(ev => {
    const local = new Date(ev.startTime);
    const d = `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
    (groups[d] = groups[d] || []).push(ev);
  });

  const tomorrowStr = dateStr(new Date(Date.now() + 864e5));

  const dayLabel = (d) => {
    if (d === todayStr) return 'Today';
    if (d === tomorrowStr) return 'Tomorrow';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const timeFmt = (ev) => {
    if (ev.allDay) return '<span class="dash-ev-allday">All day</span>';
    const t = new Date(ev.startTime);
    return `<span class="dash-ev-time">${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>`;
  };

  el.innerHTML = Object.entries(groups).map(([d, evs]) => `
    <div class="dash-ev-group">
      <div class="dash-ev-date">${dayLabel(d)}</div>
      ${evs.map(ev => `
        <div class="dash-ev-row" onclick="switchTab('calendar')">
          <span class="dash-ev-dot" style="background:${ev.color || '#3b82f6'}"></span>
          ${timeFmt(ev)}
          <span class="dash-ev-title">${escHtml(ev.title)}</span>
        </div>`).join('')}
    </div>`).join('');
}

// ── NA Data Loading ───────────────────────────────────────────────────────────
async function loadNAData() {
  try {
    const [settings, mtgs, att, sponsor, steps, tasks, resources, qh, sponsees, profile] = await Promise.all([
      api('GET', '/api/na/settings'),
      api('GET', '/api/na/meetings'),
      api('GET', '/api/na/meetings/attendance'),
      api('GET', '/api/na/sponsor'),
      api('GET', '/api/na/steps'),
      api('GET', '/api/na/daily-tasks'),
      api('GET', '/api/na/resources'),
      api('GET', '/api/quit-habits'),
      api('GET', '/api/na/sponsees'),
      api('GET', '/api/profile'),
    ]);
    sobrietyDate      = settings.sobriety_date || null;
    nin90StartDate    = settings.nin90_start   || null;
    naProgram         = settings.program       || 'NA';
    naMeetings        = mtgs;
    naAttendanceDates = att.dates ?? att;   // server now returns { dates, total }
    naTotalMeetings   = att.total  ?? att.length;
    naSponsor         = sponsor;
    naSteps           = steps;
    naDailyTasks      = tasks;
    naResources       = resources;
    quitHabits        = qh;
    naSponsees        = sponsees;
    avatarUrl         = profile.avatarUrl || null;

    // One-time migration: move sobriety date from localStorage → PostgreSQL
    const legacyDate = localStorage.getItem('ja_sobriety_date');
    if (legacyDate && !sobrietyDate) {
      await api('PUT', '/api/na/settings', { sobriety_date: legacyDate });
      sobrietyDate = legacyDate;
      localStorage.removeItem('ja_sobriety_date');
    }

    applyProgram(naProgram);
    renderAvatarSidebar();
  } catch {
    sobrietyDate = null; nin90StartDate = null;
    naMeetings = []; naAttendanceDates = []; naTotalMeetings = 0; naSponsor = null;
    naSteps = []; naDailyTasks = []; naResources = [];
    quitHabits = []; naSponsees = [];
  }
}

// ── Recovery Stats Row (below journal stats, above sobriety counter) ─────────
function renderRecoveryStatsRow() {
  const row = document.getElementById('recoveryStatsRow');
  if (!row) return;

  const hasAny = sobrietyDate || naMeetings.length || naDailyTasks.length || naSteps.some(s => s.completedAt);
  row.style.display = hasAny ? '' : 'none';
  if (!hasAny) return;

  // Days clean
  const sob = sobrietyDate ? calcSobriety() : null;
  document.getElementById('rsbDaysClean').textContent = sob ? sob.totalDays.toLocaleString() : '—';

  // Meetings attended this week (Sun–Sat)
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,'0')}-${String(weekStart.getDate()).padStart(2,'0')}`;
  const mtgsThisWeek = naAttendanceDates.filter(d => d >= weekStartStr).length;
  document.getElementById('rsbMtgsWeek').textContent = mtgsThisWeek;

  // Step progress
  const done = naSteps.filter(s => s.completedAt).length;
  document.getElementById('rsbStepProgress').textContent = `${done}/12`;

  // Daily tasks %
  const total = naDailyTasks.length;
  const completed = naDailyTasks.filter(t => t.completedToday).length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  document.getElementById('rsbTaskPct').textContent = total ? `${pct}%` : '—';
}

// ── Recovery Today Dashboard Widget ──────────────────────────────────────────
function renderRecoveryToday() {
  const card = document.getElementById('recoveryTodayCard');
  if (!card) return;
  const hasData = naMeetings.length || naDailyTasks.length || naSponsor;
  card.style.display = hasData ? '' : 'none';
  if (!hasData) return;

  const todayDow = new Date().getDay();
  const todayMtgs = naMeetings.filter(m => m.dayOfWeek === todayDow);
  const nextMtg = [...naMeetings]
    .filter(m => m.dayOfWeek !== todayDow)
    .sort((a, b) => ((a.dayOfWeek - todayDow + 7) % 7) - ((b.dayOfWeek - todayDow + 7) % 7))[0];

  const doneTasks = naDailyTasks.filter(t => t.completedToday).length;
  const totalTasks = naDailyTasks.length;
  const taskPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const currentStep = naSponsor?.currentStep || 1;
  const completedSteps = naSteps.filter(s => s.completedAt).length;
  const stepPct = Math.round((completedSteps / 12) * 100);

  const COL_GREEN = 'var(--success)', COL_YELLOW = '#f59e0b', COL_RED = 'var(--danger)', COL_GRAY = 'var(--text-muted)';
  const statusDot = c => `<span class="na-status-dot" style="background:${c}"></span>`;

  const mtgStatus  = todayMtgs.length ? (todayMtgs.some(m => m.attendedToday) ? COL_GREEN : COL_YELLOW) : COL_GRAY;
  const spStatus   = naSponsor?.name ? COL_GREEN : COL_YELLOW;
  const stepStatus = completedSteps > 0 ? COL_GREEN : COL_YELLOW;
  const taskStatus = totalTasks === 0 ? COL_GRAY : taskPct === 100 ? COL_GREEN : taskPct > 0 ? COL_YELLOW : COL_RED;

  // Recovery score: Meetings 30pts + Daily Tasks 70pts
  let score = 0;
  if (todayMtgs.length === 0 || todayMtgs.some(m => m.attendedToday)) score += 30;
  score += Math.round(taskPct * 0.7);
  const scoreColor = score >= 80 ? COL_GREEN : score >= 50 ? COL_YELLOW : COL_RED;

  // Motivational quote — deterministic by day of year
  const now = new Date();
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const quote = NA_QUOTES[doy % NA_QUOTES.length];

  const quotEl = document.getElementById('naMotivationalQuote');
  if (quotEl) quotEl.innerHTML = `<span class="na-quote-icon">💬</span>${escHtml(quote)}`;

  const badge = document.getElementById('naScoreBadge');
  if (badge) badge.innerHTML = `<span class="recovery-score-pill" style="background:${scoreColor}20;color:${scoreColor};border-color:${scoreColor}40">${score}/100</span>`;

  const grid = document.getElementById('naPreviewGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="na-preview-card">
      <div class="na-pc-header">
        ${statusDot(mtgStatus)}<span class="na-pc-icon">🤝</span>
        <span class="na-pc-title">Meetings</span>
        <button class="na-pc-link" onclick="switchTab('meetings')">View All →</button>
      </div>
      ${todayMtgs.length ? todayMtgs.map(m => `
        <div class="na-pc-row">
          <span class="rt-meeting-dot" style="background:${m.color}"></span>
          <span class="na-pc-time">${fmtMtgTime(m.meetingTime)}</span>
          <span class="na-pc-name">${escHtml(m.name)}</span>
          <button class="na-pc-attend ${m.attendedToday ? 'checked' : ''}"
            onclick="rtToggleAttend('${m.id}',${!m.attendedToday})">${m.attendedToday ? '✓' : '○'}</button>
        </div>`).join('')
        : `<p class="na-pc-empty">No meetings today.</p>`}
      ${nextMtg ? `<div class="na-pc-next">Next: <strong>${escHtml(nextMtg.name)}</strong> — ${DAY_NAMES[nextMtg.dayOfWeek]}</div>` : ''}
    </div>

    <div class="na-preview-card">
      <div class="na-pc-header">
        ${statusDot(spStatus)}<span class="na-pc-icon">👤</span>
        <span class="na-pc-title">Sponsor</span>
        <button class="na-pc-link" onclick="switchTab('sponsor')">Open Page →</button>
      </div>
      ${naSponsor?.name ? `
        <div class="na-pc-sponsor-name">${escHtml(naSponsor.name)}</div>
        ${naSponsor.yearsClean ? `<div class="na-pc-sponsor-meta">${escHtml(naSponsor.yearsClean)} yrs clean</div>` : ''}
        <div class="na-pc-sponsor-meta">Working Step ${currentStep}</div>
        <div class="na-pc-contact-row">
          ${naSponsor.phone ? `<a class="na-pc-contact" href="tel:${encodeURIComponent(naSponsor.phone)}">📞 Call</a>
          <a class="na-pc-contact" href="sms:${encodeURIComponent(naSponsor.phone)}">💬 Text</a>` : ''}
        </div>
      ` : `<p class="na-pc-empty">No sponsor added yet.</p>
        <button class="na-pc-add" onclick="switchTab('sponsor')">+ Add Sponsor</button>`}
    </div>

    <div class="na-preview-card">
      <div class="na-pc-header">
        ${statusDot(stepStatus)}<span class="na-pc-icon">📖</span>
        <span class="na-pc-title">12 Steps</span>
        <button class="na-pc-link" onclick="switchTab('sponsor')">View Work →</button>
      </div>
      <div class="na-pc-step-num">Step ${currentStep} <span class="na-pc-step-of">of 12</span></div>
      <div class="na-pc-bar-wrap"><div class="na-pc-bar-fill" style="width:${stepPct}%"></div></div>
      <div class="na-pc-bar-label">${completedSteps} of 12 complete</div>
    </div>

    <div class="na-preview-card">
      <div class="na-pc-header">
        ${statusDot(taskStatus)}<span class="na-pc-icon">✅</span>
        <span class="na-pc-title">Daily Tasks</span>
        <button class="na-pc-link" onclick="switchTab('sponsor')">All Tasks →</button>
      </div>
      <div class="na-pc-task-summary">${doneTasks}/${totalTasks} done today</div>
      <div class="na-pc-bar-wrap"><div class="na-pc-bar-fill" style="width:${taskPct}%;background:${taskStatus}"></div></div>
      ${naDailyTasks.slice(0, 3).map(t => `
        <div class="na-pc-row" style="margin-top:6px">
          <input type="checkbox" class="rt-task-cb" ${t.completedToday ? 'checked' : ''}
            onchange="rtToggleTask('${t.id}', this.checked)">
          <span class="na-pc-name ${t.completedToday ? 'na-pc-done' : ''}">${escHtml(t.taskText)}</span>
        </div>`).join('')}
      ${totalTasks > 3 ? `<button class="na-pc-add" style="margin-top:6px" onclick="switchTab('sponsor')">+${totalTasks - 3} more →</button>` : ''}
    </div>
  `;

  const scoreEl = document.getElementById('naScoreSection');
  if (scoreEl) scoreEl.innerHTML = `
    <div class="na-score-row">
      <span class="na-score-label">Today's Recovery Score</span>
      <span class="na-score-val" style="color:${scoreColor}">${score}/100</span>
    </div>
    <div class="na-score-track"><div class="na-score-fill" style="width:${score}%;background:${scoreColor}"></div></div>
    <div class="na-score-breakdown">
      <span class="na-score-item ${todayMtgs.length === 0 || todayMtgs.some(m => m.attendedToday) ? 'good' : 'pending'}">🤝 Meetings (30)</span>
      <span class="na-score-item ${taskPct === 100 ? 'good' : taskPct > 0 ? 'pending' : 'miss'}">✅ Tasks ${taskPct}% (70)</span>
    </div>
  `;
}

async function rtToggleAttend(id, attended) {
  try {
    const result = await api('POST', `/api/na/meetings/${id}/attend`, { attended });
    naMeetings = naMeetings.map(m => m.id === id ? { ...m, attendedToday: attended } : m);
    const todayStr = dateStr(new Date());
    if (attended) {
      if (!naAttendanceDates.includes(todayStr)) naAttendanceDates = [...naAttendanceDates, todayStr];
      naTotalMeetings++;
      if (result.calendarEvent) { calEvents = [...calEvents, result.calendarEvent]; renderDashCalPreview(); }
    } else {
      naTotalMeetings = Math.max(0, naTotalMeetings - 1);
    }
    renderRecoveryStatsRow();
    renderRecoveryToday();
    if (document.getElementById('tab-meetings').classList.contains('active')) renderMeetingsTab();
  } catch (err) { showToast('Failed to update: ' + err.message, 'error'); }
}

async function rtToggleTask(id, completed) {
  try {
    await api('POST', `/api/na/daily-tasks/${id}/complete`, { completed });
    naDailyTasks = naDailyTasks.map(t => t.id === id ? { ...t, completedToday: completed } : t);
    renderRecoveryStatsRow();
    renderRecoveryToday();
    if (document.getElementById('tab-sponsor').classList.contains('active')) renderSponsorTab();
  } catch (err) { showToast('Failed to update: ' + err.message, 'error'); }
}

// ── Meetings Tab ──────────────────────────────────────────────────────────────
function renderMeetingsTab() {
  renderMeetingsStats();
  renderNin90();
  renderMeetingsWeek();
}

function renderMeetingsStats() {
  const el = document.getElementById('meetingsStatsBar');
  if (!el) return;

  // Meeting streak (consecutive days with attendance)
  const dateSet = new Set(naAttendanceDates);
  const todayStr = dateStr(new Date());
  let streak = 0;
  let d = new Date();
  while (dateSet.has(dateStr(d))) { streak++; d = new Date(d - 864e5); }

  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
  const weekAttended = naAttendanceDates.filter(dt => dt >= dateStr(thisWeekStart)).length;

  el.innerHTML = `
    <div class="mtg-stat">
      <div>
        <div class="mtg-stat-val">🔥 ${streak}</div>
        <div class="mtg-stat-label">Day Streak</div>
      </div>
    </div>
    <div class="mtg-stat">
      <div>
        <div class="mtg-stat-val">${weekAttended}</div>
        <div class="mtg-stat-label">Attended This Week</div>
      </div>
    </div>
    <div class="mtg-stat">
      <div>
        <div class="mtg-stat-val">${naTotalMeetings}</div>
        <div class="mtg-stat-label">Total Meetings Attended</div>
      </div>
    </div>`;
}

function renderMeetingsWeek() {
  const grid = document.getElementById('meetingsWeekGrid');
  if (!grid) return;

  const today = new Date();
  const todayDow = today.getDay();

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - todayDow);

  grid.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + i);
    const isToday = i === todayDow;
    const dateLabel = dayDate.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    const dayMtgs = naMeetings.filter(m => m.dayOfWeek === i);

    const cards = dayMtgs.map(m => {
      const commitLabel = m.commitmentType !== 'member' ? MTG_COMMIT_LABELS[m.commitmentType] || '' : '';
      return `
        <div class="mtg-card" style="border-left-color:${m.color}"
             onclick="openMeetingModal(${JSON.stringify(m).replace(/"/g,'&quot;')})">
          ${m.meetingTime ? `<div class="mtg-card-time">${fmtMtgTime(m.meetingTime)}</div>` : ''}
          <div class="mtg-card-name">${escHtml(m.name)}</div>
          ${m.location ? `<div class="mtg-card-loc">📍 ${escHtml(m.location)}</div>` : ''}
          ${commitLabel ? `<div class="mtg-commit-badge">${commitLabel}</div>` : ''}
          <button class="mtg-attend-btn ${m.attendedToday ? 'attended' : ''}"
            onclick="event.stopPropagation();toggleAttendance('${m.id}',${!m.attendedToday})">
            ${m.attendedToday ? '✓ Attended' : 'Mark Attended'}
          </button>
          <button class="mtg-stats-btn" title="View attendance stats"
            onclick="event.stopPropagation();showMeetingStatsModal('${m.id}','${escHtml(m.name).replace(/'/g,"\\'")}')">
            📊
          </button>
        </div>`;
    }).join('');

    return `
      <div class="mtg-day-col${isToday ? ' today' : ''}">
        <div class="mtg-day-header">
          ${DAY_NAMES[i].slice(0,3).toUpperCase()}
          <div class="mtg-day-date">${dateLabel}</div>
        </div>
        <div class="mtg-cards-wrap">
          ${cards || `<div class="mtg-empty-col">No meetings</div>`}
          <button class="mtg-add-btn" onclick="openMeetingModal(null, ${i})">+ Add</button>
        </div>
      </div>`;
  }).join('');
}

function fmtMtgTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function openMeetingModal(mtg, prefillDay) {
  editingMeetingId = null;
  selectedMtgColor = '#6366f1';
  document.getElementById('meetingModalTitle').textContent = mtg ? 'Edit Meeting' : 'Add Meeting';
  document.getElementById('mtgName').value = mtg ? mtg.name : '';
  document.getElementById('mtgDay').value  = mtg ? mtg.dayOfWeek : (prefillDay ?? new Date().getDay());
  document.getElementById('mtgTime').value = mtg ? (mtg.meetingTime || '') : '';
  document.getElementById('mtgLocation').value  = mtg ? (mtg.location || '') : '';
  document.getElementById('mtgCommit').value    = mtg ? (mtg.commitmentType || 'member') : 'member';
  document.getElementById('mtgNotes').value     = mtg ? (mtg.notes || '') : '';
  document.getElementById('mtgRecurring').checked = mtg ? mtg.recurring : true;
  document.getElementById('mtgDeleteBtn').style.display = mtg ? '' : 'none';
  if (mtg) { editingMeetingId = mtg.id; selectedMtgColor = mtg.color || '#6366f1'; }
  document.querySelectorAll('#mtgColorSwatches .color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === selectedMtgColor);
  });
  document.getElementById('meetingModal').classList.add('open');
  setTimeout(() => document.getElementById('mtgName').focus(), 50);
}

function closeMeetingModal(e) {
  if (e && e.target !== document.getElementById('meetingModal')) return;
  document.getElementById('meetingModal').classList.remove('open');
}

function pickMtgColor(el) {
  document.querySelectorAll('#mtgColorSwatches .color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  selectedMtgColor = el.dataset.color;
}

async function saveMeeting() {
  const name = document.getElementById('mtgName').value.trim();
  if (!name) { showToast('Meeting name is required', 'error'); return; }
  const body = {
    name,
    dayOfWeek:      parseInt(document.getElementById('mtgDay').value),
    meetingTime:    document.getElementById('mtgTime').value || null,
    location:       document.getElementById('mtgLocation').value.trim() || null,
    commitmentType: document.getElementById('mtgCommit').value,
    notes:          document.getElementById('mtgNotes').value.trim() || null,
    recurring:      document.getElementById('mtgRecurring').checked,
    color:          selectedMtgColor,
  };
  const addToCal = document.getElementById('mtgAddToCalendar')?.checked;
  try {
    if (editingMeetingId) {
      const updated = await api('PUT', `/api/na/meetings/${editingMeetingId}`, body);
      naMeetings = naMeetings.map(m => m.id === editingMeetingId ? updated : m);
      showToast('Meeting updated', 'success');
    } else {
      body.id = `mtg-${Date.now()}`;
      const created = await api('POST', '/api/na/meetings', body);
      naMeetings.push(created);
      if (addToCal) await syncMeetingToCalendar(body);
      showToast('Meeting added! 🤝', 'success');
    }
    closeMeetingModal();
    renderMeetingsTab();
    renderRecoveryToday();
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function syncMeetingToCalendar(mtg) {
  const weeks = mtg.recurring ? 8 : 1;
  const now = new Date();
  // Find next occurrence of dayOfWeek
  const diff = (mtg.dayOfWeek - now.getDay() + 7) % 7 || 7;
  const first = new Date(now); first.setDate(now.getDate() + diff); first.setHours(0,0,0,0);
  const [h, m] = mtg.meetingTime ? mtg.meetingTime.split(':').map(Number) : [0, 0];
  const promises = [];
  for (let w = 0; w < weeks; w++) {
    const d = new Date(first); d.setDate(first.getDate() + w * 7);
    const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const startTime = `${ymd}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
    const endTime   = `${ymd}T${String(h + 1).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
    promises.push(api('POST', '/api/calendar-events', {
      title: `🤝 ${mtg.name}`,
      description: mtg.location ? `📍 ${mtg.location}` : null,
      startTime, endTime, allDay: false, color: mtg.color || '#6366f1',
    }));
  }
  const newEvents = await Promise.all(promises);
  calEvents = [...calEvents, ...newEvents];
  renderDashCalPreview();
  if (weeks > 1) showToast(`Added ${weeks} calendar events`, 'success');
}

async function deleteMeeting() {
  if (!editingMeetingId || !confirm('Delete this meeting?')) return;
  try {
    await api('DELETE', `/api/na/meetings/${editingMeetingId}`);
    naMeetings = naMeetings.filter(m => m.id !== editingMeetingId);
    closeMeetingModal();
    renderMeetingsTab();
    renderRecoveryToday();
    showToast('Meeting deleted', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function toggleAttendance(id, attended) {
  try {
    const result = await api('POST', `/api/na/meetings/${id}/attend`, { attended });
    naMeetings = naMeetings.map(m => m.id === id ? { ...m, attendedToday: attended } : m);
    const todayStr = dateStr(new Date());
    if (attended) {
      if (!naAttendanceDates.includes(todayStr)) naAttendanceDates = [todayStr, ...naAttendanceDates];
      naTotalMeetings++;
      if (result.calendarEvent) { calEvents = [...calEvents, result.calendarEvent]; renderDashCalPreview(); }
    } else {
      naTotalMeetings = Math.max(0, naTotalMeetings - 1);
    }
    renderMeetingsTab();
    renderRecoveryToday();
    showToast(attended ? '✓ Attendance marked!' : 'Attendance removed', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

// ── Sponsor Tab ───────────────────────────────────────────────────────────────
function renderSponsorTab() {
  renderSponsorProfile();
  renderStepsGrid();
  renderDailyTasks();
  renderQuitHabits();
  renderSponsees();
}

function renderSponsorProfile() {
  const el = document.getElementById('sponsorProfileContent');
  if (!el) return;
  if (!naSponsor || !naSponsor.name) {
    el.innerHTML = `
      <div class="sponsor-empty">
        <div style="font-size:40px;margin-bottom:8px">👤</div>
        <p style="margin-bottom:14px">No sponsor info yet.</p>
        <button class="btn btn-primary" onclick="openSponsorModal()">Add My Sponsor</button>
      </div>`;
    return;
  }
  const s = naSponsor;
  el.innerHTML = `
    <div class="sponsor-profile-card">
      <div class="sponsor-avatar">👤</div>
      <div class="sponsor-info">
        <div class="sponsor-name">${escHtml(s.name)}</div>
        <div class="sponsor-meta">
          ${s.phone ? `📞 <a href="tel:${escHtml(s.phone)}">${escHtml(s.phone)}</a>` : ''}
          ${s.phone && s.email ? ' · ' : ''}
          ${s.email ? `✉️ <a href="mailto:${escHtml(s.email)}">${escHtml(s.email)}</a>` : ''}
          ${s.yearsClean ? `<br>☀️ ${escHtml(s.yearsClean)} clean` : ''}
          ${s.notes ? `<br><span style="font-size:12px;color:var(--text-muted)">${escHtml(s.notes)}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function openSponsorModal() {
  const s = naSponsor || {};
  document.getElementById('spName').value   = s.name || '';
  document.getElementById('spPhone').value  = s.phone || '';
  document.getElementById('spEmail').value  = s.email || '';
  document.getElementById('spYears').value  = s.yearsClean || '';
  document.getElementById('spNotes').value  = s.notes || '';
  document.getElementById('sponsorModal').classList.add('open');
  setTimeout(() => document.getElementById('spName').focus(), 50);
}

function closeSponsorModal(e) {
  if (e && e.target !== document.getElementById('sponsorModal')) return;
  document.getElementById('sponsorModal').classList.remove('open');
}

async function saveSponsor() {
  const body = {
    name:       document.getElementById('spName').value.trim(),
    phone:      document.getElementById('spPhone').value.trim(),
    email:      document.getElementById('spEmail').value.trim(),
    yearsClean: document.getElementById('spYears').value.trim(),
    notes:      document.getElementById('spNotes').value.trim(),
    currentStep: naSponsor?.currentStep || 1,
  };
  try {
    naSponsor = await api('PUT', '/api/na/sponsor', body);
    closeSponsorModal();
    renderSponsorProfile();
    showToast('Sponsor info saved!', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

// ── 12 Steps ──────────────────────────────────────────────────────────────────
function renderStepsGrid() {
  const grid = document.getElementById('stepsGrid');
  const bar  = document.getElementById('stepsProgressBar');
  const lbl  = document.getElementById('stepsProgressLabel');
  const sub  = document.getElementById('stepsSubtitle');
  if (!grid) return;

  const completed = naSteps.filter(s => s.completedAt).length;
  const currentStep = naSponsor?.currentStep || 1;
  if (bar) bar.style.width = `${Math.round((completed / 12) * 100)}%`;
  if (lbl) lbl.textContent = `${completed} / 12 complete`;
  if (sub) sub.textContent = `Currently on Step ${currentStep}`;

  grid.innerHTML = naSteps.map(s => {
    const isCurrent = s.stepNumber === currentStep;
    const isDone    = !!s.completedAt;
    return `<div class="step-box${isDone ? ' completed' : isCurrent ? ' current' : ''}"
      title="Step ${s.stepNumber}: ${NA_STEP_TITLES[s.stepNumber-1]}"
      onclick="openStepModal(${s.stepNumber})">${s.stepNumber}</div>`;
  }).join('');

  if (openStepNumber) renderStepDetail(openStepNumber);
}

async function openStepModal(num) {
  openStepNumber = num;
  const step = naSteps.find(s => s.stepNumber === num) || { stepNumber: num, notes: '', completedAt: null };
  document.getElementById('stepModalTitle').textContent = `Step ${num}: ${NA_STEP_TITLES[num-1]}`;
  document.getElementById('stepModalDesc').textContent  = NA_STEP_DESC[num-1];
  document.getElementById('stepNotes').value            = '';

  const isDone = !!step.completedAt;
  document.getElementById('stepCompleted').checked = isDone;

  const banner = document.getElementById('stepCompletedBanner');
  const label  = document.getElementById('stepCompleteLabel');
  if (isDone) {
    const ts = new Date(step.completedAt);
    document.getElementById('stepCompletedDate').textContent =
      ts.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    banner.style.display = '';
    label.style.display  = 'none';
  } else {
    banner.style.display = 'none';
    label.style.display  = '';
  }

  document.getElementById('stepModal').classList.add('open');
  setTimeout(() => document.getElementById('stepNotes').focus(), 50);

  // Load saved notes from DB
  try {
    currentStepNotes = await api('GET', `/api/na/steps/${num}/notes`);
    renderStepNotesHistory();
  } catch { currentStepNotes = []; }
}

function stepReopenToggle() {
  document.getElementById('stepCompleted').checked = false;
  document.getElementById('stepCompletedBanner').style.display = 'none';
  document.getElementById('stepCompleteLabel').style.display   = '';
  showToast('Step reopened — save to confirm', 'success');
}

function closeStepModal(e) {
  if (e && e.target !== document.getElementById('stepModal')) return;
  document.getElementById('stepModal').classList.remove('open');
}

function renderStepDetail(num) {
  const panel = document.getElementById('stepDetailPanel');
  if (!panel) return;
  const step = naSteps.find(s => s.stepNumber === num);
  if (!step?.notes && !step?.completedAt) { panel.innerHTML = ''; return; }
  const ts = step.completedAt ? new Date(step.completedAt).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }) : null;
  panel.innerHTML = `
    <div class="step-detail-panel">
      <div class="step-detail-title">Step ${num} — ${NA_STEP_TITLES[num-1]}</div>
      ${ts ? `<div class="step-detail-completed">✅ Completed ${ts}</div>` : '<div class="step-detail-inprogress">🔄 In Progress</div>'}
      ${step.notes ? `<div class="step-detail-desc">${escHtml(step.notes)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="openStepModal(${num})">✏️ ${step.completedAt ? 'Edit / Reopen' : 'Edit Notes'}</button>
      </div>
    </div>`;
}

async function saveStepNotes() {
  const num       = openStepNumber;
  const noteText  = document.getElementById('stepNotes').value.trim();
  const completed = document.getElementById('stepCompleted').checked;
  try {
    const updated = await api('PUT', `/api/na/steps/${num}`, { notes: '', completed });
    naSteps = naSteps.map(s => s.stepNumber === num ? updated : s);
    // Advance sponsor's current step
    if (completed && naSponsor) {
      const nextIncomplete = naSteps.find(s => !s.completedAt && s.stepNumber > num);
      if (nextIncomplete) {
        naSponsor = await api('PUT', '/api/na/sponsor', { ...naSponsor, currentStep: nextIncomplete.stepNumber });
      }
    }
    // Save note entry if text provided
    if (noteText) {
      const note = await api('POST', `/api/na/steps/${num}/notes`, {
        id: `snote-${Date.now()}`, content: noteText,
      });
      currentStepNotes.push(note);
      document.getElementById('stepNotes').value = '';
      renderStepNotesHistory();
    }
    renderStepsGrid();
    showToast(`Step ${num} saved!`, 'success');
    if (!noteText) closeStepModal();
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

function renderStepNotesHistory() {
  const wrap = document.getElementById('stepNotesList');
  const list = document.getElementById('stepNotesHistory');
  if (!wrap || !list) return;
  if (!currentStepNotes.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  list.innerHTML = currentStepNotes.slice().reverse().map(n => {
    const ts = new Date(n.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    return `
      <div class="step-note-entry">
        <div class="step-note-meta">
          <span class="step-note-date">${ts}</span>
          <button class="step-note-del" onclick="deleteStepNote('${n.id}',${openStepNumber})" title="Delete">✕</button>
        </div>
        <div class="step-note-body">${escHtml(n.content)}</div>
      </div>`;
  }).join('');
}

async function deleteStepNote(id, num) {
  await api('DELETE', `/api/na/steps/${num}/notes/${id}`);
  currentStepNotes = currentStepNotes.filter(n => n.id !== id);
  renderStepNotesHistory();
}

// ── Daily Tasks ───────────────────────────────────────────────────────────────
function renderDailyTasks() {
  const el  = document.getElementById('dailyTasksList');
  const bar = document.getElementById('tasksProgressBar');
  const lbl = document.getElementById('tasksProgressLabel');
  if (!el) return;

  const done  = naDailyTasks.filter(t => t.completedToday).length;
  const total = naDailyTasks.length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = `${done} / ${total} complete`;

  if (!total) {
    el.innerHTML = '<p class="muted" style="text-align:center;padding:12px 0">No tasks yet — add one above.</p>';
    return;
  }

  el.innerHTML = naDailyTasks.map(t => `
    <div class="dtask-item${t.completedToday ? ' done' : ''}">
      <input class="dtask-cb" type="checkbox" ${t.completedToday ? 'checked' : ''}
        onchange="toggleDailyTask('${t.id}', this.checked)">
      <span class="dtask-text">${escHtml(t.taskText)}</span>
      ${t.isPreset ? '<span class="dtask-preset-badge">preset</span>' : ''}
      <button class="dtask-del" onclick="removeDailyTask('${t.id}')" title="Remove">✕</button>
    </div>`).join('');
}

async function toggleDailyTask(id, completed) {
  try {
    await api('POST', `/api/na/daily-tasks/${id}/complete`, { completed });
    naDailyTasks = naDailyTasks.map(t => t.id === id ? { ...t, completedToday: completed } : t);
    renderDailyTasks();
    renderRecoveryToday();
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function removeDailyTask(id) {
  if (!confirm('Remove this task?')) return;
  try {
    await api('DELETE', `/api/na/daily-tasks/${id}`);
    naDailyTasks = naDailyTasks.filter(t => t.id !== id);
    renderDailyTasks();
    renderRecoveryToday();
    showToast('Task removed', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

function openAddTaskModal() {
  document.getElementById('newTaskText').value = '';
  document.getElementById('addTaskModal').classList.add('open');
  setTimeout(() => document.getElementById('newTaskText').focus(), 50);
}

function closeAddTaskModal(e) {
  if (e && e.target !== document.getElementById('addTaskModal')) return;
  document.getElementById('addTaskModal').classList.remove('open');
}

async function saveNewTask() {
  const text = document.getElementById('newTaskText').value.trim();
  if (!text) { showToast('Enter a task', 'error'); return; }
  try {
    const task = await api('POST', '/api/na/daily-tasks', {
      id: `task-${Date.now()}`, taskText: text, isPreset: false,
      sortOrder: naDailyTasks.length,
    });
    naDailyTasks.push(task);
    closeAddTaskModal();
    renderDailyTasks();
    renderRecoveryToday();
    showToast('Task added!', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

// ── 90-in-90 Tracker ─────────────────────────────────────────────────────────
let nin90StartDate = null;

async function loadNin90() {
  const s = await api('GET', '/api/na/settings').catch(() => ({}));
  nin90StartDate = s.nin90_start || null;
}

function renderNin90() {
  const body = document.getElementById('nin90Body');
  const badge = document.getElementById('nin90Status');
  if (!body) return;

  if (!nin90StartDate) {
    badge.textContent = '';
    body.innerHTML = `
      <p style="color:var(--text-muted);font-size:14px;margin-bottom:14px">
        Commit to attending 90 NA meetings in 90 days. Track your progress here.
      </p>
      <button class="btn btn-primary" onclick="startNin90()">🔥 Start 90-in-90</button>`;
    return;
  }

  const start = new Date(nin90StartDate + 'T00:00:00');
  const now = new Date();
  const elapsedDays = Math.floor((now - start) / 864e5);
  const daysLeft = Math.max(0, 90 - elapsedDays);
  const endDate = new Date(start); endDate.setDate(start.getDate() + 90);

  // Count attendance in the 90-day window
  const startStr = nin90StartDate;
  const endStr = endDate.toISOString().split('T')[0];
  const attended = naAttendanceDates.filter(d => d >= startStr && d <= endStr).length;
  const pct = Math.min(100, Math.round((attended / 90) * 100));
  const done = attended >= 90 || elapsedDays >= 90;
  const onTrack = attended >= elapsedDays;

  badge.innerHTML = done
    ? `<span style="color:var(--success);font-size:13px;font-weight:700">✅ Complete!</span>`
    : onTrack
      ? `<span style="color:var(--success);font-size:12px;font-weight:700">On Track</span>`
      : `<span style="color:#f59e0b;font-size:12px;font-weight:700">Behind</span>`;

  body.innerHTML = `
    <div class="nin-stats">
      <div class="nin-stat"><span class="nin-num" style="color:var(--primary)">${attended}</span><span class="nin-lbl">Attended</span></div>
      <div class="nin-stat"><span class="nin-num" style="color:${daysLeft === 0 ? 'var(--success)' : 'var(--text)'}">${daysLeft}</span><span class="nin-lbl">Days Left</span></div>
      <div class="nin-stat"><span class="nin-num" style="color:${onTrack ? 'var(--success)' : '#f59e0b'}">${Math.max(0,elapsedDays-attended)}</span><span class="nin-lbl">To Catch Up</span></div>
      <div class="nin-stat"><span class="nin-num">${pct}%</span><span class="nin-lbl">Progress</span></div>
    </div>
    <div class="nin-bar-wrap"><div class="nin-bar-fill" style="width:${pct}%;background:${pct===100?'var(--success)':onTrack?'var(--primary)':'#f59e0b'}"></div></div>
    <div style="font-size:12px;color:var(--text-muted);margin-top:6px">
      Started ${start.toLocaleDateString()} · Goal: ${endDate.toLocaleDateString()}
    </div>`;
}

async function startNin90() {
  const today = new Date().toISOString().split('T')[0];
  await api('PUT', '/api/na/settings', { nin90_start: today });
  nin90StartDate = today;
  renderNin90();
  showToast('90-in-90 started! Keep coming back. 🔥', 'success');
}

async function resetNin90() {
  if (!confirm('Reset your 90-in-90 tracker?')) return;
  await api('PUT', '/api/na/settings', { nin90_start: null });
  nin90StartDate = null;
  renderNin90();
  showToast('90-in-90 reset', 'success');
}

// ── Recovery Resources ────────────────────────────────────────────────────────
let naResources = [];

async function loadResources() {
  naResources = await api('GET', '/api/na/resources').catch(() => []);
}

function renderResourcesTab() {
  const section = document.getElementById('customLinksSection');
  const list    = document.getElementById('customLinksList');
  if (!list) return;
  if (!naResources.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = naResources.map(r => `
    <div class="res-link-card res-custom" style="position:relative">
      <button class="res-delete-btn" onclick="deleteResource('${r.id}')" title="Remove">✕</button>
      <span class="res-link-icon">${categoryIcon(r.category)}</span>
      <a class="res-link-name" href="${escHtml(r.url)}" target="_blank" rel="noopener">${escHtml(r.title)}</a>
      ${r.description ? `<span class="res-link-desc">${escHtml(r.description)}</span>` : ''}
    </div>`).join('');
}

function categoryIcon(c) {
  return { meeting:'🤝', literature:'📖', meditation:'🧘', hotline:'📞', local:'📍', general:'🔗' }[c] || '🔗';
}

function openAddResourceModal() {
  ['resTitle','resUrl','resDesc'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('resCategory').value = 'general';
  document.getElementById('addResourceModal').classList.add('open');
  setTimeout(() => document.getElementById('resTitle').focus(), 50);
}
function closeAddResourceModal(e) {
  if (e && e.target !== document.getElementById('addResourceModal')) return;
  document.getElementById('addResourceModal').classList.remove('open');
}

async function saveCustomResource() {
  const title = document.getElementById('resTitle').value.trim();
  const url   = document.getElementById('resUrl').value.trim();
  if (!title || !url) { showToast('Title and URL are required', 'error'); return; }
  try {
    const r = await api('POST', '/api/na/resources', {
      id: `res-${Date.now()}`, title, url,
      description: document.getElementById('resDesc').value.trim() || null,
      category: document.getElementById('resCategory').value,
    });
    naResources.push(r);
    closeAddResourceModal();
    renderResourcesTab();
    showToast('Link saved!', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function deleteResource(id) {
  if (!confirm('Remove this link?')) return;
  await api('DELETE', `/api/na/resources/${id}`);
  naResources = naResources.filter(r => r.id !== id);
  renderResourcesTab();
}

// ── Per-Meeting Attendance Stats ──────────────────────────────────────────────
async function showMeetingStatsModal(id, name) {
  const title = document.getElementById('meetingStatsTitle');
  const body  = document.getElementById('meetingStatsBody');
  const modal = document.getElementById('meetingStatsModal');
  if (!modal) return;
  title.textContent = name + ' — Stats';
  body.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Loading…</p>';
  modal.classList.add('open');
  try {
    const s = await api('GET', `/api/na/meetings/${id}/stats`);
    body.innerHTML = `
      <div class="mtg-stats-grid">
        <div class="mtg-stat-card">
          <div class="mtg-stat-val">${s.total}</div>
          <div class="mtg-stat-lbl">Total Attended</div>
        </div>
        <div class="mtg-stat-card">
          <div class="mtg-stat-val">${s.thisMonth}</div>
          <div class="mtg-stat-lbl">This Month</div>
        </div>
        <div class="mtg-stat-card">
          <div class="mtg-stat-val">${s.thisWeek}</div>
          <div class="mtg-stat-lbl">This Week</div>
        </div>
        <div class="mtg-stat-card">
          <div class="mtg-stat-val">${s.total > 0 ? '🔥' : '—'}</div>
          <div class="mtg-stat-lbl">Keep Coming Back</div>
        </div>
      </div>`;
  } catch (err) {
    body.innerHTML = '<p style="color:var(--danger)">Could not load stats.</p>';
  }
}

function closeMeetingStatsModal(e) {
  if (e && e.target !== document.getElementById('meetingStatsModal')) return;
  document.getElementById('meetingStatsModal').classList.remove('open');
}

async function showMeetingStats(id, name) {
  showMeetingStatsModal(id, name);
}

// ── Sobriety Counter ──────────────────────────────────────────────────────────
function calcSobriety() {
  if (!sobrietyDate) return null;
  const start = new Date(sobrietyDate + 'T00:00:00');
  const now = new Date();
  const totalMs = now - start;
  if (totalMs < 0) return null;
  const totalDays = Math.floor(totalMs / 864e5);
  const years  = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days   = totalDays % 30;
  const hours   = Math.floor((totalMs % 864e5) / 3600e3);
  const minutes = Math.floor((totalMs % 3600e3) / 60e3);
  const seconds = Math.floor((totalMs % 60e3) / 1000);
  return { totalDays, years, months, days, hours, minutes, seconds };
}

function getSobrietyQuote(totalDays) {
  if (totalDays < 1)   return 'Every hour counts. You are doing something remarkable today.';
  if (totalDays < 7)   return 'One day at a time. You\'re already doing it.';
  if (totalDays < 30)  return 'Keep coming back — it works if you work it.';
  if (totalDays < 90)  return 'We do recover. And so are you, one day at a time.';
  if (totalDays < 180) return 'Just for today, I will try to live through this day only.';
  if (totalDays < 365) return 'The promises are unfolding. Keep coming back.';
  if (totalDays < 730) return 'Your recovery is proof that miracles happen every day.';
  return 'You are living proof that recovery is real. Keep going — more will be revealed.';
}

function renderSobrietyCounter() {
  const el = document.getElementById('sobrietyContent');
  if (!el) return;

  if (!sobrietyDate) {
    el.innerHTML = `
      <div style="text-align:center;padding:20px 0 8px">
        <div style="font-size:40px;margin-bottom:10px">💙</div>
        <p style="color:var(--text-muted);font-size:14px;margin-bottom:16px;line-height:1.6">
          Enter your clean date to start tracking your sobriety.<br>
          See your total days, months, and years — live.
        </p>
        <button class="btn btn-primary" onclick="openSobrietyModal()">Set My Clean Date</button>
      </div>`;
    if (sobrietyTicker) { clearInterval(sobrietyTicker); sobrietyTicker = null; }
    return;
  }

  const s = calcSobriety();
  if (!s) {
    el.innerHTML = '<p class="muted">Clean date appears to be in the future — please check the date.</p>';
    return;
  }

  const fmt = new Date(sobrietyDate + 'T00:00:00')
    .toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  el.innerHTML = `
    <div class="sob-units">
      <div class="sob-unit">
        <div class="sob-unit-val" id="sobYears">${s.years}</div>
        <div class="sob-unit-label">Years</div>
      </div>
      <div class="sob-unit">
        <div class="sob-unit-val" id="sobMonths">${s.months}</div>
        <div class="sob-unit-label">Months</div>
      </div>
      <div class="sob-unit">
        <div class="sob-unit-val" id="sobDays">${s.days}</div>
        <div class="sob-unit-label">Days</div>
      </div>
    </div>
    <div class="sob-total"><strong id="sobTotal">${s.totalDays}</strong> total days clean &amp; sober</div>
    <div class="sob-ticker" id="sobTicker">${String(s.hours).padStart(2,'0')}:${String(s.minutes).padStart(2,'0')}:${String(s.seconds).padStart(2,'0')} elapsed today</div>
    <div class="sob-quote">"${escHtml(getSobrietyQuote(s.totalDays))}"</div>
    <div class="sob-clean-date">Clean since ${fmt}</div>
    <div class="sob-actions">
      <button class="btn btn-secondary" onclick="copySobrietyText()">📋 Copy to Journal</button>
    </div>`;

  startSobrietyTicker();
}

function startSobrietyTicker() {
  if (sobrietyTicker) clearInterval(sobrietyTicker);
  sobrietyTicker = setInterval(() => {
    const s = calcSobriety();
    if (!s) return;
    const ticker  = document.getElementById('sobTicker');
    const total   = document.getElementById('sobTotal');
    const years   = document.getElementById('sobYears');
    const months  = document.getElementById('sobMonths');
    const days    = document.getElementById('sobDays');
    if (ticker)  ticker.textContent  = `${String(s.hours).padStart(2,'0')}:${String(s.minutes).padStart(2,'0')}:${String(s.seconds).padStart(2,'0')} elapsed today`;
    if (total)   total.textContent   = s.totalDays;
    if (years)   years.textContent   = s.years;
    if (months)  months.textContent  = s.months;
    if (days)    days.textContent    = s.days;
  }, 1000);
}

function openSobrietyModal() {
  document.getElementById('sobrietyDateInput').value = sobrietyDate || '';
  updateSobrietyPreview();
  document.getElementById('sobrietyModal').classList.add('open');
  setTimeout(() => document.getElementById('sobrietyDateInput').focus(), 50);
}

function closeSobrietyModal(e) {
  if (e && e.target !== document.getElementById('sobrietyModal')) return;
  document.getElementById('sobrietyModal').classList.remove('open');
}

function updateSobrietyPreview() {
  const val     = document.getElementById('sobrietyDateInput').value;
  const preview = document.getElementById('sobrietyPreview');
  if (!val) { preview.innerHTML = ''; return; }
  const start = new Date(val + 'T00:00:00');
  if (start > new Date()) {
    preview.innerHTML = '<p style="color:var(--danger);font-size:13px;margin-top:6px">Date cannot be in the future.</p>';
    return;
  }
  const totalDays = Math.floor((new Date() - start) / 864e5);
  const years  = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days   = totalDays % 30;
  const parts  = [];
  if (years)  parts.push(years  + ' year'  + (years  !== 1 ? 's' : ''));
  if (months) parts.push(months + ' month' + (months !== 1 ? 's' : ''));
  parts.push(days + ' day' + (days !== 1 ? 's' : ''));
  preview.innerHTML = `
    <div style="background:var(--primary-dim);border:1px solid var(--primary);border-radius:8px;padding:14px;text-align:center;margin-top:8px">
      <div style="font-size:36px;font-weight:800;color:var(--primary);letter-spacing:-1px">${totalDays}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:2px">total days · ${parts.join(', ')}</div>
      <div style="font-style:italic;color:var(--text-muted);font-size:13px;margin-top:8px">"${getSobrietyQuote(totalDays)}"</div>
    </div>`;
}

async function saveSobrietyDate() {
  const val = document.getElementById('sobrietyDateInput').value;
  if (!val) { showToast('Please select a date', 'error'); return; }
  if (new Date(val + 'T00:00:00') > new Date()) { showToast('Date cannot be in the future', 'error'); return; }
  try {
    await api('PUT', '/api/na/settings', { sobriety_date: val });
    sobrietyDate = val;
    closeSobrietyModal();
    renderSobrietyCounter();
    showToast('Clean date saved! 💙', 'success');
  } catch (err) { showToast('Failed to save: ' + err.message, 'error'); }
}

async function resetSobrietyCounter() {
  if (!confirm('Reset your sobriety counter? This will clear your clean date.')) return;
  try {
    await api('PUT', '/api/na/settings', { sobriety_date: null });
    sobrietyDate = null;
    if (sobrietyTicker) { clearInterval(sobrietyTicker); sobrietyTicker = null; }
    renderSobrietyCounter();
    showToast('Counter reset', 'success');
  } catch (err) { showToast('Failed to reset: ' + err.message, 'error'); }
}

function copySobrietyText() {
  const s = calcSobriety();
  if (!s) return;
  const cleanFmt = new Date(sobrietyDate + 'T00:00:00')
    .toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const todayFmt = new Date()
    .toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const parts = [];
  if (s.years)  parts.push(s.years  + ' year'  + (s.years  !== 1 ? 's' : ''));
  if (s.months) parts.push(s.months + ' month' + (s.months !== 1 ? 's' : ''));
  parts.push(s.days + ' day' + (s.days !== 1 ? 's' : ''));

  const text =
`Day ${s.totalDays} of My Recovery — ${todayFmt}
${'─'.repeat(42)}
Clean since:  ${cleanFmt}
Time in recovery:  ${parts.join(', ')}
Total days clean & sober:  ${s.totalDays}
${'─'.repeat(42)}
"${getSobrietyQuote(s.totalDays)}"

Just for today, I choose recovery.`;

  navigator.clipboard.writeText(text)
    .then(() => showToast('Copied to clipboard! 📋', 'success'))
    .catch(() => showToast('Copy failed — try again', 'error'));
}

function renderStats() {
  const { current, longest } = calcStreaks();
  document.getElementById('currentStreak').textContent = current;
  document.getElementById('longestStreak').textContent = longest;
  document.getElementById('totalEntries').textContent  = entries.length;
  const avg = entries.length
    ? Math.round(entries.reduce((s, e) => s + (e.wordCount || 0), 0) / entries.length) : 0;
  document.getElementById('avgWords').textContent = avg;
}

function calcStreaks() {
  if (!entries.length) return { current: 0, longest: 0 };
  const dates = new Set(entries.map(e => e.date));
  const today     = dateStr(new Date());
  const yesterday = dateStr(new Date(Date.now() - 864e5));

  // Current
  let current = 0;
  let d = dates.has(today) ? new Date() : new Date(Date.now() - 864e5);
  if (!dates.has(dateStr(d))) return { current: 0, longest: calcLongest(dates) };
  while (dates.has(dateStr(d))) { current++; d = new Date(d.getTime() - 864e5); }

  return { current, longest: Math.max(current, calcLongest(dates)) };
}

function calcLongest(dates) {
  const sorted = [...dates].sort();
  let longest = 1, streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i]) - new Date(sorted[i - 1])) / 864e5;
    streak = diff === 1 ? streak + 1 : 1;
    if (streak > longest) longest = streak;
  }
  return longest;
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function renderHeatmap() {
  const container = document.getElementById('heatmap');
  const monthsEl  = document.getElementById('heatmapMonths');

  const entryMap = {};
  entries.forEach(e => { entryMap[e.date] = (entryMap[e.date] || 0) + 1; });

  const today = new Date();
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() - start.getDay()); // align to Sunday

  document.getElementById('heatmapRange').textContent =
    `${start.toLocaleDateString('en-US',{month:'short',year:'numeric'})} – ${today.toLocaleDateString('en-US',{month:'short',year:'numeric'})}`;

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';

  const monthMap = {};
  let col = 0;
  const d = new Date(start);

  while (d <= today) {
    const ds = dateStr(d);
    const count = entryMap[ds] || 0;
    const level = count === 0 ? 0 : Math.min(count, 4);

    // Track month positions
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    if (!monthMap[monthKey]) monthMap[monthKey] = col;

    const cell = document.createElement('div');
    cell.className = `heatmap-cell level-${level}`;
    cell.dataset.tip = `${ds}: ${count} ${count === 1 ? 'entry' : 'entries'}`;
    cell.title = cell.dataset.tip;
    grid.appendChild(cell);

    if (d.getDay() === 6) col++;
    d.setDate(d.getDate() + 1);
  }

  container.innerHTML = '';
  container.appendChild(grid);

  // Month labels
  const totalCols = col + 1;
  monthsEl.style.gridTemplateColumns = `repeat(${totalCols}, 17px)`;
  monthsEl.innerHTML = '';
  const labeled = new Set();
  Object.entries(monthMap).forEach(([key, c]) => {
    const [y, m] = key.split('-').map(Number);
    const label = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'short' });
    if (!labeled.has(label)) {
      labeled.add(label);
      const span = document.createElement('span');
      span.textContent = label;
      span.style.gridColumn = c + 1;
      monthsEl.appendChild(span);
    }
  });
}

// ── Recent Entries ────────────────────────────────────────────────────────────
function renderRecentEntries() {
  const el = document.getElementById('recentEntries');
  const recent = entries.slice(0, 5);
  if (!recent.length) {
    el.innerHTML = emptyState('📓', 'No entries yet', 'Click "Add Entry" to start your journal');
    return;
  }
  el.innerHTML = recent.map(entryCardHTML).join('');
  bindEntryCards(el);
}

// ── All Entries ───────────────────────────────────────────────────────────────
function renderAllEntries() {
  const el       = document.getElementById('allEntries');
  const search   = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const mood     = document.getElementById('filterMood')?.value;
  const period   = parseInt(document.getElementById('filterPeriod')?.value || '0');
  const sortDir  = document.getElementById('sortOrder')?.value || 'desc';

  let list = [...entries];
  if (search)  list = list.filter(e => e.content?.toLowerCase().includes(search) || e.tags?.some(t => t.includes(search)));
  if (mood)    list = list.filter(e => e.mood === parseInt(mood));
  if (period)  {
    const cutoff = dateStr(new Date(Date.now() - period * 864e5));
    list = list.filter(e => e.date >= cutoff);
  }
  list.sort((a, b) => sortDir === 'desc' ? (b.createdAt || 0) - (a.createdAt || 0) : (a.createdAt || 0) - (b.createdAt || 0));

  const badge = document.getElementById('entryCount');
  if (badge) badge.textContent = list.length ? `${list.length} entr${list.length === 1 ? 'y' : 'ies'}` : '';

  if (!list.length) {
    el.innerHTML = emptyState('🔍',
      entries.length ? 'No matches' : 'No entries yet',
      entries.length ? 'Try different filters' : 'Add your first journal entry'
    );
    return;
  }
  el.innerHTML = list.map(entryCardHTML).join('');
  bindEntryCards(el);
}

function bindEntryCards(container) {
  container.querySelectorAll('.entry-card').forEach(card => {
    card.addEventListener('click', () => openEntryModal(card.dataset.id));
  });
}

function entryCardHTML(e) {
  const label     = fmtDate(e.date, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  const timeLabel = e.createdAt
    ? new Date(e.createdAt).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
    : '';

  const imageHTML = e.image
    ? `<img src="${e.image}" style="width:100%;max-height:160px;border-radius:8px;object-fit:cover;margin-bottom:8px;display:block">`
    : '';

  const textPreview = e.content
    ? `<div class="entry-preview">${escHtml(e.content.substring(0, 130))}${e.content.length > 130 ? '…' : ''}</div>`
    : !e.image
      ? `<div class="entry-preview"><em style="color:var(--text-muted)">No text content</em></div>`
      : '';

  const tagsHTML = (e.tags || []).slice(0, 4)
    .map(t => `<span class="tag-chip small">#${t}</span>`).join('');

  const footerLeft = e.image && !e.content
    ? '📷 Photo'
    : `${e.wordCount || 0} words`;

  return `
    <div class="entry-card" data-id="${e.id}">
      <div class="entry-card-header">
        <div>
          <span class="entry-date">${label}</span>
          ${timeLabel ? `<span style="font-size:11px;color:var(--text-muted);margin-left:8px">${timeLabel}</span>` : ''}
        </div>
        <span class="entry-mood">${e.mood ? MOOD_EMOJI[e.mood] : ''}</span>
      </div>
      ${imageHTML}
      ${textPreview}
      <div class="entry-footer">
        <span class="entry-word-count">${footerLeft}</span>
        ${tagsHTML}
      </div>
    </div>`;
}

// ── Form ──────────────────────────────────────────────────────────────────────
function setupForm() {
  document.getElementById('entryDate').value = dateStr(new Date());

  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMood = parseInt(btn.dataset.mood);
    });
  });

  const textarea = document.getElementById('entryContent');
  textarea.addEventListener('input', () => {
    document.getElementById('wordCount').textContent = countWords(textarea.value);
  });

  const tagInput = document.getElementById('tagInput');
  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        renderTagChips();
      }
      tagInput.value = '';
    }
    if (e.key === 'Backspace' && !tagInput.value && currentTags.length) {
      currentTags.pop();
      renderTagChips();
    }
  });

  document.getElementById('tagsInputContainer').addEventListener('click', () => tagInput.focus());

  document.getElementById('entryForm').addEventListener('submit', e => {
    e.preventDefault();
    saveEntry();
  });
}

function renderTagChips() {
  document.getElementById('tagsDisplay').innerHTML = currentTags.map(tag => `
    <span class="tag-chip">
      #${tag}
      <button type="button" onclick="removeTag('${tag}')">×</button>
    </span>`).join('');
}

function removeTag(tag) {
  currentTags = currentTags.filter(t => t !== tag);
  renderTagChips();
}

function renderHabitsCheckboxes() {
  const el = document.getElementById('habitsCheckboxes');
  if (!habits.length) {
    el.innerHTML = '<p class="muted" style="font-size:13px">Add habits in Settings to track them here.</p>';
    return;
  }
  el.innerHTML = habits.map(h => `
    <label class="habit-checkbox" id="hcb-${h.id}">
      <input type="checkbox" data-habit="${h.id}">
      <span class="habit-emoji">${h.emoji}</span>
      <span class="habit-name">${h.name}</span>
    </label>`).join('');

  el.querySelectorAll('.habit-checkbox').forEach(label => {
    label.querySelector('input').addEventListener('change', e => {
      label.classList.toggle('checked', e.target.checked);
    });
  });
}

async function saveEntry() {
  const date    = document.getElementById('entryDate').value;
  const content = document.getElementById('entryContent').value.trim();

  if (!date) { showToast('Please select a date', 'error'); return; }
  if (!content && selectedMood === null) {
    showToast('Write something or pick a mood', 'error'); return;
  }

  const completedHabits = {};
  document.querySelectorAll('[data-habit]').forEach(cb => {
    completedHabits[cb.dataset.habit] = cb.checked;
  });

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    content,
    mood: selectedMood,
    tags: [...currentTags],
    habits: completedHabits,
    wordCount: countWords(content),
    createdAt: Date.now(),
  };

  try {
    const saved = await api('POST', '/api/entries', entry);
    entries.unshift(saved);
    clearForm();
    renderAll();
    switchTab('dashboard');
    showToast('Entry saved! 📓', 'success');
  } catch (err) {
    showToast('Failed to save entry: ' + err.message, 'error');
  }
}

function clearForm() {
  document.getElementById('entryContent').value = '';
  document.getElementById('wordCount').textContent = '0';
  document.getElementById('entryDate').value = dateStr(new Date());
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  selectedMood = null;
  currentTags = [];
  renderTagChips();
  document.querySelectorAll('[data-habit]').forEach(cb => {
    cb.checked = false;
    cb.closest('.habit-checkbox')?.classList.remove('checked');
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
function setupSearch() {
  ['searchInput', 'filterMood', 'filterPeriod', 'sortOrder'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderAllEntries);
    document.getElementById(id)?.addEventListener('change', renderAllEntries);
  });
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts() {
  const isDark    = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#7d8590' : '#64748b';
  const gridColor = isDark ? '#21262d' : '#e8edf2';

  Chart.defaults.color       = textColor;
  Chart.defaults.borderColor = gridColor;
  Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  renderFrequencyChart(gridColor);
  renderMoodChart(gridColor);
  renderDowChart(textColor, gridColor);
  renderWordsChart(gridColor);
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function renderFrequencyChart(gridColor) {
  destroyChart('freq');
  const ctx = document.getElementById('frequencyChart').getContext('2d');
  const weeks = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7);
    weeks[weekStart(d)] = 0;
  }
  entries.forEach(e => {
    const k = weekStart(new Date(e.date + 'T00:00:00'));
    if (k in weeks) weeks[k]++;
  });
  charts.freq = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(weeks).map(k => {
        const d = new Date(k + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }),
      datasets: [{ data: Object.values(weeks), backgroundColor: 'rgba(99,102,241,0.65)',
        borderColor: '#6366f1', borderWidth: 1, borderRadius: 4 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: gridColor } },
                x: { grid: { display: false } } } }
  });
}

function renderMoodChart(gridColor) {
  destroyChart('mood');
  const ctx = document.getElementById('moodChart').getContext('2d');
  const data = entries.filter(e => e.mood).slice(-30).reverse();
  if (!data.length) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = 'var(--text-muted, #7d8590)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No mood data yet', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }
  charts.mood = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(e => fmtDate(e.date, { month: 'short', day: 'numeric' })),
      datasets: [{ data: data.map(e => e.mood), borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.1)', tension: 0.4, fill: true,
        pointRadius: 4, pointBackgroundColor: '#22c55e' }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { y: { min: 0.5, max: 5.5, ticks: { stepSize: 1,
        callback: v => MOOD_EMOJI[v] || '' }, grid: { color: gridColor } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } } }
  });
}

function renderDowChart(textColor, gridColor) {
  destroyChart('dow');
  const ctx = document.getElementById('dowChart').getContext('2d');
  const counts = new Array(7).fill(0);
  entries.forEach(e => { counts[new Date(e.date + 'T00:00:00').getDay()]++; });
  charts.dow = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: DAYS_SHORT,
      datasets: [{ data: counts, borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.15)', pointBackgroundColor: '#f59e0b', pointRadius: 4 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { r: { beginAtZero: true, ticks: { stepSize: 1, display: false },
        grid: { color: gridColor }, pointLabels: { color: textColor, font: { size: 12 } } } } }
  });
}

function renderWordsChart(gridColor) {
  destroyChart('words');
  const ctx = document.getElementById('wordsChart').getContext('2d');
  const months = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months[monthKey(d)] = 0;
  }
  entries.forEach(e => {
    const k = monthKey(new Date(e.date + 'T00:00:00'));
    if (k in months) months[k] += (e.wordCount || 0);
  });
  charts.words = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(months).map(k => {
        const [y, m] = k.split('-');
        return new Date(+y, +m, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      }),
      datasets: [{ data: Object.values(months), backgroundColor: 'rgba(56,189,248,0.65)',
        borderColor: '#38bdf8', borderWidth: 1, borderRadius: 4 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: gridColor } },
                x: { grid: { display: false } } } }
  });
}

// ── Word Cloud ────────────────────────────────────────────────────────────────
function renderWordCloud() {
  const el = document.getElementById('wordCloud');
  if (!entries.length) {
    el.innerHTML = '<p class="muted" style="font-size:13px">Add entries to see your most-used words.</p>';
    return;
  }
  const freq = wordFrequency();
  const top  = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 40);
  const max  = top[0]?.[1] || 1;
  el.innerHTML = top.map(([w, c]) => {
    const size = 12 + Math.round((c / max) * 18);
    return `<span class="word-tag" style="font-size:${size}px" title="${c} occurrences">${w}</span>`;
  }).join('');
}

function wordFrequency() {
  const freq = {};
  entries.forEach(e => {
    if (!e.content) return;
    (e.content.toLowerCase().match(/\b[a-z]{3,}\b/g) || []).forEach(w => {
      if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
  });
  return freq;
}

// ── Patterns ──────────────────────────────────────────────────────────────────
function renderPatterns() {
  const el = document.getElementById('patternsList');
  if (entries.length < 3) {
    el.innerHTML = '<p class="muted" style="font-size:13px">Add at least 3 entries to see patterns.</p>';
    return;
  }
  el.innerHTML = detectPatterns().map(p => `
    <div class="pattern-item">
      <span class="pattern-icon">${p.icon}</span>
      <div class="pattern-text">${p.text}</div>
    </div>`).join('');
}

function detectPatterns() {
  const ps = [];
  const { current, longest } = calcStreaks();

  if (current > 0)
    ps.push({ icon: '🔥', text: `You're on a <strong>${current}-day streak</strong>! Keep it going.` });
  if (longest > current && longest > 1)
    ps.push({ icon: '🏆', text: `Your best streak is <strong>${longest} days</strong>. You can beat it!` });

  // Best writing day
  const dowCounts = new Array(7).fill(0);
  entries.forEach(e => dowCounts[new Date(e.date + 'T00:00:00').getDay()]++);
  const best = dowCounts.indexOf(Math.max(...dowCounts));
  if (dowCounts[best] > 1)
    ps.push({ icon: '📅', text: `You write most on <strong>${DAYS[best]}s</strong> (${dowCounts[best]} entries).` });

  // Quietest day
  const nonZeroMax = Math.max(...dowCounts);
  if (nonZeroMax > 0 && entries.length >= 7) {
    const worst = dowCounts.indexOf(Math.min(...dowCounts));
    if (worst !== best)
      ps.push({ icon: '💡', text: `You tend to skip <strong>${DAYS[worst]}s</strong> — try scheduling 5 minutes then.` });
  }

  // Mood stats
  const moodData = entries.filter(e => e.mood);
  if (moodData.length >= 3) {
    const avg = moodData.reduce((s,e) => s+e.mood, 0) / moodData.length;
    const label = avg >= 4 ? 'positive' : avg >= 3 ? 'neutral' : 'challenging';
    ps.push({ icon: '💭', text: `Average mood: <strong>${avg.toFixed(1)}/5</strong> — overall ${label}.` });

    if (moodData.length >= 14) {
      const recent = moodData.slice(-7).reduce((s,e) => s+e.mood, 0) / 7;
      const older  = moodData.slice(-14,-7).reduce((s,e) => s+e.mood, 0) / 7;
      const diff = recent - older;
      if (Math.abs(diff) >= 0.5)
        ps.push({ icon: diff > 0 ? '📈' : '📉', text: diff > 0
          ? 'Your mood has been <strong>improving</strong> over the last two weeks.'
          : 'Your mood has been <strong>declining</strong> lately — what would help?' });
    }
  }

  // Avg words
  const avgWords = Math.round(entries.reduce((s,e) => s+(e.wordCount||0), 0) / entries.length);
  if (avgWords > 0)
    ps.push({ icon: '✍️', text: `You write an average of <strong>${avgWords} words</strong> per entry.` });

  // Top tags
  const tagFreq = {};
  entries.forEach(e => (e.tags||[]).forEach(t => tagFreq[t] = (tagFreq[t]||0)+1));
  const topTags = Object.entries(tagFreq).sort((a,b)=>b[1]-a[1]).slice(0,3);
  if (topTags.length)
    ps.push({ icon: '🏷️', text: `Top tags: ${topTags.map(([t,c])=>`<strong>#${t}</strong> (${c}x)`).join(', ')}.` });

  // Top words
  const topWords = Object.entries(wordFrequency()).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([w])=>w);
  if (topWords.length)
    ps.push({ icon: '💬', text: `You frequently write about: <strong>${topWords.join(', ')}</strong>.` });

  // Consistency
  const active = new Set(entries.map(e => e.date)).size;
  const first  = entries.length ? new Date(entries[entries.length-1].date + 'T00:00:00') : null;
  if (first) {
    const total = Math.max(1, Math.ceil((Date.now() - first) / 864e5));
    const pct = Math.round((active / total) * 100);
    ps.push({ icon: '📊', text: `Active <strong>${active} of ${total} days</strong> since you started (${pct}% consistency).` });
  }

  // Habit insights
  if (habits.length && entries.some(e => Object.keys(e.habits||{}).length)) {
    const habitTotals = {};
    habits.forEach(h => { habitTotals[h.id] = 0; });
    entries.forEach(e => {
      Object.entries(e.habits||{}).forEach(([id, done]) => {
        if (done && habitTotals[id] !== undefined) habitTotals[id]++;
      });
    });
    const topHabit = Object.entries(habitTotals).sort((a,b)=>b[1]-a[1])[0];
    if (topHabit && topHabit[1] > 0) {
      const h = habits.find(h => h.id === topHabit[0]);
      if (h) ps.push({ icon: h.emoji, text: `Most completed habit: <strong>${h.name}</strong> (${topHabit[1]} times).` });
    }
  }

  return ps;
}

// ── Entry Modal ───────────────────────────────────────────────────────────────
function openEntryModal(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  const dateLabel = fmtDate(entry.date, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const completedHabits = habits.filter(h => entry.habits?.[h.id]);

  const timeLabel = entry.createdAt
    ? new Date(entry.createdAt).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' })
    : '';
  document.getElementById('modalTitle').textContent = timeLabel ? `${dateLabel} · ${timeLabel}` : dateLabel;
  document.getElementById('modalBody').innerHTML = `
    ${entry.image ? `<img src="${entry.image}" style="width:100%;max-height:320px;border-radius:10px;object-fit:cover;margin-bottom:16px;display:block">` : ''}
    ${entry.mood ? `<div class="modal-mood"><strong>Mood:</strong> ${MOOD_LABEL[entry.mood]}</div>` : ''}
    ${entry.content ? `<div class="modal-entry-text">${escHtml(entry.content)}</div>` : ''}
    ${(entry.tags||[]).length ? `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        ${entry.tags.map(t=>`<span class="tag-chip">#${t}</span>`).join('')}
      </div>` : ''}
    ${completedHabits.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Completed Habits</div>
        <div class="modal-habits">${completedHabits.map(h=>`<span class="modal-habit-chip">${h.emoji} ${h.name}</span>`).join('')}</div>
      </div>` : ''}
    <div class="modal-meta">${entry.wordCount || 0} words · ${new Date(entry.createdAt).toLocaleString()}</div>`;

  document.getElementById('modalDeleteBtn').onclick = async () => {
    if (!confirm('Delete this entry permanently?')) return;
    try {
      await api('DELETE', `/api/entries/${id}`);
      entries = entries.filter(e => e.id !== id);
      renderAll();
      closeModal();
      showToast('Entry deleted', 'success');
    } catch (err) {
      showToast('Failed to delete entry: ' + err.message, 'error');
    }
  };

  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('open');
}

// ── Habits Settings ───────────────────────────────────────────────────────────
function renderHabitsList() {
  const el = document.getElementById('habitsList');
  if (!habits.length) {
    el.innerHTML = '<p class="muted" style="font-size:13px;padding:4px 0">No habits yet — add one above.</p>';
    return;
  }
  el.innerHTML = habits.map(h => `
    <div class="habit-item">
      <div class="habit-item-left">
        <div class="habit-color-dot" style="background:${h.color}"></div>
        <span style="font-size:18px">${h.emoji}</span>
        <span style="font-size:14px">${h.name}</span>
      </div>
      <button class="btn btn-danger" style="padding:5px 12px;font-size:12px" onclick="deleteHabit('${h.id}')">Remove</button>
    </div>`).join('');
}

function showAddHabit() {
  document.getElementById('habitModal').classList.add('open');
  setTimeout(() => document.getElementById('habitName').focus(), 50);
}

function closeHabitModal(e) {
  if (e && e.target !== document.getElementById('habitModal')) return;
  document.getElementById('habitModal').classList.remove('open');
  document.getElementById('habitName').value = '';
  document.getElementById('habitEmoji').value = '';
}

async function saveHabit() {
  const name  = document.getElementById('habitName').value.trim();
  const emoji = document.getElementById('habitEmoji').value.trim() || '⭐';
  const color = document.getElementById('habitColor').value;
  if (!name) { showToast('Enter a habit name', 'error'); return; }
  try {
    const saved = await api('POST', '/api/habits', { id: `h-${Date.now()}`, name, emoji, color });
    habits.push(saved);
    closeHabitModal();
    renderHabitsList();
    renderHabitsCheckboxes();
    showToast('Habit added!', 'success');
  } catch (err) {
    showToast('Failed to add habit: ' + err.message, 'error');
  }
}

async function deleteHabit(id) {
  try {
    await api('DELETE', `/api/habits/${id}`);
    habits = habits.filter(h => h.id !== id);
    renderHabitsList();
    renderHabitsCheckboxes();
    showToast('Habit removed', 'success');
  } catch (err) {
    showToast('Failed to remove habit: ' + err.message, 'error');
  }
}

// ── API Key ───────────────────────────────────────────────────────────────────
function saveApiKey() {
  apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showToast('Paste your Claude API key first', 'error'); return; }
  localStorage.setItem('ja_apikey', apiKey);
  document.getElementById('generateInsightsBtn').style.display = '';
  document.getElementById('goInsightsBtn').style.display = '';
  document.getElementById('aiPlaceholder').style.display = 'none';
  showToast('API key saved!', 'success');
}

// ── AI Insights ───────────────────────────────────────────────────────────────
async function generateAiInsights() {
  if (!apiKey && !serverClaudeReady) { showToast('Add your Claude API key in Settings', 'error'); switchTab('settings'); return; }
  if (entries.length < 3) { showToast('Add at least 3 entries first', 'error'); return; }

  if (window.location.protocol === 'file:') {
    document.getElementById('aiInsightsContent').innerHTML = `
      <p style="color:var(--danger);font-size:14px">⚠️ Cannot reach the API from a local file</p>
      <p style="font-size:13px;color:var(--text-muted);margin-top:8px;line-height:1.6">
        Your browser blocks API calls when the app is opened as a <code>file://</code> URL.<br>
        Open the app through a local server instead:
      </p>
      <ul style="font-size:13px;color:var(--text-muted);margin:8px 0 0 18px;line-height:1.8">
        <li><strong>VS Code:</strong> install <em>Live Server</em>, right-click <code>index.html</code> → <em>Open with Live Server</em></li>
        <li><strong>Terminal:</strong> run <code>npx serve .</code> or <code>python -m http.server 8080</code> in this folder, then open <code>http://localhost:8080</code></li>
      </ul>`;
    return;
  }

  try {
    const health = await fetch(`${API_BASE}/api/auth/status`);
    if (!health.ok) {
      throw new Error(`Backend unavailable (HTTP ${health.status})`);
    }
  } catch {
    document.getElementById('aiInsightsContent').innerHTML = `
      <p style="color:var(--danger);font-size:14px">Error: Cannot reach backend API.</p>
      <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Start the server with <strong>npm start</strong>, then try again.</p>
      <button class="btn btn-secondary" style="margin-top:10px" onclick="generateAiInsights()">Try again</button>`;
    return;
  }

  document.getElementById('aiLoading').style.display = '';
  document.getElementById('aiInsightsContent').innerHTML = '';

  const { current, longest } = calcStreaks();
  const topWords = Object.entries(wordFrequency()).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([w,c])=>`${w}(${c})`).join(', ');
  const sample = entries.slice(0, 15).map(e =>
    `[${e.date}] Mood:${e.mood ? MOOD_LABEL[e.mood] : 'N/A'}\n${(e.content||'').substring(0, 400)}`
  ).join('\n---\n');

  const prompt = `You are a thoughtful journal analyst. Here is someone's journal data:

Stats: ${entries.length} total entries, ${current}-day current streak, ${longest}-day best streak.
Top words: ${topWords}

Recent entries:
${sample}

Please provide a warm, specific, and insightful analysis covering:

## Key Themes
What recurring topics, emotions, or concerns appear?

## Mood & Energy Patterns
What patterns do you notice in their emotional state over time?

## Strengths
What positive patterns or habits are evident?

## Gentle Suggestions
2-3 specific, actionable suggestions based on their patterns.

## Journal Prompt
One thoughtful writing prompt tailored to their current themes.

Be concise, warm, and grounded in what they actually wrote — no generic advice.`;

  try {
    const res = await fetch(`${API_BASE}/api/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg  = body.error?.message || `API error ${res.status}`;
      if (res.status === 401) throw new Error('Invalid API key — go to Settings and enter a valid key.');
      if (res.status === 403) throw new Error('Claude access denied for this key/account. Verify your API key permissions.');
      if (res.status === 429) throw new Error('Rate limit reached — wait a moment and try again.');
      if (res.status >= 500) throw new Error('Claude service is temporarily unavailable. Try again in a moment.');
      throw new Error(`${msg} (HTTP ${res.status})`);
    }

    const data = await safeJson(res);
    const text = data.content?.[0]?.text || '';

    document.getElementById('aiLoading').style.display = 'none';
    document.getElementById('aiInsightsContent').innerHTML = `
      <div class="ai-insights-content">${renderMarkdown(text)}</div>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn btn-secondary" onclick="generateAiInsights()">🔄 Regenerate</button>
      </div>`;
  } catch (err) {
    console.error('[AI Insights]', err);
    document.getElementById('aiLoading').style.display = 'none';
    const isNetworkErr = err instanceof TypeError;
    const msg = isNetworkErr
      ? `Cannot reach the proxy server — run <code>npm start</code> in the AI Recovery Tracker folder, then try again.`
      : err.message;
    document.getElementById('aiInsightsContent').innerHTML = `
      <p style="color:var(--danger);font-size:14px">Error: ${escHtml(msg)}</p>
      <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Go to <strong>Settings</strong> to update your Claude API key.</p>
      <button class="btn btn-secondary" style="margin-top:10px" onclick="generateAiInsights()">Try again</button>
      <button class="btn btn-secondary" style="margin-top:10px" onclick="switchTab('settings')">Open Settings</button>`;
  }
}

// ── File Import ───────────────────────────────────────────────────────────────
function setupFileUpload() {
  const zone  = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); input.value = ''; });
}

function handleFile(file) {
  const reader = new FileReader();
  if (/^image\//i.test(file.type) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name)) {
    reader.onload = e => importImage(e.target.result);
    reader.readAsDataURL(file);
  } else {
    reader.onload = async e => {
      if (file.name.endsWith('.json')) await importJSON(e.target.result);
      else if (file.name.endsWith('.csv')) await importCSV(e.target.result);
      else await importTXT(e.target.result, file.name);
    };
    reader.readAsText(file);
  }
}

async function importImage(dataUrl) {
  const entry = {
    id: `img-${Date.now()}`,
    date: dateStr(new Date()),
    content: '',
    image: dataUrl,
    mood: null,
    tags: [],
    habits: {},
    wordCount: 0,
    createdAt: Date.now(),
  };
  try {
    const saved = await api('POST', '/api/entries', entry);
    entries.unshift(saved);
    renderAll();
    showToast('Photo saved! 📷', 'success');
  } catch (err) {
    showToast('Failed to save photo: ' + err.message, 'error');
  }
}

async function importJSON(text) {
  try {
    const data = JSON.parse(text);
    const incoming = data.entries || (Array.isArray(data) ? data : []);
    const existingIds = new Set(entries.map(e => e.id));
    const toAdd = incoming.filter(e => e.date && !existingIds.has(e.id));
    const saved = await Promise.all(toAdd.map(e => api('POST', '/api/entries', e)));
    entries.unshift(...saved);
    entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (data.habits && !habits.length) {
      habits = await Promise.all(data.habits.map(h => api('POST', '/api/habits', h)));
    }
    renderAll();
    showToast(`Imported ${saved.length} entries`, 'success');
  } catch {
    showToast('Invalid JSON file', 'error');
  }
}

async function importCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const start = lines[0]?.toLowerCase().includes('date') ? 1 : 0;
  const toAdd = []; let skipped = 0;

  for (let i = start; i < lines.length; i++) {
    const cols    = parseCSVRow(lines[i]);
    const rawDate = cols[0]?.trim();
    const date    = normalizeDate(rawDate);
    if (!date) { skipped++; continue; }
    const content = cols[1]?.trim() || '';
    const mood    = parseInt(cols[2]?.trim());
    toAdd.push({
      id: `import-${Date.now()}-${i}`,
      date, content,
      mood: (mood >= 1 && mood <= 5) ? mood : null,
      tags: [], habits: {},
      wordCount: countWords(content),
      createdAt: Date.now(),
    });
  }
  try {
    const saved = await Promise.all(toAdd.map(e => api('POST', '/api/entries', e)));
    entries.unshift(...saved);
    entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderAll();
    showToast(`Imported ${saved.length} entries${skipped ? `, ${skipped} skipped` : ''}`, 'success');
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  }
}

async function importTXT(text, filename) {
  const entry = {
    id: `txt-${Date.now()}`,
    date: normalizeDate(filename.replace(/\.[^.]+$/, '')) || dateStr(new Date()),
    content: text.trim(),
    mood: null, tags: [], habits: {},
    wordCount: countWords(text), createdAt: Date.now(),
  };
  try {
    const saved = await api('POST', '/api/entries', entry);
    entries.unshift(saved);
    entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderAll();
    showToast(`Imported entry (${entry.date})`, 'success');
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  }
}

function parseCSVRow(line) {
  const cols = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  return cols;
}

function normalizeDate(s) {
  if (!s) return null;
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d)) return dateStr(d);
  return null;
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify({ entries, habits, exportedAt: new Date().toISOString() }, null, 2)],
    { type: 'application/json' });
  downloadBlob(blob, `journal-export-${dateStr(new Date())}.json`);
  showToast('Exported!', 'success');
}

function exportCSV() {
  const rows = [['date','mood','wordCount','content','tags']];
  entries.forEach(e => rows.push([
    e.date,
    e.mood || '',
    e.wordCount || 0,
    `"${(e.content||'').replace(/"/g,'""')}"`,
    (e.tags||[]).join(';'),
  ]));
  const blob = new Blob([rows.map(r=>r.join(',')).join('\n')], { type: 'text/csv' });
  downloadBlob(blob, `journal-export-${dateStr(new Date())}.csv`);
  showToast('CSV exported!', 'success');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAllData() {
  if (!confirm('Delete ALL entries and habits permanently? This cannot be undone.')) return;
  try {
    await Promise.all([api('DELETE', '/api/entries'), api('DELETE', '/api/habits')]);
    entries = []; habits = [];
    renderAll();
    showToast('All data cleared', 'success');
  } catch (err) {
    showToast('Failed to clear data: ' + err.message, 'error');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Habits Tracker ────────────────────────────────────────────────────────────
function renderHabitsTab() {
  const el = document.getElementById('habitsTrackerContent');
  if (!el) return;

  if (!habits.length) {
    el.innerHTML = `<div class="empty-state" style="margin-top:60px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">🎯</div>
      <p style="color:var(--text-muted);margin-bottom:16px">No habits yet. Add some in Settings.</p>
      <button class="btn btn-primary" onclick="switchTab('settings')">Go to Settings</button>
    </div>`;
    return;
  }

  // Build completion map: habitId → Set of date strings where it was completed
  const done = {};
  habits.forEach(h => { done[h.id] = new Set(); });
  entries.forEach(e => {
    if (!e.habits) return;
    for (const [hid, checked] of Object.entries(e.habits)) {
      if (checked && done[hid] !== undefined) done[hid].add(e.date);
    }
  });

  const today = dateStr(new Date());
  const todayHabits = entries.find(e => e.date === today)?.habits || {};

  // Last 30 days oldest→newest
  const days = Array.from({ length: 30 }, (_, i) => {
    return dateStr(new Date(Date.now() - (29 - i) * 864e5));
  });

  const calcStreak = (habitId) => {
    let n = 0;
    let d = new Date();
    while (done[habitId].has(dateStr(d))) { n++; d = new Date(d - 864e5); }
    return n;
  };

  const DAY1 = ['S','M','T','W','T','F','S'];

  const headerCols = days.map(d => {
    const isToday = d === today;
    const dow = new Date(d + 'T00:00:00').getDay();
    return `<div class="ht-cell ht-head${isToday ? ' ht-today-col' : ''}">${isToday ? '●' : DAY1[dow]}</div>`;
  }).join('');

  const rows = habits.map(h => {
    const streak = calcStreak(h.id);
    const dots = days.map(d => {
      const isToday = d === today;
      const isChecked = isToday ? (todayHabits[h.id] === true) : done[h.id].has(d);
      if (isToday) {
        return `<div class="ht-cell ht-today-col">
          <input type="checkbox" class="ht-cb" data-habit="${h.id}" ${isChecked ? 'checked' : ''}
            onchange="toggleTodayHabit('${h.id}', this.checked)"
            title="Toggle ${escHtml(h.name)} for today">
        </div>`;
      }
      return `<div class="ht-cell${isChecked ? ' ht-done' : ''}"
        style="${isChecked ? `background:${h.color};border-color:${h.color}` : ''}"
        title="${d}"></div>`;
    }).join('');

    return `<div class="ht-row">
      <div class="ht-label">
        <span class="ht-emoji">${h.emoji}</span>
        <span class="ht-name">${escHtml(h.name)}</span>
      </div>
      <div class="ht-streak">
        ${streak > 0
          ? `<span class="ht-streak-badge" style="background:${h.color}20;color:${h.color};border:1px solid ${h.color}40">🔥 ${streak}</span>`
          : `<span class="ht-streak-zero">—</span>`}
      </div>
      <div class="ht-grid">${dots}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="ht-wrap">
      <div class="ht-row ht-header-row">
        <div class="ht-label" style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Habit</div>
        <div class="ht-streak" style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Streak</div>
        <div class="ht-grid">${headerCols}</div>
      </div>
      ${rows}
      <p class="ht-hint">Click ● (today's column) to mark a habit complete. Past days update when you save a journal entry.</p>
    </div>`;
}

async function toggleTodayHabit(habitId, checked) {
  const today = dateStr(new Date());
  const existing = entries.find(e => e.date === today);
  const updatedHabits = { ...(existing?.habits || {}) };
  updatedHabits[habitId] = checked;

  const entry = existing
    ? { ...existing, habits: updatedHabits }
    : {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: today, content: '', mood: null, tags: [],
        habits: updatedHabits, wordCount: 0, createdAt: Date.now(),
      };

  try {
    const saved = await api('POST', '/api/entries', entry);
    if (existing) {
      entries = entries.map(e => e.id === existing.id ? saved : e);
    } else {
      entries.unshift(saved);
    }
    renderHabitsTab();
  } catch (err) {
    showToast('Failed to save habit: ' + err.message, 'error');
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────────
async function loadCalendarEvents() {
  try {
    calEvents = await api('GET', '/api/calendar-events');
  } catch {
    calEvents = [];
  }
  renderCalendar();
}

function renderCalendar() {
  const firstDay   = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr   = dateStr(new Date());

  const monthLabel = new Date(calYear, calMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('calMonthLabel').textContent = monthLabel;

  const entryDates = new Set(entries.map(e => e.date));

  const eventsByDate = {};
  calEvents.forEach(ev => {
    if (!ev.startTime || ev.title.startsWith('📓')) return; // journal dots shown separately
    const local = new Date(ev.startTime);
    const d = `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
    (eventsByDate[d] = eventsByDate[d] || []).push(ev);
  });

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const d   = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const evs = eventsByDate[d] || [];
    const hasEntry = entryDates.has(d);
    html += `
      <div class="cal-cell${d === todayStr ? ' today' : ''}" onclick="calDayClick('${d}')">
        <div class="cal-day-num">${day}</div>
        ${hasEntry ? '<div class="cal-journal-dot" title="Journal entry">📓</div>' : ''}
        ${evs.slice(0, 3).map(ev => `
          <div class="cal-event-bar" style="background:${ev.color}"
               onclick="event.stopPropagation();openEventModal(${JSON.stringify(ev).replace(/"/g,'&quot;')})">
            ${escHtml(ev.title)}
          </div>`).join('')}
        ${evs.length > 3 ? `<div class="cal-more">+${evs.length - 3} more</div>` : ''}
      </div>`;
  }

  document.getElementById('calGrid').innerHTML = html;
}

function calDayClick(d) {
  selectedCalDate = d;
  const parsed = new Date(d + 'T00:00:00');
  const label  = parsed.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  document.getElementById('dayOptionsTitle').textContent = label;
  document.getElementById('dayOptionsModal').classList.add('open');
  renderDayPreview(d);
}

async function renderDayPreview(d) {
  const preview = document.getElementById('dayJournalPreview');
  preview.innerHTML = '';

  // Re-fetch entries if array looks stale (entries loaded before new ones were added server-side)
  let pool = entries;
  if (!pool.some(e => e.date === d)) {
    try {
      const fresh = await api('GET', '/api/entries');
      if (fresh.length > entries.length) { entries = fresh; pool = entries; renderCalendar(); }
    } catch { /* use existing */ }
  }

  let html = '';

  // Calendar events for this day (exclude 📓 journal sync events)
  const dayEvents = calEvents.filter(ev => {
    if (!ev.startTime || ev.title.startsWith('📓')) return false;
    const local = new Date(ev.startTime);
    const evDate = `${local.getFullYear()}-${String(local.getMonth()+1).padStart(2,'0')}-${String(local.getDate()).padStart(2,'0')}`;
    return evDate === d;
  });

  if (dayEvents.length) {
    html += `<div style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Events</div>
      ${dayEvents.map(ev => {
        const timePart = ev.allDay
          ? 'All day'
          : new Date(ev.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `<div class="day-entry-preview" onclick="openEventModal(${JSON.stringify(ev).replace(/"/g,'&quot;')});closeDayOptions()">
          <span style="width:10px;height:10px;border-radius:50%;background:${ev.color || '#3b82f6'};flex-shrink:0;display:inline-block;margin-top:3px"></span>
          <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">${timePart}</span>
          <span>${escHtml(ev.title)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Journal entries for this day
  const dayEntries = pool.filter(e => e.date === d);
  if (dayEntries.length) {
    html += `<div style="margin-bottom:4px">
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Journal</div>
      ${dayEntries.map(e => `
        <div class="day-entry-preview" onclick="openEntryModal('${e.id}');closeDayOptions()">
          <span style="font-size:16px">${MOOD_EMOJI[e.mood] || '📓'}</span>
          <span>${escHtml((e.content || '').substring(0, 90))}${(e.content||'').length > 90 ? '…' : ''}</span>
        </div>`).join('')}
    </div>`;
  }

  if (!dayEvents.length && !dayEntries.length) {
    html = '<p class="muted" style="font-size:13px;margin-bottom:4px">No entries or events for this day.</p>';
  }

  preview.innerHTML = html;
}

function closeDayOptions(e) {
  if (e && e.target !== document.getElementById('dayOptionsModal')) return;
  document.getElementById('dayOptionsModal').classList.remove('open');
}

function addEntryForDate() {
  closeDayOptions();
  switchTab('add');
  const di = document.getElementById('entryDate');
  if (di && selectedCalDate) { di.value = selectedCalDate; }
}

function addEventForDate() {
  closeDayOptions();
  openEventModal(null, selectedCalDate);
}

function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }
function calToday() { calYear = new Date().getFullYear(); calMonth = new Date().getMonth(); renderCalendar(); }

function openEventModal(ev, prefillDate) {
  editingEventId = null;
  selectedEventColor = '#3b82f6';

  document.getElementById('eventModalTitle').textContent = ev ? 'Edit Event' : 'New Event';
  document.getElementById('evTitle').value      = ev ? ev.title : '';
  document.getElementById('evDesc').value       = ev ? (ev.description || '') : '';
  document.getElementById('evAllDay').checked   = ev ? ev.allDay : false;
  document.getElementById('evDeleteBtn').style.display = ev ? '' : 'none';

  const base = prefillDate || dateStr(new Date());
  const startDT = ev ? toLocalDT(ev.startTime) : base + 'T09:00';
  const endDT   = ev ? toLocalDT(ev.endTime)   : base + 'T10:00';
  document.getElementById('evStart').value = startDT;
  document.getElementById('evEnd').value   = endDT;

  if (ev) { editingEventId = ev.id; selectedEventColor = ev.color || '#3b82f6'; }
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === selectedEventColor);
  });

  toggleAllDay();
  document.getElementById('eventModal').classList.add('open');
  setTimeout(() => document.getElementById('evTitle').focus(), 50);
}

function closeEventModal(e) {
  if (e && e.target !== document.getElementById('eventModal')) return;
  document.getElementById('eventModal').classList.remove('open');
}

function pickColor(el) {
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  selectedEventColor = el.dataset.color;
}

function toggleAllDay() {
  const allDay = document.getElementById('evAllDay').checked;
  document.getElementById('evStart').type = allDay ? 'date' : 'datetime-local';
  document.getElementById('evEnd').type   = allDay ? 'date' : 'datetime-local';
}

async function saveEvent() {
  const title = document.getElementById('evTitle').value.trim();
  if (!title) { showToast('Event title is required', 'error'); return; }
  const allDay = document.getElementById('evAllDay').checked;
  const startRaw = document.getElementById('evStart').value;
  const endRaw   = document.getElementById('evEnd').value;
  const startTime = allDay ? startRaw + 'T00:00:00' : startRaw + ':00';
  const endTime   = allDay ? (endRaw   + 'T23:59:59') : (endRaw + ':00');

  const body = {
    title,
    description: document.getElementById('evDesc').value.trim() || null,
    startTime, endTime, allDay,
    color: selectedEventColor,
  };

  try {
    if (editingEventId) {
      const updated = await api('PUT', `/api/calendar-events/${editingEventId}`, body);
      calEvents = calEvents.map(e => e.id === editingEventId ? updated : e);
      showToast('Event updated', 'success');
    } else {
      const created = await api('POST', '/api/calendar-events', body);
      calEvents.push(created);
      showToast('Event created!', 'success');
    }
    closeEventModal();
    renderCalendar();
    renderDashCalPreview();
  } catch (err) {
    showToast('Failed to save event: ' + err.message, 'error');
  }
}

async function deleteEvent() {
  if (!editingEventId || !confirm('Delete this event?')) return;
  try {
    await api('DELETE', `/api/calendar-events/${editingEventId}`);
    calEvents = calEvents.filter(e => e.id !== editingEventId);
    closeEventModal();
    renderCalendar();
    renderDashCalPreview();
    showToast('Event deleted', 'success');
  } catch (err) {
    showToast('Failed to delete event', 'error');
  }
}

function toLocalDT(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Files ─────────────────────────────────────────────────────────────────────
async function loadFiles(folderId) {
  currentFolderId = folderId ?? null;
  try {
    const [folders, files] = await Promise.all([
      api('GET', `/api/folders${folderId ? `?parentId=${folderId}` : ''}`),
      api('GET', `/api/files${folderId    ? `?folderId=${folderId}` : ''}`),
    ]);
    renderFiles(folders, files);
  } catch (err) {
    showToast('Failed to load files: ' + err.message, 'error');
  }
}

function renderFiles(folders, files) {
  const crumb = document.getElementById('filesBreadcrumb');
  crumb.innerHTML = `<span class="crumb${currentFolderId === null ? ' active' : ''}"
    onclick="navToFolder(null)">🏠 Home</span>` +
    folderStack.map((f, i) => `
      <span class="crumb-sep">›</span>
      <span class="crumb${i === folderStack.length - 1 ? ' active' : ''}"
        onclick="navToFolder(${f.id}, ${i})">${escHtml(f.name)}</span>`).join('');

  const grid = document.getElementById('filesGrid');
  if (!folders.length && !files.length) {
    grid.innerHTML = '<div class="files-empty">📂 This folder is empty</div>'; return;
  }

  grid.innerHTML =
    folders.map(f => `
      <div class="file-card folder" onclick="navToFolder(${f.id}, -1, '${escHtml(f.name)}')">
        <div class="file-icon">📁</div>
        <div class="file-name">${escHtml(f.name)}</div>
        <button class="file-del" onclick="event.stopPropagation();deleteFolder(${f.id})" title="Delete">✕</button>
      </div>`).join('') +
    files.map(f => `
      <div class="file-card" onclick="downloadFile(${f.id})">
        <div class="file-icon">${fileIcon(f.mimeType)}</div>
        <div class="file-name">${escHtml(f.originalName)}</div>
        <div class="file-size">${fmtSize(f.size)}</div>
        <button class="file-del" onclick="event.stopPropagation();deleteFile(${f.id})" title="Delete">✕</button>
      </div>`).join('');
}

function navToFolder(id, stackIdx, name) {
  if (id === null) { folderStack = []; }
  else if (stackIdx === -1) { folderStack.push({ id, name }); }
  else { folderStack = folderStack.slice(0, stackIdx + 1); }
  loadFiles(id);
}

function showNewFolder() {
  document.getElementById('folderName').value = '';
  document.getElementById('folderModal').classList.add('open');
  setTimeout(() => document.getElementById('folderName').focus(), 50);
}
function closeFolderModal(e) {
  if (e && e.target !== document.getElementById('folderModal')) return;
  document.getElementById('folderModal').classList.remove('open');
}
async function createFolder() {
  const name = document.getElementById('folderName').value.trim();
  if (!name) { showToast('Enter a folder name', 'error'); return; }
  try {
    await api('POST', '/api/folders', { name, parentId: currentFolderId });
    closeFolderModal();
    loadFiles(currentFolderId);
    showToast('Folder created!', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}
async function deleteFolder(id) {
  if (!confirm('Delete this folder and all its contents?')) return;
  try {
    await api('DELETE', `/api/folders/${id}`);
    loadFiles(currentFolderId);
    showToast('Folder deleted', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function uploadFiles(input) {
  const fileList = [...input.files];
  if (!fileList.length) return;
  showToast(`Uploading ${fileList.length} file(s)…`, '');
  const uploadHeaders = {};
  if (authToken) uploadHeaders['Authorization'] = `Bearer ${authToken}`;
  for (const file of fileList) {
    const fd = new FormData();
    fd.append('file', file);
    if (currentFolderId) fd.append('folderId', currentFolderId);
    const res = await fetch(`${API_BASE}/api/files`, { method: 'POST', body: fd, headers: uploadHeaders });
    if (!res.ok) { showToast('Upload failed: ' + file.name, 'error'); return; }
  }
  input.value = '';
  loadFiles(currentFolderId);
  showToast(`Uploaded ${fileList.length} file(s)!`, 'success');
}

function downloadFile(id) {
  window.open(`${API_BASE}/api/files/${id}/download`, '_blank');
}

// ── Journal → Calendar sync ───────────────────────────────────────────────────
async function syncJournalToCalendar() {
  const btn = document.getElementById('syncCalBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const result = await api('POST', '/api/entries/sync-calendar');
    showToast(`✅ Synced! ${result.created} created, ${result.updated} updated`, 'success');
    if (document.getElementById('tab-calendar').classList.contains('active')) {
      loadCalendarEvents();
    }
  } catch (err) {
    showToast('Sync failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📅 Sync Journal → Calendar'; }
  }
}

async function deleteFile(id) {
  if (!confirm('Delete this file permanently?')) return;
  try {
    await api('DELETE', `/api/files/${id}`);
    loadFiles(currentFolderId);
    showToast('File deleted', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/'))  return '🖼️';
  if (mime.startsWith('video/'))  return '🎬';
  if (mime.startsWith('audio/'))  return '🎵';
  if (mime.includes('pdf'))       return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('7z')) return '🗜️';
  if (mime.includes('python') || mime.includes('javascript') || mime.includes('text/x-')) return '💻';
  return '📄';
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3)   return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(ds, opts) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', opts);
}

function weekStart(d) {
  const s = new Date(d); s.setDate(d.getDate() - d.getDay()); return dateStr(s);
}

function monthKey(d) { return `${d.getFullYear()}-${d.getMonth()}`; }

function countWords(t) {
  return t ? (t.trim().match(/\S+/g) || []).length : 0;
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function emptyState(icon, title, sub) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-sub">${sub}</div>
  </div>`;
}


function renderMarkdown(text) {
  // First, escape the text to prevent XSS, then apply markdown safely
  text = escHtml(text);
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^## (.+)$/gm, '<h4 style="margin:16px 0 8px;font-size:14px;font-weight:700">$1</h4>')
    .replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 6px;font-size:13px;font-weight:700">$1</h4>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0 4px 18px">$1</li>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

// ── Program Selector ──────────────────────────────────────────────────────────
const PROGRAM_CONFIG = {
  NA:    { line1: 'NA Recovery',     line2: 'Tracker',  emoji: '💙' },
  AA:    { line1: 'AA Recovery',     line2: 'Tracker',  emoji: '🔵' },
  CA:    { line1: 'CA Recovery',     line2: 'Tracker',  emoji: '⚪' },
  SA:    { line1: 'SA Recovery',     line2: 'Tracker',  emoji: '🟣' },
  GA:    { line1: 'GA Recovery',     line2: 'Tracker',  emoji: '🟡' },
  SMART: { line1: 'SMART',           line2: 'Recovery', emoji: '🟢' },
  OTHER: { line1: 'AI Recovery',     line2: 'Tracker',  emoji: '📓' },
};

function applyProgram(code) {
  naProgram = code || 'NA';
  const cfg = PROGRAM_CONFIG[naProgram] || PROGRAM_CONFIG.OTHER;
  const l1 = document.getElementById('sidebarLine1');
  const l2 = document.getElementById('sidebarLine2');
  const sel = document.getElementById('programSelect');
  if (l1) l1.textContent = cfg.line1;
  if (l2) l2.textContent = cfg.line2;
  if (sel) sel.value = naProgram;
}

async function setProgram(code) {
  naProgram = code;
  applyProgram(code);
  try {
    await api('PUT', '/api/na/settings', { program: code });
    showToast(`Program set to ${code}`, 'success');
  } catch { /* non-critical */ }
}

// ── Profile Picture ───────────────────────────────────────────────────────────
function renderAvatarSidebar() {
  const emoji = document.getElementById('avatarEmoji');
  const img   = document.getElementById('avatarImg');
  if (!emoji || !img) return;
  if (avatarUrl) {
    img.src = avatarUrl + '?t=' + Date.now();
    img.style.display = '';
    emoji.style.display = 'none';
  } else {
    img.style.display = 'none';
    emoji.style.display = '';
  }
}

function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const res = await api('POST', '/api/profile/picture', { image: e.target.result });
      avatarUrl = res.url;
      renderAvatarSidebar();
      showToast('Profile picture updated!', 'success');
    } catch (err) { showToast('Upload failed: ' + err.message, 'error'); }
    input.value = '';
  };
  reader.readAsDataURL(file);
}

// ── Quit Habits ───────────────────────────────────────────────────────────────
const QH_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];

function qhDaysClean(qh) {
  if (!qh.quit_date) return null;
  const start = new Date(qh.quit_date + 'T00:00:00');
  return Math.floor((Date.now() - start) / 864e5);
}

function renderQuitHabits() {
  const el = document.getElementById('quitHabitsList');
  if (!el) return;
  if (!quitHabits.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:10px 0">No quit habits tracked yet. Add one above.</p>';
    return;
  }
  el.innerHTML = quitHabits.map(qh => {
    const days = qhDaysClean(qh);
    const label = days === null ? 'No date set' : days === 0 ? 'Day 1 — You got this!' :
      days === 1 ? '1 day clean' : `${days.toLocaleString()} days clean`;
    const pct = days ? Math.min(100, Math.round((days / 365) * 100)) : 0;
    return `
      <div class="qh-card" style="border-left-color:${qh.color}">
        <div class="qh-top">
          <div>
            <div class="qh-name">${escHtml(qh.name)}</div>
            <div class="qh-streak" style="color:${qh.color}">${label}</div>
          </div>
          <button class="qh-edit-btn" onclick="openQuitHabitModal('${qh.id}')" title="Edit">✏️</button>
        </div>
        ${days !== null ? `
        <div class="qh-bar-wrap">
          <div class="qh-bar-fill" style="width:${pct}%;background:${qh.color}"></div>
        </div>
        <div class="qh-bar-label">${pct}% of first year</div>` : ''}
        ${qh.notes ? `<div class="qh-notes">${escHtml(qh.notes)}</div>` : ''}
      </div>`;
  }).join('');
}

function openQuitHabitModal(id) {
  editingQhId = id || null;
  const qh = id ? quitHabits.find(q => q.id === id) : null;
  document.getElementById('quitHabitModalTitle').textContent = qh ? 'Edit Quit Habit' : 'Track a Quit Habit';
  document.getElementById('qhName').value  = qh?.name || '';
  document.getElementById('qhDate').value  = qh?.quit_date || new Date().toISOString().split('T')[0];
  document.getElementById('qhNotes').value = qh?.notes || '';
  selectedQhColor = qh?.color || '#ef4444';
  document.getElementById('qhDeleteBtn').style.display = qh ? '' : 'none';
  document.querySelectorAll('#qhColorSwatches .color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === selectedQhColor);
  });
  document.getElementById('quitHabitModal').classList.add('open');
  setTimeout(() => document.getElementById('qhName').focus(), 50);
}

function closeQuitHabitModal(e) {
  if (e && e.target !== document.getElementById('quitHabitModal')) return;
  document.getElementById('quitHabitModal').classList.remove('open');
}

async function saveQuitHabit() {
  const name = document.getElementById('qhName').value.trim();
  if (!name) { showToast('Name is required', 'error'); return; }
  const body = {
    name,
    quit_date: document.getElementById('qhDate').value || null,
    color:     selectedQhColor,
    notes:     document.getElementById('qhNotes').value.trim() || null,
  };
  try {
    if (editingQhId) {
      const updated = await api('PUT', `/api/quit-habits/${editingQhId}`, body);
      quitHabits = quitHabits.map(q => q.id === editingQhId ? updated : q);
    } else {
      body.id = `qh-${Date.now()}`;
      const created = await api('POST', '/api/quit-habits', body);
      quitHabits.push(created);
    }
    closeQuitHabitModal();
    renderQuitHabits();
    showToast('Saved!', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function deleteQuitHabit() {
  if (!editingQhId || !confirm('Remove this quit habit?')) return;
  await api('DELETE', `/api/quit-habits/${editingQhId}`);
  quitHabits = quitHabits.filter(q => q.id !== editingQhId);
  closeQuitHabitModal();
  renderQuitHabits();
  showToast('Removed', 'success');
}

// ── Sponsee Tracking ──────────────────────────────────────────────────────────
function renderSponsees() {
  const el = document.getElementById('sponseesList');
  if (!el) return;
  if (!naSponsees.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--text-muted);text-align:center;padding:10px 0">No sponsees added yet.</p>';
    return;
  }
  el.innerHTML = naSponsees.map(s => {
    const stepLabel = s.step === 0 ? 'Not started' : s.step === 12 ? 'Step 12 ✅' : `Step ${s.step}`;
    const pct = Math.round((s.step / 12) * 100);
    return `
      <div class="sponsee-card">
        <div class="sponsee-top">
          <div class="sponsee-avatar">${s.name.charAt(0).toUpperCase()}</div>
          <div class="sponsee-info">
            <div class="sponsee-name">${escHtml(s.name)}</div>
            <div class="sponsee-meta">
              ${s.phone ? `<a href="tel:${escHtml(s.phone)}" class="sponsee-phone">📞 ${escHtml(s.phone)}</a>` : ''}
              <span class="sponsee-step-badge">${stepLabel}</span>
            </div>
          </div>
          <button class="sponsee-edit-btn" onclick="openSponseeModal('${s.id}')" title="Edit">✏️</button>
        </div>
        ${s.step > 0 ? `
        <div class="sponsee-bar-wrap">
          <div class="sponsee-bar-fill" style="width:${pct}%"></div>
        </div>` : ''}
        ${s.notes ? `<div class="sponsee-notes">${escHtml(s.notes)}</div>` : ''}
      </div>`;
  }).join('');
}

function openSponseeModal(id) {
  editingSponseeId = id || null;
  const s = id ? naSponsees.find(x => x.id === id) : null;
  document.getElementById('sponseeModalTitle').textContent = s ? 'Edit Sponsee' : 'Add Sponsee';
  document.getElementById('sponName').value  = s?.name  || '';
  document.getElementById('sponPhone').value = s?.phone || '';
  document.getElementById('sponStep').value  = s?.step  ?? 0;
  document.getElementById('sponNotes').value = s?.notes || '';
  document.getElementById('sponDeleteBtn').style.display = s ? '' : 'none';
  document.getElementById('sponseeModal').classList.add('open');
  setTimeout(() => document.getElementById('sponName').focus(), 50);
}

function closeSponseeModal(e) {
  if (e && e.target !== document.getElementById('sponseeModal')) return;
  document.getElementById('sponseeModal').classList.remove('open');
}

async function saveSponsee() {
  const name = document.getElementById('sponName').value.trim();
  if (!name) { showToast('Name is required', 'error'); return; }
  const body = {
    name,
    phone: document.getElementById('sponPhone').value.trim() || null,
    step:  parseInt(document.getElementById('sponStep').value) || 0,
    notes: document.getElementById('sponNotes').value.trim() || null,
  };
  try {
    if (editingSponseeId) {
      const updated = await api('PUT', `/api/na/sponsees/${editingSponseeId}`, body);
      naSponsees = naSponsees.map(s => s.id === editingSponseeId ? updated : s);
    } else {
      body.id = `spon-${Date.now()}`;
      const created = await api('POST', '/api/na/sponsees', body);
      naSponsees.push(created);
    }
    closeSponseeModal();
    renderSponsees();
    showToast('Saved!', 'success');
  } catch (err) { showToast('Failed: ' + err.message, 'error'); }
}

async function deleteSponsee() {
  if (!editingSponseeId || !confirm('Remove this sponsee?')) return;
  await api('DELETE', `/api/na/sponsees/${editingSponseeId}`);
  naSponsees = naSponsees.filter(s => s.id !== editingSponseeId);
  closeSponseeModal();
  renderSponsees();
  showToast('Removed', 'success');
}

function pickQhColor(el) {
  document.querySelectorAll('#qhColorSwatches .color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  selectedQhColor = el.dataset.color;
}
