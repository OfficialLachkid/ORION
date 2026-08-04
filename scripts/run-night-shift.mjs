#!/usr/bin/env node
import process from 'node:process';
import { runNightShift } from './lib/night-shift/core.mjs';

// Keep the launch-agent path stable while the implementation lives in helpers.
runNightShift(process.argv).catch((error) => {
  process.stderr.write(`Night shift failed: ${error.message}\n`);
  process.exitCode = 1;
});
