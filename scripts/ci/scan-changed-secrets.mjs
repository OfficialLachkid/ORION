#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import process from 'node:process';
import { projectRoot } from '../../services/lib/runtime-config.mjs';
import { getArgValue, listChangedFiles } from './lib/ci-diff-utils.mjs';

const ALLOWED_EXTENSIONS = new Set([
  '.env',
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.sh',
  '.toml',
  '.yaml',
  '.yml',
]);

const DETECTORS = [
  { name: 'GitHub personal access token', pattern: /\bghp_[A-Za-z0-9]{36,}\b/u },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u },
  { name: 'Discord webhook URL', pattern: /\bhttps:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\b/u },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
  { name: 'Provider secret key', pattern: /\bsk-[A-Za-z0-9]{24,}\b/u },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z\-_]{20,}\b/u },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----/u },
  {
    name: 'Sensitive env assignment',
    pattern: /\b(?:DISCORD_BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|SUPABASE_DB_URL|SUPABASE_DB_PASSWORD|GH_TOKEN|GITHUB_TOKEN)\s*=\s*["']?[^\s"'#]+/u,
  },
];

function shouldSkipPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/gu, '/');
  if (!normalized) {
    return true;
  }

  if (
    normalized.endsWith('/scan-changed-secrets.mjs') ||
    normalized.endsWith('.env.example') ||
    normalized.endsWith('example.env') ||
    normalized.includes('/examples/') ||
    normalized.includes('/example/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.js') ||
    normalized.endsWith('.test.mjs') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.js') ||
    normalized.endsWith('.spec.mjs') ||
    normalized.endsWith('.md')
  ) {
    return true;
  }

  return !ALLOWED_EXTENSIONS.has(extname(normalized));
}

function isPlaceholderLine(line) {
  const normalized = String(line || '').toLowerCase();
  return (
    normalized.endsWith('=') ||
    normalized.includes('your-') ||
    normalized.includes('example') ||
    normalized.includes('placeholder') ||
    normalized.includes('automatically-provided')
  );
}

function main() {
  const base = getArgValue('--base');
  const head = getArgValue('--head') || 'HEAD';
  const files = listChangedFiles({ base, head });
  const violations = [];

  for (const relativePath of files) {
    if (shouldSkipPath(relativePath)) {
      continue;
    }

    const absolutePath = `${projectRoot}/${relativePath}`.replace(/\\/gu, '/');
    if (!existsSync(absolutePath)) {
      continue;
    }

    const content = readFileSync(absolutePath, 'utf8');
    const lines = content.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (isPlaceholderLine(line)) {
        return;
      }

      for (const detector of DETECTORS) {
        if (detector.pattern.test(line)) {
          violations.push({
            file: relativePath,
            line: index + 1,
            detector: detector.name,
            snippet: line.trim().slice(0, 160),
          });
        }
      }
    });
  }

  if (violations.length > 0) {
    process.stderr.write('Potential secrets detected in changed files:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation.file}:${violation.line} [${violation.detector}] ${violation.snippet}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Secret scan passed for ${files.length} changed file(s).\n`);
}

main();
