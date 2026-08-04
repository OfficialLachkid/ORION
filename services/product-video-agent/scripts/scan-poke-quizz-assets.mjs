#!/usr/bin/env node

export * from './assets/scan-poke-quizz-assets.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './assets/scan-poke-quizz-assets.mjs');
