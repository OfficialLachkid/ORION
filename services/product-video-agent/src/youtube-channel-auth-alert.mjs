// YouTube channel auth-failure alerting.
//
// Each ORION YouTube channel has TWO independent auth channels that
// can fail silently and strand the pipeline:
//
//   1. OAuth refresh token (upload / analytics / delete / comments)
//      Google invalidates refresh tokens when: the token hasn't been
//      used in 6 months, the account password changed, the operator
//      revoked app access, >50 refresh tokens are outstanding for the
//      same OAuth client, or Google's own security triggers fire.
//      Symptom: `refresh_token` grant returns 400 `invalid_grant` or
//      401 `invalid_client`.
//
//   2. Browser session cookies (related-video via YouTube Studio).
//      Playwright user-data-dir profiles expire ~weekly; cookies get
//      invalidated by security sweeps on Google's side. The automation
//      returns `status: 'login_required'`.
//
// Both failure modes used to be silent — logged to stderr somewhere
// and that was it (operator flagged 2026-10-14, poke-quizz silently
// lost its related-video capability for a stretch). This module is
// the counter-pressure: when either path fails for a known channel,
// post a tight alert to #alerts with the channel + what we were
// trying to do + the recovery command, deduped per channel+authType
// to avoid flood-posting if the night-shift burns through 30 videos
// against a dead token.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STATE_SUBPATH = 'data/runtime/discord-bot/youtube-channel-auth-alert-state.json';

// Discriminator values used in the state file + alert body.
export const AUTH_TYPE_OAUTH = 'oauth';
export const AUTH_TYPE_BROWSER_SESSION = 'browser_session';

// Classify a thrown YouTube refresh error (or a raw { status, bodyText }
// pair) into one of our canonical buckets. Only `invalid_grant` and
// `unauthorized` are treated as fatal — 5xx / 429 / network errors
// stay `transient` and must NOT trigger an alert; those are Google
// having a bad day, not the channel being locked out.
export function classifyYoutubeAuthError({ status = 0, bodyText = '', error = null } = {}) {
  const normalizedStatus = Number(status) || 0;
  const haystack = String(bodyText || error?.message || '').toLowerCase();
  if (haystack.includes('invalid_grant')) return 'invalid_grant';
  if (haystack.includes('invalid_client')) return 'invalid_client';
  if (normalizedStatus === 401 || haystack.includes('unauthorized')) return 'unauthorized';
  if (normalizedStatus === 400 && haystack.includes('invalid_scope')) return 'invalid_scope';
  if (normalizedStatus >= 500 || normalizedStatus === 429) return 'transient';
  if (normalizedStatus === 0) return 'unknown'; // likely network
  return 'unknown';
}

export function isFatalAuthClassification(classification) {
  return (
    classification === 'invalid_grant'
    || classification === 'invalid_client'
    || classification === 'unauthorized'
    || classification === 'invalid_scope'
  );
}

// Extract { status, bodyText } from the throw string that
// `refreshYoutubeAccessToken` uses: "...failed (400): <bodyText>".
// Returns {status:0, bodyText:''} if the pattern doesn't match so the
// classifier falls through to `unknown`.
export function parseYoutubeOauthErrorMessage(message) {
  const normalized = String(message || '');
  const match = /\((\d{3})\):\s*([\s\S]*)$/u.exec(normalized);
  if (!match) return { status: 0, bodyText: normalized };
  return { status: Number(match[1]), bodyText: match[2].trim() };
}

// Default stateful dedup store, backed by a JSON file. Keeps a map of
// `${channelKey}|${authType}` → lastAlertedIso. Any read error (missing
// file, bad JSON) is swallowed so the first-ever call still fires.
// Reads + writes are small (few hundred bytes) so no concurrency control
// beyond "last writer wins" — in practice there's one alerting path.
function defaultStateStore({ projectRoot, now = () => new Date(), windowMs = DEFAULT_DEDUP_WINDOW_MS } = {}) {
  const statePath = resolve(projectRoot, DEFAULT_STATE_SUBPATH);
  return {
    async shouldSuppress(key) {
      try {
        const raw = JSON.parse(await readFile(statePath, 'utf8'));
        const lastIso = raw?.alerts?.[key];
        if (!lastIso) return false;
        const lastAt = new Date(lastIso);
        if (Number.isNaN(lastAt.valueOf())) return false;
        return (now().valueOf() - lastAt.valueOf()) < windowMs;
      } catch {
        return false;
      }
    },
    async record(key) {
      let state = { alerts: {} };
      try {
        state = JSON.parse(await readFile(statePath, 'utf8')) || state;
        if (!state.alerts || typeof state.alerts !== 'object') state.alerts = {};
      } catch { /* empty state is fine */ }
      state.alerts[key] = now().toISOString();
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    },
  };
}

export function buildAuthAlertBody({ channelKey, authType, action, errorDetail, recoveryCommand }) {
  const title = authType === AUTH_TYPE_BROWSER_SESSION
    ? `YouTube Studio session expired · ${channelKey}`
    : `YouTube OAuth token invalid · ${channelKey}`;
  const explain = authType === AUTH_TYPE_BROWSER_SESSION
    ? 'Related-video automation can\'t run because the Playwright profile is logged out.'
    : 'Upload / analytics / comment APIs can\'t get an access token — the refresh token was rejected.';
  const detail = errorDetail ? `\nDetail: \`${String(errorDetail).slice(0, 300)}\`` : '';
  const context = action ? `\nFailed during: **${action}**` : '';
  // Multi-line recovery blocks use a fenced code block so Discord
  // renders the command line-wrapped and copy-pasteable as a single
  // chunk; single-line commands stay inline for compactness.
  const hasRecovery = Boolean(recoveryCommand);
  const multiLineRecovery = hasRecovery && String(recoveryCommand).includes('\n');
  const recovery = !hasRecovery
    ? ''
    : multiLineRecovery
      ? `\n\nRecovery (paste in Terminal on the Mac):\n\`\`\`bash\n${recoveryCommand}\n\`\`\``
      : `\n\nRecovery:\n\`${recoveryCommand}\``;
  return `**${title}**\n\n${explain}${context}${detail}${recovery}`;
}

export function buildRecoveryCommand({ channelKey, authType, profileDir = '', sessionName = '' } = {}) {
  if (authType === AUTH_TYPE_BROWSER_SESSION) {
    // Related-video automation uses a channel-specific Playwright
    // user-data-dir (profile_dir in publication-channels config). To
    // re-establish the session the operator opens Chrome in headed
    // mode against the same profile, logs in on YouTube Studio, and
    // closes — cookies persist back to the dir and the next headless
    // sweep picks them up. When the caller passes the actual
    // profile_dir + session_name, we hand back a ready-to-paste
    // multi-line command; when it doesn't (test harnesses, generic
    // calls) we fall back to a hint.
    const dir = String(profileDir || '').trim();
    const session = String(sessionName || '').trim();
    if (dir && session) {
      return [
        `playwright-cli -s ${session} open "https://studio.youtube.com" \\`,
        '  --browser chrome \\',
        '  --headed \\',
        '  --persistent \\',
        `  --profile ${dir}`,
      ].join('\n');
    }
    return `See publication-channels.example.json for the Playwright profile_dir / session_name on ${channelKey}; open it with playwright-cli --headed --persistent, sign in, close.`;
  }
  return `node scripts/youtube-authorize.mjs --channel ${channelKey}`;
}

// Core entrypoint. Non-throwing: a Discord blip here must never mask
// the underlying auth failure (the caller still throws its own error).
// Returns `{ posted, deduped, reason }` for the test harness.
export async function alertYoutubeChannelAuthFailure({
  channelKey,
  authType,
  action = '',
  errorDetail = '',
  profileDir = '',
  sessionName = '',
  discordPostImpl,
  stateStore,
  now = () => new Date(),
}) {
  const normalizedChannel = String(channelKey || '').trim();
  const normalizedAuth = String(authType || '').trim();
  if (!normalizedChannel || !normalizedAuth) {
    return { posted: false, deduped: false, reason: 'missing_channel_or_auth_type' };
  }

  const key = `${normalizedChannel}|${normalizedAuth}`;
  if (stateStore && await stateStore.shouldSuppress(key)) {
    return { posted: false, deduped: true, reason: 'within_dedup_window' };
  }

  if (typeof discordPostImpl !== 'function') {
    return { posted: false, deduped: false, reason: 'no_discord_impl' };
  }

  const body = buildAuthAlertBody({
    channelKey: normalizedChannel,
    authType: normalizedAuth,
    action,
    errorDetail,
    recoveryCommand: buildRecoveryCommand({
      channelKey: normalizedChannel,
      authType: normalizedAuth,
      profileDir,
      sessionName,
    }),
  });
  try {
    await discordPostImpl({ body, channelKey: normalizedChannel, authType: normalizedAuth, action, errorDetail, now: now() });
  } catch {
    return { posted: false, deduped: false, reason: 'discord_post_failed' };
  }

  if (stateStore) {
    try {
      await stateStore.record(key);
    } catch {
      // Record failure doesn't change the fact that we did post —
      // but means the next call may double-post. Acceptable trade.
    }
  }
  return { posted: true, deduped: false };
}

// Convenience factory the production code uses: wires the real Discord
// post + state store so each call site stays a one-liner. Separated
// from `alertYoutubeChannelAuthFailure` above so tests inject their
// own impls directly instead of touching the real filesystem / network.
export function createYoutubeAuthAlerter({
  config,
  projectRoot,
  fetchImpl = globalThis.fetch,
  windowMs = DEFAULT_DEDUP_WINDOW_MS,
  now = () => new Date(),
} = {}) {
  const alertsChannelId = String(config?.channelIds?.alerts || '').trim();
  const token = String(config?.env?.DISCORD_BOT_TOKEN || '').trim();
  const stateStore = projectRoot ? defaultStateStore({ projectRoot, now, windowMs }) : null;
  const discordPostImpl = (alertsChannelId && token)
    ? async ({ body }) => {
      const response = await fetchImpl(`https://discord.com/api/v10/channels/${alertsChannelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: body }),
      });
      if (!response.ok) {
        throw new Error(`Discord alert post failed (${response.status})`);
      }
    }
    : null;

  return async function fire(params) {
    return alertYoutubeChannelAuthFailure({ ...params, discordPostImpl, stateStore, now });
  };
}
