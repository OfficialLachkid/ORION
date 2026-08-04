#!/usr/bin/env node

export * from './poke-quizz/render-video.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './poke-quizz/render-video.mjs');
