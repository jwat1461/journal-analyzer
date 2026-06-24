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

// Files state
let currentFolderId = null;
let folderStack     = [];

const API_BASE = (() => {
  const override = localStorage.getItem('ja_api_base')?.trim();
  if (override) return override.replace(/\/+$/, '');
  if (window.location.protocol === 'file:') return 'http://localhost:5500';
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
    [entries, habits] = await Promise.all([
      api('GET', '/api/entries'),
      api('GET', '/api/habits'),
    ]);
  } catch {
    showToast('Cannot reach server — run: node server.js', 'error');
    entries = []; habits = [];
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
  if (tab === 'files')    loadFiles();
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function setupTheme() {
  const saved = localStorage.getItem('ja_theme') || 'dark';
  applyTheme(saved);

  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('ja_theme', next);
    setTimeout(renderCharts, 80);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}

// ── Stats ─────────────────────────────────────────────────────────────────────
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
      ? `Cannot reach the proxy server — run <code>npm start</code> in the Journal Analyzer folder, then try again.`
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
    if (!ev.startTime) return;
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

  const dayEntries = entries.filter(e => e.date === d);
  const preview = document.getElementById('dayJournalPreview');
  if (dayEntries.length) {
    preview.innerHTML = dayEntries.map(e => `
      <div class="day-entry-preview" onclick="openEntryModal('${e.id}');closeDayOptions()">
        <span style="font-size:16px">${MOOD_EMOJI[e.mood] || '📓'}</span>
        <span>${escHtml((e.content || '').substring(0, 90))}${(e.content||'').length > 90 ? '…' : ''}</span>
      </div>`).join('');
  } else {
    preview.innerHTML = '<p class="muted" style="font-size:13px;margin-bottom:4px">No journal entry for this day.</p>';
  }

  document.getElementById('dayOptionsModal').classList.add('open');
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
function dateStr(d) { return d.toISOString().split('T')[0]; }

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
