#!/usr/bin/env node

export * from './analytics/run-video-analytics-sweep.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './analytics/run-video-analytics-sweep.mjs');
