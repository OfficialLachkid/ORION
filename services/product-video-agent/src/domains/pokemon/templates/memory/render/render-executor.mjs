import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../../process-runner.mjs';
import { buildAudioFilterScript, buildAudioInputs } from './audio-filter-script.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  slugify,
} from '../../dual-type-reveal/render/constants.mjs';
import {
  buildTextArtifacts,
  resolveFontPath,
  writeDrawtextArtifacts,
} from './drawtext-artifacts.mjs';
import {
  probeMediaDurationSeconds,
  verifyReadableFiles,
} from '../../dual-type-reveal/render/media-probe.mjs';
import { synthesizeNarrationTrack } from '../../dual-type-reveal/render/narration-synthesis.mjs';
import {
  applyNarrationDurationsToRenderPlan,
  buildPokeQuizzRenderPlan,
} from './render-plan.mjs';
import { buildVisualFilterScript } from './visual-filter-script.mjs';
import { buildVisualInputs } from './visual-inputs.mjs';

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
  const slugBase = `${slugify((plan.selection.type_pair || []).join('-'))}-${slugify(plan.seed)}`;
  const audioMixPath = resolve(runtimeRoot, `${slugBase}-audio.m4a`);
  const filterScriptPath = resolve(runtimeRoot, `${slugBase}-video.filters.txt`);
  const audioFilterScriptPath = resolve(runtimeRoot, `${slugBase}-audio.filters.txt`);
  const narrationRoot = resolve(runtimeRoot, 'narration');
  const narrationPaths = await Promise.all(plan.narration.lines.map((line, index) => (
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

  const musicPath = plan.assets.audio.selected_battle_intro_music_path || null;
  const countdownPath = plan.assets.audio.selected_sound_effects?.countdown_tick || null;
  const timerEndPath = plan.assets.audio.selected_sound_effects?.timer_end || null;
  await verifyReadableFiles([
    ...narrationPaths,
    ...(musicPath ? [musicPath] : []),
    ...(countdownPath ? [countdownPath] : []),
    ...(timerEndPath ? [timerEndPath] : []),
  ]);

  await mkdir(dirname(audioMixPath), { recursive: true });
  const [
    narrationDurations,
    timerVisualDurationSeconds,
    timerAlarmDurationSeconds,
    countdownDurationSeconds,
  ] = await Promise.all([
    Promise.all(narrationPaths.map((narrationPath) => (
      probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: narrationPath,
        cwd: projectRoot,
      })
    ))),
    plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path
      ? probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: plan.assets.overlays.selected_timer_countdown_path || plan.assets.overlays.selected_timer_path,
        cwd: projectRoot,
      })
      : Promise.resolve(null),
    plan.assets.overlays.selected_timer_alarm_path
      ? probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: plan.assets.overlays.selected_timer_alarm_path,
        cwd: projectRoot,
      })
      : Promise.resolve(null),
    countdownPath
      ? probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: countdownPath,
        cwd: projectRoot,
      })
      : Promise.resolve(null),
  ]);
  renderPlan = applyNarrationDurationsToRenderPlan(renderPlan, {
    question_seconds: narrationDurations[1],
  });
  if (timerVisualDurationSeconds) {
    plan.assets.overlays.selected_timer_duration_seconds = timerVisualDurationSeconds;
    plan.assets.overlays.selected_timer_countdown_duration_seconds = timerVisualDurationSeconds;
  }
  if (timerAlarmDurationSeconds) {
    plan.assets.overlays.selected_timer_alarm_duration_seconds = timerAlarmDurationSeconds;
  }

  const audioFilterScript = buildAudioFilterScript({
    narrationPaths,
    musicPath,
    countdownPath,
    timerEndPath,
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
    timeoutMs: 300_000,
  });

  const visualInputs = buildVisualInputs(plan, renderPlan);
  await verifyReadableFiles(visualInputs.map((input) => input.path));
  const inputRoleIndex = new Map(visualInputs.map((input, index) => [input.role, index]));
  const inputRefs = {
    background: inputRoleIndex.get('background'),
    timerCountdown: inputRoleIndex.has('timer-countdown') ? inputRoleIndex.get('timer-countdown') : null,
    timerAlarm: inputRoleIndex.has('timer-alarm') ? inputRoleIndex.get('timer-alarm') : null,
    hiddenPlaceholder: inputRoleIndex.has('hidden-placeholder') ? inputRoleIndex.get('hidden-placeholder') : null,
    sprites: (plan.assets.pokemon || []).map((_, index) => inputRoleIndex.get(`display-sprite-${index}`)),
  };
  const fontPath = await resolveFontPath(fontCandidates);
  const textArtifacts = await writeDrawtextArtifacts({
    runtimeRoot,
    plan,
    textArtifacts: buildTextArtifacts({ renderPlan, template }),
  });
  const visualFilter = buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts);
  await writeFile(filterScriptPath, visualFilter.script, 'utf8');

  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  await runLocalProcess({
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
    timeoutMs: 600_000,
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
