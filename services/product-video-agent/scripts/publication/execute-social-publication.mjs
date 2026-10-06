#!/usr/bin/env node

export * from './social/execute-due-publications.mjs';
import { runCompatWrapper } from '../_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './social/execute-due-publications.mjs');
