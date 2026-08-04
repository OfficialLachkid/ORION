#!/usr/bin/env node

export * from './poke-quizz/organize-previews.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/organize-previews.mjs');
