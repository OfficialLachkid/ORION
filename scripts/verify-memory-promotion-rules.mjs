#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { auditNamespaceCoverage, summarizeAudit } from './lib/memory-promotion-audit.mjs';
import { postToolReport } from './lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printError,
  printInfo,
  printUsage,
  printWarn,
} from './lib/ruflo-wrapper-utils.mjs';

const PLAYBOOK_CANDIDATES = [
  'Jacobs-2/05_Playbooks/Ruflo_Memory_Promotion_Rules.md',
  'config/runtime/memory-promotion-rules-playbook.md',
];

function resolvePlaybookPath(explicitPath) {
  if (explicitPath) {
    return resolve(projectRoot, explicitPath);
  }
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    const vaultCandidate = resolve(home, 'Vault', 'Jacobs-2', '05_Playbooks', 'Ruflo_Memory_Promotion_Rules.md');
    if (existsSync(vaultCandidate)) {
      return vaultCandidate;
    }
  }
  for (const candidate of PLAYBOOK_CANDIDATES) {
    const abs = resolve(projectRoot, candidate);
    if (existsSync(abs)) {
      return abs;
    }
  }
  return '';
}

export function runMemoryPromotionAudit(config, options = {}) {
  const playbookPath = resolvePlaybookPath(options.playbookPath);
  if (!playbookPath) {
    return {
      state: 'blocked',
      playbookPath: '',
      audit: {
        namespaces: [],
        findings: [{
          namespace: '_playbook',
          level: 'error',
          code: 'playbook_missing',
          detail: 'Ruflo_Memory_Promotion_Rules.md was not found in the vault or the repo Jacobs-2 stub.',
        }],
        errorCount: 1,
        warnCount: 0,
      },
    };
  }

  const playbookText = readFileSync(playbookPath, 'utf8');
  const audit = auditNamespaceCoverage(
    config.memoryNamespaces,
    config.memoryPromotionRules,
    playbookText
  );

  return {
    state: audit.errorCount > 0 ? 'blocked' : audit.warnCount > 0 ? 'degraded' : 'ok',
    playbookPath,
    generatedAtUtc: new Date().toISOString(),
    audit,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/verify-memory-promotion-rules.mjs [options]',
      '',
      'Options:',
      '  --playbook-path <path>   Explicit path to Ruflo_Memory_Promotion_Rules.md.',
      '  --allow-warnings         Exit 0 even if warnings are present.',
      '  --json                   Print the report as JSON.',
      '  --post-to-discord        Post the audit result to the memory-updates Discord channel.',
    ]);
    return;
  }

  const config = loadRuntimeConfig();
  const report = runMemoryPromotionAudit(config, {
    playbookPath: getStringOption(options, 'playbook-path', ''),
  });

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printInfo(`Playbook: ${report.playbookPath || '(missing)'}`);
    printInfo(`State: ${report.state.toUpperCase()}`);
    for (const line of summarizeAudit(report.audit)) {
      process.stdout.write(`${line}\n`);
    }
  }

  if (getBooleanOption(options, 'post-to-discord', false)) {
    try {
      const failures = (report.audit?.findings || []).filter((finding) => finding.level === 'error');
      const warnings = (report.audit?.findings || []).filter((finding) => finding.level === 'warn');
      const fields = [
        { name: 'namespaces', value: String(report.audit?.namespaces?.length || 0), inline: true },
        { name: 'errors', value: String(report.audit?.errorCount || 0), inline: true },
        { name: 'warnings', value: String(report.audit?.warnCount || 0), inline: true },
        { name: 'playbook', value: report.playbookPath || '(missing)' },
      ];
      if (failures.length > 0) {
        fields.push({
          name: 'error_findings',
          value: failures.map((finding) => `${finding.namespace} ${finding.code}: ${finding.detail}`).join('\n'),
        });
      }
      if (warnings.length > 0) {
        fields.push({
          name: 'warning_findings',
          value: warnings.map((finding) => `${finding.namespace} ${finding.code}: ${finding.detail}`).join('\n'),
        });
      }
      const summary = `Promotion rules audit ${report.state.toUpperCase()}: ${report.audit?.errorCount || 0} errors, ${report.audit?.warnCount || 0} warnings, ${report.audit?.namespaces?.length || 0} namespaces.`;
      const post = await postToolReport(
        config,
        'verify_memory_promotion_rules',
        report.state === 'ok' ? 'healthy' : report.state,
        summary,
        fields,
        { explicit: true }
      );
      if (post.posted) {
        printInfo(`Posted promotion rules audit to Discord channel ${post.channelKey}.`);
      } else {
        printWarn(`Discord post skipped: ${post.reason || 'unknown reason'}.`);
      }
    } catch (error) {
      printError(`Could not post promotion rules audit to Discord: ${error.message || error}`);
    }
  }

  if (report.state === 'ok') {
    return;
  }
  if (report.state === 'degraded' && getBooleanOption(options, 'allow-warnings', false)) {
    printWarn('Warnings present but --allow-warnings is set; exiting 0.');
    return;
  }

  process.exitCode = 1;
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
