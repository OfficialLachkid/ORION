import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const scriptsDir = resolve(currentDir, '..');
export const projectRoot = resolve(scriptsDir, '..');
export const defaultCliPackage = process.env.RUFLO_CLI_PACKAGE || '@claude-flow/cli@latest';

export function parseArgs(argv = process.argv.slice(2)) {
  const options = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--') {
      options._.push(...argv.slice(index + 1));
      break;
    }

    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }

    if (token.startsWith('--no-')) {
      options[token.slice(5)] = false;
      continue;
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex !== -1) {
      const key = token.slice(2, equalsIndex);
      const value = token.slice(equalsIndex + 1);
      options[key] = coerceValue(value);
      continue;
    }

    const key = token.slice(2);
    const values = [];
    let lookaheadIndex = index + 1;

    while (lookaheadIndex < argv.length && !argv[lookaheadIndex].startsWith('--')) {
      values.push(argv[lookaheadIndex]);
      lookaheadIndex += 1;
    }

    if (values.length > 0) {
      options[key] = coerceValue(values.join(' '));
      index = lookaheadIndex - 1;
      continue;
    }

    options[key] = true;
  }

  return options;
}

function coerceValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export function getStringOption(options, key, fallback = undefined) {
  const value = options[key];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value);
}

export function getBooleanOption(options, key, fallback = false) {
  const value = options[key];
  if (value === undefined) return fallback;
  return value !== false;
}

export function printInfo(message) {
  console.log(`[info] ${message}`);
}

export function printWarn(message) {
  console.warn(`[warn] ${message}`);
}

export function printError(message) {
  console.error(`[error] ${message}`);
}

export function getNpxCommand() {
  const executableName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const siblingPath = resolve(dirname(process.execPath), executableName);
  return existsSync(siblingPath) ? siblingPath : executableName;
}

export function runCommand(command, args, options = {}) {
  const {
    cwd = projectRoot,
    stdio = 'inherit',
    allowFailure = false,
    env = process.env,
  } = options;

  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    throw new Error(formatCommandFailure(command, args, result));
  }

  return result;
}

export function runNpx(cliPackage, cliArgs, options = {}) {
  return runCommand(getNpxCommand(), [cliPackage, ...cliArgs], options);
}

function formatCommandFailure(command, args, result) {
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .trim();
  const commandText = [command, ...args].join(' ');
  if (!output) {
    return `Command failed (${result.status ?? 'unknown'}): ${commandText}`;
  }
  return `Command failed (${result.status ?? 'unknown'}): ${commandText}\n${output}`;
}

export function looksLikeMissingSession(output) {
  return /no previous sessions found|no sessions available|session .* not found|no session id provided/i.test(output);
}

export function looksLikeMissingMemoryDatabase(output) {
  return /database not (found|initialized)|run: .*memory init/i.test(output);
}

export function ensureDaemonRunning(cliPackage) {
  const statusResult = runNpx(
    cliPackage,
    ['daemon', 'status'],
    { cwd: projectRoot, stdio: 'pipe', allowFailure: true }
  );
  const statusOutput = [statusResult.stdout, statusResult.stderr].filter(Boolean).join('\n');

  if (/RUNNING/i.test(statusOutput)) {
    printInfo('Ruflo daemon already running.');
    return;
  }

  printWarn('Ruflo daemon was not running. Starting it now.');
  runNpx(cliPackage, ['daemon', 'start'], { cwd: projectRoot });

  const verifyResult = runNpx(
    cliPackage,
    ['daemon', 'status'],
    { cwd: projectRoot, stdio: 'pipe', allowFailure: true }
  );
  const verifyOutput = [verifyResult.stdout, verifyResult.stderr].filter(Boolean).join('\n');

  if (!/RUNNING/i.test(verifyOutput)) {
    throw new Error(`Ruflo daemon did not report RUNNING after start.\n${verifyOutput}`.trim());
  }
}

export function printUsage(lines) {
  for (const line of lines) {
    console.log(line);
  }
}
