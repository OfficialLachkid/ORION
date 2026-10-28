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

For later private remote access, keep the server on loopback and use an authenticated HTTPS reverse proxy such as Tailscale Serve. Set the exact HTTPS URL as `ORION_DASHBOARD_PUBLIC_ORIGIN` and set `ORION_DASHBOARD_SECURE_COOKIE=true` before testing that path.

## Data sources

- Supabase: connected channels, publications, and lead status.
- Discord pending-task store: the same unresolved approvals the live Discord runtime uses.
- ORION operations events: the same event stream used by the Discord daily summary.
- ORION health snapshot: the same health-monitor output used for alerts.

Only server-side code receives the Supabase secret key. The browser receives a sanitized overview contract.

## Tests

```bash
npm run dashboard:test
```

See [the architecture decision](../../docs/dashboard/architecture.md) before adding any write action.
