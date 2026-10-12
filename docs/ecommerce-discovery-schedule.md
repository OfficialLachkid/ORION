# Ecommerce discovery schedule

## Purpose and ownership

ORION supervises a bounded ecommerce product-discovery process. It owns the calendar, process lifecycle, timeout, resource locks, sanitized operational metrics, and launchd logs. The ecommerce repository continues to own supplier access, discovery profiles, local-model query expansion, scoring, persistence, and the approval dashboard.

ORION does not query the ecommerce Supabase project, interpret CJ payloads, import products, approve products, publish products, or purchase anything. Successful discovery records appear in the ecommerce dashboard's **Discovery** lane and remain there for human review. Importing a candidate remains an explicit authenticated action.

## Pilot schedule

- Days: Monday, Wednesday, and Friday
- Time: 00:15 Europe/Amsterdam (the Mac mini's local timezone)
- Maximum runtime: 30 minutes
- Pilot duration: four weeks from installation; the generated LaunchAgent passes a fail-closed end date to the runner
- Concurrency: one discovery batch at a time, with two sequential jobs in the ecommerce plan
- Retry policy: no automatic retry during the pilot

The ecommerce handoff originally suggested 02:00. That time is unsafe in the current ORION calendar because the 01:30 night shift can still be rendering video or running Ollama-backed lead generation. The 00:15 slot is intentionally separate: the hard timeout ends it by 00:45, before video analytics at 01:00 and the main night shift at 01:30.

## Configuration boundary

Create `config/ecommerce/.env` in ORION from `config/ecommerce/.env.example`. It contains only process-location settings:

```dotenv
ECOMMERCE_REPO_PATH=/Users/Agent/Workspace/ecommerce
ECOMMERCE_DISCOVERY_PLAN_PATH=config/discovery-plan.example.json
ECOMMERCE_DISCOVERY_TIMEOUT_MS=1800000
ECOMMERCE_NPM_BIN=/Users/Agent/.local/node-v24.21.0/bin/npm
```

Supplier, database, and Ollama values stay in the ecommerce repository's `.env` or `.env.local`. Before any run, ORION checks only that these names are present; values are never emitted:

- `CJ_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

The Mac mini currently keeps Node 24.21.0 in the explicit user-local path above because the ecommerce repository requires Node 24, while ORION itself continues running on Node 26. The runner prepends the selected npm binary's directory only for the ecommerce child process; it does not change ORION's global runtime.

The pilot plan uses the ecommerce-owned `product-discovery-plan.v1` file. It must contain exactly two jobs for the pilot and never more than the ecommerce contract's maximum of four. Jobs run sequentially. Fresh equivalent runs may use the ecommerce repository's six-hour cache; the M/W/F cadence normally falls outside that window.

## Safety controls

The runner:

1. validates the ecommerce plan with the ecommerce repository's own CLI;
2. confirms the configured Ollama model is installed;
3. refuses to start a live batch while another Ollama model is loaded;
4. acquires both an ecommerce-run lock and a shared Ollama lock;
5. invokes `npm run --silent discovery:batch -- --plan <absolute-plan-path>` without a shell;
6. captures stdout and stderr separately with bounded buffers;
7. terminates the full Unix process group after 30 minutes, escalating from `SIGTERM` to `SIGKILL`;
8. accepts only the documented `product-discovery-batch.v1` result shape;
9. records counts and sanitized errors, never raw supplier payloads or environment values;
10. releases locks even after failure.

The shared lock protects this job from duplicate starts. The separated schedule and Ollama `/api/ps` preflight protect existing jobs that predate the shared lock and do not yet participate in it.

## Operations

Validate the paths, plan, required environment names, Ollama service, and installed model without contacting CJ or writing discovery results:

```bash
npm run ecommerce:discovery:validate
```

Run one supervised batch manually:

```bash
npm run ecommerce:discovery
```

Install the four-week pilot schedule (default 00:15 M/W/F):

```bash
npm run ecommerce:install-discovery-schedule
```

Write the plist without loading it:

```bash
npm run ecommerce:install-discovery-schedule -- --no-load
```

Stop future scheduled runs and remove the plist:

```bash
npm run ecommerce:install-discovery-schedule -- --uninstall
```

Start or stop the loaded job independently:

```bash
launchctl kickstart -k "gui/$(id -u)/io.vbj.orion.ecommerce-discovery"
launchctl kill SIGTERM "gui/$(id -u)/io.vbj.orion.ecommerce-discovery"
```

Logs are separate from other night work:

- `data/runtime/logs/ecommerce-discovery.stdout.log`
- `data/runtime/logs/ecommerce-discovery.stderr.log`
- `data/runtime/logs/ops-events.jsonl` (`ecommerce_discovery_run`, `ecommerce_discovery_failed`, and validation events)

Operational results contain only the plan ID, status, timestamps/duration, job counts, candidates, observations, supplier API operations, cached versus supplier job counts, warning count, exit code, and a sanitized error when applicable.

## Pilot acceptance

Before leaving the schedule unattended:

1. validate on the Mac mini;
2. run one manual supervised two-job batch;
3. confirm `product-discovery-batch.v1` completed without leaked secrets;
4. confirm candidates appear in the ecommerce dashboard's Discovery lane;
5. confirm they require human import/approval;
6. confirm both resource lock files are absent after completion;
7. confirm the process ends before 00:45 and does not overlap the 01:00 or 01:30 jobs;
8. load the LaunchAgent only after those checks pass.

At the four-week boundary, the runner refuses further scheduled work. Review supplier usage, warning rate, candidate quality, Mac resource impact, and dashboard approval value before installing a new pilot window or changing cadence.
