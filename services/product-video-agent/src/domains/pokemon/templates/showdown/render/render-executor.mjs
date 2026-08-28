import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../../process-runner.mjs';
import {
  probeMediaDurationSeconds,
  verifyReadableFiles,
} from '../../dual-type-reveal/render/media-probe.mjs';
import { synthesizeNarrationTrack } from '../../dual-type-reveal/render/narration-synthesis.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  slugify,
} from '../../dual-type-reveal/render/constants.mjs';
import { resolveFontPath } from '../../dual-type-reveal/render/drawtext-artifacts.mjs';
import {
  buildAudioFilterScript,
  buildAudioInputs,
  buildShowdownCryCues,
} from './audio-filter-script.mjs';
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
  const slugBase = `${slugify(plan.template_key || 'showdown')}-${slugify(plan.selection.mode || 'single-elimination-bracket')}-${slugify(plan.seed)}`;
  const audioMixPath = resolve(runtimeRoot, `${slugBase}-audio.m4a`);
  const filterScriptPath = resolve(runtimeRoot, `${slugBase}-video.filters.txt`);
  const audioFilterScriptPath = resolve(runtimeRoot, `${slugBase}-audio.filters.txt`);
  const narrationRoot = resolve(runtimeRoot, 'narration');
  const narrationPaths = await Promise.all((plan.narration?.lines || []).map((line, index) => (
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
  const introSlotRevealPath = plan.assets.audio.selected_sound_effects?.intro_slot_reveal || null;
  const bracketProgressPath = plan.assets.audio.selected_sound_effects?.bracket_progress || null;
  const winnerRevealPath = plan.assets.audio.selected_sound_effects?.winner_reveal || null;
  const disappearPath = plan.assets.audio.selected_sound_effects?.disappear || null;
  const cryCues = buildShowdownCryCues(plan, renderPlan);
  await verifyReadableFiles([
    ...narrationPaths,
    ...(musicPath ? [musicPath] : []),
    ...(introSlotRevealPath ? [introSlotRevealPath] : []),
    ...(bracketProgressPath ? [bracketProgressPath] : []),
    ...(winnerRevealPath ? [winnerRevealPath] : []),
    ...(disappearPath ? [disappearPath] : []),
    ...cryCues.map((cue) => cue.path),
  ]);

  const narrationDurations = await Promise.all(
    narrationPaths.map((narrationPath) => (
      probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: narrationPath,
        cwd: projectRoot,
      })
    )),
  );
  renderPlan = applyNarrationDurationsToRenderPlan(renderPlan, narrationDurations);

  await mkdir(dirname(audioMixPath), { recursive: true });
  const audioFilterScript = buildAudioFilterScript({
    narrationPaths,
    introSlotRevealPath,
    musicPath,
    bracketProgressPath,
    winnerRevealPath,
    disappearPath,
    cryCues,
    renderPlan,
  });
  await writeFile(audioFilterScriptPath, audioFilterScript, 'utf8');
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...buildAudioInputs([
        ...narrationPaths,
        ...(musicPath ? [musicPath] : []),
        ...(introSlotRevealPath ? [introSlotRevealPath] : []),
        ...(bracketProgressPath ? [bracketProgressPath] : []),
        ...(winnerRevealPath ? [winnerRevealPath] : []),
        ...(disappearPath ? [disappearPath] : []),
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
    timeoutMs: 300_000,
  });

  const visualInputs = buildVisualInputs(plan, renderPlan);
  await verifyReadableFiles(visualInputs.map((input) => input.path));
  const inputRoleIndex = new Map(visualInputs.map((input, index) => [input.role, index]));
  const inputRefs = {
    background: inputRoleIndex.get('background'),
    introPokeball: inputRoleIndex.get('intro-pokeball'),
    battleDisappear: inputRoleIndex.has('battle-disappear') ? inputRoleIndex.get('battle-disappear') : null,
    participants: (plan.tournament?.participants || []).map((_, index) => inputRoleIndex.get(`participant-${index}`)),
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
