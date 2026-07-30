import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

export const DEFAULT_PUBLICATION_SCHEDULE_SLOTS = Object.freeze([
  Object.freeze({ hour: 8, minute: 0 }),
  Object.freeze({ hour: 12, minute: 0 }),
  Object.freeze({ hour: 16, minute: 0 }),
]);

const DailyScheduleSlotSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
}).strict();

const PublicationWorkflowSchema = z.object({
  preview_visibility: z.enum(['private', 'unlisted']).default('unlisted'),
  publish_visibility: z.literal('public').default('public'),
  require_preview_approval: z.boolean().default(true),
  require_publish_approval: z.boolean().default(true),
  delete_preview_on_reject: z.boolean().default(true),
}).strict().default({
  preview_visibility: 'unlisted',
  publish_visibility: 'public',
  require_preview_approval: true,
  require_publish_approval: true,
  delete_preview_on_reject: true,
});

const YouTubeChannelSchema = z.object({
  channel_id: z.string().trim().default(''),
  default_category_id: z.string().trim().min(1).default('24'),
  oauth_client_secret_path: z.string().trim().default(''),
  oauth_refresh_token_env: z.string().trim().default(''),
}).strict().default({
  channel_id: '',
  default_category_id: '24',
  oauth_client_secret_path: '',
  oauth_refresh_token_env: '',
});

export const PublicationChannelProfileSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  niche: z.string().trim().min(1),
  content_lane: z.string().trim().min(1),
  platform: z.literal('youtube_shorts'),
  account_key: z.string().trim().min(1),
  language: z.string().trim().min(1).default('en-US'),
  timezone: z.string().trim().min(1).default('UTC'),
  status: z.enum(['active', 'paused']).default('active'),
  schedule_slots: z.array(DailyScheduleSlotSchema).min(1).default([...DEFAULT_PUBLICATION_SCHEDULE_SLOTS]),
  workflow: PublicationWorkflowSchema,
  youtube: YouTubeChannelSchema,
  metadata: z.record(z.unknown()).default({}),
}).strict();

export const PublicationChannelRegistrySchema = z.object({
  channels: z.array(PublicationChannelProfileSchema).default([]),
}).strict();

export function normalizeScheduleSlots(slots = DEFAULT_PUBLICATION_SCHEDULE_SLOTS) {
  const unique = new Map();
  for (const slot of slots) {
    const parsed = DailyScheduleSlotSchema.parse(slot);
    unique.set(`${parsed.hour}:${parsed.minute}`, parsed);
  }
  return [...unique.values()].sort((left, right) => {
    if (left.hour !== right.hour) return left.hour - right.hour;
    return left.minute - right.minute;
  });
}

export function normalizePublicationChannelProfile(profile) {
  const parsed = PublicationChannelProfileSchema.parse(profile);
  return {
    ...parsed,
    schedule_slots: normalizeScheduleSlots(parsed.schedule_slots),
  };
}

export function toVideoChannelRow(profileInput) {
  const profile = normalizePublicationChannelProfile(profileInput);
  return {
    id: profile.id,
    name: profile.name,
    niche: profile.niche,
    content_lane: profile.content_lane,
    platform: profile.platform,
    account_key: profile.account_key,
    language: profile.language,
    timezone: profile.timezone,
    status: profile.status,
    settings: {
      schedule_slots: profile.schedule_slots,
      timezone: profile.timezone,
      workflow: profile.workflow,
      youtube: profile.youtube,
      metadata: profile.metadata,
    },
  };
}

export async function loadPublicationChannelProfiles(configPath, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const absolutePath = resolve(projectRoot, configPath);
  const payload = JSON.parse(await readFile(absolutePath, 'utf8'));
  const parsed = PublicationChannelRegistrySchema.parse(payload);
  return parsed.channels.map((channel) => normalizePublicationChannelProfile(channel));
}
