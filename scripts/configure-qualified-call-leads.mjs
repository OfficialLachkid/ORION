#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { projectRoot } from '../services/lib/runtime-config.mjs';

const ENV_KEY = 'DISCORD_QUALIFIED_CALL_LEADS_THREAD_ID';
const LEGACY_ENV_KEY = 'DISCORD_QUALIFIED_NO_EMAIL_THREAD_ID';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : String(process.argv[index + 1] || '').trim();
}

function upsertThreadId(content, threadId) {
  const lines = String(content || '').split(/\r?\n/u);
  const nextLines = [];
  let replaced = false;

  for (const line of lines) {
    if (line.startsWith(`${LEGACY_ENV_KEY}=`)) {
      continue;
    }
    if (line.startsWith(`${ENV_KEY}=`)) {
      if (!replaced) {
        nextLines.push(`${ENV_KEY}=${threadId}`);
        replaced = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!replaced) {
    const salesChannelIndex = nextLines.findIndex((line) => (
      line.startsWith('DISCORD_SALES_AGENT_CHANNEL_ID=')
    ));
    nextLines.splice(
      salesChannelIndex === -1 ? nextLines.length : salesChannelIndex + 1,
      0,
      `${ENV_KEY}=${threadId}`,
    );
  }

  return `${nextLines.join('\n').replace(/\n+$/u, '')}\n`;
}

function main() {
  const threadId = getArgValue('--thread-id');
  if (!/^\d{17,20}$/u.test(threadId)) {
    throw new Error('Provide a valid Discord thread id with --thread-id.');
  }

  const envPath = resolve(projectRoot, 'config', 'discord', '.env');
  if (!existsSync(envPath)) {
    throw new Error(`Discord runtime env not found: ${envPath}`);
  }

  const tempPath = `${envPath}.qualified-call-leads.tmp`;
  const mode = statSync(envPath).mode;
  writeFileSync(tempPath, upsertThreadId(readFileSync(envPath, 'utf8'), threadId), {
    encoding: 'utf8',
    mode,
  });
  renameSync(tempPath, envPath);
  process.stdout.write(`Configured ${ENV_KEY}=${threadId}\n`);
}

main();
