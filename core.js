/* CHRONO FOCUS data and accounting. Works in a browser and Node's test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChronoCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KEY = 'chrono_focus_data_v2';
  const DRAFT_KEY = 'chrono_focus_draft_v2';
  const DEFAULTS = Object.freeze({ theme: 'emerald', precision: 2, sound: true,
    goal: 4, weekStart: 'monday', dateFormat: 'DD/MM', chime: 0, idle: 120, confirm: 'always' });
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const normalize = text => String(text).trim().replace(/\s+/g, ' ').toLowerCase();
  const positive = value => Number.isSafeInteger(value) && value > 0;
  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return y >= 1000 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }
  function settings(input = {}) {
    const out = { ...DEFAULTS };
    const options = { theme: ['emerald','cyan','amber','white','crimson','violet'], precision: [2,3],
      goal: [1,2,3,4,5,6,8,10], weekStart: ['monday','sunday'], dateFormat: ['DD/MM','MM/DD'],
      chime: [0,25,30,45,50,60], idle: [0,60,90,120,180,240], confirm: ['always','auto'] };
    for (const [key, values] of Object.entries(options)) if (values.includes(input[key])) out[key] = input[key];
    if (typeof input.sound === 'boolean') out.sound = input.sound;
    return out;
  }
  function empty() {
    return { version: 2, revision: id(), subjects: [], entries: [], sessions: [], notes: {}, imports: [], settings: settings() };
  }
  function subject(data, name, selectVisible = true) {
    name = String(name || 'Overall Work').trim();
    if (!name || name.length > 100) throw new Error('Use a subject name between 1 and 100 characters.');
    let item = data.subjects.find(s => normalize(s.name) === normalize(name));
    if (!item) { item = { id: id(), name, hidden: !selectVisible }; data.subjects.push(item); }
    else if (selectVisible) item.hidden = false;
    return item;
  }
  function allocate(total, weights) {
    if (!positive(total) || !weights.length || weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Invalid adjusted duration.');
    const sum = weights.reduce((a,b) => a+b, 0);
    if (!sum || total < weights.length) throw new Error('Duration must allow at least one millisecond per block.');
    const result = weights.map(w => Math.max(1, Math.floor(total * w / sum)));
    let remainder = total - result.reduce((a,b) => a+b, 0);
    // Largest block absorbs rounding, without creating negative durations.
    const ordered = weights.map((w,i) => i).sort((a,b) => weights[b]-weights[a]);
    for (const i of ordered) {
      if (remainder >= 0) { result[i] += remainder; break; }
      const take = Math.min(result[i]-1, -remainder); result[i] -= take; remainder += take;
      if (!remainder) break;
    }
    return result;
  }
  function duration(text) {
    const match = String(text).trim().match(/^(\d+(?:[.,]\d+)?)\s*(dk|dakika|min|minutes?|m|hours?|hrs?|h|seconds?|secs?|s)?$/i);
    if (!match) return null;
    const value = Number(match[1].replace(',', '.'));
    const unit = match[2] || '';
    const ms = Math.round(value * (/^(h|hr|hrs|hour|hours)$/i.test(unit) ? 3600000 : /^(s|sec|secs|second|seconds)$/i.test(unit) ? 1000 : 60000));
    return positive(ms) ? ms : null;
  }
  function studyLine(line, names = []) {
    const text = String(line).trim();
    if (!text) return { kind: 'text', text };
    if (/^(nothin|nothing|rest|dinlenme|bos|boş|tatil|off|yok|none)$/i.test(text)) return { kind: 'text', text };
    const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:(dk|dakika|min|minutes?|m|hours?|hrs?|h|seconds?|secs?|s)(?=\s|$))?\s*(.*)$/i);
    if (!match) return { kind: 'text', text };
    const ms = duration(match[1] + (match[2] || ''));
    if (!ms) return { kind: 'error', text, error: 'Duration must be positive and finite.' };
    const rest = match[3].trim();
    let name = rest || 'Overall Work';
    const existing = [...names].sort((a,b) => b.length-a.length).find(n => normalize(rest) === normalize(n) || normalize(rest).startsWith(normalize(n)+' '));
    if (existing) name = existing;
    else {
      const split = rest.match(/^(.*?)\s+(tekrar|review|ch(?:apter)?|\d+|soru|ödev|hw|quiz|exam|test|lab|çalışma)\b/i);
      if (split?.[1]) name = split[1];
    }
    if (name.length > 100) return { kind: 'error', text, error: 'Subject exceeds 100 characters.' };
    return { kind: 'entry', text, duration: ms, subject: name, line: normalize(text) };
  }
  function parseDate(text, year, format) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validDate(text) ? text : null;
    const match = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/);
    if (!match) return null;
    let y = match[3] ? Number(match[3]) : Number(year);
    if (y < 100) y += 2000;
    const day = Number(match[format === 'MM/DD' ? 2 : 1]);
    const month = Number(match[format === 'MM/DD' ? 1 : 2]);
    const key = `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return validDate(key) ? key : null;
  }
  function parseImport(text, year, format, names = []) {
    const days = {}; const errors = []; let current = null;
    if (!Number.isInteger(Number(year)) || Number(year) < 1000 || Number(year) > 9999) errors.push('Choose a valid four-digit year.');
    const normalizedText = String(text).trim().replace(/\r/g, '');
    normalizedText.split('\n').forEach((raw, i) => {
      const line = raw.trim(); if (!line) return;
      if (/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)$/.test(line)) {
        current = parseDate(line, year, format);
        if (!current) errors.push(`Line ${i+1}: invalid calendar date ${line}.`);
        else if (!own(days,current)) days[current] = { notes: [], entries: [] };
        return;
      }
      if (!current) { errors.push(`Line ${i+1}: add a valid date before this note.`); return; }
      const parsed = studyLine(line, names);
      if (parsed.kind === 'error') errors.push(`Line ${i+1}: ${parsed.error}`);
      days[current].notes.push(line);
      if (parsed.kind === 'entry') days[current].entries.push(parsed);
    });
    const signature = JSON.stringify([normalizedText, Number(year), format]);
    return { days, errors, signature };
  }
  function syncEntries(data, date, text) {
    const excluded = new Map();
    for (const batch of data.imports) for (const line of batch.lines[date] || []) excluded.set(line, (excluded.get(line)||0)+1);
    const previous = new Map(data.entries.filter(e => e.date === date && e.source === 'sync' && e.noteLine).map(e => [e.noteLine,e.subjectId]));
    const entries = []; const errors = [];
    String(text).split('\n').forEach((line,i) => {
      // Stamped summaries are plain notes, never study input.
      if (/^\[Study summary\]/.test(line.trim())) return;
      const parsed = studyLine(line, data.subjects.map(s => s.name));
      if (parsed.kind === 'error') errors.push(`Line ${i+1}: ${parsed.error}`);
      if (parsed.kind !== 'entry') return;
      if ((excluded.get(parsed.line)||0) > 0) { excluded.set(parsed.line, excluded.get(parsed.line)-1); return; }
      if (previous.has(parsed.line)) {
        parsed.subjectId = previous.get(parsed.line);
        parsed.subject = data.subjects.find(s => s.id === parsed.subjectId).name;
      }
      entries.push(parsed);
    });
    return { entries, errors };
  }
  function applyImport(data, parsed) {
    if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
    if (data.imports.some(batch => batch.signature === parsed.signature)) return false;
    const batch = { id: id(), signature: parsed.signature, lines: {} };
    for (const [date, day] of Object.entries(parsed.days)) {
      batch.lines[date] = day.entries.map(e => e.line);
      for (const e of day.entries) data.entries.push({ id: id(), date, subjectId: subject(data,e.subject).id,
        duration: e.duration, source: 'import', importId: batch.id });
      const notes = day.notes.join('\n');
      data.notes[date] = [data.notes[date], notes].filter(Boolean).join('\n');
    }
    data.imports.push(batch); return true;
  }
  function applySync(data, date, parsed) {
    if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
    data.entries = data.entries.filter(e => !(e.date === date && e.source === 'sync'));
    for (const e of parsed.entries) data.entries.push({ id: id(), date, subjectId: e.subjectId || subject(data,e.subject).id,
      duration: e.duration, source: 'sync', noteLine: e.line });
  }
  function commitSession(data, sessionId, blocks) {
    if (data.sessions.some(s => s.id === sessionId)) return false;
    if (!blocks.length) throw new Error('There is no new study time to save.');
    for (const b of blocks) {
      if (!positive(b.duration) || !validDate(b.date) || !data.subjects.some(s => s.id === b.subjectId)) throw new Error('Check every block’s duration, date, and subject.');
    }
    data.sessions.unshift({ id: sessionId, createdAt: new Date().toISOString(), legacy: false });
    for (const block of blocks) data.entries.push({ id: id(), date: block.date, subjectId: block.subjectId,
      duration: block.duration, source: 'session', sessionId });
    return true;
  }
  function totals(data, date) {
    const bySubject = new Map(); let total = 0;
    for (const e of data.entries) if (!date || e.date === date) {
      total += e.duration; bySubject.set(e.subjectId, (bySubject.get(e.subjectId)||0)+e.duration);
    }
    return { total, bySubject };
  }
  function migrate(legacy = {}) {
    const data = empty(); data.settings = settings(legacy.settings || { goal: legacy.dailyGoalHours,
      weekStart: legacy.weekStart, dateFormat: legacy.dateFormat });
    for (const name of legacy.customSubjects || ['Overall Work','Math','Coding','Reading']) {
      if (typeof name !== 'string') throw new Error('Invalid legacy subjects.');
      subject(data, name);
    }
    const diary = legacy.studyDiary || {};
    if (!diary || Array.isArray(diary) || typeof diary !== 'object') throw new Error('Invalid legacy diary.');
    for (const [date, day] of Object.entries(diary)) {
      if (!validDate(date) || !day || typeof day !== 'object') throw new Error('Invalid legacy diary date or record.');
      if (day.notes !== undefined && typeof day.notes !== 'string') throw new Error('Invalid legacy notes.');
      data.notes[date] = day.notes || '';
      const list = Object.entries(day.subjects || {}).filter(([,ms]) => ms !== 0);
      if (list.some(([,ms]) => !Number.isFinite(ms) || ms < 0)) throw new Error('Invalid legacy study duration.');
      const sum = list.reduce((total,[,ms]) => total + ms, 0);
      const total = day.totalMs === undefined ? Math.round(sum) : Math.round(day.totalMs);
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid legacy daily total.');
      if (!total) continue;
      if (!list.length) list.push(['Overall Work', total]);
      const values = allocate(total,list.map(([,ms]) => ms));
      list.forEach(([name],i) => data.entries.push({ id: id(), date, subjectId: subject(data,name,false).id,
        duration: values[i], source: 'legacy' }));
    }
    if (!Array.isArray(legacy.savedRuns || [])) throw new Error('Invalid legacy archive.');
    for (const run of legacy.savedRuns || []) {
      if (!run || typeof run !== 'object' || !Number.isFinite(run.totalTime) || run.totalTime < 0) throw new Error('Invalid legacy session.');
      data.sessions.push({ id: id(), legacy: true, createdAt: '', label: `${run.date || ''} ${run.time || ''}`.trim(),
        total: Math.round(run.totalTime), subjectId: subject(data,run.subject || 'Overall Work',false).id,
        blocks: Array.isArray(run.laps) ? run.laps.map(lap => ({ duration: Math.max(0,Math.round(lap.duration || 0)),
          subjectId: subject(data,lap.subject || run.subject || 'Overall Work',false).id })) : [] });
    }
    if (!data.subjects.some(s => !s.hidden)) subject(data,'Overall Work');
    return validate(data);
  }
  function validate(input) {
    if (!input || input.version !== 2) throw new Error('Unsupported backup version.');
    const data = clone(input);
    for (const key of ['subjects','entries','sessions','imports']) if (!Array.isArray(data[key])) throw new Error(`Invalid ${key}.`);
    if (!data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) throw new Error('Invalid notes.');
    const unique = (items,label) => {
      const seen = new Set();
      for (const item of items) {
        if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id)) throw new Error(`Invalid or duplicate ${label} ID.`);
        seen.add(item.id);
      }
      return seen;
    };
    const subjects = unique(data.subjects,'subject'); const sessions = unique(data.sessions,'session'); const batches = unique(data.imports,'import');
    unique(data.entries,'entry');
    const names = new Set();
    for (const s of data.subjects) {
      if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 100 || names.has(normalize(s.name)) || typeof s.hidden !== 'boolean') throw new Error('Invalid or duplicate subject name.');
      names.add(normalize(s.name));
    }
    if (!data.subjects.some(s => !s.hidden)) throw new Error('Keep at least one selectable subject.');
    for (const e of data.entries) {
      if (!validDate(e.date) || !positive(e.duration) || !subjects.has(e.subjectId) || !['manual','legacy','session','sync','import'].includes(e.source)) throw new Error('Invalid study entry.');
      if (e.source === 'session' && !sessions.has(e.sessionId)) throw new Error('Entry references a missing session.');
      if (e.source === 'import' && !batches.has(e.importId)) throw new Error('Entry references a missing import.');
    }
    for (const [date,text] of Object.entries(data.notes)) if (!validDate(date) || typeof text !== 'string') throw new Error('Invalid dated note.');
    for (const s of data.sessions) {
      if (typeof s.legacy !== 'boolean' || typeof s.createdAt !== 'string') throw new Error('Invalid session record.');
      if (s.legacy && (!Number.isSafeInteger(s.total) || s.total < 0 || !subjects.has(s.subjectId) || !Array.isArray(s.blocks))) throw new Error('Invalid historical session.');
      if (s.legacy) for (const b of s.blocks) if (!Number.isSafeInteger(b.duration) || b.duration < 0 || !subjects.has(b.subjectId)) throw new Error('Invalid historical block.');
    }
    for (const batch of data.imports) {
      if (typeof batch.signature !== 'string' || !batch.lines || typeof batch.lines !== 'object' || Array.isArray(batch.lines)) throw new Error('Invalid import record.');
      for (const [date,lines] of Object.entries(batch.lines)) if (!validDate(date) || !Array.isArray(lines) || lines.some(l => typeof l !== 'string')) throw new Error('Invalid import lines.');
    }
    if (!Number.isSafeInteger(totals(data).total)) throw new Error('Study totals exceed the supported range.');
    if (typeof data.revision !== 'string' || !data.revision) throw new Error('Invalid data revision.');
    if (data.restoreToken !== undefined && (typeof data.restoreToken !== 'string' || !data.restoreToken)) throw new Error('Invalid restore identity.');
    if (data.restoredDraft) validateDraft(data.restoredDraft,data);
    data.settings = settings(data.settings);
    return data;
  }
  function newDraft(subjectId) {
    return { version: 2, id: id(), activeSubjectId: subjectId, running: false, startedAt: 0,
      elapsed: 0, blockElapsed: 0, blocks: [], lastChime: 0, needsReview: false, legacyNotice: false };
  }
  function draftTimes(draft, now = Date.now()) {
    const delta = draft.running ? Math.max(0, now - draft.startedAt) : 0;
    return { total: draft.elapsed + delta, block: draft.blockElapsed + delta };
  }
  function checkpoint(draft, now = Date.now()) {
    const times = draftTimes(draft,now);
    draft.elapsed = Math.round(times.total); draft.blockElapsed = Math.round(times.block);
    draft.startedAt = draft.running ? now : 0;
  }
  function pause(draft, now = Date.now()) { checkpoint(draft,now); draft.running = false; draft.startedAt = 0; }
  function closeBlock(draft, now = Date.now()) {
    checkpoint(draft,now);
    if (!draft.blockElapsed) return false;
    draft.blocks.push({ duration: draft.blockElapsed, subjectId: draft.activeSubjectId, date: dateKey(new Date(now)), legacyCredited: false });
    draft.blockElapsed = 0; return true;
  }
  function validateDraft(input, data) {
    if (!input) return null;
    const draft = clone(input);
    if (draft.version !== 2 || typeof draft.id !== 'string' || !draft.id || !data.subjects.some(s => s.id === draft.activeSubjectId)
      || typeof draft.running !== 'boolean' || !Number.isSafeInteger(draft.startedAt) || draft.startedAt < 0
      || (draft.running && !draft.startedAt) || !Number.isSafeInteger(draft.elapsed) || draft.elapsed < 0
      || !Number.isSafeInteger(draft.blockElapsed) || draft.blockElapsed < 0 || !Array.isArray(draft.blocks)
      || !Number.isSafeInteger(draft.lastChime) || draft.lastChime < 0
      || typeof draft.needsReview !== 'boolean' || typeof draft.legacyNotice !== 'boolean') throw new Error('Invalid active draft.');
    for (const b of draft.blocks) if (!positive(b.duration) || !validDate(b.date)
      || !data.subjects.some(s => s.id === b.subjectId) || typeof b.legacyCredited !== 'boolean') throw new Error('Invalid draft block.');
    const recorded = draft.blocks.reduce((sum,b) => sum+b.duration,0) + draft.blockElapsed;
    if (recorded !== draft.elapsed || !Number.isSafeInteger(recorded)) throw new Error('Draft block totals do not match.');
    if (!Number.isSafeInteger(draftTimes(draft).total)) throw new Error('Draft duration exceeds the supported range.');
    return draft;
  }
  function backup(input) {
    if (input?.version === 2) {
      const data = validate(input);
      delete data.draft; delete data.exportedAt;
      return { data, draft: validateDraft(input.draft || null, data) };
    }
    if (input && own(input,'studyDiary') && own(input,'savedRuns')) return { data: migrate(input), draft: null };
    throw new Error('This file is not a CHRONO FOCUS backup.');
  }
  class Store {
    constructor(storage, data) { this.storage = storage; this.data = data; this.undo = null; }
    isCurrent() {
      const raw = this.storage.getItem(KEY);
      return raw ? JSON.parse(raw).revision === this.data.revision : false;
    }
    commit(change, undoLabel = null) {
      if (!this.isCurrent()) throw new Error('Data changed in another tab. Reload before editing.');
      const next = clone(this.data); change(next); next.revision = id();
      const checked = validate(next);
      this.storage.setItem(KEY, JSON.stringify(checked));
      this.undo = undoLabel ? { data: this.data, label: undoLabel, until: Date.now()+10000 } : null;
      this.data = checked; return checked;
    }
    undoLast() {
      if (!this.undo || Date.now() > this.undo.until) throw new Error('Undo has expired.');
      const previous = clone(this.undo.data);
      return this.commit(next => { Object.assign(next,previous); });
    }
  }
  return { KEY, DRAFT_KEY, DEFAULTS, clone, id, normalize, positive, dateKey, validDate, settings, empty,
    subject, allocate, duration, studyLine, parseDate, parseImport, syncEntries, applyImport, applySync,
    commitSession, totals, migrate, validate, backup, newDraft, draftTimes, checkpoint, pause, closeBlock, validateDraft, Store };
});
