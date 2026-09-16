import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../process-runner.mjs';
import { verifyReadableFiles } from '../../templates/dual-type-reveal/render/media-probe.mjs';
import { synthesizeNarrationTrack } from '../../templates/dual-type-reveal/render/narration-synthesis.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  slugify,
} from '../../templates/dual-type-reveal/render/constants.mjs';
import { resolveFontPath } from '../../templates/dual-type-reveal/render/drawtext-artifacts.mjs';
import { writeChannelWatermarkedVisualFilterScript } from '../../templates/shared/render/channel-watermark.mjs';
import {
  buildUltimateQuizAudioFilter,
  buildUltimateQuizAudioInputArgs,
  buildUltimateQuizAudioInputs,
} from './audio-filter.mjs';
import { buildUltimateQuizRenderPlan } from './render-plan.mjs';
import { buildUltimateQuizVisualFilter } from './visual-filter.mjs';
import { buildUltimateQuizVisualInputs } from './visual-inputs.mjs';

export async function renderUltimatePokemonQuiz({
  plan,
  template,
  outputPath,
  projectRoot,
  ffmpegExecutable,
  kokoro,
  runtimeRoot,
  fontCandidates = DEFAULT_FONT_CANDIDATES,
}) {
  const renderPlan = buildUltimateQuizRenderPlan({ plan, template, outputPath });
  const outputAbsolutePath = resolve(projectRoot, outputPath);
  const slugBase = `${slugify(plan.template_key)}-${slugify(plan.seed)}`;
  const audioMixPath = resolve(runtimeRoot, `${slugBase}-audio.m4a`);
  const audioFilterPath = resolve(runtimeRoot, `${slugBase}-audio.filters.txt`);
  const visualFilterPath = resolve(runtimeRoot, `${slugBase}-video.filters.txt`);
  const narrationRoot = resolve(runtimeRoot, 'narration', slugBase);
  const narrationCues = Array.isArray(plan?.narration?.cues) ? plan.narration.cues : [];
  const narrationPaths = await Promise.all(narrationCues.map((cue, index) => (
    synthesizeNarrationTrack({
      pythonExecutable: kokoro.pythonExecutable,
      scriptPath: kokoro.scriptPath,
      cacheDir: kokoro.cacheDir,
      profile: kokoro.profile,
      outputPath: resolve(
        narrationRoot,
        `${String(index + 1).padStart(2, '0')}-${slugify(cue.role || `cue-${index + 1}`)}.wav`,
      ),
      text: cue.text,
      cwd: projectRoot,
    })
  )));

  const audioInputs = buildUltimateQuizAudioInputs({ narrationPaths, plan });
  await verifyReadableFiles(audioInputs.map((input) => input.path));
  const audioFilter = buildUltimateQuizAudioFilter({
    plan,
    template,
    renderPlan,
    inputs: audioInputs,
  });
  await mkdir(dirname(audioMixPath), { recursive: true });
  await writeFile(audioFilterPath, audioFilter, 'utf8');
  await runLocalProcess({
    executable: ffmpegExecutable,
    args: [
      '-y',
      ...buildUltimateQuizAudioInputArgs(audioInputs),
      '-/filter_complex',
      audioFilterPath,
      '-map',
      '[aout]',
      '-t',
      String(renderPlan.total_duration_seconds),
      '-c:a',
      String(template?.renderer?.audio_codec || 'aac'),
      '-b:a',
      String(template?.renderer?.audio_bitrate || '192k'),
      audioMixPath,
    ],
    cwd: projectRoot,
    timeoutMs: 900_000,
  });

  const visualInputs = buildUltimateQuizVisualInputs(plan, renderPlan);
  await verifyReadableFiles(visualInputs.map((input) => input.path));
  const roleIndex = new Map(visualInputs.map((input, index) => [input.role, index]));
  const configuredFontCandidates = (template?.layout?.text?.font_candidates || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const fontPath = await resolveFontPath(
    configuredFontCandidates.length > 0 ? configuredFontCandidates : fontCandidates,
  );
  const visualFilter = buildUltimateQuizVisualFilter({
    plan,
    template,
    renderPlan,
    inputRefs: {
      backgrounds: renderPlan.chapters.map((_, index) => roleIndex.get(`background-${index}`)),
      rounds: renderPlan.rounds.map((round) => ({
        sprite: roleIndex.get(`round-${round.round_number}-sprite`),
      })),
    },
    fontPath,
  });
  await writeChannelWatermarkedVisualFilterScript(visualFilterPath, visualFilter, {
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
      visualFilterPath,
      '-map',
      '[vout]',
      '-map',
      `${visualInputs.length}:a:0`,
      '-r',
      String(renderPlan.canvas.fps),
      '-c:v',
      String(template?.renderer?.video_codec || 'libx264'),
      '-preset',
      String(template?.renderer?.preset || 'fast'),
      '-crf',
      String(template?.renderer?.crf ?? 21),
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
    timeoutMs: 7_200_000,
  });
  await access(outputAbsolutePath);
  return {
    output_path: outputAbsolutePath,
    audio_mix_path: audioMixPath,
    audio_filter_script_path: audioFilterPath,
    video_filter_script_path: visualFilterPath,
    narration_paths: narrationPaths,
    render_plan: renderPlan,
  };
}
