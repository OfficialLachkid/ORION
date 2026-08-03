#!/usr/bin/env node

export * from './poke-quizz/register-publication.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/register-publication.mjs');
