// Night-shift auth-alert hooks. Separate module so pokemon-maintenance
// stays under the script-size guardrail.
//
// Alert fires only non-OAuth / browser-session failures discovered by the
// related-video sweep (the OAuth-side alerts fire inside
// refreshYoutubeAccessToken, so we don't need a hook here for those).
// Lazy-imports the alerter so a Discord / config blip can't tank the
// sweep; the alerter is already deduped per channel+authType per 24h,
// so repeated hits in one run collapse to one Discord post.

import { homedir } from 'node:os';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';

// Playwright profile_dir in publication-channels.example.json uses `~`
// for the home directory. Expand it so the recovery command the alert
// posts is directly copy-pasteable into the Mac terminal.
function expandHome(filePath) {
  const value = String(filePath || '').trim();
  if (!value) return '';
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return `${homedir()}/${value.slice(2)}`;
  return value;
}

export async function fireBrowserSessionAlert(runtimeConfig, channelKey, count, profileHints = {}) {
  try {
    const { createYoutubeAuthAlerter, AUTH_TYPE_BROWSER_SESSION } = await import(
      '../../../services/product-video-agent/src/youtube-channel-auth-alert.mjs'
    );
    const fire = createYoutubeAuthAlerter({ config: runtimeConfig, projectRoot });
    await fire({
      channelKey,
      authType: AUTH_TYPE_BROWSER_SESSION,
      action: 'related_video_sweep',
      errorDetail: `${count} row(s) returned login_required from YouTube Studio automation`,
      profileDir: expandHome(profileHints.profileDir),
      sessionName: profileHints.sessionName || '',
    });
  } catch {
    // Alerter must never mask the sweep result.
  }
}
