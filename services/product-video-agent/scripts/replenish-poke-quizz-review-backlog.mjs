#!/usr/bin/env node

export * from './poke-quizz/replenish-review-backlog.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/replenish-review-backlog.mjs');
