import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLocalProcess } from '../../../../../process-runner.mjs';
import { probeMediaDurationSeconds, verifyReadableFiles } from '../../dual-type-reveal/render/media-probe.mjs';
import { synthesizeNarrationTrack } from '../../dual-type-reveal/render/narration-synthesis.mjs';
import {
  DEFAULT_FONT_CANDIDATES,
  slugify,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildAudioFilterScript, buildAudioInputs } from './audio-filter-script.mjs';
import { buildPokeQuizzRenderPlan } from './render-plan.mjs';
import { buildVisualFilterScript } from './visual-filter-script.mjs';
import { buildVisualInputs } from './visual-inputs.mjs';
import { resolveFontPath } from '../../dual-type-reveal/render/drawtext-artifacts.mjs';
import { createLocalizedColorVariantAssets } from '../../shared/render/localized-color-mutation.mjs';

export function applyLocalizedDecoyAssetsToRound(round, sourceSpritePath, generated) {
  if (!Array.isArray(generated?.created) || generated.created.length === 0) {
    return {
      ...round,
      localized_decoy_generation: {
        status: 'fallback_global_filter',
        reason: generated?.reason || 'no_decoy_assets_created',
      },
    };
  }

  const normalizedSourcePath = String(generated?.source?.path || '').trim() || sourceSpritePath;
  let decoyAssetIndex = 0;
  return {
    ...round,
    localized_decoy_generation: {
      status: 'generated',
      selected_family: generated.selected_family || null,
      normalized_source_path: normalizedSourcePath,
    },
    candidates: round.candidates.map((candidate) => {
      if (candidate?.is_correct) {
        return {
          ...candidate,
          render_sprite_path: normalizedSourcePath,
          color_mix: null,
          saturation: 1,
          brightness: 0,
          contrast: 1,
          normalized_from_sprite_path: normalizedSourcePath === sourceSpritePath ? null : sourceSpritePath,
        };
      }
      const decoyAsset = generated.created[decoyAssetIndex];
      decoyAssetIndex += 1;
      if (!decoyAsset?.path) {
        return candidate;
      }
      return {
        ...candidate,
        render_sprite_path: decoyAsset.path,
        color_mix: null,
        saturation: 1,
        brightness: 0,
        contrast: 1,
        localized_color_mutation: decoyAsset.mutation || null,
      };
    }),
  };
}

async function prepareLocalizedDecoyRenderPlan({
  renderPlan,
  plan,
  template,
  runtimeRoot,
  projectRoot,
  ffmpegExecutable,
}) {
  if (template?.renderer?.localized_decoy_color_mutation?.enabled === false) {
    return renderPlan;
  }

  const decoyRoot = resolve(
    runtimeRoot,
    'know-your-shiny-decoys',
    slugify(plan.seed || 'preview'),
  );
  const mutationConfig = template?.renderer?.localized_decoy_color_mutation || {};
  const rounds = await Promise.all((Array.isArray(renderPlan.rounds) ? renderPlan.rounds : [])
    .map(async (round) => {
      const sourceSpritePath = String(
        round?.subject?.render_sprite_path
        || round?.subject?.shiny_sprite_path
        || round?.subject?.sprite_path
        || '',
      ).trim();
      const decoys = (Array.isArray(round?.candidates) ? round.candidates : [])
        .filter((candidate) => !candidate?.is_correct);
      if (!sourceSpritePath || decoys.length === 0) {
        return round;
      }

      try {
        const generated = await createLocalizedColorVariantAssets({
          inputPath: sourceSpritePath,
          outputDirectory: decoyRoot,
          outputBasename: `round-${round.round_number}-${slugify(round?.subject?.name || 'pokemon')}`,
          variantCount: decoys.length,
          seed: `${plan.seed || 'know-your-shiny'}:${round?.subject?.pokedex_id || round?.subject?.name || round.round_number}`,
          config: mutationConfig,
          ffmpegExecutable,
          cwd: projectRoot,
          includeSourceCopy: true,
        });
        return applyLocalizedDecoyAssetsToRound(round, sourceSpritePath, generated);
      } catch (error) {
        return {
          ...round,
          localized_decoy_generation: {
            status: 'fallback_global_filter',
            reason: error?.message || String(error),
          },
        };
      }
    }));

  return {
    ...renderPlan,
    rounds,
  };
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
  const slugBase = `${slugify(plan.template_key || 'know-your-shiny')}-${slugify(plan.selection.mode || 'random')}-${slugify(plan.seed)}`;
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
  const countdownPath = plan.assets.audio.selected_sound_effects?.countdown_tick || null;
  const timerEndPath = plan.assets.audio.selected_sound_effects?.timer_end || null;
  const shinyPath = plan.shiny_reveal?.active
    ? plan.assets.audio.selected_sound_effects?.shiny || null
    : null;
  await verifyReadableFiles([
    ...narrationPaths,
    ...(musicPath ? [musicPath] : []),
    ...(countdownPath ? [countdownPath] : []),
    ...(timerEndPath ? [timerEndPath] : []),
    ...(shinyPath ? [shinyPath] : []),
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
    shinyPath,
    shinyVolumeMultiplier: plan.shiny_reveal?.sound_volume_multiplier ?? 1,
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
        ...(shinyPath ? [shinyPath] : []),
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

  renderPlan = await prepareLocalizedDecoyRenderPlan({
    renderPlan,
    plan,
    template,
    runtimeRoot,
    projectRoot,
    ffmpegExecutable,
  });

  const visualInputs = buildVisualInputs(plan, renderPlan);
  await verifyReadableFiles(visualInputs.map((input) => input.path));
  const inputRoleIndex = new Map(visualInputs.map((input, index) => [input.role, index]));
  const inputRefs = {
    background: inputRoleIndex.get('background'),
    rounds: renderPlan.rounds.map((round) => ({
      candidates: round.candidates.map((candidate) => (
        inputRoleIndex.get(`round-${round.round_number}-candidate-${candidate.index}`)
      )),
    })),
    grassPlatform: inputRoleIndex.has('grass-platform') ? inputRoleIndex.get('grass-platform') : null,
    shinySparkle: inputRoleIndex.has('shiny-sparkle') ? inputRoleIndex.get('shiny-sparkle') : null,
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
