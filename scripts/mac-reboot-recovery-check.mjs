#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { executeHealthAction } from '../services/task-router/src/executor.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import {
  classifyOverallReadiness,
  getOptionalRebootChecks,
  getRequiredRebootChecks,
  summarizeRebootRecoveryChecks,
} from './lib/reboot-recovery-check.mjs';
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

function ensureAuditRoot(config) {
  const auditRoot = config?.env?.REBOOT_RECOVERY_AUDIT_PATH
    ? resolve(projectRoot, config.env.REBOOT_RECOVERY_AUDIT_PATH)
    : resolve(projectRoot, 'data', 'runtime', 'reboot-recovery');
  if (!existsSync(auditRoot)) {
    mkdirSync(auditRoot, { recursive: true });
  }
  return auditRoot;
}

function writeAuditFile(auditRoot, report) {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const auditPath = resolve(auditRoot, `${timestamp}.json`);
  writeFileSync(auditPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const latestPath = resolve(auditRoot, 'latest.json');
  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { auditPath, latestPath };
}

async function runOneCheck(action, config, executor) {
  try {
    const outcome = await executor(action, config);
    if (outcome.outcome === 'failed') {
      return {
        action,
        state: 'error',
        summary: outcome.error?.message || `Health action ${action} failed.`,
        report: null,
        error: outcome.error?.message || '',
      };
    }
    const report = outcome.executionResult?.report || null;
    return {
      action,
      state: report?.state || 'unknown',
      summary: report?.summary || '',
      report,
      error: '',
    };
  } catch (error) {
    return {
      action,
      state: 'error',
      summary: error.message || `Health action ${action} threw.`,
      report: null,
      error: error.message || '',
    };
  }
}

export async function runMacRebootRecoveryCheck(config, options = {}) {
  const executor = options.executeHealthAction || executeHealthAction;
  const requireOptional = options.requireOptional === true;
  const actions = [...getRequiredRebootChecks(), ...getOptionalRebootChecks()];
  const rawChecks = [];
  for (const action of actions) {
    // eslint-disable-next-line no-await-in-loop -- health checks must run sequentially to keep launchctl output stable
    const result = await runOneCheck(action, config, executor);
    rawChecks.push(result);
  }

  const { summary, detail } = summarizeRebootRecoveryChecks(rawChecks, {
    diskWarnPercent: config?.healthThresholds?.diskUsageWarnPercent,
    diskCriticalPercent: config?.healthThresholds?.diskUsageCriticalPercent,
  });
  const readiness = classifyOverallReadiness(detail, { requireOptional });

  return {
    generatedAtUtc: new Date().toISOString(),
    readiness: readiness.readiness,
    requireOptional,
    summary,
    detail,
    missingRequired: readiness.missingRequired,
    failingRequired: readiness.failingRequired.map((entry) => ({
      action: entry.action,
      state: entry.state,
      summary: entry.summary,
    })),
    failingOptional: readiness.failingOptional.map((entry) => ({
      action: entry.action,
      state: entry.state,
      summary: entry.summary,
    })),
  };
}

function printReport(report) {
  printInfo(`Reboot recovery readiness: ${report.readiness.toUpperCase()}`);
  printInfo(`healthy=${report.summary.healthy} degraded=${report.summary.degraded} blocked=${report.summary.blocked} unknown=${report.summary.unknown}`);
  for (const entry of report.detail) {
    const marker = entry.verdict === 'healthy' ? '  ok' : entry.verdict.toUpperCase();
    const requiredMarker = entry.required ? 'REQUIRED' : 'optional';
    process.stdout.write(`- [${marker}] (${requiredMarker}) ${entry.action}: ${entry.state} ${entry.summary || ''}\n`.trimEnd() + '\n');
  }
  if (report.missingRequired.length > 0) {
    printWarn(`Missing required checks: ${report.missingRequired.join(', ')}`);
  }
  if (report.failingRequired.length > 0) {
    printWarn(`Failing required checks: ${report.failingRequired.map((entry) => entry.action).join(', ')}`);
  }
  if (report.failingOptional.length > 0) {
    printWarn(`Failing optional checks: ${report.failingOptional.map((entry) => entry.action).join(', ')}`);
  }
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/mac-reboot-recovery-check.mjs [options]',
      '',
      'Options:',
      '  --require-optional         Also require Tailscale + disk-space checks to be healthy.',
      '  --allow-degraded           Exit 0 when readiness is degraded.',
      '  --json                     Print the report as JSON.',
      '  --post-to-discord          Post the readiness report to the agent-results Discord channel.',
    ]);
    return;
  }

  const config = loadRuntimeConfig();
  const report = await runMacRebootRecoveryCheck(config, {
    requireOptional: getBooleanOption(options, 'require-optional', false),
  });

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printReport(report);
  }

  const auditRoot = ensureAuditRoot(config);
  const { auditPath, latestPath } = writeAuditFile(auditRoot, report);
  printInfo(`Audit written to ${auditPath}`);
  printInfo(`Latest pointer at ${latestPath}`);

  recordOpsMetric(config, 'mac_reboot_recovery_check', {
    readiness: report.readiness,
    healthy: report.summary.healthy,
    degraded: report.summary.degraded,
    blocked: report.summary.blocked,
    unknown: report.summary.unknown,
    missingRequired: report.missingRequired,
    failingRequired: report.failingRequired.map((entry) => entry.action),
    failingOptional: report.failingOptional.map((entry) => entry.action),
  });

  if (getBooleanOption(options, 'post-to-discord', false)) {
    try {
      const summaryLine = `${report.summary.healthy}/${report.summary.total} healthy · ${report.summary.blocked} blocked · ${report.summary.degraded} degraded`;
      const failLines = [
        ...report.failingRequired.map((entry) => `REQUIRED ${entry.action}: ${entry.state}`),
        ...report.failingOptional.map((entry) => `optional ${entry.action}: ${entry.state}`),
      ];
      const fields = [
        { name: 'readiness', value: report.readiness, inline: true },
        { name: 'totals', value: summaryLine, inline: false },
      ];
      if (failLines.length > 0) {
        fields.push({ name: 'failures', value: failLines.join('\n') });
      }
      if (report.missingRequired.length > 0) {
        fields.push({ name: 'missing_required', value: report.missingRequired.join(', ') });
      }
      const post = await postToolReport(
        config,
        'mac_reboot_recovery_check',
        report.readiness === 'ready' ? 'healthy' : report.readiness,
        `Mac reboot recovery ${report.readiness.toUpperCase()}. ${summaryLine}.`,
        fields,
        { explicit: true }
      );
      if (post.posted) {
        printInfo(`Posted reboot-recovery report to Discord channel ${post.channelKey}.`);
      } else {
        printWarn(`Discord post skipped: ${post.reason || 'unknown reason'}.`);
      }
    } catch (error) {
      printError(`Could not post reboot-recovery report to Discord: ${error.message || error}`);
    }
  }

  if (report.readiness === 'ready') {
    return;
  }
  if ((report.readiness === 'degraded' || report.readiness === 'degraded_soft')
      && getBooleanOption(options, 'allow-degraded', report.readiness === 'degraded_soft')) {
    printWarn(`Readiness is ${report.readiness}; exiting 0 because --allow-degraded is set.`);
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
