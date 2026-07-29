function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function splitCsv(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveGmailConfig(runtimeConfig) {
  const gmail = runtimeConfig?.gmail || {};
  return {
    clientId: gmail.clientId || '',
    clientSecret: gmail.clientSecret || '',
    refreshToken: gmail.refreshToken || '',
    senderEmail: gmail.senderEmail || '',
    senderName: gmail.senderName || '',
    loopbackPort: Number.isFinite(gmail.loopbackPort) && gmail.loopbackPort > 0 ? gmail.loopbackPort : 53682,
    bccAudit: Array.isArray(gmail.bccAudit) ? gmail.bccAudit : [],
    draftOnly: gmail.draftOnly === true,
  };
}

export function summarizeGmailReadiness(gmailConfig) {
  const missing = [];
  if (!gmailConfig.clientId) missing.push('GMAIL_CLIENT_ID');
  if (!gmailConfig.clientSecret) missing.push('GMAIL_CLIENT_SECRET');
  if (!gmailConfig.refreshToken) missing.push('GMAIL_REFRESH_TOKEN');
  if (!gmailConfig.senderEmail) missing.push('GMAIL_SENDER_EMAIL');
  return {
    ready: missing.length === 0,
    missing,
    senderEmail: gmailConfig.senderEmail,
    draftOnly: gmailConfig.draftOnly === true,
  };
}

export function resolveGmailRuntimeConfig(env = {}) {
  const redirectUri = String(env.GMAIL_REDIRECT_URI || 'http://127.0.0.1:53682/callback').trim();
  const configuredPort = Number.parseInt(String(env.GMAIL_OAUTH_LOOPBACK_PORT || ''), 10);
  const derivedPort = Number.parseInt(new URL(redirectUri).port || '53682', 10);

  return {
    clientId: String(env.GMAIL_CLIENT_ID || '').trim(),
    clientSecret: String(env.GMAIL_CLIENT_SECRET || '').trim(),
    refreshToken: String(env.GMAIL_REFRESH_TOKEN || '').trim(),
    senderEmail: String(env.GMAIL_SENDER_EMAIL || env.GMAIL_FROM_EMAIL || '').trim(),
    senderName: String(env.GMAIL_SENDER_NAME || '').trim(),
    redirectUri,
    loopbackPort: Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : derivedPort,
    bccAudit: splitCsv(env.GMAIL_BCC_AUDIT || ''),
    draftOnly: parseBoolean(env.GMAIL_DRAFT_ONLY, false),
  };
}

export function assertGmailRuntimeConfig(gmailConfig) {
  const missing = [];

  if (!gmailConfig?.clientId) {
    missing.push('GMAIL_CLIENT_ID');
  }
  if (!gmailConfig?.clientSecret) {
    missing.push('GMAIL_CLIENT_SECRET');
  }
  if (!gmailConfig?.refreshToken) {
    missing.push('GMAIL_REFRESH_TOKEN');
  }
  if (!gmailConfig?.senderEmail) {
    missing.push('GMAIL_SENDER_EMAIL');
  }

  if (missing.length > 0) {
    throw new Error(`Gmail runtime is missing required config: ${missing.join(', ')}`);
  }
}
