#!/usr/bin/env node

export * from './publication/execute-youtube-publication.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './publication/execute-youtube-publication.mjs');
