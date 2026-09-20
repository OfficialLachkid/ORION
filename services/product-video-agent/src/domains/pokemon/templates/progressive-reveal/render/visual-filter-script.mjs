import { formatEnableBetween } from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  escapeDrawtextText,
  escapeFilterPath,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildBackgroundPreparationFilter } from '../../shared/render/background-motion.mjs';
import {
  appendProgressiveCoverFilters,
  buildCascadeFallingParticlePhases,
  buildFluidFallingParticlePhases,
  buildProgressiveRevealProgressExpression,
} from '../../shared/render/progressive-reveal-engine.mjs';

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function appendLayeredText(filters, currentLabel, {
  labelPrefix,
  text,
  y,
  fontSize,
  color,
  fontPart,
  outlineWidth,
  depthPx,
  startSeconds,
  endSeconds,
}) {
  const escapedText = escapeDrawtextText(text);
  const enable = formatEnableBetween(startSeconds, endSeconds);
  const shadowLabel = `${labelPrefix}shadow`;
  filters.push(
    `[${currentLabel}]drawtext=text='${escapedText}'${fontPart}:fontcolor=black@0.68:fontsize=${fontSize}:borderw=${outlineWidth}:bordercolor=black@0.8:fix_bounds=1:x=(w-text_w)/2+${Math.max(3, depthPx)}:y=${roundTime(y + Math.max(5, depthPx + 2))}:enable='${enable}'[${shadowLabel}]`,
  );
  const depthLabel = `${labelPrefix}depth`;
  filters.push(
    `[${shadowLabel}]drawtext=text='${escapedText}'${fontPart}:fontcolor=0x7A6210:fontsize=${fontSize}:borderw=${outlineWidth}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2+${Math.max(2, Math.floor(depthPx / 2))}:y=${roundTime(y + Math.max(2, Math.floor(depthPx / 2)))}:enable='${enable}'[${depthLabel}]`,
  );
  const outputLabel = `${labelPrefix}main`;
  filters.push(
    `[${depthLabel}]drawtext=text='${escapedText}'${fontPart}:fontcolor=${color}:fontsize=${fontSize}:borderw=${outlineWidth}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${roundTime(y)}:enable='${enable}'[${outputLabel}]`,
  );
  return outputLabel;
}

function resolveHeadlineLines(template) {
  const configured = Array.isArray(template?.question_contract?.headline_lines)
    ? template.question_contract.headline_lines
    : [];
  const lines = configured.map((value) => String(value || '').trim()).filter(Boolean);
  return lines.length > 0 ? lines.slice(0, 2) : ['GUESS THE POKEMON', 'BEFORE IT IS REVEALED'];
}

function buildPixelatedResolutionExpression(progressExpression, configuredSteps = []) {
  const steps = (Array.isArray(configuredSteps) ? configuredSteps : [])
    .map((value) => Math.max(8, Math.round(Number(value) || 0)))
    .filter((value, index, values) => value > 0 && values.indexOf(value) === index)
    .sort((left, right) => left - right);
  const resolutions = steps.length >= 2
    ? steps
    : [18, 26, 38, 56, 82, 120, 176, 258, 378, 520];
  let expression = String(resolutions.at(-1));
  for (let index = resolutions.length - 2; index >= 0; index -= 1) {
    const threshold = Number(((index + 1) / resolutions.length).toFixed(4));
    expression = `if(lt(${progressExpression},${threshold}),${resolutions[index]},${expression})`;
  }
  return expression;
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath = null) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const roundCount = Math.max(1, renderPlan.rounds.length);
  const background = renderPlan.background;
  const backgroundLabels = renderPlan.rounds.map((_, index) => `background${index}`);
  const backgroundPreparationFilter = buildBackgroundPreparationFilter({
    inputRef: inputRefs.background,
    width,
    height,
    fps,
    blurSigma: background.blur_sigma,
    template,
  });
  filters.push(
    `${backgroundPreparationFilter},eq=saturation=1.08:brightness=-0.035,format=rgba,split=${roundCount}${backgroundLabels.map((label) => `[${label}]`).join('')}`,
  );

  const fontPart = buildFontPart(fontPath);
  const headlineLines = resolveHeadlineLines(template);
  const textLayout = renderPlan.text_layout;
  const box = renderPlan.reveal_box;

  renderPlan.rounds.forEach((round, roundIndex) => {
    const backgroundLabel = backgroundLabels[roundIndex];
    const sceneBaseLabel = `scene${roundIndex}base`;
    filters.push(
      `[${backgroundLabel}]trim=start=${round.scene_start_seconds}:end=${round.scene_end_seconds},setpts=PTS-STARTPTS,drawbox=x=0:y=0:w=iw:h=ih:color=black@${background.darken_alpha}:t=fill[${sceneBaseLabel}]`,
    );
    let currentLabel = sceneBaseLabel;

    const shadowLabel = `scene${roundIndex}boxShadow`;
    filters.push(
      `[${currentLabel}]drawbox=x=${box.x + box.shadow_offset_px}:y=${box.y + box.shadow_offset_px}:w=${box.width}:h=${box.height}:color=black@0.46:t=fill[${shadowLabel}]`,
    );
    currentLabel = shadowLabel;
    const boxFillLabel = `scene${roundIndex}boxFill`;
    filters.push(
      `[${currentLabel}]drawbox=x=${box.x}:y=${box.y}:w=${box.width}:h=${box.height}:color=${box.background_color}:t=fill[${boxFillLabel}]`,
    );
    currentLabel = boxFillLabel;
    const boxBorderLabel = `scene${roundIndex}boxBorder`;
    filters.push(
      `[${currentLabel}]drawbox=x=${box.x}:y=${box.y}:w=${box.width}:h=${box.height}:color=${box.border_color}:t=${box.border_width_px}[${boxBorderLabel}]`,
    );
    currentLabel = boxBorderLabel;

    const coverInset = box.border_width_px;
    const coverWidth = Math.max(2, box.width - (coverInset * 2));
    const coverHeight = Math.max(2, box.height - (coverInset * 2));
    const coverX = box.x + coverInset;
    const coverY = box.y + coverInset;
    const spriteInput = inputRefs.rounds[roundIndex].sprite;
    const spriteBaseLabel = `round${roundIndex}spriteBase`;
    const fallingProgress = buildProgressiveRevealProgressExpression({
      startSeconds: round.local.reveal_start_seconds,
      durationSeconds: round.reveal_duration_seconds,
      fps,
      difficulty: round.reveal_difficulty,
      completionProgress: round.reveal_completion_progress,
    });
    const fallingPhaseBuilder = {
      cascade: buildCascadeFallingParticlePhases,
      fluid_fill: buildFluidFallingParticlePhases,
    }[round.reveal_method];
    const fallingPhases = fallingPhaseBuilder
      ? fallingPhaseBuilder({
        seed: round.reveal_seed,
        progressExpression: fallingProgress,
        completionProgress: round.reveal_completion_progress,
        config: {
          ...round.reveal_config,
          reveal_duration_seconds: round.full_reveal_duration_seconds,
          fall_distance_px: round.reveal_config?.fall_distance_px || coverHeight,
        },
      })
      : [];
    const spritePreparation = `[${spriteInput}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS`;
    if (round.reveal_method === 'pixelated') {
      const pixelProgress = buildProgressiveRevealProgressExpression({
        startSeconds: round.local.reveal_start_seconds,
        durationSeconds: round.reveal_duration_seconds,
        fps,
        difficulty: round.reveal_difficulty,
        completionProgress: 1,
      });
      const pixelResolution = buildPixelatedResolutionExpression(
        pixelProgress,
        round.reveal_config?.resolution_steps_px,
      );
      const pixelSourceLabel = `round${roundIndex}pixelSource`;
      const answerSourceLabel = `round${roundIndex}answerSource`;
      const sharpAnswerLabel = `round${roundIndex}sharpAnswer`;
      filters.push(
        `${spritePreparation},format=rgba,split=2[${pixelSourceLabel}][${answerSourceLabel}]`,
      );
      filters.push(
        `[${pixelSourceLabel}]scale=w='${pixelResolution}':h='${pixelResolution}':eval=frame:force_original_aspect_ratio=decrease:flags=neighbor,scale=${box.sprite_size_px}:${box.sprite_size_px}:force_original_aspect_ratio=decrease:flags=neighbor,format=rgba,setsar=1[${spriteBaseLabel}]`,
      );
      filters.push(
        `[${answerSourceLabel}]scale=${box.sprite_size_px}:${box.sprite_size_px}:force_original_aspect_ratio=decrease:flags=neighbor,format=rgba,setsar=1[${sharpAnswerLabel}]`,
      );
      const preRevealCoverLabel = `scene${roundIndex}pixelPreCover`;
      filters.push(
        `[${currentLabel}]drawbox=x=${coverX}:y=${coverY}:w=${coverWidth}:h=${coverHeight}:color=black:t=fill:enable='${formatEnableBetween(0, round.local.reveal_start_seconds)}'[${preRevealCoverLabel}]`,
      );
      const pixelatedSceneLabel = `scene${roundIndex}pixelated`;
      filters.push(
        `[${preRevealCoverLabel}][${spriteBaseLabel}]overlay=x=${box.center_x}-w/2:y=${box.center_y}-h/2:enable='${formatEnableBetween(round.local.reveal_start_seconds, round.local.answer_start_seconds)}'[${pixelatedSceneLabel}]`,
      );
      const sharpSceneLabel = `scene${roundIndex}sharp`;
      filters.push(
        `[${pixelatedSceneLabel}][${sharpAnswerLabel}]overlay=x=${box.center_x}-w/2:y=${box.center_y}-h/2:enable='${formatEnableBetween(round.local.answer_start_seconds, round.local.scene_duration_seconds)}'[${sharpSceneLabel}]`,
      );
      currentLabel = sharpSceneLabel;
    } else {
      const scaledSpritePreparation = `${spritePreparation},scale=${box.sprite_size_px}:${box.sprite_size_px}:force_original_aspect_ratio=decrease:flags=neighbor,format=rgba,setsar=1`;
      if (fallingPhases.length > 0) {
        filters.push(
          `${scaledSpritePreparation},pad=${coverWidth}:${coverHeight}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,split=${fallingPhases.length + 1}[${spriteBaseLabel}]${fallingPhases.map((phase) => `[round${roundIndex}fallSource${phase.index}]`).join('')}`,
        );
      } else {
        filters.push(`${scaledSpritePreparation}[${spriteBaseLabel}]`);
      }
      const spriteSceneLabel = `scene${roundIndex}sprite`;
      const spriteX = fallingPhases.length > 0 ? coverX : `${box.center_x}-w/2`;
      const spriteY = fallingPhases.length > 0 ? coverY : `${box.center_y}-h/2`;
      filters.push(
        `[${currentLabel}][${spriteBaseLabel}]overlay=x=${spriteX}:y=${spriteY}:enable='${formatEnableBetween(0, round.local.scene_duration_seconds)}'[${spriteSceneLabel}]`,
      );

      const coverSourceLabel = `round${roundIndex}coverSource`;
      const progressiveCoverLabel = `round${roundIndex}coverProgressive`;
      filters.push(
        `color=c=black:s=${coverWidth}x${coverHeight}:r=${fps}:d=${round.scene_duration_seconds},format=rgba[${coverSourceLabel}]`,
      );
      appendProgressiveCoverFilters(filters, {
        inputLabel: coverSourceLabel,
        outputLabel: progressiveCoverLabel,
        method: round.reveal_method,
        seed: round.reveal_seed,
        startSeconds: round.local.reveal_start_seconds,
        durationSeconds: round.reveal_duration_seconds,
        fps,
        difficulty: round.reveal_difficulty,
        completionProgress: round.reveal_completion_progress,
        config: {
          ...round.reveal_config,
          reveal_duration_seconds: round.full_reveal_duration_seconds,
        },
      });
      const coverSceneLabel = `scene${roundIndex}cover`;
      filters.push(
        `[${spriteSceneLabel}][${progressiveCoverLabel}]overlay=x=${box.x + coverInset}:y=${box.y + coverInset}:enable='${formatEnableBetween(0, round.local.answer_start_seconds)}'[${coverSceneLabel}]`,
      );
      currentLabel = coverSceneLabel;

      fallingPhases.forEach((phase) => {
        const fallingShiftedLabel = `round${roundIndex}fallShifted${phase.index}`;
        filters.push(
          `[round${roundIndex}fallSource${phase.index}]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${phase.maskExpression})/255',pad=w=iw:h=ih+${phase.offsetPixels}:x=0:y=0:color=0x00000000,crop=w=${coverWidth}:h=${coverHeight}:x=0:y=${phase.offsetPixels}[${fallingShiftedLabel}]`,
        );
        const fallingSceneLabel = `scene${roundIndex}fall${phase.index}`;
        filters.push(
          `[${currentLabel}][${fallingShiftedLabel}]overlay=x=${coverX}:y=${coverY}:format=auto:enable='${formatEnableBetween(round.local.reveal_start_seconds, round.local.answer_start_seconds)}'[${fallingSceneLabel}]`,
        );
        currentLabel = fallingSceneLabel;
      });
    }

    const sceneTextEnd = round.local.scene_duration_seconds;
    currentLabel = appendLayeredText(filters, currentLabel, {
      labelPrefix: `scene${roundIndex}headline0`,
      text: headlineLines[0],
      y: textLayout.hook_y,
      fontSize: textLayout.hook_font_size,
      color: textLayout.primary_color,
      fontPart,
      outlineWidth: textLayout.outline_width,
      depthPx: textLayout.depth_px,
      startSeconds: 0,
      endSeconds: sceneTextEnd,
    });
    if (headlineLines[1]) {
      currentLabel = appendLayeredText(filters, currentLabel, {
        labelPrefix: `scene${roundIndex}headline1`,
        text: headlineLines[1],
        y: textLayout.hook_y + textLayout.hook_font_size + textLayout.hook_line_gap_px,
        fontSize: Math.round(textLayout.hook_font_size * 0.82),
        color: textLayout.accent_color,
        fontPart,
        outlineWidth: textLayout.outline_width,
        depthPx: textLayout.depth_px,
        startSeconds: 0,
        endSeconds: sceneTextEnd,
      });
    }

    const counterLabel = `scene${roundIndex}counter`;
    filters.push(
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(round.round_label)}'${fontPart}:fontcolor=white:fontsize=${textLayout.counter_font_size}:borderw=5:bordercolor=black:fix_bounds=1:x=${textLayout.counter_x}:y=${textLayout.counter_y}[${counterLabel}]`,
    );
    currentLabel = counterLabel;
    currentLabel = appendLayeredText(filters, currentLabel, {
      labelPrefix: `scene${roundIndex}answer`,
      text: String(round.answer_text || round.subject.name || '').toUpperCase(),
      y: textLayout.answer_y,
      fontSize: textLayout.answer_font_size,
      color: textLayout.accent_color,
      fontPart,
      outlineWidth: textLayout.outline_width,
      depthPx: textLayout.depth_px,
      startSeconds: round.local.answer_start_seconds,
      endSeconds: sceneTextEnd,
    });
    filters.push(`[${currentLabel}]format=rgba[scene${roundIndex}]`);
  });

  let currentSceneOutput = 'scene0';
  for (let roundIndex = 1; roundIndex < renderPlan.rounds.length; roundIndex += 1) {
    const previousRound = renderPlan.rounds[roundIndex - 1];
    const nextOutputLabel = `sceneout${roundIndex}`;
    filters.push(
      `[${currentSceneOutput}][scene${roundIndex}]xfade=transition=slideleft:duration=${previousRound.transition_duration_seconds}:offset=${renderPlan.rounds[roundIndex].scene_start_seconds}[${nextOutputLabel}]`,
    );
    currentSceneOutput = nextOutputLabel;
  }
  filters.push(`[${currentSceneOutput}]format=yuv420p[vout]`);
  return { script: `${filters.join(';\n')}\n` };
}
