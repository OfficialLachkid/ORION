import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const SUPABASE_ENV_PATH = resolve(projectRoot, 'config', 'supabase', '.env');

function maskValue(value) {
  if (!value) {
    return '';
  }

  const text = String(value);
  if (text.length <= 8) {
    return '********';
  }

  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function createHeaders(apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

async function probe(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    bodyPreview: bodyText.slice(0, 240),
  };
}

function printResult(label, result) {
  const status = result.ok ? 'ok' : 'failed';
  console.log(`${label}: ${status} (${result.status} ${result.statusText})`);
  if (result.bodyPreview) {
    console.log(`  preview: ${result.bodyPreview}`);
  }
}

async function main() {
  const { env } = loadRuntimeConfig();
  const supabaseUrl = env.SUPABASE_URL || '';
  const secretKey = env.SUPABASE_SECRET_KEY || '';
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || '';
  const apiKey = secretKey || publishableKey;

  if (!existsSync(SUPABASE_ENV_PATH)) {
    console.error(`Missing Supabase env file: ${SUPABASE_ENV_PATH}`);
    process.exitCode = 1;
    return;
  }

  if (!supabaseUrl) {
    console.error('Missing SUPABASE_URL in config/supabase/.env');
    process.exitCode = 1;
    return;
  }

  if (!apiKey) {
    console.error('Missing SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY in config/supabase/.env');
    process.exitCode = 1;
    return;
  }

  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Using API key: ${secretKey ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_PUBLISHABLE_KEY'} (${maskValue(apiKey)})`);

  const authHealthUrl = new URL('/auth/v1/health', supabaseUrl).toString();
  const restRootUrl = new URL('/rest/v1/', supabaseUrl).toString();

  const authHealth = await probe(authHealthUrl, {
    headers: createHeaders(apiKey),
  });
  printResult('auth health', authHealth);

  const restRoot = await probe(restRootUrl, {
    headers: createHeaders(apiKey),
  });
  printResult('rest root', restRoot);

  if (!authHealth.ok || !restRoot.ok) {
    process.exitCode = 1;
    return;
  }

  console.log('Supabase connection probe succeeded.');
}

main().catch((error) => {
  console.error(`Supabase connection probe failed: ${error.message}`);
  process.exitCode = 1;
});
