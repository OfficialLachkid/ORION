#!/usr/bin/env node

export * from './poke-quizz/plan-type-challenge.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/plan-type-challenge.mjs');
