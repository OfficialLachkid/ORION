#!/usr/bin/env node

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { recoverOutboundReceipts } from '../services/discord-bot/src/outbound-receipt-recovery.mjs';

async function main() {
  const config = loadRuntimeConfig();
  const result = await recoverOutboundReceipts(config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Outbound receipt reconciliation failed: ${error.message}\n`);
  process.exitCode = 1;
});
