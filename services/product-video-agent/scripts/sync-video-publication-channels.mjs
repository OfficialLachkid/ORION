#!/usr/bin/env node

export * from './publication/sync-video-publication-channels.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './publication/sync-video-publication-channels.mjs');
