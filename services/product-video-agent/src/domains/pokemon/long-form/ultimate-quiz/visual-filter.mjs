import {
  escapeDrawtextText,
  escapeFilterPath,
} from '../../templates/dual-type-reveal/render/constants.mjs';
import {
  buildAnimatedPopSettleExpression,
  buildScaleFilterTimeExpression,
} from '../../templates/dual-type-reveal/render/animation-expressions.mjs';
import { buildLongFormBackgroundPreparationFilter } from '../background-motion.mjs';

function between(start, end) {
  return `between(t,${Number(start).toFixed(3)},${Number(end).toFixed(3)})`;
}

function fontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function drawText({
  text,
  fontPath,
  size,
  color = 'white',
  borderColor = 'black@0.9',
  borderWidth = 5,
  x = '(w-text_w)/2',
  y,
  enable,
}) {
  return `drawtext=text='${escapeDrawtextText(text)}'${fontPart(fontPath)}:fontcolor=${color}:fontsize=${size}:borderw=${borderWidth}:bordercolor=${borderColor}:shadowx=5:shadowy=7:shadowcolor=black@0.65:fix_bounds=1:x=${x}:y=${y}:enable='${enable}'`;
}

function appendFilter(filters, state, filter) {
  const next = `stage${state.index + 1}`;
  filters.push(`[${state.label}]${filter}[${next}]`);
  state.label = next;
  state.index += 1;
}

function modeLabel(round) {
  if (round.mode === 'cry_clue') return 'CRY CHALLENGE';
  if (round.mode === 'type_clue') return 'TYPE GRID';
  return 'SILHOUETTE';
}

function fixed(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function buildLandscapeGrid(itemCount) {
  const count = Math.max(1, Math.min(6, Number(itemCount || 0)));
  const columns = count <= 3 ? count : count === 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  const itemSize = count <= 2 ? 300 : count <= 4 ? 240 : 210;
  const columnGap = count <= 2 ? 125 : 85;
  const rowGap = 42;
  const gridHeight = (rows * itemSize) + ((rows - 1) * rowGap);
  const originY = rows === 1 ? 415 : 350;
  const cells = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, count - (row * columns));
    const rowWidth = (itemsInRow * itemSize) + ((itemsInRow - 1) * columnGap);
    const rowOriginX = Math.floor((1920 - rowWidth) / 2);
    cells.push({
      centerX: rowOriginX + (column * (itemSize + columnGap)) + (itemSize / 2),
      centerY: originY + (row * (itemSize + rowGap)) + (itemSize / 2),
      itemSize,
    });
  }
  return { cells, itemSize, gridHeight };
}

function appendTypeClueBoard({ filters, state, round, inputRefs, fps, roundIndex }) {
  const start = Number(round.start_seconds);
  const answerStart = Number(round.answer_start_seconds);
  const end = Number(round.end_seconds);
  const duration = Math.max(0.5, end - start);
  const revealDuration = Math.max(0.25, end - answerStart);
  const transitionDuration = Math.min(0.38, Math.max(0.26, revealDuration * 0.38));
  const transitionEnd = Math.min(end, answerStart + transitionDuration);
  const timeExpression = buildScaleFilterTimeExpression({ fps, streamStartSeconds: start });
  const iconSize = 150;
  const iconGap = 44;
  const iconCount = inputRefs.typeIcons.length;
  const iconStartX = (1920 - ((iconCount * iconSize) + ((iconCount - 1) * iconGap))) / 2;

  inputRefs.typeIcons.forEach((inputRef, iconIndex) => {
    const pop = buildAnimatedPopSettleExpression(start, 0.42, 0.05, 1.12, 1, timeExpression);
    const iconLabel = `typeGridIcon${roundIndex}_${iconIndex}`;
    filters.push(
      `[${inputRef}:v]fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS+${fixed(start)}/TB,scale=w='${iconSize}*(${pop})':h='${iconSize}*(${pop})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${iconLabel}]`,
    );
    const next = `typeGridIconStage${roundIndex}_${iconIndex}`;
    filters.push(
      `[${state.label}][${iconLabel}]overlay=x=${fixed(iconStartX + (iconIndex * (iconSize + iconGap)))}+((${iconSize}-w)/2):y=235+((${iconSize}-h)/2):enable='${between(start, end)}':eof_action=pass:shortest=0[${next}]`,
    );
    state.label = next;
  });

  const boardSubjects = Array.isArray(round?.type_board?.subjects) ? round.type_board.subjects : [];
  const grid = buildLandscapeGrid(boardSubjects.length);
  const pokeballBranches = grid.cells.map((_, index) => `typeGridPokeball${roundIndex}_${index}`);
  filters.push(
    `[${inputRefs.pokeball}:v]fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS+${fixed(start)}/TB,format=rgba,split=${pokeballBranches.length}${pokeballBranches.map((label) => `[${label}]`).join('')}`,
  );
  grid.cells.forEach((cell, cellIndex) => {
    const pop = buildAnimatedPopSettleExpression(
      start + (cellIndex * 0.045),
      0.42,
      0.04,
      1.1,
      1,
      timeExpression,
    );
    const shrink = `if(lt(${timeExpression},${fixed(answerStart)}),1,max(0.02,1-((${timeExpression}-${fixed(answerStart)})/${fixed(transitionDuration)})))`;
    const size = fixed(cell.itemSize * 1.08);
    const scaledLabel = `typeGridPokeballScaled${roundIndex}_${cellIndex}`;
    filters.push(
      `[${pokeballBranches[cellIndex]}]scale=w='${size}*(${pop})*(${shrink})':h='${size}*(${pop})*(${shrink})':eval=frame:force_original_aspect_ratio=decrease,setsar=1[${scaledLabel}]`,
    );
    const next = `typeGridBallStage${roundIndex}_${cellIndex}`;
    filters.push(
      `[${state.label}][${scaledLabel}]overlay=x=${fixed(cell.centerX)}-w/2:y=${fixed(cell.centerY)}-h/2:enable='${between(start, transitionEnd)}':eof_action=pass:shortest=0[${next}]`,
    );
    state.label = next;
  });

  inputRefs.boardSprites.forEach((inputRef, cellIndex) => {
    const cell = grid.cells[cellIndex];
    if (!cell) return;
    const pop = buildAnimatedPopSettleExpression(
      answerStart + (cellIndex * 0.025),
      transitionDuration,
      0.03,
      1.12,
      1,
      timeExpression,
    );
    const spriteLabel = `typeGridSprite${roundIndex}_${cellIndex}`;
    filters.push(
      `[${inputRef}:v]fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS+${fixed(start)}/TB,scale=w='${cell.itemSize}*(${pop})':h='${cell.itemSize}*(${pop})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${spriteLabel}]`,
    );
    const next = `typeGridRevealStage${roundIndex}_${cellIndex}`;
    filters.push(
      `[${state.label}][${spriteLabel}]overlay=x=${fixed(cell.centerX)}-w/2:y=${fixed(cell.centerY)}-h/2:enable='${between(answerStart, end)}':eof_action=pass:shortest=0[${next}]`,
    );
    state.label = next;
  });
}

export function buildUltimateQuizVisualFilter({
  plan,
  template,
  renderPlan,
  inputRefs,
  fontPath,
}) {
  const { width, height, fps } = renderPlan.canvas;
  const filters = [];
  const backgroundLabels = [];
  renderPlan.chapters.forEach((chapter, index) => {
    const prepared = buildLongFormBackgroundPreparationFilter({
      inputRef: inputRefs.backgrounds[index],
      width,
      height,
      fps,
      blurSigma: Number(template?.layout?.background?.blur_sigma ?? 6),
      template,
      chapterIndex: index,
      startSeconds: index === 0 ? 0 : Number(chapter.start_seconds),
      endSeconds: Number(chapter.end_seconds),
    });
    const label = `bg${index}`;
    const chapterStart = index === 0 ? 0 : Number(chapter.start_seconds);
    const fade = index === 0
      ? ''
      : `,format=rgba,fade=t=in:st=${chapterStart}:d=1.2:alpha=1`;
    filters.push(`${prepared},trim=duration=${renderPlan.total_duration_seconds},setpts=PTS-STARTPTS${fade}[${label}]`);
    backgroundLabels.push(label);
  });

  let backgroundBase = backgroundLabels[0];
  for (let index = 1; index < backgroundLabels.length; index += 1) {
    const output = `bgmix${index}`;
    filters.push(`[${backgroundBase}][${backgroundLabels[index]}]overlay=eof_action=pass:shortest=0[${output}]`);
    backgroundBase = output;
  }
  filters.push(`[${backgroundBase}]null[base]`);

  const state = { label: 'base', index: 0 };
  renderPlan.rounds.forEach((round, index) => {
    if (round.mode === 'type_clue' && round.type_board) {
      appendTypeClueBoard({
        filters,
        state,
        round,
        inputRefs: inputRefs.rounds[index],
        fps,
        roundIndex: index,
      });
      return;
    }
    const inputRef = inputRefs.rounds[index].sprite;
    const localDuration = Number(round.end_seconds) - Number(round.start_seconds);
    filters.push(
      `[${inputRef}:v]fps=${fps},scale=570:570:force_original_aspect_ratio=decrease,format=rgba,pad=570:570:(ow-iw)/2:(oh-ih)/2:color=0x00000000,setsar=1,trim=duration=${localDuration},setpts=PTS-STARTPTS+${Number(round.start_seconds).toFixed(3)}/TB,split=2[sprite${index}color][sprite${index}silsource]`,
    );
    filters.push(`[sprite${index}silsource]colorchannelmixer=rr=0:gg=0:bb=0:aa=1[sprite${index}silhouette]`);
    const silhouetteEnd = Number(round.answer_start_seconds) - 0.05;
    const silhouetteOutput = `spriteStage${index}a`;
    filters.push(
      `[${state.label}][sprite${index}silhouette]overlay=x=(W-w)/2:y=320:enable='${between(round.start_seconds, silhouetteEnd)}':eof_action=pass:shortest=0[${silhouetteOutput}]`,
    );
    const colorOutput = `spriteStage${index}b`;
    filters.push(
      `[${silhouetteOutput}][sprite${index}color]overlay=x=(W-w)/2:y=320:enable='${between(round.answer_start_seconds, round.end_seconds)}':eof_action=pass:shortest=0[${colorOutput}]`,
    );
    state.label = colorOutput;
  });

  const introEnd = renderPlan.phases.hook.end_seconds;
  appendFilter(filters, state, drawText({
    text: plan?.presentation?.hook_text || 'THE ULTIMATE POKEMON QUIZ',
    fontPath,
    size: 88,
    color: '0xFFD60A',
    borderColor: '0x173A63',
    borderWidth: 8,
    y: 330,
    enable: between(0.4, introEnd - 0.5),
  }));
  appendFilter(filters, state, drawText({
    text: '24 QUESTIONS  -  3 DIFFICULTIES',
    fontPath,
    size: 46,
    color: 'white',
    y: 470,
    enable: between(0.8, introEnd - 0.5),
  }));
  appendFilter(filters, state, drawText({
    text: 'KEEP TRACK OF YOUR SCORE!',
    fontPath,
    size: 48,
    color: '0x7FDBFF',
    y: 580,
    enable: between(1.1, introEnd - 0.5),
  }));

  renderPlan.chapters.forEach((chapter) => {
    const chapterEnable = between(chapter.start_seconds, chapter.questions_start_seconds - 0.1);
    appendFilter(filters, state, drawText({
      text: chapter.label,
      fontPath,
      size: 102,
      color: chapter.accent_color,
      borderColor: 'black@0.95',
      borderWidth: 9,
      y: 385,
      enable: chapterEnable,
    }));
    appendFilter(filters, state, drawText({
      text: '8 QUESTIONS  -  1 POINT EACH',
      fontPath,
      size: 48,
      color: 'white',
      y: 545,
      enable: chapterEnable,
    }));
  });

  renderPlan.rounds.forEach((round) => {
    const questionEnable = between(round.start_seconds, round.answer_start_seconds - 0.05);
    const answerEnable = between(round.answer_start_seconds, round.end_seconds);
    const fullEnable = between(round.start_seconds, round.end_seconds);
    appendFilter(filters, state, drawText({
      text: `${round.chapter_label}  |  QUESTION ${round.round_number} / ${renderPlan.rounds.length}`,
      fontPath,
      size: 38,
      color: round.accent_color,
      x: 70,
      y: 55,
      enable: fullEnable,
    }));
    appendFilter(filters, state, drawText({
      text: modeLabel(round),
      fontPath,
      size: 32,
      color: '0xB9D9FF',
      x: 'w-text_w-70',
      y: 62,
      enable: fullEnable,
    }));
    appendFilter(filters, state, drawText({
      text: round.prompt,
      fontPath,
      size: round.mode === 'type_clue' ? 48 : 58,
      color: 'white',
      borderWidth: 7,
      y: round.mode === 'type_clue' ? 135 : 145,
      enable: questionEnable,
    }));
    appendFilter(
      filters,
      state,
      `drawtext=text='%{eif\\:ceil(${Number(round.answer_start_seconds).toFixed(3)}-t)\\:d}'${fontPart(fontPath)}:fontcolor=0xFFD60A:fontsize=74:borderw=7:bordercolor=black@0.9:fix_bounds=1:x=w-text_w-105:y=865:enable='${questionEnable}'`,
    );
    appendFilter(filters, state, drawText({
      text: round.mode === 'type_clue'
        ? 'WHO DID YOU FORGET?'
        : round.subject.name.toUpperCase(),
      fontPath,
      size: round.mode === 'type_clue' ? 52 : 78,
      color: round.accent_color,
      borderWidth: 8,
      y: round.mode === 'type_clue' ? 875 : 850,
      enable: answerEnable,
    }));
    appendFilter(filters, state, drawText({
      text: round.mode === 'type_clue'
        ? '+1 IF YOU GOT THEM ALL'
        : '+1 IF YOU GOT IT RIGHT',
      fontPath,
      size: 34,
      color: 'white',
      y: 965,
      enable: answerEnable,
    }));
  });

  const outroStart = renderPlan.phases.outro.start_seconds;
  const outroEnable = between(outroStart, renderPlan.total_duration_seconds);
  appendFilter(filters, state, drawText({
    text: 'QUIZ COMPLETE!',
    fontPath,
    size: 100,
    color: '0xFFD60A',
    borderColor: '0x173A63',
    borderWidth: 9,
    y: 265,
    enable: outroEnable,
  }));
  appendFilter(filters, state, drawText({
    text: '0-8 ROOKIE   |   9-16 TRAINER   |   17-23 EXPERT',
    fontPath,
    size: 43,
    color: 'white',
    y: 470,
    enable: outroEnable,
  }));
  appendFilter(filters, state, drawText({
    text: '24 / 24 = POKEMON MASTER',
    fontPath,
    size: 58,
    color: '0x4CD964',
    y: 560,
    enable: outroEnable,
  }));
  appendFilter(filters, state, drawText({
    text: 'SHARE YOUR SCORE IN THE COMMENTS!',
    fontPath,
    size: 52,
    color: '0x7FDBFF',
    y: 710,
    enable: outroEnable,
  }));

  filters.push(`[${state.label}]format=yuv420p[vout]`);
  return { script: `${filters.join(';\n')}\n` };
}
