import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildOllamaLaunchAgentPlist(options) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.vbj.orion.ollama</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.nodePath)}</string>
    <string>${escapeXml(options.serviceScriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.stderrPath)}</string>
</dict>
</plist>
`;
}

export function ensureModelCompatibilityLinks(storage, options = {}) {
  const dependencies = {
    existsSync,
    lstatSync,
    mkdirSync,
    realpathSync,
    symlinkSync,
    ...options,
  };
  const created = [];
  const unchanged = [];

  for (const link of storage.compatibilityLinks || []) {
    if (!link.target || !dependencies.existsSync(link.target)) {
      throw new Error(`Model target is unavailable for ${link.name}: ${link.target}`);
    }
    if (dependencies.existsSync(link.path)) {
      const stat = dependencies.lstatSync(link.path);
      const actualTarget = stat.isSymbolicLink() ? dependencies.realpathSync(link.path) : '';
      if (stat.isSymbolicLink() && resolve(actualTarget) === resolve(link.target)) {
        unchanged.push(link.path);
        continue;
      }
      throw new Error(`Compatibility path already exists and was not replaced: ${link.path}`);
    }
    dependencies.mkdirSync(dirname(link.path), { recursive: true });
    dependencies.symlinkSync(link.target, link.path, 'dir');
    created.push(link.path);
  }

  return { created, unchanged };
}
