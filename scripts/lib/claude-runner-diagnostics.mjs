import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

export function classifyDoctorState(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.some((check) => check.state === 'blocked')) {
    return 'blocked';
  }
  if (list.some((check) => check.state === 'degraded')) {
    return 'degraded';
  }
  return 'ready';
}

export function buildRuntimePath(config) {
  const seed = [
    config?.env?.PATH || '',
    process.env.PATH || '',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return [...new Set(
    seed
      .flatMap((entry) => String(entry || '').split(delimiter))
      .map((entry) => entry.trim())
      .filter(Boolean)
  )].join(delimiter);
}

export function parseLaunchAgentPlistText(plistText) {
  const text = String(plistText || '');
  const readString = (key) => {
    const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, 'iu');
    const match = pattern.exec(text);
    return match ? match[1].trim() : '';
  };
  const readBool = (key) => {
    const pattern = new RegExp(`<key>${key}</key>\\s*<(true|false)/>`, 'iu');
    const match = pattern.exec(text);
    return match ? match[1].toLowerCase() === 'true' : null;
  };
  const readProgramArguments = () => {
    const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/iu.exec(text);
    if (!block) {
      return [];
    }
    const args = [];
    const pattern = /<string>([\s\S]*?)<\/string>/gu;
    let match = pattern.exec(block[1]);
    while (match) {
      args.push(match[1].trim());
      match = pattern.exec(block[1]);
    }
    return args;
  };
  const readEnvironmentVariables = () => {
    const block = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/iu.exec(text);
    if (!block) {
      return {};
    }
    const entries = {};
    const pattern = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/gu;
    let match = pattern.exec(block[1]);
    while (match) {
      entries[match[1].trim()] = match[2].trim();
      match = pattern.exec(block[1]);
    }
    return entries;
  };
  return {
    label: readString('Label'),
    workingDirectory: readString('WorkingDirectory'),
    runAtLoad: readBool('RunAtLoad'),
    keepAlive: readBool('KeepAlive'),
    programArguments: readProgramArguments(),
    environmentVariables: readEnvironmentVariables(),
  };
}

export function probeWritablePath(directory) {
  const probe = resolve(directory, `.doctor-probe-${Date.now()}`);
  try {
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
    writeFileSync(probe, 'ok\n', 'utf8');
    unlinkSync(probe);
    return { writable: true, error: '' };
  } catch (error) {
    return { writable: false, error: error.message || 'Unknown write error.' };
  }
}

export function parseClaudeAuthStatusText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return { loggedIn: false, authMethod: '', apiProvider: '', raw: '' };
  }
  try {
    const parsed = JSON.parse(text);
    return {
      loggedIn: parsed.loggedIn === true,
      authMethod: parsed.authMethod || '',
      apiProvider: parsed.apiProvider || '',
      raw: '',
    };
  } catch {
    return {
      loggedIn: /logged\s+in|authenticated/i.test(text) && !/not\s+logged\s+in/i.test(text),
      authMethod: '',
      apiProvider: '',
      raw: text,
    };
  }
}

export function readPlistIfPresent(plistPath) {
  if (!plistPath || !existsSync(plistPath)) {
    return null;
  }
  try {
    return readFileSync(plistPath, 'utf8');
  } catch {
    return null;
  }
}
