import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_VIDEO_CHANNEL_CONFIG_PATH = 'services/product-video-agent/config/channels/poke-quizz-youtube.json';
export const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/config/templates/pokemon/dual-type-reveal.v1.json';
export const DEFAULT_CONFIG_PATH = 'services/product-video-agent/config.example.json';
export const DEFAULT_CHANNEL_SELECTOR = 'poke-quizz-youtube';
export const DEFAULT_GENRE_LABEL = 'Type Combination';
export const DEFAULT_REVIEW_PRESENTATION = Object.freeze({
  genre_label: DEFAULT_GENRE_LABEL,
  summary_with_pair_prefix: 'Publish preview for',
  summary_without_pair_prefix: 'Publish preview',
  feedback_summary_prefix: 'Regenerate preview with operator feedback for',
  delete_summary_prefix: 'Delete the current preview for',
  collapsed_deleted_prefix: 'Deleted preview for',
  collapsed_withdrawn_prefix: 'Withdrawn published video for',
  collapsed_revision_prefix: 'Feedback recorded for',
  approve_label: 'Publish',
  reject_label: 'Give Feedback',
  delete_label: 'Delete',
  event_body_fallback: 'Publish this preview.',
  event_summary_fallback: 'Publish this preview.',
  response_patterns: Object.freeze([
    'approve TASK-123',
    'reject TASK-123 because <feedback to use in the next preview>',
    'delete TASK-123',
  ]),
  feedback_seed_prefix: 'poke-quizz-feedback',
});
export const DEFAULT_QUEUE_STATUS_PRESENTATION = Object.freeze({
  title: 'Poke Quizz Queue Status',
  footer_text: 'ORION video queue status',
  not_scheduled_label: 'Not scheduled',
});
export const DEFAULT_GENERATION_PROGRESS_PRESENTATION = Object.freeze({
  footer_text: 'ORION video gen',
  field_labels: Object.freeze({
    genre: 'Genre',
    channel: 'Channel',
    type_pair: 'Type Pair',
    busy_time: 'Busy Time',
    attempt: 'Attempt',
    title: 'Title',
    description: 'Description',
  }),
  status_titles: Object.freeze({
    started: 'Poke Quizz Video Gen - Started',
    running: 'Poke Quizz Video Gen - Running',
    retrying: 'Poke Quizz Video Gen - Retrying',
    failed: 'Poke Quizz Video Gen - Failed',
  }),
  status_descriptions: Object.freeze({
    started: 'Video generation has started. This message will update until the review card is ready.',
    running: 'Rendering is in progress. This message updates while the preview is being assembled.',
    retrying_fallback: 'Render attempt failed, retrying automatically. Transient render issue detected.',
    failed_fallback: 'Video generation stopped: unknown error.',
  }),
});

function normalizeProjectRelativePath(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/');
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

async function loadJsonFile(absolutePath) {
  return JSON.parse(await readFile(absolutePath, 'utf8'));
}

function resolveConfigReference(projectRoot, ownerAbsolutePath, referencePath, fallbackPath = '') {
  const normalizedReference = String(referencePath || '').trim();
  if (!normalizedReference) {
    return fallbackPath ? resolve(projectRoot, fallbackPath) : '';
  }

  if (isAbsolute(normalizedReference)) {
    return normalizedReference;
  }

  if (
    normalizedReference.startsWith('services/')
    || normalizedReference.startsWith('data/')
    || normalizedReference.startsWith('scripts/')
  ) {
    return resolve(projectRoot, normalizedReference);
  }

  return resolve(dirname(ownerAbsolutePath), normalizedReference);
}

function findTemplateEntry(programConfig = {}, templateId = '') {
  const normalizedTemplateId = String(templateId || '').trim();
  if (!normalizedTemplateId) {
    return null;
  }

  return (Array.isArray(programConfig.templates) ? programConfig.templates : [])
    .find((entry) => String(entry?.template_id || '').trim() === normalizedTemplateId) || null;
}

function normalizeTemplateGenreLabelFromRef(templateRef = {}, fallbackLabel = DEFAULT_GENRE_LABEL) {
  const templateId = String(templateRef?.template_id || '').trim().toLowerCase();
  const templateKey = String(templateRef?.template_key || '').trim().toLowerCase();
  const pathHint = String(templateRef?.template_path || '').trim().toLowerCase();
  const selector = `${templateKey}|${templateId}|${pathHint}`;

  if (selector.includes('know-your-shiny')) return 'Know Your Shiny';
  if (selector.includes('cry-match')) return 'Cry Match';
  if (selector.includes('tournament') || selector.includes('showdown')) return 'Tournament';
  if (selector.includes('find-the-shiny')) return 'Find the Shiny';
  if (selector.includes('memory')) return 'Memory';
  if (selector.includes('type-quiz') || selector.includes('type-speed-quiz')) return 'Type Quiz';
  if (selector.includes('dual-type-reveal')) return 'Type Combination';
  return String(fallbackLabel || DEFAULT_GENRE_LABEL).trim() || DEFAULT_GENRE_LABEL;
}

function mergePresentation(defaults, styleValue, channelValue) {
  const merged = {
    ...defaults,
    ...normalizeObject(styleValue),
    ...normalizeObject(channelValue),
  };
  if (defaults.field_labels) {
    merged.field_labels = {
      ...normalizeObject(defaults.field_labels),
      ...normalizeObject(styleValue?.field_labels),
      ...normalizeObject(channelValue?.field_labels),
    };
  }
  if (defaults.status_titles) {
    merged.status_titles = {
      ...normalizeObject(defaults.status_titles),
      ...normalizeObject(styleValue?.status_titles),
      ...normalizeObject(channelValue?.status_titles),
    };
  }
  if (defaults.status_descriptions) {
    merged.status_descriptions = {
      ...normalizeObject(defaults.status_descriptions),
      ...normalizeObject(styleValue?.status_descriptions),
      ...normalizeObject(channelValue?.status_descriptions),
    };
  }
  if (Array.isArray(defaults.response_patterns)) {
    const overridePatterns = Array.isArray(channelValue?.response_patterns)
      ? channelValue.response_patterns
      : Array.isArray(styleValue?.response_patterns)
        ? styleValue.response_patterns
        : defaults.response_patterns;
    merged.response_patterns = [...overridePatterns];
  }
  return merged;
}

export async function loadVideoTemplateContext({
  projectRoot,
  channelConfigPath = DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
} = {}) {
  if (!projectRoot) {
    throw new Error('loadVideoTemplateContext requires a projectRoot.');
  }

  const channelConfigAbsolutePath = resolve(projectRoot, channelConfigPath);
  const channelConfig = await loadJsonFile(channelConfigAbsolutePath);
  const programAbsolutePath = resolveConfigReference(
    projectRoot,
    channelConfigAbsolutePath,
    channelConfig.program_path,
  );
  const stylePackAbsolutePath = resolveConfigReference(
    projectRoot,
    channelConfigAbsolutePath,
    channelConfig.style_pack_path,
  );
  const program = programAbsolutePath
    ? await loadJsonFile(programAbsolutePath)
    : null;
  const stylePack = stylePackAbsolutePath
    ? await loadJsonFile(stylePackAbsolutePath)
    : null;
  const templateId = String(
    channelConfig.template_id
    || program?.default_template_id
    || '',
  ).trim();
  const templateEntry = findTemplateEntry(program, templateId);
  const templateAbsolutePath = resolveConfigReference(
    projectRoot,
    programAbsolutePath || channelConfigAbsolutePath,
    templateEntry?.path || channelConfig.template_path,
    DEFAULT_TEMPLATE_PATH,
  );
  const reviewPresentation = mergePresentation(
    DEFAULT_REVIEW_PRESENTATION,
    stylePack?.review,
    channelConfig?.review,
  );
  reviewPresentation.genre_label = String(
    reviewPresentation.genre_label || DEFAULT_GENRE_LABEL,
  ).trim() || DEFAULT_GENRE_LABEL;
  const queueStatusPresentation = mergePresentation(
    DEFAULT_QUEUE_STATUS_PRESENTATION,
    stylePack?.queue_status,
    channelConfig?.queue_status,
  );
  const generationProgressPresentation = mergePresentation(
    DEFAULT_GENERATION_PROGRESS_PRESENTATION,
    stylePack?.generation_progress,
    channelConfig?.generation_progress,
  );

  return {
    channelConfig,
    channelConfigPath: normalizeProjectRelativePath(projectRoot, channelConfigAbsolutePath),
    program,
    programPath: programAbsolutePath
      ? normalizeProjectRelativePath(projectRoot, programAbsolutePath)
      : '',
    stylePack,
    stylePackPath: stylePackAbsolutePath
      ? normalizeProjectRelativePath(projectRoot, stylePackAbsolutePath)
      : '',
    templateId,
    templatePath: normalizeProjectRelativePath(projectRoot, templateAbsolutePath),
    publicationChannelSelector: String(
      channelConfig.publication_channel_selector || DEFAULT_CHANNEL_SELECTOR,
    ).trim() || DEFAULT_CHANNEL_SELECTOR,
    genreLabel: reviewPresentation.genre_label,
    reviewPresentation,
    queueStatusPresentation,
    generationProgressPresentation,
  };
}

export async function resolveVideoTemplateRuntime({
  projectRoot,
  channelConfigPath = DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  templatePath = '',
  configPath = '',
  channelSelector = '',
} = {}) {
  const context = await loadVideoTemplateContext({
    projectRoot,
    channelConfigPath,
  });
  const effectiveTemplatePath = String(templatePath || context.templatePath || DEFAULT_TEMPLATE_PATH).trim();
  let genreLabel = context.genreLabel;
  if (effectiveTemplatePath && effectiveTemplatePath !== context.templatePath) {
    const overrideTemplateAbsolutePath = resolve(projectRoot, effectiveTemplatePath);
    const overrideTemplate = await loadJsonFile(overrideTemplateAbsolutePath);
    genreLabel = normalizeTemplateGenreLabelFromRef({
      template_id: overrideTemplate?.template_id,
      template_key: overrideTemplate?.template_key,
      template_path: effectiveTemplatePath,
    }, context.genreLabel);
  }

  return {
    ...context,
    templatePath: effectiveTemplatePath,
    configPath: String(configPath || DEFAULT_CONFIG_PATH).trim(),
    channelSelector: String(channelSelector || context.publicationChannelSelector || DEFAULT_CHANNEL_SELECTOR).trim(),
    genreLabel,
  };
}
