/* Dayblock — a two-page planner on a desk.
   Everything lives in localStorage; no build step, no dependencies. */
(() => {
'use strict';

const STORAGE_KEY = 'spread-planner.v1';
const DAY_START = 8;      // 8 am
const DAY_END = 24;       // midnight
const SNAP = 0.25;        // 15 minutes

const PALETTE = ['yellow', 'peach', 'pink', 'lilac', 'blue', 'sky', 'mint', 'green', 'grey', 'none'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = t => Math.round(t / SNAP) * SNAP;
const pad = n => String(n).padStart(2, '0');

// 12-hour clock: 8 … 12, 1 … 12. 24 is midnight.
const h12 = t => ((Math.floor(t) + 11) % 12) + 1;
const mins = t => Math.round((t - Math.floor(t)) * 60);
const ampm = t => (t % 24) < 12 ? 'am' : 'pm';
const fmtTime = t => `${h12(t)}:${pad(mins(t))}`;                                        // 12:30
const fmtHourBare = t => `${h12(t)}${mins(t) ? ':' + pad(mins(t)) : ''}`;              // 12:30
const fmtHour = t => `${fmtHourBare(t)} ${ampm(t)}`;                                     // 12:30 pm
const fmtRange = (a, b) => `${ampm(a) === ampm(b) ? fmtHourBare(a) : fmtHour(a)} – ${fmtHour(b)}`;

const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const todayKey = () => keyOf(new Date());
const nowHours = () => { const n = new Date(); return n.getHours() + n.getMinutes() / 60; };
const weekOf = key => {                       // Monday … Sunday around a day
  const mon = addDays(key, -((fromKey(key).getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
};
const shortDate = k => { const d = fromKey(k); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
const weekStart = k => addDays(k, -((fromKey(k).getDay() + 6) % 7));
const monthStart = k => k.slice(0, 7) + '-01';
const isWeek = () => state.settings.mode === 'week';
const isMonth = () => state.settings.mode === 'month';

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

/* ---------- state ---------- */
function defaultState() {
  return {
    settings: { view: 'all', workStart: 9, workEnd: 18, color: 'yellow', habitsOpen: false },
    days: {},
    habits: [],          // [{ id, name }]
    habitLog: {},        // { 'YYYY-MM-DD': { habitId: true } }
    desk: { items: [] }, // stationery; see migrate()
  };
}
function migrate(s) {
  s.settings.habitsOpen ??= false;
  s.habits ||= [];
  s.habitLog ||= {};
  s.desk ||= { items: [] };
  const has = type => s.desk.items.some(i => i.type === type);
  if (!has('sticky')) s.desk.items.push({ id: uid(), type: 'sticky', x: null, y: null, rot: -2, color: 'yellow', text: '' });
  if (!has('tray')) s.desk.items.push({ id: uid(), type: 'tray', x: null, y: null, rot: 1.2 });
  if (!has('card')) s.desk.items.push({ id: uid(), type: 'card', x: null, y: null, rot: -1 });
  return s;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.settings && s.days) return migrate(s);
  } catch (_) { /* fall through */ }
  return migrate(defaultState());
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function dayData(k) {
  const d = (state.days[k] ||= { title: '', blocks: [], todos: [], notes: '', done: '' });
  // older versions kept notes as positioned scraps; fold them into plain text
  if (Array.isArray(d.notes)) d.notes = d.notes.map(n => n.text).filter(Boolean).join('\n');
  d.done ??= '';
  return d;
}

let state = load();
if (!['day', 'week', 'month'].includes(state.settings.mode)) state.settings.mode = 'day';
// Separate device preferences so desktop opens as a spread without narrowing phones.
const paperPreferences = state.settings.paperPreferences ||= {};
if (!['page', 'spread'].includes(paperPreferences.desktop)) paperPreferences.desktop = 'spread';
if (!['page', 'spread'].includes(paperPreferences.phone)) paperPreferences.phone = 'page';
paperPreferences.margin ??= true;
state.months ||= {};
state.trackers ||= { ideas: [], reading: [] };
state.catchall ||= { draft: '', items: [] };
state.googleCalendar ||= { events: [], updatedAt: null };
let calendarClient = null;
let activeBook = 'shelf';
let trackerKind = 'ideas';
let showArchived = false;
let journalId = null;
const notebookSelection = { ideas: null, reading: null };
let notebookDetail = null;
const phone = matchMedia('(max-width: 700px)');
const paperMode = () => paperPreferences[phone.matches ? 'phone' : 'desktop'];
const singlePage = () => paperMode() === 'page';
let bookFrame = null;
const gridLayouts = new WeakMap();
const marginVisible = () => !phone.matches && paperPreferences.margin && bookFrame?.margin !== false;
let paperPart = 0;
phone.addEventListener('change', () => render());
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!document.activeElement?.isContentEditable && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) render();
  }, 150);
});
let cursor = todayKey();          // left page of the current spread
let lastToday = todayKey();
const fresh = new Set();          // ids of just-drawn blocks; they vanish if left untitled
const calendarEvents = key => window.DayblockCalendar.eventsOnDate(state.googleCalendar.events, key);
const calendarWindow = () => window.DayblockCalendar.windowFor(cursor);
const refreshCalendar = () => calendarClient?.refresh(calendarWindow());

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
function layout(key = cursor) {
  return window.DayblockLayout.timeline({ ...state.settings, hidePast: !!state.settings.hidePastHours,
    today: key === todayKey(), now: nowHours(), weekly: isWeek(),
    paperHeight: bookFrame?.height || Math.max(240, innerHeight - (phone.matches ? 132 : 144)) });
}
const { timeToY, yToTime } = window.DayblockLayout;
const hiddenIn = (b, L) => L.items.some(it => it.type !== 'seg' && b.start >= it.from && b.end <= it.to);

function positionBlock(node, start, end, L) {
  const top = timeToY(Math.max(start, L.start), L);
  const h = Math.max(timeToY(end, L) - top, 2);
  node.style.top = `${top}px`;
  node.style.height = `${h}px`;
  node.classList.toggle('compact', h < 30);
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
function focusEditable(node, ev) {
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

/* ---------- colour popover ---------- */
const popover = $('#popover');
let closePopover = () => {};
function openPalette(anchor, current, onPick) {
  popover.innerHTML = '';
  for (const c of PALETTE) {
    const b = el('button', { class: `sw hl-${c}${c === current ? ' on' : ''}`, title: c });
    b.onclick = () => { closePopover(); onPick(c); };
    popover.append(b);
  }
  const r = anchor.getBoundingClientRect();
  popover.classList.add('open');
  const pw = popover.offsetWidth;
  popover.style.left = `${clamp(r.left + r.width / 2 - pw / 2, 8, innerWidth - pw - 8)}px`;
  popover.style.top = `${r.bottom + 6}px`;
  const onDoc = ev => { if (!popover.contains(ev.target)) closePopover(); };
  closePopover = () => {
    popover.classList.remove('open');
    document.removeEventListener('pointerdown', onDoc, true);
    closePopover = () => {};
  };
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true));
}
function swatchButton(current, onPick) {
  const b = el('button', { class: 'swatch-btn', title: 'highlight' });
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.onclick = e => { e.stopPropagation(); openPalette(b, current, onPick); };
  return b;
}
function delButton(onDel) {
  const b = el('button', { class: 'del', title: 'remove' }, '×');
  b.addEventListener('pointerdown', e => e.stopPropagation());
  b.onclick = e => { e.stopPropagation(); onDel(); };
  return b;
}

/* ---------- toolbar ---------- */
const viewSel = $('#view'), wsSel = $('#ws'), weSel = $('#we');

// One unsorted inbox shared by all three notebooks; never guesses a destination.
const catchallInput = $('#catchallInput');
catchallInput.value = state.catchall.draft;
catchallInput.oninput = () => { state.catchall.draft = catchallInput.value; save(); };
function renderCatchall() {
  const drawer = $('#catchallDrawer');
  const count = state.catchall.items.filter(item => !item.done).length;
  $('#toggleCatchall').textContent = count ? `catchall · ${count}` : 'catchall';
  drawer.replaceChildren();
  if (!state.catchall.items.length) drawer.append(el('p', { class: 'catchall-empty' }, 'A place for things that don’t have a place yet.'));
  for (const item of [...state.catchall.items].reverse()) {
    const row = el('div', { class: `catchall-item${item.done ? ' done' : ''}` });
    const check = el('button', { type: 'button', class: 'check', 'aria-label': item.done ? 'Reopen catchall note' : 'Mark catchall note done', 'aria-pressed': String(item.done) }, item.done ? '×' : '');
    check.onclick = () => { item.done = !item.done; save(); renderCatchall(); };
    const text = el('div', { class: 'catchall-text', role: 'textbox', 'aria-label': 'Saved catchall note' }, item.text);
    bindEditable(text, value => { item.text = value; save(); }, { multiline: true });
    row.append(check, text); drawer.append(row);
  }
}
$('#catchallForm').onsubmit = e => {
  e.preventDefault();
  const text = catchallInput.value.trim();
  if (!text) return;
  state.catchall.items.push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
  state.catchall.draft = ''; catchallInput.value = ''; save(); renderCatchall();
  catchallInput.focus();
};
$('#toggleCatchall').onclick = () => {
  const drawer = $('#catchallDrawer');
  drawer.hidden = !drawer.hidden;
  $('#toggleCatchall').setAttribute('aria-expanded', String(!drawer.hidden));
  if (!drawer.hidden) {
    $('#plannerTools').hidden = true;
    document.body.classList.remove('tools-open');
    $('#toggleTools').setAttribute('aria-expanded', 'false');
  }
};
renderCatchall();

function renderToolbar() {
  const s = state.settings;
  document.querySelectorAll('.paper-controls [data-paper]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.paper === paperMode())));
  $('#toggleMargin').hidden = phone.matches;
  $('#toggleMargin').setAttribute('aria-pressed', String(marginVisible()));
  $('#toggleMargin').title = paperPreferences.margin && !marginVisible() && !phone.matches
    ? 'Margin tucked away to keep the book full size. It will return when there is room.' : 'Show or hide stationery beside the book';
  $('#toggleMargin').dataset.tucked = String(!phone.matches && !!paperPreferences.margin && !marginVisible());
  $('#addSticky').hidden = phone.matches;
  $('#hidePastHours').checked = !!s.hidePastHours;
  $('#hidePastHours').disabled = isWeek() || isMonth();
  $('#hidePastHours').closest('label').title = 'Fold completed hours on today’s daily page. Weekly columns keep their shared time scale.';
  document.querySelectorAll('[data-mode]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode));
  });
  viewSel.closest('.group').hidden = isMonth();
  viewSel.value = s.view;
  wsSel.innerHTML = ''; weSel.innerHTML = '';
  for (let h = DAY_START; h < DAY_END; h++) wsSel.append(el('option', { value: h }, fmtHour(h)));
  for (let h = DAY_START + 1; h <= DAY_END; h++) weSel.append(el('option', { value: h }, fmtHour(h)));
  wsSel.value = s.workStart; weSel.value = s.workEnd;
  $('.hours').style.opacity = s.view === 'all' ? .5 : 1;

  const start = isMonth() ? monthStart(cursor) : isWeek() ? weekStart(cursor) : cursor;
  const a = fromKey(start), b = fromKey(addDays(start, isWeek() ? 6 : singlePage() ? 0 : 1));
  const mo = d => MONTHS[d.getMonth()].slice(0, 3);
  $('#range').textContent = a.getMonth() === b.getMonth()
    ? `${mo(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
    : `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}, ${b.getFullYear()}`;
  if (isMonth()) $('#range').textContent = `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  else if (!isWeek() && singlePage()) $('#range').textContent = `${mo(a)} ${a.getDate()}, ${a.getFullYear()}`;
}

document.querySelectorAll('.paper-controls [data-paper]').forEach(b => b.onclick = () => {
  paperPreferences[phone.matches ? 'phone' : 'desktop'] = b.dataset.paper;
  paperPart = 0; save(); render();
});
$('#toggleMargin').onclick = () => { paperPreferences.margin = !paperPreferences.margin; save(); render(); };
$('#hidePastHours').onchange = e => { state.settings.hidePastHours = e.target.checked; save(); render(); };

function updateBookFrame() {
  if (activeBook === 'shelf') return;
  const footer = Math.ceil($('.toolbar').getBoundingClientRect().height);
  const height = Math.max(240, innerHeight - footer - (phone.matches ? 52 : 64));
  // Use the same closed-bar proportions for every notebook. Extra navigation
  // or expanded settings may shorten the paper, but never change its width.
  const sizingHeight = Math.max(240, innerHeight - 81 - (phone.matches ? 52 : 64));
  bookFrame = { ...window.DayblockLayout.fitBook({ width: innerWidth, paperHeight: sizingHeight,
    single: singlePage(), phone: phone.matches, marginRequested: !!paperPreferences.margin }), height, footer };
  scene.style.setProperty('--book-paper-width', `${bookFrame.width}px`);
  scene.style.setProperty('--book-paper-height', `${height}px`);
  scene.style.setProperty('--book-footer-height', `${footer}px`);
}

function setMode(mode, key = cursor) {
  paperPart = 0;
  activeBook = 'planner';
  cursor = key;
  state.settings.mode = mode;
  save(); render(); refreshCalendar();
}
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function navigate(direction) {
  if (isMonth()) {
    const d = fromKey(cursor);
    cursor = keyOf(new Date(d.getFullYear(), d.getMonth() + direction, 1));
  } else cursor = addDays(cursor, direction * (isWeek() ? 7 : singlePage() ? 1 : 2));
  render(); refreshCalendar();
}

viewSel.onchange = () => { state.settings.view = viewSel.value; save(); render(); };
wsSel.onchange = () => {
  const s = state.settings;
  s.workStart = Number(wsSel.value);
  if (s.workEnd <= s.workStart) s.workEnd = s.workStart + 1;
  save(); render();
};
weSel.onchange = () => {
  const s = state.settings;
  s.workEnd = Number(weSel.value);
  if (s.workStart >= s.workEnd) s.workStart = s.workEnd - 1;
  save(); render();
};
$('#prev').onclick = () => navigate(-1);
$('#next').onclick = () => navigate(1);
$('#today').onclick = () => { cursor = todayKey(); render(); refreshCalendar(); };
$('#addSticky').onclick = () => {
  paperPreferences.margin = true;
  const n = state.desk.items.filter(i => i.type === 'sticky').length;
  const p = defaultPos('sticky');
  state.desk.items.push({
    id: uid(), type: 'sticky', docked: true, x: p.x + (n % 3) * 18, y: p.y + n * 40,
    rot: (n % 2 ? 1.5 : -2) + (Math.random() - .5), color: state.settings.color, text: '',
  });
  save(); render();
  const last = $('#stationery .sticky:last-of-type .sticky-text');
  last && focusEditable(last);
};
document.addEventListener('keydown', e => {
  if (e.target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (activeBook !== 'planner') return;
  if (e.key === 'ArrowLeft') $('#prev').click();
  if (e.key === 'ArrowRight') $('#next').click();
});

/* ---------- a page (one day) ---------- */
function plannerHeading(value, label, context, { today = false, title = null } = {}) {
  return el('header', { class: `page-head planner-heading${today ? ' today' : ''}` },
    el('h1', { class: 'day-num' }, value),
    el('div', { class: 'planner-heading-context' },
      label ? el('div', { class: 'dow' }, label) : null,
      el('div', { class: 'month' }, context)),
    title);
}

function renderPage(pageEl, key) {
  const d = dayData(key);
  const date = fromKey(key);
  pageEl.innerHTML = '';
  pageEl.dataset.key = key;

  const title = el('div', { class: 'page-title', 'data-placeholder': 'title' });
  title.textContent = d.title;
  bindEditable(title, v => { d.title = v; save(); });
  pageEl.append(plannerHeading(String(date.getDate()), DOW[date.getDay()],
    `${MONTHS[date.getMonth()]} ${date.getFullYear()}`, { today: key === todayKey(), title }));

  if (pageEl.dataset.side === (singlePage() ? 'left' : 'right')) renderHabits(pageEl, key);

  const timeline = el('div', { class: 'timeline' });
  renderTimeline(timeline, key);

  const side = el('div', { class: 'side' });
  renderCalendarBanners(side, key);
  const todo = el('div', { class: 'todo-section' }, el('h3', {}, el('span', {}, 'todo')));
  renderTodos(todo, key);
  const done = el('div', { class: 'done-section' }, el('h3', {}, el('span', {}, 'deliverables')));
  renderTextField(done, 'done-text', d.done, v => { d.done = v; save(); }, 'what got done');
  const notes = el('div', { class: 'notes' }, el('h3', {}, el('span', {}, 'notes')));
  renderTextField(notes, 'notes-text', d.notes, v => { d.notes = v; save(); }, 'notes');
  side.append(todo, done, notes);
  if (pageEl.dataset.side === 'right') renderMiniCal(side, key);

  pageEl.append(el('div', { class: 'page-body' }, timeline, side));
}

function renderTextField(container, cls, value, commit, placeholder) {
  const txt = el('div', { class: cls, 'data-placeholder': placeholder });
  txt.textContent = value;
  bindEditable(txt, commit, { multiline: true });
  container.append(txt);
}

/* ---------- timeline ---------- */
function renderTimeline(container, key) {
  const d = dayData(key);
  const imported = calendarEvents(key).filter(event => !event.allDay && event.end > DAY_START && event.start < DAY_END)
    .map(event => ({ ...event, start: Math.max(DAY_START, event.start), end: Math.min(DAY_END, event.end) }));
  const blocks = [...d.blocks, ...imported];
  const L = layout(key);
  const grid = el('div', { class: 'grid', 'data-day': key, style: `height:${L.height}px` });
  gridLayouts.set(grid, L);

  for (const it of L.items) {
    if (it.type !== 'seg') {
      const n = blocks.filter(b => hiddenIn(b, L) && b.start >= it.from && b.end <= it.to).length;
      const gap = el('button', { type: 'button',
        class: `gap${it.type === 'past' ? ' past-gap' : ''}`, style: `top:${it.y}px;height:${it.h}px`, title: it.type === 'past' ? 'Show past hours' : 'show all hours',
      }, it.type === 'past' ? `earlier hours${n ? ` · ${n} ${n === 1 ? 'event' : 'events'}` : ''} · show` : `${fmtRange(it.from, it.to)}${n ? ` · ${n} hidden` : ''}`);
      gap.onclick = e => {
        e.stopPropagation();
        if (it.type === 'past') state.settings.hidePastHours = false;
        else state.settings.view = 'all';
        save(); render();
      };
      grid.append(gap);
      continue;
    }
    for (let h = Math.ceil(it.from); h <= it.to; h++) {
      const y = timeToY(h, L);
      const line = el('div', { class: 'hour', style: `top:${y}px` });
      const marker = h === DAY_START || h % 12 === 0;
      line.append(el('span', { class: 'hour-label' }, marker ? fmtHour(h) : fmtHourBare(h)));
      grid.append(line);
      if (L.pph >= 52 && h + .5 < it.to) {
        grid.append(el('div', { class: 'hour half', style: `top:${timeToY(h + .5, L)}px` }));
      }
    }
  }

  const blocksLayer = el('div', { class: 'blocks' });
  const ln = lanes(blocks.filter(b => !hiddenIn(b, L)));
  for (const b of blocks) {
    if (hiddenIn(b, L)) continue;
    const { lane, count } = ln[b.id];
    if (b.readonly) {
      const node = calendarButton(b, 'block calendar-block hl-blue');
      node.style.left = `${lane * 100 / count}%`;
      node.style.width = `${100 / count}%`;
      positionBlock(node, b.start, b.end, L);
      blocksLayer.append(node); continue;
    }
    const node = el('div', { class: `block hl-${b.color}`, 'data-id': b.id, title: `${fmtRange(b.start, b.end)} · ${b.title}`, tabindex: 0, 'aria-label': `${fmtRange(b.start, b.end)} · ${b.title || 'untitled block'}` });
    node.addEventListener('keydown', e => {
      if (e.target === node && ['Enter', ' '].includes(e.key)) { e.preventDefault(); openBlockEditor(key, b); }
    });
    node.style.left = `${lane * 100 / count}%`;
    node.style.width = `${100 / count}%`;
    positionBlock(node, b.start, b.end, L);

    const t = el('div', { class: 'block-title', 'data-placeholder': '…' });
    t.textContent = b.title;
    bindEditable(t, v => { b.title = v; save(); }, {
      onBlur() {
        if (fresh.has(b.id)) {
          fresh.delete(b.id);
          if (!b.title.trim()) { d.blocks = d.blocks.filter(x => x !== b); save(); render(); }
        }
      },
    });
    node.append(
      el('div', { class: 'block-time' }, `${fmtTime(b.start)} – ${fmtTime(b.end)}`),
      t,
      swatchButton(b.color, c => { b.color = c; save(); render(); }),
      delButton(() => { d.blocks = d.blocks.filter(x => x !== b); save(); render(); }),
      el('div', { class: 'block-resize' }),
    );
    blocksLayer.append(node);
  }
  grid.append(blocksLayer);
  renderNow(grid, key, L);
  grid.addEventListener('pointerdown', e => onGridPointerDown(e, key));
  // Native touch scrolling owns swipes; a completed tap still edits or creates.
  grid.addEventListener('click', e => {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest('.gap')) return;
    const block = e.target.closest('.block');
    if (block) {
      if (isWeek() || block.classList.contains('compact')) openBlockEditor(key, d.blocks.find(b => b.id === block.dataset.id));
      else focusEditable($('.block-title', block));
      return;
    }
    if (e.target.closest('.hour-label')) return;
    const start = clamp(snap(yToTime(e.clientY - grid.getBoundingClientRect().top, L)), L.start, DAY_END - SNAP);
    addBlock(key, start, Math.min(start + .5, DAY_END));
  });
  container.append(grid);
}

// The now line on today's page; everything above it is greyed out.
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
    if (layout(g.dataset.day).start !== L.start && !document.activeElement?.isContentEditable && !document.body.classList.contains('dragging') && !document.querySelector('dialog[open]')) { render(); return; }
    renderNow(g, g.dataset.day, L);
  }
}
setInterval(tick, 30 * 1000);

function onGridPointerDown(e, key) {
  if (e.pointerType === 'touch') return;
  if (e.button !== 0) return;
  const grid = e.currentTarget;
  const d = dayData(key);
  const L = gridLayouts.get(grid) || layout(key);
  const blockEl = e.target.closest('.block');

  if (blockEl) {
    const b = d.blocks.find(x => x.id === blockEl.dataset.id);
    if (!b) return;
    const title = blockEl.querySelector('.block-title');
    if (document.activeElement === title) return;   // editing text: native behaviour
    e.preventDefault();
    const resize = !!e.target.closest('.block-resize');
    const grabOffset = e.clientY - blockEl.getBoundingClientRect().top;
    const dur = b.end - b.start;
    let cur = { day: key, start: b.start, end: b.end };
    let curGrid = grid;
    let curLayout = L;
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
        blockEl.querySelector('.block-time').textContent = `${fmtTime(cur.start)} – ${fmtTime(cur.end)}`;
      },
      end() {
        d.blocks = d.blocks.filter(x => x !== b);
        b.start = cur.start; b.end = cur.end;
        dayData(cur.day).blocks.push(b);
        save(); render();
      },
      cancel() { render(); },
      click(ev) { if (isWeek() || blockEl.classList.contains('compact')) openBlockEditor(key, b); else focusEditable(title, ev); },
    });
    return;
  }

  if (e.target.closest('.gap')) return;
  if (e.target.closest('.hour-label')) return;

  // empty grid: drag to draw a block (or click for a 30-minute one)
  e.preventDefault();
  const rect = grid.getBoundingClientRect();
  const anchor = clamp(snap(yToTime(e.clientY - rect.top, L)), L.start, DAY_END - SNAP);
  let ghost = null;
  let cur = { start: anchor, end: anchor + SNAP };
  trackPointer(e, grid, {
    move(ev) {
      if (!ghost) {
        ghost = el('div', { class: `block ghost hl-${state.settings.color}` });
        grid.querySelector('.blocks').append(ghost);
      }
      const t = clamp(snap(yToTime(ev.clientY - rect.top, L)), L.start, DAY_END);
      cur = t >= anchor ? { start: anchor, end: Math.max(t, anchor + SNAP) } : { start: t, end: anchor };
      positionBlock(ghost, cur.start, cur.end, L);
    },
    end() { addBlock(key, cur.start, cur.end); },
    cancel() { ghost?.remove(); },
    click() { addBlock(key, anchor, Math.min(anchor + .5, DAY_END)); },
  });
}
function addBlock(key, start, end, title = '') {
  const b = { id: uid(), start, end, title, color: state.settings.color };
  dayData(key).blocks.push(b);
  if (!title) fresh.add(b.id);
  save(); render();
  if (!title && (isWeek() || (end - start) * layout(key).pph < 30)) openBlockEditor(key, b);
  else if (!title) {
    const t = $(`.block[data-id="${b.id}"] .block-title`);
    t && focusEditable(t);
  }
}

function openBlockEditor(key, block) {
  if (!block) return;
  const dialog = el('dialog', { class: 'block-editor', 'aria-label': 'Time block' });
  const form = el('form');
  const title = el('input', { 'aria-label': 'Block title', placeholder: 'title', value: block.title, required: '' });
  const start = el('select', { 'aria-label': 'Starts at' });
  const end = el('select', { 'aria-label': 'Ends at' });
  for (let time = DAY_START; time <= DAY_END; time += SNAP) {
    if (time < DAY_END) start.append(el('option', { value: time }, fmtHour(time)));
    if (time > DAY_START) end.append(el('option', { value: time }, fmtHour(time)));
  }
  start.value = block.start; end.value = block.end;
  const color = el('select', { 'aria-label': 'Highlight' });
  for (const c of PALETTE) color.append(el('option', { value: c }, c));
  color.value = block.color;
  const error = el('p', { role: 'alert' });
  const cancel = el('button', { type: 'button' }, 'cancel');
  cancel.onclick = () => dialog.close();
  const remove = el('button', { type: 'button' }, 'remove');
  remove.onclick = () => { dayData(key).blocks = dayData(key).blocks.filter(b => b !== block); fresh.delete(block.id); save(); dialog.close(); render(); };
  form.append(el('h3', {}, shortDate(key)), title,
    el('div', { class: 'block-editor-times' }, start, el('span', {}, '–'), end), color, error,
    el('div', { class: 'block-editor-actions' }, remove, cancel, el('button', { type: 'submit' }, 'save')));
  form.onsubmit = e => {
    e.preventDefault();
    if (+end.value <= +start.value || !title.value.trim()) { error.textContent = 'Add a title and an end time after the start.'; return; }
    block.title = title.value.trim(); block.start = +start.value; block.end = +end.value; block.color = color.value;
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

/* ---------- todos ---------- */
function calendarButton(event, className = 'calendar-tag') {
  const node = el('button', { type: 'button', class: className, title: `Google Calendar · ${event.title} · read-only`, 'aria-label': `${event.title}, Google Calendar, read-only` }, `G · ${event.title}`);
  node.addEventListener('pointerdown', e => e.stopPropagation());
  node.onclick = e => { e.stopPropagation(); openCalendarEvent(event.source || event); };
  return node;
}
function renderCalendarBanners(container, key) {
  const events = calendarEvents(key).filter(event => event.allDay || event.end <= DAY_START || event.start >= DAY_END);
  if (!events.length) return;
  const section = el('div', { class: 'calendar-banners', 'aria-label': 'Google Calendar all-day and early events' });
  for (const event of events) section.append(calendarButton(event));
  container.append(section);
}
function openCalendarEvent(event) {
  const dialog = el('dialog', { class: 'block-editor calendar-event-dialog', 'aria-label': 'Google Calendar event' });
  const close = el('button', { type: 'button' }, 'close');
  close.onclick = () => dialog.close();
  const when = event.allDay ? `${event.start} · all day` : `${new Date(event.start).toLocaleString()} – ${new Date(event.end).toLocaleString()}`;
  dialog.append(el('h3', {}, 'Google Calendar · read-only'), el('h2', {}, event.title), el('p', {}, when));
  if (event.url) dialog.append(el('a', { href: event.url, target: '_blank', rel: 'noopener noreferrer' }, 'open in Google Calendar'));
  dialog.append(close); dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog); dialog.showModal();
}

function renderTodos(container, key) {
  const d = dayData(key);
  const ul = el('ul', { class: 'todos' });
  const focusTodo = (id, atEnd) => {
    const t = $(`[data-key="${key}"] .todo[data-id="${id}"] .todo-text`);
    t && focusEditable(t);
  };
  d.todos.forEach((t, i) => {
    const li = el('li', { class: `todo${t.done ? ' done' : ''}`, 'data-id': t.id });
    if (t.from) li.append(el('span', { class: 'carried', title: `carried from ${shortDate(t.from)}` }, '→'));
    const chk = el('button', { class: 'check', title: 'done' }, t.done ? '×' : '');
    chk.onclick = () => { t.done = !t.done; save(); render(); };
    const txt = el('span', { class: `todo-text hl-${t.color}`, 'data-placeholder': '…' });
    txt.textContent = t.text;
    bindEditable(txt, v => { t.text = v; save(); }, {
      onEnter() {
        const n = { id: uid(), text: '', done: false, color: 'none' };
        d.todos.splice(i + 1, 0, n); save(); render(); focusTodo(n.id);
      },
      onEmptyBackspace() {
        d.todos.splice(i, 1); save(); render();
        const prev = d.todos[i - 1]; prev && focusTodo(prev.id);
      },
    });
    li.append(chk, txt,
      swatchButton(t.color, c => { t.color = c; save(); render(); }),
      delButton(() => { d.todos.splice(i, 1); save(); render(); }));
    ul.append(li);
  });
  const add = el('button', { class: 'add' }, '+ add');
  add.onclick = () => {
    const n = { id: uid(), text: '', done: false, color: 'none' };
    d.todos.push(n); save(); render(); focusTodo(n.id);
  };
  container.append(ul, add);
}

/* ---------- habits (top of the right page, collapsible) ---------- */
function habitStreak(id) {
  let k = todayKey();
  if (!state.habitLog[k]?.[id]) k = addDays(k, -1);   // today not marked yet still counts
  let n = 0;
  while (state.habitLog[k]?.[id]) { n++; k = addDays(k, -1); }
  return n;
}
function renderHabits(pageEl, key) {
  const open = state.settings.habitsOpen;
  const wrap = el('div', { class: `habits${open ? ' open' : ''}` });
  const head = el('div', { class: 'habits-head' });
  const toggle = el('button', { class: 'habits-toggle' },
    el('h3', {}, el('span', {}, 'habit')), el('span', { class: 'caret' }, open ? '▾' : '▸'));
  toggle.onclick = () => { state.settings.habitsOpen = !open; save(); render(); };
  head.append(toggle);
  if (!open) {
    const held = state.habits.map(h => ({ h, n: habitStreak(h.id) })).filter(x => x.n > 0);
    head.append(el('span', { class: 'habits-summary' },
      held.length ? held.map(x => `${x.h.name || '…'} ×${x.n}`).join('  ·  ') : 'nothing held yet'));
  }
  wrap.append(head);

  if (open) {
    const week = weekOf(key);
    const table = el('div', { class: 'habit-grid', style: `--cols:${week.length}` });
    table.append(el('span'));
    for (const k of week) {
      table.append(el('span', { class: `hday${k === todayKey() ? ' today' : ''}` },
        DOW[fromKey(k).getDay()][0]));
    }
    table.append(el('span'));   // header row has as many cells as a habit row
    for (const h of state.habits) {
      const name = el('span', { class: 'hname', 'data-placeholder': 'habit' });
      name.textContent = h.name;
      bindEditable(name, v => { h.name = v; save(); });
      const row = el('div', { class: 'hrow' }, name);
      for (const k of week) {
        const on = !!state.habitLog[k]?.[h.id];
        const c = el('button', { class: `hcell${on ? ' on' : ''}${k === todayKey() ? ' today' : ''}` }, on ? '×' : '');
        c.onclick = () => {
          const log = (state.habitLog[k] ||= {});
          if (on) delete log[h.id]; else log[h.id] = true;
          save(); render();
        };
        row.append(c);
      }
      row.append(delButton(() => {
        state.habits = state.habits.filter(x => x !== h);
        for (const log of Object.values(state.habitLog)) delete log[h.id];
        save(); render();
      }));
      table.append(row);
    }
    const add = el('button', { class: 'add' }, '+ habit');
    add.onclick = () => {
      const h = { id: uid(), name: '' };
      state.habits.push(h); save(); render();
      const n = $('.habit-grid .hrow:last-of-type .hname');
      n && focusEditable(n);
    };
    wrap.append(table, add);
  }
  pageEl.append(wrap);
}

/* ---------- mini month ---------- */
function renderMiniCal(container, key) {
  const d = fromKey(key), y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const grid = el('div', { class: 'mc-grid' });
  for (const c of 'SMTWTFS') grid.append(el('span', { class: 'mc-h' }, c));
  for (let i = 0; i < first; i++) grid.append(el('span'));
  for (let i = 1; i <= days; i++) {
    const k = keyOf(new Date(y, m, i));
    const on = k === cursor || k === addDays(cursor, 1);
    const b = el('button', { class: `mc-d${on ? ' on' : ''}${k === todayKey() ? ' today' : ''}` }, String(i));
    b.onclick = () => { cursor = k; render(); };
    grid.append(b);
  }
  container.append(el('div', { class: 'minical' },
    el('div', { class: 'mc-title' }, `${MONTHS[m]} ${y}`), grid));
}

/* ---------- desk stationery ---------- */
const scene = $('#scene'), book = $('#book'), stationery = $('#stationery');

function defaultPos(type) {
  const br = book.getBoundingClientRect(), sr = scene.getBoundingClientRect();
  const x = br.right - sr.left + 12;
  const top = br.top - sr.top + 12;
  return { sticky: { x, y: top }, tray: { x, y: top + 205 }, card: { x, y: top + 415 } }[type];
}

// Any desk object: drag to move, click to do its own thing.
function makeDraggable(node, it, onClick) {
  node.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    if (e.target.closest('button, [contenteditable]')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = parseFloat(node.style.left), oy = parseFloat(node.style.top);
    let cur = { x: ox, y: oy };
    trackPointer(e, node, {
      move(ev) {
        const sr = scene.getBoundingClientRect();
        cur.x = clamp(ox + ev.clientX - sx, 0, sr.width - 60);
        cur.y = clamp(oy + ev.clientY - sy, 0, sr.height - 60);
        node.style.left = `${cur.x}px`; node.style.top = `${cur.y}px`;
      },
      end() { it.x = cur.x; it.y = cur.y; it.docked = false; save(); },
      cancel() { node.style.left = `${ox}px`; node.style.top = `${oy}px`; },
      click(ev) { onClick?.(ev); },
    });
  });
}

function renderDesk() {
  stationery.innerHTML = '';
  let stickyIndex = 0;
  for (const it of state.desk.items) {
    if (it.x == null) it.docked = true;
    const p = it.docked ? defaultPos(it.type) : { x: it.x, y: it.y };
    if (it.type === 'sticky' && it.docked) { p.x += (stickyIndex % 2) * 3; p.y += stickyIndex++ * 26; }
    if (it.docked) { it.x = p.x; it.y = p.y; }
    else {
      // Keep saved positions; only constrain their presentation on a smaller canvas.
      const width = it.type === 'sticky' ? 180 : 224;
      p.x = clamp(p.x, 8, Math.max(8, scene.clientWidth - width - 12));
      p.y = clamp(p.y, 12, Math.max(12, scene.clientHeight - 190));
    }
    const base = { 'data-id': it.id, 'data-docked': String(!!it.docked), style: `left:${p.x}px;top:${p.y}px;--rot:${it.rot}deg` };
    if (it.type === 'sticky') renderSticky(it, base);
    else if (it.type === 'tray') renderTray(it, base);
    else if (it.type === 'card') renderCard(it, base);
  }
}

function renderSticky(it, base) {
  const node = el('div', { class: `sticky hl-${it.color}`, ...base });
  const txt = el('div', { class: 'sticky-text', 'data-placeholder': 'note to self' });
  txt.textContent = it.text;
  bindEditable(txt, v => { it.text = v; save(); }, { multiline: true });
  node.append(txt,
    swatchButton(it.color, c => { it.color = c; save(); renderDesk(); }),
    delButton(() => { state.desk.items = state.desk.items.filter(x => x !== it); save(); renderDesk(); }));
  makeDraggable(node, it, ev => focusEditable(txt, ev));
  stationery.append(node);
}

// A tray of highlighters. The one pulled forward is the current colour.
function renderTray(it, base) {
  const node = el('div', { class: 'tray', ...base, title: 'highlighters' });
  const pens = el('div', { class: 'pens' });
  for (const c of PALETTE) {
    const on = c === state.settings.color;
    const pen = el('button', {
      class: `${c === 'none' ? 'eraser' : 'pen'} hl-${c}${on ? ' on' : ''}`,
      title: c === 'none' ? 'no highlight' : c,
      'aria-pressed': String(on),
    });
    if (c !== 'none') pen.append(el('i', { class: 'cap' }), el('i', { class: 'body' }), el('i', { class: 'tip' }));
    pen.onclick = () => { state.settings.color = c; save(); renderDesk(); };
    pens.append(pen);
  }
  node.append(pens);
  makeDraggable(node, it);
  stationery.append(node);
}

// An index card with the week at a glance. Click a line to open that day.
function renderCard(it, base) {
  const node = el('div', { class: 'card', ...base });
  const week = weekOf(cursor);
  node.append(el('div', { class: 'card-title' }, `week of ${shortDate(week[0])}`));
  for (const k of week) {
    const d = state.days[k];
    const open = d ? d.todos.filter(t => !t.done).length : 0;
    const bits = [];
    if (d?.title) bits.push(d.title);
    if (d?.blocks.length) bits.push(`${d.blocks.length} block${d.blocks.length > 1 ? 's' : ''}`);
    if (open) bits.push(`${open} todo${open > 1 ? 's' : ''}`);
    const onSpread = k === cursor || k === addDays(cursor, 1);
    const row = el('button', { class: `card-row${onSpread ? ' on' : ''}${k === todayKey() ? ' today' : ''}` },
      el('span', { class: 'card-day' }, `${DOW[fromKey(k).getDay()][0]} ${fromKey(k).getDate()}`),
      el('span', { class: 'card-sum' }, bits.join(' · ')));
    row.addEventListener('pointerdown', e => e.stopPropagation());
    row.onclick = () => { cursor = k; render(); };
    node.append(row);
  }
  makeDraggable(node, it);
  stationery.append(node);
}

/* ---------- wider paper views, using the same dated records ---------- */
function dayHeading(key) {
  const date = fromKey(key);
  const button = el('button', { class: `date-heading${key === todayKey() ? ' today' : ''}`, title: 'Open day', 'aria-label': `Open ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}` },
    el('span', {}, DOW[date.getDay()]), el('strong', {}, String(date.getDate())));
  button.onclick = () => setMode('day', key);
  return button;
}

function renderWeek() {
  const start = weekStart(cursor);
  const first = fromKey(start), last = fromKey(addDays(start, 6));
  const period = first.getFullYear() !== last.getFullYear()
    ? `${MONTHS[first.getMonth()]} ${first.getFullYear()} – ${MONTHS[last.getMonth()]} ${last.getFullYear()}`
    : `${MONTHS[first.getMonth()]}${first.getMonth() !== last.getMonth() ? ` – ${MONTHS[last.getMonth()]}` : ''} ${last.getFullYear()}`;
  const sheet = el('section', { class: 'wide-sheet week-sheet', 'aria-label': 'Weekly planner' });
  sheet.append(plannerHeading(`${first.getDate()}–${last.getDate()}`, 'WEEK', period));
  const columns = el('div', { class: 'week-columns' });
  for (let i = 0; i < 7; i++) {
    const key = addDays(start, i), d = dayData(key);
    const column = el('section', { class: 'week-day', 'data-key': key });
    const title = el('div', { class: 'week-title', 'data-placeholder': 'a focus for today', 'aria-label': 'Day title' }, d.title);
    bindEditable(title, v => { d.title = v; save(); });
    column.append(el('header', { class: 'week-day-head' }, dayHeading(key), title));
    const timeline = el('div', { class: 'timeline' });
    renderTimeline(timeline, key);
    if (i > 0) timeline.querySelectorAll('.hour-label').forEach(n => n.remove());
    const todos = el('section', { class: 'week-todos' }, el('h3', {}, 'to do'));
    renderCalendarBanners(todos, key);
    renderTodos(todos, key);
    const notes = el('section', { class: 'notes week-notes' }, el('h3', {}, 'notes'));
    renderTextField(notes, 'notes-text', d.notes, v => { d.notes = v; save(); }, 'notes');
    column.append(timeline, todos, notes);
    columns.append(column);
  }
  sheet.append(columns);
  book.append(sheet);
}

function renderMonth() {
  const first = monthStart(cursor), date = fromKey(first);
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const offset = (date.getDay() + 6) % 7;
  const weeks = Math.ceil((offset + count) / 7);
  const start = weekStart(first);
  const sheet = el('section', { class: 'wide-sheet month-sheet', 'aria-label': 'Monthly planner' });
  sheet.append(plannerHeading(MONTHS[date.getMonth()], '', String(date.getFullYear())));
  const body = el('div', { class: 'month-body' });
  const calendar = el('div', { class: 'month-calendar', style: `--weeks:${weeks}` });
  for (let i = 0; i < 7; i++) calendar.append(el('div', { class: `month-weekday${i > 4 ? ' weekend' : ''}` }, DOW[(i + 1) % 7]));
  for (let i = 0; i < weeks * 7; i++) {
    const key = addDays(start, i), d = dayData(key);
    const cell = el('section', { class: `month-cell${key.slice(0, 7) !== first.slice(0, 7) ? ' outside' : ''}${i % 7 > 4 ? ' weekend' : ''}`, 'data-key': key });
    cell.append(dayHeading(key));
    const entries = el('div', { class: 'month-entries' });
    if (d.title) entries.append(el('div', { class: 'month-focus' }, d.title));
    for (const event of calendarEvents(key)) entries.append(calendarButton(event, 'month-block calendar-tag hl-blue'));
    for (const b of [...d.blocks].sort((a, b) => a.start - b.start)) {
      const entry = el('button', { class: `month-block hl-${b.color}`, title: `${fmtRange(b.start, b.end)} · ${b.title}` },
        el('span', {}, fmtHour(b.start)), b.title || 'untitled');
      entry.onclick = () => setMode('day', key);
      entries.append(entry);
    }
    for (const t of d.todos) {
      const todo = el('button', { class: `month-todo hl-${t.color}${t.done ? ' done' : ''}`, 'aria-pressed': String(t.done), title: 'Toggle completed' }, `${t.done ? '☑' : '□'} ${t.text || '…'}`);
      todo.onclick = () => { t.done = !t.done; save(); render(); };
      entries.append(todo);
    }
    if (d.notes) {
      const note = el('button', { class: 'month-day-note', title: 'Open day notes' }, d.notes);
      note.onclick = () => setMode('day', key);
      entries.append(note);
    }
    cell.append(entries);
    calendar.append(cell);
  }
  const monthKey = first.slice(0, 7);
  const month = state.months[monthKey] ||= { notes: '' };
  const notes = el('aside', { class: 'month-notes notes' }, el('h3', {}, 'month notes'));
  const text = el('div', { class: 'notes-text', 'data-placeholder': 'room for the bigger picture', 'aria-label': 'Month notes' }, month.notes);
  bindEditable(text, v => { month.notes = v; save(); }, { multiline: true });
  notes.append(text);
  body.append(calendar, notes);
  sheet.append(body);
  book.append(sheet);
}

/* ---------- the stack and its tracking notebooks ---------- */
function openBook(kind) {
  notebookDetail = null;
  paperPart = 0;
  journalId = null;
  activeBook = kind === 'planner' ? 'planner' : 'tracker';
  if (activeBook === 'tracker') trackerKind = kind;
  showArchived = false;
  render();
  window.scrollTo(0, 0);
}
$('#backShelf').onclick = () => { activeBook = 'shelf'; render(); window.scrollTo(0, 0); };
$('#toggleTools').onclick = e => {
  const open = document.body.classList.toggle('tools-open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
  $('#plannerTools').hidden = !open;
  if (open) {
    $('#catchallDrawer').hidden = true;
    $('#toggleCatchall').setAttribute('aria-expanded', 'false');
  }
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  $('#catchallDrawer').hidden = true;
  $('#toggleCatchall').setAttribute('aria-expanded', 'false');
  $('#plannerTools').hidden = true;
  document.body.classList.remove('tools-open');
  $('#toggleTools').setAttribute('aria-expanded', 'false');
});

function renderShelf() {
  const shelf = $('#shelf');
  shelf.innerHTML = '';
  const stack = el('div', { class: 'book-stack' });
  const volumes = [
    ['planner', 'The daily planner'],
    ['ideas', 'An idea notebook'],
    ['reading', 'A reading life'],
  ];
  for (const [kind, title] of volumes) {
    const volume = el('button', { class: `stack-volume volume-${kind}`, 'aria-label': `Open ${title}`, title },
      el('span', { class: 'volume-label' }, el('strong', {}, title)));
    volume.onclick = () => openBook(kind);
    stack.append(volume);
  }
  shelf.append(stack);
}

function renderTracker() {
  if (trackerKind === 'reading') { renderReadingIndex(); return; }
  const reading = trackerKind === 'reading';
  const rows = state.trackers[trackerKind];
  const statuses = reading ? ['want to read', 'reading', 'finished', 'set aside'] : ['captured', 'exploring', 'making', 'done'];
  const visible = rows.filter(x => !!x.archived === showArchived);
  const blank = () => ({ id: uid(), title: '', detail: '', notes: '', status: statuses[0], date: reading ? '' : todayKey() });
  const item = visible.find(x => x.id === notebookSelection[trackerKind]) || visible[0] || blank();
  notebookSelection[trackerKind] = item.id;
  const title = reading ? 'Reading' : 'Ideas';
  const index = el('section', { class: 'page notebook-index', 'data-side': 'left', 'aria-label': `${title} index` });
  const writing = el('section', { class: 'page notebook-writing', 'data-side': 'right', 'aria-label': reading ? 'Book notes' : 'Idea notebook' });
  book.className = `book notebook-book ${reading ? 'reading-book' : 'ideas-book'}`;

  const add = el('button', { class: 'notebook-add' }, reading ? '+ Add book' : '+ New idea');
  add.onclick = () => {
    // Reuse the untouched sheet instead of collecting empty entries.
    const next = rows.find(x => !x.archived && !x.title && !x.detail && !x.notes) || blank();
    if (!rows.includes(next)) rows.push(next);
    notebookSelection[trackerKind] = next.id;
    notebookDetail = true; showArchived = false; save(); render();
    $('.notebook-title').focus();
  };
  index.append(el('header', { class: 'notebook-heading' }, el('h1', {}, title), add));
  const list = el('div', { class: 'notebook-list' });
  function refreshIndex() {
    list.replaceChildren();
    const entries = rows.filter(x => !!x.archived === showArchived);
    if (!entries.length) list.append(el('p', { class: 'notebook-empty' }, showArchived ? 'Nothing archived.' : reading ? 'No books yet.' : 'No ideas yet.'));
    for (const entry of entries) {
      const label = entry.title || (entry.notes || '').split('\n')[0] || (reading ? 'Untitled book' : 'Untitled idea');
      const row = el('button', { class: 'notebook-index-entry', 'data-entry': entry.id, 'aria-pressed': String(entry.id === item.id) },
        el('span', { class: 'notebook-index-title' }, `${reading && entry.liked ? '♥ ' : ''}${label}`),
        el('span', { class: 'notebook-index-meta' }, [entry.detail, entry.status].filter(Boolean).join(' · ')));
      row.onclick = () => { notebookSelection[trackerKind] = entry.id; notebookDetail = true; render(); };
      list.append(row);
    }
  }
  refreshIndex();
  const archive = el('button', { class: 'notebook-archive', 'aria-pressed': String(showArchived) }, showArchived ? '← Current entries' : 'Archived');
  archive.onclick = () => { showArchived = !showArchived; notebookDetail = false; render(); };
  index.append(list, archive);

  // The blank ruled page is the editor, not an illustration of one. Its first
  // keystroke creates an entry without re-rendering or moving the caret.
  function persist() {
    if (!rows.includes(item)) {
      if (![item.title, item.detail, item.notes].some(value => value?.trim())) return;
      rows.push(item);
    }
    save(); refreshIndex();
  }
  const field = (key, label, className, placeholder = label) => {
    const node = el('div', { class: className, role: 'textbox', 'aria-label': label, 'aria-multiline': String(key === 'notes'), 'data-placeholder': placeholder }, item[key] || '');
    bindEditable(node, value => {
      // Blur must not replace an index button between pointerdown and click.
      if ((item[key] || '') === value) return;
      item[key] = value; persist();
    }, { multiline: key === 'notes' });
    return node;
  };
  const editorHead = el('header', { class: 'notebook-editor-heading' });
  const back = el('button', { class: 'notebook-back' }, `← ${title.toLowerCase()} index`);
  back.onclick = () => { notebookDetail = false; render(); };
  if (!singlePage()) editorHead.append(el('span', { class: 'notebook-folio' }, String(Math.max(0, visible.indexOf(item)) + 1).padStart(2, '0')));
  const archiveEntry = el('button', { class: 'notebook-archive' }, showArchived ? 'Restore' : 'Archive');
  archiveEntry.onclick = () => {
    if (!rows.includes(item)) return;
    item.archived = !item.archived; notebookDetail = false; save(); render();
  };
  editorHead.append(archiveEntry);
  const status = el('select', { 'aria-label': reading ? 'Reading status' : 'Idea status' });
  for (const value of statuses) status.append(el('option', { value }, value));
  status.value = item.status;
  const date = el('input', { type: 'date', value: item.date || '', 'aria-label': reading ? 'Finished on' : 'Captured on' });
  date.onchange = () => { item.date = date.value; persist(); };
  status.onchange = () => {
    item.status = status.value;
    if (reading && item.status === 'finished' && !item.date) item.date = date.value = todayKey();
    persist();
  };
  const meta = el('div', { class: 'notebook-meta' }, status, date);
  writing.append(editorHead,
    field('title', reading ? 'Book title' : 'Idea title', 'notebook-title'),
    field('detail', reading ? 'Author' : 'Theme or project', 'notebook-detail'), meta);
  if (reading) {
    const open = el('button', { class: 'notebook-add notebook-open-journal' }, 'Open journal →');
    open.onclick = () => {
      if (!rows.includes(item)) { rows.push(item); save(); }
      journalId = item.id; paperPart = 0; render(); window.scrollTo(0, 0);
    };
    writing.append(open);
  }
  writing.append(field('notes', reading ? 'Book notes' : 'Idea notes', 'notebook-notes', reading ? 'Write a note…' : 'Write an idea…'));
  if (showArchived && !visible.length) writing.replaceChildren();
  if (singlePage()) {
    // Phones show an immediately writable first page; returning to the index
    // remains possible after the first keystroke has saved an entry.
    const showWriting = notebookDetail === true || (notebookDetail === null && !visible.length && !showArchived);
    book.append(showWriting ? writing : index);
    if (showWriting) $('#contextNavigation').append(back);
  } else book.append(index, writing);
}

function renderReadingIndex() {
  const rows = state.trackers.reading;
  const visible = rows.filter(item => !!item.archived === showArchived);
  const left = el('section', { class: 'page notebook-index', 'data-side': 'left', 'aria-label': 'Reading index' });
  const right = el('section', { class: 'page notebook-index', 'data-side': 'right', 'aria-label': 'Reading index continued' });
  const openJournal = item => {
    notebookSelection.reading = item.id; journalId = item.id; paperPart = 0;
    render(); window.scrollTo(0, 0);
  };
  const add = el('button', { class: 'notebook-add' }, '+ Add book');
  add.onclick = () => {
    // A book opens directly into the journal the user designed, never into a
    // second, generic editor. Do not reuse a book that already has reflections.
    const keys = ['title', 'detail', 'notes', 'firstImpressions', 'summary', 'takeaways', 'finalThoughts', 'started', 'date'];
    let item = rows.find(x => !x.archived && keys.every(key => !x[key]) && !x.liked && x.recommend == null && x.reread == null);
    if (!item) {
      item = { id: uid(), title: '', detail: '', notes: '', status: 'want to read', date: '' };
      rows.push(item);
    }
    showArchived = false; save(); openJournal(item);
    $('.journal-title').focus();
  };
  left.append(el('header', { class: 'notebook-heading' }, el('h1', {}, 'Reading'), add));
  right.append(el('header', { class: 'notebook-heading reading-continuation', 'aria-hidden': 'true' }, el('span', { class: 'notebook-folio' }, '02')));
  const firstList = el('div', { class: 'notebook-list' });
  const secondList = el('div', { class: 'notebook-list' });
  const split = singlePage() ? visible.length : Math.ceil(visible.length / 2);
  if (!visible.length) firstList.append(el('p', { class: 'notebook-empty' }, showArchived ? 'Nothing archived.' : 'No books yet.'));
  visible.forEach((item, i) => {
    const row = el('button', { class: 'notebook-index-entry', 'data-entry': item.id },
      el('span', { class: 'notebook-index-title' }, `${item.liked ? '♥ ' : ''}${item.title || 'Untitled book'}`),
      el('span', { class: 'notebook-index-meta' }, [item.detail, item.status, item.date && shortDate(item.date)].filter(Boolean).join(' · ')));
    row.onclick = () => openJournal(item);
    (i < split ? firstList : secondList).append(row);
  });
  const archive = el('button', { class: 'notebook-archive', 'aria-pressed': String(showArchived) }, showArchived ? '← Current entries' : 'Archived');
  archive.onclick = () => { showArchived = !showArchived; render(); };
  left.append(firstList, archive); right.append(secondList);
  book.className = 'book notebook-book reading-book';
  book.append(left);
  if (!singlePage()) book.append(right);
}

function renderJournal() {
  const item = state.trackers.reading.find(x => x.id === journalId);
  if (!item) { journalId = null; renderTracker(); return; }
  const navigation = el('nav', { class: 'journal-nav', 'aria-label': 'Book journal navigation' });
  const back = el('button', {}, '← reading index');
  back.onclick = () => { journalId = null; showArchived = !!item.archived; render(); };
  navigation.append(back);
  const siblings = state.trackers.reading.filter(x => !!x.archived === !!item.archived);
  const index = siblings.indexOf(item);
  for (const [step, label] of [[-1, '‹ previous'], [1, 'next ›']]) {
    const button = el('button', { disabled: siblings[index + step] ? null : '' }, label);
    button.onclick = () => { journalId = siblings[index + step].id; render(); window.scrollTo(0, 0); };
    navigation.append(button);
  }
  const archive = el('button', {}, item.archived ? 'Restore' : 'Archive');
  archive.onclick = () => { item.archived = !item.archived; showArchived = !item.archived; journalId = null; save(); render(); };
  navigation.append(archive);
  const field = (key, label, className = '') => {
    const node = el('div', { class: `journal-writing ${className}`, role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'data-placeholder': label }, item[key] || '');
    bindEditable(node, v => { item[key] = v; save(); }, { multiline: true });
    return node;
  };
  const section = (key, label, className = '') => el('section', { class: `journal-section ${className}` }, el('h3', {}, label), field(key, label));
  const left = el('section', { class: 'page journal-left', 'data-side': 'left' });
  const right = el('section', { class: 'page journal-right', 'data-side': 'right' });
  const details = el('header', { class: 'journal-details' });
  const like = el('button', { class: 'journal-like', 'aria-label': 'Like this book', 'aria-pressed': String(!!item.liked) }, item.liked ? '♥' : '♡');
  like.onclick = () => { item.liked = !item.liked; save(); render(); };
  details.append(el('div', { class: 'journal-title-row' }, field('title', 'Book title', 'journal-title'), like), field('detail', 'Author', 'journal-author'));
  const meta = el('div', { class: 'journal-meta' });
  const status = el('select', { 'aria-label': 'Reading status' });
  for (const s of ['want to read', 'reading', 'finished', 'set aside']) status.append(el('option', { value: s }, s));
  status.value = item.status;
  status.onchange = () => { item.status = status.value; if (item.status === 'finished' && !item.date) item.date = todayKey(); save(); render(); };
  meta.append(status);
  for (const [key, label] of [['started', 'started'], ['date', 'finished']]) {
    const input = el('input', { type: 'date', value: item[key] || '', 'aria-label': `${label} on` });
    input.onchange = () => { item[key] = input.value; save(); };
    meta.append(el('label', {}, label, input));
  }
  const verdicts = el('div', { class: 'journal-verdicts' });
  for (const [key, label] of [['recommend', 'Recommend?'], ['reread', 'Reread?']]) {
    const group = el('div', { role: 'group', 'aria-label': label }, el('span', {}, label));
    for (const [value, text] of [[true, 'yes'], [false, 'no']]) {
      const button = el('button', { 'aria-pressed': String(item[key] === value) }, text);
      button.onclick = () => { item[key] = item[key] === value ? null : value; save(); render(); };
      group.append(button);
    }
    verdicts.append(group);
  }
  details.append(meta, verdicts);
  left.append(details, section('firstImpressions', 'first impressions', 'first-impressions'), section('summary', 'summary'), section('takeaways', 'takeaways'));
  right.append(section('finalThoughts', 'final thoughts', 'final-thoughts'), section('notes', 'notes', 'long-notes'));
  book.className = 'book journal-book';
  $('#contextNavigation').append(navigation);
  book.append(left, right);
}

/* ---------- render all ---------- */
function render() {
  closePopover();
  $('#contextNavigation').replaceChildren();
  $('#paperSections').replaceChildren();
  const shelfOpen = activeBook === 'shelf', plannerOpen = activeBook === 'planner';
  $('#shelf').hidden = !shelfOpen;
  scene.hidden = shelfOpen;
  $('.toolbar').hidden = shelfOpen;
  $('.book-tabs').hidden = !plannerOpen;
  $('#mobileSheetHint').hidden = true;
  document.body.dataset.surface = shelfOpen ? 'shelf' : plannerOpen ? 'planner' : 'tracker';
  document.body.dataset.paper = paperMode();
  document.body.classList.toggle('margin-open', !shelfOpen && marginVisible());
  const navigation = $('.book-navigation');
  navigation.classList.toggle('tracker-navigation', !plannerOpen);
  // Layout controls belong above every book. Context and journal-section
  // navigation stay in the bottom bar; the same controls keep their handlers.
  scene.prepend(navigation);
  document.querySelectorAll('.toolbar > .group, .toolbar > .spacer').forEach(n => n.hidden = !plannerOpen);
  $('#plannerTools').hidden = !plannerOpen || !document.body.classList.contains('tools-open');
  if (shelfOpen) { renderShelf(); return; }
  updateBookFrame();
  document.body.classList.toggle('margin-open', marginVisible());
  renderToolbar();
  if (!plannerOpen) viewSel.closest('.group').hidden = true;
  book.innerHTML = '';
  book.className = `book ${plannerOpen ? state.settings.mode : 'tracker'}-book`;
  if (!plannerOpen && journalId) renderJournal();
  else if (!plannerOpen) renderTracker();
  else if (isWeek()) renderWeek();
  else if (isMonth()) renderMonth();
  else {
    const left = el('section', { class: 'page', 'data-side': 'left' });
    const right = el('section', { class: 'page', 'data-side': 'right' });
    book.append(left);
    if (!singlePage()) book.append(right);
    renderPage(left, cursor);
    if (!singlePage()) renderPage(right, addDays(cursor, 1));
  }
  stationery.hidden = !marginVisible();
  if (marginVisible()) renderDesk();
  delete book.dataset.part;
  if (phone.matches || singlePage()) {
    if ((plannerOpen && !isWeek() && (phone.matches || isMonth())) || (journalId && singlePage())) {
      const labels = journalId ? ['reflection', 'notes'] : isMonth() ? ['month', 'notes'] : ['schedule', 'notes'];
      const segments = el('nav', { class: 'paper-segments section-segments', 'aria-label': 'Paper section' });
      labels.forEach((label, i) => {
        const button = el('button', { 'aria-pressed': String(paperPart === i) }, label);
        button.onclick = () => { paperPart = i; render(); };
        segments.append(button);
      });
      if (plannerOpen && isMonth()) book.append(segments);
      else if (plannerOpen) book.prepend(segments);
      else $('#paperSections').append(segments);
      book.dataset.part = String(paperPart);
    }
  }
  // Journal section controls are added during rendering; include their height.
  if (!plannerOpen) updateBookFrame();
}

carryOver();
render();
// Inline settings may wrap. Refit the paper to the actual bar height instead
// of overlaying its bottom edge, including notebook navigation.
let frameUpdatePending = false;
new ResizeObserver(() => {
  if (activeBook === 'shelf' || frameUpdatePending) return;
  frameUpdatePending = true;
  requestAnimationFrame(() => {
    frameUpdatePending = false;
    if (activeBook !== 'shelf' && Math.abs($('.toolbar').getBoundingClientRect().height - bookFrame.footer) > 1) render();
  });
}).observe($('.toolbar'));
calendarClient = window.DayblockCalendar.createClient({
  clientId: window.DAYBLOCK_CONFIG?.googleClientId || '',
  onStatus({ phase, message }) {
    $('#calendarStatus').textContent = message;
    $('#calendarStatus').title = message;
    $('#connectCalendar').disabled = ['loading', 'syncing', 'unconfigured', 'unavailable'].includes(phase);
    $('#connectCalendar').textContent = phase === 'connected' ? 'refresh calendar' : state.googleCalendar.updatedAt || phase === 'reconnect' ? 'reconnect Google Calendar' : 'connect Google Calendar';
    $('#disconnectCalendar').hidden = !state.googleCalendar.updatedAt;
    $('#calendarSetup').hidden = phase !== 'unconfigured';
    $('#calendarUpdated').textContent = state.googleCalendar.updatedAt ? `Last imported ${new Date(state.googleCalendar.updatedAt).toLocaleString()}. Cached on this browser.` : '';
  },
  onEvents(data) {
    state.googleCalendar = data; save();
    const focused = document.activeElement;
    if (focused?.isContentEditable && book.contains(focused)) focused.addEventListener('blur', () => setTimeout(render, 0), { once: true });
    else render();
  },
});
$('#connectCalendar').onclick = () => {
  if (calendarClient.validToken()) calendarClient.refresh(calendarWindow(), true);
  else calendarClient.connect(calendarWindow());
};
$('#disconnectCalendar').onclick = () => {
  state.googleCalendar = { events: [], updatedAt: null }; save();
  calendarClient.disconnect(); render();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCalendar(); });
window.addEventListener('pageshow', refreshCalendar);
calendarClient.prepare();
})();
