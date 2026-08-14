import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DEFAULT_FONT_CANDIDATES,
  DEFAULT_HOOK_FONT_SIZE,
  DEFAULT_REVEAL_TEXT_DELAY_SECONDS,
  ensureNumber,
  slugify,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildProgressiveTextArtifacts } from '../../dual-type-reveal/render/text-layout.mjs';

function resolveTextPosition(template, key, fallbackY) {
  return ensureNumber(template?.layout?.text?.[key], fallbackY);
}

function buildOptionTextArtifacts(options, { template, startSeconds, endSeconds }) {
  const fontSize = ensureNumber(template?.layout?.text?.option_font_size, 82);
  const baseX = ensureNumber(template?.layout?.text?.options_x, 136);
  const startY = ensureNumber(template?.layout?.text?.options_start_y, 1220);
  const lineGap = ensureNumber(template?.layout?.text?.option_line_gap_px, 116);
  const optionLines = Array.isArray(options) ? options : [];
  return {
    font_size: fontSize,
    lines: optionLines.map((option, index) => ({
      text: `${option.label}. ${option.name}`,
      font_size: fontSize,
      x: baseX,
      y: startY + (index * lineGap),
      start_seconds: startSeconds,
      end_seconds: endSeconds,
    })),
  };
}

export function buildTextArtifacts({ renderPlan, template }) {
  const hookEndSeconds = ensureNumber(
    renderPlan.phases?.memorize?.end_seconds,
    renderPlan.phases?.hook?.end_seconds,
  );
  const revealTextStartSeconds = Math.min(
    Math.max(0, renderPlan.total_duration_seconds - 0.12),
    ensureNumber(
      renderPlan.audio_cues?.reveal_start_seconds,
      renderPlan.phases.reveal.start_seconds,
    ) + DEFAULT_REVEAL_TEXT_DELAY_SECONDS,
  );
  return {
    hook: buildProgressiveTextArtifacts(renderPlan.text.hook, {
      template,
      fontSize: ensureNumber(template?.layout?.text?.hook_font_size, DEFAULT_HOOK_FONT_SIZE),
      maxLines: 2,
      baseY: resolveTextPosition(template, 'hook_y', 250),
      startSeconds: renderPlan.phases.hook.start_seconds,
      endSeconds: hookEndSeconds,
    }),
    question: buildProgressiveTextArtifacts(renderPlan.text.question, {
      template,
      fontSize: ensureNumber(template?.layout?.text?.question_font_size, 88),
      maxLines: 3,
      baseY: resolveTextPosition(template, 'question_y', 1020),
      startSeconds: renderPlan.phases.question.start_seconds,
      endSeconds: renderPlan.phases.reveal.start_seconds,
    }),
    options: buildOptionTextArtifacts(renderPlan.question?.options || [], {
      template,
      startSeconds: renderPlan.phases.question.start_seconds,
      endSeconds: renderPlan.total_duration_seconds,
    }),
    reveal: buildProgressiveTextArtifacts(renderPlan.text.reveal, {
      template,
      fontSize: ensureNumber(template?.layout?.text?.reveal_font_size, 110),
      maxLines: 2,
      baseY: resolveTextPosition(template, 'reveal_y', 1690),
      startSeconds: revealTextStartSeconds,
      endSeconds: renderPlan.total_duration_seconds,
    }),
  };
}

async function writeRoleLines(drawtextRoot, plan, role, lines) {
  return Promise.all((lines || []).map(async (line, index) => {
    const filePath = resolve(drawtextRoot, `${slugify(plan.seed)}-${role}-${String(index + 1).padStart(2, '0')}.txt`);
    await writeFile(filePath, `${line.text}\n`, 'utf8');
    return {
      ...line,
      file_path: filePath,
    };
  }));
}

export async function writeDrawtextArtifacts({ runtimeRoot, plan, textArtifacts }) {
  const drawtextRoot = resolve(runtimeRoot, 'drawtext');
  await mkdir(drawtextRoot, { recursive: true });
  return {
    hook: {
      ...textArtifacts.hook,
      segments: await writeRoleLines(drawtextRoot, plan, 'hook', textArtifacts.hook.segments || textArtifacts.hook.lines || []),
    },
    question: {
      ...textArtifacts.question,
      segments: await writeRoleLines(drawtextRoot, plan, 'question', textArtifacts.question.segments || textArtifacts.question.lines || []),
    },
    options: {
      ...textArtifacts.options,
      segments: await writeRoleLines(drawtextRoot, plan, 'options', textArtifacts.options.lines || []),
    },
    reveal: {
      ...textArtifacts.reveal,
      segments: await writeRoleLines(drawtextRoot, plan, 'reveal', textArtifacts.reveal.segments || textArtifacts.reveal.lines || []),
    },
  };
}

export async function resolveFontPath(fontCandidates = DEFAULT_FONT_CANDIDATES) {
  for (const filePath of fontCandidates) {
    try {
      await access(filePath);
      return filePath;
    } catch {
      // Continue until a readable font is found.
    }
  }
  return null;
}
