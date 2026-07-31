const MINIMUM_BATCH_TIMEOUT_MS = 60 * 60 * 1000;
const PER_LEAD_TIMEOUT_MS = 7 * 60 * 1000;
const MAXIMUM_BATCH_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export function getQualificationBatchTimeoutMs(limit) {
  const parsedLimit = Number(limit);
  const normalizedLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.floor(parsedLimit))
    : 1;

  return Math.min(
    MAXIMUM_BATCH_TIMEOUT_MS,
    Math.max(MINIMUM_BATCH_TIMEOUT_MS, normalizedLimit * PER_LEAD_TIMEOUT_MS),
  );
}
