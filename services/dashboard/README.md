# ORION Dashboard

Private, single-admin, read-only first instance of the ORION command center.

The dashboard reads the same runtime state used by Discord and existing workers. It does not implement another approval queue, scheduler, job runner, or database.

## Provision locally

Run this interactively on the ORION runtime host:

```bash
npm run dashboard:provision-admin
```

The command prompts for one administrator username and a hidden password, then writes an ignored `config/dashboard/.env` with owner-only file permissions. It does not print or store the plaintext password.

Start the loopback-only server:

```bash
npm run dashboard:start
```

Open `http://127.0.0.1:4317`. Do not expose this port publicly.

After supervised validation on the Mac mini, install the persistent loopback service:

```bash
npm run dashboard:install-launch-agent
```

The LaunchAgent keeps the dashboard running without changing any ORION worker or schedule.

For later private remote access, keep the server on loopback and use an authenticated HTTPS reverse proxy such as Tailscale Serve. Set the exact HTTPS URL as `ORION_DASHBOARD_PUBLIC_ORIGIN` and set `ORION_DASHBOARD_SECURE_COOKIE=true` before testing that path.

## Data sources

- Supabase: connected channels, a bounded upcoming-publication window, and lazy paginated lead summaries.
- Discord pending-task store: the same unresolved approvals the live Discord runtime uses.
- ORION operations events: the same event stream used by the Discord daily summary.
- ORION health snapshot: the same health-monitor output used for alerts.
- T7 digital-asset archive: canonical products and sanitized verified-public-release state.

Lead Operations stays dormant until its tab is opened. The first unfiltered page performs one bounded 25-row request with an exact total and one header-only `new` count; other dashboard tabs add no lead traffic. Lead pages use the same server cache and expose their own request, row, and response-byte cost. Contact details, raw extraction, and qualification reasoning are deliberately excluded from this first view.

The browser refreshes the shared overview at most every fifteen minutes while the dashboard is visible. Background tabs do not refresh. The server caches the shared snapshot for five minutes by default, and manual refresh is the only cache-bypass path. The overview response reports the request, row, and response-byte cost of its latest Supabase snapshot.

The repository's GitHub Pages root redirects tailnet members to the private dashboard. The **Sites gallery** link at the bottom of the dashboard preserves access to the public website gallery. GitHub Pages never receives dashboard data or credentials.

Only server-side code receives the Supabase secret key. The browser receives a sanitized overview contract.

## Tests

```bash
npm run dashboard:test
```

See [the architecture decision](../../docs/dashboard/architecture.md) before adding any write action.
