#!/usr/bin/env node

export * from './pokedex/sync-pokedex-gen9.mjs';
import { runCompatWrapper } from './_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './pokedex/sync-pokedex-gen9.mjs');
