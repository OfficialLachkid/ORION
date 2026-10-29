# ORION Dashboard Architecture

## Decision

The dashboard is a private visual interface to ORION. It is not another orchestrator.

Discord remains the primary communication and notification layer. The dashboard and Discord must read the same durable state and, when write actions are introduced, call the same application services. Neither interface may maintain its own approval result, publishing queue, schedule, or job state.

```text
                    +---------------------+
                    | ORION control plane |
                    +----------+----------+
                               |
             +-----------------+-----------------+
             |                                   |
      +------v------+                     +------v-------+
      |   Discord   |                     |  Dashboard   |
      | communicate |                     | visualize    |
      | notify      |                     | manage later |
      +-------------+                     +--------------+
```

## Current read-only increment

The first increment is intentionally read-only. It provides:

- single-admin login with no registration path;
- an authenticated overview API and responsive command-center UI;
- health data from the existing health-monitor snapshot;
- task and execution metrics from the existing operations event log;
- pending approvals from the same pending-task store used by Discord;
- connected channels, publication state, schedules, and leads from existing Supabase tables;
- functional Overview, Social Media, Digital Assets, and Lead Operations module navigation;
- lazy, paginated lead totals and gathered-lead rows matching the state reported by Discord leadgen;
- canonical digital-asset product and verified-public-release summaries from the existing T7 archive;
- visible disabled roadmap modules so planned dashboard scope remains clear;
- explicit source-availability indicators instead of mock data;
- bounded, server-side caching to limit database requests.

The dashboard does not approve, reject, retry, reschedule, execute shell commands, or edit configuration in this increment. Existing automations remain operational when the dashboard is stopped.

## Authoritative state

| Capability | Authoritative source today | Dashboard behavior |
| --- | --- | --- |
| Social channels | `video_channels` in Supabase | Read-only, secrets and raw settings excluded |
| Video workflow | `videos` and `video_publications` in Supabase | Read-only status and future publication view |
| Leads and qualification | `leads` in Supabase | Lazy read-only totals plus a 25-row page; raw extraction, qualification detail, and contact data excluded |
| Pending Discord approvals | Existing pending-task store | Read through the same repository module |
| Runtime activity | Existing `ops-events.jsonl` metrics stream | Read through the same summary module used by Discord |
| Runtime health | Existing health-monitor snapshot | Sanitized health state only |
| Publication schedules | Channel configuration plus scheduled publication rows | Observed only; no second scheduler |
| Digital asset products | Canonical T7 product archive and release receipts | Read-only summaries; draft URLs and secret query values excluded |

The Supabase secret key remains server-side. Raw channel settings, environment variables, tokens, cookies, full task text, and recovery commands are not returned to the browser.

## Resource and egress budget

Dashboard modules do not own independent polling loops. All enabled modules share one bounded server-side snapshot.

- The browser refreshes at most every fifteen minutes while the authenticated page is visible; background tabs do not poll.
- The server caches a snapshot for five minutes by default and deduplicates all widgets onto that result.
- Manual refresh is the only deliberate cache bypass.
- Social Media loads at most 100 future publication rows, a bounded channel list, and one header-only failed-publication count.
- Lead Operations makes no request until opened. Its normal unfiltered view uses one 25-row query with an exact total plus one header-only `new` count. A status-filtered view adds one header-only overall-total count.
- Lead pages share the server's two-minute cache and are capped at 50 rows even if a client requests more.
- Digital Assets reads the mounted T7 archive locally and causes no Supabase request.
- Disabled roadmap modules make no database request.
- Every snapshot reports its Supabase request count, loaded row count, and response bytes so growth remains visible.

Any new module must document its authoritative source, selected fields, row limit, cache behavior, refresh cadence, and expected egress before it becomes clickable.

## Synchronization boundary

Read synchronization is safe now because both interfaces consume the same files, database rows, and summary code.

Write synchronization needs one more boundary before dashboard actions are enabled:

1. Extract approval decisions into a shared application service and durable repository.
2. Make both Discord interactions and dashboard requests call that service.
3. Bind each decision to the exact task/revision and use an atomic compare-and-set transition.
4. Emit the same operational event and update the existing Discord message after a dashboard decision.
5. Reject stale or duplicate actions without executing the underlying work twice.

Directly changing a Discord message, writing a second dashboard approval table, or calling a platform adapter from the browser would violate this architecture.

## Security and deployment

The dashboard server:

- binds to `127.0.0.1` only;
- stores only a scrypt password hash, never the plaintext password;
- signs short-lived, HTTP-only, SameSite session cookies;
- checks request origins and CSRF tokens for authenticated mutations;
- rate-limits login attempts;
- sends a restrictive Content Security Policy and related browser headers;
- has no registration, invitation, password-reset, arbitrary command, or secret-editing endpoint;
- records login/logout events in the existing ORION operations stream.

The recommended private deployment is:

```text
Administrator browser
        |
        | HTTPS + tailnet identity
        v
Tailscale Serve / private reverse proxy
        |
        | loopback only
        v
ORION dashboard on 127.0.0.1:4317
```

GitHub Pages is not suitable for hosting dashboard data because this dashboard handles privileged private state. Its root may redirect to the private tailnet URL and retain the public Sites gallery under `/sites/`, but the authenticated application and all data APIs remain on the Mac mini behind Tailscale Serve. Do not bind the Node server to a public interface. Before enabling remote access, update `ORION_DASHBOARD_PUBLIC_ORIGIN` to the exact HTTPS origin and enable secure cookies.

## Phased delivery

### Phase 1: secure read-only foundation

- Current increment: authentication plus functional Overview, Social Media, Digital Assets, and Lead Operations views.
- Run the dashboard through its dedicated loopback-only LaunchAgent and route it through tailnet-only Tailscale Serve after supervised local validation.

### Phase 2: shared approvals and social review

- Introduce the shared atomic approval service.
- Display actual video thumbnails, previews, captions, comments, and destinations.
- Allow approve, reject, and request-changes actions through the shared service.
- Synchronize the existing Discord review message after either interface acts.

### Phase 3: safe scheduling and connection guidance

- Add validated schedule commands that update the current channel configuration source.
- Generate setup guidance from real provider adapters.
- Verify new connections before showing them as active.

### Phase 4: deeper lead workflow, jobs, and infrastructure

- Add detailed qualification and outreach views after the bounded read-only lead overview is proven useful.
- Build a shared job registry over existing schedules and receipts.
- Add safe pause, resume, and retry commands with idempotent claims.

### Phase 5: external business modules

- Integrate the separate e-commerce repository through a versioned read API or synchronization contract.
- Add the external e-commerce module through a versioned read API or synchronization contract.

## Recovery

- Stopping or restarting the dashboard does not stop Discord or any ORION worker.
- In-memory dashboard sessions are invalidated on restart.
- The dashboard stores no workflow records of its own in phase 1.
- If a source is unavailable, its section reports unavailable while other sources continue rendering.
- Database requests are bounded and cached; the single administrator can force one refresh when needed.
