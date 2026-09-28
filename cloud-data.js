/* Portable notebook data. No credentials or Calendar cache belong in the cloud. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function validate(data) {
    if (!object(data) || !object(data.settings) || !object(data.days)) throw new Error('This is not a Dayblock backup.');
    function walk(value, depth = 0) {
      if (depth > 24) throw new Error('Backup is too deeply nested.');
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe backup key.');
        walk(child, depth + 1);
      }
    }
    walk(data);
    for (const [key, day] of Object.entries(data.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !object(day) || !Array.isArray(day.blocks) || !Array.isArray(day.todos)) throw new Error('Invalid day in backup.');
      for (const block of day.blocks) {
        if (!object(block) || typeof block.id !== 'string' || !Number.isFinite(block.start) || !Number.isFinite(block.end) || block.start < 0 || block.end > 24 || block.end <= block.start) throw new Error('Invalid time block.');
        if (block.tasks !== undefined && (!Array.isArray(block.tasks) || block.tasks.length > 20 || block.tasks.some(task =>
          !object(task) || typeof task.id !== 'string' || typeof task.text !== 'string' || task.text.length > 300 || typeof task.done !== 'boolean')))
          throw new Error('Invalid time block checklist.');
      }
      for (const todo of day.todos) if (!object(todo) || typeof todo.id !== 'string' || typeof todo.text !== 'string') throw new Error('Invalid todo.');
      for (const field of ['title', 'done']) if (day[field] !== undefined && typeof day[field] !== 'string') throw new Error('Invalid day text.');
      if (day.notes !== undefined && typeof day.notes !== 'string' && !Array.isArray(day.notes)) throw new Error('Invalid day notes.');
    }
    for (const list of [data.habits, data.desk?.items, data.catchall?.items, data.trackers?.ideas, data.trackers?.reading]) {
      if (list !== undefined && (!Array.isArray(list) || list.some(item => !object(item) || typeof item.id !== 'string'))) throw new Error('Invalid notebook entries.');
    }
    if (data.months !== undefined && !object(data.months)) throw new Error('Invalid month notes.');
    for (const month of Object.values(data.months || {})) if (!object(month) || typeof month.notes !== 'string') throw new Error('Invalid month notes.');
    for (const field of ['trackers', 'desk', 'catchall', 'habitLog']) if (data[field] !== undefined && !object(data[field])) throw new Error('Invalid notebook structure.');
    if (data.desk && !Array.isArray(data.desk.items)) throw new Error('Invalid stationery.');
    if (data.catchall && (!Array.isArray(data.catchall.items) || typeof data.catchall.draft !== 'string')) throw new Error('Invalid catchall.');
    for (const log of Object.values(data.habitLog || {})) if (!object(log)) throw new Error('Invalid habit log.');
    if (data.trackers && (!Array.isArray(data.trackers.ideas) || !Array.isArray(data.trackers.reading))) throw new Error('Invalid notebook indexes.');
    return clone(data);
  }
  function portable(data) {
    const copy = validate(data);
    delete copy.googleCalendar;
    delete copy.settings.paperPreferences;
    for (const day of Object.values(copy.days)) if (Array.isArray(day.notes)) day.notes = day.notes.map(note => note.text || '').join('\n');
    return copy;
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function fingerprint(value) {
    const text = canonical(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
  }
  function mergeValue(existing, incoming) {
    if (existing === undefined || existing === null || existing === '') return clone(incoming);
    if (incoming === undefined || incoming === null || incoming === '' || canonical(existing) === canonical(incoming)) return clone(existing);
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      const result = clone(existing);
      for (const entry of incoming) {
        if (result.some(item => canonical(item) === canonical(entry))) continue;
        const copy = clone(entry);
        if (copy?.id && result.some(item => item.id === copy.id)) {
          copy.id = `${copy.id}-import-${fingerprint(copy)}`;
          if (result.some(item => canonical(item) === canonical(copy))) continue;
        }
        result.push(copy);
      }
      return result;
    }
    if (object(existing) && object(incoming)) {
      const result = clone(existing);
      for (const key of Object.keys(incoming)) result[key] = mergeValue(existing[key], incoming[key]);
      return result;
    }
    if (typeof existing === 'string' && typeof incoming === 'string') {
      if (existing.includes(`\n\n[Imported copy]\n${incoming}`)) return existing;
      return `${existing}\n\n[Imported copy]\n${incoming}`;
    }
    return clone(existing);
  }
  function merge(existing, incoming) {
    const a = portable(existing), b = portable(incoming);
    if (a.desk && b.desk) b.desk.items = b.desk.items.filter(item => item.type === 'sticky' || !a.desk.items.some(other => other.type === item.type));
    // Importing a browser copy must not fork the same todo into an unchecked
    // carried copy and a completed copy. A stable id plus unchanged wording
    // identifies the same item, even when it moved to a different day.
    const todoById = new Map();
    for (const [day, data] of Object.entries(a.days)) for (const todo of data.todos) todoById.set(todo.id, { day, todo });
    for (const [day, data] of Object.entries(b.days)) {
      data.todos = data.todos.filter(todo => {
        const match = todoById.get(todo.id);
        if (!match || match.todo.text.trim() !== todo.text.trim()) return true;
        const shouldMove = (!match.todo.done && todo.done) || (!match.todo.done && !todo.done && day > match.day);
        if (shouldMove) {
          const oldDay = a.days[match.day];
          oldDay.todos = oldDay.todos.filter(item => item !== match.todo);
          const destination = (a.days[day] ||= { title: '', blocks: [], todos: [], notes: '', done: '' });
          const originalFrom = match.todo.from || todo.from;
          Object.assign(match.todo, clone(todo), { done: !!todo.done });
          if (originalFrom) match.todo.from = originalFrom;
          destination.todos.push(match.todo);
          match.day = day;
        }
        return false;
      });
    }
    // A changed habit gets its own copy; remap the imported checkmarks with it.
    for (const habit of b.habits || []) {
      const match = a.habits?.find(item => item.id === habit.id);
      if (match && canonical(match) !== canonical(habit)) {
        const old = habit.id;
        habit.id = `${old}-import-${fingerprint(habit)}`;
        // habitLog is keyed by date, then habit ID.
        for (const log of Object.values(b.habitLog || {})) if (object(log) && old in log) { log[habit.id] = log[old]; delete log[old]; }
      }
    }
    const result = mergeValue(a, b);
    result.settings = clone(a.settings); // Import content, not another device's preferences.
    return validate(result);
  }
  // Does this copy hold anything someone wrote? Settings and empty scaffolding don't count.
  function hasContent(data) {
    if (!object(data)) return false;
    const days = Object.values(data.days || {}).some(d => d && (d.blocks?.length || d.todos?.length || (typeof d.notes === 'string' ? d.notes.trim() : d.notes?.length) || d.done?.trim?.() || d.title?.trim?.()));
    const lists = [data.habits, data.trackers?.ideas, data.trackers?.reading, data.trackers?.recipes, data.shopping, data.quickNotes, data.catchall?.items].some(list => Array.isArray(list) && list.length);
    const stickies = (data.desk?.items || []).some(item => item.type === 'sticky' && item.text);
    const dated = [data.gratitude, data.moodBar, data.morningPages].some(map => object(map) && Object.keys(map).length);
    const months = Object.values(data.months || {}).some(m => m?.notes?.trim() || m?.focus?.trim?.());
    return !!(days || lists || stickies || dated || months);
  }
  // What the incoming copy would add: whole entries not already present, by list.
  // Pages that are already in the account (e.g. imported earlier) don't count.
  const CONTENT = ['days', 'trackers', 'quickNotes', 'shopping', 'gratitude', 'moodBar', 'morningPages', 'months', 'weeks', 'habits', 'habitLog', 'desk'];
  function newContent(existing, incoming) {
    const a = object(existing) ? existing : {}, b = object(incoming) ? incoming : {};
    const differs = (x, y) => canonical(x ?? null) !== canonical(y ?? null);
    const dayFilled = d => d && (d.blocks?.length || d.todos?.length || (typeof d.notes === 'string' ? d.notes.trim() : d.notes?.length) || d.done?.trim?.() || d.title?.trim?.());
    const newItems = (xs = [], ys = []) => (ys || []).filter(y => !(xs || []).some(x => canonical(x) === canonical(y))).length;
    const counts = {
      days: Object.entries(b.days || {}).filter(([k, d]) => dayFilled(d) && differs(a.days?.[k], d)).length,
      ideas: newItems(a.trackers?.ideas, b.trackers?.ideas),
      books: newItems(a.trackers?.reading, b.trackers?.reading),
      recipes: newItems(a.trackers?.recipes, b.trackers?.recipes),
      quickNotes: newItems(a.quickNotes, b.quickNotes),
    };
    // Anything else in the notebooks that the account doesn't already hold.
    const other = CONTENT.some(key => !['days', 'trackers', 'quickNotes'].includes(key) && b[key] !== undefined
      && canonical(mergeValue(clone(a[key] ?? (Array.isArray(b[key]) ? [] : {})), b[key])) !== canonical(a[key] ?? (Array.isArray(b[key]) ? [] : {})));
    const any = Object.values(counts).some(Boolean) || (other && hasContent(b));
    return { ...counts, any };
  }
  function reconcileTodoDates(data) {
    const seen = new Map();
    for (const day of Object.keys(data.days || {}).sort()) {
      const todos = data.days[day].todos;
      for (let i = todos.length - 1; i >= 0; i--) {
        const todo = todos[i], previous = seen.get(todo.id);
        // A changed title may be an intentional new version; don't erase it.
        if (!previous || previous.todo.text.trim() !== todo.text.trim()) {
          seen.set(todo.id, { day, todo });
          continue;
        }
        if (todo.done && !previous.todo.done) {
          const prior = data.days[previous.day].todos;
          prior.splice(prior.indexOf(previous.todo), 1);
          seen.set(todo.id, { day, todo });
        } else if (!previous.todo.done && !todo.done && day > previous.day) {
          const prior = data.days[previous.day].todos;
          prior.splice(prior.indexOf(previous.todo), 1);
          seen.set(todo.id, { day, todo });
        } else todos.splice(i, 1);
      }
    }
    return data;
  }
  // Three-way merge for automatic sync: compared with the last synced copy
  // (base), a change made on only one device wins cleanly; a field changed on
  // both keeps both; list items (todos, blocks, ideas…) merge one by one by id.
  function merge3(base, local, cloud) {
    const same = (a, b) => canonical(a ?? null) === canonical(b ?? null);
    const pick = (b, l, c) => {
      if (same(l, c)) return l === undefined ? undefined : clone(l);
      if (same(l, b)) return c === undefined ? undefined : clone(c);
      if (same(c, b)) return l === undefined ? undefined : clone(l);
      if (l === undefined) return clone(c);
      if (c === undefined) return clone(l);
      if (Array.isArray(l) && Array.isArray(c)) {
        const old = Array.isArray(b) ? b : [];
        if ([...l, ...c].every(x => object(x) && typeof x.id === 'string')) {
          const find = (list, id) => list.find(x => x.id === id);
          const out = [];
          for (const id of new Set([...c.map(x => x.id), ...l.map(x => x.id)])) {
            const merged = pick(find(old, id), find(l, id), find(c, id));
            if (merged !== undefined) out.push(merged);
          }
          return out;
        }
        return Array.from({ length: Math.max(l.length, c.length) }, (_, i) => pick(old[i], l[i], c[i])).filter(v => v !== undefined);
      }
      if (object(l) && object(c)) {
        const old = object(b) ? b : {}, out = {};
        for (const key of new Set([...Object.keys(c), ...Object.keys(l)])) {
          const merged = pick(old[key], l[key], c[key]);
          if (merged !== undefined) out[key] = merged;
        }
        return out;
      }
      if (typeof l === 'string' && typeof c === 'string') {
        if (!l.trim()) return c;
        if (!c.trim()) return l;
        if (c.includes(l)) return c;
        if (l.includes(c)) return l;
        return `${c}\n${l}`;
      }
      return clone(l);
    };
    return validate(reconcileTodoDates(pick(base, local, cloud)));
  }
  function serialize(data) {
    const payload = JSON.stringify(portable(data));
    if (new TextEncoder().encode(payload).length > 800000) throw new Error('Cloud notebook limit reached (800 KB). Export a backup; your local copy is still safe.');
    return payload;
  }
  function parseBackup(text) {
    if (new TextEncoder().encode(text).length > 5000000) throw new Error('Backup is too large (5 MB maximum).');
    const value = JSON.parse(text);
    return validate(value.format === 'dayblock-backup' ? value.data : value);
  }
  const api = { clone, validate, portable, canonical, fingerprint, merge, serialize, parseBackup, hasContent, newContent, merge3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockCloudData = api;
})(typeof window !== 'undefined' ? window : globalThis);
