import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  buildExecutionPlan,
  buildExecutionStartedEvents,
  executeTask,
  parseLaunchctlReport,
} from '../src/executor.mjs';

test('buildExecutionPlan recognizes Ruflo daemon health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check the current Ruflo daemon health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'ruflo_daemon_health_check',
    description: 'Check Ruflo daemon health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Discord bot runtime health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check the current Discord bot health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'discord_bot_runtime_health_check',
    description: 'Check Discord bot runtime health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Tailscale health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check the current Tailscale health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'tailscale_health_check',
    description: 'Check Tailscale network status on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Docker and Colima health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check Docker and Colima health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'docker_colima_health_check',
    description: 'Check Docker and Colima runtime health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Ollama health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check Ollama health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'ollama_health_check',
    description: 'Check Ollama runtime health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes disk space health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check disk space on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'disk_space_health_check',
    description: 'Check disk space on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes GitHub auth health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current GitHub auth health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'github_auth_health_check',
    description: 'Check GitHub CLI authentication health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes Claude runtime health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current Claude runtime health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'claude_runtime_health_check',
    description: 'Check Claude CLI runtime health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes safe Mac sync requests', () => {
  const plan = buildExecutionPlan({
    full_text: 'Sync the Mac runtime with the latest changes from origin/main.',
  });

  assert.deepEqual(plan, {
    action: 'mac_runtime_safe_sync',
    description: 'Run the safe Mac sync workflow for the live runtime.',
  });
});

test('buildExecutionPlan recognizes GitHub-worded safe sync requests', () => {
  const plan = buildExecutionPlan({
    full_text: 'Sync GitHub workflow changes to the Mac runtime.',
  });

  assert.deepEqual(plan, {
    action: 'mac_runtime_safe_sync',
    description: 'Run the safe Mac sync workflow for the live runtime.',
  });
});

test('buildExecutionPlan recognizes freer Mac repo update requests', () => {
  const plan = buildExecutionPlan({
    full_text: 'Can you get the new changes onto the Mac mini repo so it is up to date?',
  });

  assert.deepEqual(plan, {
    action: 'mac_runtime_safe_sync',
    description: 'Run the safe Mac sync workflow for the live runtime.',
  });
});

test('buildExecutionPlan recognizes launch agents health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current launch agents health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'launch_agents_health_check',
    description: 'Check the required LaunchAgents on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes session checkpoint health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current session checkpoint health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'session_checkpoint_health_check',
    description: 'Check session checkpoint files on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes runtime logs health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current runtime logs health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'runtime_logs_health_check',
    description: 'Check runtime logs health on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes disk-heavy folders checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current disk-heavy folders on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'disk_heavy_folders_check',
    description: 'Inspect the heaviest runtime folders on the Mac runtime.',
  });
});

test('buildExecutionPlan recognizes memory bridge sync health checks', () => {
  const plan = buildExecutionPlan({
    full_text: 'Check current memory/bridge sync health on the Mac mini.',
  });

  assert.deepEqual(plan, {
    action: 'memory_bridge_sync_health_check',
    description: 'Check vault bridge export health on the Mac runtime.',
  });
});

test('buildExecutionPlan prefers explicit Gmail runtime actions over text heuristics', () => {
  const plan = buildExecutionPlan({
    runtime_action: 'gmail_create_draft',
    full_text: 'draft email to vbjtechservices@gmail.com subject: Smoke test body: Hello',
  });

  assert.deepEqual(plan, {
    action: 'gmail_create_draft',
    description: 'Create a Gmail draft and hold it for explicit send approval.',
  });
});

test('parseLaunchctlReport extracts daemon state fields', () => {
  const report = parseLaunchctlReport(`
gui/502/io.ruv.ruflo.daemon = {
  active count = 0
  state = not running
  stdout path = /tmp/out.log
  stderr path = /tmp/err.log
  runs = 7
  last exit code = 0
}
`);

  assert.equal(report.state, 'not running');
  assert.equal(report.activeCount, 0);
  assert.equal(report.lastExitCode, 0);
  assert.equal(report.runs, 7);
  assert.equal(report.stdoutPath, '/tmp/out.log');
  assert.equal(report.stderrPath, '/tmp/err.log');
});

test('buildExecutionStartedEvents marks task as running', () => {
  const events = buildExecutionStartedEvents(
    { task_id: 'TASK-123' },
    { action: 'ruflo_daemon_health_check' }
  );

  assert.equal(events[0].channelKey, 'taskQueue');
  assert.equal(events[0].metadata.status, 'running');
  assert.equal(events[1].channelKey, 'systemLogs');
});

test('executeTask returns completed events for daemon health checks', async () => {
  const config = loadRuntimeConfig();
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });

    if (command === 'id') {
      return { code: 0, stdout: '502\n', stderr: '' };
    }

    return {
      code: 0,
      stdout: `
gui/502/io.ruv.ruflo.daemon = {
  active count = 1
  state = running
  stdout path = /tmp/out.log
  stderr path = /tmp/err.log
  runs = 12
  last exit code = 0
}
`,
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-123',
    full_text: 'Check the current Ruflo daemon health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionPlan.action, 'ruflo_daemon_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.outboundEvents[0].channelKey, 'taskQueue');
  assert.equal(result.outboundEvents[1].channelKey, 'agentResults');
  assert.equal(calls[0].command, 'id');
  assert.equal(calls[1].command, 'launchctl');
});

test('executeTask returns completed events for Discord bot runtime health checks', async () => {
  const config = loadRuntimeConfig();
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });
    return {
      code: 0,
      stdout: [
        '12340 npm run discord:live',
        '12345 node services/discord-bot/index.mjs --live',
      ].join('\n'),
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-456',
    full_text: 'Check the current Discord bot health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionPlan.action, 'discord_bot_runtime_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.executionResult.report.processCount, 2);
  assert.equal(result.outboundEvents[1].channelKey, 'agentResults');
  assert.equal(result.outboundEvents[1].metadata.processCount, 2);
  assert.equal(calls[0].command, 'ps');
});

test('executeTask returns structured results for safe Mac sync requests', async () => {
  const config = loadRuntimeConfig();
  const calls = [];
  const payload = {
    summary: 'Local worktree is dirty, so automated pull is blocked. All 5 health checks are healthy.',
    dryRun: false,
    didPull: false,
    restartedDiscordBot: false,
    restartDiscordBotDeferred: false,
    restartedRufloWorkerService: false,
    syncState: {
      status: 'blocked_dirty',
      summary: 'Local worktree is dirty, so automated pull is blocked.',
      canPull: false,
      blocked: true,
    },
    gitState: {
      currentBranch: 'main',
      upstreamRef: 'origin/main',
      isClean: false,
      aheadCount: 0,
      behindCount: 0,
    },
    healthSummary: {
      totalChecks: 5,
      healthyCount: 5,
      unhealthyCount: 0,
      unhealthyChecks: [],
    },
    healthChecks: [],
  };

  const commandRunner = async (command, args) => {
    calls.push({ command, args });
    return {
      code: 2,
      stdout: JSON.stringify(payload),
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-SYNC',
    full_text: 'Sync the Mac runtime with the latest changes from origin/main.',
  }, config, { commandRunner });

  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionPlan.action, 'mac_runtime_safe_sync');
  assert.equal(result.executionResult.report.state, 'blocked_dirty');
  assert.equal(result.executionResult.report.severity, 'blocked');
  assert.equal(result.outboundEvents[0].metadata.status, 'blocked');
  assert.equal(result.outboundEvents[1].metadata.state, 'blocked_dirty');
  assert.equal(result.outboundEvents[1].metadata.didPull, false);
  assert.equal(result.executionResult.report.restartDiscordBotDeferred, false);
  assert.equal(result.outboundEvents[1].metadata.healthyCount, 5);
  assert.equal(result.outboundEvents.some((event) => event.type === 'task_execution_blocked' && event.channelKey === 'alerts'), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[0], /scripts[\\/]mac-sync-worker\.mjs$/u);
  assert.equal(calls[0].args[1], '--json');
  assert.equal(calls[0].args[2], '--no-post');
  assert.equal(calls[0].args[3], '--skip-discord-restart');
});

test('executeTask routes successful Mac sync apply results into deployments', async () => {
  const config = loadRuntimeConfig();
  const payload = {
    summary: 'Fast-forward pull applied and all 5 health checks are healthy.',
    dryRun: false,
    didPull: true,
    restartedDiscordBot: true,
    restartDiscordBotDeferred: false,
    restartedRufloWorkerService: false,
    syncState: {
      status: 'pulled',
      summary: 'Fast-forward pull applied.',
      canPull: true,
      blocked: false,
    },
    gitState: {
      currentBranch: 'main',
      upstreamRef: 'origin/main',
      isClean: true,
      aheadCount: 0,
      behindCount: 1,
    },
    healthSummary: {
      totalChecks: 5,
      healthyCount: 5,
      unhealthyCount: 0,
      unhealthyChecks: [],
    },
    healthChecks: [],
  };

  const result = await executeTask({
    task_id: 'TASK-SYNC-DEPLOY',
    full_text: 'Sync the Mac runtime with the latest changes from origin/main.',
  }, config, {
    commandRunner: async () => ({
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: '',
    }),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.outboundEvents[1].channelKey, 'deployments');
  assert.equal(result.outboundEvents[1].metadata.didPull, true);
});

test('executeTask creates a Gmail draft and emits a follow-up approval request', async () => {
  const config = loadRuntimeConfig();
  const fetchCalls = [];
  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push({ url, options });

    if (String(url).includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'token-123',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        id: 'draft-123',
        message: {
          id: 'message-123',
          threadId: 'thread-123',
        },
      }),
    };
  };

  const result = await executeTask({
    task_id: 'TASK-MAIL',
    runtime_action: 'gmail_create_draft',
    full_text: 'draft email to vbjtechservices@gmail.com subject: Smoke test body: Hello from O.R.I.O.N.',
    summary: 'Draft email to vbjtechservices@gmail.com: Smoke test',
    priority: 'normal',
    domain: 'sales',
    target_agent: 'orchestrator',
    submitted_by: 'VBJ Services',
    email_request: {
      to: 'vbjtechservices@gmail.com',
      subject: 'Smoke test',
      bodyText: 'Hello from O.R.I.O.N.',
    },
  }, {
    ...config,
    env: {
      ...config.env,
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
      GMAIL_SENDER_EMAIL: 'vbjtechservices@gmail.com',
    },
  }, { fetchImpl });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionResult.report.state, 'awaiting_approval');
  assert.equal(result.executionResult.report.pendingApprovalTask.runtime_action, 'gmail_send_draft');
  assert.equal(result.executionResult.report.pendingApprovalTask.gmail_draft.bodyText, 'Hello from O.R.I.O.N.');
  assert.equal(result.outboundEvents[1].metadata.emailBody, 'Hello from O.R.I.O.N.');
  assert.equal(result.outboundEvents.some((event) => event.type === 'approval_request' && event.channelKey === 'approvals'), true);
  assert.equal(fetchCalls.length, 2);
});

test('executeTask names the lead as a clickable link in the send-approval summary', async () => {
  const config = loadRuntimeConfig();
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'token-123', expires_in: 3600, token_type: 'Bearer' }),
      };
    }

    return {
      ok: true,
      json: async () => ({ id: 'draft-456', message: { id: 'message-456', threadId: 'thread-456' } }),
    };
  };

  const result = await executeTask({
    task_id: 'TASK-MAIL-LEAD',
    runtime_action: 'gmail_create_draft',
    full_text: 'draft email to lead@example.nl subject: Test body: Hello',
    priority: 'normal',
    domain: 'sales',
    target_agent: 'outreach-agent',
    submitted_by: 'lead-qualifier',
    email_request: { to: 'lead@example.nl', subject: 'Test', bodyText: 'Hello' },
    lead_id: 'lead-1',
    lead_business_name: 'Loodgieter Jansen',
    lead_source_url: 'https://loodgieterjansen.nl',
  }, {
    ...config,
    env: {
      ...config.env,
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
      GMAIL_SENDER_EMAIL: 'vbjtechservices@gmail.com',
    },
  }, { fetchImpl });

  assert.equal(result.outcome, 'completed');
  // Subject is intentionally omitted from the summary — the approval embed
  // shows it in its own Subject field, so repeating it here duplicated it.
  assert.equal(
    result.executionResult.report.pendingApprovalTask.summary,
    'Send drafted email to [Loodgieter Jansen](https://loodgieterjansen.nl) (lead@example.nl)'
  );
});

test('executeTask sends an approved Gmail draft', async () => {
  const config = loadRuntimeConfig();
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'token-123',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        id: 'sent-message-123',
        threadId: 'thread-123',
        labelIds: ['SENT'],
      }),
    };
  };

  const result = await executeTask({
    task_id: 'TASK-MAIL-SEND',
    runtime_action: 'gmail_send_draft',
    full_text: 'send the drafted email',
    summary: 'Send drafted email to vbjtechservices@gmail.com: Smoke test',
    gmail_draft: {
      draftId: 'draft-123',
      to: 'vbjtechservices@gmail.com',
      subject: 'Smoke test',
      bodyText: 'Hello from O.R.I.O.N.',
      bodyPreview: 'Hello from O.R.I.O.N.',
    },
  }, {
    ...config,
    env: {
      ...config.env,
      GMAIL_CLIENT_ID: 'client-id',
      GMAIL_CLIENT_SECRET: 'client-secret',
      GMAIL_REFRESH_TOKEN: 'refresh-token',
      GMAIL_SENDER_EMAIL: 'vbjtechservices@gmail.com',
    },
  }, { fetchImpl });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionResult.report.state, 'sent');
  assert.equal(result.outboundEvents[1].channelKey, 'agentResults');
  assert.equal(result.outboundEvents[1].metadata.gmailDraftId, 'draft-123');
  assert.equal(result.outboundEvents[1].metadata.emailBody, 'Hello from O.R.I.O.N.');
});

test('buildExecutionPlan recognizes explicit developer-agent workflows', () => {
  const plan = buildExecutionPlan({
    runtime_action: 'developer_agent_workflow',
    developer_request: {
      objective: 'Fix the CI branch labels and add regression tests.',
    },
  });

  assert.deepEqual(plan, {
    action: 'developer_agent_workflow',
    description: 'Create an issue and run the approved developer task in an isolated Git worktree.',
  });
});

test('buildExecutionPlan recognizes approved GitHub pull request merges', () => {
  const plan = buildExecutionPlan({
    runtime_action: 'github_merge_pull_request',
    github_merge_request: {
      pullRequestNumber: 42,
    },
  });

  assert.deepEqual(plan, {
    action: 'github_merge_pull_request',
    description: 'Revalidate and merge the CI-green pull request after explicit operator approval.',
  });
});

test('executeTask publishes an approved pull request merge result to GitHub', async () => {
  const config = loadRuntimeConfig();
  const result = await executeTask({
    task_id: 'TASK-PR-MERGE-42-1234567890AB',
    runtime_action: 'github_merge_pull_request',
    approval_required: true,
    approval_state: 'approved',
    github_merge_request: {
      pullRequestNumber: 42,
    },
  }, config, {
    pullRequestMergeWorkflow: async () => ({
      report: {
        state: 'merged',
        severity: 'healthy',
        summary: 'Merged PR #42 into main.',
        pullRequestUrl: 'https://github.com/OfficialLachkid/ruflo/pull/42',
        pullRequestNumber: 42,
        branch: 'agent/task-42-fix-runtime',
        baseBranch: 'main',
        commitSha: '1234567890abcdef',
        mergeMethod: 'squash',
        merged: true,
      },
    }),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.outboundEvents[1].channelKey, 'github');
  assert.equal(result.outboundEvents[1].metadata.pullRequestNumber, 42);
  assert.equal(result.outboundEvents[1].metadata.merged, true);
});

test('executeTask returns completed events for Tailscale health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async (command, args) => {
    if (command === 'ps') {
      return {
        code: 0,
        stdout: '894 /Library/SystemExtensions/uuid/io.tailscale.ipn.macsys.network-extension.systemextension/Contents/MacOS/io.tailscale.ipn.macsys.network-extension\n',
        stderr: '',
      };
    }

    if (command === 'scutil' && args[0] === '--nwi') {
      return {
        code: 0,
        stdout: 'Network information\n\nNetwork interfaces: en1 utun4\n',
        stderr: '',
      };
    }

    if (command === '/sbin/ifconfig') {
      return {
        code: 0,
        stdout: 'utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280\n\tinet 100.81.143.122 --> 100.81.143.122 netmask 0xffffffff\n\tinet6 fd7a:115c:a1e0::1737:8f7b prefixlen 48 \n',
        stderr: '',
      };
    }

    if (command === 'scutil' && args[0] === '--get') {
      return {
        code: 0,
        stdout: 'vbj-orchestrator-01\n',
        stderr: '',
      };
    }

    throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
  };

  const result = await executeTask({
    task_id: 'TASK-TS',
    full_text: 'Check the current Tailscale health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'tailscale_health_check');
  assert.equal(result.executionResult.report.backendState, 'Running');
  assert.equal(result.executionResult.report.tailscaleIps[0], '100.81.143.122');
  assert.equal(result.executionResult.report.interfaceName, 'utun4');
});

test('executeTask returns completed events for Docker and Colima health checks', async () => {
  const config = loadRuntimeConfig();
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });

    if (command === 'colima') {
      return {
        code: 0,
        stdout: '',
        stderr: 'time=\"2026-06-30T17:29:58+02:00\" level=info msg=\"colima is running using macOS Virtualization.Framework\"\n',
      };
    }

    if (args[0] === 'context') {
      return {
        code: 0,
        stdout: 'colima\n',
        stderr: '',
      };
    }

    return {
      code: 0,
      stdout: '"29.5.2"\n',
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-DOCKER',
    full_text: 'Check Docker and Colima health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'docker_colima_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.executionResult.report.colimaState, 'running');
  assert.equal(result.executionResult.report.dockerContext, 'colima');
  assert.equal(result.executionResult.report.dockerServerVersion, '29.5.2');
  assert.equal(calls[0].command, 'colima');
  assert.equal(calls[1].command, 'docker');
  assert.equal(calls[2].command, 'docker');
});

test('executeTask returns completed events for Ollama health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async () => ({
    code: 0,
    stdout: 'NAME ID SIZE PROCESSOR CONTEXT UNTIL\nllama3 123 4.7 GB 100% / 5m\n',
    stderr: '',
  });

  const result = await executeTask({
    task_id: 'TASK-OLLAMA',
    full_text: 'Check Ollama health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'ollama_health_check');
  assert.equal(result.executionResult.report.state, 'running');
  assert.equal(result.executionResult.report.activeModelCount, 1);
});

test('executeTask returns completed events for disk space health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async () => ({
    code: 0,
    stdout: 'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1 239362496 35323864 181487312 17% 426233 1814873120 0% /System/Volumes/Data\n',
    stderr: '',
  });

  const result = await executeTask({
    task_id: 'TASK-DISK',
    full_text: 'Check disk space on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'disk_space_health_check');
  assert.equal(result.executionResult.report.usePercent, '17%');
  assert.equal(result.executionResult.report.mountPoint, '/System/Volumes/Data');
});

test('executeTask returns completed events for GitHub auth health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async () => ({
    code: 0,
    stdout: 'github.com\n  ✓ Logged in to github.com account vbjservices (/Users/Agent/.config/gh/hosts.yml)\n  - Active account: true\n  - Git operations protocol: https\n',
    stderr: '',
  });

  const result = await executeTask({
    task_id: 'TASK-GH',
    full_text: 'Check current GitHub auth health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'github_auth_health_check');
  assert.equal(result.executionResult.report.state, 'authenticated');
  assert.equal(result.executionResult.report.account, 'vbjservices');
  assert.equal(result.executionResult.report.gitProtocol, 'https');
  assert.equal(result.outboundEvents[1].channelKey, 'github');
});

test('executeTask returns completed events for Claude runtime health checks', async () => {
  const config = loadRuntimeConfig();
  const tempRoot = mkdtempSync(join(tmpdir(), 'ruflo-claude-health-'));
  const commandRunner = async (_command, args) => {
    if (args[0] === '--version') {
      return {
        code: 0,
        stdout: '2.1.206 (Claude Code)\n',
        stderr: '',
      };
    }

    return {
      code: 0,
      stdout: JSON.stringify({
        loggedIn: false,
        authMethod: 'none',
        apiProvider: 'firstParty',
      }),
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-CLAUDE-HEALTH',
    full_text: 'Check current Claude runtime health on the Mac mini.',
  }, {
    ...config,
    runtimePaths: {
      ...config.runtimePaths,
      tmpDir: tempRoot,
    },
    claude: {
      ...config.claude,
      workingDirectory: tempRoot,
    },
  }, { commandRunner });

  assert.equal(result.executionPlan.action, 'claude_runtime_health_check');
  assert.equal(result.executionResult.report.state, 'auth_required');
  assert.equal(result.executionResult.report.loggedIn, false);
  assert.equal(result.executionResult.report.taskArtifactWritable, true);
  assert.equal(result.outboundEvents[1].channelKey, 'agentResults');
});

test('executeTask returns completed events for launch agents health checks', async () => {
  const config = loadRuntimeConfig();
  const commandRunner = async (command, args) => {
    if (command === 'id') {
      return { code: 0, stdout: '502\n', stderr: '' };
    }

    const label = args[1].split('/').at(-1);
    if (label === 'io.ruv.ruflo.health-monitor') {
      return { code: 1, stdout: '', stderr: 'service not found' };
    }

    return {
      code: 0,
      stdout: `
gui/502/${label} = {
  active count = 0
  state = not running
  runs = 4
  last exit code = 0
}
`,
      stderr: '',
    };
  };

  const result = await executeTask({
    task_id: 'TASK-LAUNCH',
    full_text: 'Check current launch agents health on the Mac mini.',
  }, config, { commandRunner });

  assert.equal(result.executionPlan.action, 'launch_agents_health_check');
  assert.equal(result.executionResult.report.presentCount, 3);
  assert.equal(result.executionResult.report.missingCount, 1);
  assert.equal(result.outboundEvents[1].metadata.checkedAgents.length, 4);
});

test('executeTask returns completed events for session checkpoint health checks', async () => {
  const config = loadRuntimeConfig();
  const tempRoot = mkdtempSync(join(tmpdir(), 'ruflo-checkpoints-'));
  const checkpointsRoot = join(tempRoot, 'session-checkpoints');
  const checkpointRoot = join(checkpointsRoot, 'claude-agent');
  mkdirSync(checkpointRoot, { recursive: true });
  writeFileSync(join(checkpointRoot, 'latest.json'), JSON.stringify({
    sessionId: 'claude-agent',
    updatedAtUtc: '2026-07-01T10:00:00.000Z',
  }), 'utf8');

  const result = await executeTask({
    task_id: 'TASK-CHECKPOINT',
    full_text: 'Check current session checkpoint health on the Mac mini.',
  }, {
    ...config,
    env: {
      ...config.env,
      SESSION_CHECKPOINTS_PATH: checkpointsRoot,
    },
    runtimePaths: { ...config.runtimePaths },
  }, {
    commandRunner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });

  assert.equal(result.executionPlan.action, 'session_checkpoint_health_check');
  assert.equal(result.handled, true);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionResult.report.sessionCount, 1);
  assert.equal(result.executionResult.report.latestSessionId, 'claude-agent');
});

test('executeTask returns completed events for runtime logs health checks', async () => {
  const config = loadRuntimeConfig();
  const tempRoot = mkdtempSync(join(tmpdir(), 'ruflo-logs-'));
  writeFileSync(join(tempRoot, 'discord-bot.log'), 'ok\n', 'utf8');
  writeFileSync(join(tempRoot, 'health-monitor.log'), 'ok\n', 'utf8');

  const result = await executeTask({
    task_id: 'TASK-LOGS',
    full_text: 'Check current runtime logs health on the Mac mini.',
  }, {
    ...config,
    runtimePaths: {
      ...config.runtimePaths,
      logDir: tempRoot,
    },
  }, {
    commandRunner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });

  assert.equal(result.executionPlan.action, 'runtime_logs_health_check');
  assert.equal(result.executionResult.report.fileCount, 2);
  assert.equal(result.outboundEvents[1].metadata.fileCount, 2);
});

test('executeTask returns completed events for disk-heavy folders checks', async () => {
  const config = loadRuntimeConfig();
  const tempRoot = mkdtempSync(join(tmpdir(), 'ruflo-disk-heavy-'));
  const logsRoot = join(tempRoot, 'logs');
  const dataRoot = join(tempRoot, 'data');
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });

  const commandRunner = async (_command, args) => ({
    code: 0,
    stdout: args[1].includes('logs')
      ? `120\t${args[1]}\n`
      : `450\t${args[1]}\n`,
    stderr: '',
  });

  const result = await executeTask({
    task_id: 'TASK-DISK-HEAVY',
    full_text: 'Check current disk-heavy folders on the Mac mini.',
  }, {
    ...config,
    env: {
      ...config.env,
      HOME: tempRoot,
    },
    runtimePaths: {
      ...config.runtimePaths,
      logDir: logsRoot,
    },
  }, { commandRunner });

  assert.equal(result.executionPlan.action, 'disk_heavy_folders_check');
  assert.equal(result.executionResult.report.topFolders.length >= 2, true);
  assert.equal(result.outboundEvents[1].metadata.scannedPathsCount >= 2, true);
});

test('executeTask returns completed events for memory bridge sync health checks', async () => {
  const config = loadRuntimeConfig();
  const tempRoot = mkdtempSync(join(tmpdir(), 'ruflo-bridge-'));
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(join(tempRoot, 'manifest.json'), JSON.stringify([
    { name: 'ops.md', lastWriteTimeUtc: '2026-07-01T09:00:00.000Z' },
    { name: 'infra.md', lastWriteTimeUtc: '2026-07-01T10:00:00.000Z' },
  ]), 'utf8');

  const result = await executeTask({
    task_id: 'TASK-BRIDGE',
    full_text: 'Check current memory/bridge sync health on the Mac mini.',
  }, {
    ...config,
    env: {
      ...config.env,
      VAULT_BRIDGE_EXPORT_PATH: tempRoot,
    },
  }, {
    commandRunner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });

  assert.equal(result.executionPlan.action, 'memory_bridge_sync_health_check');
  assert.equal(result.executionResult.report.manifestEntries, 2);
  assert.equal(result.outboundEvents[1].channelKey, 'memoryUpdates');
  assert.equal(result.outboundEvents[1].metadata.manifestEntries, 2);
});

test('executeTask publishes completed developer-agent workflow metadata to GitHub', async () => {
  const config = loadRuntimeConfig();
  const result = await executeTask({
    task_id: 'TASK-DEVELOPER-1',
    runtime_action: 'developer_agent_workflow',
    approval_required: true,
    approval_state: 'approved',
    developer_request: {
      objective: 'Fix the CI branch labels and add regression tests.',
    },
  }, config, {
    developerAgentWorkflow: async () => ({
      report: {
        state: 'completed',
        severity: 'healthy',
        summary: 'Opened draft PR #18.',
        issueUrl: 'https://github.com/OfficialLachkid/ruflo/issues/17',
        issueNumber: 17,
        pullRequestUrl: 'https://github.com/OfficialLachkid/ruflo/pull/18',
        pullRequestNumber: 18,
        branch: 'agent/task-developer-1-fix-ci-labels',
        baseBranch: 'main',
        commitSha: '1234567890abcdef',
        files: ['scripts/ci/post-ci-discord-webhook.mjs'],
        nextSteps: ['Review CI, then approve promotion.'],
      },
    }),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.outboundEvents[1].channelKey, 'github');
  assert.equal(result.outboundEvents[1].metadata.issueNumber, 17);
  assert.equal(result.outboundEvents[1].metadata.pullRequestNumber, 18);
  assert.equal(result.outboundEvents[1].metadata.baseBranch, 'main');
});
