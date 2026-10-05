/**
 * CHRONO FOCUS - High-Precision Study & Productivity Timer Engine
 * Zero-drift architecture with background Web Worker & Wall-clock delta sync.
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

  // --- Web Worker Background Timer Factory ---
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

  // --- Main Study Timer Application ---
  class ChronoStudyTimer {
    constructor() {
      this.running = false;
      this.startTime = 0;
      this.accumulatedTime = 0;
      this.lapStartTime = 0;
      this.accumulatedLapTime = 0;
      this.laps = [];
      this.precision = 2; // 2 (.00s) or 3 (.000s)
      this.theme = 'emerald';
      this.savedRuns = [];

      this.audio = new SoundEngine();
      this.worker = createWorker();
      this.rafId = null;

      this.dom = {
        appContainer: document.getElementById('appContainer'),
        timerHero: document.getElementById('timerHero'),
        primaryTime: document.getElementById('primaryTime'),
        millisTime: document.getElementById('millisTime'),
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
        statTotalStudy: document.getElementById('statTotalStudy'),
        statCurrentBlock: document.getElementById('statCurrentBlock'),
        statAvgBlock: document.getElementById('statAvgBlock'),
        statTotalBlocks: document.getElementById('statTotalBlocks'),
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

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.render();
          if (this.running) {
            this.startRafLoop();
          }
        }
      });

      window.addEventListener('beforeunload', () => {
        this.saveRunState();
      });
    }

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

    formatFriendlyDuration(ms) {
      const totalSeconds = Math.floor(ms / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
      }
      if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
      }
      return `${seconds}s`;
    }

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

    setupWorker() {
      this.worker.onmessage = (e) => {
        if (e.data && e.data.type === 'tick') {
          if (this.running) {
            const elapsed = this.getElapsedTime();
            const formatted = this.formatFullTime(elapsed, 2);
            document.title = `⏱ ${formatted} - CHRONO FOCUS`;
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
      this.dom.statusPill.textContent = 'STUDYING IN PROGRESS';
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
        timestamp: now
      };

      this.laps.unshift(lapRecord);
      this.lapStartTime = now;
      this.accumulatedLapTime = 0;

      this.audio.clickLap();
      this.updateLapsUI();
      this.saveRunState();
      this.showToast(`Block #${lapNumber} logged: ${this.formatFriendlyDuration(lapDuration)}`);
    }

    reset() {
      if (this.accumulatedTime === 0 && !this.running && this.laps.length === 0) return;

      const currentTotal = this.getElapsedTime();
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
      this.showToast('Study session finished and archived to memory! ✓');
    }

    archiveCurrentRun(notify = true) {
      const totalTime = this.getElapsedTime();
      if (totalTime < 500 && this.laps.length === 0) return;

      const session = {
        id: 'study_' + Date.now(),
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        totalTime: totalTime,
        blockCount: this.laps.length > 0 ? this.laps.length : 1,
        laps: [...this.laps]
      };

      this.savedRuns.unshift(session);
      if (this.savedRuns.length > 100) this.savedRuns.pop();
      this.saveHistory();

      if (notify) {
        this.showToast('Study session archived to memory! ✓');
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
        html += `
          <tr>
            <td><strong style="color:var(--accent-color);">Block #${lap.number}</strong></td>
            <td><strong>${this.formatFullTime(lap.duration, this.precision)}</strong> <span style="color:var(--text-muted); font-size:0.75rem;">(${this.formatFriendlyDuration(lap.duration)})</span></td>
            <td>${this.formatFullTime(lap.totalTime, this.precision)}</td>
            <td style="color:var(--text-muted); font-size:0.75rem;">${new Date(lap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          </tr>
        `;
      }

      this.dom.lapsTableBody.innerHTML = html;
    }

    renderMemoryModal() {
      if (this.savedRuns.length === 0) {
        this.dom.savedRunsList.innerHTML = `
          <div style="text-align:center; padding:3rem 1rem; color:var(--text-dim); font-family:var(--font-mono);">
            No archived study sessions in memory. Ending a study session automatically saves it here!
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
                Study Session #${this.savedRuns.length - index}
              </span>
              <span class="saved-run-date">${run.date} at ${run.time}</span>
            </div>
            <div class="saved-run-metrics">
              <div>Total Focus: <span class="metric-highlight">${this.formatFriendlyDuration(run.totalTime)}</span></div>
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
            this.running = false;
            this.stopEngine();
            this.render();
            this.updateLapsUI();
            this.closeMemoryModal();
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
      if (confirm('Clear all archived study sessions from memory?')) {
        this.savedRuns = [];
        this.saveHistory();
        this.renderMemoryModal();
        this.showToast('All study history cleared.');
      }
    }

    copyLapsToClipboard() {
      if (this.laps.length === 0) return;
      let text = `CHRONO FOCUS - Study Log\n`;
      text += `Total Study Time: ${this.formatFriendlyDuration(this.getElapsedTime())}\n`;
      text += `Completed Blocks: ${this.laps.length}\n`;
      text += `----------------------------------------\n`;
      text += `Block\tBlock Duration\tTotal Study Time\n`;

      const sorted = [...this.laps].reverse();
      sorted.forEach(l => {
        text += `Block #${l.number}\t${this.formatFriendlyDuration(l.duration)}\t${this.formatFullTime(l.totalTime, this.precision)}\n`;
      });

      navigator.clipboard.writeText(text).then(() => {
        this.showToast('Study log copied to clipboard! ✓');
      }).catch(() => {
        this.showToast('Failed to copy to clipboard.');
      });
    }

    exportCsv() {
      if (this.laps.length === 0) return;
      let csv = 'BlockNumber,BlockDurationFormatted,BlockDurationMs,TotalStudyTimeFormatted,TotalStudyTimeMs,RecordedTime\n';
      const sorted = [...this.laps].reverse();
      sorted.forEach(l => {
        csv += `${l.number},"${this.formatFriendlyDuration(l.duration)}",${l.duration},"${this.formatFullTime(l.totalTime, this.precision)}",${l.totalTime},"${new Date(l.timestamp).toISOString()}"\n`;
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

    exportHistoryJson() {
      if (this.savedRuns.length === 0) {
        this.showToast('No study sessions in memory to export.');
        return;
      }
      const blob = new Blob([JSON.stringify(this.savedRuns, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `study_history_backup_${Date.now()}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('Exported study history backup. ✓');
    }

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

    bindEvents() {
      this.dom.btnStart.addEventListener('click', () => this.toggleStartStop());
      this.dom.btnLap.addEventListener('click', () => this.recordLap());
      this.dom.btnReset.addEventListener('click', () => this.reset());
      this.dom.btnSaveSession.addEventListener('click', () => this.archiveCurrentRun(true));

      this.dom.soundToggleBtn.addEventListener('click', () => this.toggleSound());
      this.dom.fullscreenToggleBtn.addEventListener('click', () => this.toggleFullscreen());
      this.dom.historyToggleBtn.addEventListener('click', () => this.openMemoryModal());
      this.dom.memoryCloseBtn.addEventListener('click', () => this.closeMemoryModal());
      this.dom.memoryModal.addEventListener('click', (e) => {
        if (e.target === this.dom.memoryModal) this.closeMemoryModal();
      });

      this.dom.btnClearAllHistory.addEventListener('click', () => this.clearAllHistory());
      this.dom.btnExportJson.addEventListener('click', () => this.exportHistoryJson());

      this.dom.btnCopyLaps.addEventListener('click', () => this.copyLapsToClipboard());
      this.dom.btnExportCsv.addEventListener('click', () => this.exportCsv());

      this.dom.themeDots.forEach(dot => {
        dot.addEventListener('click', () => this.setTheme(dot.dataset.pick));
      });

      this.dom.precisionBtns.forEach(btn => {
        btn.addEventListener('click', () => this.setPrecision(parseInt(btn.dataset.prec, 10)));
      });

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

  window.ChronoStopwatch = ChronoStudyTimer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ChronoStudyTimer());
  } else {
    new ChronoStudyTimer();
  }
})();
