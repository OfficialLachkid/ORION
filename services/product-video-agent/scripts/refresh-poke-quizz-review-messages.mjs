#!/usr/bin/env node

export * from './poke-quizz/refresh-review-messages.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/refresh-review-messages.mjs');
