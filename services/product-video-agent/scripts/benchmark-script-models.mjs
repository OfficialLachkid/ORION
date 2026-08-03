#!/usr/bin/env node

export * from './maintenance/benchmark-script-models.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './maintenance/benchmark-script-models.mjs');
