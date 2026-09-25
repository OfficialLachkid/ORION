import {
  ensureNumber,
  escapeDrawtextText,
} from '../../dual-type-reveal/render/constants.mjs';
import { formatEnableBetween } from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  resolveTournamentBattleStat,
  TOURNAMENT_BATTLE_STATS,
} from '../battle-stat.mjs';

function roundTime(value) {
  return Math.round(ensureNumber(value, 0) * 1000) / 1000;
}

function buildSpinSegments(match) {
  const start = ensureNumber(match?.spinner_spin_start_seconds, 0);
  const stop = Math.max(start, ensureNumber(match?.spinner_stop_seconds, start));
  const duration = Math.max(0.01, stop - start);
  const startIndex = Math.abs(String(match?.match_id || '').split('').reduce(
    (sum, character) => sum + character.codePointAt(0),
    0,
  )) % TOURNAMENT_BATTLE_STATS.length;
  const segments = [];
  let cursor = start;
  let index = 0;
  while (cursor < stop - 0.001) {
    const progress = Math.min(1, (cursor - start) / duration);
    const segmentDuration = Math.min(stop - cursor, 0.09 + (0.31 * progress * progress));
    const end = roundTime(cursor + segmentDuration);
    segments.push({
      stat: TOURNAMENT_BATTLE_STATS[(startIndex + index) % TOURNAMENT_BATTLE_STATS.length],
      start: roundTime(cursor),
      end: Math.min(stop, end),
    });
    cursor = Math.min(stop, end);
    index += 1;
  }
  return segments;
}

export function buildTournamentStatSpinnerFilters(match, template, fontPart = '') {
  const selectedStat = resolveTournamentBattleStat(match?.battle_stat);
  if (!selectedStat) {
    return [];
  }
  const config = template?.layout?.stat_spinner || {};
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const width = Math.max(260, ensureNumber(config.width_px, 440));
  const height = Math.max(100, ensureNumber(config.height_px, 132));
  const x = Math.round(ensureNumber(config.center_x, canvasWidth / 2) - (width / 2));
  const battleNameY = ensureNumber(template?.layout?.battle_stage?.name_y, 1160);
  const nameYOffset = ensureNumber(config.name_y_offset_px, 100);
  const requestedY = config.top_y === undefined
    ? battleNameY + nameYOffset
    : ensureNumber(config.top_y, battleNameY + nameYOffset);
  const canvasHeight = ensureNumber(template?.canvas?.height, 1920);
  const y = Math.round(Math.max(40, Math.min(requestedY, canvasHeight - height - 40)));
  const headerFontSize = Math.max(18, ensureNumber(config.header_font_size, 25));
  const labelFontSize = Math.max(32, ensureNumber(config.label_font_size, 52));
  const appearStart = ensureNumber(match?.spinner_appear_start_seconds, match?.intro_start_seconds);
  const spinStart = ensureNumber(match?.spinner_spin_start_seconds, appearStart);
  const stop = ensureNumber(match?.spinner_stop_seconds, spinStart);
  const reveal = Math.max(stop, ensureNumber(match?.reveal_start_seconds, stop));
  const spinnerEnable = formatEnableBetween(appearStart, reveal);
  const labelCenterY = y + 72;
  const filters = [
    `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=0xFFD60A@0.96:t=4:replace=0:enable='${spinnerEnable}'`,
    `drawbox=x=${x + 5}:y=${y + 5}:w=${width - 10}:h=${height - 10}:color=0x07111F@0.92:t=fill:replace=0:enable='${spinnerEnable}'`,
    `drawtext=text='BATTLE STAT'${fontPart}:fontcolor=0xFFD60A:fontsize=${headerFontSize}:borderw=2:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${y + 12}:enable='${spinnerEnable}'`,
    `drawtext=text='?'${fontPart}:fontcolor=white:fontsize=${labelFontSize}:borderw=3:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${labelCenterY}-text_h/2:enable='${formatEnableBetween(appearStart, spinStart)}'`,
  ];

  buildSpinSegments(match).forEach((segment) => {
    const duration = Math.max(0.01, segment.end - segment.start);
    const yExpression = `${labelCenterY}+20-40*((t-${segment.start})/${duration})-text_h/2`;
    filters.push(
      `drawtext=text='${escapeDrawtextText(segment.stat.label)}'${fontPart}:fontcolor=${segment.stat.color}:fontsize=${labelFontSize}:borderw=3:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${yExpression}':enable='${formatEnableBetween(segment.start, segment.end)}'`,
    );
  });

  filters.push(
    `drawtext=text='${escapeDrawtextText(selectedStat.label)}'${fontPart}:fontcolor=${selectedStat.color}:fontsize=${labelFontSize}:borderw=4:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${labelCenterY}-text_h/2+if(lt(t-${stop}\,0.28)\,(1-(t-${stop})/0.28)*12*sin((t-${stop})*28)\,0)':enable='${formatEnableBetween(stop, reveal)}'`,
  );
  return filters;
}
