/* CHRONO FOCUS UI. User content uses textContent and value, never HTML. */
(function () {
  'use strict';
  const C = window.ChronoCore;
  const $ = id => document.getElementById(id);
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function button(text, action, value, className) {
    const node = el('button',text,className); node.type = 'button';
    if (action) node.dataset.action = action;
    if (value !== undefined) node.dataset.value = value;
    return node;
  }
  function field(label, control) {
    const node = el('label',undefined,'field'); node.append(document.createTextNode(label),control); return node;
  }
  function pretty(ms) {
    if (!ms) return '0m';
    const seconds = Math.floor(ms/1000), hours = Math.floor(seconds/3600), minutes = Math.floor(seconds%3600/60);
    return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : seconds ? `${seconds}s` : '<1s';
  }
  const durationInput = ms => ms % 60000 === 0 ? `${ms / 60000}m` : `${ms / 1000}s`;
  function timeParts(ms, precision = 2) {
    const total = Math.floor(Math.max(0,ms)/1000), hours = Math.floor(total/3600);
    const pad = (value, width = 2) => String(value).padStart(width,'0');
    return [(hours ? pad(hours)+':' : '') + pad(Math.floor(total%3600/60))+':'+pad(total%60),
      '.'+pad(precision === 3 ? Math.floor(ms%1000) : Math.floor(ms%1000/10),precision)];
  }
  class ChronoStudyApp {
    constructor() {
      this.storage = window.localStorage;
      this.tab = 'timer'; this.focusMode = false; this.stale = false; this.raf = null;
      this.entryId = null; this.pendingImport = null; this.pendingRestore = null;
      this.audio = null; this.worker = null; this.fallbackTicker = null;
      this.lastCheckpoint = Date.now(); this.lastWall = Date.now(); this.lastMono = performance.now();
      this.noteTimers = new Map(); this.dirtyNotes = new Map();
      this.load(); this.bind(); this.setupTicker(); this.renderAll();
      window.addEventListener('storage', e => {
        if (e.key !== C.KEY && e.key !== C.DRAFT_KEY && e.key !== null) return;
        try {
          // A queued event from navigation can describe a revision that is no
          // longer current. Compare the current stored versions, not the event.
          const draft = this.storage.getItem(C.DRAFT_KEY);
          if (!this.store.isCurrent() || (draft ? JSON.parse(draft).revision : null) !== this.draftRevision) this.markStale();
        } catch { this.markStale(); }
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { this.renderTimer(); this.renderDiaryIfVisible(); }
        this.flushNotes(); this.persistDraft();
      });
      window.addEventListener('pagehide', () => { this.flushNotes(); this.persistDraft(); });
      window.addEventListener('beforeunload', e => {
        this.flushNotes(); this.persistDraft();
        if (this.dirtyNotes.size || this.draftWriteFailed) { e.preventDefault(); e.returnValue = ''; }
      });
      if (this.draft.needsReview || this.draft.legacyNotice) this.toast('Recovered draft is paused. Review it before saving.');
    }
    get data() { return this.store.data; }
    get settings() { return this.data.settings; }
    load() {
      const raw = this.storage.getItem(C.KEY); let data;
      if (raw) data = C.validate(JSON.parse(raw));
      else {
        const parse = (key, fallback) => {
          const value = this.storage.getItem(key); return value === null ? fallback : JSON.parse(value);
        };
        const value = (key, fallback) => this.storage.getItem(key) ?? fallback;
        data = C.migrate({ studyDiary: parse('chrono_study_diary_v1',{}), savedRuns: parse('chrono_focus_study_history',[]),
          customSubjects: parse('chrono_focus_custom_subjects',['Overall Work','Math','Coding','Reading']), settings: {
            theme: value('chrono_oled_theme','emerald'), precision: Number(value('chrono_oled_precision','2')),
            sound: value('chrono_oled_sound','true') === 'true', goal: Number(value('chrono_focus_daily_goal_hours','4')),
            weekStart: value('chrono_focus_week_start','monday'), dateFormat: value('chrono_focus_date_format','DD/MM'),
            chime: Number(value('chrono_focus_interval_chime','0')), idle: Number(value('chrono_focus_idle_alert','120')),
            confirm: value('chrono_focus_confirm_end', value('chrono_focus_confirm_end_session','always'))
          } });
        // Original keys are intentionally retained and never rewritten by v2.
        this.storage.setItem(C.KEY,JSON.stringify(data));
      }
      this.store = new C.Store(this.storage,data);
      this.loadDraft(); this.week = this.weekStart(new Date());
    }
    loadDraft() {
      const raw = this.storage.getItem(C.DRAFT_KEY), state = raw ? JSON.parse(raw) : null;
      this.draftRevision = state?.revision || null;
      if (state && state.documentToken === (this.data.restoreToken || 'initial')) this.draft = C.validateDraft(state,this.data);
      else if (this.data.restoredDraft) this.draft = C.validateDraft(this.data.restoredDraft,this.data);
      else if (!this.data.restoreToken && !raw && this.storage.getItem('chrono_focus_active_session')) this.draft = this.migrateDraft(JSON.parse(this.storage.getItem('chrono_focus_active_session')));
      else this.draft = C.newDraft(this.data.subjects.find(s => !s.hidden).id);
      if (this.data.sessions.some(s => s.id === this.draft.id)) this.draft = C.newDraft(this.draft.activeSubjectId);
      if (this.draft.running && (this.draft.startedAt > Date.now() || this.draft.needsReview)) { C.pause(this.draft); this.draft.needsReview = true; }
      this.persistDraft();
    }
    migrateDraft(old) {
      if (!old || !Number.isFinite(old.accumulatedTime) || old.accumulatedTime < 0 || !Array.isArray(old.laps)) throw new Error('The older active session needs recovery; its original data has been preserved.');
      const active = this.data.subjects.find(s => C.normalize(s.name) === C.normalize(old.activeSubject || 'Overall Work')) || this.data.subjects[0];
      const draft = C.newDraft(active.id);
      const delta = old.running && Number.isFinite(old.startTime) ? Math.max(0,Date.now()-old.startTime) : 0;
      const total = Math.round(old.accumulatedTime + delta);
      for (const lap of [...old.laps].reverse()) {
        if (!C.positive(Math.round(lap.duration))) throw new Error('Invalid historical draft block.');
        const sub = this.data.subjects.find(s => C.normalize(s.name) === C.normalize(lap.subject || active.name)) || active;
        draft.blocks.push({ duration: Math.round(lap.duration), subjectId: sub.id,
          date: C.dateKey(new Date(Number.isFinite(lap.timestamp) ? lap.timestamp : Date.now())), legacyCredited: true });
      }
      const completed = draft.blocks.reduce((sum,b) => sum+b.duration,0);
      draft.blockElapsed = Math.max(0,total-completed); draft.elapsed = completed+draft.blockElapsed;
      draft.legacyNotice = true; draft.needsReview = true;
      return C.validateDraft(draft,this.data);
    }
    persistDraft() {
      if (this.stale || !this.draft) return false;
      try {
        const raw = this.storage.getItem(C.DRAFT_KEY), revision = raw ? JSON.parse(raw).revision : null;
        if (revision !== this.draftRevision) { this.markStale(); return false; }
        const next = C.clone(this.draft); C.checkpoint(next);
        next.revision = C.id(); next.documentToken = this.data.restoreToken || 'initial';
        C.validateDraft(next,this.data); this.storage.setItem(C.DRAFT_KEY,JSON.stringify(next));
        this.draftRevision = next.revision; this.draftWriteFailed = false; this.lastCheckpoint = Date.now(); return true;
      } catch (error) { this.draftWriteFailed = true; this.warn(`Draft could not be saved: ${error.message}. Download a backup before closing this page.`); return false; }
    }
    markStale() {
      if (this.stale) return;
      this.stale = true; C.pause(this.draft); this.renderTimer();
      $('activeSubject').disabled = true;
      for (const note of document.querySelectorAll('[data-note-date]')) note.readOnly = true;
      this.warn('Another tab changed your data or draft. This tab is paused. Reload before editing.',true);
    }
    warn(text, reload = false) {
      const box = $('storageWarning'); box.hidden = false; box.replaceChildren(el('span',text));
      if (reload) { const b = button('Reload'); b.addEventListener('click',() => location.reload()); box.append(b); }
      const active = [...document.querySelectorAll('dialog[open]')].pop();
      if (active) { const body = active.querySelector('.dialog-body'); body.querySelector('.dialog-warning')?.remove(); const warning = el('p',text,'notice dialog-warning'); warning.setAttribute('role','alert'); body.prepend(warning); }
    }
    mutate(change, message, undoLabel = null, rerender = true) {
      if (this.stale) { this.toast('Reload this tab before editing.'); return false; }
      try {
        if (!this.flushNotes()) return false;
        this.store.commit(change,undoLabel); this.updateUndo();
        if (rerender) this.renderAll(); if (message) this.toast(message); return true;
      } catch (error) { this.warn(`Changes were not saved: ${error.message}`); return false; }
    }
    setupTicker() {
      try {
        if (location.protocol === 'file:') throw new Error('Use timestamp recovery with a local ticker for direct-file mode.');
        this.worker = new Worker('worker.js');
        this.worker.onmessage = () => this.tick();
        this.worker.onerror = () => { this.worker.terminate(); this.worker = null; this.ensureFallback(); };
        this.worker.postMessage('start');
      } catch { this.ensureFallback(); }
      this.startFrames();
    }
    startFrames() {
      if (this.raf || !this.draft.running) return;
      const frame = () => { this.raf = null; this.renderTimer(); if (this.draft.running) this.raf = requestAnimationFrame(frame); };
      this.raf = requestAnimationFrame(frame);
    }
    ensureFallback() { if (!this.fallbackTicker) this.fallbackTicker = setInterval(() => this.tick(),1000); }
    tick() {
      const now = Date.now(), mono = performance.now();
      if (this.draft.running && (now < this.lastWall || Math.abs((now-this.lastWall)-(mono-this.lastMono)) > 5000)) {
        C.pause(this.draft,now); this.draft.needsReview = true; this.persistDraft(); this.toast('Clock change or interrupted timing detected. Review this session before saving.');
      }
      this.lastWall = now; this.lastMono = mono;
      if (this.draft.running && this.settings.chime) {
        const bucket = Math.floor(C.draftTimes(this.draft).total/(this.settings.chime*60000));
        if (bucket > this.draft.lastChime) { this.draft.lastChime = bucket; this.tone(true); this.toast(`${bucket*this.settings.chime} minutes of study.`); }
      }
      if (this.draft.running && now-this.lastCheckpoint >= 5000) this.persistDraft(); this.renderTimer(); this.updateUndo();
    }
    tone(chime = false) {
      if (!this.settings.sound) return;
      try {
        const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
        this.audio ||= new Audio(); this.audio.resume().catch(() => {});
        const oscillator = this.audio.createOscillator(), gain = this.audio.createGain(), now = this.audio.currentTime;
        oscillator.frequency.value = chime ? 660 : 440;
        gain.gain.setValueAtTime(.04,now); gain.gain.exponentialRampToValueAtTime(.001,now+(chime ? .35 : .05));
        oscillator.connect(gain); gain.connect(this.audio.destination); oscillator.start(); oscillator.stop(now+(chime ? .35 : .05));
      } catch { /* Audio availability never affects recording. */ }
    }
    subjectName(id) { return this.data.subjects.find(s => s.id === id)?.name || 'Unknown subject'; }
    subjectSelect(selected, includeHidden = false) {
      const select = el('select');
      for (const sub of this.data.subjects) if (!sub.hidden || includeHidden || sub.id === selected) {
        const option = el('option',sub.name+(sub.hidden ? ' (hidden)' : '')); option.value = sub.id; select.append(option);
      }
      select.value = selected; return select;
    }
    weekStart(date) { const day = new Date(date); day.setHours(0,0,0,0); day.setDate(day.getDate()-((day.getDay()+(this.settings.weekStart === 'monday' ? 6 : 0))%7)); return day; }
    displayDate(key) { const [,m,d] = key.split('-'); return this.settings.dateFormat === 'MM/DD' ? `${m}/${d}` : `${d}/${m}`; }
    renderAll() {
      document.documentElement.dataset.theme = this.settings.theme;
      const picker = this.subjectSelect(this.draft.activeSubjectId); $('activeSubject').replaceChildren(...picker.children); $('activeSubject').value = this.draft.activeSubjectId;
      this.renderTimer(); this.renderBlocks(); this.renderDiary(); this.renderSubjects(); this.renderHistory(); this.renderSettings();
    }
    renderTimer() {
      const {total,block} = C.draftTimes(this.draft), parts = timeParts(total,this.settings.precision);
      $('primaryTime').textContent = parts[0]; $('millisTime').textContent = parts[1]; document.body.classList.toggle('running',this.draft.running);
      $('statusPill').textContent = this.stale ? 'Paused — reload required' : this.draft.running ? 'Studying' : total ? 'Paused' : 'Ready to study';
      $('btnStart').textContent = this.draft.running ? 'Pause study' : total ? 'Resume study' : 'Start study';
      $('btnStart').disabled = this.stale; $('btnLap').disabled = !this.draft.running || this.stale; $('btnReset').disabled = !total || this.stale;
      $('blockPreview').textContent = total ? `Block ${this.draft.blocks.length+1} · ${pretty(block)} · Draft, not saved yet` : 'Blocks stay in a draft until you save.';
      const title = this.draft.running ? `${parts[0]} · ${this.subjectName(this.draft.activeSubjectId)} · CHRONO FOCUS` : 'CHRONO FOCUS'; if (document.title !== title) document.title = title;
    }
    renderBlocks() {
      const body = $('blocksBody'); body.replaceChildren(); $('blockCount').textContent = this.draft.blocks.length;
      for (const [i,b] of this.draft.blocks.entries()) {
        const row = el('tr'); row.append(el('td',i+1),el('td',this.subjectName(b.subjectId)),el('td',pretty(b.duration)),el('td',this.displayDate(b.date)+(b.legacyCredited ? ' · already recorded' : ''))); body.append(row);
      }
      if (!this.draft.blocks.length) { const row = el('tr'), cell = el('td','No completed draft blocks.'); cell.colSpan = 4; row.append(cell); body.append(row); }
      $('copyBlocks').disabled = !this.draft.blocks.length; $('exportCsv').disabled = !this.draft.blocks.length;
    }
    entriesUI(entries, legacyBlocks = null) {
      const list = el('div');
      if (legacyBlocks) { for (const b of legacyBlocks) list.append(el('p',`${this.subjectName(b.subjectId)} · ${pretty(b.duration)}`,'muted')); return list; }
      for (const entry of entries) {
        const row = el('div',undefined,'entry-row'), description = el('div',undefined,'entry-description');
        description.append(el('span',`${this.subjectName(entry.subjectId)} · ${pretty(entry.duration)}`),el('small',`${this.displayDate(entry.date)} · ${entry.source === 'legacy' ? 'Legacy daily total' : entry.source === 'sync' ? 'Synced note' : entry.source}`));
        const actions = el('div',undefined,'row-actions'); actions.append(button('Edit','edit-entry',entry.id),button('Delete','delete-entry',entry.id,'danger')); row.append(description,actions); list.append(row);
      }
      if (!entries.length) list.append(el('p','No saved study entries.','muted')); return list;
    }
    renderDiaryIfVisible() { if (this.tab === 'diary') this.renderDiary(); }
    renderDiary() {
      const expanded = new Set([...$('daysList').querySelectorAll('details[open]')].map(n => n.dataset.detail));
      const focused = document.activeElement?.dataset.noteDate;
      const start = focused ? document.activeElement.selectionStart : null, end = focused ? document.activeElement.selectionEnd : null;
      const days = $('daysList'); days.replaceChildren(); let weekTotal = 0; const bySubject = new Map(); let lastKey;
      for (let i=0;i<7;i++) {
        const date = new Date(this.week); date.setDate(date.getDate()+i); const key = C.dateKey(date); lastKey = key;
        const {total,bySubject: subjects} = C.totals(this.data,key); weekTotal += total;
        const card = el('article',undefined,'day-card'); card.dataset.date = key;
        const header = el('div',undefined,'day-header'), name = el('div');
        name.append(el('h3',date.toLocaleDateString('en',{weekday:'long'})),el('span',this.displayDate(key),'muted'));
        if (key === C.dateKey()) name.append(el('span','TODAY','today-label')); header.append(name,el('span',pretty(total),'day-total')); card.append(header);
        const goal = el('div',undefined,'day-goal'), progress = el('progress'); progress.max = this.settings.goal*3600000; progress.value = total; progress.setAttribute('aria-label',`Daily goal for ${key}`);
        goal.append(progress,el('span',`${pretty(total)} / ${this.settings.goal}h goal`,'muted')); card.append(goal);
        const badges = el('div',undefined,'day-subjects');
        for (const [sid,ms] of subjects) {
          const badge = el('span',`${this.subjectName(sid)} ${pretty(ms)} `), remove = button('×','clear-subject',sid);
          remove.dataset.date = key; remove.setAttribute('aria-label',`Remove ${this.subjectName(sid)} time from ${key}`);
          badge.append(remove); badges.append(badge); bySubject.set(sid,(bySubject.get(sid)||0)+ms);
        } card.append(badges);
        const note = el('textarea'); note.value = this.dirtyNotes.has(key) ? this.dirtyNotes.get(key) : this.data.notes[key] || ''; note.dataset.noteDate = key; note.setAttribute('aria-label',`Notes for ${date.toLocaleDateString('en',{weekday:'long'})} ${key}`); note.placeholder = 'Study notes, topics, or 45m Math…'; card.append(note);
        const footer = el('div',undefined,'day-footer'), save = el('span',this.dirtyNotes.has(key) ? 'Unsaved notes' : 'Notes saved','muted'); save.dataset.saveDate = key;
        const actions = el('details',undefined,'day-actions'); actions.dataset.detail = `actions-${key}`; actions.open = expanded.has(actions.dataset.detail);
        const tools = el('div',undefined,'detail-tools'); tools.append(button('Add time','add-entry',key),button('Sync notes','sync-notes',key),button('Stamp summary','stamp',key),button('Clear time','clear-day',key,'danger'));
        actions.append(el('summary','Day actions'),tools); footer.append(save,actions); card.append(footer);
        const detail = el('details'); detail.dataset.detail = `entries-${key}`; detail.open = expanded.has(detail.dataset.detail);
        const entries = this.data.entries.filter(e => e.date === key); detail.append(el('summary',`Entries (${entries.length})`),this.entriesUI(entries)); card.append(detail); days.append(card);
      }
      $('weekTitle').textContent = `${this.displayDate(C.dateKey(this.week))} – ${this.displayDate(lastKey)} · ${this.week.getFullYear()}`;
      $('weekTotal').textContent = pretty(weekTotal); $('weekAverage').textContent = pretty(weekTotal/7);
      const top = [...bySubject].sort((a,b) => b[1]-a[1])[0]; $('weekTop').textContent = top ? this.subjectName(top[0]) : '—';
      if (focused) { const note = [...days.querySelectorAll('textarea')].find(n => n.dataset.noteDate === focused); if (note) { note.focus(); note.setSelectionRange(start,end); } }
    }
    renderSubjects() {
      const list = $('settingsSubjects'); list.replaceChildren();
      for (const sub of this.data.subjects.filter(s => !s.hidden)) {
        const row = el('div',undefined,'subject-row'), actions = el('div',undefined,'row-actions'); actions.append(button('Rename','rename-subject',sub.id),button('Remove','remove-subject',sub.id)); row.append(el('span',sub.name),actions); list.append(row);
      }
    }
    renderSettings() {
      for (const key of Object.keys(C.DEFAULTS)) $('setting'+key[0].toUpperCase()+key.slice(1)).value = String(this.settings[key]);
      $('recoveryButton').hidden = !this.storage.getItem('chrono_focus_pre_restore');
    }
    renderHistory() {
      const list = $('historyList'); list.replaceChildren();
      for (const session of this.data.sessions) {
        const entries = this.data.entries.filter(e => e.sessionId === session.id);
        const total = session.legacy ? session.total : entries.reduce((sum,e) => sum+e.duration,0);
        const first = entries[0]?.subjectId || session.subjectId || this.draft.activeSubjectId;
        const item = el('article',undefined,'history-item'); item.append(el('h3',session.legacy ? `Historical session · ${session.label || 'Unknown date'}` : new Date(session.createdAt).toLocaleString()),el('p',`${pretty(total)} · ${entries.length || session.blocks?.length || 0} blocks`));
        if (session.legacy) item.append(el('p','Historical archive only. Its time is already represented by migrated diary totals.','muted'));
        const details = el('details'); details.append(el('summary','View / edit entries'),this.entriesUI(entries,session.legacy ? session.blocks : null)); item.append(details);
        const tools = el('div',undefined,'detail-tools'); tools.append(button('Start new session','new-session',first),button('Delete session','delete-session',session.id,'danger')); item.append(tools); list.append(item);
      }
      if (!this.data.sessions.length) list.append(el('p','Saved sessions will appear here.','muted')); $('clearHistory').disabled = !this.data.sessions.length;
    }
    toggleTimer() {
      if (this.stale) return;
      if (this.draft.running) C.pause(this.draft);
      else { this.draft.running = true; this.draft.startedAt = Date.now(); this.lastWall = Date.now(); this.lastMono = performance.now(); this.draft.lastChime = this.settings.chime ? Math.floor(this.draft.elapsed/(this.settings.chime*60000)) : 0; }
      this.persistDraft(); this.startFrames(); this.renderTimer(); this.tone();
    }
    nextBlock() { if (this.stale || !this.draft.running) return; C.closeBlock(this.draft); this.persistDraft(); this.renderBlocks(); this.tone(); this.toast('Block added to the draft.'); }
    chooseSubject(sid) {
      if (this.stale || sid === this.draft.activeSubjectId || !this.data.subjects.some(s => s.id === sid)) return;
      C.closeBlock(this.draft); this.draft.activeSubjectId = sid; this.persistDraft(); this.renderAll();
    }
    endSession() {
      if (this.stale || !C.draftTimes(this.draft).total) return;
      C.pause(this.draft); C.closeBlock(this.draft); this.persistDraft(); this.renderBlocks(); this.reviewBlocks = C.clone(this.draft.blocks.filter(b => !b.legacyCredited));
      if (this.settings.confirm === 'auto' && !this.draft.needsReview && !this.draft.legacyNotice) { this.saveSession(false); return; }
      this.showReview();
    }
    showReview() {
      $('reviewTotal').textContent = pretty(this.reviewBlocks.reduce((sum,b) => sum+b.duration,0)); const warnings = [];
      if (this.draft.legacyNotice) warnings.push('Recovered older draft: completed blocks were already recorded by the old app. Only new or unfinished time will be saved here. Historical blocks remain in the draft log.');
      if (this.draft.needsReview) warnings.push('Recovered or interrupted timing: verify the actual study duration.');
      if (this.settings.idle && this.draft.elapsed > this.settings.idle*60000) warnings.push('This session exceeds your review-warning threshold. Adjust time if you forgot to pause.');
      $('reviewWarning').textContent = warnings.join('\n'); $('reviewWarning').hidden = !warnings.length; $('adjustTotal').value = ''; $('reviewError').textContent = ''; this.renderReview(); this.open('reviewModal');
    }
    renderReview() {
      $('reviewBlocks').replaceChildren(); this.reviewBlocks.forEach((block,index) => {
        const row = el('div',undefined,'review-block'); row.append(el('h3',`Block ${index+1}`));
        const select = this.subjectSelect(block.subjectId,true); select.dataset.reviewSubject = index;
        const date = el('input'); date.type = 'date'; date.value = block.date; date.dataset.reviewDate = index;
        const duration = el('input'); duration.value = durationInput(block.duration); duration.dataset.reviewDuration = index;
        row.append(field('Subject',select),field('Date',date),field('Duration',duration)); $('reviewBlocks').append(row);
      });
      if (!this.reviewBlocks.length) $('reviewBlocks').append(el('p','No new time to save. Discard this recovered draft to finish.','muted'));
    }
    saveSession(readInputs = true) {
      try {
        const blocks = C.clone(this.reviewBlocks);
        if (readInputs) {
          blocks.forEach((b,i) => {
            b.subjectId = document.querySelector(`[data-review-subject="${i}"]`).value; b.date = document.querySelector(`[data-review-date="${i}"]`).value; b.duration = C.duration(document.querySelector(`[data-review-duration="${i}"]`).value);
            if (!b.duration || !C.validDate(b.date)) throw new Error('Every block needs a valid date and positive duration.');
          });
          if ($('adjustTotal').value.trim()) {
            const total = C.duration($('adjustTotal').value); if (!total) throw new Error('Enter a valid whole-session duration.');
            const values = C.allocate(total,blocks.map(b => b.duration)); blocks.forEach((b,i) => b.duration = values[i]);
          }
        }
        if (!this.mutate(data => C.commitSession(data,this.draft.id,blocks),null)) return;
        this.resetDraft(true); this.close('reviewModal'); this.toast('Session saved once to your notebook.');
      } catch (error) { if (!readInputs) this.showReview(); $('reviewError').textContent = error.message; }
    }
    resetDraft(committed = false) {
      const previous = this.draft; this.draft = C.newDraft(previous.activeSubjectId);
      const saved = this.persistDraft();
      if (!saved && !committed) this.draft = previous;
      this.renderAll(); return saved;
    }
    discard() { if (this.stale || !this.resetDraft()) return; this.close('reviewModal'); this.toast('Draft discarded. Saved diary totals are unchanged.'); }
    openEntry(date, entryId = null) {
      const entry = entryId ? this.data.entries.find(e => e.id === entryId) : null; this.entryId = entryId;
      $('entryTitle').textContent = entry ? 'Edit study entry' : 'Add study time'; $('entryDate').value = entry?.date || date;
      const picker = this.subjectSelect(entry?.subjectId || this.draft.activeSubjectId,true); $('entrySubject').replaceChildren(...picker.children); $('entrySubject').value = entry?.subjectId || this.draft.activeSubjectId;
      $('entryDuration').value = entry ? durationInput(entry.duration) : ''; $('entryError').textContent = ''; this.open('entryModal'); $('entryDuration').focus();
    }
    saveEntry(event) {
      event.preventDefault(); const raw = $('entryDuration').value, direct = C.duration(raw);
      const parsed = direct ? null : C.studyLine(raw,this.data.subjects.map(s => s.name));
      const duration = direct || (parsed?.kind === 'entry' ? parsed.duration : null), date = $('entryDate').value;
      let sid = $('entrySubject').value;
      if (!duration || !C.validDate(date)) { $('entryError').textContent = 'Enter a valid date and positive duration.'; return; }
      if (this.mutate(data => {
        if (parsed?.kind === 'entry' && parsed.subject !== 'Overall Work') sid = C.subject(data,parsed.subject).id;
        if (this.entryId) { const entry = data.entries.find(e => e.id === this.entryId); if (!entry) throw new Error('Entry no longer exists.'); Object.assign(entry,{duration,date,subjectId:sid}); }
        else data.entries.push({id:C.id(),date,subjectId:sid,duration,source:'manual'});
      },'Study entry saved.')) this.close('entryModal');
    }
    editSubject(sid) {
      this.renamingSubject = sid; $('renameSubjectName').value = this.subjectName(sid); $('subjectError').textContent = '';
      this.open('subjectModal'); $('renameSubjectName').focus();
    }
    renameSubject(event) {
      event.preventDefault(); const name = $('renameSubjectName').value.trim(), sid = this.renamingSubject;
      if (!name || name.length > 100) { $('subjectError').textContent = 'Use a name between 1 and 100 characters.'; return; }
      if (this.data.subjects.some(s => s.id !== sid && C.normalize(s.name) === C.normalize(name))) { $('subjectError').textContent = 'That subject name already exists.'; return; }
      if (this.mutate(data => { data.subjects.find(s => s.id === sid).name = name; },null)) { this.close('subjectModal'); this.toast('Subject renamed.'); }
    }
    removeSubject(sid) {
      if (this.data.subjects.filter(s => !s.hidden).length <= 1) { this.toast('Keep at least one selectable subject.'); return; }
      if (!this.mutate(data => { data.subjects.find(s => s.id === sid).hidden = true; },'Subject removed from selection. Its history is retained.')) return;
      if (this.draft.activeSubjectId === sid) this.chooseSubject(this.data.subjects.find(s => !s.hidden).id);
    }
    addSubject(name) { let sid; if (this.mutate(data => { sid = C.subject(data,name).id; },'Subject ready.')) this.chooseSubject(sid); }
    scheduleNote(date, value) {
      if (this.stale) return;
      this.dirtyNotes.set(date,value); clearTimeout(this.noteTimers.get(date));
      const label = [...document.querySelectorAll('[data-save-date]')].find(n => n.dataset.saveDate === date); if (label) label.textContent = 'Saving…';
      this.noteTimers.set(date,setTimeout(() => this.flushNotes(),400)); this.invalidateSync(); this.updateUndo();
    }
    flushNotes() {
      if (!this.dirtyNotes.size) return true; if (this.stale) return false;
      try {
        this.store.commit(data => { for (const [date,note] of this.dirtyNotes) data.notes[date] = note; });
        for (const [date] of this.dirtyNotes) {
          clearTimeout(this.noteTimers.get(date)); const label = [...document.querySelectorAll('[data-save-date]')].find(n => n.dataset.saveDate === date); if (label) label.textContent = 'Notes saved';
        }
        this.dirtyNotes.clear(); this.noteTimers.clear(); this.updateUndo(); return true;
      } catch (error) { this.warn(`Notes are still unsaved: ${error.message}. Download a backup before closing.`); return false; }
    }
    showSync(date) {
      if (!this.flushNotes()) return;
      this.syncDate = date; this.syncText = this.data.notes[date] || ''; this.pendingSync = C.syncEntries(this.data,date,this.syncText); $('syncPreview').replaceChildren();
      if (this.pendingSync.errors.length) $('syncPreview').append(el('p',this.pendingSync.errors.join('\n'),'form-error'));
      this.previewEntries($('syncPreview'),this.pendingSync.entries,date); $('applySync').disabled = !!this.pendingSync.errors.length; this.open('syncModal');
    }
    invalidateSync() { this.pendingSync = null; $('applySync').disabled = true; }
    applySync() {
      if (!this.pendingSync || this.syncText !== (this.data.notes[this.syncDate] || '')) { this.toast('Notes changed. Preview again.'); return; }
      if (this.mutate(data => C.applySync(data,this.syncDate,this.pendingSync),'Note-generated entries updated.')) this.close('syncModal');
    }
    previewEntries(container, entries, date) {
      for (const e of entries) container.append(el('div',`${this.displayDate(date)} · ${e.subject} · ${pretty(e.duration)}`,'preview-row'));
      if (!entries.length) container.append(el('p',`${this.displayDate(date)} · No new duration entries.`,'muted'));
    }
    invalidateImport() { this.pendingImport = null; $('applyImport').disabled = true; $('importPreview').textContent = 'Preview before importing.'; }
    previewImport() {
      this.pendingImport = C.parseImport($('importText').value,Number($('importYear').value),this.settings.dateFormat,this.data.subjects.map(s => s.name));
      const container = $('importPreview'); container.replaceChildren();
      if (this.pendingImport.errors.length) container.append(el('p',this.pendingImport.errors.join('\n'),'form-error'));
      const keys = Object.keys(this.pendingImport.days); if (!keys.length) container.append(el('p','No dates found.','muted'));
      for (const date of keys) { this.previewEntries(container,this.pendingImport.days[date].entries,date); const notes = this.pendingImport.days[date].notes.filter(line => C.studyLine(line).kind !== 'entry'); if (notes.length) container.append(el('p',notes.join(' · '),'muted')); }
      if (this.data.imports.some(b => b.signature === this.pendingImport.signature)) container.append(el('p','Already imported. Applying again will add nothing.','muted'));
      $('applyImport').disabled = !keys.length || !!this.pendingImport.errors.length;
    }
    applyImport() {
      if (!this.pendingImport) return; let added;
      if (this.mutate(data => { added = C.applyImport(data,this.pendingImport); },null)) {
        const first = Object.keys(this.pendingImport.days).sort()[0]; this.week = this.weekStart(new Date(first+'T12:00:00')); this.close('importModal'); this.switchTab('diary'); this.toast(added ? 'Diary imported.' : 'Already imported; no time added.');
      }
    }
    backupObject() {
      const data = C.clone(this.data); for (const [date,note] of this.dirtyNotes) data.notes[date] = note;
      const draft = C.clone(this.draft); C.checkpoint(draft); delete data.restoredDraft;
      return {...data,draft,exportedAt:new Date().toISOString()};
    }
    download(name,text,type = 'text/plain') {
      const url = URL.createObjectURL(new Blob([text],{type})), link = el('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
    }
    async readBackup(file) {
      if (!file) return;
      if (C.draftTimes(this.draft).total || this.dirtyNotes.size) { this.toast('Save or discard the active session and save your notes before restoring.'); return; }
      try {
        this.pendingRestore = C.backup(JSON.parse(await file.text())); const pending = this.pendingRestore;
        if (pending.draft) { C.pause(pending.draft); pending.draft.needsReview ||= pending.draft.elapsed > 0; }
        const data = pending.data;
        $('restorePreview').textContent = `${data.entries.length} study entries, ${data.sessions.length} sessions, ${Object.keys(data.notes).length} notebook days, ${data.subjects.length} subjects${pending.draft?.elapsed ? ', plus a paused draft' : ''}.`;
        $('restoreError').textContent = ''; this.close('settingsModal'); this.open('restoreModal');
      } catch (error) { this.toast(`Backup not restored: ${error.message}`); }
    }
    confirmRestore() {
      if (!this.pendingRestore) return;
      if (C.draftTimes(this.draft).total || this.dirtyNotes.size || this.stale) { $('restoreError').textContent = 'Resolve the active session or reload changed data before restoring.'; return; }
      try {
        const pending = this.pendingRestore; this.storage.setItem('chrono_focus_pre_restore',JSON.stringify(this.backupObject()));
        this.store.commit(data => {
          for (const key of Object.keys(data)) delete data[key];
          Object.assign(data,C.clone(pending.data),{restoreToken:C.id(),restoredDraft:pending.draft});
        });
        this.loadDraft(); this.week = this.weekStart(new Date()); this.updateUndo(); this.renderAll(); this.close('restoreModal'); this.pendingRestore = null; this.toast('Backup restored. Previous data is available in Preferences.');
      } catch (error) { $('restoreError').textContent = `Restore did not complete: ${error.message}`; }
    }
    updateUndo() {
      const available = this.store.undo && Date.now() <= this.store.undo.until && !this.dirtyNotes.size && !this.stale;
      $('undoBar').hidden = !available; if (available) { $('undoLabel').textContent = this.store.undo.label; $('toast').hidden = true; }
    }
    undo() { try { this.store.undoLast(); this.updateUndo(); this.renderAll(); this.toast('Deletion undone.'); } catch (error) { this.toast(error.message); } }
    switchTab(tab) {
      if (!this.flushNotes()) return; if (tab === 'diary' && this.focusMode) this.toggleFocus(); this.tab = tab;
      for (const name of ['timer','diary']) { const selected = name === tab, title = name[0].toUpperCase()+name.slice(1); $('view'+title).hidden = !selected; $('tab'+title).setAttribute('aria-selected',String(selected)); $('tab'+title).tabIndex = selected ? 0 : -1; }
      if (tab === 'diary') this.renderDiary();
    }
    toggleFocus() {
      if (!this.focusMode && this.tab !== 'timer') this.switchTab('timer'); this.focusMode = !this.focusMode; document.body.classList.toggle('focus-view',this.focusMode);
      $('focusToggle').textContent = this.focusMode ? 'Exit focus view' : 'Focus view'; $('focusToggle').setAttribute('aria-pressed',String(this.focusMode));
    }
    open(id) { if (!this.flushNotes()) return; const dialog = $(id); if (!dialog.open) { dialog.returnFocus = document.activeElement; dialog.showModal(); } }
    close(id) {
      const dialog = $(id); if (!dialog.open) return; dialog.close();
      if (dialog.returnFocus?.isConnected) dialog.returnFocus.focus();
      else {
        const parent = [...document.querySelectorAll('dialog[open]')].pop();
        (parent?.querySelector('button') || $(this.tab === 'timer' ? 'tabTimer' : 'tabDiary')).focus();
      }
    }
    toast(text) {
      const active = [...document.querySelectorAll('dialog[open]')].pop();
      if (active) {
        let status = active.querySelector('.dialog-status');
        if (!status) { status = el('p',undefined,'muted dialog-status'); status.setAttribute('role','status'); active.querySelector('.dialog-body').prepend(status); }
        status.textContent = text;
      }
      $('toast').textContent = text; $('toast').hidden = false; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => $('toast').hidden = true,5000);
    }
    async copy(text) { try { await navigator.clipboard.writeText(text); this.toast('Copied.'); } catch { this.download('chrono-copy.txt',text); this.toast('Clipboard unavailable. Downloaded text instead.'); } }
    blocksText(csv = false) {
      const escape = text => '"'+String(text).replace(/"/g,'""')+'"';
      const rows = this.draft.blocks.map((b,i) => csv ? [i+1,this.subjectName(b.subjectId),b.duration,b.date].map(escape).join(',') : `${i+1}. ${this.subjectName(b.subjectId)} · ${pretty(b.duration)} · ${b.date}`);
      return (csv ? 'Block,Subject,DurationMs,Date\n' : 'Draft study blocks\n')+rows.join('\n');
    }
    weekText() {
      const lines = ['# Study week'];
      for (let i=0;i<7;i++) { const date = new Date(this.week); date.setDate(date.getDate()+i); const key = C.dateKey(date), totals = C.totals(this.data,key); lines.push('',`## ${date.toLocaleDateString('en',{weekday:'long'})} ${key}`,`Total: ${pretty(totals.total)}`); for (const [sid,ms] of totals.bySubject) lines.push(`- ${this.subjectName(sid)}: ${pretty(ms)}`); if (this.data.notes[key]) lines.push('',this.data.notes[key]); }
      return lines.join('\n');
    }
    handleAction(action,value,date) {
      if (this.stale) { this.toast('Reload this tab before editing.'); return; }
      switch (action) {
        case 'add-entry': this.openEntry(value); break;
        case 'edit-entry': this.openEntry(null,value); break;
        case 'delete-entry': this.mutate(data => { data.entries = data.entries.filter(e => e.id !== value); },null,'Study entry deleted'); break;
        case 'clear-day': this.mutate(data => { data.entries = data.entries.filter(e => e.date !== value); },null,'Day’s study time cleared'); break;
        case 'clear-subject': this.mutate(data => { data.entries = data.entries.filter(e => !(e.date === date && e.subjectId === value)); },null,'Subject time removed'); break;
        case 'rename-subject': this.editSubject(value); break;
        case 'remove-subject': this.removeSubject(value); break;
        case 'sync-notes': this.showSync(value); break;
        case 'stamp': { const totals = C.totals(this.data,value), text = `[Study summary] ${[...totals.bySubject].map(([sid,ms]) => this.subjectName(sid)+': '+pretty(ms)).join('; ') || 'No study time'}`; this.mutate(data => { data.notes[value] = [data.notes[value],text].filter(Boolean).join('\n'); },'Summary added to notes.'); break; }
        case 'delete-session': this.mutate(data => { data.sessions = data.sessions.filter(s => s.id !== value); data.entries = data.entries.filter(e => e.sessionId !== value); },null,'Session deleted'); break;
        case 'new-session': if (C.draftTimes(this.draft).total) { this.toast('Finish the current session first.'); return; } this.chooseSubject(value); this.close('historyModal'); this.switchTab('timer'); this.toggleTimer(); break;
      }
    }
    bind() {
      const on = (id,handler,event = 'click') => $(id).addEventListener(event,handler);
      on('btnStart',() => this.toggleTimer()); on('btnLap',() => this.nextBlock()); on('btnReset',() => this.endSession()); on('activeSubject',event => this.chooseSubject(event.target.value),'change');
      on('quickAddSubject',() => { this.open('settingsModal'); $('subjectName').focus(); }); on('focusToggle',() => this.toggleFocus());
      on('settingsToggle',() => { this.renderSettings(); this.open('settingsModal'); }); on('historyToggle',() => { this.renderHistory(); this.open('historyModal'); });
      on('tabTimer',() => this.switchTab('timer')); on('tabDiary',() => this.switchTab('diary'));
      on('prevWeek',() => { if (this.flushNotes()) { this.week.setDate(this.week.getDate()-7); this.renderDiary(); } }); on('nextWeek',() => { if (this.flushNotes()) { this.week.setDate(this.week.getDate()+7); this.renderDiary(); } }); on('todayWeek',() => { if (this.flushNotes()) { this.week = this.weekStart(new Date()); this.renderDiary(); } });
      on('entryForm',event => this.saveEntry(event),'submit'); on('addSubjectForm',event => { event.preventDefault(); this.addSubject($('subjectName').value); $('subjectName').value = ''; },'submit');
      on('renameSubjectForm',event => this.renameSubject(event),'submit');
      for (const key of Object.keys(C.DEFAULTS)) {
        const id = 'setting'+key[0].toUpperCase()+key.slice(1);
        on(id,event => {
          const value = event.target.value, before = this.settings.weekStart;
          if (this.mutate(data => { data.settings[key] = typeof C.DEFAULTS[key] === 'number' ? Number(value) : typeof C.DEFAULTS[key] === 'boolean' ? value === 'true' : value; },null)) {
            if (key === 'weekStart' && before !== value) { this.week = this.weekStart(this.week); this.renderDiary(); }
            if (key === 'dateFormat') { this.invalidateImport(); this.invalidateSync(); }
            if (key === 'chime') { this.draft.lastChime = Number(value) ? Math.floor(C.draftTimes(this.draft).total/(Number(value)*60000)) : 0; this.persistDraft(); }
          } else this.renderSettings();
        },'change');
      }
      on('saveSession',() => this.saveSession()); on('discardSession',() => this.discard()); on('undoButton',() => this.undo());
      on('pasteDiary',() => { $('importYear').value = new Date().getFullYear(); this.invalidateImport(); this.open('importModal'); $('importText').focus(); });
      on('importText',() => this.invalidateImport(),'input'); on('importYear',() => this.invalidateImport(),'input'); on('previewImport',() => this.previewImport()); on('applyImport',() => this.applyImport()); on('applySync',() => this.applySync());
      on('backupButton',() => this.download(`chrono-backup-${C.dateKey()}.json`,JSON.stringify(this.backupObject(),null,2),'application/json'));
      on('restoreButton',() => $('backupFile').click()); on('backupFile',event => { this.readBackup(event.target.files[0]); event.target.value = ''; },'change'); on('confirmRestore',() => this.confirmRestore());
      on('recoveryButton',() => this.download('chrono-previous-snapshot.json',this.storage.getItem('chrono_focus_pre_restore'),'application/json'));
      on('clearHistory',() => this.open('confirmModal'));
      on('confirmDeleteHistory',() => { if (this.mutate(data => { data.entries = data.entries.filter(e => e.source !== 'session'); data.sessions = []; },null)) { this.close('confirmModal'); this.toast('All sessions deleted.'); } });
      on('copyBlocks',() => this.copy(this.blocksText())); on('exportCsv',() => this.download('study-blocks.csv',this.blocksText(true),'text/csv')); on('copyWeek',() => { if (this.flushNotes()) this.copy(this.weekText()); }); on('exportWeek',() => { if (this.flushNotes()) this.download(`study-week-${C.dateKey(this.week)}.md`,this.weekText(),'text/markdown'); });
      on('fullscreenToggle',async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { this.toast('Fullscreen is unavailable in this browser.'); } });
      document.addEventListener('click',event => { const close = event.target.closest('[data-close]'); if (close) this.close(close.closest('dialog').id); const action = event.target.closest('[data-action]'); if (action) this.handleAction(action.dataset.action,action.dataset.value,action.dataset.date); });
      document.addEventListener('input',event => { if (event.target.dataset.noteDate) this.scheduleNote(event.target.dataset.noteDate,event.target.value); });
      for (const dialog of document.querySelectorAll('dialog')) {
        dialog.addEventListener('cancel',event => { event.preventDefault(); this.close(dialog.id); });
        dialog.addEventListener('click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.close(dialog.id); } });
        dialog.addEventListener('keydown',event => {
          if (event.key !== 'Tab') return;
          const nodes = [...dialog.querySelectorAll('button:not(:disabled), input:not([hidden]), select, textarea, summary')].filter(n => n.getClientRects().length), first = nodes[0], last = nodes[nodes.length-1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
      }
      document.querySelector('.tabs').addEventListener('keydown',event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault(); this.switchTab(event.key === 'Home' ? 'timer' : event.key === 'End' ? 'diary' : this.tab === 'timer' ? 'diary' : 'timer'); $(this.tab === 'timer' ? 'tabTimer' : 'tabDiary').focus();
      });
      window.addEventListener('keydown',event => {
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
        if (event.code === 'Space' && event.target.closest('button,summary')) return;
        if (event.code === 'Space') { event.preventDefault(); this.toggleTimer(); }
        else if (event.code === 'KeyL' || event.code === 'KeyB') this.nextBlock(); else if (event.code === 'KeyR') this.endSession(); else if (event.code === 'KeyN') this.switchTab(this.tab === 'timer' ? 'diary' : 'timer'); else if (event.code === 'KeyP') this.open('settingsModal'); else if (event.code === 'KeyM' || event.code === 'KeyH') this.open('historyModal'); else if (event.code === 'KeyF') $('fullscreenToggle').click(); else if (event.code === 'KeyS') this.mutate(data => { data.settings.sound = !data.settings.sound; },null); else if (event.code === 'Digit2' || event.code === 'Digit3') this.mutate(data => { data.settings.precision = Number(event.code.slice(-1)); },null); else if (event.code === 'Escape' && this.focusMode) this.toggleFocus();
      });
    }
  }
  function boot() {
    try { window.chronoApp = new ChronoStudyApp(); }
    catch (error) {
      $('app').replaceChildren(el('h1','CHRONO FOCUS'),el('p',`Stored data could not be opened: ${error.message}`,'notice'),el('p','Original data has been preserved. Download it for recovery, then reload after resolving storage access or invalid records.','muted'));
      const download = button('Download original data'); download.addEventListener('click',() => {
        const original = {};
        try { for (let i=0;i<localStorage.length;i++) { const key = localStorage.key(i); if (key.startsWith('chrono')) original[key] = localStorage.getItem(key); } } catch { /* Preserve whatever can be read. */ }
        const url = URL.createObjectURL(new Blob([JSON.stringify(original,null,2)],{type:'application/json'})), a = el('a'); a.href=url; a.download='chrono-original-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
      });
      const reload = button('Reload'); reload.addEventListener('click',() => location.reload()); $('app').append(download,reload);
    }
  }
  window.ChronoStopwatch = ChronoStudyApp;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
