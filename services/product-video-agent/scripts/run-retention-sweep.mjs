#!/usr/bin/env node

export * from './maintenance/run-retention-sweep.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './maintenance/run-retention-sweep.mjs');
