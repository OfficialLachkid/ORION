import { z } from 'zod';

export const MANUAL_IMAGE_COMMAND_NAME = 'generate-image';
export const MANUAL_IMAGE_MAX_COUNT = 8;
export const MANUAL_IMAGE_MAX_PROMPT_LENGTH = 1500;

export const MANUAL_IMAGE_ASPECT_RATIOS = Object.freeze({
  '1:1': { width: 1024, height: 1024, label: 'Square (1:1)' },
  '16:9': { width: 1024, height: 576, label: 'Landscape (16:9)' },
  '9:16': { width: 576, height: 1024, label: 'Portrait (9:16)' },
  '3:2': { width: 1152, height: 768, label: 'Landscape (3:2)' },
  '2:3': { width: 768, height: 1152, label: 'Portrait (2:3)' },
});

export const ManualImageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(MANUAL_IMAGE_MAX_PROMPT_LENGTH),
  count: z.number().int().min(1).max(MANUAL_IMAGE_MAX_COUNT).nullable().default(null),
  aspect_ratio: z.enum(Object.keys(MANUAL_IMAGE_ASPECT_RATIOS)).default('1:1'),
  transparent_background: z.boolean().default(false),
  requested_by_discord_id: z.string().min(1),
  requested_by_display_name: z.string().min(1),
  guild_id: z.string().min(1),
  channel_id: z.string().min(1),
  interaction_id: z.string().min(1),
  requested_at: z.string().datetime({ offset: true }),
});

function optionValue(interaction, name) {
  const options = Array.isArray(interaction?.data?.options) ? interaction.data.options : [];
  return options.find((option) => option?.name === name)?.value;
}

function requestsTransparency(prompt) {
  return /\b(?:transparent|transparency|alpha background|no background|cutout)\b/iu.test(prompt);
}

export function isManualImageGenerationInteraction(interaction) {
  return interaction?.type === 2
    && String(interaction?.data?.name || '').toLowerCase() === MANUAL_IMAGE_COMMAND_NAME;
}

export function assertManualImageOperator(interaction, config) {
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  if (userId && (config.operatorUserIds || []).includes(userId)) return;
  if (config.operatorRoleId && roles.includes(config.operatorRoleId)) return;
  throw new Error('Only an approved ORION operator can generate images.');
}

export function parseManualImageGenerationRequest(interaction, options = {}) {
  if (!isManualImageGenerationInteraction(interaction)) {
    throw new Error('Unsupported manual image generation interaction.');
  }
  const prompt = String(optionValue(interaction, 'prompt') || '').trim();
  const suppliedCount = optionValue(interaction, 'count');
  const count = suppliedCount === undefined || suppliedCount === null || suppliedCount === ''
    ? null
    : Number(suppliedCount);
  const aspectRatio = String(optionValue(interaction, 'aspect_ratio') || '1:1');
  const user = interaction?.member?.user || interaction?.user || {};
  return ManualImageRequestSchema.parse({
    prompt,
    count,
    aspect_ratio: aspectRatio,
    transparent_background: requestsTransparency(prompt),
    requested_by_discord_id: String(user.id || ''),
    requested_by_display_name: String(
      interaction?.member?.nick || user.global_name || user.username || user.id || 'operator',
    ),
    guild_id: String(interaction?.guild_id || ''),
    channel_id: String(interaction?.channel_id || ''),
    interaction_id: String(interaction?.id || ''),
    requested_at: options.now || new Date().toISOString(),
  });
}

export function dimensionsForAspectRatio(aspectRatio) {
  const dimensions = MANUAL_IMAGE_ASPECT_RATIOS[aspectRatio];
  if (!dimensions) throw new Error(`Unsupported image aspect ratio: ${aspectRatio}.`);
  return { width: dimensions.width, height: dimensions.height };
}
