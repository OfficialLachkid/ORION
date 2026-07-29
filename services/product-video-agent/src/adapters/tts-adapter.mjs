import { createStableId } from '../ids.mjs';
import { VoiceOverJobSchema } from '../schemas.mjs';
import { mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInsideRoot } from '../paths.mjs';
import { runLocalProcess } from '../process-runner.mjs';

function buildSynthesisArgs(synthesis) {
  const options = [
    ['length_scale', '--length-scale'],
    ['noise_scale', '--noise-scale'],
    ['noise_w_scale', '--noise-w-scale'],
    ['sentence_silence', '--sentence-silence'],
    ['volume', '--volume'],
  ];
  return options.flatMap(([key, flag]) => (
    synthesis[key] === undefined ? [] : [flag, String(synthesis[key])]
  ));
}

export class LocalPiperTtsAdapter {
  constructor(config, profile) {
    this.config = config;
    this.profile = profile;
    this.name = 'piper';
  }

  createJob({ product, scriptJob, voiceLicense, runAt }) {
    const jobId = createStableId('voice', {
      scriptJobId: scriptJob.script_job_id,
      provider: this.name,
      model: this.profile.model,
      voice: this.profile.voice,
      synthesis: this.profile.synthesis,
    });
    const outputPath = `data/runtime/product-video-agent/assets/${jobId}.wav`;

    return VoiceOverJobSchema.parse({
      voice_over_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      script_variant_id: null,
      provider: this.name,
      voice_profile_id: this.profile.profile_id,
      model: this.profile.model,
      voice: this.profile.voice,
      language: this.profile.language,
      license_record_path: this.profile.license_record_path,
      commercial_use_status: voiceLicense.commercial_use_status,
      output_path: outputPath,
      status: 'blocked',
      blockers: [
        'approved_script_variant_missing',
        ...(voiceLicense.commercial_use_status === 'approved' ? [] : ['voice_commercial_use_not_approved']),
        'local_tts_execution_not_enabled',
      ],
      approval_required: false,
      estimated_cost: 0,
      execution_plan: {
        executable: this.config.executable,
        args: [
          '-m',
          'piper',
          '-m',
          this.profile.model,
          '--data-dir',
          this.config.data_directory,
          '-f',
          outputPath,
          ...buildSynthesisArgs(this.profile.synthesis),
          '--',
        ],
        input: 'approved_script_text',
        execute: false,
      },
      created_at: runAt,
    });
  }
}

export class LocalKokoroTtsAdapter {
  constructor(config, profile) {
    this.config = config;
    this.profile = profile;
    this.name = 'kokoro';
  }

  createJob({ product, scriptJob, voiceLicense, runAt }) {
    const jobId = createStableId('voice', {
      scriptJobId: scriptJob.script_job_id,
      provider: this.name,
      model: this.profile.model,
      runtimeModel: this.profile.runtime_model,
      voice: this.profile.voice,
      synthesis: this.profile.synthesis,
    });
    const outputPath = `data/runtime/product-video-agent/assets/${jobId}.wav`;
    const scriptPath = this.config.script_path;
    if (!scriptPath) throw new Error('Kokoro requires voice.script_path.');

    return VoiceOverJobSchema.parse({
      voice_over_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      script_variant_id: null,
      provider: this.name,
      voice_profile_id: this.profile.profile_id,
      model: this.profile.model,
      voice: this.profile.voice,
      language: this.profile.language,
      license_record_path: this.profile.license_record_path,
      commercial_use_status: voiceLicense.commercial_use_status,
      output_path: outputPath,
      status: 'blocked',
      blockers: [
        'approved_script_variant_missing',
        ...(voiceLicense.commercial_use_status === 'approved' ? [] : ['voice_commercial_use_not_approved']),
        'local_tts_execution_not_enabled',
      ],
      approval_required: false,
      estimated_cost: 0,
      execution_plan: {
        executable: this.config.executable,
        args: [
          scriptPath,
          '--model',
          this.profile.runtime_model || 'hexgrad/Kokoro-82M',
          '--voice',
          this.profile.voice,
          '--output-file',
          outputPath,
          '--cache-dir',
          this.config.data_directory,
          '--speed',
          String(this.profile.synthesis.speed ?? 1),
          '--prosody-mode',
          this.profile.synthesis.prosody_mode || 'full_context',
          '--sentence-pause-ms',
          String(this.profile.synthesis.sentence_pause_ms ?? 0),
        ],
        input: 'approved_script_text',
        execute: false,
      },
      created_at: runAt,
    });
  }
}

export function createLocalTtsAdapter(config, profile) {
  if (config.provider === 'kokoro') return new LocalKokoroTtsAdapter(config, profile);
  if (config.provider === 'piper') return new LocalPiperTtsAdapter(config, profile);
  throw new Error(`Unsupported local TTS provider: ${config.provider}`);
}
export class PaidTtsStubAdapter {
  constructor() {
    this.name = 'paid_stub';
  }

  createJob() {
    throw new Error('Paid TTS is disabled and requires explicit spending approval.');
  }
}

export async function executeApprovedVoiceOver(jobInput, scriptVariant, options = {}) {
  const job = VoiceOverJobSchema.parse(jobInput);
  if (scriptVariant.status !== 'approved' || scriptVariant.approval_status !== 'approved') {
    throw new Error('Voice synthesis requires an approved script variant.');
  }
  if (job.commercial_use_status !== 'approved') {
    throw new Error('Voice synthesis requires a commercial-use-approved voice record.');
  }

  const projectRoot = options.projectRoot || process.cwd();
  const executable = resolveInsideRoot(projectRoot, job.execution_plan.executable, 'TTS executable');
  const outputPath = resolveInsideRoot(projectRoot, job.output_path, 'Voice output path');
  const args = job.execution_plan.args.map((arg, index, allArgs) => {
    const previous = allArgs[index - 1];
    if (['--data-dir', '-f', '--output-file', '--cache-dir'].includes(previous)) {
      return resolveInsideRoot(projectRoot, arg, 'TTS runtime path');
    }
    if (job.provider === 'kokoro' && index === 0) {
      return resolveInsideRoot(projectRoot, arg, 'Kokoro script path');
    }
    return arg;
  });
  if (job.provider === 'piper') args.push(scriptVariant.spoken_text);
  await mkdir(dirname(outputPath), { recursive: true });
  const runProcess = options.runProcess || runLocalProcess;
  await runProcess({
    executable,
    args,
    cwd: projectRoot,
    input: job.provider === 'kokoro' ? scriptVariant.spoken_text : undefined,
  });
  if (options.verifyOutput !== false) {
    await access(outputPath);
  }

  return VoiceOverJobSchema.parse({
    ...job,
    script_variant_id: scriptVariant.script_variant_id,
    status: 'complete',
    blockers: [],
  });
}
