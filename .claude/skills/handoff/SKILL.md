---
name: handoff
description: End-of-session handoff. Commits and pushes any dirty work so the tree is clean, then writes docs/HANDOFF.md — a dense, current snapshot of everything a fresh chat needs to continue without re-exploring the repo. Use when a chat is getting long/expensive and you want to continue in a new one cheaply.
version: 1.0.0
triggers:
  - handoff
  - hand off
  - new chat
  - continue in a new chat
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Session Handoff

**Why this exists:** a long chat re-reads its own history on every turn, so a large prompt late in a session can start at 35%+ context before doing any work. Starting a fresh chat with one dense briefing is far cheaper than continuing an exhausted one. This skill produces that briefing.

## Do these in order

### 1. Leave the repo clean

The next chat must not inherit a messy tree.

```bash
git status --short
git fetch origin && git rev-list --left-right --count HEAD...origin/main
```

- If there are **real changes** (not just runtime churn), commit them in coherent, logically-grouped commits with descriptive messages — never one giant "wip" dump. Run the relevant tests first.
- If `origin/main` has moved, fetch/merge and resolve conflicts carefully, then re-run tests. **Another AI agent works in this repo on its own branch — always check for drift.**
- Push. Confirm `git status --short` is empty and the ahead/behind count is `0 0`.
- If something genuinely shouldn't be committed, say so explicitly rather than silently leaving it dirty.

### 2. Write `docs/HANDOFF.md`

Gitignored and temporary by design — it's a point-in-time snapshot, worthless once stale.

Gather **live** facts rather than trusting memory (schedules, counts, recent commits, current state) — a handoff with wrong numbers is worse than none. Then write these sections:

1. **How to use / delete** — paste into the new chat; `rm docs/HANDOFF.md` after; regenerate with `/handoff`. State the commit SHA and that the tree is clean.
2. **What the project is** — the business context, not just the code.
3. **The pipeline / architecture** — an ASCII flow beats paragraphs.
4. **Key files table** — path → purpose, so the new chat doesn't have to search.
5. **Schedules** — launchd jobs, when they run, what they do.
6. **Discord channels** — and which config is gitignored / operator-only.
7. **How the operator works** — their standards, preferences, and what they've pushed back on. *This is the highest-value section and the easiest to lose.*
8. **Hard-won gotchas** — the bugs that cost real debugging time, so they aren't rediscovered.
9. **Current state** — real numbers, what's verified working, what's pending.
10. **Open / next** — immediate next actions.
11. **Vault pointers** — where the durable long-form memory lives.

**Style:** dense and specific. Tables and short bullets, not prose. Include exact paths, flags, job names, and numbers. Omit anything the new chat can trivially rediscover; include everything that took this session real effort to learn. **Never include secrets** (tokens, keys, `.env` contents) — channel IDs and env *var names* are fine.

### 3. Update the vault, then report

Fold anything durable from this session into `~/Vault/Jacobs-2/` (the handoff file is disposable; the vault is not). Then tell the operator: the tree is clean and pushed, where the file is, that they should paste its contents into a new chat, and that they can delete it afterward.

## Rules

- Never commit `docs/HANDOFF.md` (it's gitignored — keep it that way).
- Never fabricate state — if a number can't be verified, say so instead of guessing.
- Regenerating overwrites the previous handoff; that's intended.
