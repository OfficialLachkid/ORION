export function createWebsiteAutosave(options = {}) {
  const persist = options.persist;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 700;
  let pending = null;
  let timer = null;
  let inFlight = null;
  let revision = 0;

  if (typeof persist !== 'function') {
    throw new TypeError('Website autosave requires a persist function.');
  }

  const clearTimer = () => {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
  };

  const drain = async () => {
    if (inFlight || !pending) {
      return inFlight;
    }

    clearTimer();
    const current = pending;
    pending = null;
    options.onSaving?.(current.entry);

    inFlight = Promise.resolve(persist(current.entry))
      .then((result) => {
        if (!pending && current.revision === revision) {
          options.onSettled?.(result, current.entry);
        }
        return result;
      })
      .catch((error) => {
        if (!pending && current.revision === revision) {
          options.onError?.(error, current.entry);
        }
        return null;
      })
      .finally(() => {
        inFlight = null;
        if (pending) {
          void drain();
        }
      });

    return inFlight;
  };

  return {
    schedule(entry) {
      revision += 1;
      pending = { entry, revision };
      clearTimer();
      options.onPending?.(entry);
      timer = globalThis.setTimeout(() => {
        timer = null;
        void drain();
      }, delayMs);
    },

    async flush() {
      clearTimer();
      while (pending || inFlight) {
        if (pending && !inFlight) {
          await drain();
        } else if (inFlight) {
          await inFlight;
        }
      }
    },
  };
}
