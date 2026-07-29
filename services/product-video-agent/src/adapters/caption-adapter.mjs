import { createStableId } from '../ids.mjs';
import { CaptionJobSchema, WordTimingSchema } from '../schemas.mjs';
import { resolveInsideRoot } from '../paths.mjs';
import { runLocalProcess } from '../process-runner.mjs';
import { writeCaptionArtifacts } from '../caption-timing.mjs';

export function tokenizeApprovedCaptionText(value) {
  return String(value || '').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:[.!?]+)?/gu) || [];
}

export class LocalFasterWhisperCaptionPlanner {
  constructor(config) {
    this.config = config;
    this.name = 'faster_whisper';
  }

  createJob({ product, scriptJob, voiceJob, runAt }) {
    const jobId = createStableId('caption', {
      voiceOverJobId: voiceJob.voice_over_job_id,
      model: this.config.model,
      timingMode: 'full_audio_no_vad_v1',
      maxWordsPerLine: this.config.max_words_per_line,
    });

    return CaptionJobSchema.parse({
      caption_job_id: jobId,
      product_id: product.product_id,
      script_job_id: scriptJob.script_job_id,
      voice_over_job_id: voiceJob.voice_over_job_id,
      provider: this.name,
      model: this.config.model,
      language: voiceJob.language,
      audio_path: voiceJob.output_path,
      words_output_path: `data/runtime/product-video-agent/captions/${jobId}.words.json`,
      ass_output_path: `data/runtime/product-video-agent/captions/${jobId}.ass`,
      status: 'blocked',
      blockers: ['voice_over_not_complete', 'local_caption_execution_not_enabled'],
      words: [],
      duration_seconds: 0,
      execution_plan: {
        executable: this.config.executable,
        args: [
          this.config.script_path,
          '--audio-path',
          voiceJob.output_path,
          '--model',
          this.config.model,
          '--language',
          'en',
          '--word-timestamps',
          '--disable-vad-filter',
        ],
        execute: false,
      },
      created_at: runAt,
    });
  }
}

export async function executeCaptionTiming(jobInput, options = {}) {
  const job = CaptionJobSchema.parse(jobInput);
  const projectRoot = options.projectRoot || process.cwd();
  const runProcess = options.runProcess || runLocalProcess;
  const executable = resolveInsideRoot(projectRoot, job.execution_plan.executable, 'Caption executable');
  const scriptPath = resolveInsideRoot(projectRoot, job.execution_plan.args[0], 'Caption script path');
  const audioPath = resolveInsideRoot(projectRoot, job.audio_path, 'Caption audio path');
  const args = [
    scriptPath,
    '--audio-path',
    audioPath,
    '--model',
    job.model,
    '--language',
    'en',
    '--word-timestamps',
    '--disable-vad-filter',
  ];
  const result = await runProcess({ executable, args, cwd: projectRoot });
  const payload = JSON.parse(result.stdout);
  const recognizedWords = (payload.words || []).map((word) => WordTimingSchema.parse(word));
  const expectedWords = tokenizeApprovedCaptionText(options.expectedText);
  const words = expectedWords.length === recognizedWords.length
    ? recognizedWords.map((word, index) => WordTimingSchema.parse({
        ...word,
        word: expectedWords[index],
      }))
    : recognizedWords;
  if (words.length === 0) {
    throw new Error('Faster-whisper returned no word timings.');
  }
  const wordsPath = resolveInsideRoot(projectRoot, job.words_output_path, 'Caption words output');
  const assPath = resolveInsideRoot(projectRoot, job.ass_output_path, 'Caption ASS output');
  const artifactWriter = options.writeCaptionArtifacts || writeCaptionArtifacts;
  await artifactWriter({
    words,
    wordsPath,
    assPath,
    options: { maxWordsPerLine: options.maxWordsPerLine || 4 },
  });

  return CaptionJobSchema.parse({
    ...job,
    status: 'complete',
    blockers: [],
    words,
    duration_seconds: Number(payload.durationSeconds || words.at(-1).end),
  });
}
