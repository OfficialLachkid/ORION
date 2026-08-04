#!/usr/bin/env node

export * from './publication/run-video-publication-scheduler.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './publication/run-video-publication-scheduler.mjs');
