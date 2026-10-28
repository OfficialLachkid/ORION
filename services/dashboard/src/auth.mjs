import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const PASSWORD_PREFIX = 'scrypt';

function encode(value) {
  return Buffer.from(value).toString('base64url');
}
function decode(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createPasswordHash(password, options = {}) {
  const normalized = String(password || '');
  if (normalized.length < 14) {
    throw new Error('Dashboard administrator password must contain at least 14 characters.');
  }
  const salt = options.salt || randomBytes(16);
  const derived = scryptSync(normalized, salt, 64);
  return `${PASSWORD_PREFIX}$${encode(salt)}$${encode(derived)}`;
}

export function verifyPassword(password, storedHash) {
  const [prefix, encodedSalt, encodedHash] = String(storedHash || '').split('$');
  if (prefix !== PASSWORD_PREFIX || !encodedSalt || !encodedHash) return false;

  try {
    const expected = decode(encodedHash);
    const actual = scryptSync(String(password || ''), decode(encodedSalt), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

export function createSessionManager(options) {
  const secret = String(options.secret || '');
  const ttlSeconds = Number(options.ttlSeconds || 28_800);
  const cookieName = options.cookieName || 'orion_dashboard_session';
  const secureCookie = options.secureCookie === true;
  const revoked = new Map();

  function cleanup(nowSeconds) {
    for (const [id, expiresAt] of revoked.entries()) {
      if (expiresAt <= nowSeconds) revoked.delete(id);
    }
  }

  function issue(username, nowMs = Date.now()) {
    const issuedAt = Math.floor(nowMs / 1000);
    const payload = {
      sub: username,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      jti: randomBytes(18).toString('base64url'),
      csrf: randomBytes(24).toString('base64url'),
    };
    const encodedPayload = encode(JSON.stringify(payload));
    return {
      token: `${encodedPayload}.${sign(encodedPayload, secret)}`,
      payload,
    };
  }

  function verify(token, nowMs = Date.now()) {
    const [encodedPayload, signature] = String(token || '').split('.');
    if (!encodedPayload || !signature) return null;
    const expected = sign(encodedPayload, secret);
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (
      expectedBuffer.length !== signatureBuffer.length
      || !timingSafeEqual(expectedBuffer, signatureBuffer)
    ) return null;

    try {
      const payload = JSON.parse(decode(encodedPayload).toString('utf8'));
      const nowSeconds = Math.floor(nowMs / 1000);
      cleanup(nowSeconds);
      if (!payload.sub || !payload.jti || !payload.csrf || payload.exp <= nowSeconds) return null;
      if (revoked.has(payload.jti)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function revoke(payload) {
    if (payload?.jti && payload?.exp) revoked.set(payload.jti, Number(payload.exp));
  }

  function cookie(token) {
    return [
      `${cookieName}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${ttlSeconds}`,
      ...(secureCookie ? ['Secure'] : []),
    ].join('; ');
  }

  function clearCookie() {
    return [
      `${cookieName}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      'Max-Age=0',
      ...(secureCookie ? ['Secure'] : []),
    ].join('; ');
  }

  return {
    cookieName,
    issue,
    verify,
    revoke,
    cookie,
    clearCookie,
  };
}

export class LoginRateLimiter {
  constructor(options = {}) {
    this.maxAttempts = Number(options.maxAttempts || 5);
    this.windowMs = Number(options.windowSeconds || 900) * 1000;
    this.attempts = new Map();
  }

  check(key, nowMs = Date.now()) {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= nowMs) {
      this.attempts.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count < this.maxAttempts) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000)),
    };
  }

  fail(key, nowMs = Date.now()) {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= nowMs) {
      this.attempts.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      return;
    }
    current.count += 1;
  }

  clear(key) {
    this.attempts.delete(key);
  }
}
