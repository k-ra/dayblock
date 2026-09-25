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
      for (const block of day.blocks) if (!object(block) || typeof block.id !== 'string' || !Number.isFinite(block.start) || !Number.isFinite(block.end) || block.start < 0 || block.end > 24 || block.end <= block.start) throw new Error('Invalid time block.');
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
  const api = { clone, validate, portable, canonical, fingerprint, merge, serialize, parseBackup, hasContent, newContent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayblockCloudData = api;
})(typeof window !== 'undefined' ? window : globalThis);
