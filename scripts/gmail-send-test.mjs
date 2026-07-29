#!/usr/bin/env node

import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { resolveGmailConfig, summarizeGmailReadiness } from '../services/gmail/src/config.mjs';
import { sendGmailMessage } from '../services/gmail/src/send.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printError,
  printInfo,
  printUsage,
} from './lib/ruflo-wrapper-utils.mjs';

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/gmail-send-test.mjs --to <email> --subject <text> --body <text> [--draft-only] [--json]',
      '',
      'Sends a single Gmail message using the sender configured in config/gmail/.env.',
      'Pass --draft-only to leave the message in Drafts instead of sending.',
    ]);
    return;
  }

  const to = getStringOption(options, 'to', '');
  const subject = getStringOption(options, 'subject', '');
  const body = getStringOption(options, 'body', '');
  if (!to || !subject || !body) {
    throw new Error('Missing required flag(s). --to, --subject, --body are required.');
  }

  const runtimeConfig = loadRuntimeConfig();
  const gmailConfig = resolveGmailConfig(runtimeConfig);
  const readiness = summarizeGmailReadiness(gmailConfig);
  if (!readiness.ready) {
    throw new Error(`Gmail sender not fully configured. Missing: ${readiness.missing.join(', ')}. Run npm run gmail:authorize first.`);
  }

  const draftOnly = getBooleanOption(options, 'draft-only', false);
  const result = await sendGmailMessage(gmailConfig, {
    to,
    subject,
    bodyText: body,
  }, { draftOnly });

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  printInfo(`mode: ${result.mode}`);
  if (result.mode === 'sent') {
    printInfo(`messageId: ${result.messageId}`);
    printInfo(`threadId: ${result.threadId}`);
  } else {
    printInfo(`draftId: ${result.draftId || ''}`);
    printInfo(`messageId (draft): ${result.messageId || ''}`);
  }
  printInfo(`to: ${result.to}`);
  printInfo(`from: ${result.from}`);
  printInfo(`subject: ${result.subject}`);
}

main().catch((error) => {
  printError(error.message || String(error));
  process.exitCode = 1;
});
