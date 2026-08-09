import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runLocalProcess } from '../../../../../process-runner.mjs';

export async function synthesizeNarrationTrack({ pythonExecutable, scriptPath, cacheDir, profile, outputPath, text, cwd }) {
  await mkdir(dirname(outputPath), { recursive: true });
  await runLocalProcess({
    executable: pythonExecutable,
    args: [
      scriptPath,
      '--model',
      profile.runtime_model || 'hexgrad/Kokoro-82M',
      '--voice',
      profile.voice,
      '--output-file',
      outputPath,
      '--cache-dir',
      cacheDir,
      '--speed',
      String(profile.synthesis?.speed ?? 1),
      '--prosody-mode',
      profile.synthesis?.prosody_mode || 'full_context',
      '--sentence-pause-ms',
      String(profile.synthesis?.sentence_pause_ms ?? 0),
    ],
    cwd,
    input: text,
    timeoutMs: 300_000,
  });
  return outputPath;
}
