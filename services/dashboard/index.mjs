#!/usr/bin/env node

import { loadRuntimeConfig } from '../lib/runtime-config.mjs';
import { recordOpsMetric } from '../lib/metrics-store.mjs';
import { loadDashboardConfig } from './src/config.mjs';
import { DashboardDataSource } from './src/data-source.mjs';
import { createDashboardServer } from './src/server.mjs';

const dashboardConfig = loadDashboardConfig();
const runtimeConfig = loadRuntimeConfig();
const dataSource = new DashboardDataSource({
  runtimeConfig,
  cacheTtlSeconds: dashboardConfig.cacheTtlSeconds,
});
const server = createDashboardServer({
  config: dashboardConfig,
  dataSource,
  recordEvent: (type, payload) => recordOpsMetric(runtimeConfig, type, payload),
});
server.listen(dashboardConfig.port, dashboardConfig.host, () => {
  process.stdout.write(
    `ORION dashboard listening on ${dashboardConfig.host}:${dashboardConfig.port}. `
    + `Public origin: ${dashboardConfig.publicOrigin}\n`,
  );
});
