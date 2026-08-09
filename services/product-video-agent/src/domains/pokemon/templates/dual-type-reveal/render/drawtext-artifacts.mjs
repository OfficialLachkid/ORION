import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DEFAULT_FONT_CANDIDATES,
  DEFAULT_HOOK_FONT_SIZE,
  DEFAULT_HOOK_TEXT_Y,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_PROMPT_TEXT_Y,
  DEFAULT_REVEAL_FONT_SIZE,
  DEFAULT_REVEAL_TEXT_DELAY_SECONDS,
  DEFAULT_REVEAL_TEXT_Y,
  ensureNumber,
  slugify,
} from './constants.mjs';
import { buildProgressiveTextArtifacts } from './text-layout.mjs';

export function buildTextArtifacts({ renderPlan, template }) {
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
      fontSize: DEFAULT_HOOK_FONT_SIZE,
      maxLines: 2,
      baseY: DEFAULT_HOOK_TEXT_Y,
      startSeconds: renderPlan.phases.hook.start_seconds,
      endSeconds: renderPlan.phases.hook.end_seconds,
    }),
    prompt: buildProgressiveTextArtifacts(renderPlan.text.prompt, {
      template,
      fontSize: DEFAULT_PROMPT_FONT_SIZE,
      maxLines: 3,
      baseY: DEFAULT_PROMPT_TEXT_Y,
      startSeconds: renderPlan.phases.type_prompt.start_seconds,
      endSeconds: ensureNumber(
        renderPlan.audio_cues?.prompt_end_seconds,
        renderPlan.phases.countdown?.start_seconds ?? renderPlan.phases.reveal.start_seconds,
      ),
    }),
    reveal: buildProgressiveTextArtifacts(renderPlan.text.reveal, {
      template,
      fontSize: DEFAULT_REVEAL_FONT_SIZE,
      maxLines: 2,
      baseY: DEFAULT_REVEAL_TEXT_Y,
      startSeconds: revealTextStartSeconds,
      endSeconds: renderPlan.total_duration_seconds,
    }),
  };
}

export async function writeDrawtextArtifacts({ runtimeRoot, plan, textArtifacts }) {
  const drawtextRoot = resolve(runtimeRoot, 'drawtext');
  await mkdir(drawtextRoot, { recursive: true });

  const writeRoleLines = async (role, lines) => Promise.all(lines.map(async (line, index) => {
    const filePath = resolve(drawtextRoot, `${slugify(plan.seed)}-${role}-${String(index + 1).padStart(2, '0')}.txt`);
    await writeFile(filePath, `${line.text}\n`, 'utf8');
    return {
      ...line,
      file_path: filePath,
    };
  }));

  return {
    hook: {
      ...textArtifacts.hook,
      segments: await writeRoleLines(
        'hook',
        textArtifacts.hook.segments || textArtifacts.hook.lines || [],
      ),
    },
    prompt: {
      ...textArtifacts.prompt,
      segments: await writeRoleLines(
        'prompt',
        textArtifacts.prompt.segments || textArtifacts.prompt.lines || [],
      ),
    },
    reveal: {
      ...textArtifacts.reveal,
      segments: await writeRoleLines(
        'reveal',
        textArtifacts.reveal.segments || textArtifacts.reveal.lines || [],
      ),
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
