# O.R.I.O.N. Developer Agent

The developer-agent workflow turns an explicitly approved Discord task into an isolated GitHub issue-to-draft-PR lifecycle.

## Operator Entry Points

- Discord text: `create issue for developer: <objective>`
- Discord slash command: `/create-developer-issue objective:<objective>`
- Monitoring adapter: emit the same structured task with `runtime_action=developer_agent_workflow` and preserve the alert as the objective/source context.

Every entry point must enter the normal task queue and approval flow. Monitoring alerts must not invoke Claude or write to GitHub directly. They should create an approval request first so failures cannot cause issue spam or consume Claude quota silently.

## Lifecycle

1. O.R.I.O.N. creates an approval-gated developer task.
2. After approval, the workflow validates GitHub CLI authentication.
3. It creates a structured GitHub issue from the task and attachments.
4. It fetches current `origin/main` and creates an isolated `agent/*` branch and worktree.
5. Claude receives the issue, task context, and isolated worktree path. Claude may edit and test, but may not commit, push, open PRs, or merge.
6. Deterministic code validates the changes, creates a Conventional Commit, rebases safely when needed, runs repository guards, and pushes the branch.
7. It opens a draft PR linked to the issue and posts the result to `#github`.
8. GitHub Actions reports source and target branches plus CI state to `#ci`.
9. Successful Runtime Validation creates a second, commit-specific approval request in `#pull-requests`.
10. Approving that request revalidates the PR head and all live checks, marks the draft ready, and merges it. Rejecting leaves the draft open.

## Configuration

Configure these only in the Mac runtime environment:

```dotenv
DEVELOPER_AGENT_ENABLED=true
DEVELOPER_AGENT_REMOTE=origin
DEVELOPER_AGENT_BASE_BRANCH=main
DEVELOPER_AGENT_SOURCE_BRANCH_PREFIX=agent/
DEVELOPER_AGENT_MERGE_ON_APPROVAL=true
DEVELOPER_AGENT_MERGE_METHOD=squash
DEVELOPER_AGENT_WORKTREES_PATH=/Users/Agent/.ruflo/runtime/developer-worktrees
DEVELOPER_AGENT_STATE_PATH=/Users/Agent/.ruflo/runtime/developer-agent
DISCORD_CI_CHANNEL_ID=1527300397423792281
DISCORD_PULL_REQUESTS_CHANNEL_ID=1529090227627495517
```

The paths are optional. By default they resolve under the existing Ruflo runtime temporary directory.

## Safety And Recovery

- Approval is checked again inside the workflow before any Claude or GitHub write.
- Commands use argument arrays with `shell: false`; task text is not interpolated into a shell command.
- Per-task state is written atomically so blocked Claude runs can be retried.
- A per-task lock prevents duplicate concurrent execution.
- Work begins from the latest fetched base branch and refuses conflicted rebases.
- The workflow always opens a draft PR first and never merges without a separate, explicit Discord approval.
- Merge approval is bound to the PR number and CI-tested head SHA; a later push invalidates that approval.
- The merge executor accepts only the configured base branch and `agent/*` source branches, rechecks live CI, and never uses an administrator bypass.
- Secrets, Conventional Commit format, script size, tests, and whitespace are validated before push.
