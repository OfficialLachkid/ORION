#!/usr/bin/env node

import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createPasswordHash } from '../src/auth.mjs';
import { projectRoot } from '../../lib/runtime-config.mjs';

function readLine(prompt, { hidden = false } = {}) {
  if (!process.stdin.isTTY) {
    throw new Error('Administrator provisioning requires an interactive terminal.');
  }
  process.stdout.write(prompt);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  if (hidden) process.stdin.setRawMode(true);

  return new Promise((resolvePromise, rejectPromise) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      if (hidden) process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          rejectPromise(new Error('Provisioning cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolvePromise(value.trim());
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

const envPath = resolve(projectRoot, 'config', 'dashboard', '.env');
if (existsSync(envPath)) {
  throw new Error(`Refusing to overwrite existing dashboard configuration: ${envPath}`);
}

const username = (await readLine('Administrator username [admin]: ')) || 'admin';
const password = await readLine('Administrator password (14+ characters): ', { hidden: true });
const confirmation = await readLine('Confirm administrator password: ', { hidden: true });
if (password !== confirmation) throw new Error('Passwords do not match.');

const passwordHash = createPasswordHash(password);
const sessionSecret = randomBytes(48).toString('base64url');
const content = [
  `ORION_DASHBOARD_ADMIN_USERNAME=${username}`,
  `ORION_DASHBOARD_ADMIN_PASSWORD_HASH=${passwordHash}`,
  `ORION_DASHBOARD_SESSION_SECRET=${sessionSecret}`,
  'ORION_DASHBOARD_HOST=127.0.0.1',
  'ORION_DASHBOARD_PORT=4317',
  'ORION_DASHBOARD_PUBLIC_ORIGIN=http://127.0.0.1:4317',
  'ORION_DASHBOARD_SECURE_COOKIE=false',
  '',
].join('\n');

mkdirSync(dirname(envPath), { recursive: true });
const descriptor = openSync(envPath, 'wx', 0o600);
try {
  writeFileSync(descriptor, content, 'utf8');
} finally {
  closeSync(descriptor);
}

process.stdout.write(`Dashboard administrator configured at ${envPath}.\n`);
process.stdout.write('The plaintext password was not written to disk or printed.\n');
