/**
 * CHRONO FOCUS - High-Precision Study Timer & Weekly Notebook Diary
 * Features:
 * - OLED Zero-drift timer with background Web Worker & visibility sync
 * - Active Subject / Task tagging
 * - Weekly Study Notebook (Mon-Sun) with persistent diary notes & subject hours
 * - Daily auto-aggregation from timer + manual offline hour logging
 * - Markdown & CSV export
 */

(function () {
  'use strict';

  // --- Audio Engine (Web Audio API) ---
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }

    init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playTone(freq, type = 'sine', duration = 0.04, gainVal = 0.15) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        console.warn('Audio play failed', e);
      }
    }

    clickStart() { this.playTone(880, 'triangle', 0.05, 0.12); }
    clickStop() { this.playTone(440, 'sine', 0.06, 0.12); }
    clickLap() { this.playTone(1320, 'sine', 0.04, 0.1); }
    clickReset() {
      this.playTone(520, 'sine', 0.08, 0.1);
      setTimeout(() => this.playTone(660, 'sine', 0.1, 0.08), 80);
    }
  }

  // --- Inline Web Worker Factory ---
  function createWorker() {
    const workerCode = `
      let timerId = null;
      let intervalMs = 25;
      self.onmessage = function(e) {
        const { command, interval } = e.data || {};
        if (command === 'start') {
          if (interval) intervalMs = interval;
          if (timerId !== null) clearInterval(timerId);
          timerId = setInterval(() => {
            self.postMessage({ type: 'tick', now: Date.now() });
          }, intervalMs);
        } else if (command === 'stop') {
          if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
          }
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }

  // --- Date & Time Helper Utilities ---
  function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(date.setDate(diff));
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatDisplayDate(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}`;
  }

  function formatDurationFriendly(ms) {
    if (!ms || ms <= 0) return '0m';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  // --- Main Stopwatch & Study Diary Application ---
  class ChronoStudyApp {
    constructor() {
      // Stopwatch State
      this.running = false;
      this.startTime = 0;
      this.accumulatedTime = 0;
      this.lapStartTime = 0;
      this.accumulatedLapTime = 0;
      this.laps = [];
      this.precision = 2;
      this.theme = 'emerald';
      this.savedRuns = [];
      this.activeSubject = 'Overall Work';

      // Diary State
      this.studyDiary = {}; // Keyed by YYYY-MM-DD
      this.viewingMonday = getMonday(new Date());
      this.activeTab = 'timer'; // 'timer' or 'diary'

      this.audio = new SoundEngine();
      this.worker = createWorker();
      this.rafId = null;

      this.cacheDom();
      this.init();
    }

    cacheDom() {
      this.dom = {
        appContainer: document.getElementById('appContainer'),
        // Tabs
        tabTimer: document.getElementById('tabTimer'),
        tabDiary: document.getElementById('tabDiary'),
        viewTimer: document.getElementById('viewTimer'),
        viewDiary: document.getElementById('viewDiary'),
        navDateBadge: document.getElementById('navDateBadge'),
        // Subject picker
        activeSubjectInput: document.getElementById('activeSubjectInput'),
        quickSubjectChips: document.getElementById('quickSubjectChips'),
        // Timer display
        timerHero: document.getElementById('timerHero'),
        primaryTime: document.getElementById('primaryTime'),
        millisTime: document.getElementById('millisTime'),
        statusPill: document.getElementById('statusPill'),
        currentLapPreview: document.getElementById('currentLapPreview'),
        currentLapVal: document.getElementById('currentLapVal'),
        currentLapNumber: document.getElementById('currentLapNumber'),
        // Controls
        btnStart: document.getElementById('btnStart'),
        btnLap: document.getElementById('btnLap'),
        btnReset: document.getElementById('btnReset'),
        btnSaveSession: document.getElementById('btnSaveSession'),
        // Header tools
        soundToggleBtn: document.getElementById('soundToggleBtn'),
        fullscreenToggleBtn: document.getElementById('fullscreenToggleBtn'),
        historyToggleBtn: document.getElementById('historyToggleBtn'),
        precisionBtns: document.querySelectorAll('.precision-btn'),
        themeDots: document.querySelectorAll('.theme-dot'),
        // Live Metrics
        statTotalStudy: document.getElementById('statTotalStudy'),
        statCurrentBlock: document.getElementById('statCurrentBlock'),
        statAvgBlock: document.getElementById('statAvgBlock'),
        statTotalBlocks: document.getElementById('statTotalBlocks'),
        // Table
        lapsTableBody: document.getElementById('lapsTableBody'),
        lapsCountBadge: document.getElementById('lapsCountBadge'),
        btnCopyLaps: document.getElementById('btnCopyLaps'),
        btnExportCsv: document.getElementById('btnExportCsv'),
        // Diary
        weekRangeTitle: document.getElementById('weekRangeTitle'),
        btnPrevWeek: document.getElementById('btnPrevWeek'),
        btnNextWeek: document.getElementById('btnNextWeek'),
        btnJumpToday: document.getElementById('btnJumpToday'),
        weekTotalTime: document.getElementById('weekTotalTime'),
        weekDailyAvg: document.getElementById('weekDailyAvg'),
        weekTopSubject: document.getElementById('weekTopSubject'),
        btnCopyWeekDiary: document.getElementById('btnCopyWeekDiary'),
        btnExportWeekMd: document.getElementById('btnExportWeekMd'),
        notebookDaysList: document.getElementById('notebookDaysList'),
        // Modals
        memoryModal: document.getElementById('memoryModal'),
        memoryCloseBtn: document.getElementById('memoryCloseBtn'),
        savedRunsList: document.getElementById('savedRunsList'),
        btnClearAllHistory: document.getElementById('btnClearAllHistory'),
        btnExportJson: document.getElementById('btnExportJson'),
        manualTimeModal: document.getElementById('manualTimeModal'),
        manualTimeCloseBtn: document.getElementById('manualTimeCloseBtn'),
        manualTimeForm: document.getElementById('manualTimeForm'),
        manualDayTarget: document.getElementById('manualDayTarget'),
        manualSubjectInput: document.getElementById('manualSubjectInput'),
        manualHoursInput: document.getElementById('manualHoursInput'),
        toast: document.getElementById('toast')
      };
    }

    init() {
      this.loadSettings();
      this.loadHistory();
      this.loadDiary();
      this.restoreRunState();
      this.setupWorker();
      this.bindEvents();
      this.updateDateBadges();
      this.render();
      this.updateLapsUI();
      this.renderDiaryView();

      // Visibility API for background continuity
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.render();
          if (this.running) {
            this.startRafLoop();
          }
        }
      });

      // Window unload persistence
      window.addEventListener('beforeunload', () => {
        this.saveRunState();
      });
    }

    // --- Tab Switching ---
    switchTab(tabName) {
      this.activeTab = tabName;
      if (tabName === 'timer') {
        this.dom.tabTimer.classList.add('active');
        this.dom.tabTimer.setAttribute('aria-selected', 'true');
        this.dom.tabDiary.classList.remove('active');
        this.dom.tabDiary.setAttribute('aria-selected', 'false');
        this.dom.viewTimer.classList.add('active');
        this.dom.viewDiary.classList.remove('active');
      } else {
        this.dom.tabDiary.classList.add('active');
        this.dom.tabDiary.setAttribute('aria-selected', 'true');
        this.dom.tabTimer.classList.remove('active');
        this.dom.tabTimer.setAttribute('aria-selected', 'false');
        this.dom.viewDiary.classList.add('active');
        this.dom.viewTimer.classList.remove('active');
        this.renderDiaryView();
      }
    }

    updateDateBadges() {
      const today = new Date();
      const str = formatDisplayDate(today);
      if (this.dom.navDateBadge) {
        this.dom.navDateBadge.textContent = str;
      }
    }

    // --- Time Math & Formatting ---
    getElapsedTime() {
      if (this.running) {
        return this.accumulatedTime + (Date.now() - this.startTime);
      }
      return this.accumulatedTime;
    }

    getCurrentLapTime() {
      if (this.running) {
        return this.accumulatedLapTime + (Date.now() - this.lapStartTime);
      }
      return this.accumulatedLapTime;
    }

    formatTimeParts(ms, precision = this.precision) {
      if (ms < 0) ms = 0;
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const pad = (n, len = 2) => String(n).padStart(len, '0');

      let millisStr = '';
      if (precision === 3) {
        const millis = Math.floor(ms % 1000);
        millisStr = '.' + pad(millis, 3);
      } else {
        const hundredths = Math.floor((ms % 1000) / 10);
        millisStr = '.' + pad(hundredths, 2);
      }

      const mainStr = (hours > 0 ? pad(hours) + ':' : '') + pad(minutes) + ':' + pad(seconds);
      return { hours, minutes, seconds, mainStr, millisStr };
    }

    formatFullTime(ms, precision = this.precision) {
      const parts = this.formatTimeParts(ms, precision);
      return parts.mainStr + parts.millisStr;
    }

    // --- State Persistence ---
    saveRunState() {
      const state = {
        running: this.running,
        startTime: this.startTime,
        accumulatedTime: this.accumulatedTime,
        lapStartTime: this.lapStartTime,
        accumulatedLapTime: this.accumulatedLapTime,
        laps: this.laps,
        activeSubject: this.activeSubject,
        savedAt: Date.now()
      };
      try {
        localStorage.setItem('chrono_focus_active_session', JSON.stringify(state));
      } catch (e) {
        console.warn('Failed to save session state', e);
      }
    }

    restoreRunState() {
      try {
        const raw = localStorage.getItem('chrono_focus_active_session');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state) return;

        this.accumulatedTime = state.accumulatedTime || 0;
        this.accumulatedLapTime = state.accumulatedLapTime || 0;
        this.laps = state.laps || [];
        if (state.activeSubject) {
          this.setSubject(state.activeSubject);
        }

        if (state.running && state.startTime) {
          this.running = true;
          this.startTime = state.startTime;
          this.lapStartTime = state.lapStartTime || state.startTime;
          this.startEngine();
        }
      } catch (e) {
        console.warn('Failed to restore session state', e);
      }
    }

    loadSettings() {
      try {
        const savedTheme = localStorage.getItem('chrono_oled_theme') || 'emerald';
        this.setTheme(savedTheme);

        const savedPrecision = parseInt(localStorage.getItem('chrono_oled_precision') || '2', 10);
        this.setPrecision(savedPrecision);

        const savedSound = localStorage.getItem('chrono_oled_sound');
        if (savedSound !== null) {
          this.audio.enabled = (savedSound === 'true');
        }
        this.updateSoundButtonUI();

        const savedSubject = localStorage.getItem('chrono_focus_active_subject') || 'Overall Work';
        this.setSubject(savedSubject);
      } catch (e) {
        console.warn('Failed to load settings', e);
      }
    }

    loadHistory() {
      try {
        const raw = localStorage.getItem('chrono_focus_study_history');
        this.savedRuns = raw ? JSON.parse(raw) : [];
      } catch (e) {
        this.savedRuns = [];
      }
    }

    saveHistory() {
      try {
        localStorage.setItem('chrono_focus_study_history', JSON.stringify(this.savedRuns));
      } catch (e) {
        console.warn('Failed to save history', e);
      }
    }

    // --- Diary Engine & Persistence ---
    loadDiary() {
      try {
        const raw = localStorage.getItem('chrono_study_diary_v1');
        this.studyDiary = raw ? JSON.parse(raw) : {};
      } catch (e) {
        this.studyDiary = {};
      }
    }

    saveDiary() {
      try {
        localStorage.setItem('chrono_study_diary_v1', JSON.stringify(this.studyDiary));
      } catch (e) {
        console.warn('Failed to save study diary', e);
      }
    }

    logTimeToDiary(dateKey, subjectName, durationMs) {
      if (!durationMs || durationMs <= 0) return;
      if (!this.studyDiary[dateKey]) {
        this.studyDiary[dateKey] = {
          totalMs: 0,
          subjects: {},
          notes: ''
        };
      }

      const dayData = this.studyDiary[dateKey];
      dayData.totalMs = (dayData.totalMs || 0) + durationMs;
      if (!dayData.subjects) dayData.subjects = {};
      dayData.subjects[subjectName] = (dayData.subjects[subjectName] || 0) + durationMs;

      this.saveDiary();
      this.renderDiaryView();
    }

    setSubject(name) {
      if (!name) name = 'Overall Work';
      this.activeSubject = name.trim();
      localStorage.setItem('chrono_focus_active_subject', this.activeSubject);
      if (this.dom.activeSubjectInput) {
        this.dom.activeSubjectInput.value = this.activeSubject;
      }
      // Update quick chips
      if (this.dom.quickSubjectChips) {
        this.dom.quickSubjectChips.querySelectorAll('.chip').forEach(chip => {
          chip.classList.toggle('active', chip.dataset.name.toLowerCase() === this.activeSubject.toLowerCase());
        });
      }
    }

    setupWorker() {
      this.worker.onmessage = (e) => {
        if (e.data && e.data.type === 'tick') {
          if (this.running) {
            const elapsed = this.getElapsedTime();
            const formatted = this.formatFullTime(elapsed, 2);
            document.title = `⏱ ${formatted} - [${this.activeSubject}] CHRONO FOCUS`;
            if (Math.random() < 0.05) {
              this.saveRunState();
            }
          }
        }
      };
    }

    startEngine() {
      this.worker.postMessage({ command: 'start', interval: 35 });
      this.startRafLoop();
      document.body.classList.add('running');
      this.dom.btnStart.innerHTML = '<span class="ctrl-icon">⏸</span> Pause (Break)';
      this.dom.statusPill.textContent = `STUDYING: ${this.activeSubject.toUpperCase()}`;
      this.dom.btnLap.disabled = false;
      this.dom.btnSaveSession.disabled = false;
    }

    stopEngine() {
      this.worker.postMessage({ command: 'stop' });
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      document.body.classList.remove('running');
      this.dom.btnStart.innerHTML = '<span class="ctrl-icon">▶</span> Resume Study';
      this.dom.statusPill.textContent = this.accumulatedTime > 0 ? 'ON BREAK / PAUSED' : 'READY TO STUDY';
      this.dom.btnLap.disabled = true;
      document.title = 'CHRONO FOCUS - Study & Focus Timer';
      this.saveRunState();
    }

    startRafLoop() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      const loop = () => {
        if (!this.running) return;
        this.render();
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }

    toggleStartStop() {
      this.audio.init();
      if (!this.running) {
        this.running = true;
        const now = Date.now();
        this.startTime = now;
        this.lapStartTime = now;
        this.startEngine();
        this.audio.clickStart();
      } else {
        const now = Date.now();
        this.accumulatedTime += (now - this.startTime);
        this.accumulatedLapTime += (now - this.lapStartTime);
        this.running = false;
        this.stopEngine();
        this.audio.clickStop();
      }
      this.render();
      this.saveRunState();
    }

    recordLap() {
      if (!this.running) return;
      const now = Date.now();
      const lapDuration = this.accumulatedLapTime + (now - this.lapStartTime);
      const totalElapsed = this.accumulatedTime + (now - this.startTime);

      const lapNumber = this.laps.length + 1;
      const lapRecord = {
        number: lapNumber,
        duration: lapDuration,
        totalTime: totalElapsed,
        subject: this.activeSubject,
        timestamp: now
      };

      this.laps.unshift(lapRecord);
      this.lapStartTime = now;
      this.accumulatedLapTime = 0;

      // Log block immediately to today's diary
      const todayKey = formatDateKey(new Date());
      this.logTimeToDiary(todayKey, this.activeSubject, lapDuration);

      this.audio.clickLap();
      this.updateLapsUI();
      this.saveRunState();
      this.showToast(`Block #${lapNumber} logged: ${formatDurationFriendly(lapDuration)} to ${this.activeSubject}`);
    }

    reset() {
      const currentTotal = this.getElapsedTime();
      if (this.accumulatedTime === 0 && !this.running && this.laps.length === 0) return;

      // Log remaining unblocked time to diary
      const currentBlockDuration = this.getCurrentLapTime();
      const todayKey = formatDateKey(new Date());

      if (this.laps.length === 0 && currentTotal > 15000) {
        // Full unblocked session
        this.logTimeToDiary(todayKey, this.activeSubject, currentTotal);
      } else if (currentBlockDuration > 15000) {
        // Last block
        this.logTimeToDiary(todayKey, this.activeSubject, currentBlockDuration);
      }

      if (currentTotal > 3000 || this.laps.length > 0) {
        this.archiveCurrentRun(false);
      }

      this.running = false;
      this.stopEngine();
      this.startTime = 0;
      this.accumulatedTime = 0;
      this.lapStartTime = 0;
      this.accumulatedLapTime = 0;
      this.laps = [];

      this.audio.clickReset();
      this.render();
      this.updateLapsUI();
      localStorage.removeItem('chrono_focus_active_session');
      this.dom.btnSaveSession.disabled = true;
      this.dom.btnStart.innerHTML = '<span class="ctrl-icon">▶</span> Start Study';
      this.showToast('Study session ended & saved to today\'s notebook diary! ✓');
    }

    archiveCurrentRun(notify = true) {
      const totalTime = this.getElapsedTime();
      if (totalTime < 500 && this.laps.length === 0) return;

      const session = {
        id: 'study_' + Date.now(),
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        totalTime: totalTime,
        subject: this.activeSubject,
        blockCount: this.laps.length > 0 ? this.laps.length : 1,
        laps: [...this.laps]
      };

      this.savedRuns.unshift(session);
      if (this.savedRuns.length > 100) this.savedRuns.pop();
      this.saveHistory();

      if (notify) {
        this.showToast('Study session archived! ✓');
      }
    }

    render() {
      const elapsed = this.getElapsedTime();
      const parts = this.formatTimeParts(elapsed, this.precision);

      this.dom.primaryTime.textContent = parts.mainStr;
      this.dom.millisTime.textContent = parts.millisStr;

      // Update Live Study Metrics
      this.dom.statTotalStudy.textContent = this.formatFullTime(elapsed, this.precision);

      const currentBlockMs = this.getCurrentLapTime();
      this.dom.statCurrentBlock.textContent = (this.running || this.accumulatedLapTime > 0)
        ? this.formatFullTime(currentBlockMs, this.precision)
        : '--:--.--';

      if (this.running || this.laps.length > 0) {
        this.dom.currentLapPreview.style.display = 'flex';
        this.dom.currentLapNumber.textContent = `Block ${this.laps.length + 1}`;
        this.dom.currentLapVal.textContent = this.formatFullTime(currentBlockMs, this.precision);
      } else {
        this.dom.currentLapPreview.style.display = 'none';
      }
    }

    updateLapsUI() {
      const laps = this.laps;
      this.dom.lapsCountBadge.textContent = laps.length;
      this.dom.statTotalBlocks.textContent = laps.length;

      if (laps.length === 0) {
        this.dom.lapsTableBody.innerHTML = `
          <tr>
            <td colspan="4" class="empty-laps">No study blocks logged yet. Press "Next Block" (or tap 'L') as you finish chapters or topics.</td>
          </tr>
        `;
        this.dom.statAvgBlock.textContent = '--:--.--';
        this.dom.btnCopyLaps.disabled = true;
        this.dom.btnExportCsv.disabled = true;
        return;
      }

      this.dom.btnCopyLaps.disabled = false;
      this.dom.btnExportCsv.disabled = false;

      let sumDuration = 0;
      for (let i = 0; i < laps.length; i++) {
        sumDuration += laps[i].duration;
      }
      const avgDuration = Math.round(sumDuration / laps.length);
      this.dom.statAvgBlock.textContent = this.formatFullTime(avgDuration, 2);

      let html = '';
      for (let i = 0; i < laps.length; i++) {
        const lap = laps[i];
        const subjectTag = lap.subject ? `<span style="color:var(--text-muted); font-size:0.75rem;">[${lap.subject}]</span> ` : '';
        html += `
          <tr>
            <td><strong style="color:var(--accent-color);">Block #${lap.number}</strong> ${subjectTag}</td>
            <td><strong>${this.formatFullTime(lap.duration, this.precision)}</strong> <span style="color:var(--text-muted); font-size:0.75rem;">(${formatDurationFriendly(lap.duration)})</span></td>
            <td>${this.formatFullTime(lap.totalTime, this.precision)}</td>
            <td style="color:var(--text-muted); font-size:0.75rem;">${new Date(lap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          </tr>
        `;
      }

      this.dom.lapsTableBody.innerHTML = html;
    }

    // --- Weekly Study Notebook Renderer ---
    renderDiaryView() {
      const monday = new Date(this.viewingMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const monStr = formatDisplayDate(monday);
      const sunStr = formatDisplayDate(sunday);
      this.dom.weekRangeTitle.textContent = `Week of ${monStr} - ${sunStr}`;

      const dayNames = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];
      const todayKey = formatDateKey(new Date());

      let weekTotalMs = 0;
      const subjectTotals = {};
      let html = '';

      for (let i = 0; i < 7; i++) {
        const currentDayDate = new Date(monday);
        currentDayDate.setDate(monday.getDate() + i);
        const dayKey = formatDateKey(currentDayDate);
        const dayDisplay = formatDisplayDate(currentDayDate);
        const dayName = dayNames[i];
        const isToday = (dayKey === todayKey);

        const dayEntry = this.studyDiary[dayKey] || { totalMs: 0, subjects: {}, notes: '' };
        const dayTotalMs = dayEntry.totalMs || 0;
        weekTotalMs += dayTotalMs;

        // Subject totals
        if (dayEntry.subjects) {
          for (const [sub, ms] of Object.entries(dayEntry.subjects)) {
            subjectTotals[sub] = (subjectTotals[sub] || 0) + ms;
          }
        }

        // Subjects badges HTML
        let subjectsHtml = '';
        if (dayEntry.subjects && Object.keys(dayEntry.subjects).length > 0) {
          for (const [sub, ms] of Object.entries(dayEntry.subjects)) {
            if (ms > 0) {
              subjectsHtml += `<span class="subject-badge">${sub}: <strong>${formatDurationFriendly(ms)}</strong></span>`;
            }
          }
        } else {
          subjectsHtml = `<span style="color:var(--text-dim); font-size:0.72rem; font-family:var(--font-mono);">No subjects logged yet</span>`;
        }

        const notesVal = dayEntry.notes || '';

        html += `
          <div class="day-notebook-card ${isToday ? 'is-today' : ''}" data-daykey="${dayKey}">
            <div class="day-card-header">
              <div class="day-identity">
                <span class="day-name">${dayName}</span>
                <span class="day-date">${dayDisplay}</span>
                ${isToday ? '<span class="today-pill">TODAY</span>' : ''}
              </div>
              <div class="day-totals-wrap">
                <span class="day-time-badge">${formatDurationFriendly(dayTotalMs)}</span>
                <button class="btn-tiny btn-open-manual-time" data-daykey="${dayKey}" data-daylabel="${dayName} (${dayDisplay})" title="Add offline study hours">
                  + Add Time
                </button>
              </div>
            </div>

            <div class="day-subjects-row">
              ${subjectsHtml}
            </div>

            <div class="notebook-textarea-wrap">
              <textarea class="notebook-textarea" data-daykey="${dayKey}" placeholder="Notes for ${dayName} ${dayDisplay}: topics covered, problem sets, what you learned, or diary reflections...">${notesVal}</textarea>
            </div>

            <div class="notebook-footer">
              <span class="auto-save-indicator" id="saveIndicator_${dayKey}">Auto-saved ✓</span>
              <div class="notebook-quick-actions">
                <button class="btn-tiny btn-stamp-stats" data-daykey="${dayKey}" data-dayname="${dayName}" data-daydate="${dayDisplay}" title="Insert summary of today's study hours into notes">
                  + Stamp Hours
                </button>
              </div>
            </div>
          </div>
        `;
      }

      this.dom.notebookDaysList.innerHTML = html;

      // Update Week Summary Ribbon
      this.dom.weekTotalTime.textContent = formatDurationFriendly(weekTotalMs);
      const avgMs = Math.round(weekTotalMs / 7);
      this.dom.weekDailyAvg.textContent = formatDurationFriendly(avgMs);

      // Find top subject
      let topSub = 'None';
      let maxSubMs = 0;
      for (const [sub, ms] of Object.entries(subjectTotals)) {
        if (ms > maxSubMs) {
          maxSubMs = ms;
          topSub = `${sub} (${formatDurationFriendly(ms)})`;
        }
      }
      this.dom.weekTopSubject.textContent = topSub;

      // Bind textarea autosave
      this.dom.notebookDaysList.querySelectorAll('.notebook-textarea').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
          const key = e.target.dataset.daykey;
          if (!this.studyDiary[key]) {
            this.studyDiary[key] = { totalMs: 0, subjects: {}, notes: '' };
          }
          this.studyDiary[key].notes = e.target.value;
          this.saveDiary();

          const indicator = document.getElementById(`saveIndicator_${key}`);
          if (indicator) {
            indicator.textContent = 'Saving...';
            clearTimeout(indicator.timer);
            indicator.timer = setTimeout(() => {
              indicator.textContent = 'Saved ✓';
            }, 600);
          }
        });
      });

      // Bind Stamp Stats Button
      this.dom.notebookDaysList.querySelectorAll('.btn-stamp-stats').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const key = e.currentTarget.dataset.daykey;
          const name = e.currentTarget.dataset.dayname;
          const date = e.currentTarget.dataset.daydate;
          const entry = this.studyDiary[key] || { totalMs: 0, subjects: {}, notes: '' };

          let stamp = `\n[${name} ${date} - Total Study: ${formatDurationFriendly(entry.totalMs)}]`;
          if (entry.subjects && Object.keys(entry.subjects).length > 0) {
            const parts = Object.entries(entry.subjects).map(([s, ms]) => `${s}: ${formatDurationFriendly(ms)}`);
            stamp += ` (${parts.join(', ')})`;
          }
          stamp += '\n';

          const textarea = this.dom.notebookDaysList.querySelector(`.notebook-textarea[data-daykey="${key}"]`);
          if (textarea) {
            textarea.value = (textarea.value.trim() ? textarea.value + '\n' : '') + stamp;
            if (!this.studyDiary[key]) this.studyDiary[key] = { totalMs: 0, subjects: {}, notes: '' };
            this.studyDiary[key].notes = textarea.value;
            this.saveDiary();
            this.showToast(`Study stats stamped into ${name}'s notes.`);
          }
        });
      });

      // Bind Add Time Modal Trigger
      this.dom.notebookDaysList.querySelectorAll('.btn-open-manual-time').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const key = e.currentTarget.dataset.daykey;
          const label = e.currentTarget.dataset.daylabel;
          this.openManualTimeModal(key, label);
        });
      });
    }

    // --- Manual Time Logging Modal ---
    openManualTimeModal(dayKey, dayLabel) {
      this.dom.manualDayTarget.value = dayLabel;
      this.dom.manualDayTarget.dataset.daykey = dayKey;
      this.dom.manualSubjectInput.value = this.activeSubject;
      this.dom.manualHoursInput.value = '';
      this.dom.manualTimeModal.classList.add('open');
      this.dom.manualHoursInput.focus();
    }

    closeManualTimeModal() {
      this.dom.manualTimeModal.classList.remove('open');
    }

    handleManualTimeSubmit(e) {
      e.preventDefault();
      const dayKey = this.dom.manualDayTarget.dataset.daykey;
      const subject = this.dom.manualSubjectInput.value.trim() || 'Overall Work';
      const hours = parseFloat(this.dom.manualHoursInput.value);

      if (isNaN(hours) || hours <= 0) {
        this.showToast('Please enter a valid amount of hours.');
        return;
      }

      const durationMs = Math.round(hours * 3600 * 1000);
      this.logTimeToDiary(dayKey, subject, durationMs);
      this.closeManualTimeModal();
      this.showToast(`Added ${hours}h (${subject}) to ${this.dom.manualDayTarget.value}! ✓`);
    }

    // --- Week Navigation ---
    changeWeek(offsetWeeks) {
      const mon = new Date(this.viewingMonday);
      mon.setDate(mon.getDate() + (offsetWeeks * 7));
      this.viewingMonday = mon;
      this.renderDiaryView();
    }

    jumpToThisWeek() {
      this.viewingMonday = getMonday(new Date());
      this.renderDiaryView();
      this.showToast('Jumped to current week.');
    }

    // --- Exports ---
    copyWeekDiary() {
      const monday = new Date(this.viewingMonday);
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

      let text = `====================================================\n`;
      text += `STUDY DIARY - WEEK OF ${formatDisplayDate(monday)}\n`;
      text += `====================================================\n\n`;

      for (let i = 0; i < 7; i++) {
        const curDate = new Date(monday);
        curDate.setDate(monday.getDate() + i);
        const dayKey = formatDateKey(curDate);
        const dayDisplay = formatDisplayDate(curDate);
        const dayName = dayNames[i];

        const entry = this.studyDiary[dayKey] || { totalMs: 0, subjects: {}, notes: '' };
        text += `## ${dayName} (${dayDisplay}) - ${formatDurationFriendly(entry.totalMs)}\n`;

        if (entry.subjects && Object.keys(entry.subjects).length > 0) {
          const subs = Object.entries(entry.subjects).map(([s, ms]) => `${s}: ${formatDurationFriendly(ms)}`);
          text += `Focus: ${subs.join(' | ')}\n`;
        }

        if (entry.notes && entry.notes.trim()) {
          text += `Notes:\n${entry.notes.trim()}\n`;
        } else {
          text += `Notes: (None)\n`;
        }
        text += `\n----------------------------------------------------\n\n`;
      }

      navigator.clipboard.writeText(text).then(() => {
        this.showToast('Week study diary copied to clipboard! 📋');
      }).catch(() => {
        this.showToast('Failed to copy to clipboard.');
      });
    }

    exportWeekMarkdown() {
      const monday = new Date(this.viewingMonday);
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun'];

      let md = `# Study Diary - Week of ${formatDisplayDate(monday)}\n\n`;

      for (let i = 0; i < 7; i++) {
        const curDate = new Date(monday);
        curDate.setDate(monday.getDate() + i);
        const dayKey = formatDateKey(curDate);
        const dayDisplay = formatDisplayDate(curDate);
        const dayName = dayNames[i];

        const entry = this.studyDiary[dayKey] || { totalMs: 0, subjects: {}, notes: '' };
        md += `## ${dayName} (${dayDisplay}) - ${formatDurationFriendly(entry.totalMs)}\n\n`;

        if (entry.subjects && Object.keys(entry.subjects).length > 0) {
          md += `**Subjects:**\n`;
          for (const [s, ms] of Object.entries(entry.subjects)) {
            md += `- ${s}: ${formatDurationFriendly(ms)}\n`;
          }
          md += `\n`;
        }

        md += `**Notes & Diary:**\n`;
        md += entry.notes && entry.notes.trim() ? `${entry.notes.trim()}\n\n` : `_No notes written._\n\n`;
      }

      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `study_diary_${formatDateKey(monday)}.md`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('Exported week diary as Markdown! ↓');
    }

    copyLapsToClipboard() {
      if (this.laps.length === 0) return;
      let text = `CHRONO FOCUS - Study Log [${this.activeSubject}]\n`;
      text += `Total Study Time: ${formatDurationFriendly(this.getElapsedTime())}\n`;
      text += `Completed Blocks: ${this.laps.length}\n`;
      text += `----------------------------------------\n`;
      text += `Block\tSubject\tBlock Duration\tTotal Study Time\n`;

      const sorted = [...this.laps].reverse();
      sorted.forEach(l => {
        text += `Block #${l.number}\t${l.subject || this.activeSubject}\t${formatDurationFriendly(l.duration)}\t${this.formatFullTime(l.totalTime, this.precision)}\n`;
      });

      navigator.clipboard.writeText(text).then(() => {
        this.showToast('Study log copied to clipboard! ✓');
      }).catch(() => {
        this.showToast('Failed to copy to clipboard.');
      });
    }

    exportCsv() {
      if (this.laps.length === 0) return;
      let csv = 'BlockNumber,Subject,BlockDurationFormatted,BlockDurationMs,TotalStudyTimeFormatted,TotalStudyTimeMs,RecordedTime\n';
      const sorted = [...this.laps].reverse();
      sorted.forEach(l => {
        csv += `${l.number},"${l.subject || this.activeSubject}","${formatDurationFriendly(l.duration)}",${l.duration},"${this.formatFullTime(l.totalTime, this.precision)}",${l.totalTime},"${new Date(l.timestamp).toISOString()}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `study_blocks_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('Exported study log as CSV. ✓');
    }

    // --- Sessions Archive Modal ---
    renderMemoryModal() {
      if (this.savedRuns.length === 0) {
        this.dom.savedRunsList.innerHTML = `
          <div style="text-align:center; padding:3rem 1rem; color:var(--text-dim); font-family:var(--font-mono);">
            No archived stopwatch sessions in memory. Ending a study session automatically saves it here!
          </div>
        `;
        return;
      }

      let html = '';
      this.savedRuns.forEach((run, index) => {
        html += `
          <div class="saved-run-item" data-id="${run.id}">
            <div class="saved-run-header">
              <span class="saved-run-title">
                Session #${this.savedRuns.length - index} ${run.subject ? `[${run.subject}]` : ''}
              </span>
              <span class="saved-run-date">${run.date} at ${run.time}</span>
            </div>
            <div class="saved-run-metrics">
              <div>Total: <span class="metric-highlight">${formatDurationFriendly(run.totalTime)}</span></div>
              <div>Blocks: <span style="color:var(--text-main); font-weight:600;">${run.blockCount || run.lapCount || 0}</span></div>
            </div>
            <div class="saved-run-footer">
              <button class="btn-small btn-restore-run" data-id="${run.id}">Restore to Timer</button>
              <button class="btn-small btn-delete-run" data-id="${run.id}" style="color:var(--color-slowest);">Delete</button>
            </div>
          </div>
        `;
      });

      this.dom.savedRunsList.innerHTML = html;

      this.dom.savedRunsList.querySelectorAll('.btn-delete-run').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.dataset.id;
          this.savedRuns = this.savedRuns.filter(r => r.id !== id);
          this.saveHistory();
          this.renderMemoryModal();
          this.showToast('Session deleted.');
        });
      });

      this.dom.savedRunsList.querySelectorAll('.btn-restore-run').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.dataset.id;
          const run = this.savedRuns.find(r => r.id === id);
          if (run) {
            this.laps = [...(run.laps || [])];
            this.accumulatedTime = run.totalTime;
            this.accumulatedLapTime = 0;
            if (run.subject) this.setSubject(run.subject);
            this.running = false;
            this.stopEngine();
            this.render();
            this.updateLapsUI();
            this.closeMemoryModal();
            this.switchTab('timer');
            this.showToast('Study session restored to main timer.');
          }
        });
      });
    }

    openMemoryModal() {
      this.renderMemoryModal();
      this.dom.memoryModal.classList.add('open');
    }

    closeMemoryModal() {
      this.dom.memoryModal.classList.remove('open');
    }

    clearAllHistory() {
      if (confirm('Clear all archived stopwatch sessions from memory?')) {
        this.savedRuns = [];
        this.saveHistory();
        this.renderMemoryModal();
        this.showToast('All session memory cleared.');
      }
    }

    exportHistoryJson() {
      const backup = {
        savedRuns: this.savedRuns,
        studyDiary: this.studyDiary,
        exportedAt: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `study_diary_backup_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('Exported complete study backup as JSON. ✓');
    }

    // --- Settings & UI ---
    setPrecision(p) {
      this.precision = p;
      localStorage.setItem('chrono_oled_precision', String(p));
      this.dom.precisionBtns.forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.prec, 10) === p);
      });
      this.render();
      this.updateLapsUI();
    }

    setTheme(themeName) {
      this.theme = themeName;
      document.documentElement.setAttribute('data-theme', themeName);
      localStorage.setItem('chrono_oled_theme', themeName);
      this.dom.themeDots.forEach(dot => {
        dot.classList.toggle('selected', dot.dataset.pick === themeName);
      });
    }

    toggleSound() {
      this.audio.enabled = !this.audio.enabled;
      localStorage.setItem('chrono_oled_sound', String(this.audio.enabled));
      this.updateSoundButtonUI();
      if (this.audio.enabled) {
        this.audio.clickStart();
        this.showToast('Audio feedback enabled.');
      } else {
        this.showToast('Audio muted.');
      }
    }

    updateSoundButtonUI() {
      this.dom.soundToggleBtn.classList.toggle('active', this.audio.enabled);
      this.dom.soundToggleBtn.innerHTML = this.audio.enabled ? '🔊' : '🔇';
    }

    toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    }

    showToast(message) {
      this.dom.toast.textContent = message;
      this.dom.toast.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.dom.toast.classList.remove('show');
      }, 2400);
    }

    // --- Event Bindings ---
    bindEvents() {
      // Tabs
      this.dom.tabTimer.addEventListener('click', () => this.switchTab('timer'));
      this.dom.tabDiary.addEventListener('click', () => this.switchTab('diary'));

      // Active Subject Input & Chips
      this.dom.activeSubjectInput.addEventListener('change', (e) => {
        this.setSubject(e.target.value);
      });
      if (this.dom.quickSubjectChips) {
        this.dom.quickSubjectChips.querySelectorAll('.chip').forEach(chip => {
          chip.addEventListener('click', () => {
            this.setSubject(chip.dataset.name);
          });
        });
      }

      // Primary Controls
      this.dom.btnStart.addEventListener('click', () => this.toggleStartStop());
      this.dom.btnLap.addEventListener('click', () => this.recordLap());
      this.dom.btnReset.addEventListener('click', () => this.reset());
      this.dom.btnSaveSession.addEventListener('click', () => this.archiveCurrentRun(true));

      // Header tools
      this.dom.soundToggleBtn.addEventListener('click', () => this.toggleSound());
      this.dom.fullscreenToggleBtn.addEventListener('click', () => this.toggleFullscreen());
      this.dom.historyToggleBtn.addEventListener('click', () => this.openMemoryModal());
      this.dom.memoryCloseBtn.addEventListener('click', () => this.closeMemoryModal());
      this.dom.memoryModal.addEventListener('click', (e) => {
        if (e.target === this.dom.memoryModal) this.closeMemoryModal();
      });

      this.dom.btnClearAllHistory.addEventListener('click', () => this.clearAllHistory());
      this.dom.btnExportJson.addEventListener('click', () => this.exportHistoryJson());

      // Laps actions
      this.dom.btnCopyLaps.addEventListener('click', () => this.copyLapsToClipboard());
      this.dom.btnExportCsv.addEventListener('click', () => this.exportCsv());

      // Diary controls
      this.dom.btnPrevWeek.addEventListener('click', () => this.changeWeek(-1));
      this.dom.btnNextWeek.addEventListener('click', () => this.changeWeek(1));
      this.dom.btnJumpToday.addEventListener('click', () => this.jumpToThisWeek());
      this.dom.btnCopyWeekDiary.addEventListener('click', () => this.copyWeekDiary());
      this.dom.btnExportWeekMd.addEventListener('click', () => this.exportWeekMarkdown());

      // Manual time modal
      this.dom.manualTimeCloseBtn.addEventListener('click', () => this.closeManualTimeModal());
      this.dom.manualTimeModal.addEventListener('click', (e) => {
        if (e.target === this.dom.manualTimeModal) this.closeManualTimeModal();
      });
      this.dom.manualTimeForm.addEventListener('submit', (e) => this.handleManualTimeSubmit(e));

      // Theme Dots
      this.dom.themeDots.forEach(dot => {
        dot.addEventListener('click', () => this.setTheme(dot.dataset.pick));
      });

      // Precision Buttons
      this.dom.precisionBtns.forEach(btn => {
        btn.addEventListener('click', () => this.setPrecision(parseInt(btn.dataset.prec, 10)));
      });

      // Keyboard Shortcuts
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
          e.preventDefault();
          this.toggleStartStop();
        } else if (e.code === 'KeyL' || e.code === 'KeyB') {
          e.preventDefault();
          this.recordLap();
        } else if (e.code === 'KeyR') {
          e.preventDefault();
          this.reset();
        } else if (e.code === 'KeyN') {
          e.preventDefault();
          this.switchTab(this.activeTab === 'timer' ? 'diary' : 'timer');
        } else if (e.code === 'KeyF') {
          e.preventDefault();
          this.toggleFullscreen();
        } else if (e.code === 'KeyS') {
          e.preventDefault();
          this.toggleSound();
        } else if (e.code === 'KeyM' || e.code === 'KeyH') {
          e.preventDefault();
          if (this.dom.memoryModal.classList.contains('open')) {
            this.closeMemoryModal();
          } else {
            this.openMemoryModal();
          }
        } else if (e.code === 'Escape') {
          this.closeMemoryModal();
          this.closeManualTimeModal();
        }
      });
    }
  }

  window.ChronoStopwatch = ChronoStudyApp;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ChronoStudyApp());
  } else {
    new ChronoStudyApp();
  }
})();
