import process from 'node:process';

// Generic retry-with-backoff for network calls in unattended jobs (the
// leadgen sweep runs unsupervised for 1-2 hours; a transient outage must
// not kill it). Retries roughly every 2 minutes, 6 attempts total — about
// 10 extra minutes of resilience beyond the first try, covering a short
// WiFi/ISP blip without hammering anything or running forever.
const DEFAULT_DELAYS_MS = [15000, 30000, 60000, 120000, 120000, 120000];

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function withRetry(fn, { delaysMs = DEFAULT_DELAYS_MS, onRetry, label = 'operation' } = {}) {
  const maxAttempts = delaysMs.length + 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fn();
      if (attempt > 1 && onRetry) {
        onRetry({ label, attempt, succeeded: true });
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = delaysMs[attempt - 1];
        if (onRetry) {
          onRetry({ label, attempt, delay, error, succeeded: false });
        }
        process.stderr.write(`${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${error.message}\n`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
