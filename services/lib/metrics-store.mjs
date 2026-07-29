import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function ensureParentDirectory(filePath) {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const clone = { ...payload };
  delete clone.token;
  delete clone.authorization;
  delete clone.Authorization;
  delete clone.DISCORD_BOT_TOKEN;
  return clone;
}

export function resolveMetricsEventsPath(config) {
  return resolve(
    config.runtimePaths.metricsEventsFile || resolve(config.runtimePaths.logDir, 'ops-events.jsonl')
  );
}

export function recordOpsMetric(config, eventType, payload = {}) {
  const filePath = resolveMetricsEventsPath(config);
  ensureParentDirectory(filePath);

  const eventRecord = {
    timestamp: new Date().toISOString(),
    type: String(eventType || 'unknown_event'),
    payload: sanitizePayload(payload),
  };

  appendFileSync(filePath, `${JSON.stringify(eventRecord)}\n`, 'utf8');
  return filePath;
}
