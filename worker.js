// Low-frequency checkpoints and reminders. Elapsed time comes from timestamps,
// never from tick counts; browsers may throttle or suspend this worker.
let timerId = null;
self.onmessage = function (event) {
  if (event.data === 'start' && timerId === null) {
    timerId = setInterval(() => self.postMessage('tick'), 1000);
  } else if (event.data === 'stop') {
    clearInterval(timerId);
    timerId = null;
  }
};
