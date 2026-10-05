/**
 * CHRONO OLED - High-Precision OLED Stopwatch Engine
 * True zero-drift architecture with background Web Worker & Wall-clock delta sync.
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

    clickStart() {
      this.playTone(880, 'triangle', 0.05, 0.12);
    }

    clickStop() {
      this.playTone(440, 'sine', 0.06, 0.12);
    }

    clickLap() {
      this.playTone(1320, 'sine', 0.04, 0.1);
    }

    clickReset() {
      this.playTone(350, 'sine', 0.08, 0.1);
      setTimeout(() => this.playTone(280, 'sine', 0.1, 0.08), 70);
    }
  }

  // --- Web Worker Background Timer Factory ---
  function createWorker() {
    try {
      return new Worker('worker.js');
    } catch (e) {
      // Fallback for file:// or restricted protocols using Blob worker
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          const { command, interval } = e.data || {};
          if (command === 'start') {
            if (timer) clearInterval(timer);
            timer = setInterval(() => self.postMessage({ type: 'tick', now: Date.now() }), interval || 30);
          } else if (command === 'stop') {
            if (timer) clearInterval(timer);
            timer = null;
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      return new Worker(URL.createObjectURL(blob));
    }
  }

  // --- Main Stopwatch Application ---
  class ChronoStopwatch {
    constructor() {
      // State
      this.running = false;
      this.startTime = 0;
      this.accumulatedTime = 0;
      this.lapStartTime = 0;
      this.accumulatedLapTime = 0;
      this.laps = [];
      this.precision = 2; // 2 (1/100s) or 3 (1/1000s)
      this.theme = 'emerald';
      this.savedRuns = [];

      this.audio = new SoundEngine();
      this.worker = createWorker();
      this.rafId = null;

      // DOM Elements
      this.dom = {
        appContainer: document.getElementById('appContainer'),
        timerHero: document.getElementById('timerHero'),
        primaryTime: document.getElementById('primaryTime'),
        millisTime: document.getElementById('millisTime'),
        hoursDisplay: document.getElementById('hoursDisplay'),
        statusPill: document.getElementById('statusPill'),
        currentLapPreview: document.getElementById('currentLapPreview'),
        currentLapVal: document.getElementById('currentLapVal'),
        currentLapNumber: document.getElementById('currentLapNumber'),
        btnStart: document.getElementById('btnStart'),
        btnLap: document.getElementById('btnLap'),
        btnReset: document.getElementById('btnReset'),
        btnSaveSession: document.getElementById('btnSaveSession'),
        soundToggleBtn: document.getElementById('soundToggleBtn'),
        fullscreenToggleBtn: document.getElementById('fullscreenToggleBtn'),
        historyToggleBtn: document.getElementById('historyToggleBtn'),
        precisionBtns: document.querySelectorAll('.precision-btn'),
        themeDots: document.querySelectorAll('.theme-dot'),
        lapsTableBody: document.getElementById('lapsTableBody'),
        lapsCountBadge: document.getElementById('lapsCountBadge'),
        statBestLap: document.getElementById('statBestLap'),
        statWorstLap: document.getElementById('statWorstLap'),
        statAvgLap: document.getElementById('statAvgLap'),
        statTotalLaps: document.getElementById('statTotalLaps'),
        btnCopyLaps: document.getElementById('btnCopyLaps'),
        btnExportCsv: document.getElementById('btnExportCsv'),
        memoryModal: document.getElementById('memoryModal'),
        memoryCloseBtn: document.getElementById('memoryCloseBtn'),
        savedRunsList: document.getElementById('savedRunsList'),
        btnClearAllHistory: document.getElementById('btnClearAllHistory'),
        btnExportJson: document.getElementById('btnExportJson'),
        toast: document.getElementById('toast')
      };

      this.init();
    }

    init() {
      this.loadSettings();
      this.loadHistory();
      this.restoreRunState();
      this.setupWorker();
      this.bindEvents();
      this.render();
      this.updateLapsUI();

      // Background Visibility Handler for immediate resync
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.render();
          if (this.running) {
            this.startRafLoop();
          }
        }
      });

      // Window unload auto-persistence
      window.addEventListener('beforeunload', () => {
        this.saveRunState();
      });
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
      return { hours, minutes, seconds, mainStr, millisStr, hasHours: hours > 0 };
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
        savedAt: Date.now()
      };
      try {
        localStorage.setItem('chrono_oled_active_run', JSON.stringify(state));
      } catch (e) {
        console.warn('Failed to save run state', e);
      }
    }

    restoreRunState() {
      try {
        const raw = localStorage.getItem('chrono_oled_active_run');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state) return;

        this.accumulatedTime = state.accumulatedTime || 0;
        this.accumulatedLapTime = state.accumulatedLapTime || 0;
        this.laps = state.laps || [];

        if (state.running && state.startTime) {
          // It was running when the page was closed or refreshed!
          // We seamlessly continue from wall clock!
          this.running = true;
          this.startTime = state.startTime;
          this.lapStartTime = state.lapStartTime || state.startTime;
          this.startEngine();
        }
      } catch (e) {
        console.warn('Failed to restore run state', e);
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
      } catch (e) {
        console.warn('Failed to load settings', e);
      }
    }

    loadHistory() {
      try {
        const raw = localStorage.getItem('chrono_oled_history');
        this.savedRuns = raw ? JSON.parse(raw) : [];
      } catch (e) {
        this.savedRuns = [];
      }
    }

    saveHistory() {
      try {
        localStorage.setItem('chrono_oled_history', JSON.stringify(this.savedRuns));
      } catch (e) {
        console.warn('Failed to save history', e);
      }
    }

    // --- Worker Setup ---
    setupWorker() {
      this.worker.onmessage = (e) => {
        if (e.data && e.data.type === 'tick') {
          // If page is hidden or minimized, update document title live!
          if (this.running) {
            const elapsed = this.getElapsedTime();
            const formatted = this.formatFullTime(elapsed, 2);
            document.title = `⏱ ${formatted} - CHRONO OLED`;
            // Keep periodic state save
            if (Math.random() < 0.05) {
              this.saveRunState();
            }
          }
        }
      };
    }

    // --- Animation & Engine Loops ---
    startEngine() {
      this.worker.postMessage({ command: 'start', interval: 35 });
      this.startRafLoop();
      document.body.classList.add('running');
      this.dom.btnStart.innerHTML = '<span class="ctrl-icon">⏸</span> Pause';
      this.dom.statusPill.textContent = 'RUNNING';
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
      this.dom.btnStart.innerHTML = '<span class="ctrl-icon">▶</span> Start';
      this.dom.statusPill.textContent = this.accumulatedTime > 0 ? 'PAUSED' : 'READY';
      this.dom.btnLap.disabled = true;
      document.title = 'CHRONO OLED - High-Precision Stopwatch';
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

    // --- Actions ---
    toggleStartStop() {
      this.audio.init();
      if (!this.running) {
        // Start / Resume
        this.running = true;
        const now = Date.now();
        this.startTime = now;
        this.lapStartTime = now;
        this.startEngine();
        this.audio.clickStart();
      } else {
        // Pause
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
        timestamp: now
      };

      this.laps.unshift(lapRecord); // Most recent first
      this.lapStartTime = now;
      this.accumulatedLapTime = 0;

      this.audio.clickLap();
      this.updateLapsUI();
      this.saveRunState();
      this.showToast(`Lap ${lapNumber} recorded: ${this.formatFullTime(lapDuration)}`);
    }

    reset() {
      if (this.accumulatedTime === 0 && !this.running && this.laps.length === 0) return;

      // Auto-archive current run to memory if it had laps or significant duration (> 3s)
      const currentTotal = this.getElapsedTime();
      if (currentTotal > 3000 || this.laps.length > 0) {
        this.archiveCurrentRun(false); // silent archive so data is never lost
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
      localStorage.removeItem('chrono_oled_active_run');
      this.dom.btnSaveSession.disabled = true;
      this.showToast('Stopwatch reset. Session archived to memory.');
    }

    archiveCurrentRun(notify = true) {
      const totalTime = this.getElapsedTime();
      if (totalTime < 500 && this.laps.length === 0) return;

      let bestLapMs = null;
      if (this.laps.length > 0) {
        bestLapMs = Math.min(...this.laps.map(l => l.duration));
      }

      const session = {
        id: 'run_' + Date.now(),
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        totalTime: totalTime,
        lapCount: this.laps.length,
        bestLap: bestLapMs,
        laps: [...this.laps]
      };

      this.savedRuns.unshift(session);
      // Keep up to 100 historical sessions
      if (this.savedRuns.length > 100) this.savedRuns.pop();
      this.saveHistory();

      if (notify) {
        this.showToast('Session saved to memory memory!');
      }
    }

    // --- UI Renderers ---
    render() {
      const elapsed = this.getElapsedTime();
      const parts = this.formatTimeParts(elapsed, this.precision);

      this.dom.primaryTime.textContent = parts.mainStr;
      this.dom.millisTime.textContent = parts.millisStr;

      // Current Lap in-flight display
      if (this.running || this.laps.length > 0) {
        this.dom.currentLapPreview.style.display = 'flex';
        this.dom.currentLapNumber.textContent = `Lap ${this.laps.length + 1}`;
        const currentLapMs = this.getCurrentLapTime();
        this.dom.currentLapVal.textContent = this.formatFullTime(currentLapMs, this.precision);
      } else {
        this.dom.currentLapPreview.style.display = 'none';
      }
    }

    updateLapsUI() {
      const laps = this.laps;
      this.dom.lapsCountBadge.textContent = laps.length;
      this.dom.statTotalLaps.textContent = laps.length;

      if (laps.length === 0) {
        this.dom.lapsTableBody.innerHTML = `
          <tr>
            <td colspan="4" class="empty-laps">No laps recorded yet. Press "Lap" while running or tap 'L'.</td>
          </tr>
        `;
        this.dom.statBestLap.textContent = '--:--.--';
        this.dom.statWorstLap.textContent = '--:--.--';
        this.dom.statAvgLap.textContent = '--:--.--';
        this.dom.btnCopyLaps.disabled = true;
        this.dom.btnExportCsv.disabled = true;
        return;
      }

      this.dom.btnCopyLaps.disabled = false;
      this.dom.btnExportCsv.disabled = false;

      // Calculate Best and Worst
      let minDuration = Infinity;
      let maxDuration = -Infinity;
      let sumDuration = 0;

      for (let i = 0; i < laps.length; i++) {
        const d = laps[i].duration;
        sumDuration += d;
        if (d < minDuration) minDuration = d;
        if (d > maxDuration) maxDuration = d;
      }

      const avgDuration = Math.round(sumDuration / laps.length);

      this.dom.statBestLap.textContent = this.formatFullTime(minDuration, 2);
      this.dom.statWorstLap.textContent = laps.length > 1 ? this.formatFullTime(maxDuration, 2) : '--:--.--';
      this.dom.statAvgLap.textContent = this.formatFullTime(avgDuration, 2);

      // Render Table Rows
      let html = '';
      for (let i = 0; i < laps.length; i++) {
        const lap = laps[i];
        let rowClass = '';
        let deltaHtml = '';

        if (laps.length > 1) {
          if (lap.duration === minDuration) {
            rowClass = 'lap-row-fastest';
            deltaHtml = '<span class="lap-delta-tag best">▲ Best</span>';
          } else if (lap.duration === maxDuration) {
            rowClass = 'lap-row-slowest';
            deltaHtml = '<span class="lap-delta-tag worst">▼ Slow</span>';
          } else {
            const diff = lap.duration - minDuration;
            deltaHtml = `<span style="color:var(--text-muted); font-size:0.75rem;">+${this.formatFullTime(diff, 2)}</span>`;
          }
        }

        html += `
          <tr class="${rowClass}">
            <td>#${lap.number}</td>
            <td><strong>${this.formatFullTime(lap.duration, this.precision)}</strong> ${deltaHtml}</td>
            <td>${this.formatFullTime(lap.totalTime, this.precision)}</td>
            <td style="color:var(--text-muted); font-size:0.75rem;">${new Date(lap.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          </tr>
        `;
      }

      this.dom.lapsTableBody.innerHTML = html;
    }

    // --- Memory / Saved Runs UI ---
    renderMemoryModal() {
      if (this.savedRuns.length === 0) {
        this.dom.savedRunsList.innerHTML = `
          <div style="text-align:center; padding:3rem 1rem; color:var(--text-dim); font-family:var(--font-mono);">
            No archived sessions in memory. Resetting a stopwatch session automatically saves it here!
          </div>
        `;
        return;
      }

      let html = '';
      this.savedRuns.forEach((run, index) => {
        const bestLapStr = run.bestLap ? this.formatFullTime(run.bestLap, 2) : 'N/A';
        html += `
          <div class="saved-run-item" data-id="${run.id}">
            <div class="saved-run-header">
              <span class="saved-run-title">
                Session #${this.savedRuns.length - index}
              </span>
              <span class="saved-run-date">${run.date} ${run.time}</span>
            </div>
            <div class="saved-run-metrics">
              <div>Total: <span class="metric-highlight">${this.formatFullTime(run.totalTime, 2)}</span></div>
              <div>Laps: <span style="color:var(--text-main); font-weight:600;">${run.lapCount}</span></div>
              <div>Best Lap: <span style="color:var(--color-fastest); font-weight:600;">${bestLapStr}</span></div>
            </div>
            <div class="saved-run-footer">
              <button class="btn-small btn-restore-run" data-id="${run.id}">Restore Laps</button>
              <button class="btn-small btn-delete-run" data-id="${run.id}" style="color:var(--color-slowest);">Delete</button>
            </div>
          </div>
        `;
      });

      this.dom.savedRunsList.innerHTML = html;

      // Bind delete / restore buttons
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
            this.laps = [...run.laps];
            this.accumulatedTime = run.totalTime;
            this.accumulatedLapTime = 0;
            this.running = false;
            this.stopEngine();
            this.render();
            this.updateLapsUI();
            this.closeMemoryModal();
            this.showToast('Session laps restored to main board.');
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
      if (confirm('Clear all archived sessions from memory?')) {
        this.savedRuns = [];
        this.saveHistory();
        this.renderMemoryModal();
        this.showToast('All session memory cleared.');
      }
    }

    // --- Exports ---
    copyLapsToClipboard() {
      if (this.laps.length === 0) return;
      let text = `CHRONO OLED - Lap Times\n`;
      text += `Total Duration: ${this.formatFullTime(this.getElapsedTime())}\n`;
      text += `Total Laps: ${this.laps.length}\n`;
      text += `----------------------------------------\n`;
      text += `Lap #\tLap Time\tTotal Time\n`;

      // Copy in chronological order (lap 1, 2, 3...)
      const sorted = [...this.laps].reverse();
      sorted.forEach(l => {
        text += `#${l.number}\t${this.formatFullTime(l.duration, this.precision)}\t${this.formatFullTime(l.totalTime, this.precision)}\n`;
      });

      navigator.clipboard.writeText(text).then(() => {
        this.showToast('Lap times copied to clipboard! ✓');
      }).catch(() => {
        this.showToast('Failed to copy to clipboard.');
      });
    }

    exportCsv() {
      if (this.laps.length === 0) return;
      let csv = 'LapNumber,LapDurationFormatted,LapDurationMs,TotalTimeFormatted,TotalTimeMs,RecordedTime\n';
      const sorted = [...this.laps].reverse();
      sorted.forEach(l => {
        csv += `${l.number},"${this.formatFullTime(l.duration, this.precision)}",${l.duration},"${this.formatFullTime(l.totalTime, this.precision)}",${l.totalTime},"${new Date(l.timestamp).toISOString()}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `chrono_laps_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('Exported CSV file. ✓');
    }

    exportHistoryJson() {
      if (this.savedRuns.length === 0) {
        this.showToast('No sessions in memory to export.');
        return;
      }
      const blob = new Blob([JSON.stringify(this.savedRuns, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `chrono_memory_backup_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('Exported memory JSON backup. ✓');
    }

    // --- Settings & Modes ---
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

    // --- Keyboard & Event Bindings ---
    bindEvents() {
      // Primary Buttons
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

      // Theme Pickers
      this.dom.themeDots.forEach(dot => {
        dot.addEventListener('click', () => this.setTheme(dot.dataset.pick));
      });

      // Precision Buttons
      this.dom.precisionBtns.forEach(btn => {
        btn.addEventListener('click', () => this.setPrecision(parseInt(btn.dataset.prec, 10)));
      });

      // Keyboard Shortcuts
      window.addEventListener('keydown', (e) => {
        // Ignore if user is inside an input or modal is open with input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
          e.preventDefault();
          this.toggleStartStop();
        } else if (e.code === 'KeyL') {
          e.preventDefault();
          this.recordLap();
        } else if (e.code === 'KeyR') {
          e.preventDefault();
          this.reset();
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
        } else if (e.code === 'Digit2') {
          this.setPrecision(2);
        } else if (e.code === 'Digit3') {
          this.setPrecision(3);
        } else if (e.code === 'Escape') {
          this.closeMemoryModal();
        }
      });
    }
  }

  // Initialize on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ChronoStopwatch());
  } else {
    new ChronoStopwatch();
  }
})();
