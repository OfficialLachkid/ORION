import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LoginRateLimiter,
  createPasswordHash,
  createSessionManager,
  verifyPassword,
} from '../src/auth.mjs';

test('password hashes verify without retaining the plaintext password', () => {
  const password = 'correct horse battery staple';
  const hash = createPasswordHash(password, { salt: Buffer.alloc(16, 7) });

  assert.match(hash, /^scrypt\$/u);
  assert.equal(hash.includes(password), false);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('incorrect password', hash), false);
});

test('sessions reject tampering, expiry, and explicit revocation', () => {
  const sessions = createSessionManager({
    secret: 'a'.repeat(48),
    ttlSeconds: 60,
  });
  const issued = sessions.issue('admin', 1_000_000);

  assert.equal(sessions.verify(issued.token, 1_030_000)?.sub, 'admin');
  assert.equal(sessions.verify(`${issued.token}x`, 1_030_000), null);
  assert.equal(sessions.verify(issued.token, 1_061_000), null);

  const active = sessions.issue('admin', 2_000_000);
  sessions.revoke(active.payload);
  assert.equal(sessions.verify(active.token, 2_001_000), null);
});

test('login rate limiter blocks repeated failures for one client', () => {
  const limiter = new LoginRateLimiter({ maxAttempts: 2, windowSeconds: 60 });
  assert.equal(limiter.check('client', 1_000).allowed, true);
  limiter.fail('client', 1_000);
  limiter.fail('client', 1_100);
  assert.equal(limiter.check('client', 1_200).allowed, false);
  assert.equal(limiter.check('other', 1_200).allowed, true);
  assert.equal(limiter.check('client', 62_000).allowed, true);
});

