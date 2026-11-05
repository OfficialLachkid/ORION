import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOllamaLaunchAgentPlist } from '../lib/local-model-install.mjs';

test('Ollama LaunchAgent runs the model-volume-aware service wrapper', () => {
  const plist = buildOllamaLaunchAgentPlist({
    nodePath: '/opt/homebrew/bin/node',
    serviceScriptPath: '/Users/Agent/Workspace/ORION/scripts/run-ollama-model-service.mjs',
    workingDirectory: '/Users/Agent/Workspace/ORION',
    stdoutPath: '/tmp/ollama.out.log',
    stderrPath: '/tmp/ollama.err.log',
  });

  assert.match(plist, /io\.vbj\.orion\.ollama/u);
  assert.match(plist, /run-ollama-model-service\.mjs/u);
  assert.match(plist, /<key>WorkingDirectory<\/key>/u);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/u);
  assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/u);
});
