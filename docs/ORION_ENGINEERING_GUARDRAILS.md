# ORION Engineering Guardrails

## Purpose

This is the default design gate for ORION changes, GitHub issues, implementation plans, and architecture reviews. It keeps new work compatible with the running system instead of solving one feature in isolation.

An LLM working on ORION must read this document before it proposes an issue or changes production behavior. It must distinguish between:

- behavior that exists now;
- the smallest valuable next slice;
- later improvements that should not inflate the current issue.

When a requirement conflicts with a guardrail, the issue must state the conflict and justify the exception explicitly.

## System boundaries

| Concern | Default authority |
| --- | --- |
| Execution | Mac mini ORION server |
| Large artifacts and local models | Samsung T7 |
| Durable compact workflow state | Supabase |
| Human communication and approvals | Discord |
| Source code, review, and issue history | GitHub |
| Local reasoning and media generation | Ollama and local model services |
| Marketplace or platform state | The external platform, verified by readback |

The Windows laptop is an operator terminal. Do not design production workers that depend on it remaining online.

Discord is the primary communication surface, not the canonical database. The dashboard is a visual interface, not a second orchestrator. Both must call shared application services and read the same durable state.

## 1. Supabase egress and query discipline

Supabase is for compact coordination data, hashes, decisions, schedules, receipts, and operational state. It is not ORION's large-file archive or analytics warehouse.

Recurring jobs must:

- select only the columns they use; never use `select=*` by habit;
- use count or header-only requests when only a count is required;
- fetch lightweight candidate IDs first and hydrate only the selected records;
- bound every list by account, status, time window, cursor, and sensible row limit;
- use incremental high-water marks instead of repeatedly downloading full history;
- keep rebuildable historical caches on the Mac or T7;
- use `Prefer: return=minimal` when a write result is not consumed;
- avoid large repeated JSON blobs when normalized fields or a T7 receipt suffice;
- share snapshots instead of letting each widget or job perform the same query;
- avoid new always-running pollers when an event, scheduled pass, or bounded retry can do the job.

Supabase Storage/CDN caching does not reduce PostgREST database egress. App-side incremental caching is the meaningful optimization for repeated database reads.

Every new recurring data path must document:

```text
job or service
table or bucket
selected columns
maximum rows per run
run frequency
cache and invalidation behavior
estimated response bytes per run
estimated monthly egress
retention and pruning behavior
```

Use the local egress ledger to attribute actual response bytes by job, table, operation, rows, and timestamp. Optimize measured heavy paths instead of guessing. An optimization must preserve valuable durable data; reducing repeated reads is preferred over deleting history.

## 2. Storage placement and recovery

Use the T7 for:

- local model bundles;
- generated video, image, animation, and buyer-package files;
- canonical digital-asset products and immutable releases;
- raw research evidence and long-term analytical archives;
- large receipts, previews, and reproducible intermediate artifacts worth retaining.

Use the Mac internal disk for:

- the active repository and installed applications;
- environments, launch configuration, and small working state;
- bounded temporary scratch data;
- caches that are safe to rebuild.

Use Supabase for compact metadata and coordination, not duplicate media payloads already on the T7.

Large writes must be atomic or resumable. Before deleting a source copy, verify the T7 copy by size and SHA-256. If the T7 is absent, heavy model, generation, or archive work must defer safely rather than silently filling the Mac disk.

The T7 improves recovery but remains one physical device and therefore one point of failure. Commercially important products eventually need a second independent backup.

## 3. Dynamic configuration instead of hardcoding

New channels, templates, products, marketplaces, asset kinds, and schedules should be discovered through registries or versioned configuration.

Avoid code tied to one current example such as ProffMon, Neon Plasma Armory, one Discord channel ID, or one fixed number of covers. Product-specific fixtures are allowed only when clearly labelled and explicitly selected.

Prefer this pattern:

```text
stable kind or capability
        -> versioned policy or recipe
        -> shared engine
        -> product/channel-specific durable state
```

Adding a new configured channel or supported asset kind should normally require configuration or a reusable recipe, not a copied worker.

## 4. Durable jobs, queues, and idempotency

Any action that can outlive a Discord interaction or process must be a durable job.

Required properties:

- stable idempotency key;
- explicit states such as queued, running, retry, review, completed, and failed;
- atomic claim token and claim timestamp;
- stale-claim recovery after a restart;
- bounded retry with backoff and a terminal review state;
- exact input manifest or revision binding;
- persisted receipts at irreversible boundaries;
- safe resume that reuses already validated work;
- reconciliation before retry when an external write outcome is ambiguous.

Multiple approvals or schedules may arrive together. Resource-intensive work must use the shared queue and runtime resource locks rather than spawning competing Ollama, rendering, deployment, or T7-heavy work.

Never perform long work inside the Discord interaction callback. Acknowledge quickly, enqueue durably, and update the existing message as progress changes.

## 5. Human approvals and stale-action safety

Keep different authorities separate:

- creative or asset approval;
- package approval;
- theme approval;
- marketplace setup authorization;
- distribution or publication approval.

Approval of one stage must not imply another. Publication remains a distinct human gate unless the user explicitly changes that policy.

Every decision must bind to the exact product, release, manifest hash, listing hash where applicable, reviewer, interaction, and timestamp. Reject stale buttons when their reviewed manifest no longer matches, but provide a reconciliation path that updates the existing Discord message rather than creating duplicate review surfaces.

## 6. Discord and dashboard behavior

Discord is ORION's main human communication layer. Important autonomous work should be visible there with:

- current state;
- progress such as **completed/total**;
- elapsed time for long work;
- actionable error and recovery guidance;
- links to verified external drafts or pages;
- one current message updated in place where practical.

Persist decisions outside Discord. A Discord message ID is a reference, not the decision itself.

Dashboard work must remain bounded and cached. It must not introduce independent polling, duplicate approval state, or another scheduler. Stopping the dashboard must not stop ORION workers.

## 7. Scheduling and shared resources

Schedule quick jobs before resource-intensive jobs. Avoid overlapping:

- image generation;
- video rendering;
- Ollama inference;
- lead qualification;
- deployment or repository synchronization;
- T7 maintenance or large transfers.

Use a bounded execution window and safe deferral when a resource is busy. Retry later or skip a low-quality run instead of forcing concurrency that damages results.

Scheduled external reconciliation should tolerate propagation delay. Use a small number of idempotent follow-up passes rather than one fragile exact-time check or a permanent high-frequency poller.

## 8. External APIs and platform mutation

Before adding an integration, document its authentication, quota, supported operations, unsupported operations, rate limits, and readback method.

For writes:

1. bind the request to an approved immutable input;
2. record intent before the remote call;
3. persist the remote identifier immediately after success;
4. read the result back from the platform;
5. verify important fields;
6. reconcile ambiguous timeouts before retrying;
7. alert with a concrete recovery command when authorization expires.

Do not claim an API can do something that requires authenticated browser automation. Browser automation must remain draft-first, narrowly scoped, visually verified, and unable to publish without the publication gate.

## 9. Local-model responsibilities

Local models may propose research recommendations, listing copy, themes, image plans, and animation recipes. Deterministic code must enforce schemas, file dimensions, alpha rules, anchors, hashes, completeness, and marketplace packaging.

Do not rely on a model to remember operational rules. Put stable rules in versioned policy, recipe, schema, or validation code. Keep rollback models temporarily when promoting a new model, and benchmark quality, reliability, duration, and memory use before removal.

## 10. Database migrations

Create a migration only when persistent schema, indexes, functions, constraints, grants, or row-level security must change.

A new product, asset, channel, recommendation, or job instance must use existing generic rows and must not require a migration. Migrations should be additive where practical, idempotent, reviewed for existing-table impact, and accompanied by runtime compatibility tests.

## 11. Security and privacy

- Never commit `.env` files, credentials, cookies, OAuth tokens, secret draft URLs, or recovery secrets.
- Keep service keys server-side and use the least privilege supported by the current design.
- Redact sensitive query strings and configuration from logs, Discord, dashboards, and receipts.
- Validate external paths, slugs, IDs, and user-entered feedback.
- Fail closed for publication, payment, deletion, and ambiguous external mutations.
- Keep public previews protected; clean transparent buyer assets belong only in the package.

## 12. Repository and operational hygiene

- Start from current `main` unless an active task explicitly requires another branch.
- Preserve unrelated user changes and never overwrite a dirty worktree.
- Keep modules below roughly 500-700 lines where practical.
- Use Conventional Commits and focused pull requests.
- Remove clean merged temporary worktrees; inspect dirty worktrees before any deletion.
- Do not commit generated media, model files, runtime caches, logs, or secrets.
- Update operational documentation when behavior, schedules, recovery, or ownership changes.

## Issue-creation procedure for an LLM

Before creating an ORION issue:

1. Inspect the current implementation, relevant docs, open issues, and recent merged work.
2. Confirm the behavior is not already implemented or covered by a broader active issue.
3. State the user-visible problem and why it is valuable now.
4. Identify authoritative state and every affected integration.
5. Estimate recurring Supabase, platform-quota, CPU/GPU, disk, and schedule impact.
6. Define idempotency, retry, restart recovery, observability, and human approval boundaries.
7. Explain how the design remains dynamic for future channels, products, templates, or marketplaces.
8. Separate the smallest useful implementation slice from later enhancements.
9. Keep issue count low: prefer one cohesive issue with explicit phases over many speculative child issues.
10. Add measurable acceptance criteria and a safe rollout/rollback plan.

Every implementation issue should answer:

```text
What user-visible outcome changes?
What is authoritative state?
What is stored on Supabase, Mac, and T7?
What recurring queries or API calls are added?
What is the worst-case monthly egress or quota cost?
What happens on retry, restart, duplicate approval, or timeout?
Which action still needs human approval?
How is success visible in Discord?
How does a new channel/product/template inherit the behavior?
How is the change tested, deployed, verified, and rolled back?
```

## Definition of ready

An issue is ready for implementation only when:

- its scope and non-goals are explicit;
- existing system behavior is cited accurately;
- storage and authoritative-state choices are defined;
- egress and resource impact are bounded;
- queue, retry, and idempotency behavior are defined where needed;
- approval and publication boundaries are unambiguous;
- secrets and destructive actions are addressed;
- acceptance criteria test user-visible behavior;
- deployment and production verification steps exist.

If these answers are unknown, the next task is investigation, not implementation.
