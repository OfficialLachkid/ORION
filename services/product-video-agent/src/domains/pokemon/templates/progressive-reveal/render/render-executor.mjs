import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../../process-runner.mjs';
import { verifyReadableFiles } from '../../dual-type-reveal/render/media-probe.mjs';
import { synthesizeNarrationTrack } from '../../dual-type-reveal/render/narration-synthesis.mjs';
import { DEFAULT_FONT_CANDIDATES, slugify } from '../../dual-type-reveal/render/constants.mjs';
import { resolveFontPath } from '../../dual-type-reveal/render/drawtext-artifacts.mjs';
import { writeChannelWatermarkedVisualFilterScript } from '../../shared/render/channel-watermark.mjs';
import { buildAudioFilterScript, buildAudioInputs } from './audio-filter-script.mjs';
import { buildPokeQuizzRenderPlan } from './render-plan.mjs';
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
  const renderPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath });
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const slugBase = `${slugify(plan.template_key || 'progressive-reveal')}-${slugify(plan.selection.mode || 'random')}-${slugify(plan.seed)}`;
  const audioMixPath = resolve(runtimeRoot, `${slugBase}-audio.m4a`);
  const videoFilterScriptPath = resolve(runtimeRoot, `${slugBase}-video.filters.txt`);
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
  const revealSoundPath = plan.assets.audio.selected_sound_effects?.reveal || null;
  await verifyReadableFiles([
    ...narrationPaths,
    ...(musicPath ? [musicPath] : []),
    ...(revealSoundPath ? [revealSoundPath] : []),
  ]);

  await mkdir(dirname(audioMixPath), { recursive: true });
  const audioFilterScript = buildAudioFilterScript({
    narrationPaths,
    musicPath,
    revealSoundPath,
    revealSoundVolumeMultiplier: template?.audio?.sound_effects?.reveal?.volume_multiplier ?? 1,
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
        ...(revealSoundPath ? [revealSoundPath] : []),
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
    rounds: renderPlan.rounds.map((round) => ({
      sprite: inputRoleIndex.get(`round-${round.round_number}-sprite`),
    })),
  };
  const configuredFontCandidates = (Array.isArray(template?.layout?.text?.font_candidates)
    ? template.layout.text.font_candidates
    : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const fontPath = await resolveFontPath(
    configuredFontCandidates.length > 0 ? configuredFontCandidates : fontCandidates,
  );
  const visualFilter = buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath);
  await writeChannelWatermarkedVisualFilterScript(videoFilterScriptPath, visualFilter, {
    plan,
    renderPlan,
    fontPath,
  });

  await mkdir(dirname(outputAbsolutePath), { recursive: true });
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...visualInputs.flatMap((input) => input.args),
      '-i',
      audioMixPath,
      '-/filter_complex',
      videoFilterScriptPath,
      '-map',
      '[vout]',
      '-map',
      `${visualInputs.length}:a:0`,
      '-r',
      String(renderPlan.canvas.fps),
      '-c:v',
      'libx264',
      '-preset',
      String(template?.renderer?.preset || 'medium'),
      '-crf',
      String(template?.renderer?.crf ?? 20),
      '-pix_fmt',
      String(template?.renderer?.pixel_format || 'yuv420p'),
      '-c:a',
      String(template?.renderer?.audio_codec || 'aac'),
      '-b:a',
      String(template?.renderer?.audio_bitrate || '192k'),
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
    video_filter_script_path: videoFilterScriptPath,
    narration_paths: narrationPaths,
    render_plan: renderPlan,
  };
}

export async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
