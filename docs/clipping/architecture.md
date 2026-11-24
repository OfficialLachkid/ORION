# ORION Clipping Engine architecture and roadmap

Status: Phase 1 foundation. No live discovery, media processing, publication, marketplace submission, schedule or deployed migration yet. GitHub issue [#315](https://github.com/OfficialLachkid/ORION/issues/315) remains the parent design record.

## Product boundary

The Clipping Engine is a separate ORION business path. It may reuse the shared durable job substrate, runtime resource locks, Discord review surfaces and publication services, but it does not make the Social Media Agent its orchestrator.

The intended flow is:

```text
authorized campaign intake
  -> hard eligibility and rights checks
  -> bounded local qualification
  -> accepted campaign revision
  -> source and media work (later phase)
  -> automated validation
  -> Discord content/publication approval
  -> shared publisher
  -> verified canonical post URL
  -> authorized marketplace submission or manual task
  -> bounded reconciliation and payout analytics
```

Content approval, publication approval and marketplace submission authorization are separate decisions. A Discord approval authorizes only its exact action and revision. It cannot grant source rights or override marketplace terms.

## Dynamic profiles

Workers consume marketplace, channel and search-profile registries. They must not contain GTA VI, a channel ID or a marketplace URL as business-logic constants.

The first profile is `gaming-gta-vi-pilot`, mapped to a disabled `gaming-pilot` channel. `podcast-proof-profile` is the second fixture proving the schema is category-agnostic. Future gaming, podcast, education and other channels are registry additions.

GTA VI is timely, but commercial rights are a hard blocker. A qualifying campaign must prove source licensing, underlying game/IP permission where required, commercial redistribution rights, music status, platform, territory and expiry. Muting licensed music reduces one copyright risk; it does not grant commercial use rights.

## Marketplace capability model

Each adapter declares discovery and submission separately:

- `manual`: ORION prepares a task and never claims automation succeeded;
- `authorized_api`: a documented API and permission evidence exist;
- `authorized_browser`: written/published permission exists for narrow browser automation;
- `public_feed`: the published feed explicitly permits the use;
- `prohibited`: current terms block the action.

Automated actions require current permission evidence plus an exact revision-bound approval. Browser automation must be draft-first, use a dedicated authenticated profile, persist intent before mutation, attempt once, read back the result, reconcile ambiguity before retry and expose a kill switch. The related-video YouTube Studio implementation is an engineering precedent, not cross-platform permission.

Current audit result:

| Adapter | Discovery | Submission |
| --- | --- | --- |
| Manual/authorized import | human-provided | manual |
| Content Rewards | manual until API/permission | manual |
| Vyro | prohibited automated access under current terms | manual |
| CLIPPING | prohibited automated access under current terms | manual |
| Clipiy | partnership/API candidate | unverified |

## Authoritative state and storage

| State/artifact | Authority and location |
| --- | --- |
| Source marketplace campaign, eligibility, payable views and payout | External marketplace; compact revision snapshots and receipts in Supabase |
| ORION job state, claims, approvals, hashes and coordination | Supabase |
| Raw briefs, terms evidence, licensed source media, transcripts, renders and detailed manifests | Samsung T7 under `/Volumes/T7/ORION/clipping` |
| Repository, environments, launch configuration and bounded scratch | Mac internal disk |
| Human review/approval conversation | Discord, with durable decision outside Discord |
| Published video ID/status/canonical URL | Publication platform, with compact immutable receipts in Supabase |

If the T7 is unavailable, heavy jobs wait durably. They do not spill onto the Mac disk. No destructive retention policy is enabled in Phase 1.

## Shared durable job substrate

`orion_jobs` is additive and generic. Clipping is its first consumer; existing isolated queues migrate only through later focused changes.

Required properties:

- stable namespace/idempotency key and immutable input revision;
- atomic bounded claim using `FOR UPDATE SKIP LOCKED`;
- claim token, worker ID, heartbeat and expiring lease;
- queued, running, resource-wait, review, retry and terminal states;
- bounded exponential retry and human review after exhaustion;
- stale-lease recovery from the last validated receipt;
- compact progress and artifact references rather than large payloads;
- one Discord message updated from durable state;
- reconciliation before retrying any ambiguous external write.

The migration is committed but is not applied until the PR is merged and the Mac-native deployment step is explicitly run.

## Silent failure and model health

The watchdog must alert and recover:

- expired leases;
- overdue heartbeats;
- queued jobs beyond their service window;
- resource waits whose retry time passed without a claim;
- retry exhaustion;
- dead or unreadable resource-lock owners;
- T7 unavailability;
- marketplace/publication deadlines at risk;
- Discord progress-update failure without losing canonical state.

Ollama inventory, loaded state and execution health are different. A model may remain loaded after a job. Readiness for work requires a reachable endpoint, the configured model installed and—where configured—a bounded inference smoke test. A row in `/api/ps` is never sufficient evidence by itself.

## Cost and capacity gate

Initial intake/qualification caps:

- 25 candidates per bounded run;
- at most two runs per day;
- one in-flight local inference job;
- Supabase egress target below 2 MiB/month, review required at 5 MiB/month;
- explicit compact projections and a hard row limit of 25;
- no continuous polling and no dashboard dependency.

Phase 1 has negligible GPU and media-disk load. Qualification uses the existing local text model under the shared Ollama lock. Later source/transcription/render phases require separate measured CPU/GPU, T7 and schedule budgets before activation.

| Resource | Expected pilot impact | Hard boundary |
| --- | --- | --- |
| Supabase | Compact campaign/job rows, claims, decisions and receipts; target under 2 MiB/month | Review/disable recurring intake at 5 MiB/month |
| Marketplace APIs | Zero until an adapter has documented authorization and quota | No browser/API calls from the foundation PR |
| Local model | At most one bounded 8B qualification request at a time | Shared Ollama lock, timeout and smoke test |
| CPU/GPU | Qualification only; no transcription, rendering or FLUX work in Phase 1 | Resource waits stay queued instead of competing |
| Mac disk | Repository plus bounded JSON/scratch only | No raw video; abort at the scratch ceiling |
| T7 | Brief/rights evidence after intake; no media in the foundation PR | Heavy work defers if `/Volumes/T7` is unavailable |
| Scheduling | None in the foundation PR; later intake is capped at two bounded runs/day | No continuous polling |

## Roadmap

1. **Foundation (this PR):** config/schema, capability gate, shared durable job migration, lifecycle/watchdog logic and tests.
2. **Authorized intake and Discord shortlist:** manual/export import, normalization, hard rights checks, bounded qualification and revision-bound campaign acceptance.
3. **One licensed source to reviewed clip:** T7 artifact layout, transcript/highlight/cut/render validation and revision loop.
4. **One-account publication pilot:** separate publication approval, shared publisher and public-state readback.
5. **Submission adapter:** partner/API or explicitly permitted browser adapter; otherwise manual task remains.
6. **Reconciliation and economics:** bounded eligible-view/payout snapshots and contribution margin.
7. **Scale only after proof:** additional channel profiles/categories and marketplaces through registries.

## Rollout and rollback

Foundation defaults to `enabled: false`. Applying the migration creates additive tables/functions and no schedule. The first live worker must run as a supervised canary for one accepted campaign revision. Disable the profile and unload its launch job to roll back behavior; durable jobs and receipts remain for audit. Database rollback should preserve rows and revoke worker access rather than drop tables during an incident.
