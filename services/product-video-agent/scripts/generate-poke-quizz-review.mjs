#!/usr/bin/env node

export * from './poke-quizz/generate-review.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/generate-review.mjs');
