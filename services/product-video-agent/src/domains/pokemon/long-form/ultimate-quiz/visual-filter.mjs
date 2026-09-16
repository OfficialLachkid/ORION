import {
  escapeDrawtextText,
  escapeFilterPath,
} from '../../templates/dual-type-reveal/render/constants.mjs';
import { buildBackgroundPreparationFilter } from '../../templates/shared/render/background-motion.mjs';

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
  if (round.mode === 'type_clue') return 'TYPE CLUE';
  return 'SILHOUETTE';
}

function typeLabel(round) {
  return (round?.subject?.types || []).map((type) => String(type).toUpperCase()).join('  +  ');
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
    const prepared = buildBackgroundPreparationFilter({
      inputRef: inputRefs.backgrounds[index],
      width,
      height,
      fps,
      blurSigma: 0,
      template,
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
  const darkenAlpha = Math.min(0.75, Math.max(0, Number(template?.layout?.background?.darken_alpha || 0.32)));
  filters.push(`[${backgroundBase}]drawbox=x=0:y=0:w=iw:h=ih:color=black@${darkenAlpha}:t=fill[base]`);

  const state = { label: 'base', index: 0 };
  renderPlan.rounds.forEach((round, index) => {
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
      text: '8 POKEMON  -  1 POINT EACH',
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
      size: 58,
      color: 'white',
      borderWidth: 7,
      y: 145,
      enable: questionEnable,
    }));
    if (round.mode === 'type_clue') {
      appendFilter(filters, state, drawText({
        text: typeLabel(round),
        fontPath,
        size: 55,
        color: round.accent_color,
        borderWidth: 7,
        y: 245,
        enable: questionEnable,
      }));
    }
    appendFilter(
      filters,
      state,
      `drawtext=text='%{eif\\:ceil(${Number(round.answer_start_seconds).toFixed(3)}-t)\\:d}'${fontPart(fontPath)}:fontcolor=0xFFD60A:fontsize=74:borderw=7:bordercolor=black@0.9:fix_bounds=1:x=w-text_w-105:y=865:enable='${questionEnable}'`,
    );
    appendFilter(filters, state, drawText({
      text: round.subject.name.toUpperCase(),
      fontPath,
      size: 78,
      color: round.accent_color,
      borderWidth: 8,
      y: 850,
      enable: answerEnable,
    }));
    appendFilter(filters, state, drawText({
      text: '+1 IF YOU GOT IT RIGHT',
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
