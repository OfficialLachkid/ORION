import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../../process-runner.mjs';
import { probeMediaDurationSeconds, verifyReadableFiles } from '../../dual-type-reveal/render/media-probe.mjs';
import { synthesizeNarrationTrack } from '../../dual-type-reveal/render/narration-synthesis.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  slugify,
} from '../../dual-type-reveal/render/constants.mjs';
import {
  buildAudioFilterScript,
  buildAudioInputs,
  buildCryMatchCryCues,
} from './audio-filter-script.mjs';
import {
  applyNarrationDurationsToRenderPlan,
  buildPokeQuizzRenderPlan,
} from './render-plan.mjs';
import { buildVisualFilterScript } from './visual-filter-script.mjs';
import { buildVisualInputs } from './visual-inputs.mjs';
import { resolveFontPath } from '../../dual-type-reveal/render/drawtext-artifacts.mjs';

const MIN_SAFE_ANIMATED_SPRITE_DURATION_SECONDS = 0.2;

// Swscaler EAGAIN retry: with 15 equalizer bars × scale=eval=frame
// per scene, swscale occasionally fails to acquire a context and
// returns "Resource temporarily unavailable" — the whole encoder
// then drops with "Could not open encoder before EOF". The error is
// transient (retry usually succeeds) so wrap the ffmpeg call with a
// bounded retry that ONLY re-runs on this specific fingerprint.
// Height quantization (see visual-filter-script.mjs) already cuts
// the failure rate by ~75%; the retry covers the residual.
const SWSCALER_EAGAIN_FINGERPRINT = /Failed initializing scaling graph \(Resource temporarily unavailable\)/u;
const MAX_FFMPEG_RETRIES = 3;

async function runFfmpegWithSwscaleRetry(options, { onRetry } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_FFMPEG_RETRIES; attempt += 1) {
    try {
      return await runLocalProcess(options);
    } catch (error) {
      const message = String(error?.message || error || '');
      if (!SWSCALER_EAGAIN_FINGERPRINT.test(message) || attempt === MAX_FFMPEG_RETRIES) {
        throw error;
      }
      lastError = error;
      if (typeof onRetry === 'function') onRetry(attempt);
      // Small back-off so any lingering swscale contexts can be
      // freed by the OS before the next attempt.
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastError;
}

function parseRoundCandidateRole(role = '') {
  const match = /^round-(\d+)-candidate-(\d+)$/u.exec(String(role || '').trim());
  if (!match) {
    return null;
  }
  return {
    roundNumber: Number.parseInt(match[1], 10),
    candidateIndex: Number.parseInt(match[2], 10),
  };
}

function buildStillSpriteInput(path, durationSeconds, fps) {
  return ['-loop', '1', '-framerate', String(fps), '-t', String(durationSeconds), '-i', path];
}

export async function stabilizeVisualInputs({
  plan,
  renderPlan,
  visualInputs,
  ffmpegExecutable,
  projectRoot,
  probeDuration = probeMediaDurationSeconds,
}) {
  return Promise.all((Array.isArray(visualInputs) ? visualInputs : []).map(async (input) => {
    const normalizedPath = String(input?.path || '').trim();
    if (!normalizedPath.toLowerCase().endsWith('.gif')) {
      return input;
    }
    const role = parseRoundCandidateRole(input?.role);
    if (!role) {
      return input;
    }
    const round = Array.isArray(renderPlan?.rounds) ? renderPlan.rounds[role.roundNumber - 1] : null;
    const candidate = Array.isArray(round?.candidates) ? round.candidates[role.candidateIndex] : null;
    const fallbackPath = String(candidate?.subject?.sprite_path || '').trim();
    if (!round || !candidate || !fallbackPath || fallbackPath === normalizedPath) {
      return input;
    }
    const durationSeconds = await probeDuration({
      ffmpegExecutable,
      mediaPath: normalizedPath,
      cwd: projectRoot,
    });
    if (durationSeconds == null || durationSeconds >= MIN_SAFE_ANIMATED_SPRITE_DURATION_SECONDS) {
      return input;
    }
    return {
      ...input,
      path: fallbackPath,
      args: buildStillSpriteInput(
        fallbackPath,
        round.scene_duration_seconds,
        renderPlan?.canvas?.fps || 30,
      ),
    };
  }));
}

export async function renderPokeQuizzVideo({
  plan,
  template,
  outputPath,
  projectRoot,
  ffmpegExecutable,
  kokoro,
  runtimeRoot,
  fontCandidates = DEFAULT_FONT_CANDIDATES,
}) {
  let renderPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath });
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const slugBase = `${slugify(plan.template_key || 'cry-match')}-${slugify(plan.selection.mode || 'highest-stat')}-${slugify(plan.seed)}`;
  const audioMixPath = resolve(runtimeRoot, `${slugBase}-audio.m4a`);
  const filterScriptPath = resolve(runtimeRoot, `${slugBase}-video.filters.txt`);
  const audioFilterScriptPath = resolve(runtimeRoot, `${slugBase}-audio.filters.txt`);
  const narrationRoot = resolve(runtimeRoot, 'narration');
  const narrationLines = Array.isArray(plan.narration?.lines) ? plan.narration.lines : [];

  const narrationPaths = await Promise.all(narrationLines.map((line, index) => (
    synthesizeNarrationTrack({
      pythonExecutable: kokoro.pythonExecutable,
      scriptPath: kokoro.scriptPath,
      cacheDir: kokoro.cacheDir,
      profile: kokoro.profile,
      outputPath: resolve(narrationRoot, `${String(index + 1).padStart(2, '0')}-${slugify(line.role)}.wav`),
      text: line.text,
      cwd: projectRoot,
    })
  )));

  const narrationDurations = await Promise.all(
    narrationPaths.map((mediaPath) => probeMediaDurationSeconds({
      ffmpegExecutable,
      mediaPath,
      cwd: projectRoot,
    })),
  );
  renderPlan = applyNarrationDurationsToRenderPlan(renderPlan, narrationDurations);

  const musicPath = plan.assets.audio.selected_battle_intro_music_path || null;
  const countdownPath = plan.assets.audio.selected_sound_effects?.countdown_tick || null;
  const timerEndPath = plan.assets.audio.selected_sound_effects?.timer_end || null;
  const introSlotRevealPath = plan.assets.audio.selected_sound_effects?.intro_slot_reveal || null;
  const cryCues = buildCryMatchCryCues(plan, renderPlan);
  await verifyReadableFiles([
    ...narrationPaths,
    ...(musicPath ? [musicPath] : []),
    ...(countdownPath ? [countdownPath] : []),
    ...(timerEndPath ? [timerEndPath] : []),
    ...(introSlotRevealPath ? [introSlotRevealPath] : []),
    ...cryCues.map((cue) => cue.path),
  ]);

  await mkdir(dirname(audioMixPath), { recursive: true });
  const countdownDurationSeconds = countdownPath
    ? await probeMediaDurationSeconds({
      ffmpegExecutable,
      mediaPath: countdownPath,
      cwd: projectRoot,
    })
    : null;
  const audioFilterScript = buildAudioFilterScript({
    narrationPaths,
    musicPath,
    countdownPath,
    timerEndPath,
    introSlotRevealPath,
    cryCues,
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: countdownDurationSeconds,
    },
  });
  await writeFile(audioFilterScriptPath, audioFilterScript, 'utf8');
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...buildAudioInputs([
        ...narrationPaths,
        ...(musicPath ? [musicPath] : []),
        ...(countdownPath ? [countdownPath] : []),
        ...(timerEndPath ? [timerEndPath] : []),
        ...(introSlotRevealPath ? [introSlotRevealPath] : []),
        ...cryCues.map((cue) => cue.path),
      ]),
      '-/filter_complex',
      audioFilterScriptPath,
      '-map',
      '[aout]',
      '-t',
      String(renderPlan.total_duration_seconds),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      audioMixPath,
    ],
    cwd: projectRoot,
    timeoutMs: 300000,
  });

  const visualInputs = await stabilizeVisualInputs({
    plan,
    renderPlan,
    visualInputs: buildVisualInputs(plan, renderPlan),
    ffmpegExecutable,
    projectRoot,
  });
  await verifyReadableFiles(visualInputs.map((input) => input.path));
  const inputRoleIndex = new Map(visualInputs.map((input, index) => [input.role, index]));
  const inputRefs = {
    background: inputRoleIndex.get('background'),
    introPokeball: inputRoleIndex.has('intro-pokeball') ? inputRoleIndex.get('intro-pokeball') : null,
    grassPlatform: inputRoleIndex.has('grass-platform') ? inputRoleIndex.get('grass-platform') : null,
    rounds: renderPlan.rounds.map((round) => ({
      candidates: round.candidates.map((candidate) => inputRoleIndex.get(`round-${round.round_number}-candidate-${candidate.index}`)),
      still_candidates: round.candidates.map((candidate) => {
        const inputIndex = inputRoleIndex.get(`round-${round.round_number}-candidate-${candidate.index}`);
        if (inputIndex == null) {
          return false;
        }
        const candidatePath = String(visualInputs[inputIndex]?.path || '').trim().toLowerCase();
        return !candidatePath.endsWith('.gif')
          && !candidatePath.endsWith('.mp4')
          && !candidatePath.endsWith('.mov')
          && !candidatePath.endsWith('.webm');
      }),
    })),
  };
  const templateFontCandidates = (Array.isArray(template?.layout?.text?.font_candidates)
    ? template.layout.text.font_candidates
    : []
  )
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const effectiveFontCandidates = templateFontCandidates.length > 0
    ? templateFontCandidates
    : fontCandidates;
  const fontPath = await resolveFontPath(effectiveFontCandidates);
  const visualFilter = buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath);
  await writeFile(filterScriptPath, visualFilter.script, 'utf8');

  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  await runFfmpegWithSwscaleRetry({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...visualInputs.flatMap((input) => input.args),
      '-i',
      audioMixPath,
      '-/filter_complex',
      filterScriptPath,
      '-map',
      '[vout]',
      '-map',
      `${visualInputs.length}:a:0`,
      '-r',
      String(renderPlan.canvas.fps),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      String(renderPlan.total_duration_seconds),
      '-shortest',
      '-movflags',
      '+faststart',
      outputAbsolutePath,
    ],
    cwd: projectRoot,
    timeoutMs: 600000,
  });

  await access(outputAbsolutePath);
  return {
    output_path: outputAbsolutePath,
    audio_mix_path: audioMixPath,
    audio_filter_script_path: audioFilterScriptPath,
    video_filter_script_path: filterScriptPath,
    narration_paths: narrationPaths,
    render_plan: renderPlan,
  };
}

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
