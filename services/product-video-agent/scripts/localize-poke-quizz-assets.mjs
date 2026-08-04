#!/usr/bin/env node

export * from './assets/localize-poke-quizz-assets.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './assets/localize-poke-quizz-assets.mjs');
