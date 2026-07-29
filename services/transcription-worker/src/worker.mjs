import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { projectRoot } from '../../lib/runtime-config.mjs';

const AUDIO_CONTENT_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function selectAudioAttachment(payload) {
  return (payload.attachments || []).find((attachment) => {
    const contentType = String(attachment.contentType || '').toLowerCase();
    if (contentType && AUDIO_CONTENT_TYPES.has(contentType)) {
      return true;
    }

    const filename = String(attachment.filename || attachment.name || '').toLowerCase();
    return ['.mp3', '.mp4', '.m4a', '.wav', '.ogg', '.webm'].some((extension) => filename.endsWith(extension));
  }) || null;
}

function resolveAttachmentName(attachment) {
  return attachment.filename || attachment.name || basename(new URL(attachment.url || attachment.proxyUrl || 'https://example.invalid/audio').pathname) || 'voice-note.bin';
}

function buildTempAudioPath(attachment, config) {
  const filename = resolveAttachmentName(attachment);
  const extension = extname(filename) || '.bin';
  const digest = createHash('sha1')
    .update(`${attachment.id || ''}:${attachment.url || attachment.proxyUrl || ''}:${filename}`)
    .digest('hex')
    .slice(0, 12);

  const tmpDir = resolve(config.runtimePaths.tmpDir, 'voice-notes');
  ensureDirectory(tmpDir);
  return join(tmpDir, `${digest}${extension}`);
}

async function downloadAttachment(attachment, destinationPath, config) {
  const candidateUrls = [attachment.url, attachment.proxyUrl].filter(Boolean);
  if (candidateUrls.length === 0) {
    throw new Error('Voice attachment did not include a downloadable URL.');
  }

  let lastError = null;

  for (const url of candidateUrls) {
    for (const authMode of ['none', 'bot']) {
      const headers = authMode === 'bot' && config.env.DISCORD_BOT_TOKEN
        ? { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}` }
        : {};

      try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
          throw new Error(`Download failed (${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        writeFileSync(destinationPath, Buffer.from(arrayBuffer));
        return;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new Error(`Could not download voice attachment: ${lastError?.message || 'unknown error'}`);
}

function resolvePythonBin(config) {
  if (config.transcription.pythonBin) {
    return config.transcription.pythonBin;
  }

  return 'python3';
}

function resolveTranscriptionScriptPath() {
  return resolve(projectRoot, 'services/transcription-worker/local-transcribe.py');
}

function runPythonTranscriber(audioPath, config) {
  return new Promise((resolvePromise, rejectPromise) => {
    const pythonBin = resolvePythonBin(config);
    const scriptPath = resolveTranscriptionScriptPath();
    const args = [
      scriptPath,
      '--audio-path',
      audioPath,
      '--model',
      config.transcription.whisperModel,
    ];

    const child = spawn(pythonBin, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(new Error(`Could not start transcription worker: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `Transcription worker exited with code ${code}.`));
        return;
      }

      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        rejectPromise(new Error(`Could not parse transcription worker output: ${error.message}`));
      }
    });
  });
}

function normalizeConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return clamp(value, 0, 1);
}

function buildCompletedResult(payload, config, transcript, metadata = {}) {
  return {
    status: 'completed',
    provider: config.transcription.provider,
    transcript,
    confidence: normalizeConfidence(metadata.confidence ?? payload.confidence ?? 0.86),
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings : [],
    normalizedAttachmentMetadata: payload.attachments || [],
    language: metadata.language || '',
    segmentCount: metadata.segmentCount ?? 0,
    durationSeconds: metadata.durationSeconds ?? 0,
    words: Array.isArray(metadata.words) ? metadata.words : [],
  };
}

function buildBlockedResult(payload, config, warnings) {
  return {
    status: 'blocked',
    provider: config.transcription.provider,
    transcript: '',
    confidence: 0,
    warnings,
    normalizedAttachmentMetadata: payload.attachments || [],
  };
}

export async function processTranscriptionRequest(payload, config) {
  const transcript = String(payload.mockTranscript || payload.transcript || '').trim();
  if (transcript) {
    return buildCompletedResult(payload, config, transcript, {
      confidence: payload.confidence ?? 0.86,
      warnings: [],
      segmentCount: 1,
    });
  }

  if (config.transcription.provider !== 'local') {
    return buildBlockedResult(payload, config, [
      `Unsupported transcription provider '${config.transcription.provider}'.`,
    ]);
  }

  const attachment = selectAudioAttachment(payload);
  if (!attachment) {
    return buildBlockedResult(payload, config, [
      'Voice transcription requires at least one supported audio attachment.',
    ]);
  }

  const tempAudioPath = buildTempAudioPath(attachment, config);

  try {
    await downloadAttachment(attachment, tempAudioPath, config);
    const result = await runPythonTranscriber(tempAudioPath, config);
    const completedTranscript = String(result.transcript || '').trim();

    if (!completedTranscript) {
      return buildBlockedResult(payload, config, [
        'Local transcription returned no text.',
        ...(Array.isArray(result.warnings) ? result.warnings : []),
      ]);
    }

    return buildCompletedResult(payload, config, completedTranscript, result);
  } catch (error) {
    return {
      status: 'failed',
      provider: config.transcription.provider,
      transcript: '',
      confidence: 0,
      warnings: [error.message],
      normalizedAttachmentMetadata: payload.attachments || [],
    };
  } finally {
    if (existsSync(tempAudioPath)) {
      rmSync(tempAudioPath, { force: true });
    }
  }
}
