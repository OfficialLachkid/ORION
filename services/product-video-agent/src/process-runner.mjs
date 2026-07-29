import { spawn } from 'node:child_process';

export function runLocalProcess(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args || [], {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`${options.executable} timed out.`));
    }, options.timeoutMs || 300_000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(stderr.trim() || `${options.executable} exited with code ${code}.`));
        return;
      }
      finish(resolve, { stdout, stderr, code });
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
