/* Dayblock — a planner shown as a desk of notebooks.
   Local-first notebooks with optional Google account sync; no build step. */
(() => {
'use strict';

const STORAGE_KEY = 'spread-planner.v1';
const SNAPSHOT_KEY = 'dayblock.before-redesign.v1';
const CLAUDE_KEY = 'dayblock.claude-key.v1';   // this device only; never synced or exported
let account = null;
const DAY_START = 8;      // 8 am
const DAY_END = 24;       // midnight
const SNAP = 0.25;        // 15 minutes

const PENS = ['butter', 'rose', 'seafoam', 'peri', 'bone', 'clay', 'slate', 'moss'];
const PEN_NAMES = { butter: 'butter', rose: 'dust rose', seafoam: 'seafoam', peri: 'periwinkle', bone: 'bone', clay: 'clay', slate: 'slate', moss: 'moss', none: 'no highlight' };
const MOODS = [['great', '#f5d65e'], ['good', '#b7e2cf'], ['okay', '#eee9dc'], ['low', '#a9bcd9'], ['rough', '#d8bfc0']];
const PARTS = ['morning', 'midday', 'afternoon', 'evening', 'night'];
const BOOKS = {
  planner: { name: 'planner', cover: '#34405a', pen: 'peri', w: 230 },
  ideas: { name: 'ideas', cover: '#b97a83', pen: 'rose', w: 196 },
  reading: { name: 'book log', cover: '#d9cdb5', pen: 'butter', w: 210 },
  morning: { name: 'morning pages', cover: '#5e6b73', pen: 'seafoam', w: 220 },
  gratitude: { name: 'gratitude', cover: '#6f7a5a', pen: 'moss', w: 190 },
  recipes: { name: 'recipes', cover: '#a0785e', pen: 'clay', w: 200 },
  daybook: { name: 'day book', cover: '#45433e', pen: 'bone', w: 180 },
  catchall: { name: 'sticky file', cover: '#b9b6ae', pen: 'bone' },
};
const PILE = ['daybook', 'recipes', 'gratitude', 'morning', 'reading', 'ideas', 'planner'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const Q = window.DayblockQuickNotes;

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = t => Math.round(t / SNAP) * SNAP;
// A click lands in the quarter hour under the pointer, not the nearest line.
const floorSnap = t => Math.floor(t / SNAP + 1e-6) * SNAP;
const ceilSnap = t => Math.ceil(t / SNAP - 1e-6) * SNAP;
const pad = n => String(n).padStart(2, '0');

// 12-hour clock: 8 … 12, 1 … 12. 24 is midnight.
const h12 = t => ((Math.floor(t) + 11) % 12) + 1;
const mins = t => Math.round((t - Math.floor(t)) * 60);
const ampm = t => (t % 24) < 12 ? 'am' : 'pm';
const fmtTime = t => `${h12(t)}:${pad(mins(t))}`;                                        // 12:30
const fmtHourBare = t => `${h12(t)}${mins(t) ? ':' + pad(mins(t)) : ''}`;              // 12:30
const fmtHour = t => `${fmtHourBare(t)} ${ampm(t)}`;                                     // 12:30 pm
const fmtRange = (a, b) => `${ampm(a) === ampm(b) ? fmtHourBare(a) : fmtHour(a)} – ${fmtHour(b)}`;
const fmtClock = date => `${h12(date.getHours())}:${pad(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;

const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const todayKey = () => keyOf(new Date());
const nowHours = () => { const n = new Date(); return n.getHours() + n.getMinutes() / 60; };
const sundayFirst = () => state.settings.weekStart === 'sun';
const weekStart = k => addDays(k, -((fromKey(k).getDay() + (sundayFirst() ? 0 : 6)) % 7));
const weekOf = key => { const first = weekStart(key); return Array.from({ length: 7 }, (_, i) => addDays(first, i)); };
const monthStart = k => k.slice(0, 7) + '-01';
const mon3 = d => MONTHS[d.getMonth()].slice(0, 3);
const shortDate = k => { const d = fromKey(k); return `${mon3(d)} ${d.getDate()}`; };
const upperDate = k => shortDate(k).toUpperCase();
const dayLabel = k => { const d = fromKey(k); return `${DOW[d.getDay()]} ${d.getDate()}`; };  // TUE 22
const monthYear = k => { const d = fromKey(k); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`.toUpperCase(); };
const isoWeek = k => {
  const d = fromKey(k); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + (jan4.getDay() + 6) % 7) / 7);
};
const isWeek = () => state.settings.mode === 'week';
const isMonth = () => state.settings.mode === 'month';
const words = text => (text.trim().match(/\S+/g) || []).length;
const penOf = color => ({ yellow: 'butter', peach: 'clay', pink: 'rose', lilac: 'peri', blue: 'peri', sky: 'slate', mint: 'seafoam', green: 'moss', grey: 'bone' }[color] || color);

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
const label = (text, extra = {}) => el('h3', { class: 'label', ...extra }, text);
function button(text, onclick, attrs = {}) { return el('button', { type: 'button', ...attrs, onclick }, text); }
function choice(options, current, onPick, attrs = {}) {
  const nav = el('div', { class: 'choice', role: 'group', ...attrs });
  for (const [value, text] of options) nav.append(button(text, () => onPick(value), { 'aria-pressed': String(value === current) }));
  return nav;
}

/* ---------- state ---------- */
function defaultState() {
  return {
    settings: { view: 'all', workStart: 9, workEnd: 18, color: 'butter', mode: 'day' },
    days: {}, habits: [], habitLog: {}, desk: { items: [] },
  };
}
function migrate(s) {
  const st = s.settings ||= {};
  st.view ||= 'all'; st.workStart ??= 9; st.workEnd ??= 18; st.color ||= 'butter';
  if (!['day', 'week', 'month'].includes(st.mode)) st.mode = 'day';
  st.highlighters ||= 'chalk'; st.desk ||= 'paper grey'; st.ruling ||= 'lines'; st.weekStart ||= 'mon';
  st.dayBook ||= { morning: true, schedule: true, mood: true };
  const prefs = st.paperPreferences ||= {};
  if (!['page', 'spread'].includes(prefs.desktop)) prefs.desktop = 'spread';
  if (!['page', 'spread'].includes(prefs.phone)) prefs.phone = 'page';
  prefs.margin ??= true;
  s.days ||= {}; s.habits ||= []; s.habitLog ||= {};
  s.desk ||= { items: [] };
  if (!s.desk.items.some(i => i.type === 'card')) s.desk.items.push({ id: uid(), type: 'card', x: null, y: null, rot: -1 });
  s.months ||= {}; s.weeks ||= {};
  s.trackers ||= {}; s.trackers.ideas ||= []; s.trackers.reading ||= []; s.trackers.recipes ||= [];
  s.shopping ||= []; s.gratitude ||= {}; s.moodBar ||= {}; s.morningPages ||= {};
  s.quickNotes ||= []; s.quickDraft ??= '';
  // The shared catchall became the sticky file: its notes move there, unsorted.
  s.catchall ||= { draft: '', items: [] };
  s.catchall.items ||= [];
  for (const item of s.catchall.items) {
    if (s.quickNotes.some(n => n.id === item.id)) continue;
    s.quickNotes.push({ id: item.id, original: item.text || '', dest: 'catchall', section: 'unsorted', date: '', time: null,
      stored: item.text || '', note: 'from the catchall', at: item.createdAt || new Date().toISOString(), done: !!item.done, ref: null });
  }
  s.catchall.items = [];
  if (s.catchall.draft && !s.quickDraft) s.quickDraft = s.catchall.draft;
  s.catchall.draft = '';
  s.user ||= { name: '' };
  s.shelf ||= {};
  for (const key of PILE) s.shelf[key] ??= true;
  s.ai ||= { enabled: false };
  s.onboarded ??= false;
  s.favoriteColor ||= '';
  s.googleCalendar ||= { events: [], updatedAt: null };
  return s;
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = JSON.parse(raw);
    if (s && s.settings && s.days) {
      // Keep one untouched copy of the notebooks from before the redesign.
      if (!s.quickNotes && !localStorage.getItem(SNAPSHOT_KEY)) {
        try { localStorage.setItem(SNAPSHOT_KEY, raw); } catch (_) { /* storage full: the live copy is still intact */ }
      }
      return migrate(s);
    }
  } catch (_) { /* fall through */ }
  return migrate(defaultState());
}
function save() {
  if (account) account.save(state);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function dayData(k) {
  const d = (state.days[k] ||= { title: '', blocks: [], todos: [], notes: '', done: '' });
  // older versions kept notes as positioned scraps; fold them into plain text
  if (Array.isArray(d.notes)) d.notes = d.notes.map(n => n.text).filter(Boolean).join('\n');
  d.done ??= '';
  return d;
}
const gratitudeDay = k => { const g = (state.gratitude[k] ||= {}); for (const f of ['grateful', 'today', 'good', 'learned']) g[f] ||= []; return g; };
const moodDay = k => state.moodBar[k] || [-1, -1, -1, -1, -1];
const morningDay = k => (state.morningPages[k] ||= { pages: ['', ''] });

let state = load();
const prefs = () => state.settings.paperPreferences;
let calendarClient = null;
let accountStatus = { phase: 'local', user: null, available: false };
let calendarStatus = { phase: 'unconfigured', message: 'Your primary calendar · read-only' };

/* ---------- where we are ---------- */
let surface = 'shelf';        // shelf | planner | ideas | reading | journal | gratitude | recipes | morning | daybook | settings
let cursor = todayKey();      // planner: left page of the current spread
let bookDay = todayKey();     // gratitude, morning pages, day book
let lastToday = todayKey();
let journalId = null;
let showArchived = false;
let detail = false;           // single page: an entry instead of its index
let yearView = false;         // phone gratitude
let moodBrush = 0;
let arriving = false;         // the pile swipes up after onboarding
let unfoldNext = false;       // the planner unfolds when opened from the shelf
const selection = { ideas: null, recipes: null };
const fresh = new Set();      // ids of just-drawn blocks; they vanish if left untitled
const phone = matchMedia('(max-width: 700px)');
const paperMode = () => prefs()[phone.matches ? 'phone' : 'desktop'];
const onePage = () => phone.matches || paperMode() === 'page';
let bookFrame = null;
const gridLayouts = new WeakMap();
const calendarEvents = key => window.DayblockCalendar.eventsOnDate(state.googleCalendar.events, key);
const calendarWindow = () => window.DayblockCalendar.windowFor(cursor);
const refreshCalendar = () => calendarClient?.refresh(calendarWindow());
const claudeKey = () => { try { return localStorage.getItem(CLAUDE_KEY) || ''; } catch (_) { return ''; } };

// Unchecked todos from earlier days roll forward to today, keeping their origin.
function carryOver() {
  const today = todayKey();
  const target = dayData(today);
  let moved = false;
  for (const k of Object.keys(state.days).sort()) {
    if (k >= today) continue;
    const d = state.days[k];
    const carry = d.todos.filter(t => !t.done);
    if (!carry.length) continue;
    for (const t of carry) { t.from ||= k; target.todos.push(t); }
    d.todos = d.todos.filter(t => t.done);
    moved = true;
  }
  if (moved) save();
}

/* ---------- time layout (work / off / all hours) ---------- */
const PPH = { day: 48, week: 24, phone: 44 };
function layout(key = cursor, kind = 'day') {
  const H = bookFrame?.height || Math.max(320, innerHeight - 140);
  const paperHeight = kind === 'week' ? H : 16 * PPH[kind] + 150;
  const L = window.DayblockLayout.timeline({ ...state.settings, hidePast: !!state.settings.hidePastHours,
    today: key === todayKey(), now: nowHours(), weekly: kind === 'week', paperHeight, maxPph: PPH[kind] });
  L.kind = kind;
  return L;
}
const { timeToY, yToTime } = window.DayblockLayout;
const hiddenIn = (b, L) => L.items.some(it => it.type !== 'seg' && b.start >= it.from && b.end <= it.to);

function positionBlock(node, start, end, L) {
  const top = timeToY(Math.max(start, L.start), L);
  const h = Math.max(timeToY(end, L) - top - 2, 2);
  // Short events keep a readable height: one line, title only.
  const shown = node.classList.contains('ghost') ? h : Math.max(h, 18);
  node.style.top = `${top + 1}px`;
  node.style.height = `${shown}px`;
  node.classList.toggle('compact', h < 40);
  node.classList.toggle('tiny', h < 24);
  const time = node.querySelector('.block-time');
  if (time) time.textContent = h < 40 ? fmtTime(start) : `${fmtTime(start)} – ${fmtTime(end)}`;
}

// Overlapping blocks share the width, Google-Calendar style.
function lanes(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const res = {};
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const ends = [];
    for (const b of cluster) {
      let i = ends.findIndex(e => e <= b.start);
      if (i < 0) { i = ends.length; ends.push(0); }
      ends[i] = b.end;
      res[b.id] = { lane: i };
    }
    for (const b of cluster) res[b.id].count = ends.length;
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = cluster.length === 1 ? b.end : Math.max(clusterEnd, b.end);
  }
  flush();
  return res;
}

/* ---------- pointer tracking (drag vs click) ---------- */
function trackPointer(e, capEl, { move, end, click, cancel }) {
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  try { capEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  const onMove = ev => {
    if (ev.pointerId !== e.pointerId) return;
    if (!moved) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      document.body.classList.add('dragging');
      getSelection()?.removeAllRanges();
    }
    move(ev);
  };
  const onUp = ev => {
    if (ev.pointerId !== e.pointerId) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    try { capEl.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    document.body.classList.remove('dragging');
    if (ev.type === 'pointercancel') { cancel?.(); return; }
    if (moved) end(ev); else click?.(ev);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

/* ---------- editable text ---------- */
function bindEditable(node, commit, { multiline = false, onEnter, onEmptyBackspace, onBlur } = {}) {
  node.contentEditable = 'plaintext-only';
  if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
  const text = () => node.innerText.replace(/\n$/, '');
  node.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); node.blur(); }
    else if (e.key === 'Enter' && !e.shiftKey && (onEnter || !multiline)) {
      e.preventDefault();
      if (onEnter) onEnter(); else node.blur();
    }
    else if (e.key === 'Backspace' && onEmptyBackspace && text() === '') {
      e.preventDefault(); onEmptyBackspace();
    }
  });
  node.addEventListener('input', () => commit(text()));
  node.addEventListener('blur', () => { commit(text()); onBlur?.(); });
}
function editable(tag, cls, value, placeholder, commit, opts = {}) {
  const node = el(tag, { class: cls, 'data-placeholder': placeholder, role: 'textbox', 'aria-label': opts.label || placeholder || 'text', 'aria-multiline': String(!!opts.multiline) });
  node.textContent = value || '';
  bindEditable(node, commit, opts);
  return node;
}
function focusEditable(node, ev) {
  if (!node) return;
  node.focus();
  const sel = getSelection();
  let range = null;
  if (ev && document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(ev.clientX, ev.clientY);
    if (p && node.contains(p.offsetNode)) {
      range = document.createRange(); range.setStart(p.offsetNode, p.offset); range.collapse(true);
    }
  } else if (ev && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
    if (r && node.contains(r.startContainer)) range = r;
  }
  if (!range) { range = document.createRange(); range.selectNodeContents(node); range.collapse(false); }
  sel.removeAllRanges(); sel.addRange(range);
}
// A list of numbered ruled lines (gratitude, method). Enter moves down a line.
function numberedLines(list, count, commitAll, { placeholder = '' } = {}) {
  const wrap = el('div', { class: 'numbered-lines' });
  const row = i => {
    const line = editable('span', 'line', list[i] || '', i === 0 ? placeholder : '', v => { while (list.length < i) list.push(''); list[i] = v; commitAll(); }, {
      label: `line ${i + 1}`,
      onEnter() {
        const next = wrap.querySelectorAll('.line')[i + 1];
        if (next) { focusEditable(next); return; }
        while (list.length <= i) list.push('');
        list.push(''); commitAll();
        const added = row(i + 1);
        wrap.append(added); focusEditable(added.querySelector('.line'));
      },
    });
    return el('div', { class: 'numbered' }, el('span', { class: 'n' }, pad(i + 1)), line);
  };
  for (let i = 0; i < Math.max(count, list.length); i++) wrap.append(row(i));
  return wrap;
}

/* ---------- the highlighter palette, beside what it colours ---------- */
const popover = $('#popover');
let closePopover = () => {};
function openPalette(anchor, current, onPick, { withNone = false, row = false } = {}) {
  closePopover();
  popover.replaceChildren();
  popover.classList.toggle('row', row);
  for (const c of withNone ? [...PENS, 'none'] : PENS) {
    const b = el('button', { type: 'button', class: `sw hl-${c}${penOf(current) === c ? ' on' : ''}`, title: PEN_NAMES[c], 'aria-label': PEN_NAMES[c] });
    // Keep focus in the block title while choosing its colour.
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('mousedown', e => e.preventDefault());
    b.onclick = () => { closePopover(); onPick(c); };
    popover.append(b);
  }
  popover.classList.add('open');
  const r = anchor.getBoundingClientRect();
  const pw = popover.offsetWidth, ph = popover.offsetHeight;
  if (row) {
    popover.style.left = `${clamp(r.left + r.width / 2 - pw / 2, 8, innerWidth - pw - 8)}px`;
    popover.style.top = `${clamp(r.bottom + 6, 8, innerHeight - ph - 8)}px`;
  } else {
    const right = r.right + 10 + pw < innerWidth - 8;
    popover.style.left = `${right ? r.right + 10 : Math.max(8, r.left - pw - 10)}px`;
    popover.style.top = `${clamp(r.top, 8, innerHeight - ph - 8)}px`;
  }
  const onDoc = ev => { if (!popover.contains(ev.target)) closePopover(); };
  const onKey = ev => { if (ev.key === 'Escape') closePopover(); };
  closePopover = () => {
    popover.classList.remove('open');
    document.removeEventListener('pointerdown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    closePopover = () => {};
  };
  setTimeout(() => { document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey, true); });
}
function swatchButton(current, onPick, opts) {
  const b = el('button', { type: 'button', class: 'swatch-btn', title: 'highlighter', 'aria-label': 'Change highlighter' });
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.onclick = e => { e.stopPropagation(); openPalette(b, current, onPick, opts); };
  return b;
}
function delButton(onDel, what = 'remove') {
  const b = el('button', { type: 'button', class: 'del', title: what, 'aria-label': what }, '×');
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.onclick = e => { e.stopPropagation(); onDel(); };
  return b;
}

/* ---------- the one page head ---------- */
function head({ num, numClass = '', stack = [], focus = null, actions = [], ghost = false }) {
  const h = el('header', { class: `head${ghost ? ' ghost' : ''}` });
  h.append(typeof num === 'string' ? el('h1', { class: `num ${numClass}` }, num) : num);
  if (stack.length) h.append(el('div', { class: 'stack mono' }, stack.map(s => el('span', {}, s))));
  if (focus) h.append(focus);
  if (actions.length) h.append(el('div', { class: 'actions' }, actions));
  return h;
}
const archiveToggle = (onChange) => choice([[false, 'current'], [true, 'archived']], showArchived, v => { showArchived = v; detail = false; onChange?.(); render(); });

/* ================= planner ================= */
const scene = $('#scene'), book = $('#book'), stationery = $('#stationery'), bar = $('#bar');

function setMode(mode, key = cursor) {
  surface = 'planner';
  cursor = key;
  state.settings.mode = mode;
  save(); render(); refreshCalendar();
}
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.querySelectorAll('.paper-controls [data-paper]').forEach(b => b.onclick = () => {
  prefs()[phone.matches ? 'phone' : 'desktop'] = b.dataset.paper;
  detail = false; save(); render();
});
$('#toggleMargin').onclick = () => { prefs().margin = !prefs().margin; save(); render(); };

function navigate(direction) {
  if (surface === 'daybook') { flipDayBook(direction); return; }
  if (surface !== 'planner') { bookDay = addDays(bookDay, direction); render(); return; }
  if (isMonth()) {
    const d = fromKey(cursor);
    cursor = keyOf(new Date(d.getFullYear(), d.getMonth() + direction, 1));
  } else cursor = addDays(cursor, direction * (isWeek() ? 7 : onePage() ? 1 : 2));
  render(); refreshCalendar();
}
function goToday() {
  if (surface === 'planner') { cursor = todayKey(); refreshCalendar(); } else bookDay = todayKey();
  render();
}
document.addEventListener('keydown', e => {
  if (e.target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
  if (!['planner', 'gratitude', 'morning', 'daybook'].includes(surface)) return;
  if (e.key === 'ArrowLeft') navigate(-1);
  if (e.key === 'ArrowRight') navigate(1);
});
function rangeText() {
  if (surface !== 'planner') return upperDate(bookDay) + `, ${fromKey(bookDay).getFullYear()}`;
  if (isMonth()) return monthYear(cursor);
  const start = isWeek() ? weekStart(cursor) : cursor;
  const a = fromKey(start), b = fromKey(addDays(start, isWeek() ? 6 : onePage() ? 0 : 1));
  if (+a === +b) return `${mon3(a)} ${a.getDate()}, ${a.getFullYear()}`.toUpperCase();
  return (a.getMonth() === b.getMonth()
    ? `${mon3(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
    : `${mon3(a)} ${a.getDate()} – ${mon3(b)} ${b.getDate()}, ${b.getFullYear()}`).toUpperCase();
}

/* ---------- a day page ---------- */
function dayHead(key) {
  const d = dayData(key), date = fromKey(key);
  const focus = editable('div', 'focus', d.title, 'a focus for today', v => { d.title = v; save(); }, { label: 'Focus for the day' });
  return head({ num: String(date.getDate()), numClass: key === todayKey() ? 'today' : '', stack: [DOW[date.getDay()], monthYear(key)], focus });
}
// Where each day's schedule was scrolled to, so redraws don't jump.
const dayScroll = new Map();
function renderDayPage(key, { mini = false } = {}) {
  const d = dayData(key);
  const page = el('section', { class: 'page day-page', 'data-key': key });
  const timeline = el('div', { class: 'timeline' });
  const kind = phone.matches ? 'phone' : 'day';
  renderTimeline(timeline, key, kind);
  if (!phone.matches) {
    timeline.classList.add('scrolls');
    timeline.addEventListener('scroll', () => dayScroll.set(key, timeline.scrollTop), { passive: true });
    // Open near now on today, else at the first event (or 9 am).
    // Runs right after this render places the page, before anything is drawn.
    queueMicrotask(() => {
      if (!timeline.isConnected) return;
      if (dayScroll.has(key)) { timeline.scrollTop = dayScroll.get(key); return; }
      const L = layout(key, kind);
      const first = [...d.blocks].sort((a, b) => a.start - b.start)[0]?.start;
      const at = key === todayKey() ? nowHours() - 1 : (first ?? 9) - .5;
      timeline.scrollTop = Math.max(0, timeToY(clamp(at, L.start, DAY_END), L));
    });
  }
  const aside = el('aside', { class: 'aside' });
  renderCalendarBanners(aside, key);
  const todo = el('div', { class: 'todo-section' }, label('todo'));
  renderTodos(todo, key);
  aside.append(todo,
    el('div', {}, label('done'), editable('div', 'ruled done-text', d.done, 'what got done', v => { d.done = v; save(); }, { multiline: true, label: 'Done' })),
    el('div', { class: 'notes' }, label('notes'), editable('div', 'ruled notes-text', d.notes, 'notes', v => { d.notes = v; save(); }, { multiline: true, label: 'Notes' })));
  if (mini && !phone.matches) aside.append(miniCal(key));
  page.append(dayHead(key), el('div', { class: 'day-body' }, timeline, aside), habitsFoot(key));
  return page;
}

/* ---------- timeline ---------- */
function renderTimeline(container, key, kind = 'day') {
  const d = dayData(key);
  const imported = calendarEvents(key).filter(event => !event.allDay && event.end > DAY_START && event.start < DAY_END)
    .map(event => ({ ...event, start: Math.max(DAY_START, event.start), end: Math.min(DAY_END, event.end) }));
  const blocks = [...d.blocks, ...imported];
  const L = layout(key, kind);
  const grid = el('div', { class: 'grid', 'data-day': key, style: `height:${L.height}px` });
  gridLayouts.set(grid, L);

  for (const it of L.items) {
    if (it.type !== 'seg') {
      const n = blocks.filter(b => hiddenIn(b, L) && b.start >= it.from && b.end <= it.to).length;
      const gap = el('button', { type: 'button', class: `gap${it.type === 'past' ? ' past-gap' : ''}`, style: `top:${it.y}px;height:${it.h - 2}px`, title: it.type === 'past' ? 'show past hours' : 'show all hours' },
        it.type === 'past' ? `earlier hours${n ? ` · ${n}` : ''} · show` : `${fmtRange(it.from, it.to)}${n ? ` · ${n} hidden` : ''}`);
      gap.onclick = e => {
        e.stopPropagation();
        if (it.type === 'past') state.settings.hidePastHours = false; else state.settings.view = 'all';
        save(); render();
      };
      grid.append(gap);
      continue;
    }
    for (let h = Math.ceil(it.from); h <= it.to; h++) {
      const line = el('div', { class: 'hour', style: `top:${timeToY(h, L)}px` });
      if (kind !== 'week') line.append(el('span', { class: 'hour-label mono' }, h === DAY_START || h % 12 === 0 || h === Math.ceil(it.from) ? fmtHour(h).toUpperCase() : fmtHourBare(h)));
      grid.append(line);
    }
  }

  const layer = el('div', { class: 'blocks' });
  const ln = lanes(blocks.filter(b => !hiddenIn(b, L)));
  for (const b of blocks) {
    if (hiddenIn(b, L)) continue;
    const { lane, count } = ln[b.id];
    const place = node => { node.style.left = `${lane * 100 / count}%`; node.style.width = `calc(${100 / count}% - ${count > 1 ? 2 : 0}px)`; positionBlock(node, b.start, b.end, L); };
    if (b.readonly) {
      const node = el('button', { type: 'button', class: 'block calendar-block hl-peri', title: `Google Calendar · ${b.title} · read-only`, 'aria-label': `${b.title}, Google Calendar, read-only` },
        el('span', { class: 'block-time' }), el('span', { class: 'block-title' }, b.title));
      node.addEventListener('pointerdown', e => e.stopPropagation());
      node.onclick = e => { e.stopPropagation(); openCalendarEvent(b.source || b); };
      place(node); layer.append(node); continue;
    }
    const node = el('div', { class: `block hl-${b.color}`, 'data-id': b.id, tabindex: 0, 'aria-label': `${fmtRange(b.start, b.end)} · ${b.title || 'untitled block'}` });
    node.addEventListener('keydown', e => { if (e.target === node && ['Enter', ' '].includes(e.key)) { e.preventDefault(); openBlockEditor(key, b); } });
    const t = editable('div', 'block-title', b.title, 'title', v => { b.title = v; save(); }, {
      label: 'Block title',
      onBlur() {
        if (!fresh.has(b.id)) return;
        // Choosing a colour keeps the caret here; any other exit settles the block.
        setTimeout(() => {
          if (document.activeElement === t) return;
          fresh.delete(b.id);
          if (!b.title.trim()) { d.blocks = d.blocks.filter(x => x !== b); save(); render(); }
        }, 0);
      },
    });
    node.append(el('div', { class: 'block-time' }), t,
      swatchButton(b.color, c => { b.color = c; state.settings.color = c; save(); render(); }),
      delButton(() => { d.blocks = d.blocks.filter(x => x !== b); save(); render(); }, 'delete block'),
      el('div', { class: 'block-resize' }));
    place(node);
    layer.append(node);
  }
  grid.append(layer);
  renderNow(grid, key, L);
  // A faint half hour follows the pointer, showing where a click will put a block.
  grid.addEventListener('pointermove', e => {
    let slot = grid.querySelector('.slot-preview');
    const over = e.target.closest('.block, .gap, .hour-label, button');
    if (e.pointerType !== 'mouse' || over || document.body.classList.contains('dragging')) { slot?.remove(); return; }
    const y = e.clientY - grid.getBoundingClientRect().top;
    const inGap = L.items.some(it => it.type !== 'seg' && y >= it.y && y <= it.y + it.h);
    if (inGap) { slot?.remove(); return; }
    const start = clamp(floorSnap(yToTime(y, L)), L.start, DAY_END - SNAP);
    if (slot?.dataset.start === String(start)) return;
    if (!slot) { slot = el('div', { class: 'slot-preview', 'aria-hidden': 'true' }, el('span', { class: 'mono' })); grid.append(slot); }
    slot.dataset.start = String(start);
    const top = timeToY(start, L), bottom = timeToY(Math.min(start + .5, DAY_END), L);
    slot.style.top = `${top + 1}px`; slot.style.height = `${Math.max(bottom - top - 2, 6)}px`;
    slot.firstChild.textContent = kind === 'week' ? '' : fmtTime(start);
  });
  grid.addEventListener('pointerleave', () => grid.querySelector('.slot-preview')?.remove());
  grid.addEventListener('pointerdown', e => onGridPointerDown(e, key));
  // Native touch scrolling owns swipes; a completed tap still edits or creates.
  grid.addEventListener('click', e => {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest('.gap, .calendar-block, button')) return;
    const block = e.target.closest('.block');
    if (block) {
      if (kind === 'week' || block.classList.contains('tiny')) openBlockEditor(key, d.blocks.find(b => b.id === block.dataset.id));
      else focusEditable($('.block-title', block));
      return;
    }
    const start = clamp(floorSnap(yToTime(e.clientY - grid.getBoundingClientRect().top, L)), L.start, DAY_END - SNAP);
    addBlock(key, start, Math.min(start + .5, DAY_END), kind);
  });
  container.append(grid);
}

// The now line on today's page; everything above it is shaded.
function renderNow(grid, key, L) {
  let shade = grid.querySelector('.past-shade'), line = grid.querySelector('.now');
  if (key !== todayKey()) { shade?.remove(); line?.remove(); return; }
  const t = nowHours();
  if (!shade) { shade = el('div', { class: 'past-shade' }); grid.append(shade); }
  if (!line) { line = el('div', { class: 'now' }); grid.append(line); }
  const y = timeToY(clamp(t, DAY_START, DAY_END), L);
  shade.style.height = `${y}px`;
  line.style.top = `${y}px`;
  line.hidden = t < DAY_START || t > DAY_END;
}
function tick() {
  if (todayKey() !== lastToday) { lastToday = todayKey(); carryOver(); render(); return; }
  for (const g of document.querySelectorAll('.grid')) {
    const L = gridLayouts.get(g);
    if (!L) continue;
    const busy = document.activeElement?.isContentEditable || document.body.classList.contains('dragging') || document.querySelector('dialog[open]');
    if (layout(g.dataset.day, L.kind).start !== L.start && !busy) { render(); return; }
    renderNow(g, g.dataset.day, L);
  }
}
setInterval(tick, 30 * 1000);

function onGridPointerDown(e, key) {
  if (e.pointerType === 'touch' || e.button !== 0) return;
  const grid = e.currentTarget;
  const d = dayData(key);
  const L = gridLayouts.get(grid) || layout(key);
  const blockEl = e.target.closest('.block');
  const weekly = !!grid.closest('.week-day');

  if (blockEl) {
    const b = d.blocks.find(x => x.id === blockEl.dataset.id);
    if (!b) return;
    const title = blockEl.querySelector('.block-title');
    if (document.activeElement === title) return;   // editing text: native behaviour
    e.preventDefault();
    const resize = !!e.target.closest('.block-resize');
    const grabOffset = e.clientY - blockEl.getBoundingClientRect().top;
    const dur = b.end - b.start;
    const cur = { day: key, start: b.start, end: b.end };
    let curGrid = grid, curLayout = L;
    trackPointer(e, blockEl, {
      move(ev) {
        if (resize) {
          const y = ev.clientY - curGrid.getBoundingClientRect().top;
          cur.end = clamp(snap(yToTime(y, L)), b.start + SNAP, DAY_END);
        } else {
          const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.grid');
          if (over && over !== curGrid) {
            curGrid = over; cur.day = over.dataset.day;
            curLayout = gridLayouts.get(over) || layout(cur.day);
            over.querySelector('.blocks').append(blockEl);
          }
          const y = ev.clientY - grabOffset - curGrid.getBoundingClientRect().top;
          cur.start = clamp(snap(yToTime(y, curLayout)), Math.min(curLayout.start, DAY_END - dur), DAY_END - dur);
          cur.end = cur.start + dur;
        }
        positionBlock(blockEl, cur.start, cur.end, curLayout);
      },
      end() {
        d.blocks = d.blocks.filter(x => x !== b);
        b.start = cur.start; b.end = cur.end;
        dayData(cur.day).blocks.push(b);
        save(); render();
      },
      cancel() { render(); },
      click(ev) { if (weekly || blockEl.classList.contains('tiny')) openBlockEditor(key, b); else focusEditable(title, ev); },
    });
    return;
  }
  if (e.target.closest('.gap, .hour-label, button')) return;

  // empty paper: drag to draw a block (or click for a 30-minute one)
  e.preventDefault();
  const rect = grid.getBoundingClientRect();
  grid.querySelector('.slot-preview')?.remove();
  const anchor = clamp(floorSnap(yToTime(e.clientY - rect.top, L)), L.start, DAY_END - SNAP);
  let ghost = null;
  let cur = { start: anchor, end: anchor + SNAP };
  trackPointer(e, grid, {
    move(ev) {
      if (!ghost) {
        ghost = el('div', { class: `block ghost hl-${state.settings.color}` });
        grid.querySelector('.blocks').append(ghost);
      }
      // Dragging down includes the quarter under the pointer; dragging up starts at it.
      const raw = yToTime(ev.clientY - rect.top, L);
      cur = raw >= anchor
        ? { start: anchor, end: clamp(Math.max(ceilSnap(raw), anchor + SNAP), anchor + SNAP, DAY_END) }
        : { start: clamp(floorSnap(raw), L.start, anchor - SNAP), end: anchor + SNAP };
      positionBlock(ghost, cur.start, cur.end, L);
    },
    end() { addBlock(key, cur.start, cur.end, weekly ? 'week' : 'day'); },
    cancel() { ghost?.remove(); },
    click() { addBlock(key, anchor, Math.min(anchor + .5, DAY_END), weekly ? 'week' : 'day'); },
  });
}
function addBlock(key, start, end, kind = 'day', title = '') {
  const b = { id: uid(), start, end, title, color: state.settings.color };
  dayData(key).blocks.push(b);
  if (!title) fresh.add(b.id);
  save(); render();
  if (title) return;
  const node = $(`.grid[data-day="${key}"] .block[data-id="${b.id}"]`);
  if (kind === 'week' || !node || node.classList.contains('tiny')) { openBlockEditor(key, b); return; }
  focusEditable($('.block-title', node));
  // The palette pops up beside the block you just made.
  openPalette(node, b.color, c => {
    b.color = c; state.settings.color = c; save();
    node.className = node.className.replace(/\bhl-\S+/, `hl-${c}`);
  });
}

function openBlockEditor(key, block) {
  if (!block) return;
  closePopover();
  const dialog = el('dialog', { class: 'block-editor', 'aria-label': 'Time block' });
  const form = el('form');
  const title = el('input', { 'aria-label': 'Block title', placeholder: 'title', value: block.title, required: true });
  const start = el('select', { 'aria-label': 'Starts at' });
  const end = el('select', { 'aria-label': 'Ends at' });
  for (let time = DAY_START; time <= DAY_END; time += SNAP) {
    if (time < DAY_END) start.append(el('option', { value: time }, fmtHour(time).toUpperCase()));
    if (time > DAY_START) end.append(el('option', { value: time }, fmtHour(time).toUpperCase()));
  }
  start.value = block.start; end.value = block.end;
  let color = block.color;
  const swatches = el('div', { class: 'swatch-row', role: 'group', 'aria-label': 'Highlighter' });
  const drawSwatches = () => {
    swatches.replaceChildren(...PENS.map(c => button('', () => { color = c; drawSwatches(); }, { class: `sw hl-${c}${penOf(color) === c ? ' on' : ''}`, title: PEN_NAMES[c], 'aria-label': PEN_NAMES[c] })));
  };
  drawSwatches();
  const error = el('p', { role: 'alert' });
  const cancel = button('cancel', () => dialog.close());
  const remove = button('remove', () => { dayData(key).blocks = dayData(key).blocks.filter(b => b !== block); fresh.delete(block.id); save(); dialog.close(); render(); }, { class: 'remove' });
  form.append(el('h3', {}, `${dayLabel(key)} · ${monthYear(key)}`), title,
    el('div', { class: 'block-editor-times' }, start, el('span', { class: 'ink-3' }, '–'), end), swatches, error,
    el('div', { class: 'block-editor-actions' }, remove, cancel, el('button', { type: 'submit' }, 'save')));
  form.onsubmit = e => {
    e.preventDefault();
    if (+end.value <= +start.value || !title.value.trim()) { error.textContent = 'add a title and an end time after the start.'; return; }
    block.title = title.value.trim(); block.start = +start.value; block.end = +end.value; block.color = color;
    state.settings.color = color;
    fresh.delete(block.id); save(); dialog.close(); render();
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (fresh.delete(block.id) && !block.title.trim()) {
      dayData(key).blocks = dayData(key).blocks.filter(b => b !== block); save(); render();
    }
  }, { once: true });
  dialog.append(form); document.body.append(dialog); dialog.showModal(); title.focus();
}

/* ---------- google calendar (read-only) ---------- */
function calendarButton(event, className = 'calendar-tag') {
  const node = el('button', { type: 'button', class: className, title: `Google Calendar · ${event.title} · read-only`, 'aria-label': `${event.title}, Google Calendar, read-only` }, event.title);
  node.addEventListener('pointerdown', e => e.stopPropagation());
  node.onclick = e => { e.stopPropagation(); openCalendarEvent(event.source || event); };
  return node;
}
function renderCalendarBanners(container, key) {
  const events = calendarEvents(key).filter(event => event.allDay || event.end <= DAY_START || event.start >= DAY_END);
  if (!events.length) return;
  container.append(el('div', { class: 'calendar-banners', 'aria-label': 'Google Calendar all-day and early events' }, events.map(e => calendarButton(e))));
}
function openCalendarEvent(event) {
  const dialog = el('dialog', { class: 'block-editor calendar-event-dialog', 'aria-label': 'Google Calendar event' });
  const when = event.allDay ? `${event.start} · all day` : `${new Date(event.start).toLocaleString()} – ${new Date(event.end).toLocaleString()}`;
  dialog.append(el('h3', {}, 'google calendar · read-only'), el('h2', {}, event.title), el('p', {}, when));
  if (event.url) dialog.append(el('a', { href: event.url, target: '_blank', rel: 'noopener noreferrer' }, 'open in Google Calendar ↗'));
  dialog.append(button('close', () => dialog.close()));
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal();
}

/* ---------- todos ---------- */
function todoList(list, container, { onChange, focusKey, limit = 0, more } = {}) {
  const ul = el('ul', { class: 'todos' });
  const focusItem = id => { const t = $(`.todos[data-list="${focusKey}"] [data-id="${id}"] .todo-text`); t && focusEditable(t); };
  ul.dataset.list = focusKey;
  const shown = limit && list.length > limit + 1 ? list.slice(0, limit) : list;
  shown.forEach(t => {
    const i = list.indexOf(t);
    const li = el('li', { class: `todo${t.done ? ' done' : ''}`, 'data-id': t.id });
    if (t.from) li.append(el('span', { class: 'carried', title: `carried from ${shortDate(t.from)}` }, '→'));
    li.append(button(t.done ? '✓' : '', () => { t.done = !t.done; onChange(); render(); }, { class: 'check', 'aria-label': t.done ? 'Mark not done' : 'Mark done', 'aria-pressed': String(!!t.done) }));
    const txt = editable('span', `todo-text hl-${t.color || 'none'}${t.color && t.color !== 'none' ? ' hl' : ''}`, t.text, '…', v => { t.text = v; onChange(); }, {
      label: 'Todo',
      onEnter() { const n = { id: uid(), text: '', done: false, color: 'none' }; list.splice(i + 1, 0, n); onChange(); render(); focusItem(n.id); },
      onEmptyBackspace() { list.splice(i, 1); onChange(); render(); const prev = list[i - 1]; prev && focusItem(prev.id); },
    });
    li.append(txt);
    if (t.color !== undefined) li.append(swatchButton(t.color, c => { t.color = c; onChange(); render(); }, { withNone: true, row: true }));
    li.append(delButton(() => { list.splice(i, 1); onChange(); render(); }));
    ul.append(li);
  });
  container.append(ul);
  if (shown.length < list.length) container.append(button(`+ ${list.length - shown.length} more`, more, { class: 'add' }));
  else container.append(button('+ add', () => { const n = { id: uid(), text: '', done: false, color: 'none' }; list.push(n); onChange(); render(); focusItem(n.id); }, { class: 'add' }));
}
function renderTodos(container, key, opts = {}) {
  const d = dayData(key);
  todoList(d.todos, container, { onChange: save, focusKey: `day-${key}`, ...opts });
}

/* ---------- habits: a line at the foot of each day ---------- */
const HABIT_PENS = ['moss', 'peri', 'rose', 'clay', 'seafoam', 'butter', 'slate', 'bone'];
function habitStreak(id) {
  let k = todayKey();
  if (!state.habitLog[k]?.[id]) k = addDays(k, -1);   // today not marked yet still counts
  let n = 0;
  while (state.habitLog[k]?.[id]) { n++; k = addDays(k, -1); }
  return n;
}
function habitsFoot(key) {
  const log = state.habitLog[key] || {};
  const foot = el('footer', { class: 'day-foot' }, el('span', { class: 'label' }, 'habits'));
  state.habits.forEach((h, i) => {
    const on = !!log[h.id], streak = habitStreak(h.id);
    foot.append(button(h.name || 'habit', () => {
      const l = (state.habitLog[key] ||= {});
      if (on) delete l[h.id]; else l[h.id] = true;
      save(); render();
    }, { class: `habit hl-${HABIT_PENS[i % HABIT_PENS.length]}`, 'aria-pressed': String(on), title: streak ? `${streak} day${streak > 1 ? 's' : ''} in a row` : 'not held yet' }));
  });
  if (!state.habits.length) foot.append(el('span', { class: 'quiet ink-3' }, 'nothing tracked yet'));
  else foot.append(el('span', { class: 'count mono' }, `${state.habits.filter(h => log[h.id]).length} / ${state.habits.length}`));
  foot.append(button(state.habits.length ? 'edit' : '+ habit', () => openHabitEditor(key), { class: 'quiet', style: state.habits.length ? '' : 'margin-left:auto' }));
  return foot;
}
function openHabitEditor(key) {
  const dialog = el('dialog', { class: 'habit-editor', 'aria-label': 'Habits' });
  const draw = () => {
    const week = weekOf(key);
    const grid = el('div', { class: 'habit-grid' }, el('span'));
    for (const k of week) grid.append(el('span', { class: `hday${k === todayKey() ? ' today' : ''}` }, DOW[fromKey(k).getDay()][0]));
    grid.append(el('span'));
    state.habits.forEach((h, i) => {
      const row = el('div', { class: 'hrow' }, editable('span', 'hname', h.name, 'habit', v => { h.name = v; save(); }, { label: 'Habit name' }));
      for (const k of week) {
        const on = !!state.habitLog[k]?.[h.id];
        row.append(button('', () => { const l = (state.habitLog[k] ||= {}); if (on) delete l[h.id]; else l[h.id] = true; save(); draw(); },
          { class: `hcell hl-${HABIT_PENS[i % HABIT_PENS.length]}${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `${h.name || 'habit'} on ${shortDate(k)}` }));
      }
      row.append(delButton(() => {
        if (!confirm(`remove “${h.name || 'habit'}” and its checkmarks?`)) return;
        state.habits = state.habits.filter(x => x !== h);
        for (const l of Object.values(state.habitLog)) delete l[h.id];
        save(); draw();
      }, 'remove habit'));
      grid.append(row);
    });
    dialog.replaceChildren(el('h3', {}, `habits · week of ${upperDate(week[0])}`), grid,
      el('footer', {}, button('+ habit', () => { state.habits.push({ id: uid(), name: '' }); save(); draw(); focusEditable([...dialog.querySelectorAll('.hname')].pop()); }), button('done', () => dialog.close())));
  };
  draw();
  dialog.addEventListener('close', () => { dialog.remove(); render(); }, { once: true });
  document.body.append(dialog); dialog.showModal();
}

/* ---------- mini month ---------- */
function miniCal(key) {
  const d = fromKey(key), y = d.getFullYear(), m = d.getMonth();
  const first = (new Date(y, m, 1).getDay() + (sundayFirst() ? 0 : 6)) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const grid = el('div', { class: 'mc-grid' });
  for (const c of sundayFirst() ? 'SMTWTFS' : 'MTWTFSS') grid.append(el('span', { class: 'mc-h' }, c));
  for (let i = 0; i < first; i++) grid.append(el('span'));
  for (let i = 1; i <= days; i++) {
    const k = keyOf(new Date(y, m, i));
    const on = k === cursor || (!onePage() && k === addDays(cursor, 1));
    grid.append(button(String(i), () => { cursor = k; render(); }, { class: `mc-d${on ? ' on' : ''}${k === todayKey() ? ' today' : ''}`, 'aria-label': `Open ${shortDate(k)}` }));
  }
  return el('div', { class: 'minical' }, label(MONTHS[m]), grid);
}

/* ---------- week ---------- */
function renderWeek() {
  const days = weekOf(cursor), start = days[0];
  const first = fromKey(start), last = fromKey(days[6]);
  const period = first.getFullYear() !== last.getFullYear()
    ? `${mon3(first)} ${first.getFullYear()} – ${mon3(last)} ${last.getFullYear()}`
    : `${MONTHS[first.getMonth()]}${first.getMonth() !== last.getMonth() ? ` – ${MONTHS[last.getMonth()]}` : ''} ${last.getFullYear()}`;
  const week = state.weeks[start] || { focus: '' };
  const focus = editable('div', 'focus', week.focus, 'a focus for the week', v => { (state.weeks[start] ||= { focus: '' }).focus = v; save(); }, { label: 'Focus for the week' });
  const page = el('section', { class: 'page week-sheet' }, head({ num: `${first.getDate()}–${last.getDate()}`, stack: [`WEEK ${isoWeek(start)}`, period.toUpperCase()], focus }));
  if (phone.matches) { page.append(...days.map(weekListRow)); book.append(page); return; }
  const L = layout(start, 'week');
  const gutter = el('div', { class: 'week-gutter' });
  const labels = el('div', { style: `position:relative;margin-top:58px;height:${L.height}px` });
  for (const it of L.items) if (it.type === 'seg') for (let h = Math.ceil(it.from); h <= it.to; h++) if (h % 2 === 0) labels.append(el('span', { class: 'hour-label mono', style: `top:${timeToY(h, L)}px` }, String(h12(h))));
  gutter.append(labels);
  const grid = el('div', { class: 'week-grid' }, gutter);
  for (const key of days) {
    const d = dayData(key), date = fromKey(key), today = key === todayKey();
    const col = el('section', { class: 'week-day', 'data-key': key });
    col.append(button([el('strong', { class: today ? 'today' : '' }, String(date.getDate())), el('span', { class: 'mono' }, DOW[date.getDay()])], () => setMode('day', key), { class: `week-day-head${today ? ' today' : ''}`, 'aria-label': `Open ${shortDate(key)}` }),
      editable('div', `week-title${d.title ? '' : ' ink-3'}`, d.title, 'a focus', v => { d.title = v; save(); }, { label: 'Focus for the day' }));
    const timeline = el('div', { class: 'timeline' });
    renderTimeline(timeline, key, 'week');
    const todos = el('div', { class: 'week-todos' });
    renderCalendarBanners(todos, key);
    renderTodos(todos, key, { limit: 4, more: () => setMode('day', key) });
    col.append(timeline, label('todo'), todos, label('notes'),
      editable('div', 'ruled notes-text', d.notes, '', v => { d.notes = v; save(); }, { multiline: true, label: `Notes for ${shortDate(key)}` }));
    grid.append(col);
  }
  page.append(grid);
  book.append(page);
}
function weekListRow(key) {
  const d = dayData(key), date = fromKey(key);
  const blocks = [...d.blocks].sort((a, b) => a.start - b.start);
  const open = d.todos.length;
  return button([
    el('div', {}, el('strong', { class: key === todayKey() ? 'today' : '' }, String(date.getDate())), el('div', { class: 'mono ink-3' }, DOW[date.getDay()])),
    el('div', { style: 'display:flex;flex-direction:column;gap:6px;min-width:0' },
      el('span', { class: d.title ? '' : 'ink-3' }, d.title || 'a focus'),
      blocks.length ? el('div', { class: 'chips' }, blocks.map(b => el('span', { class: `chip hl-${b.color}` }, el('span', { class: 'mono' }, fmtTime(b.start)), b.title || '…'))) : null,
      open ? el('span', { class: 'mono ink-3' }, `${d.todos.filter(t => t.done).length} OF ${open} DONE`) : null),
  ], () => setMode('day', key), { class: 'week-list-row', 'aria-label': `Open ${shortDate(key)}` });
}

/* ---------- month ---------- */
function monthCells(first) {
  const date = fromKey(first);
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const offset = (date.getDay() + (sundayFirst() ? 0 : 6)) % 7;
  const weeks = Math.ceil((offset + count) / 7);
  const start = weekStart(first);
  return { count, weeks, keys: Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)) };
}
function renderMonth() {
  const first = monthStart(cursor), date = fromKey(first), monthKey = first.slice(0, 7);
  const { count, weeks, keys } = monthCells(first);
  const month = state.months[monthKey] || { notes: '' };
  const ensure = () => (state.months[monthKey] ||= { notes: '' });
  const focus = editable('div', 'focus', month.focus, 'a focus for the month', v => { ensure().focus = v; save(); }, { label: 'Focus for the month' });
  const page = el('section', { class: 'page month-sheet' }, head({ num: MONTHS[date.getMonth()].toLowerCase(), stack: [String(date.getFullYear()), `${count} DAYS`], focus }));
  if (phone.matches) { renderDotMonth(page, keys, monthKey); book.append(page); return; }
  const grid = el('div', { class: 'month-grid', style: `--weeks:${weeks}` });
  for (let i = 0; i < 7; i++) grid.append(el('div', { class: 'month-head label' }, DOW[fromKey(keys[i]).getDay()]));
  for (const key of keys) {
    const d = dayData(key);
    const cell = el('section', { class: `month-cell${key.slice(0, 7) !== monthKey ? ' outside' : ''}`, 'data-key': key });
    cell.onclick = e => { if (e.target === cell) openAddSheet(key); };
    cell.append(button(String(fromKey(key).getDate()), () => setMode('day', key), { class: `n${key === todayKey() ? ' today' : ''}`, 'aria-label': `Open ${shortDate(key)}` }));
    if (d.title) cell.append(el('span', { class: 'month-item focus' }, d.title));
    for (const event of calendarEvents(key)) cell.append(calendarButton(event, 'month-item hl-peri'));
    for (const b of [...d.blocks].sort((a, b) => a.start - b.start)) cell.append(button(b.title || 'untitled', () => setMode('day', key), { class: `month-item hl-${b.color}`, title: `${fmtRange(b.start, b.end)} · ${b.title}` }));
    for (const t of d.todos) cell.append(button(`${t.done ? '✓' : '□'} ${t.text || '…'}`, () => { t.done = !t.done; save(); render(); }, { class: `month-item todo-item${t.done ? ' done' : ''}`, 'aria-pressed': String(!!t.done), title: 'toggle done' }));
    if (d.notes) cell.append(button(d.notes.split('\n')[0], () => setMode('day', key), { class: 'month-item todo-item', title: 'open day notes' }));
    grid.append(cell);
  }
  const notes = el('aside', { class: 'month-notes' }, label('month notes'),
    editable('div', 'ruled', month.notes, 'room for the bigger picture', v => { ensure().notes = v; save(); }, { multiline: true, label: 'Month notes' }));
  page.append(el('div', { class: 'month-body' }, grid, notes));
  book.append(page);
}
function renderDotMonth(page, keys, monthKey) {
  const grid = el('div', { class: 'dot-month' });
  for (let i = 0; i < 7; i++) grid.append(el('span', { class: 'mono' }, DOW[fromKey(keys[i]).getDay()][0]));
  for (const key of keys) {
    const d = dayData(key);
    const pens = [...d.blocks.map(b => penOf(b.color)), ...calendarEvents(key).map(() => 'peri'), ...(d.todos.length ? ['bone'] : [])].slice(0, 3);
    grid.append(button([el('span', { class: `n${key === todayKey() ? ' today' : ''}${key === addSheetKey ? ' sel' : ''}` }, String(fromKey(key).getDate())),
      el('span', { class: 'dots' }, pens.map(p => el('i', { class: `hl-${p}` })))], () => openAddSheet(key),
      { class: `dot-day${key.slice(0, 7) !== monthKey ? ' outside' : ''}`, 'aria-label': `${shortDate(key)} · add` }));
  }
  const month = state.months[monthKey] || { notes: '' };
  page.append(grid, label('month notes'), editable('div', 'ruled', month.notes, 'room for the bigger picture', v => { (state.months[monthKey] ||= { notes: '' }).notes = v; save(); }, { multiline: true, label: 'Month notes' }));
}

/* tap a day to add: a loose sheet with a title, a kind, times and a pen */
let addSheetKey = null;
function openAddSheet(key) {
  closeAddSheet();
  addSheetKey = key;
  let kind = 'time block', color = state.settings.color, start = 9, end = 10;
  const sheet = el('section', { class: 'add-sheet loose', 'aria-label': `Add to ${shortDate(key)}` });
  const title = el('input', { 'aria-label': 'What', placeholder: 'what' });
  const draw = () => {
    sheet.className = `add-sheet loose hl-${penOf(color)}`;
    const s = el('select', { 'aria-label': 'Starts at' }), e = el('select', { 'aria-label': 'Ends at' });
    for (let t = DAY_START; t <= DAY_END; t += SNAP) {
      if (t < DAY_END) s.append(el('option', { value: t }, fmtTime(t)));
      if (t > DAY_START) e.append(el('option', { value: t }, fmtTime(t)));
    }
    s.value = start; e.value = end;
    s.onchange = () => { start = +s.value; if (end <= start) end = Math.min(DAY_END, start + 1); draw(); };
    e.onchange = () => { end = +e.value; if (end <= start) start = Math.max(DAY_START, end - 1); draw(); };
    const typed = title.value;
    sheet.replaceChildren(
      el('span', { class: 'grab' }),
      el('div', { class: 'sheet-row' }, el('span', { class: 'mono' }, `NEW · ${dayLabel(key)}`), button('open day ›', () => { closeAddSheet(); setMode('day', key); }, { class: 'quiet' }), button('cancel', closeAddSheet, { class: 'quiet' })),
      title,
      choice([['time block', 'time block'], ['todo', 'todo'], ['all day', 'all day']], kind, v => { kind = v; draw(); }),
      kind === 'time block' ? el('div', { class: 'sheet-row' }, el('span', { class: 'times mono' }, s, el('span', {}, '–'), e),
        el('span', { class: 'sheet-pens' }, PENS.slice(0, 6).map(c => button('', () => { color = c; draw(); }, { class: `sw hl-${c}${penOf(color) === c ? ' on' : ''}`, 'aria-label': PEN_NAMES[c] })))) : null,
      button(`add to ${dayLabel(key).toLowerCase()}`, add, { class: 'sheet-add' }));
    title.value = typed;
  };
  const add = () => {
    const text = title.value.trim();
    if (!text) { title.focus(); return; }
    const d = dayData(key);
    if (kind === 'time block') { d.blocks.push({ id: uid(), start, end, title: text, color }); state.settings.color = color; }
    else if (kind === 'todo') d.todos.push({ id: uid(), text, done: false, color: 'none' });
    else d.title = d.title ? `${d.title} · ${text}` : text;
    save(); closeAddSheet(); render();
  };
  title.onkeydown = e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') closeAddSheet(); };
  draw();
  document.body.append(sheet);
  title.focus();
  if (phone.matches) render();
}
function closeAddSheet() {
  const had = addSheetKey;
  addSheetKey = null;
  document.querySelector('.add-sheet')?.remove();
  if (had && phone.matches && surface === 'planner') render();
}

/* ---------- margin stationery: your stickies and the week card ---------- */
function marginVisible() {
  return !phone.matches && prefs().margin && bookFrame?.margin !== false && !['settings', 'daybook'].includes(surface);
}
function dockPosition() {
  const br = book.getBoundingClientRect(), sr = stationery.getBoundingClientRect();
  return { x: br.right - sr.left + 24, y: br.top - sr.top + 8 };
}
function makeDraggable(node, it, onClick) {
  node.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (e.target.closest('button, [contenteditable]')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = parseFloat(node.style.left), oy = parseFloat(node.style.top);
    const cur = { x: ox, y: oy };
    node.style.boxShadow = 'var(--lift)';
    trackPointer(e, node, {
      move(ev) {
        const sr = stationery.getBoundingClientRect();
        cur.x = clamp(ox + ev.clientX - sx, 0, sr.width - 60);
        cur.y = clamp(oy + ev.clientY - sy, 0, sr.height - 60);
        node.style.left = `${cur.x}px`; node.style.top = `${cur.y}px`;
      },
      end() { node.style.boxShadow = ''; it.x = cur.x; it.y = cur.y; it.docked = false; save(); },
      cancel() { node.style.boxShadow = ''; node.style.left = `${ox}px`; node.style.top = `${oy}px`; },
      click(ev) { node.style.boxShadow = ''; onClick?.(ev); },
    });
  });
}
function renderDesk() {
  stationery.replaceChildren();
  const dock = dockPosition();
  let y = dock.y;
  const place = (it, h) => {
    if (it.x == null) it.docked = true;
    if (it.docked) { it.x = dock.x; it.y = y; y += h; }
    return `left:${clamp(it.x, 0, Math.max(0, stationery.clientWidth - 200))}px;top:${clamp(it.y, 0, Math.max(0, stationery.clientHeight - 120))}px;--rot:${it.rot ?? -1}deg`;
  };
  for (const it of state.desk.items.filter(i => i.type === 'card')) renderCard(it, place(it, 200));
  let n = 0;
  for (const it of state.desk.items.filter(i => i.type === 'sticky')) {
    // Empty, never-moved stickies from earlier versions stay out of the way.
    if (!it.text && it.docked !== false) continue;
    renderSticky(it, place(it, 60 + 24 * n++));
  }
}
function renderSticky(it, style) {
  const node = el('div', { class: `loose sticky hl-${penOf(it.color)}`, style, 'data-id': it.id });
  const txt = editable('div', 'sticky-text', it.text, 'note to self', v => { it.text = v; save(); }, { multiline: true, label: 'Sticky note' });
  node.append(txt,
    swatchButton(it.color, c => { it.color = c; save(); renderDesk(); }, { row: true }),
    delButton(() => { if (it.text && !confirm('throw this sticky away?')) return; state.desk.items = state.desk.items.filter(x => x !== it); save(); renderDesk(); }, 'throw away'));
  makeDraggable(node, it, ev => focusEditable(txt, ev));
  stationery.append(node);
}
function renderCard(it, style) {
  const node = el('div', { class: 'card', style });
  const week = weekOf(cursor);
  node.append(el('div', { class: 'card-title' }, `week of ${shortDate(week[0])}`));
  for (const k of week) {
    const d = state.days[k];
    const open = d ? d.todos.filter(t => !t.done).length : 0;
    const bits = [];
    if (d?.title) bits.push(d.title);
    if (d?.blocks.length) bits.push(`${d.blocks.length} block${d.blocks.length > 1 ? 's' : ''}`);
    if (open) bits.push(`${open} todo${open > 1 ? 's' : ''}`);
    const onSpread = surface === 'planner' && (k === cursor || (!onePage() && k === addDays(cursor, 1)));
    const row = button([el('span', { class: 'card-day' }, dayLabel(k)), el('span', { class: 'card-sum' }, bits.join(' · '))],
      () => setMode('day', k), { class: `card-row${onSpread ? ' on' : ''}${k === todayKey() ? ' today' : ''}` });
    row.addEventListener('pointerdown', e => e.stopPropagation());
    node.append(row);
  }
  makeDraggable(node, it);
  stationery.append(node);
}

/* ================= notebooks ================= */
const entryDate = k => k ? upperDate(k) : '';
function openEntry(kind, id) { selection[kind] = id; detail = true; render(); }
function indexRow({ id, folio, title, by, heart, meta, strong, current, pen, onclick }) {
  return button([el('span', { class: 'folio mono' }, folio),
    el('span', { class: 'title' }, el('span', {}, title), by ? el('span', { class: 'by' }, by) : null, heart ? el('span', { class: 'heart', 'aria-label': 'liked' }, '♥') : null),
    el('span', { class: `meta mono${strong ? ' strong' : ''}` }, meta)], onclick,
  { class: `index-row${pen ? ` hl-${pen}` : ''}`, 'aria-current': String(!!current), 'data-entry': id });
}
// Typing a title updates its line in the index without redrawing the page.
const liveTitle = (id, text, fallback) => { const t = document.querySelector(`.index-row[data-entry="${id}"] .title > span`); if (t) t.textContent = text || fallback; };
function dateInput(value, onChange, labelText, placeholder = 'add date') {
  const shown = v => v ? upperDate(v) + (fromKey(v).getFullYear() !== new Date().getFullYear() ? ` ${fromKey(v).getFullYear()}` : '') : placeholder;
  const text = el('span', { class: 'date-text' }, shown(value));
  const input = el('input', { type: 'date', value: value || '', 'aria-label': labelText, tabindex: -1 });
  const field = el('button', { type: 'button', class: `date-field mono${value ? '' : ' empty'}`, 'aria-label': `${labelText}: ${value ? shortDate(value) : 'not set'}` }, text, input);
  field.onclick = () => { try { input.showPicker(); } catch (_) { input.focus(); input.click(); } };
  input.onchange = () => {
    text.textContent = shown(input.value);
    field.classList.toggle('empty', !input.value);
    onChange(input.value);
  };
  return field;
}

/* ---------- ideas: index + entry ---------- */
const IDEA_STATUS = ['captured', 'exploring', 'making', 'done'];
function renderIdeas() {
  const rows = state.trackers.ideas;
  const visible = rows.filter(x => !!x.archived === showArchived);
  const blank = () => ({ id: uid(), title: '', detail: '', notes: '', status: 'captured', date: todayKey() });
  let item = visible.find(x => x.id === selection.ideas) || visible[0] || null;
  if (!item && !showArchived) item = blank();
  if (item) selection.ideas = item.id;

  const index = el('section', { class: 'page', 'aria-label': 'Ideas index' },
    head({ num: 'ideas', stack: ['INDEX', `${visible.length} ${visible.length === 1 ? 'ENTRY' : 'ENTRIES'}`], actions: [archiveToggle(), phone.matches ? null : button('+ new idea', newIdea, { class: 'quiet' })] }));
  if (!visible.length) index.append(el('p', { class: 'empty-line' }, showArchived ? 'nothing archived.' : 'no ideas yet. the first one goes here.'));
  visible.forEach((x, i) => index.append(indexRow({ id: x.id, folio: pad(i + 1), title: x.title || (x.notes || '').split('\n')[0] || 'untitled idea', meta: (x.status || 'captured').toUpperCase(),
    current: !onePage() && x === item, pen: 'rose', onclick: () => openEntry('ideas', x.id) })));

  const entry = el('section', { class: 'page', 'aria-label': 'Idea' });
  if (item) {
    const persist = () => {
      if (!rows.includes(item)) { if (![item.title, item.detail, item.notes].some(v => v?.trim())) return; rows.push(item); }
      save();
    };
    const field = (key, cls, placeholder, multiline = false) => editable('div', cls, item[key], placeholder, v => {
      if ((item[key] || '') === v) return;
      item[key] = v; persist();
      if (key === 'title') liveTitle(item.id, v, 'untitled idea');
    }, { multiline, label: placeholder });
    entry.append(head({ num: pad(Math.max(0, visible.indexOf(item)) + 1 || visible.length + 1), stack: [(item.status || 'captured').toUpperCase(), el('span', {}, 'CAPTURED ', dateInput(item.date, v => { item.date = v; persist(); }, 'Captured on'))],
      actions: [rows.includes(item) ? button(item.archived ? 'restore' : 'archive', () => { item.archived = !item.archived; detail = false; save(); render(); }, { class: 'quiet' }) : null] }),
    el('div', {}, field('title', 'entry-title', 'an idea'), field('detail', 'entry-detail', 'theme or project')),
    choice(IDEA_STATUS.map(s => [s, s]), item.status || 'captured', v => { item.status = v; persist(); render(); }, { 'aria-label': 'Idea status' }),
    el('div', { class: 'section fill' }, label('notes'), field('notes', 'ruled writing', 'write it out…', true)));
  } else entry.append(head({ num: '', ghost: true }));
  mountPages(index, entry, 'ideas');
}
function newIdea() {
  const rows = state.trackers.ideas;
  const next = rows.find(x => !x.archived && !x.title && !x.detail && !x.notes) || { id: uid(), title: '', detail: '', notes: '', status: 'captured', date: todayKey() };
  if (!rows.includes(next)) rows.push(next);
  showArchived = false; selection.ideas = next.id; detail = true; save(); render();
  focusEditable($('.entry-title'));
}
// Spread: index left, entry right. One page: the index, or the entry once opened.
function mountPages(left, right, kind) {
  book.dataset.cover = kind;
  if (onePage()) { book.className = 'book single'; book.append(detail ? right : left); }
  else { book.className = 'book spread'; book.append(left, right); }
}

/* ---------- book log: contents, then a journal per book ---------- */
const READ_STATUS = ['want to read', 'reading', 'finished', 'set aside'];
const readMeta = x => x.status === 'finished' ? `FINISHED${x.date ? ' ' + upperDate(x.date) : ''}` : (x.status || 'want to read').toUpperCase();
function renderReading() {
  const rows = state.trackers.reading;
  const visible = rows.filter(x => !!x.archived === showArchived);
  const finished = visible.filter(x => x.status === 'finished').length;
  const left = el('section', { class: 'page', 'aria-label': 'Book log contents' },
    head({ num: 'book log', stack: ['CONTENTS', `${visible.length} BOOKS · ${finished} FINISHED`], actions: [archiveToggle(), phone.matches ? null : button('+ add book', addBook, { class: 'quiet' })] }));
  const right = el('section', { class: 'page', 'aria-label': 'Book log contents, continued' }, head({ num: 'book log', stack: ['CONTENTS', ''], ghost: true }));
  if (!visible.length) left.append(el('p', { class: 'empty-line' }, showArchived ? 'nothing archived.' : 'no books yet. add one you are reading now.'));
  const perPage = onePage() ? Infinity : Math.max(4, Math.floor(((bookFrame?.height || 700) - 150) / 48));
  visible.forEach((x, i) => (i < perPage ? left : right).append(indexRow({ folio: pad(i + 1), title: x.title || 'untitled book', by: x.detail, heart: x.liked,
    meta: readMeta(x), strong: x.status === 'reading', onclick: () => openJournal(x) })));
  book.dataset.cover = 'reading';
  book.className = onePage() ? 'book single' : 'book spread';
  book.append(left);
  if (!onePage()) book.append(right);
}
function openJournal(item) { journalId = item.id; surface = 'journal'; render(); }
function addBook() {
  const rows = state.trackers.reading;
  const keys = ['title', 'detail', 'notes', 'firstImpressions', 'summary', 'takeaways', 'finalThoughts', 'started', 'date'];
  let item = rows.find(x => !x.archived && keys.every(k => !x[k]) && !x.liked && x.recommend == null && x.reread == null);
  if (!item) { item = { id: uid(), title: '', detail: '', notes: '', status: 'want to read', date: '' }; rows.push(item); }
  showArchived = false; save(); openJournal(item);
  focusEditable($('.journal-title'));
}
function renderJournal() {
  const item = state.trackers.reading.find(x => x.id === journalId);
  if (!item) { journalId = null; surface = 'reading'; renderReading(); return; }
  const siblings = state.trackers.reading.filter(x => !!x.archived === !!item.archived);
  const index = siblings.indexOf(item);
  const field = (key, cls, placeholder) => editable('div', cls, item[key], placeholder, v => { item[key] = v; save(); }, { multiline: !cls.includes('title'), label: placeholder });
  const section = (key, name, minH, rule = true) => el('div', { class: `section${rule ? ' rule' : ''}${minH > 100 ? ' tall' : ''}` }, label(name), editable('div', 'ruled', item[key], '', v => { item[key] = v; save(); }, { multiline: true, label: name }));
  const left = el('section', { class: 'page', 'aria-label': 'Book journal' });
  const title = editable('h1', 'num title journal-title', item.title, 'a book', v => { item.title = v; save(); }, { label: 'Book title' });
  left.append(head({ num: title, actions: [button(item.liked ? '♥' : '♡', () => { item.liked = !item.liked; save(); render(); }, { class: 'like', 'aria-label': 'Like this book', 'aria-pressed': String(!!item.liked) })] }));
  const yesNo = key => choice([[true, 'yes'], [false, 'no']], item[key], v => { item[key] = item[key] === v ? null : v; save(); render(); }, { 'aria-label': key });
  left.append(el('div', { class: 'facts' },
    el('span', { class: 'label' }, 'author'), field('detail', 'author', 'who wrote it'),
    el('span', { class: 'label' }, 'status'), choice(READ_STATUS.map(s => [s, s]), item.status || 'want to read', v => {
      item.status = v;
      if (v === 'finished' && !item.date) item.date = todayKey();
      if (v === 'reading' && !item.started) item.started = todayKey();
      save(); render();
    }, { 'aria-label': 'Reading status' }),
    el('span', { class: 'label' }, 'dates'), el('span', { class: 'dates' }, dateInput(item.started, v => { item.started = v; save(); }, 'Started on'), el('span', { class: 'ink-3' }, '–'), dateInput(item.date, v => { item.date = v; save(); }, 'Finished on')),
    el('span', { class: 'label' }, 'recommend'), yesNo('recommend'),
    el('span', { class: 'label' }, 'reread'), yesNo('reread')));
  left.append(section('firstImpressions', 'first impressions'), section('summary', 'summary'), section('takeaways', 'takeaways'));
  const right = el('section', { class: 'page', 'aria-label': 'Book journal, final thoughts' });
  const go = step => { journalId = siblings[index + step].id; render(); };
  right.append(head({ num: el('span'), stack: [`BOOK ${pad(index + 1)}`, readMeta(item)], actions: [
    button('‹ previous', () => go(-1), { class: 'quiet', disabled: !siblings[index - 1] }),
    button('next ›', () => go(1), { class: 'quiet', disabled: !siblings[index + 1] }),
    button(item.archived ? 'restore' : 'archive', () => { item.archived = !item.archived; showArchived = !item.archived; journalId = null; surface = 'reading'; save(); render(); }, { class: 'quiet' })] }),
  section('finalThoughts', 'final thoughts', 144, false),
  el('div', { class: 'section rule fill' }, label('notes'), editable('div', 'ruled writing', item.notes, '', v => { item.notes = v; save(); }, { multiline: true, label: 'Notes' })));
  book.dataset.cover = 'reading';
  book.className = onePage() ? 'book single stacked' : 'book spread';
  book.append(left, right);
}

/* ---------- gratitude: the year in pixels and today ---------- */
const stripes = (bar, dir = 90) => `linear-gradient(${dir}deg, ${bar.map((v, i) => `${v >= 0 ? MOODS[v][1] : '#f5f4ef'} ${i * 20}% ${(i + 1) * 20}%`).join(', ')})`;
function moodPicker(key) {
  const wrap = el('div', { class: 'mood-picker' });
  const brushes = el('div', { class: 'moods', role: 'group', 'aria-label': 'Mood brush' },
    MOODS.map(([name, color], i) => button(name, () => { moodBrush = i; render(); }, { class: 'mood', style: `--mood:${color}`, 'aria-pressed': String(moodBrush === i) })),
    button('erase', () => { moodBrush = -1; render(); }, { class: 'mood', style: '--mood:#f7f6f2', 'aria-pressed': String(moodBrush === -1) }));
  const barEl = el('div', { class: 'mood-bar', role: 'group', 'aria-label': 'Mood through the day' });
  const cells = PARTS.map((part, i) => {
    const cell = el('span', { role: 'button', tabindex: 0, 'aria-label': `${part}: ${moodDay(key)[i] >= 0 ? MOODS[moodDay(key)[i]][0] : 'blank'}` });
    const v = moodDay(key)[i];
    if (v >= 0) cell.style.background = MOODS[v][1];
    cell.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); paint(i); render(); } };
    return cell;
  });
  barEl.append(...cells);
  const paint = i => {
    if (i < 0 || i > 4) return;
    const bar = (state.moodBar[key] ||= [-1, -1, -1, -1, -1]);
    if (bar[i] === moodBrush) return;
    bar[i] = moodBrush;
    cells[i].style.background = moodBrush >= 0 ? MOODS[moodBrush][1] : '';
    if (bar.every(v => v < 0)) delete state.moodBar[key];
    save();
  };
  const at = e => Math.floor((e.clientX - barEl.getBoundingClientRect().left) / barEl.offsetWidth * 5);
  barEl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    let last = at(e); paint(last);
    // Fill every slot between two pointer positions, however fast the stroke.
    const stroke = ev => { const i = clamp(at(ev), 0, 4); for (let j = Math.min(i, last); j <= Math.max(i, last); j++) paint(j); last = i; };
    trackPointer(e, barEl, { move: stroke, end: () => render(), click: () => render(), cancel: () => render() });
  });
  wrap.append(el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, label('mood'), el('span', { style: 'margin-left:auto' }, brushes)),
    barEl, el('div', { class: 'mood-labels mono' }, PARTS.map((p, i) => el('span', {}, phone.matches ? ['morn', 'mid', 'aft', 'eve', 'night'][i] : p))));
  return wrap;
}
function gratitudeLists(key, { today = true } = {}) {
  const g = gratitudeDay(key);
  const commit = () => save();
  const morning = el('div', { style: 'display:flex;flex-direction:column;gap:6px' },
    label('grateful for'), numberedLines(g.grateful, 3, commit));
  if (today) morning.append(label('what would make today good', { style: 'margin-top:6px' }), numberedLines(g.today, 2, commit));
  const evening = el('div', { class: 'evening' }, label('good things today'), numberedLines(g.good, 3, commit),
    label('what i learned', { style: 'margin-top:6px' }), numberedLines(g.learned, 1, commit));
  return [morning, evening];
}
function yearPixels(year, selected) {
  const grid = el('div', { class: 'pixels' }, el('span'));
  for (let m = 0; m < 12; m++) grid.append(el('span', { class: 'm' }, MONTHS[m][0]));
  const today = todayKey();
  for (let d = 1; d <= 31; d++) {
    grid.append(el('span', { class: 'd' }, d === 1 || d % 5 === 0 || d === 31 ? String(d) : ''));
    for (let m = 0; m < 12; m++) {
      const date = new Date(year, m, d);
      if (date.getMonth() !== m) { grid.append(el('span', { class: 'pixel none' })); continue; }
      const k = keyOf(date), bar = state.moodBar[k];
      const cell = button('', () => { bookDay = k; yearView = false; render(); }, { class: `pixel${k === selected ? ' sel' : ''}`, 'aria-label': shortDate(k), disabled: k > today });
      if (bar) cell.style.background = stripes(bar);
      grid.append(cell);
    }
  }
  return grid;
}
function gratitudeToday(key, actions = []) {
  const date = fromKey(key);
  return el('section', { class: 'page flush-bottom', 'aria-label': 'Gratitude today' },
    head({ num: String(date.getDate()), numClass: key === todayKey() ? 'today' : '', stack: [DOW[date.getDay()], monthYear(key)], actions }),
    moodPicker(key), ...gratitudeLists(key));
}
function renderGratitude() {
  const key = bookDay, date = fromKey(key);
  const yearPage = el('section', { class: 'page', 'aria-label': 'Year in moods' },
    head({ num: String(date.getFullYear()), stack: ['GRATITUDE', 'ONE STRIPE PER PART OF THE DAY'] }), yearPixels(date.getFullYear(), key));
  const today = gratitudeToday(key);
  if (phone.matches) {
    // one month strip below today's page; "year view" shows the whole year
    const strip = el('div', { class: 'pixels month-strip' });
    const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= 31; d++) {
      if (d > days) { strip.append(el('span', { class: 'pixel none' })); continue; }
      const k = keyOf(new Date(date.getFullYear(), date.getMonth(), d)), bar = state.moodBar[k];
      const cell = button('', () => { bookDay = k; render(); }, { class: `pixel${k === key ? ' sel' : ''}`, 'aria-label': shortDate(k), disabled: k > todayKey() });
      if (bar) cell.style.background = stripes(bar, 180);
      strip.append(cell);
    }
    today.insertBefore(el('div', {}, label(`${MONTHS[date.getMonth()]} · one stripe per part of the day`), strip), today.querySelector('.evening'));
  }
  book.dataset.cover = 'gratitude';
  if (onePage()) { book.className = 'book single'; book.append(phone.matches && yearView ? yearPage : today); }
  else { book.className = 'book spread'; book.append(yearPage, today); }
}

/* ---------- recipes: contents + a recipe ---------- */
function renderRecipes() {
  const rows = state.trackers.recipes;
  const visible = rows.filter(x => !!x.archived === showArchived);
  const item = visible.find(x => x.id === selection.recipes) || visible[0] || null;
  if (item) selection.recipes = item.id;
  const contents = el('section', { class: 'page', 'aria-label': 'Recipes contents' },
    head({ num: 'recipes', stack: ['CONTENTS', `${visible.length} RECIPES`], actions: [archiveToggle(), phone.matches ? null : button('+ add recipe', addRecipe, { class: 'quiet' })] }));
  if (!visible.length) contents.append(el('p', { class: 'empty-line' }, showArchived ? 'nothing archived.' : 'no recipes yet. the first one goes here.'));
  const groups = new Map();
  for (const r of visible) { const g = (r.group || '').trim().toLowerCase() || 'recipes'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  for (const [g, list] of groups) {
    const group = el('div', {}, groups.size > 1 || g !== 'recipes' ? label(g) : null);
    for (const r of list) group.append(indexRow({ id: r.id, folio: '', title: r.title || 'untitled recipe', meta: r.lastMade ? `LAST MADE ${upperDate(r.lastMade)}` : 'NOT YET',
      current: !onePage() && r === item, pen: 'clay', onclick: () => openEntry('recipes', r.id) }));
    contents.append(group);
  }
  const shop = el('div', { class: 'section' }, label('shopping'));
  todoList(state.shopping, shop, { onChange: save, focusKey: 'shopping' });
  if (state.shopping.some(i => i.done)) shop.append(button('clear checked', () => { state.shopping = state.shopping.filter(i => !i.done); save(); render(); }, { class: 'add' }));
  contents.append(shop);

  const page = el('section', { class: 'page', 'aria-label': 'Recipe' });
  if (item) {
    const text = (key, cls, placeholder, multiline = false) => editable('div', cls, item[key], placeholder, v => { item[key] = v; save(); }, { multiline, label: placeholder });
    item.ingredients ||= []; item.method ||= [];
    page.append(head({ num: editable('h1', 'num title', item.title, 'a recipe', v => { item.title = v; save(); liveTitle(item.id, v, 'untitled recipe'); }, { label: 'Recipe title' }),
      actions: [button(item.archived ? 'restore' : 'archive', () => { item.archived = !item.archived; detail = false; save(); render(); }, { class: 'quiet' })] }),
    el('div', { class: 'recipe-meta' },
      el('div', {}, el('span', { class: 'label' }, 'serves'), text('serves', '', '—')),
      el('div', {}, el('span', { class: 'label' }, 'time'), text('time', '', '—')),
      el('div', {}, el('span', { class: 'label' }, 'last made'), dateInput(item.lastMade, v => { item.lastMade = v; save(); }, 'Last made')),
      el('div', {}, el('span', { class: 'label' }, 'shelf'), text('group', '', 'weeknight'))));
    const ingredients = el('div', {}, label('ingredients'));
    todoList(item.ingredients, ingredients, { onChange: save, focusKey: `recipe-${item.id}` });
    ingredients.append(button('add unchecked to todo', () => addIngredientsToTodo(item), { class: 'add' }));
    const method = el('div', {}, label('method'), numberedLines(item.method, 4, save));
    page.append(el('div', { class: 'recipe-cols' }, ingredients, method),
      el('div', { class: 'section rule fill' }, label('notes'), text('notes', 'ruled writing', '', true)));
  } else page.append(head({ num: '', ghost: true }), el('p', { class: 'empty-line' }, 'choose a recipe, or add one.'));
  mountPages(contents, page, 'recipes');
}
function addRecipe() {
  const rows = state.trackers.recipes;
  const next = rows.find(x => !x.archived && !x.title && !x.ingredients?.length && !x.method?.some(Boolean) && !x.notes)
    || { id: uid(), title: '', group: '', serves: '', time: '', lastMade: '', ingredients: [], method: [], notes: '' };
  if (!rows.includes(next)) rows.push(next);
  showArchived = false; selection.recipes = next.id; detail = true; save(); render();
  focusEditable($('.head .num.title'));
}
function addIngredientsToTodo(item) {
  const todos = dayData(todayKey()).todos;
  const add = item.ingredients.filter(i => !i.done && i.text.trim() && !todos.some(t => t.text === i.text));
  for (const i of add) todos.push({ id: uid(), text: i.text, done: false, color: 'none' });
  save(); toast(add.length ? `added ${add.length} to today` : 'nothing left to add');
}

/* ---------- morning pages: two pages of plain lines ---------- */
let morningFeet = [];
function morningPage(key, i) {
  const cur = () => state.morningPages[key] || { pages: ['', ''] };
  const date = fromKey(key);
  const foot = el('footer', { class: 'page-foot mono' });
  const update = () => {
    const mp = cur(), total = words(mp.pages.join(' '));
    const minutes = mp.startedAt && mp.lastAt ? Math.max(1, Math.round((new Date(mp.lastAt) - new Date(mp.startedAt)) / 60000)) : 0;
    foot.replaceChildren(el('span', {}, i === 0 && mp.startedAt ? fmtClock(new Date(mp.startedAt)) : ''), el('span', {}, i === 1 && total ? `${total} WORDS${minutes ? ` · ${minutes} MIN` : ''}` : ''));
    const stats = document.querySelector('[data-words]');
    if (stats) stats.textContent = `${total} words`;
  };
  morningFeet.push(update);
  const text = editable('div', 'ruled morning-text', cur().pages[i], i === 0 ? 'just start writing.' : '', v => {
    const page = morningDay(key);
    if (page.pages[i] === v) return;
    page.pages[i] = v;
    const now = new Date().toISOString();
    page.startedAt ||= now; page.lastAt = now;
    save(); morningFeet.forEach(f => f());
  }, { multiline: true, label: `Morning pages, page ${i + 1}` });
  update();
  const mp = cur();
  const page = el('section', { class: 'page', 'aria-label': `Morning pages, page ${i + 1}` });
  page.append(head({ num: el('h1', { class: `num${key === todayKey() ? ' today' : ''}`, style: i ? 'visibility:hidden' : '' }, String(date.getDate())),
    stack: i ? [] : [DOW[date.getDay()], monthYear(key)], actions: [el('span', { class: 'mono ink-2' }, `PAGE ${i + 1} OF 2`)] }));
  page.append(text, foot);
  return page;
}
function renderMorning() {
  book.dataset.cover = 'morning';
  book.className = onePage() ? 'book single stacked' : 'book spread';
  book.append(morningPage(bookDay, 0), morningPage(bookDay, 1));
}

/* ---------- day book: a binder of today's pages from the real books ---------- */
let daybookAt = 'm1';      // the page the binder is open to
let daybookFlip = '';
let daybookChunks = [];    // the spreads (or single pages) as last laid out
// ‹ and › turn to the previous or next spread; the day book only has a few pages.
function flipDayBook(direction) {
  const at = daybookChunks.findIndex(c => c.includes(daybookAt));
  const next = daybookChunks[at + direction];
  if (!next) return;
  daybookFlip = direction > 0 ? 'flip-next' : 'flip-prev';
  daybookAt = next[0]; render();
}
function renderDayBook() {
  const key = bookDay, date = fromKey(key), pages = state.settings.dayBook;
  const mp = state.morningPages[key];
  const done = { morning: !!mp && words(mp.pages.join(' ')) > 0, schedule: dayData(key).blocks.length > 0, mood: !!state.moodBar[key] || gratitudeDay(key).grateful.some(Boolean) };
  // The pages follow from settings; the binder lays them out two to a spread,
  // or one at a time on a single page, and a lone last page stands by itself.
  const order = [pages.morning && 'm1', pages.morning && 'm2', pages.schedule && 'day', pages.mood && 'mood'].filter(Boolean);
  const per = onePage() ? 1 : 2;
  const chunks = [];
  for (let i = 0; i < order.length; i += per) chunks.push(order.slice(i, i + per));
  let at = chunks.findIndex(c => c.includes(daybookAt));
  if (at < 0) { at = 0; daybookAt = order[0]; }
  daybookChunks = chunks;
  const flipTo = id => {
    const to = chunks.findIndex(c => c.includes(id));
    if (to < 0 || to === at) return;
    daybookFlip = to > at ? 'flip-next' : 'flip-prev';
    daybookAt = id; render();
  };
  const steps = [['morning', 'morning pages', 'm1'], ['schedule', 'schedule', 'day'], ['mood', 'mood + gratitude', 'mood']].filter(([k]) => pages[k]);
  const now = steps.find(([k]) => !done[k])?.[0];
  const surfaceEl = el('div', { class: 'binder-surface' });
  surfaceEl.append(el('div', { class: 'binder-head' }, el('span', { class: 'num' }, String(date.getDate())),
    el('div', { class: 'stack mono', style: 'display:flex;flex-direction:column;line-height:14px' }, el('span', {}, `DAY BOOK · ${DOW[date.getDay()]}`), el('span', { style: 'color:var(--ink-2)' }, monthYear(key))),
    el('div', { class: 'steps' }, steps.map(([k, name, id]) => button(name, () => flipTo(id), { class: `step${done[k] ? ' done' : k === now ? ' now' : ''}`, 'data-mark': done[k] ? '✓' : '', 'aria-current': String(chunks[at].includes(id)) })))));
  if (!order.length) { surfaceEl.append(el('p', { class: 'empty-line', style: 'width:min(1180px,100%);margin:0 auto' }, 'choose the day book pages in settings.')); book.className = 'book binder-host'; delete book.dataset.cover; book.append(surfaceEl); return; }
  const tabs = [['morning pages', BOOKS.morning.cover, 'm1'], ['page 2', BOOKS.morning.cover, 'm2'], ['day', BOOKS.planner.cover, 'day'], ['gratitude', BOOKS.gratitude.cover, 'mood']]
    .filter(([, , id]) => order.includes(id) && (id !== 'm2' || per === 1));
  // The binder holds the books' own pages, at the planner's paper size.
  const link = (text, go) => button(text, go, { class: 'quiet' });
  const shown = chunks[at];
  const leaves = shown.map(id => {
    if (id === 'm1' || id === 'm2') {
      const page = morningPage(key, id === 'm1' ? 0 : 1);
      if (id === 'm1') page.querySelector('.head .actions')?.prepend(link('open ↗', () => { surface = 'morning'; render(); }));
      return page;
    }
    if (id === 'day') {
      const day = renderDayPage(key, { mini: shown.length === 1 });
      day.querySelector('.head').append(el('div', { class: 'actions', style: 'margin-left:14px' }, link('open ↗', () => setMode('day', key))));
      return day;
    }
    return gratitudeToday(key, [link('open ↗', () => { surface = 'gratitude'; render(); })]);
  });
  const lone = leaves.length === 1;
  const binder = el('div', { class: `binder${lone && per === 2 ? ' half' : ''}` },
    el('div', { class: 'divider-tabs', role: 'tablist', 'aria-label': 'Day book sections' },
      tabs.map(([name, c, id]) => button(name, () => flipTo(id), { role: 'tab', style: `--tab-c:${c}`, 'aria-selected': String(shown.includes(id)), 'aria-current': String(shown.includes(id)) }))),
    el('div', { class: `binder-leaves${lone ? ' one' : ''} ${daybookFlip}` }, ['18%', '50%', '82%'].map(top => el('span', { class: 'ring', style: `top:${top}` })), leaves));
  daybookFlip = '';
  surfaceEl.append(binder);
  book.className = 'book binder-host';
  delete book.dataset.cover;
  book.append(surfaceEl);
}

/* ================= the shelf and the sticky file ================= */
const shelfEl = $('#shelf');
function openBook(kind) {
  closeStack();
  detail = false; journalId = null; showArchived = false; yearView = false;
  if (kind === 'planner') { unfoldNext = !onePage() && state.settings.mode === 'day'; surface = 'planner'; }
  else { surface = kind; if (['gratitude', 'morning', 'daybook'].includes(kind)) bookDay = todayKey(); }
  render();
}
function renderShelf() {
  shelfEl.replaceChildren();
  const pile = el('div', { class: `pile${arriving ? ' arrive' : ''}` });
  arriving = false;
  const wide = phone.matches ? 30 : 0;
  for (const kind of PILE) {
    if (!state.shelf[kind]) continue;
    const b = BOOKS[kind];
    pile.append(button(el('span', { class: 'tag' }, b.name), () => openBook(kind),
      { class: `spine${kind === 'daybook' ? ' binder-spine' : ''}`, style: `--cover:${b.cover};--w:${b.w + wide}px`, 'aria-label': `Open ${b.name}` }));
  }
  shelfEl.append(el('h1', { class: 'shelf-title mono' }, 'dayblock'), pile, stickyFile());
}
function noteTint(note) { return note.dest === 'catchall' ? 'rgba(255,255,255,.62)' : `color-mix(in oklch, var(--pen-${BOOKS[note.dest]?.pen || 'bone'}) 62%, rgba(255,255,255,.72))`; }
function stickyFile() {
  const file = el('div', { class: 'file' });
  const recent = state.quickNotes.slice(-5).reverse();
  recent.forEach((note, i) => file.append(el('span', { class: `peek${note.dest === 'catchall' ? ' clear' : ''}`, style: `--b:${-20 + (4 - i) * 3};--x:${8 + i * 2};--w:${134 - i * 4};--z:${100 - i};--r:${[-1.5, 1.2, -.8, 1.6, -1][i]}deg;--tint:${noteTint(note)}` })));
  const front = button(el('span', { class: 'tag' }, 'stickies'), () => {
    if (state.quickNotes.length) { openStack(); return; }
    file.querySelector('.file-note')?.remove();
    const msg = el('span', { class: 'file-note', role: 'status' }, 'no quick notes yet');
    file.after(msg);
    setTimeout(() => msg.remove(), 2200);
  }, { class: 'file-front', 'aria-label': `Sticky file, ${state.quickNotes.length} notes` });
  file.append(front);
  const wrap = el('div', { style: 'position:relative;display:flex;flex-direction:column;align-items:center' }, file);
  return wrap;
}

/* ---------- the stack: every quick note, oldest at the top ---------- */
const stackEl = $('#stickyStack');
let stackSel = null;
const noteAt = iso => {
  const d = new Date(iso), k = keyOf(d), today = todayKey();
  if (k === today) return fmtClock(d);
  if (k > addDays(today, -7)) return DOW[d.getDay()];
  return upperDate(k);
};
function whereOf(note) {
  if (note.sorting) return 'SORTING…';
  if (note.dest === 'catchall') return 'STICKY FILE · NOT FILED YET';
  const when = note.date ? `${dayLabel(note.date)}${Number.isFinite(note.time) && note.section === 'time block' ? ` · ${fmtTime(note.time)} ${note.time < 12 ? 'AM' : 'PM'}` : ''}` : '';
  return `FILED UNDER ${[BOOKS[note.dest].name, note.section, when].filter(Boolean).join(' · ')}`.toUpperCase();
}
function linkOf(note) {
  if (note.dest === 'planner') return `open ${dayLabel(note.date || todayKey()).toLowerCase()} ↗`;
  if (note.dest === 'catchall') return '';
  return `open ${BOOKS[note.dest].name} ↗`;
}
function openFiled(note) {
  closeStack(true);
  const ref = note.ref || {};
  detail = false; showArchived = false; journalId = null;
  if (note.dest === 'planner') { surface = 'planner'; state.settings.mode = 'day'; cursor = note.date || todayKey(); }
  else if (note.dest === 'ideas') { surface = 'ideas'; if (ref.id) { selection.ideas = ref.id; detail = true; } }
  else if (note.dest === 'reading') { if (ref.id && state.trackers.reading.some(x => x.id === ref.id)) { journalId = ref.id; surface = 'journal'; } else surface = 'reading'; }
  else if (note.dest === 'recipes') { surface = 'recipes'; if (ref.kind === 'recipe') { selection.recipes = ref.id; detail = true; } }
  else { surface = note.dest; bookDay = note.date || todayKey(); }
  render();
}
function openStack() {
  stackSel = null;
  stackEl.hidden = false;
  stackEl.classList.remove('closing');
  renderStack();
  const scroller = stackEl.querySelector('.stack-scroll');
  requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
}
function closeStack(instant = false) {
  if (stackEl.hidden) return;
  if (instant) { stackEl.hidden = true; return; }
  stackEl.classList.add('closing');
  setTimeout(() => { stackEl.hidden = true; stackEl.classList.remove('closing'); if (surface === 'shelf') render(); }, 480);
}
const MOVES = Object.entries(Q.DESTS).flatMap(([book, d]) => book === 'catchall' ? [] : d.sections.map(section => [`${book}|${section}`, `${d.name} · ${section}`]));
function renderStack() {
  const notes = [...state.quickNotes].sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  const last = notes.length - 1;
  const sel = stackSel ?? last;
  const PK = 64, H = 180, OPEN = 236;
  const extra = sel < last ? OPEN - PK : OPEN - H;
  const inner = el('div', { class: 'stack-inner', style: `height:${Math.max(0, last) * PK + OPEN + 20 + (sel < last ? extra - (OPEN - H) : 0)}px` });
  notes.forEach((note, i) => {
    const open = i === sel, filed = note.dest !== 'catchall';
    const card = el('article', { class: `stack-card${filed ? '' : ' unsorted'}${open ? ' open' : ''}${note.done ? ' done' : ''} hl-${BOOKS[note.dest]?.pen || 'bone'}`,
      style: `top:${i * PK + (i > sel ? extra : 0)}px;height:${open ? OPEN : H}px;z-index:${i + 1};--r:${open ? 0 : [-.6, .5, -.3, .7, -.5, .4][i % 6]}deg;--dot:${BOOKS[note.dest]?.cover || '#b9b6ae'}`,
      tabindex: 0, 'aria-label': `Quick note: ${note.original}` });
    card.onclick = e => { if (e.target.closest('button, select')) return; stackSel = open ? null : i; renderStack(); };
    card.onkeydown = e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); } };
    const changed = filed && note.stored.trim().toLowerCase() !== note.original.trim().toLowerCase();
    const move = el('select', { 'aria-label': filed ? 'Move to another book' : 'File in a book' }, el('option', { value: '' }, filed ? 'move' : 'file in…'), MOVES.map(([v, t]) => el('option', { value: v }, t)));
    move.onchange = () => { const [bookKey, section] = move.value.split('|'); if (bookKey) moveNote(note, bookKey, section); };
    const actions = [move];
    if (filed) actions.push(button('restore', () => restoreNote(note)));
    else {
      actions.push(button(note.done ? 'reopen' : 'done', () => { note.done = !note.done; save(); renderStack(); }));
      if (state.ai.enabled && claudeKey()) actions.push(button('sort', () => sortNote(note)));
    }
    actions.push(button('delete', () => deleteQuickNote(note), { 'aria-label': filed ? 'Delete sticky; keep its notebook entry' : 'Delete sticky' }));
    card.append(el('div', { class: 'stack-top' }, el('span', { class: 'stack-text' }, note.original), el('span', { class: 'stack-at' }, noteAt(note.at))),
      el('div', { class: 'stack-meta' },
        el('span', { class: 'stack-where' }, whereOf(note)),
        el('div', { class: 'stack-line' }, el('span', { class: 'saved' }, filed ? (changed ? `saved as “${note.stored}”` : 'kept as written') : (note.note || 'as you wrote it')),
          filed ? button(linkOf(note), () => openFiled(note), { class: 'open-link' }) : null),
        el('div', { class: 'stack-line stack-actions' }, actions)));
    inner.append(card);
  });
  const scroll = el('div', { class: 'stack-scroll' }, notes.length ? [inner, el('p', { class: 'stack-count mono' }, `${notes.length} ${notes.length === 1 ? 'sticky' : 'stickies'}`)] : el('p', { class: 'stack-empty' }, 'no quick notes yet'));
  let ty = 0;
  scroll.addEventListener('wheel', e => { if (e.deltaY < -8 && scroll.scrollTop <= 0) closeStack(); }, { passive: true });
  scroll.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
  scroll.addEventListener('touchmove', e => { if (scroll.scrollTop <= 0 && e.touches[0].clientY - ty > 60) closeStack(); }, { passive: true });
  const top = stackEl.querySelector('.stack-scroll')?.scrollTop;
  stackEl.replaceChildren(button(el('span', { class: 'mono' }, 'go back'), () => closeStack(), { class: 'stack-handle', 'aria-label': 'Put stickies back' }), scroll);
  if (top != null) scroll.scrollTop = top;
}

/* ---------- quick note: a clear sticky from the bottom bar ---------- */
const quickEl = $('#quickNote'), quickText = $('#quickText'), quickPut = $('#quickPut');
function openQuickNote() {
  closePopover();
  quickEl.hidden = false;
  quickText.value = state.quickDraft || '';
  quickPut.classList.toggle('ready', !!quickText.value.trim());
  quickText.focus();
}
function closeQuickNote() { quickEl.hidden = true; }
quickText.oninput = () => { state.quickDraft = quickText.value; save(); quickPut.classList.toggle('ready', !!quickText.value.trim()); };
quickText.onkeydown = e => { if (e.key === 'Escape') closeQuickNote(); };
$('#quickClose').onclick = closeQuickNote;
quickPut.onclick = putAway;
let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
function putAway() {
  const text = quickText.value.trim();
  if (!text) { quickText.focus(); return; }
  const note = { id: uid(), original: text, dest: 'catchall', section: 'unsorted', date: '', time: null, stored: text, note: '', at: new Date().toISOString(), done: false, ref: null };
  state.quickNotes.push(note);
  state.quickDraft = ''; quickText.value = '';
  closeQuickNote(); save();
  toast('put on the stack');
  if (state.ai.enabled && claudeKey()) sortNote(note);
  else if (surface === 'shelf') render();
}
// Claude first; the keyword fallback only when Claude fails. The original words are always kept.
async function sortNote(note) {
  note.sorting = true;
  if (!stackEl.hidden) renderStack();
  let result, by;
  try { result = await Q.classifyWithClaude(note.original, { apiKey: claudeKey(), now: new Date() }); by = 'sorted by claude'; }
  catch (error) { console.warn('Claude sorting failed; using keywords.', error); result = Q.heuristic(note.original, new Date()); by = 'sorted by keywords'; }
  delete note.sorting;
  if (!state.quickNotes.includes(note)) return;
  fileNote(note, result, by);
}
function fileNote(note, r, by) {
  Q.unfile(state, note);
  const section = r.book === 'planner' && r.section === 'time block' && !Number.isFinite(r.time) ? 'todo' : r.section;
  Object.assign(note, { dest: r.book, section, date: r.date || '', time: Number.isFinite(r.time) ? r.time : null, duration: r.duration || 0, stored: r.text || note.original, note: by });
  if (['planner', 'gratitude', 'morning'].includes(note.dest) && !note.date) note.date = todayKey();
  if (!['planner', 'gratitude', 'morning'].includes(note.dest)) note.date = '';
  note.ref = Q.file(state, note, { uid, today: todayKey(), color: state.settings.color });
  save();
  if (!stackEl.hidden) renderStack();
  if (surface !== 'shelf' || stackEl.hidden) render();
}
function moveNote(note, bookKey, section) {
  const guess = Q.heuristic(note.original, new Date());
  fileNote(note, { book: bookKey, section, date: note.date || guess.date, time: note.time ?? guess.time, duration: note.duration || guess.duration,
    text: note.dest === 'catchall' && guess.book === bookKey ? guess.text : note.stored }, 'moved by you');
}
function restoreNote(note) {
  Q.unfile(state, note);
  Object.assign(note, { dest: 'catchall', section: 'unsorted', date: '', time: null, stored: note.original, note: 'restored' });
  save(); renderStack(); render();
}
function deleteQuickNote(note) {
  const filed = note.dest !== 'catchall';
  if (!confirm(filed ? 'Delete this sticky? Its entry in the notebook will stay.' : 'Delete this sticky?')) return;
  state.quickNotes = state.quickNotes.filter(item => item.id !== note.id);
  stackSel = null;
  save();
  renderStack();
  if (surface === 'shelf') renderShelf();
}

/* ================= settings: a spread at the back of the planner ================= */
function setRow(name, opts, { dot, note } = {}) {
  const row = el('div', { class: 'set-row' }, el('span', { class: 'name' }, dot ? el('span', { class: 'dot', style: `--dot:${dot}` }) : null, name), el('span', { class: 'opts' }, opts));
  return note ? [row, el('p', { class: 'set-note' }, note)] : [row];
}
const opt = (text, on, onclick, attrs = {}) => button(text, onclick, { class: `pill${attrs.action ? ' action' : ''}`, 'aria-pressed': String(!!on), ...attrs, action: null });
const toggleOpt = (on, flip) => opt(on ? 'on' : 'off', on, flip);
const setGroup = (name, ...rows) => el('div', { class: 'set-group' }, label(name), rows.flat());
const setAndRender = fn => () => { fn(); save(); render(); };
// Full settings open from the shelf. Inside a notebook, a small card with the everyday few.
let settingsFull = true;
function renderSettings() {
  const s = state.settings;
  const user = accountStatus.user;
  const hours = (field, delta) => setAndRender(() => {
    s[field] = clamp(s[field] + delta, field === 'workStart' ? DAY_START : DAY_START + 1, field === 'workStart' ? DAY_END - 1 : DAY_END);
    if (s.workEnd <= s.workStart) { if (field === 'workStart') s.workEnd = s.workStart + 1; else s.workStart = s.workEnd - 1; }
  });
  const dayRows = [
    ...setRow('hours shown', [['all', 'all day'], ['work', 'work'], ['off', 'after work']].map(([v, t]) => opt(t, s.view === v, setAndRender(() => { s.view = v; })))),
    ...(s.view === 'all' ? [] : setRow('work hours', [opt('‹', false, hours('workStart', -1), { 'aria-label': 'Start earlier' }), el('span', { class: 'mono', style: 'color:var(--ink)' }, fmtHour(s.workStart).toUpperCase()), opt('›', false, hours('workStart', 1), { 'aria-label': 'Start later' }),
      el('span', { class: 'ink-3' }, '–'), opt('‹', false, hours('workEnd', -1), { 'aria-label': 'End earlier' }), el('span', { class: 'mono', style: 'color:var(--ink)' }, fmtHour(s.workEnd).toUpperCase()), opt('›', false, hours('workEnd', 1), { 'aria-label': 'End later' })])),
    ...setRow('week starts on', [['mon', 'mon'], ['sun', 'sun']].map(([v, t]) => opt(t, s.weekStart === v, setAndRender(() => { s.weekStart = v; })))),
    ...setRow('writing lines', ['lines', 'dots', 'blank'].map(v => opt(v, s.ruling === v, setAndRender(() => { s.ruling = v; })))),
  ];
  const scrolls = [...settingsBook.querySelectorAll('.page')].map(p => p.scrollTop);
  settingsBook.dataset.cover = 'planner';
  if (!settingsFull) {
    const card = el('section', { class: 'page' },
      head({ num: 'settings', stack: [BOOKS[surface === 'journal' ? 'reading' : surface]?.name.toUpperCase() || '', ''] }),
      setGroup('day and paper', ...dayRows),
      button('all settings on the shelf ↗', () => { closeSettings(true); surface = 'shelf'; render(); openSettings(); }, { class: 'quiet', style: 'align-self:flex-start;min-height:36px' }));
    settingsBook.className = 'book settings-book single compact';
    settingsBook.replaceChildren(card);
    return;
  }
  const name = editable('span', '', state.user.name, 'your name', v => { state.user.name = v; save(); }, { label: 'Your name' });
  name.style.fontWeight = '500';
  const accountNote = user
    ? 'signed in with google. your notebooks save to your account and to this device.'
    : accountStatus.available ? 'your pages stay on this device until you sign in.'
      : 'your pages stay on this device. google sign-in isn’t set up yet.';
  const cal = calendarStatus, calConnected = !!state.googleCalendar.updatedAt;
  const left = el('section', { class: 'page' },
    head({ num: 'settings' }),
    setGroup('on the shelf', shelfPicker()),
    setGroup('day book', ...setRow('pages', [['morning', 'morning pages'], ['schedule', 'schedule'], ['mood', 'mood + gratitude']]
      .map(([k, t]) => opt(t, s.dayBook[k], setAndRender(() => { s.dayBook[k] = !s.dayBook[k]; }))))),
    setGroup('quick notes', ...quickNoteSettings()));
  const right = el('section', { class: 'page' },
    head({ num: 'settings', ghost: true }),
    setGroup('day and paper', ...dayRows),
    setGroup('you',
      ...setRow(el('span', {}, name, user?.email ? ` · ${user.email}` : ''), [
        user ? opt('account', false, () => account.open(), { action: true }) : accountStatus.available ? opt('sign in with google', true, () => account.signIn()) : null,
        user ? opt('sign out', false, () => $('#cloudSignOut').click(), { action: true }) : null,
      ], { note: accountNote }),
      ...setRow('google calendar', [
        cal.phase === 'unconfigured' ? el('span', { class: 'ink-3' }, 'not set up') : cal.phase === 'signin' || cal.phase === 'unavailable' ? el('span', { class: 'ink-3' }, 'comes with sign-in') : opt(cal.phase === 'connected' ? 'refresh' : calConnected ? 'reconnect' : 'connect', calConnected, connectCalendar, { disabled: ['loading', 'syncing', 'unavailable'].includes(cal.phase) }),
        calConnected ? opt('disconnect', false, disconnectCalendar, { action: true }) : null,
      ]),
      ...setRow('backups', [opt('export .json', false, () => $('#exportBackup').click(), { action: true }), opt('import', false, () => $('#importBackup').click(), { action: true })],
        { note: 'imports keep your existing entries.' })));
  settingsBook.className = `book settings-book ${phone.matches ? 'single stacked' : 'spread'}`;
  settingsBook.replaceChildren(left, right);
  settingsBook.querySelectorAll('.page').forEach((p, i) => { p.scrollTop = scrolls[i] || 0; });
}
/* settings rise from the bottom over whatever is open; click outside to put them away */
const settingsLayer = $('#settingsLayer'), settingsBook = $('#settingsBook');
let settingsOpen = false;
function openSettings() {
  closeQuickNote(); closeStack(true); closePopover();
  settingsFull = surface === 'shelf' || phone.matches;
  settingsOpen = true; settingsLayer.hidden = false; settingsLayer.classList.remove('closing');
  renderSettings(); renderBar();
  scene.inert = true; shelfEl.inert = true;
  settingsReturn = document.activeElement;
  settingsBook.querySelector('button, input, [contenteditable]')?.focus({ preventScroll: true });
}
let settingsReturn = null;
// Tab and shift-tab stay inside the settings book and its bar button.
settingsLayer.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const items = [...settingsBook.querySelectorAll('button:not([disabled]), input, [contenteditable]')].filter(n => n.offsetParent);
  if (!items.length) return;
  const first = items[0], last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
function closeSettings(instant = false) {
  if (!settingsOpen) return;
  if (instant) { settingsOpen = false; scene.inert = false; shelfEl.inert = false; settingsLayer.hidden = true; return; }
  settingsOpen = false;
  scene.inert = false; shelfEl.inert = false;
  if (settingsReturn?.isConnected) settingsReturn.focus({ preventScroll: true });
  settingsLayer.classList.add('closing');
  renderBar();
  setTimeout(() => { if (!settingsOpen) { settingsLayer.hidden = true; settingsLayer.classList.remove('closing'); } }, 320);
  render();
}
const toggleSettings = () => (settingsOpen ? closeSettings() : openSettings());
settingsLayer.addEventListener('pointerdown', e => { if (e.target === settingsLayer) closeSettings(); });
// A little pile of spines: tap one to put it on the shelf or take it off.
function shelfPicker() {
  const on = PILE.filter(k => state.shelf[k]).length;
  const pile = el('div', { class: 'mini-pile', role: 'group', 'aria-label': 'Books on the shelf' },
    PILE.map((k, i) => button(el('span', { class: 'tag' }, BOOKS[k].name), setAndRender(() => { state.shelf[k] = !state.shelf[k]; }), {
      class: `mini-spine${state.shelf[k] ? '' : ' off'}${k === 'daybook' ? ' binder-spine' : ''}`,
      style: `--cover:${BOOKS[k].cover};--w:${Math.round(BOOKS[k].w * .5)}px;--r:${[-1.2, .8, -.4, 1, -.8, .5, -.3][i]}deg`,
      'aria-pressed': String(!!state.shelf[k]), title: state.shelf[k] ? `take ${BOOKS[k].name} off the shelf` : `put ${BOOKS[k].name} on the shelf`,
    })));
  return [pile, el('p', { class: 'set-note' }, `${on} of ${PILE.length} on the shelf. tap a book to put it away or bring it back; nothing inside is lost.`)];
}
function quickNoteSettings() {
  const ai = state.ai.enabled, key = claudeKey();
  const rows = [...setRow('include quick notes with ai', [toggleOpt(ai, setAndRender(() => { state.ai.enabled = !ai; }))], {
    note: ai ? 'on: each quick note is read by claude and filed into the right book. the original words are always kept in the sticky file.'
      : 'off: quick notes stay analog. they wait in the sticky file, just as you wrote them, until you file them yourself.' })];
  if (!ai) return rows;
  if (key) {
    rows.push(...setRow('claude · connected', [opt('disconnect', false, () => { try { localStorage.removeItem(CLAUDE_KEY); } catch (_) { /* nothing stored */ } render(); }, { action: true })],
      { note: 'only the text of a quick note is sent, one at a time, when you put it away. nothing else in your books leaves this device. the key stays on this device and is never synced or exported.' }));
  } else {
    const input = el('input', { type: 'password', class: 'key', placeholder: 'anthropic api key', 'aria-label': 'Anthropic API key', autocomplete: 'off' });
    const connect = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } try { localStorage.setItem(CLAUDE_KEY, v); } catch (_) { toast('could not save the key'); } render(); };
    input.onkeydown = e => { if (e.key === 'Enter') connect(); };
    rows.push(...setRow('claude', [input, opt('connect claude →', true, connect)],
      { note: 'paste an anthropic api key to let claude sort. it stays on this device only. until then, quick notes stay in the sticky file.' }));
  }
  return rows;
}
function connectCalendar() {
  if (!calendarClient) return;
  if (calendarClient.validToken()) calendarClient.refresh(calendarWindow(), true);
  else calendarClient.connect(calendarWindow());
}
function disconnectCalendar() {
  state.googleCalendar = { events: [], updatedAt: null }; save();
  calendarClient?.disconnect(); render();
}

/* ================= onboarding: the post-it ================= */
const onboardEl = $('#onboarding');
const onboard = { name: '', local: false, picked: '' };
function renderOnboarding() {
  onboardEl.hidden = false;
  const signed = !!accountStatus.user;
  const named = !!onboard.name.trim(), stored = signed || onboard.local, picked = !!onboard.picked;
  const ready = named && stored && picked;
  const focused = document.activeElement?.id === 'onboardName';
  const box = on => el('span', { class: 'box', 'aria-hidden': 'true' }, on ? '✓' : '');
  const nameInput = el('input', { id: 'onboardName', value: onboard.name, placeholder: 'your name', 'aria-label': 'Your name', autocomplete: 'given-name' });
  nameInput.oninput = () => { onboard.name = nameInput.value; renderOnboarding(); };
  nameInput.onkeydown = e => { if (e.key === 'Enter' && !stored && accountStatus.available) account.signIn(); };
  const tasks = [
    el('div', { class: `task${named ? ' done' : ''}` }, box(named), el('span', { class: 'text' }, 'write your name')),
    button([box(stored), el('span', { class: 'text' }, 'sign in with Google')], () => { if (accountStatus.available && !signed) account.signIn(); else if (!accountStatus.available) { onboard.local = true; renderOnboarding(); } }, { class: `task${stored ? ' done' : ''}`, disabled: stored }),
    !signed && !onboard.local ? button(accountStatus.available ? 'or keep it on this device' : 'sign-in isn’t set up yet · keep it on this device', () => { onboard.local = true; renderOnboarding(); }, { class: 'aside-link' }) : null,
    el('div', { class: `task${picked ? ' done' : ''}` }, box(picked), el('span', { class: 'text' }, 'favorite color'),
      el('span', { class: 'dots' }, ['butter', 'rose', 'seafoam', 'peri', 'clay', 'moss'].map(c => button('', () => { onboard.picked = c; renderOnboarding(); }, { class: `hl-${c}`, 'aria-pressed': String(onboard.picked === c), 'aria-label': PEN_NAMES[c] })))),
    button([box(false), el('span', { class: 'text' }, 'start with your shelf →')], finishOnboarding, { class: 'task', disabled: !ready, style: ready ? '' : 'cursor:default' }),
  ];
  // Keep the same post-it so it drops in once, not on every keystroke.
  let postit = onboardEl.querySelector('.postit');
  if (!postit) { postit = el('div', { class: 'postit', role: 'dialog', 'aria-label': 'Welcome to Dayblock' }); onboardEl.replaceChildren(postit); }
  postit.replaceChildren(el('div', { class: 'hi' }, el('span', {}, 'hi, I am'), nameInput), ...tasks.filter(Boolean));
  if (focused || !onboard.name) { nameInput.focus(); nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length); }
}
function finishOnboarding() {
  state.user.name = onboard.name.trim();
  state.favoriteColor = onboard.picked;
  state.settings.color = onboard.picked;
  state.onboarded = true;
  save();
  onboardEl.classList.add('leaving');
  arriving = true; surface = 'shelf'; render();
  setTimeout(() => { onboardEl.hidden = true; onboardEl.classList.remove('leaving'); }, 820);
}

/* ================= the bottom bar ================= */
function renderBar() {
  const items = [];
  const b = (text, fn, attrs = {}) => button(text, fn, attrs);
  const grow = () => el('span', { class: 'grow' });
  const quick = () => b('quick note', openQuickNote, { class: 'quick-pill' });
  // Only the books that use hours carry settings; everything else lives on the shelf.
  const settings = () => phone.matches || !['shelf', 'planner', 'daybook'].includes(surface) ? null : b('settings', toggleSettings, { class: 'settings-btn', 'aria-expanded': String(settingsOpen) });
  const shelfBtn = () => b('shelf', () => { surface = 'shelf'; closeAddSheet(); render(); }, { class: 'first' });
  const dbAt = daybookChunks.findIndex(c => c.includes(daybookAt));
  const flipping = surface === 'daybook';
  const dates = () => [b('‹', () => navigate(-1), { class: 'arrow', 'aria-label': flipping ? 'Previous page' : 'Previous', title: flipping ? 'previous page (←)' : 'previous (←)', disabled: flipping && dbAt <= 0 }), b('today', goToday, { class: 'strong' }),
    b('›', () => navigate(1), { class: 'arrow', 'aria-label': flipping ? 'Next page' : 'Next', title: flipping ? 'next page (→)' : 'next (→)', disabled: flipping && dbAt >= daybookChunks.length - 1 }), el('span', { class: 'range' }, rangeText())];
  const primary = (text, fn) => phone.matches && text ? b(text, fn) : null;
  switch (surface) {
    case 'shelf':
      if (phone.matches) items.push(b('settings', toggleSettings, { class: 'settings-btn', 'aria-expanded': String(settingsOpen) }));
      else items.push(grow(), quick(), settings());
      break;
    case 'planner': items.push(shelfBtn(), ...dates(), grow(), quick(), settings()); break;
    case 'ideas': case 'recipes': {
      const back = onePage() && detail ? b(`‹ ${BOOKS[surface].name}`, () => { detail = false; render(); }) : null;
      const item = surface === 'ideas' ? state.trackers.ideas.find(x => x.id === selection.ideas) : state.trackers.recipes.find(x => x.id === selection.recipes);
      const action = !detail ? primary(surface === 'ideas' ? '+ new idea' : '+ add recipe', surface === 'ideas' ? newIdea : addRecipe)
        : surface === 'recipes' && item ? primary('add to todo', () => addIngredientsToTodo(item)) : item ? primary(item.archived ? 'restore' : 'archive', () => { item.archived = !item.archived; detail = false; save(); render(); }) : null;
      items.push(shelfBtn(), back, grow(), action, quick(), settings()); break;
    }
    case 'reading': items.push(shelfBtn(), grow(), primary('+ add book', addBook), quick(), settings()); break;
    case 'journal': {
      const item = state.trackers.reading.find(x => x.id === journalId);
      const siblings = state.trackers.reading.filter(x => !!x.archived === !!item?.archived);
      const next = siblings[siblings.indexOf(item) + 1];
      items.push(shelfBtn(), b('‹ book log', () => { journalId = null; surface = 'reading'; render(); }), grow(), next ? primary('next ›', () => { journalId = next.id; render(); }) : null, quick(), settings()); break;
    }
    case 'gratitude': items.push(shelfBtn(), ...dates(), grow(), primary(yearView ? 'day' : 'year', () => { yearView = !yearView; render(); }), quick(), settings()); break;
    case 'morning': {
      const mp = state.morningPages[bookDay];
      items.push(shelfBtn(), ...dates(), grow(), phone.matches ? el('span', { class: 'bar-text', 'data-words': '' }, `${mp ? words(mp.pages.join(' ')) : 0} words`) : null, quick(), settings()); break;
    }
    case 'daybook': items.push(shelfBtn(), ...dates(), grow(), quick(), settings()); break;
  }
  bar.replaceChildren(...items.filter(Boolean));
}

/* ================= render ================= */
function frame() {
  const barH = phone.matches ? 56 : 52;
  const navH = phone.matches ? 48 : 30 + 16;
  const height = Math.max(320, innerHeight - barH - navH - 12);
  const fit = window.DayblockLayout.fitBook({ width: innerWidth, paperHeight: height, single: onePage(), phone: phone.matches, marginRequested: !!prefs().margin });
  const wide = surface === 'planner' && (isWeek() || isMonth());
  const width = phone.matches ? innerWidth - 20 : wide ? Math.min(innerWidth - 48 - (prefs().margin && innerWidth - 304 >= 900 ? 256 : 0), onePage() ? 760 : 1180) : Math.min(fit.width, onePage() ? 640 : 1120);
  // The day book binder's cloth needs 60px beside the same paper.
  const width2 = surface === 'daybook' && !phone.matches ? Math.min(width, innerWidth - 48 - 60) : width;
  // The margin only takes genuinely spare room; the paper never shrinks for it.
  const margin = !phone.matches && !!prefs().margin && innerWidth - 48 >= width2 + 256;
  bookFrame = { ...fit, width: width2, height, margin };
  scene.style.setProperty('--book-paper-width', `${width2}px`);
  scene.style.setProperty('--book-paper-height', `${height}px`);
}
function render() {
  closePopover();
  const b = document.body;
  b.dataset.surface = surface;
  b.dataset.hl = state.settings.highlighters;
  b.dataset.desk = state.settings.desk === 'paper grey' ? '' : state.settings.desk;
  b.dataset.ruling = state.settings.ruling;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(b).getPropertyValue('--desk').trim() || '#f3f2ee';
  if (!state.onboarded) renderOnboarding(); else if (!onboardEl.classList.contains('leaving')) onboardEl.hidden = true;
  renderBar();
  if (settingsOpen) renderSettings();
  const shelfOpen = surface === 'shelf';
  shelfEl.hidden = !shelfOpen;
  scene.hidden = shelfOpen;
  if (shelfOpen) { renderShelf(); b.classList.remove('margin-open'); return; }

  const planner = surface === 'planner';
  $('.book-navigation').hidden = surface === 'daybook';
  $('.book-tabs').hidden = !planner;
  $('.book-tabs').parentElement.style.justifyContent = planner ? '' : 'flex-end';
  document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === state.settings.mode)));
  document.querySelectorAll('.paper-controls [data-paper]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.paper === paperMode())));
  frame();
  const margin = marginVisible();
  b.classList.toggle('margin-open', margin);
  const toggle = $('#toggleMargin');
  toggle.hidden = ['settings', 'daybook'].includes(surface);
  toggle.setAttribute('aria-pressed', String(margin));
  toggle.dataset.tucked = String(!!prefs().margin && !margin);
  toggle.title = prefs().margin && !margin ? 'the desk is tucked away to keep the book full size. it comes back when there is room.' : 'your stickies and week card beside the book';

  book.replaceChildren();
  morningFeet = [];
  book.removeAttribute('data-cover');
  switch (surface) {
    case 'planner':
      book.dataset.cover = 'planner';
      if (isWeek()) { book.className = 'book wide'; renderWeek(); }
      else if (isMonth()) { book.className = 'book wide'; renderMonth(); }
      else {
        book.className = `book ${onePage() ? 'single' : 'spread'}${unfoldNext ? ' unfold' : ''}`;
        book.append(renderDayPage(cursor, { mini: onePage() }));
        if (!onePage()) book.append(renderDayPage(addDays(cursor, 1), { mini: true }));
        unfoldNext = false;
      }
      break;
    case 'ideas': renderIdeas(); break;
    case 'reading': renderReading(); break;
    case 'journal': renderJournal(); break;
    case 'gratitude': renderGratitude(); break;
    case 'recipes': renderRecipes(); break;
    case 'morning': renderMorning(); break;
    case 'daybook': renderDayBook(); renderBar(); break;
  }
  stationery.hidden = !margin;
  if (margin) renderDesk();
}

/* ================= start ================= */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!stackEl.hidden) closeStack();
  else if (settingsOpen) closeSettings();
  else if (!quickEl.hidden) closeQuickNote();
  else if (addSheetKey) closeAddSheet();
});
phone.addEventListener('change', () => render());
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!document.activeElement?.isContentEditable && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) render();
  }, 150);
});
carryOver();
render();
const calendarClientId = window.DAYBLOCK_CONFIG?.googleClientId || '';
calendarClient = window.DayblockCalendar.createClient({
  clientId: calendarClientId,
  // Without a separate client ID, calendar access comes with Google sign-in.
  tokenSource: calendarClientId ? null : { available: () => !!account?.calendar.available(), request: () => account.calendar.request() },
  onStatus({ phase, message }) {
    calendarStatus = { phase, message };
    if (settingsOpen && !document.activeElement?.isContentEditable) renderSettings();
  },
  onEvents(data) {
    state.googleCalendar = data; save();
    const focused = document.activeElement;
    if (focused?.isContentEditable && book.contains(focused)) focused.addEventListener('blur', () => setTimeout(render, 0), { once: true });
    else render();
  },
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCalendar(); });
window.addEventListener('pageshow', refreshCalendar);
calendarClient.prepare();
account = window.DayblockAccount.create({
  getState: () => state,
  blank: () => migrate({ ...defaultState(), onboarded: true }),
  onReport(status) {
    const changed = !!status.user !== !!accountStatus.user || status.available !== accountStatus.available;
    accountStatus = { ...accountStatus, ...status };
    if (!changed) return;
    calendarClient?.prepare();
    if (!state.onboarded) renderOnboarding();
    else if (settingsOpen && !document.activeElement?.isContentEditable) renderSettings();
  },
  apply(data) {
    // Cloud/guest switches must not retain a Google Calendar access token.
    if (calendarClient?.validToken()) calendarClient.disconnect();
    const onboarded = state.onboarded, user = state.user;
    state = migrate(window.DayblockCloudData.validate(data));
    // A fresh account inherits this device's welcome rather than asking again.
    if (!state.onboarded && onboarded) { state.onboarded = true; state.user = user; }
    journalId = null; detail = false;
    quickText.value = state.quickDraft || '';
    carryOver();
    render();
  },
});
// Signing in with Google also brings the calendar along; no second connect needed.
account.calendar.onToken(token => calendarClient.useToken(token, calendarWindow()));
})();
