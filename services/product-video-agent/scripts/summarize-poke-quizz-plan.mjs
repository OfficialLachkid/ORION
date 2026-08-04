#!/usr/bin/env node

export * from './poke-quizz/summarize-plan.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/summarize-plan.mjs');
