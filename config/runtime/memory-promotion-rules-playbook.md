# Ruflo Memory Promotion Rules

## Purpose

Define exactly what should be promoted from runtime activity into Ruflo memory namespaces and what should stay out.

## Core Rule

Promotion should be selective.

The system should store compact reusable signal, not raw chat, raw transcripts, or every intermediate event.

## Namespace Rules

### `patterns`

Promote when:

- execution succeeded and the same approach is likely reusable
- a failure exposed a durable gotcha
- an older pattern had to be revised because it went stale

Keep out:

- raw commands
- raw transcripts
- temporary planning chatter

### `learnings`

Promote when:

- an observation changed the likely next step
- a session produced a hypothesis worth validating later

Keep out:

- duplicate observations
- confusion that never changed an action

### `results`

Promote when:

- a task completed with a meaningful output
- a normalized task or result must survive a pause, handoff, or audit

Keep out:

- every intermediate state change
- heartbeat noise

### `decisions`

Promote when:

- an architecture or policy decision changed the allowed operating path
- a constraint was explicitly accepted or rejected

Keep out:

- speculation that never became a decision

### `approvals`

Promote when:

- a human approval or rejection was explicitly recorded
- the approval scope or rationale changed future policy

Keep out:

- pending approval requests without an outcome
- raw back-and-forth that did not change the result

### `products`

Promote when:

- a sellable offer, delivery rule, or durable product fact became clear

Keep out:

- draft copy fragments still under exploration

### `infra`

Promote when:

- a host, runtime, path, restart, or recovery rule was verified
- a service behavior matters for future recovery or deployment

Keep out:

- one-off debug output without a durable operating consequence

## Review Rule

Use review before promotion for:

- `patterns`
- `learnings`
- `decisions`
- `products`

Direct promotion is acceptable for:

- `results`
- `approvals`
- `infra`

But even direct-promotion namespaces should still avoid raw noise.

## Checkpoint Rule

Checkpoint payloads are not automatically long-term memory.

They are first-class runtime state for:

- pause and resume
- provider-limit handoff
- reboot recovery

Only promote checkpoint content into long-term namespaces after result inspection confirms durable value.

## Freshness Windows (Codified)

Each namespace has a review window and a stale window, defined in `config/runtime/memory-promotion-rules.json`.

| Namespace | Review after | Stale after | Review required |
|-----------|--------------|-------------|-----------------|
| `patterns` | 14 days | 60 days | yes |
| `learnings` | 7 days | 21 days | yes |
| `results` | 0 (audit only) | 0 (retain) | no |
| `decisions` | 30 days | 180 days | yes |
| `approvals` | 0 (audit only) | 30 days | no |
| `products` | 30 days | 120 days | yes |
| `infra` | 14 days | 60 days | no |

Change these windows in `config/runtime/memory-promotion-rules.json` and rerun the verifier so the playbook and config stay aligned.

## Verifier

Run the verifier to catch drift between:

- `config/runtime/memory-namespaces.json`
- `config/runtime/memory-promotion-rules.json`
- this playbook (`Ruflo_Memory_Promotion_Rules.md`)

```bash
npm run memory:verify-promotion-rules
```

The verifier fails if:

- a namespace is defined in one surface but missing in another
- a namespace has empty `promote_when` / `do_not_promote` / `freshness_rule` / `capture_mode`
- `review_after_days` or `stale_after_days` is negative or invalid
- the default candidate policy is missing a `status`

It warns (but does not fail) when `review_after_days > stale_after_days` for a namespace, because review should trigger before staleness.

## Related Files

- `config/runtime/memory-namespaces.json`
- `config/runtime/memory-promotion-rules.json`
- `scripts/verify-memory-promotion-rules.mjs`
- `scripts/session-checkpoint.mjs`
- `scripts/session-pre-limit-checkpoint.mjs`
- [[05_Playbooks/Ruflo_Session_Loop_Playbook]]
- [[02_Projects/Ruflo_Integration]]
