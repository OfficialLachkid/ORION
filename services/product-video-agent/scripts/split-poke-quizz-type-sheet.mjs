#!/usr/bin/env node

export * from './assets/split-poke-quizz-type-sheet.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './assets/split-poke-quizz-type-sheet.mjs');
