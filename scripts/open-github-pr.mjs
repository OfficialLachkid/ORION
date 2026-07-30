import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from './lib/ruflo-wrapper-utils.mjs';

const DEFAULT_FALLBACK_SSH_TARGET = process.env.GITHUB_PR_FALLBACK_SSH_TARGET || 'Agent@vbj-orchestrator-01.tail1e55f3.ts.net';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    input: options.input,
    env: options.env || process.env,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function runChecked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const details = `${result.stderr || result.stdout || 'No command output.'}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed (${result.status || 1}): ${details}`);
  }
  return result;
}

function parseRepoFromRemote(url) {
  const normalized = String(url || '').trim();
  const httpsMatch = /^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u.exec(normalized);
  if (httpsMatch) return httpsMatch[1];
  const sshMatch = /^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/u.exec(normalized);
  if (sshMatch) return sshMatch[1];
  throw new Error(`Could not derive GitHub repository from remote URL: ${normalized}`);
}

function readBody(options) {
  const bodyFile = getStringOption(options, 'body-file', '');
  if (bodyFile) {
    return readFileSync(bodyFile, 'utf8');
  }
  const body = getStringOption(options, 'body', '');
  return body || '';
}

function parseGitHubUrl(output) {
  const url = String(output || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .findLast((line) => /^https:\/\/github\.com\/.+\/pull\/\d+$/u.test(line));
  if (!url) {
    throw new Error('GitHub CLI did not return a pull request URL.');
  }
  return url;
}

function buildLocalGhArgs({ repo, base, head, title, draft, body }) {
  const args = ['pr', 'create', '--repo', repo, '--base', base, '--head', head, '--title', title];
  if (draft) {
    args.push('--draft');
  }
  if (body) {
    args.push('--body', body);
  } else {
    args.push('--fill');
  }
  return args;
}

function shQuote(value) {
  return `'${String(value).replace(/'/gu, `'\"'\"'`)}'`;
}

function buildRemoteGhCommand({ repo, base, head, title, draft, bodyPath }) {
  const parts = [
    'gh',
    'pr',
    'create',
    '--repo',
    shQuote(repo),
    '--base',
    shQuote(base),
    '--head',
    shQuote(head),
    '--title',
    shQuote(title),
  ];
  if (draft) {
    parts.push('--draft');
  }
  if (bodyPath) {
    parts.push('--body-file', shQuote(bodyPath));
  } else {
    parts.push('--fill');
  }
  return parts.join(' ');
}

function localGhReady() {
  let version;
  try {
    version = run('gh', ['--version']);
  } catch {
    return false;
  }
  if (version.status !== 0) {
    return false;
  }
  const auth = run('gh', ['auth', 'status', '--hostname', 'github.com']);
  return auth.status === 0;
}

function createPullRequestWithMacFallback({ repo, base, head, title, draft, body, sshTarget }) {
  const remoteBodyPath = `/tmp/ruflo-pr-body-${process.pid}.md`;
  if (body) {
    const command = `cat > ${shQuote(remoteBodyPath)} && ${buildRemoteGhCommand({
      repo,
      base,
      head,
      title,
      draft,
      bodyPath: remoteBodyPath,
    })} && rm -f ${shQuote(remoteBodyPath)}`;
    return runChecked('ssh', [sshTarget, command], { input: body });
  }

  return runChecked('ssh', [sshTarget, buildRemoteGhCommand({
    repo,
    base,
    head,
    title,
    draft,
    bodyPath: '',
  })]);
}

if (process.argv[1] && process.argv[1].endsWith('open-github-pr.mjs')) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node scripts/open-github-pr.mjs --title <title> [options]',
      '',
      'Options:',
      '  --title <title>               Pull request title',
      '  --body <text>                 Pull request body text',
      '  --body-file <path>            Pull request body file',
      '  --repo <owner/name>           Repository override. Default: derive from origin remote',
      '  --base <branch>               Base branch. Default: main',
      '  --head <branch>               Head branch. Default: current branch',
      '  --no-draft                    Create a ready-for-review PR instead of a draft',
      '  --fallback-ssh-target <ssh>   SSH target for remote gh fallback',
    ]);
    process.exit(0);
  }

  const title = getStringOption(options, 'title', '');
  if (!title) {
    throw new Error('A PR title is required.');
  }

  const remoteUrl = runChecked('git', ['remote', 'get-url', 'origin']).stdout.trim();
  const repo = getStringOption(options, 'repo', parseRepoFromRemote(remoteUrl));
  const base = getStringOption(options, 'base', 'main');
  const head = getStringOption(options, 'head', runChecked('git', ['branch', '--show-current']).stdout.trim());
  const draft = getBooleanOption(options, 'draft', true);
  const body = readBody(options);
  const sshTarget = getStringOption(options, 'fallback-ssh-target', DEFAULT_FALLBACK_SSH_TARGET);

  let result;
  let mode = 'local-gh';
  if (localGhReady()) {
    result = runChecked('gh', buildLocalGhArgs({ repo, base, head, title, draft, body }));
  } else {
    mode = 'mac-gh-fallback';
    result = createPullRequestWithMacFallback({ repo, base, head, title, draft, body, sshTarget });
  }

  const prUrl = parseGitHubUrl(result.stdout);
  printInfo(`Opened PR via ${mode}: ${prUrl}`);
}
