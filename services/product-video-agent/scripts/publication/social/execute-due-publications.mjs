#!/usr/bin/env node

export * from './tiktok/execute-due-publications.mjs';
import { runCompatWrapper } from '../../_shared/compat-wrapper.mjs';

runCompatWrapper(import.meta.url, './tiktok/execute-due-publications.mjs');
