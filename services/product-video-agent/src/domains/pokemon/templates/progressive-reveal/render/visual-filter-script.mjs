import { formatEnableBetween } from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  escapeDrawtextText,
  escapeFilterPath,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildBackgroundPreparationFilter } from '../../shared/render/background-motion.mjs';
import { appendProgressiveRevealFilters } from '../../shared/render/progressive-reveal-engine.mjs';

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

function formatMethodLabel(method) {
  const labels = {
    wipe: 'SCAN REVEAL',
    fragments: 'FRAGMENT REVEAL',
    strips: 'STRIP REVEAL',
    noise: 'NOISE REVEAL',
    particles: 'PIXEL REVEAL',
  };
  return labels[method] || 'PROGRESSIVE REVEAL';
}

function resolveHeadlineLines(template) {
  const configured = Array.isArray(template?.question_contract?.headline_lines)
    ? template.question_contract.headline_lines
    : [];
  const lines = configured.map((value) => String(value || '').trim()).filter(Boolean);
  return lines.length > 0 ? lines.slice(0, 2) : ['GUESS THE POKEMON', 'BEFORE IT IS REVEALED'];
}

function appendProgressBar(filters, currentLabel, round, renderPlan, roundIndex) {
  const { progress_bar: progressBar, canvas } = renderPlan;
  const start = round.local.reveal_start_seconds;
  const end = round.local.reveal_complete_seconds;
  const trackLabel = `scene${roundIndex}progressTrack`;
  filters.push(
    `[${currentLabel}]drawbox=x=${progressBar.x}:y=${progressBar.y}:w=${progressBar.width}:h=${progressBar.height}:color=${progressBar.track_color}:t=fill:enable='${formatEnableBetween(start, end)}'[${trackLabel}]`,
  );
  const progress = `clip((t-${start})/${round.reveal_duration_seconds},0,1)`;
  const barSourceLabel = `scene${roundIndex}progressSource`;
  const barScaledLabel = `scene${roundIndex}progressScaled`;
  filters.push(
    `color=c=${progressBar.fill_color}:s=${progressBar.width}x${progressBar.height}:r=${canvas.fps}:d=${round.scene_duration_seconds},format=rgba[${barSourceLabel}]`,
  );
  filters.push(
    `[${barSourceLabel}]scale=w='max(2,${progressBar.width}*${progress})':h=${progressBar.height}:eval=frame[${barScaledLabel}]`,
  );
  const fillLabel = `scene${roundIndex}progressFill`;
  filters.push(
    `[${trackLabel}][${barScaledLabel}]overlay=x=${progressBar.x}:y=${progressBar.y}:enable='${formatEnableBetween(start, end)}'[${fillLabel}]`,
  );
  const borderLabel = `scene${roundIndex}progressBorder`;
  filters.push(
    `[${fillLabel}]drawbox=x=${progressBar.x}:y=${progressBar.y}:w=${progressBar.width}:h=${progressBar.height}:color=${progressBar.border_color}:t=3:enable='${formatEnableBetween(start, end)}'[${borderLabel}]`,
  );
  return borderLabel;
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

    const questionLabel = `scene${roundIndex}question`;
    filters.push(
      `[${currentLabel}]drawtext=text='?'${fontPart}:fontcolor=white@0.2:fontsize=${Math.round(box.height * 0.46)}:borderw=0:fix_bounds=1:x=(w-text_w)/2:y=${roundTime(box.center_y - (box.height * 0.3))}:enable='${formatEnableBetween(0, round.local.reveal_start_seconds)}'[${questionLabel}]`,
    );
    currentLabel = questionLabel;

    const spriteInput = inputRefs.rounds[roundIndex].sprite;
    const spriteBaseLabel = `round${roundIndex}spriteBase`;
    filters.push(
      `[${spriteInput}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=${box.sprite_size_px}:${box.sprite_size_px}:force_original_aspect_ratio=decrease:flags=neighbor,format=rgba,setsar=1[${spriteBaseLabel}]`,
    );
    const revealedSpriteLabel = `round${roundIndex}spriteRevealed`;
    appendProgressiveRevealFilters(filters, {
      inputLabel: spriteBaseLabel,
      outputLabel: revealedSpriteLabel,
      method: round.reveal_method,
      seed: round.reveal_seed,
      startSeconds: round.local.reveal_start_seconds,
      durationSeconds: round.reveal_duration_seconds,
      fps,
      difficulty: round.reveal_difficulty,
      config: round.reveal_config,
    });
    const spriteSceneLabel = `scene${roundIndex}sprite`;
    filters.push(
      `[${currentLabel}][${revealedSpriteLabel}]overlay=x=${box.center_x}-w/2:y=${box.center_y}-h/2:enable='${formatEnableBetween(round.local.reveal_start_seconds, round.local.scene_duration_seconds)}'[${spriteSceneLabel}]`,
    );
    currentLabel = spriteSceneLabel;

    currentLabel = appendProgressBar(filters, currentLabel, round, renderPlan, roundIndex);

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
    const methodLabel = `scene${roundIndex}method`;
    filters.push(
      `[${currentLabel}]drawtext=text='${formatMethodLabel(round.reveal_method)}'${fontPart}:fontcolor=white@0.9:fontsize=${textLayout.method_font_size}:borderw=4:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${textLayout.method_y}:enable='${formatEnableBetween(round.local.reveal_start_seconds, round.local.reveal_complete_seconds)}'[${methodLabel}]`,
    );
    currentLabel = methodLabel;

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
