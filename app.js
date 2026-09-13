/* Dayblock — a two-page planner on a desk.
   Everything lives in localStorage; no build step, no dependencies. */
(() => {
'use strict';

const STORAGE_KEY = 'spread-planner.v1';
const DAY_START = 8;      // 8 am
const DAY_END = 24;       // midnight
const SNAP = 0.25;        // 15 minutes
const GRID_H = 660;       // target grid height in px; hour rows stretch to fill it
const GAP_H = 26;         // height of a collapsed (hidden) span

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
let cursor = todayKey();          // left page of the current spread
let lastToday = todayKey();
const fresh = new Set();          // ids of just-drawn blocks; they vanish if left untitled

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
function layout() {
  const { view, workStart: ws, workEnd: we } = state.settings;
  let parts;
  if (view === 'work') parts = [['gap', DAY_START, ws], ['seg', ws, we], ['gap', we, DAY_END]];
  else if (view === 'off') parts = [['seg', DAY_START, ws], ['gap', ws, we], ['seg', we, DAY_END]];
  else parts = [['seg', DAY_START, DAY_END]];
  parts = parts.filter(p => p[2] > p[1]);

  const visible = parts.filter(p => p[0] === 'seg').reduce((s, p) => s + p[2] - p[1], 0);
  const gaps = parts.filter(p => p[0] === 'gap').length;
  const pph = clamp((GRID_H - gaps * GAP_H) / visible, 36, 96);  // px per hour

  let y = 0;
  const items = parts.map(([type, from, to]) => {
    const h = type === 'seg' ? (to - from) * pph : GAP_H;
    const it = { type, from, to, y, h };
    y += h;
    return it;
  });
  return { items, pph, height: y };
}
function timeToY(t, L) {
  for (const it of L.items) {
    if (t >= it.from && t <= it.to) return it.y + (t - it.from) / (it.to - it.from) * it.h;
  }
  return t < L.items[0].from ? 0 : L.height;
}
function yToTime(y, L) {
  for (const it of L.items) {
    if (y >= it.y && y <= it.y + it.h) {
      if (it.type === 'gap') return (y - it.y) < it.h / 2 ? it.from : it.to;
      return it.from + (y - it.y) / L.pph;
    }
  }
  return y < 0 ? DAY_START : DAY_END;
}
const hiddenIn = (b, L) => L.items.some(it => it.type === 'gap' && b.start >= it.from && b.end <= it.to);

function positionBlock(node, start, end, L) {
  const top = timeToY(start, L);
  const h = Math.max(timeToY(end, L) - top, 14);
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
function trackPointer(e, capEl, { move, end, click }) {
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  try { capEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  const onMove = ev => {
    if (!moved) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      document.body.classList.add('dragging');
      getSelection()?.removeAllRanges();
    }
    move(ev);
  };
  const onUp = ev => {
    capEl.removeEventListener('pointermove', onMove);
    capEl.removeEventListener('pointerup', onUp);
    capEl.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('dragging');
    if (moved) end(ev); else click?.(ev);
  };
  capEl.addEventListener('pointermove', onMove);
  capEl.addEventListener('pointerup', onUp);
  capEl.addEventListener('pointercancel', onUp);
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

function renderToolbar() {
  const s = state.settings;
  viewSel.value = s.view;
  wsSel.innerHTML = ''; weSel.innerHTML = '';
  for (let h = DAY_START; h < DAY_END; h++) wsSel.append(el('option', { value: h }, fmtHour(h)));
  for (let h = DAY_START + 1; h <= DAY_END; h++) weSel.append(el('option', { value: h }, fmtHour(h)));
  wsSel.value = s.workStart; weSel.value = s.workEnd;
  $('.hours').style.opacity = s.view === 'all' ? .5 : 1;

  const a = fromKey(cursor), b = fromKey(addDays(cursor, 1));
  const mo = d => MONTHS[d.getMonth()].slice(0, 3);
  $('#range').textContent = a.getMonth() === b.getMonth()
    ? `${mo(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
    : `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}, ${b.getFullYear()}`;
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
$('#prev').onclick = () => { cursor = addDays(cursor, -2); render(); };
$('#next').onclick = () => { cursor = addDays(cursor, 2); render(); };
$('#today').onclick = () => { cursor = todayKey(); render(); };
$('#addSticky').onclick = () => {
  const n = state.desk.items.filter(i => i.type === 'sticky').length;
  const p = defaultPos('sticky');
  state.desk.items.push({
    id: uid(), type: 'sticky', x: p.x + (n % 3) * 18, y: p.y + n * 40,
    rot: (n % 2 ? 1.5 : -2) + (Math.random() - .5), color: state.settings.color, text: '',
  });
  save(); renderDesk();
  const last = $('#stationery .sticky:last-of-type .sticky-text');
  last && focusEditable(last);
};
document.addEventListener('keydown', e => {
  if (e.target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') $('#prev').click();
  if (e.key === 'ArrowRight') $('#next').click();
  if (e.key === '/') {
    e.preventDefault();
    ($(`.page[data-key="${todayKey()}"] .quick`) || $('.page .quick'))?.focus();
  }
});

/* ---------- a page (one day) ---------- */
function renderPage(pageEl, key) {
  const d = dayData(key);
  const date = fromKey(key);
  pageEl.innerHTML = '';
  pageEl.dataset.key = key;

  const title = el('div', { class: 'page-title', 'data-placeholder': 'title' });
  title.textContent = d.title;
  bindEditable(title, v => { d.title = v; save(); });
  pageEl.append(el('div', { class: `page-head${key === todayKey() ? ' today' : ''}` },
    el('div', { class: 'day-num' }, String(date.getDate())),
    el('div', {},
      el('div', { class: 'dow' }, DOW[date.getDay()]),
      el('div', { class: 'month' }, `${MONTHS[date.getMonth()]} ${date.getFullYear()}`)),
    title));

  if (pageEl.dataset.side === 'right') renderHabits(pageEl, key);

  const timeline = el('div', { class: 'timeline' });
  renderTimeline(timeline, key);
  renderQuickAdd(timeline, key);

  const side = el('div', { class: 'side' });
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
  const L = layout();
  const grid = el('div', { class: 'grid', 'data-day': key, style: `height:${L.height}px` });

  for (const it of L.items) {
    if (it.type === 'gap') {
      const n = d.blocks.filter(b => hiddenIn(b, L) && b.start >= it.from && b.end <= it.to).length;
      grid.append(el('div', {
        class: 'gap', style: `top:${it.y}px;height:${it.h}px`, title: 'show all hours',
      }, `${fmtRange(it.from, it.to)}${n ? ` · ${n} hidden` : ''}`));
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
  const ln = lanes(d.blocks);
  for (const b of d.blocks) {
    if (hiddenIn(b, L)) continue;
    const { lane, count } = ln[b.id];
    const node = el('div', { class: `block hl-${b.color}`, 'data-id': b.id });
    node.style.left = `calc(${lane * 100 / count}% + 3px)`;
    node.style.width = `calc(${100 / count}% - 7px)`;
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
  const L = layout();
  for (const g of document.querySelectorAll('.grid')) renderNow(g, g.dataset.day, L);
}
setInterval(tick, 30 * 1000);

function onGridPointerDown(e, key) {
  if (e.button !== 0) return;
  const grid = e.currentTarget;
  const d = dayData(key);
  const L = layout();
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
    trackPointer(e, blockEl, {
      move(ev) {
        if (resize) {
          const y = ev.clientY - curGrid.getBoundingClientRect().top;
          cur.end = clamp(snap(yToTime(y, L)), b.start + SNAP, DAY_END);
        } else {
          const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.grid');
          if (over && over !== curGrid) {
            curGrid = over; cur.day = over.dataset.day;
            over.querySelector('.blocks').append(blockEl);
          }
          const y = ev.clientY - grabOffset - curGrid.getBoundingClientRect().top;
          cur.start = clamp(snap(yToTime(y, L)), DAY_START, DAY_END - dur);
          cur.end = cur.start + dur;
        }
        positionBlock(blockEl, cur.start, cur.end, L);
        blockEl.querySelector('.block-time').textContent = `${fmtTime(cur.start)} – ${fmtTime(cur.end)}`;
      },
      end() {
        d.blocks = d.blocks.filter(x => x !== b);
        b.start = cur.start; b.end = cur.end;
        dayData(cur.day).blocks.push(b);
        save(); render();
      },
      click(ev) { focusEditable(title, ev); },
    });
    return;
  }

  if (e.target.closest('.gap')) { state.settings.view = 'all'; save(); render(); return; }
  if (e.target.closest('.hour-label')) return;

  // empty grid: drag to draw a block (or click for a 30-minute one)
  e.preventDefault();
  const rect = grid.getBoundingClientRect();
  const anchor = clamp(snap(yToTime(e.clientY - rect.top, L)), DAY_START, DAY_END - SNAP);
  let ghost = null;
  let cur = { start: anchor, end: anchor + SNAP };
  trackPointer(e, grid, {
    move(ev) {
      if (!ghost) {
        ghost = el('div', { class: `block ghost hl-${state.settings.color}` });
        grid.querySelector('.blocks').append(ghost);
      }
      const t = clamp(snap(yToTime(ev.clientY - rect.top, L)), DAY_START, DAY_END);
      cur = t >= anchor ? { start: anchor, end: Math.max(t, anchor + SNAP) } : { start: t, end: anchor };
      positionBlock(ghost, cur.start, cur.end, L);
    },
    end() { addBlock(key, cur.start, cur.end); },
    click() { addBlock(key, anchor, Math.min(anchor + .5, DAY_END)); },
  });
}
function addBlock(key, start, end, title = '') {
  const b = { id: uid(), start, end, title, color: state.settings.color };
  dayData(key).blocks.push(b);
  if (!title) fresh.add(b.id);
  save(); render();
  if (!title) {
    const t = $(`.block[data-id="${b.id}"] .block-title`);
    t && focusEditable(t);
  }
}

/* ---------- keyboard first: "lunch 12-1" → block, "call mum" → todo ---------- */
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?`;
const RANGE_RE = new RegExp(String.raw`(?:^|\s)(?:@|at\s+)?${TIME}\s*(?:-|–|—|to)\s*${TIME}(?=\s|$)`, 'i');
const SINGLE_RE = new RegExp(String.raw`(?:^|\s)(@|at\s+)?${TIME}(?=\s|$)`, 'i');

function resolveTime(h, m, ap, after) {
  h = Number(h); m = Number(m || 0);
  if (h > 24 || m > 59) return null;
  if (ap) {
    ap = ap[0].toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 24;
  } else if (h >= 1 && h <= 7) h += 12;              // 1 … 7 on an 8 am → midnight day is afternoon
  let t = h + m / 60;
  if (after != null && t <= after) {                  // "11-1", "10pm-12": the end is later
    if (t + 12 > after && t + 12 <= DAY_END) t += 12;
    else if (h === 12) t = 24;
  }
  return t;
}
function parseQuick(text) {
  let m = text.match(RANGE_RE);
  if (m) {
    const start = resolveTime(m[1], m[2], m[3]);
    const end = start == null ? null : resolveTime(m[4], m[5], m[6], start);
    if (start != null && end != null && end > start) return { start, end, title: strip(text, m) };
  }
  m = text.match(SINGLE_RE);
  if (m) {
    const explicit = m[1] || m[3] || m[4];                 // "at 3", "3:30", "3pm"
    const last = text.trim().endsWith(m[0].trim());        // or the time is the last word
    if (explicit || last) {
      const start = resolveTime(m[2], m[3], m[4]);
      if (start != null) return { start, end: Math.min(start + 1, DAY_END), title: strip(text, m) };
    }
  }
  return null;
}
const strip = (text, m) => text.replace(m[0], ' ').replace(/\s+/g, ' ').replace(/^[\s,@-]+|[\s,@-]+$/g, '')
  .replace(/\s+at$/i, '').trim();

function renderQuickAdd(container, key) {
  const input = el('input', { class: 'quick', placeholder: 'lunch 12–1  ·  or just a todo', spellcheck: 'false' });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; input.blur(); return; }
    if (e.key !== 'Enter') return;
    const text = input.value.trim();
    if (!text) return;
    const p = parseQuick(text);
    if (p) {
      const start = clamp(snap(p.start), DAY_START, DAY_END - SNAP);
      const end = clamp(snap(p.end), start + SNAP, DAY_END);
      addBlock(key, start, end, p.title);
    } else {
      dayData(key).todos.push({ id: uid(), text, done: false, color: 'none' });
      save(); render();
    }
    if (p && p.title) $(`.page[data-key="${key}"] .quick`)?.focus();
  });
  container.append(input);
}

/* ---------- todos ---------- */
function renderTodos(container, key) {
  const d = dayData(key);
  const ul = el('ul', { class: 'todos' });
  const focusTodo = id => {
    const t = $(`.page[data-key="${key}"] .todo[data-id="${id}"] .todo-text`);
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
  const x = Math.min(br.right - sr.left + 36, sr.width - 232);
  return { sticky: { x, y: 24 }, tray: { x, y: 246 }, card: { x, y: 404 } }[type];
}

// Any desk object: drag to move, click to do its own thing.
function makeDraggable(node, it, onClick) {
  node.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('button, [contenteditable]:focus')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y;
    let cur = { x: ox, y: oy };
    trackPointer(e, node, {
      move(ev) {
        const sr = scene.getBoundingClientRect();
        cur.x = clamp(ox + ev.clientX - sx, 0, sr.width - 60);
        cur.y = clamp(oy + ev.clientY - sy, 0, sr.height - 60);
        node.style.left = `${cur.x}px`; node.style.top = `${cur.y}px`;
      },
      end() { it.x = cur.x; it.y = cur.y; save(); },
      click(ev) { onClick?.(ev); },
    });
  });
}

function renderDesk() {
  stationery.innerHTML = '';
  for (const it of state.desk.items) {
    if (it.x == null) { const p = defaultPos(it.type); it.x = p.x; it.y = p.y; save(); }
    const base = { 'data-id': it.id, style: `left:${it.x}px;top:${it.y}px;--rot:${it.rot}deg` };
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

/* ---------- render all ---------- */
function render() {
  closePopover();
  renderToolbar();
  renderPage($('.page[data-side="left"]'), cursor);
  renderPage($('.page[data-side="right"]'), addDays(cursor, 1));
  renderDesk();
}

carryOver();
render();
})();
