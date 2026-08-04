#!/usr/bin/env node

export * from './assets/bake-poke-quizz-badge-circles.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './assets/bake-poke-quizz-badge-circles.mjs');
