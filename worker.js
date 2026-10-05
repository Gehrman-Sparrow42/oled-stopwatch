// CHRONO OLED Background Web Worker
// Keeps the stopwatch pulse firing even when tab is backgrounded, inactive, or minimized.

let timerId = null;
let intervalMs = 25; // 40Hz tick rate in worker

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
  } else if (command === 'ping') {
    self.postMessage({ type: 'pong', now: Date.now() });
  }
};
