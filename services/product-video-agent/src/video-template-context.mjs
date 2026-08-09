import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const DEFAULT_VIDEO_CHANNEL_CONFIG_PATH = 'services/product-video-agent/config/channels/poke-quizz-youtube.json';
export const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/config/templates/pokemon/dual-type-reveal.v1.json';
export const DEFAULT_CONFIG_PATH = 'services/product-video-agent/config.example.json';
export const DEFAULT_CHANNEL_SELECTOR = 'poke-quizz-youtube';
export const DEFAULT_GENRE_LABEL = 'Type Combination';

function normalizeProjectRelativePath(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/');
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
    genreLabel: String(
      stylePack?.review?.genre_label
      || channelConfig?.review?.genre_label
      || DEFAULT_GENRE_LABEL,
    ).trim() || DEFAULT_GENRE_LABEL,
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

  return {
    ...context,
    templatePath: String(templatePath || context.templatePath || DEFAULT_TEMPLATE_PATH).trim(),
    configPath: String(configPath || DEFAULT_CONFIG_PATH).trim(),
    channelSelector: String(channelSelector || context.publicationChannelSelector || DEFAULT_CHANNEL_SELECTOR).trim(),
  };
}
