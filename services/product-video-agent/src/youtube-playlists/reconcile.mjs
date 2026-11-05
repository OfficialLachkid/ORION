import {
  buildPlaylistTargetTitle,
  buildPlaylistTemplateTitle,
  YOUTUBE_PLAYLIST_CONFIGURATION_VERSION,
} from './classification.mjs';
import { updateYoutubePlaylist } from './youtube-api.mjs';

const TEMPLATE_PREFIX = 'template:';
const ALL_DIFFICULTIES_SUFFIX = /\s+—\s+All Difficulties$/u;

function desiredRegistryTitle(entry = {}) {
  const playlistKey = String(entry.playlist_key || '').trim();
  if (!playlistKey.startsWith(TEMPLATE_PREFIX)) return String(entry.title || '').trim();
  const templateKey = playlistKey.slice(TEMPLATE_PREFIX.length);
  const currentBaseTitle = String(entry.title || '').replace(ALL_DIFFICULTIES_SUFFIX, '').trim();
  return buildPlaylistTargetTitle({
    template_key: templateKey,
    template_title: buildPlaylistTemplateTitle(templateKey, currentBaseTitle),
  });
}

export function planYoutubePlaylistRegistryReconciliation({ entries = [], accountKey } = {}) {
  const scoped = (Array.isArray(entries) ? entries : [])
    .filter((entry) => String(entry.account_key || '') === String(accountKey || ''));
  const items = scoped.map((entry) => {
    const desiredTitle = desiredRegistryTitle(entry);
    const titleChanged = desiredTitle !== String(entry.title || '').trim();
    const versionChanged = entry.configuration_version !== YOUTUBE_PLAYLIST_CONFIGURATION_VERSION;
    return {
      entry,
      desired_title: desiredTitle,
      title_changed: titleChanged,
      version_changed: versionChanged,
      remote_update_required: titleChanged
        && entry.status === 'active'
        && Boolean(String(entry.youtube_playlist_id || '').trim()),
      registry_update_required: titleChanged || versionChanged,
    };
  });
  return {
    account_key: accountKey,
    dry_run: true,
    configuration_version: YOUTUBE_PLAYLIST_CONFIGURATION_VERSION,
    entries_examined: items.length,
    remote_updates: items.filter((item) => item.remote_update_required).length,
    registry_updates: items.filter((item) => item.registry_update_required).length,
    estimated_write_quota_units: items.filter((item) => item.remote_update_required).length * 50,
    items,
  };
}

export async function reconcileYoutubePlaylistRegistry({
  store,
  entries = [],
  accountKey,
  accessToken = '',
  apply = false,
} = {}, dependencies = {}) {
  const plan = planYoutubePlaylistRegistryReconciliation({ entries, accountKey });
  if (!apply) return plan;
  const updateImpl = dependencies.updateYoutubePlaylistImpl || updateYoutubePlaylist;
  const results = [];

  for (const item of plan.items) {
    if (!item.registry_update_required) {
      results.push({ playlist_key: item.entry.playlist_key, status: 'unchanged' });
      continue;
    }
    if (item.remote_update_required) {
      await updateImpl({
        accessToken,
        playlistId: item.entry.youtube_playlist_id,
        title: item.desired_title,
        description: item.entry.description || '',
        privacy: item.entry.privacy || 'public',
      });
    }
    await store.updateYoutubePlaylistRegistryEntry(item.entry.id, {
      title: item.desired_title,
      configuration_version: YOUTUBE_PLAYLIST_CONFIGURATION_VERSION,
      last_error: '',
    });
    results.push({
      playlist_key: item.entry.playlist_key,
      status: 'updated',
      title: item.desired_title,
      remote_updated: item.remote_update_required,
    });
  }

  return { ...plan, dry_run: false, results };
}
