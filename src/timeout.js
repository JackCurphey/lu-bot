export class TimeoutError extends Error {
  constructor(ms) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

// Races a call against a timer. On timeout the call's signal is aborted so a
// fetch in flight is cancelled on our side; whether the model server stops
// generating is its own business.
export async function withTimeout(
  run,
  ms,
  { setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {},
) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeoutImpl(() => {
      controller.abort();
      reject(new TimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    clearTimeoutImpl(timer);
  }
}
