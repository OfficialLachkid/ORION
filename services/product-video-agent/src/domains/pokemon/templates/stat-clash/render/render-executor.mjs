import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
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
  buildCandidateShinyCues,
  buildStatClashCryCues,
} from './audio-filter-script.mjs';
import {
  applyNarrationDurationsToRenderPlan,
  buildPokeQuizzRenderPlan,
} from './render-plan.mjs';
import { buildVisualFilterScript } from './visual-filter-script.mjs';
import { buildVisualInputs } from './visual-inputs.mjs';
import { resolveFontPath } from '../../dual-type-reveal/render/drawtext-artifacts.mjs';

const MIN_SAFE_ANIMATED_SPRITE_DURATION_SECONDS = 0.2;
const SWSCALER_EAGAIN_FINGERPRINT = /Failed initializing scaling graph \(Resource temporarily unavailable\)/u;
const TRUNCATED_OUTPUT_FINGERPRINT = /__stat_clash_truncated_output__/u;
const MAX_FFMPEG_RETRIES = 3;

async function removeFileIfExists(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function runFfmpegWithSwscaleRetry(options, { onRetry, postCheck } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_FFMPEG_RETRIES; attempt += 1) {
    try {
      const result = await runLocalProcess(options);
      if (typeof postCheck === 'function') {
        await postCheck(result);
      }
      return result;
    } catch (error) {
      const message = String(error?.message || error || '');
      const isKnownTransient = SWSCALER_EAGAIN_FINGERPRINT.test(message)
        || TRUNCATED_OUTPUT_FINGERPRINT.test(message);
      if (!isKnownTransient || attempt === MAX_FFMPEG_RETRIES) {
        throw error;
      }
      lastError = error;
      if (typeof onRetry === 'function') onRetry(attempt);
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 800));
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
  const slugBase = `${slugify(plan.template_key || 'stat-clash')}-${slugify(plan.selection.mode || 'highest-stat')}-${slugify(plan.seed)}`;
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
  const pokeballIntroPath = template?.renderer?.pokeball_spawn_sfx_enabled === true
    ? plan.assets.audio.selected_sound_effects?.pokeball_intro || null
    : null;
  const introSlotRevealPath = plan.assets.audio.selected_sound_effects?.intro_slot_reveal || null;
  const shinyPath = plan.shiny_reveal?.active
    ? plan.assets.audio.selected_sound_effects?.shiny || null
    : null;
  const cryCues = buildStatClashCryCues(plan, renderPlan);
  const shinyCues = buildCandidateShinyCues(plan, renderPlan);
  await verifyReadableFiles([
    ...narrationPaths,
    ...(musicPath ? [musicPath] : []),
    ...(countdownPath ? [countdownPath] : []),
    ...(timerEndPath ? [timerEndPath] : []),
    ...(pokeballIntroPath ? [pokeballIntroPath] : []),
    ...(introSlotRevealPath ? [introSlotRevealPath] : []),
    ...(shinyPath ? [shinyPath] : []),
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
    pokeballIntroPath,
    introSlotRevealPath,
    shinyPath,
    shinyCues,
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
        ...(pokeballIntroPath ? [pokeballIntroPath] : []),
        ...(introSlotRevealPath ? [introSlotRevealPath] : []),
        ...(shinyPath ? [shinyPath] : []),
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
    shinySparkle: inputRoleIndex.has('shiny-sparkle') ? inputRoleIndex.get('shiny-sparkle') : null,
    rounds: renderPlan.rounds.map((round) => ({
      pokeball_hold_sprites: round.candidates.map((candidate) => inputRoleIndex.get(`round-${round.round_number}-candidate-${candidate.index}-pokeball-hold`)),
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
  const expectedDurationSeconds = Number(renderPlan.total_duration_seconds || 0);
  await runFfmpegWithSwscaleRetry({
    executable: ffmpegExecutable,
    args: [
      '-y',
      '-filter_complex_threads',
      '1',
      '-filter_threads',
      '1',
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
    timeoutMs: 900000,
  }, {
    postCheck: async () => {
      if (!(expectedDurationSeconds > 0)) return;
      const actualDurationSeconds = await probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: outputAbsolutePath,
        cwd: projectRoot,
      });
      if (
        Number.isFinite(actualDurationSeconds)
        && actualDurationSeconds > 0
        && actualDurationSeconds + 1.5 < expectedDurationSeconds
      ) {
        await removeFileIfExists(outputAbsolutePath);
        throw new Error(
          `__stat_clash_truncated_output__ expected ~${expectedDurationSeconds.toFixed(2)}s, got ${actualDurationSeconds.toFixed(2)}s`,
        );
      }
    },
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
