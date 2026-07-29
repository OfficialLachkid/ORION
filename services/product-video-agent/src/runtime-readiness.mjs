import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { resolveInsideRoot } from './paths.mjs';
import { RuntimeReadinessReportSchema } from './schemas.mjs';
import { OllamaScriptAdapter } from './adapters/ollama-script-adapter.mjs';
import { loadVoiceLicenseRecords } from './config.mjs';
import { resolveFfmpegExecutable } from './runtime-executables.mjs';

function runExecutable(executable, args, timeoutMs = 5_000, requiredOutputPattern = null) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      stdio: requiredOutputPattern ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ status: 'blocked', detail: `${executable} readiness check timed out.` });
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timeout);
      resolve({ status: 'blocked', detail: `${executable} is unavailable: ${error.message}` });
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({ status: 'blocked', detail: `${executable} exited with code ${code}.` });
        return;
      }
      if (requiredOutputPattern && !requiredOutputPattern.test(output)) {
        resolve({ status: 'blocked', detail: `${executable} is missing the required ASS/libass caption filter.` });
        return;
      }
      resolve({
        status: 'ready',
        detail: requiredOutputPattern
          ? `${executable} is installed with required caption support.`
          : `${executable} is installed.`,
      });
    });
  });
}

async function checkModelFile(projectRoot, modelPath) {
  try {
    const modelFile = resolveInsideRoot(projectRoot, `${modelPath}.onnx`, 'Piper model path');
    const configFile = resolveInsideRoot(projectRoot, `${modelPath}.onnx.json`, 'Piper model config path');
    await Promise.all([access(modelFile), access(configFile)]);
    return { status: 'ready', detail: `Piper model and config are present at ${modelPath}.` };
  } catch (error) {
    return { status: 'blocked', detail: `Piper model is unavailable: ${error.message}` };
  }
}

async function checkKokoroModel(projectRoot, config) {
  try {
    const cacheDirectory = resolveInsideRoot(projectRoot, config.voice.data_directory, 'Kokoro cache path');
    const repository = config.voice.profiles[0].runtime_model || 'hexgrad/Kokoro-82M';
    const modelDirectory = join(cacheDirectory, 'hub', `models--${repository.replaceAll('/', '--')}`);
    await access(modelDirectory);
    return { status: 'ready', detail: `Kokoro model cache is present at ${modelDirectory}.` };
  } catch (error) {
    return { status: 'blocked', detail: `Kokoro model cache is unavailable: ${error.message}` };
  }
}

async function checkVoiceLicense(config, projectRoot) {
  try {
    const records = await loadVoiceLicenseRecords(config, projectRoot);
    const blocked = records.find((record) => record.commercial_use_status !== 'approved');
    if (blocked) {
      return { status: 'blocked', detail: `Voice ${blocked.voice_id} is not approved for commercial use.` };
    }
    return {
      status: 'ready',
      detail: `${records.length} configured voices have reviewed commercial-use records.`,
    };
  } catch (error) {
    return { status: 'blocked', detail: `Voice license record is unavailable: ${error.message}` };
  }
}

export async function inspectProductVideoRuntime(options) {
  const { config, projectRoot = process.cwd() } = options;
  const ollamaAdapter = options.ollamaAdapter || new OllamaScriptAdapter(config.script);
  const executableCheck = options.executableCheck || runExecutable;
  const modelFileCheck = options.modelFileCheck || checkModelFile;
  const voiceLicenseCheck = options.voiceLicenseCheck || checkVoiceLicense;
  const ttsExecutable = resolveInsideRoot(projectRoot, config.voice.executable, 'TTS executable path');
  const captionExecutable = resolveInsideRoot(projectRoot, config.captions.executable, 'Caption executable path');
  const ffmpegExecutable = resolveFfmpegExecutable(config);
  const piperModelPaths = config.voice.provider === 'piper'
    ? config.voice.profiles.map((profile) => `${config.voice.data_directory}/${profile.model}`)
    : [];
  const localTtsCheck = config.voice.provider === 'kokoro'
    ? executableCheck(
        ttsExecutable,
        [resolveInsideRoot(projectRoot, config.voice.script_path, 'Kokoro script path'), '--check-runtime'],
        30_000,
      )
    : executableCheck(ttsExecutable, ['-m', 'piper', '--help']);
  const voiceModelCheck = config.voice.provider === 'kokoro'
    ? (options.modelFileCheck
        ? options.modelFileCheck(projectRoot, config.voice.data_directory)
        : checkKokoroModel(projectRoot, config))
    : Promise.all(piperModelPaths.map((modelPath) => modelFileCheck(projectRoot, modelPath)))
        .then((checks) => checks.find((check) => check.status === 'blocked') || ({
          status: 'ready',
          detail: `${checks.length} configured Piper models are installed.`,
        }));
  const [ollama, localTts, voiceModel, voiceLicense, fasterWhisper, ffmpeg] = await Promise.all([
    ollamaAdapter.checkReadiness(),
    localTtsCheck,
    voiceModelCheck,
    voiceLicenseCheck(config, projectRoot),
    executableCheck(captionExecutable, ['-c', 'import faster_whisper'], 15_000),
    executableCheck(ffmpegExecutable, ['-hide_banner', '-filters'], 20_000, /^\s*[TSC.]{2,3}\s+ass\s+/mu),
  ]);
  const components = {
    ollama,
    local_tts: localTts,
    voice_model: voiceModel,
    voice_license: voiceLicense,
    faster_whisper: fasterWhisper,
    ffmpeg,
  };
  const ready = Object.values(components).every((component) => component.status === 'ready');
  const localRenderStackReady = [localTts, voiceModel, voiceLicense, fasterWhisper, ffmpeg]
    .every((component) => component.status === 'ready');

  return RuntimeReadinessReportSchema.parse({
    checked_at: options.checkedAt || new Date().toISOString(),
    overall: ready ? 'ready' : 'blocked',
    script_generation_ready: ollama.status === 'ready',
    unattended_script_generation_ready: false,
    components,
    local_render_stack_ready: localRenderStackReady,
  });
}
