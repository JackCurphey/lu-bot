// Waits for a gap in a channel before judging. A burst of quick messages then
// costs one judge call, for the latest message, instead of one per message.
export function createPauser({
  ms,
  onSettled,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  const waiting = new Map();

  function cancel(channelId) {
    const w = waiting.get(channelId);
    if (!w) return null;
    clearTimeoutImpl(w.timer);
    waiting.delete(channelId);
    return w.entry;
  }

  return {
    wait(channelId, entry) {
      const replaced = cancel(channelId);
      const timer = setTimeoutImpl(() => {
        waiting.delete(channelId);
        onSettled(channelId, entry);
      }, ms);
      // A pending pause must not keep the process alive on its own.
      if (typeof timer?.unref === 'function') timer.unref();
      waiting.set(channelId, { timer, entry });
      return replaced;
    },
    cancel,
    pending: (channelId) => waiting.has(channelId),
  };
}
