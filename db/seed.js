/**
 * Seed script — populates all tabs with realistic test data.
 * Run:  node db/seed.js
 */
require('dotenv').config();

const BASE = `http://localhost:${process.env.PORT || 5500}`;
const H = { 'Content-Type': 'application/json' };

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text(); throw new Error(`POST ${path} → ${r.status}: ${t}`); }
  return r.json();
}
async function del(path) {
  const r = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: H });
  return r.json();
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  return r.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysFrom(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function dt(dateStr, time) { return `${dateStr}T${time}:00`; }
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function shuffle(arr) { return arr.sort(() => Math.random() - 0.5); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── 1. Clear existing entries & events ────────────────────────────────────────
async function clearExisting() {
  console.log('Clearing existing entries and calendar events...');
  const entries = await get('/api/entries');
  for (const e of entries) await del(`/api/entries/${e.id}`);
  const events = await get('/api/calendar-events');
  for (const e of events) await del(`/api/calendar-events/${e.id}`);
  console.log(`  Deleted ${entries.length} entries, ${events.length} events`);
}

// ── 2. Ensure habits exist ────────────────────────────────────────────────────
async function seedHabits() {
  console.log('Seeding habits...');
  const existing = await get('/api/habits');
  const ids = new Set(existing.map(h => h.id));
  const defaults = [
    { id: 'h1', name: 'Exercise',   emoji: '🏃', color: '#22c55e' },
    { id: 'h2', name: 'Meditation', emoji: '🧘', color: '#6366f1' },
    { id: 'h3', name: 'Reading',    emoji: '📚', color: '#f59e0b' },
    { id: 'h4', name: 'Water',      emoji: '💧', color: '#38bdf8' },
  ];
  for (const h of defaults) {
    if (!ids.has(h.id)) {
      await post('/api/habits', h);
      console.log(`  + habit: ${h.emoji} ${h.name}`);
    } else {
      console.log(`  ~ habit exists: ${h.name}`);
    }
  }
}

// ── 3. Journal entries — 90 days of history ───────────────────────────────────
async function seedEntries() {
  console.log('Seeding journal entries...');

  const MOODS    = [1, 2, 3, 4, 5];
  const TAG_POOL = ['work', 'personal', 'health', 'creative', 'gratitude',
                    'goals', 'social', 'travel', 'learning', 'mindfulness'];

  // Varied realistic journal content by mood
  const CONTENT = {
    5: [
      "Today was genuinely great. Crushed my morning workout, had a productive deep-work session, and connected with an old friend over dinner. Feeling energized and grateful. The project milestone we hit at work felt like validation of months of effort.",
      "Woke up early and the sunrise was stunning — that soft pink gradient over the skyline. Went for a long run and felt completely in flow. Everything clicked today. Cooked a new recipe for dinner that actually turned out well.",
      "Remarkable day. The presentation landed perfectly, the team was engaged, and we got the green light. Celebrated with my favorite coffee and a walk in the park. Days like this remind me why I love what I do.",
      "Pure bliss. Finished a book I've been reading for weeks and the ending delivered. Long call with family, laughed until my sides hurt. Feeling deeply content and at peace.",
      "Best sleep in weeks. Woke up refreshed, meditated for 20 minutes, and the whole day felt lighter. Hit all my habits, wrote 1000 words, and felt creatively alive. Grateful for today.",
    ],
    4: [
      "Good productive day. Got through my task list and still had energy left over for a walk after dinner. The weather was cool and the neighborhood felt peaceful. Small things adding up to a solid day.",
      "Work was steady — made progress on the main feature without any blockers. Had a solid lunch break where I actually stepped away from the screen. Evening was low-key but nice.",
      "Decent day overall. Morning was a bit slow but picked up pace after the second coffee. Finished the backlog item I've been putting off. Feeling a quiet kind of satisfied.",
      "Good energy today. Exercised in the morning which set a positive tone. Meeting was actually useful for once. Wound down with some reading. Tomorrow looks manageable.",
      "Productive and calm. No major wins but no friction either. The kind of day that builds momentum quietly. Grateful for the steadiness.",
    ],
    3: [
      "Average day. Nothing went particularly wrong but nothing felt exciting either. Got through the tasks but felt a bit on autopilot. Need to shake things up a bit.",
      "Meh. The morning was fine, afternoon dragged. Couldn't focus during the deep-work block — too many interruptions. At least I got outside for a walk.",
      "Okay day. Had a mild headache that made concentration harder. Pushed through and got the essentials done. Going to bed early tonight to reset.",
      "Mixed. Some good moments, some frustrating ones. The commute was rough but the team lunch was fun. Ended the day feeling neutral — not great, not bad.",
      "Steady but unremarkable. Ticked the boxes, felt neither inspired nor drained. Sometimes that's enough.",
    ],
    2: [
      "Struggled today. Woke up with low motivation and it never really recovered. Kept getting distracted and the work felt like wading through mud. Tomorrow will be better.",
      "Rough morning. Alarm didn't go off, missed the first meeting, and the day never recovered its footing. Skipped the gym and ordered food instead of cooking. Feeling off.",
      "Frustrating day — the feature I've been building hit an unexpected bug that took hours to track down. By the time I solved it I was too mentally drained to do anything else. Need rest.",
      "Low energy all day. Couldn't sleep well last night and it showed. Brain fog made everything take longer. Tried to push through but should have just rested.",
      "Bad mood from the moment I woke up. Nothing specific — just that grey feeling. Canceled my evening plans and stayed in. Sometimes you need a reset day.",
    ],
    1: [
      "Really difficult day. The news hit hard and I couldn't shake it. Didn't exercise, barely ate, spent most of the evening just sitting with the feelings. Grateful the day is over.",
      "Awful. Everything that could go wrong did. The project deadline got moved up, my laptop died mid-presentation, and a long friendship felt suddenly strained. Need time to process.",
      "Hit a wall. Exhausted physically and emotionally. Called in sick and spent the day mostly in bed. The kind of low that needs to be honored, not fought through.",
    ],
  };

  // Generate ~75 entries over last 90 days, skipping some days (realistic)
  const entries = [];
  const skipDays = new Set(shuffle([...Array(90).keys()]).slice(0, 25)); // skip ~25 days

  for (let i = 89; i >= 0; i--) {
    if (skipDays.has(i)) continue;
    const date   = daysAgo(i);
    const mood   = pick(MOODS.concat([4, 4, 3, 3, 5])); // weighted toward positive
    const texts  = CONTENT[mood];
    const content = pick(texts);
    const tags   = shuffle([...TAG_POOL]).slice(0, pick([1, 2, 2, 3]));

    // Habit completions — generally better on higher-mood days
    const threshold = mood >= 4 ? 0.75 : mood === 3 ? 0.55 : 0.3;
    const habits = {
      h1: Math.random() < threshold,
      h2: Math.random() < threshold - 0.05,
      h3: Math.random() < threshold - 0.1,
      h4: Math.random() < threshold + 0.1,
    };

    entries.push({ id: uid(), date, content, mood, tags, habits, wordCount: content.split(/\s+/).length, createdAt: Date.now() - i * 86400000 });
  }

  for (const e of entries) {
    await post('/api/entries', e);
    process.stdout.write('.');
  }
  console.log(`\n  Created ${entries.length} journal entries`);
}

// ── 4. Calendar events ────────────────────────────────────────────────────────
async function seedCalendarEvents() {
  console.log('Seeding calendar events...');
  const events = [];

  // Recurring weekly team standups (Mon–Fri, last 8 weeks + next 4 weeks)
  for (let w = -8; w <= 4; w++) {
    for (const dow of [1, 3]) { // Mon, Wed
      const base = new Date();
      base.setDate(base.getDate() - base.getDay() + dow + w * 7);
      const d = base.toISOString().slice(0, 10);
      events.push({
        title: dow === 1 ? 'Team Standup' : 'Sprint Planning',
        description: dow === 1 ? 'Daily sync — 15 min' : 'Sprint review and planning session',
        startTime: dt(d, '09:00'), endTime: dt(d, dow === 1 ? '09:15' : '10:00'),
        allDay: false, color: '#3b82f6',
      });
    }
  }

  // Recurring weekly 1:1s (Tuesdays)
  for (let w = -6; w <= 3; w++) {
    const base = new Date();
    base.setDate(base.getDate() - base.getDay() + 2 + w * 7);
    const d = base.toISOString().slice(0, 10);
    events.push({
      title: '1:1 with Manager',
      description: 'Weekly check-in',
      startTime: dt(d, '14:00'), endTime: dt(d, '14:30'),
      allDay: false, color: '#8b5cf6',
    });
  }

  // Past personal events
  const personalPast = [
    { offset: -65, title: 'Doctor Appointment', desc: 'Annual physical', time: ['10:30','11:30'], color: '#ef4444' },
    { offset: -52, title: 'Birthday Dinner — Alex', desc: 'Restaurant on Main St', time: ['19:00','22:00'], color: '#ec4899' },
    { offset: -44, title: 'Dentist Checkup', desc: '', time: ['08:00','09:00'], color: '#ef4444' },
    { offset: -38, title: 'Weekend Hike', desc: 'Blue Ridge Trail with Sarah', time: ['07:00','13:00'], color: '#22c55e' },
    { offset: -31, title: 'Concert — The National', desc: 'Outdoor amphitheater', time: ['19:30','23:00'], color: '#f59e0b' },
    { offset: -24, title: 'Family Brunch', desc: 'At mom\'s place', time: ['11:00','14:00'], color: '#ec4899' },
    { offset: -17, title: 'Car Service', desc: 'Oil change + tire rotation', time: ['09:00','10:30'], color: '#64748b' },
    { offset: -10, title: 'Book Club', desc: 'Monthly meetup — "Tomorrow & Tomorrow"', time: ['18:30','20:30'], color: '#f59e0b' },
    { offset: -5,  title: 'Gym — Leg Day', desc: '', time: ['07:00','08:00'], color: '#22c55e' },
    { offset: -3,  title: 'Coffee with Jordan', desc: 'Catch up at Blue Bottle', time: ['10:00','11:00'], color: '#6366f1' },
  ];
  for (const e of personalPast) {
    const d = daysAgo(-e.offset);
    events.push({ title: e.title, description: e.desc, startTime: dt(d, e.time[0]), endTime: dt(d, e.time[1]), allDay: false, color: e.color });
  }

  // All-day events (past)
  const allDayPast = [
    { offset: -75, title: 'Independence Day', color: '#ef4444' },
    { offset: -60, title: 'Team Offsite', color: '#3b82f6' },
    { offset: -45, title: 'Vacation — Day 1', color: '#22c55e' },
    { offset: -44, title: 'Vacation — Day 2', color: '#22c55e' },
    { offset: -43, title: 'Vacation — Day 3', color: '#22c55e' },
    { offset: -20, title: 'Conference Day 1', color: '#8b5cf6' },
    { offset: -19, title: 'Conference Day 2', color: '#8b5cf6' },
  ];
  for (const e of allDayPast) {
    const d = daysAgo(-e.offset);
    events.push({ title: e.title, description: '', startTime: dt(d, '00:00'), endTime: dt(d, '23:59'), allDay: true, color: e.color });
  }

  // Upcoming events
  const upcoming = [
    { offset: 2,  title: 'Dentist Follow-up',    desc: '', time: ['15:00','16:00'], color: '#ef4444', allDay: false },
    { offset: 4,  title: 'Gym — Upper Body',      desc: '', time: ['07:00','08:00'], color: '#22c55e', allDay: false },
    { offset: 6,  title: 'Dinner with Parents',   desc: 'Italian place downtown', time: ['18:30','21:00'], color: '#ec4899', allDay: false },
    { offset: 9,  title: 'Product Demo',          desc: 'Present Q3 features to stakeholders', time: ['13:00','14:00'], color: '#3b82f6', allDay: false },
    { offset: 12, title: "Sarah's Birthday",      desc: '🎂', time: ['00:00','23:59'], color: '#ec4899', allDay: true },
    { offset: 14, title: 'Weekend Road Trip',     desc: 'Mountains getaway', time: ['00:00','23:59'], color: '#22c55e', allDay: true },
    { offset: 15, title: 'Weekend Road Trip',     desc: 'Mountains getaway', time: ['00:00','23:59'], color: '#22c55e', allDay: true },
    { offset: 18, title: 'Performance Review',    desc: 'Annual review with manager', time: ['10:00','11:00'], color: '#8b5cf6', allDay: false },
    { offset: 21, title: 'Haircut',               desc: '', time: ['11:00','12:00'], color: '#64748b', allDay: false },
    { offset: 25, title: 'Flight to Chicago',     desc: 'Dep. ORD 08:15', time: ['05:30','10:00'], color: '#f59e0b', allDay: false },
    { offset: 26, title: 'Chicago Work Trip',     desc: 'Client meetings day 1', time: ['00:00','23:59'], color: '#f59e0b', allDay: true },
    { offset: 27, title: 'Chicago Work Trip',     desc: 'Client meetings day 2', time: ['00:00','23:59'], color: '#f59e0b', allDay: true },
    { offset: 30, title: 'Gym — Cardio Day',      desc: '', time: ['07:00','08:00'], color: '#22c55e', allDay: false },
  ];
  for (const e of upcoming) {
    const d = daysFrom(e.offset);
    events.push({ title: e.title, description: e.desc, startTime: dt(d, e.time[0]), endTime: dt(d, e.time[1]), allDay: e.allDay, color: e.color });
  }

  for (const ev of events) {
    await post('/api/calendar-events', ev);
    process.stdout.write('.');
  }
  console.log(`\n  Created ${events.length} calendar events`);
}

// ── 5. Folders ────────────────────────────────────────────────────────────────
async function seedFolders() {
  console.log('Seeding folders...');
  const existing = await get('/api/folders');
  if (existing.length > 0) { console.log('  Folders already exist, skipping'); return; }

  const roots = [
    { name: 'Work Documents' },
    { name: 'Personal'       },
    { name: 'Photos'         },
    { name: 'Projects'       },
  ];
  const created = [];
  for (const f of roots) {
    const r = await post('/api/folders', { name: f.name });
    created.push(r);
    console.log(`  + ${f.name} (id=${r.id})`);
  }

  // Sub-folders
  const subs = [
    { name: 'Reports',    parentId: created[0].id },
    { name: 'Contracts',  parentId: created[0].id },
    { name: 'Journal Exports', parentId: created[1].id },
    { name: '2025',       parentId: created[2].id },
    { name: '2026',       parentId: created[2].id },
    { name: 'Side Project', parentId: created[3].id },
  ];
  for (const f of subs) {
    const r = await post('/api/folders', { name: f.name, parentId: f.parentId });
    console.log(`    + ${f.name} (id=${r.id})`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nSeeding → ${BASE}\n`);
  try {
    await clearExisting();
    await seedHabits();
    await seedEntries();
    await seedCalendarEvents();
    await seedFolders();
    console.log('\nDone! Open http://localhost:5500 to see the data.\n');
  } catch (err) {
    console.error('\nSeed failed:', err.message);
    process.exit(1);
  }
})();
