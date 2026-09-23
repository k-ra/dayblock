/* Quick notes: sorting a sticky into a book, and filing it there.
   Pure state helpers so they run in the browser and under node --test. */
(function (root) {
  'use strict';

  const DESTS = {
    planner: { name: 'planner', sections: ['todo', 'time block', 'notes'] },
    ideas: { name: 'ideas', sections: ['new idea'] },
    reading: { name: 'book log', sections: ['want to read'] },
    recipes: { name: 'recipes', sections: ['shopping', 'new recipe'] },
    gratitude: { name: 'gratitude', sections: ['grateful for', 'good things today', 'what i learned'] },
    morning: { name: 'morning pages', sections: ['today'] },
    catchall: { name: 'sticky file', sections: ['unsorted'] },
  };
  const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // "tomorrow", "friday", "on october 8", "oct 8", "10/8" → a date key.
  function findDate(s, now) {
    const at = n => { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return keyOf(d); };
    if (/\b(tomorrow|tmrw|tmr)\b/.test(s)) return { key: at(1), match: s.match(/\b(tomorrow|tmrw|tmr)\b/)[0] };
    if (/\btoday\b|\btonight\b/.test(s)) return { key: at(0), match: s.match(/\btoday\b|\btonight\b/)[0] };
    const month = s.match(new RegExp(`\\b(?:on\\s+)?(${MONTHS.map(m => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (month) {
      const m = MONTHS.findIndex(name => name.startsWith(month[1].slice(0, 3)));
      const d = new Date(now.getFullYear(), m, +month[2], 12);
      if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(d.getFullYear() + 1);
      return { key: keyOf(d), match: month[0] };
    }
    const weekday = s.match(new RegExp(`\\b(?:on\\s+|by\\s+|this\\s+|next\\s+)?(${DOW.join('|')}|${DOW.map(d => d.slice(0, 3)).join('|')})\\b`));
    if (weekday) {
      const target = DOW.findIndex(d => d.startsWith(weekday[1].slice(0, 3)));
      let n = (target - now.getDay() + 7) % 7;
      if (/next\s/.test(weekday[0]) || n === 0) n = n || 7;
      return { key: at(n), match: weekday[0] };
    }
    return null;
  }
  // "at 5", "5pm", "1:30 pm", "17:00" → decimal hours.
  function findTime(s) {
    const t = s.match(/\b(?:at\s+)?(\d{1,2})(?::(\d\d))?\s?(am|pm)\b/) || s.match(/\bat\s+(\d{1,2})(?::(\d\d))?\b/);
    if (!t) return null;
    let h = +t[1];
    const m = +(t[2] || 0);
    if (h > 23 || m > 59) return null;
    if (t[3] === 'pm' && h < 12) h += 12;
    if (t[3] === 'am' && h === 12) h = 0;
    // A bare "at 5" in a planner means the afternoon, not 5 in the morning.
    if (!t[3] && h >= 1 && h <= 7) h += 12;
    return { hours: h + m / 60, match: t[0] };
  }
  const tidy = (text, parts) => {
    let out = text;
    for (const part of parts) if (part) out = out.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    return out.replace(/\s+(at|on|by)\s*$/i, '').replace(/\s{2,}/g, ' ').trim() || text.trim();
  };

  // The fallback when Claude is unavailable. Deliberately conservative.
  function heuristic(text, now = new Date()) {
    const s = text.toLowerCase().trim();
    const date = findDate(s, now), time = findTime(s);
    const today = keyOf(now);
    if (time) return { book: 'planner', section: 'time block', date: date?.key || today, time: time.hours, duration: 30, text: tidy(text, [time.match, date?.match]) };
    if (/grateful|thankful|glad that/.test(s)) return { book: 'gratitude', section: 'grateful for', date: today, time: null, duration: 0, text: text.trim() };
    if (/\b(learned|learnt|til)\b/.test(s)) return { book: 'gratitude', section: 'what i learned', date: today, time: null, duration: 0, text: text.trim() };
    if (/\brecipe\b|\bcook\b|\bbake\b|ingredients?|\bgroceries\b|\b\d+\s(lemons?|eggs?|cups?|onions?|cans?)\b/.test(s)) return { book: 'recipes', section: 'shopping', date: '', time: null, duration: 0, text: text.trim() };
    if (/\breread\b|\bread\b|\bnovel\b|\bbook by\b|\bauthor\b/.test(s)) return { book: 'reading', section: 'want to read', date: '', time: null, duration: 0, text: text.replace(/,?\s*(re)?read\??$/i, '').trim() || text.trim() };
    if (/^(idea|what if)\b|\bidea\b/.test(s)) return { book: 'ideas', section: 'new idea', date: '', time: null, duration: 0, text: text.replace(/^idea:?\s*/i, '').trim() };
    if (/^(buy|call|email|send|pay|book|pick up|text|reply|order|fix|finish|write|return|renew)\b/.test(s) || date) return { book: 'planner', section: 'todo', date: date?.key || today, time: null, duration: 0, text: tidy(text, [date?.match]) };
    return { book: 'catchall', section: 'unsorted', date: '', time: null, duration: 0, text: text.trim() };
  }

  const SCHEMA = {
    type: 'object',
    properties: {
      book: { type: 'string', enum: Object.keys(DESTS) },
      section: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD, or empty when the note has no day' },
      time: { type: 'string', description: 'HH:MM in 24-hour time for a time block, otherwise empty' },
      duration_minutes: { type: 'integer' },
      text: { type: 'string' },
    },
    required: ['book', 'section', 'date', 'time', 'duration_minutes', 'text'],
    additionalProperties: false,
  };
  const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@0.128.0';

  // Only the note's own words are sent. Nothing else in the notebooks leaves the device.
  async function classifyWithClaude(text, { apiKey, now = new Date(), load = () => import(SDK_URL) }) {
    const { default: Anthropic } = await load();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const books = Object.entries(DESTS).map(([key, d]) => `${key} (${d.name}): ${d.sections.join(' | ')}`).join('\n');
    const today = `${DOW[now.getDay()]}, ${keyOf(now)}`;
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: `You file one short handwritten note into a paper planner. Today is ${today}.
Books and their sections:
${books}
Pick the single best book and one of its sections. Use "planner" with "time block" only when the note names a time of day, and "todo" for dated tasks. Resolve relative days ("tomorrow", "friday") to a date. Put the note's words, tidied into lowercase without the date or time words, in "text". When unsure, use "catchall" with "unsorted".`,
      messages: [{ role: 'user', content: text }],
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to sort this note.');
    const block = response.content.find(b => b.type === 'text');
    const out = JSON.parse(block.text);
    if (!DESTS[out.book]) throw new Error('Unknown book.');
    const [h, m] = (out.time || '').split(':').map(Number);
    return {
      book: out.book,
      section: DESTS[out.book].sections.includes(out.section) ? out.section : DESTS[out.book].sections[0],
      date: /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : '',
      time: Number.isFinite(h) ? h + (m || 0) / 60 : null,
      duration: out.duration_minutes || 0,
      text: out.text || text,
    };
  }

  /* ---------- filing: write the note into its book, remember how to undo ---------- */
  function ensureDay(state, key) {
    const d = (state.days[key] ||= { title: '', blocks: [], todos: [], notes: '', done: '' });
    d.done ??= ''; if (typeof d.notes !== 'string') d.notes = '';
    return d;
  }
  function gratitudeDay(state, key) {
    const g = ((state.gratitude ||= {})[key] ||= {});
    for (const k of ['grateful', 'today', 'good', 'learned']) g[k] ||= [];
    return g;
  }
  const LISTS = { 'grateful for': 'grateful', 'good things today': 'good', 'what i learned': 'learned' };

  function file(state, note, { uid, today, color = 'butter' }) {
    const key = note.date || today, text = note.stored;
    switch (note.dest) {
      case 'planner': {
        const d = ensureDay(state, key);
        if (note.section === 'time block' && Number.isFinite(note.time)) {
          const start = Math.min(23.5, Math.max(8, Math.round(note.time * 4) / 4));
          const end = Math.min(24, start + Math.max(15, note.duration || 30) / 60);
          const block = { id: uid(), start, end, title: text, color };
          d.blocks.push(block);
          return { kind: 'block', day: key, id: block.id };
        }
        if (note.section === 'notes') {
          d.notes = d.notes ? `${d.notes}\n${text}` : text;
          return { kind: 'dayNote', day: key };
        }
        const todo = { id: uid(), text, done: false, color: 'none' };
        d.todos.push(todo);
        return { kind: 'todo', day: key, id: todo.id };
      }
      case 'ideas': {
        const idea = { id: uid(), title: text, detail: '', notes: '', status: 'captured', date: today };
        (state.trackers.ideas ||= []).push(idea);
        return { kind: 'idea', id: idea.id };
      }
      case 'reading': {
        const book = { id: uid(), title: text, detail: '', notes: '', status: 'want to read', date: '' };
        (state.trackers.reading ||= []).push(book);
        return { kind: 'book', id: book.id };
      }
      case 'recipes': {
        if (note.section === 'new recipe') {
          const recipe = { id: uid(), title: text, group: '', serves: '', time: '', lastMade: '', ingredients: [], method: [], notes: '' };
          (state.trackers.recipes ||= []).push(recipe);
          return { kind: 'recipe', id: recipe.id };
        }
        const item = { id: uid(), text, done: false };
        (state.shopping ||= []).push(item);
        return { kind: 'shopping', id: item.id };
      }
      case 'gratitude': {
        const list = gratitudeDay(state, key)[LISTS[note.section] || 'grateful'];
        const slot = list.findIndex(line => !line);
        if (slot >= 0) list[slot] = text; else list.push(text);
        return { kind: 'gratitude', day: key, list: LISTS[note.section] || 'grateful' };
      }
      case 'morning': {
        const page = ((state.morningPages ||= {})[key] ||= { pages: ['', ''] });
        page.pages[0] = page.pages[0] ? `${page.pages[0]}\n\n${text}` : text;
        return { kind: 'morning', day: key };
      }
      default: return null;
    }
  }

  // Remove what filing added, but never an entry the user has since edited.
  function unfile(state, note) {
    const ref = note.ref, text = note.stored;
    if (!ref) return;
    const without = (list, id, same) => { const i = list?.findIndex(x => x.id === id) ?? -1; if (i >= 0 && same(list[i])) list.splice(i, 1); };
    const day = ref.day && state.days[ref.day];
    if (ref.kind === 'todo' && day) without(day.todos, ref.id, t => t.text === text && !t.done);
    if (ref.kind === 'block' && day) without(day.blocks, ref.id, b => b.title === text);
    if (ref.kind === 'dayNote' && day) day.notes = day.notes === text ? '' : day.notes.endsWith(`\n${text}`) ? day.notes.slice(0, -text.length - 1) : day.notes;
    if (ref.kind === 'idea') without(state.trackers.ideas, ref.id, i => i.title === text && !i.notes && !i.detail);
    if (ref.kind === 'book') without(state.trackers.reading, ref.id, b => b.title === text && !b.notes && !b.detail && !b.firstImpressions);
    if (ref.kind === 'recipe') without(state.trackers.recipes, ref.id, r => r.title === text && !r.ingredients?.length && !r.method?.length && !r.notes);
    if (ref.kind === 'shopping') without(state.shopping, ref.id, i => i.text === text);
    if (ref.kind === 'gratitude') {
      const list = state.gratitude?.[ref.day]?.[ref.list];
      const i = list ? list.lastIndexOf(text) : -1;
      if (i >= 0) list[i] = '';
    }
    if (ref.kind === 'morning') {
      const page = state.morningPages?.[ref.day];
      if (page) page.pages[0] = page.pages[0] === text ? '' : page.pages[0].endsWith(`\n\n${text}`) ? page.pages[0].slice(0, -text.length - 2) : page.pages[0];
    }
    note.ref = null;
  }

  const api = { DESTS, heuristic, classifyWithClaude, file, unfile, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockQuickNotes = api;
})(typeof window !== 'undefined' ? window : globalThis);
