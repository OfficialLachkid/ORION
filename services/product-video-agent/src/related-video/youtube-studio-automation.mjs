import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function expandHomeDirectory(inputPath) {
  const value = String(inputPath || '').trim();
  if (!value) {
    return '';
  }
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return resolve(os.homedir(), value.slice(2));
  }
  return value;
}

// Force English UI via ?hl=en so the automation's button-name selectors
// (matching /related video/i, /save/i, /done/i, /show more/i) work regardless
// of the operator account's Studio language setting. Without this, a Dutch
// account rendered "Gerelateerde video" and the selector silently returned
// nothing — the automation reached Studio but never found the picker, yielding
// apply_status='unknown' with zero real changes (observed 2026-08-05 against
// the Poke Quizz channel). ?hl=en only affects the automation's Chromium
// profile session; the operator's own browser stays on their preferred locale.
function buildStudioEditUrl(externalId) {
  const normalized = String(externalId || '').trim();
  return normalized ? `https://studio.youtube.com/video/${normalized}/edit?hl=en` : '';
}

function createRunnerResult(executable, args, result) {
  return {
    executable,
    args,
    ok: result.status === 0 && !result.error,
    exitCode: result.status ?? null,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : '',
  };
}

function defaultCliRunner(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: Number(options.timeoutMs) || 60_000,
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
  });
  return createRunnerResult(executable, args, result);
}

function parseJsonPayload(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function resolveYoutubeRelatedVideoAutomationSettings(channelProfile = {}) {
  const relatedVideo = channelProfile?.metadata?.related_video || {};
  return {
    enabled: relatedVideo.enabled === true,
    provider: String(relatedVideo.provider || 'youtube_studio').trim() || 'youtube_studio',
    executable: String(relatedVideo.executable || 'playwright-cli').trim() || 'playwright-cli',
    browser: String(relatedVideo.browser || 'chrome').trim() || 'chrome',
    profileDir: expandHomeDirectory(relatedVideo.profile_dir || relatedVideo.profileDir || ''),
    sessionName: String(
      relatedVideo.session_name
        || relatedVideo.sessionName
        || `yt-related-${channelProfile.account_key || 'channel'}`,
    ).trim(),
    headed: relatedVideo.headed === true,
    channelId: String(channelProfile?.youtube?.channel_id || '').trim(),
  };
}

export function probeYoutubeRelatedVideoCapability({
  channelProfile,
  publication,
  relatedVideo,
  fsExists = existsSync,
} = {}) {
  const settings = resolveYoutubeRelatedVideoAutomationSettings(channelProfile);
  const relatedStatus = normalizeToken(relatedVideo?.selection_status || '');

  if (settings.enabled !== true) {
    return {
      status: 'disabled',
      canAttempt: false,
      settings,
      studioEditUrl: buildStudioEditUrl(publication?.external_id),
      reason: 'Related-video automation is disabled for this channel.',
    };
  }
  if (normalizeToken(channelProfile?.platform) !== 'youtube_shorts') {
    return {
      status: 'unsupported_platform',
      canAttempt: false,
      settings,
      studioEditUrl: buildStudioEditUrl(publication?.external_id),
      reason: `Platform ${channelProfile?.platform || 'unknown'} is not supported.`,
    };
  }
  if (settings.provider !== 'youtube_studio') {
    return {
      status: 'unsupported_provider',
      canAttempt: false,
      settings,
      studioEditUrl: buildStudioEditUrl(publication?.external_id),
      reason: `Provider ${settings.provider} is not supported.`,
    };
  }
  if (relatedStatus !== 'planned') {
    return {
      status: relatedStatus ? `selection_${relatedStatus}` : 'no_selection',
      canAttempt: false,
      settings,
      studioEditUrl: buildStudioEditUrl(publication?.external_id),
      reason: 'No related video is currently planned for this publication.',
    };
  }
  if (!settings.channelId) {
    return {
      status: 'missing_channel_id',
      canAttempt: false,
      settings,
      studioEditUrl: buildStudioEditUrl(publication?.external_id),
      reason: 'The YouTube channel id is missing from the channel profile.',
    };
  }
  if (!settings.profileDir) {
    return {
      status: 'profile_not_configured',
      canAttempt: false,
      settings,
      studioEditUrl: buildStudioEditUrl(publication?.external_id),
      reason: 'No YouTube Studio browser profile is configured for related-video automation.',
    };
  }
  if (typeof fsExists === 'function' && !fsExists(settings.profileDir)) {
    return {
      status: 'profile_missing',
      canAttempt: false,
      settings,
      studioEditUrl: buildStudioEditUrl(publication?.external_id),
      reason: `The configured browser profile does not exist: ${settings.profileDir}`,
    };
  }
  return {
    status: 'configured',
    canAttempt: true,
    settings,
    studioEditUrl: buildStudioEditUrl(publication?.external_id),
    reason: 'Channel is configured for YouTube Studio related-video automation.',
  };
}

export function buildYoutubeRelatedVideoRunCode({
  targetTitle,
  targetExternalId,
  targetUrl,
  target_title,
  target_external_id,
  target_url,
} = {}) {
  const resolvedTitle = String(targetTitle || target_title || '').trim();
  const resolvedExternalId = String(targetExternalId || target_external_id || '').trim();
  const resolvedUrl = String(targetUrl || target_url || '').trim();
  return `
async (page) => {
  const target = {
    title: ${JSON.stringify(resolvedTitle)},
    externalId: ${JSON.stringify(resolvedExternalId)},
    url: ${JSON.stringify(resolvedUrl)},
  };

  const textFromLocator = async (locator) => {
    try {
      return await locator.innerText({ timeout: 1500 });
    } catch {
      return '';
    }
  };

  const bodyText = async () => {
    try {
      return await page.locator('body').innerText({ timeout: 2500 });
    } catch {
      return '';
    }
  };

  const isVisible = async (locator) => {
    try {
      return await locator.isVisible();
    } catch {
      return false;
    }
  };

  const firstVisible = async (locators) => {
    for (const locator of locators) {
      try {
        const count = await locator.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = locator.nth(index);
          if (await isVisible(candidate)) {
            return candidate;
          }
        }
      } catch {
        // ignore and continue
      }
    }
    return null;
  };

  const clickFirstVisible = async (locators) => {
    const locator = await firstVisible(locators);
    if (!locator) {
      return false;
    }
    try {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  };

  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  const currentUrl = page.url();
  const initialBody = await bodyText();
  if (/accounts\\.google\\.com/i.test(currentUrl) || /sign in|choose an account/i.test(initialBody)) {
    return { status: 'login_required', url: currentUrl };
  }

  await clickFirstVisible([
    page.getByRole('button', { name: /show more/i }),
    page.locator('button, [role="button"]').filter({ hasText: /show more/i }),
  ]);

  const openedPicker = await clickFirstVisible([
    page.getByRole('button', { name: /related video/i }),
    page.getByRole('link', { name: /related video/i }),
    page.locator('button, a, [role="button"]').filter({ hasText: /related video/i }),
    page.locator('[aria-label*="Related video" i]'),
  ]);

  if (!openedPicker) {
    const scannedBody = await bodyText();
    return {
      status: /related video/i.test(scannedBody) ? 'manual_action_required' : 'feature_unavailable',
      url: page.url(),
      body: scannedBody.slice(0, 800),
    };
  }

  await page.waitForTimeout(800);

  const searchBox = await firstVisible([
    page.getByRole('textbox', { name: /search/i }),
    page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i], textarea[placeholder*="Search" i]'),
    page.locator('input[type="text"], textarea'),
  ]);

  if (!searchBox) {
    return {
      status: 'search_not_found',
      url: page.url(),
    };
  }

  await searchBox.fill(target.title || target.externalId || target.url);
  await page.waitForTimeout(1200);

  const escapedTitle = (target.title || '').replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&');
  const titleRegex = escapedTitle ? new RegExp(escapedTitle, 'i') : null;
  const resultClicked = await clickFirstVisible([
    titleRegex ? page.getByText(titleRegex, { exact: true }) : page.locator('__never__'),
    titleRegex ? page.getByText(titleRegex) : page.locator('__never__'),
    titleRegex ? page.locator('[role="option"], ytcp-video-row, ytcp-entity-card, tp-yt-paper-item').filter({ hasText: titleRegex }) : page.locator('__never__'),
  ]);

  if (!resultClicked) {
    return {
      status: 'target_not_found',
      query: target.title || target.externalId || target.url,
      url: page.url(),
    };
  }

  await page.waitForTimeout(500);

  await clickFirstVisible([
    page.getByRole('button', { name: /done|select/i }),
    page.locator('button, [role="button"]').filter({ hasText: /done|select/i }),
  ]);

  const saveButton = await firstVisible([
    page.getByRole('button', { name: /^save$/i }),
    page.locator('button, [role="button"]').filter({ hasText: /^save$/i }),
  ]);
  if (!saveButton) {
    return {
      status: 'save_not_found',
      url: page.url(),
    };
  }

  const saveDisabled = await saveButton.isDisabled().catch(() => false);
  if (!saveDisabled) {
    await saveButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1800);
  }

  const confirmationText = await bodyText();
  return {
    status: 'applied',
    url: page.url(),
    saveDisabled,
    body: confirmationText.slice(0, 800),
  };
}`.trim();
}

export async function applyYoutubeRelatedVideoSelection({
  channelProfile,
  publication,
  relatedVideo,
  cwd = process.cwd(),
  env = process.env,
  asOf = new Date().toISOString(),
  cliRunner = defaultCliRunner,
  fsExists = existsSync,
} = {}) {
  const capability = probeYoutubeRelatedVideoCapability({
    channelProfile,
    publication,
    relatedVideo,
    fsExists,
  });
  const targetExternalId = String(relatedVideo?.target_external_id || '').trim();
  if (!capability.canAttempt) {
    return {
      capability,
      applyStatus: 'skipped',
      appliedAt: '',
      lastAttemptedAt: new Date(asOf).toISOString(),
      lastError: capability.reason,
      studioEditUrl: capability.studioEditUrl || '',
    };
  }
  if (!String(publication?.external_id || '').trim() || !targetExternalId) {
    return {
      capability: {
        ...capability,
        status: 'missing_video_ids',
        canAttempt: false,
        reason: 'The current or related video is missing a YouTube external id.',
      },
      applyStatus: 'skipped',
      appliedAt: '',
      lastAttemptedAt: new Date(asOf).toISOString(),
      lastError: 'The current or related video is missing a YouTube external id.',
      studioEditUrl: capability.studioEditUrl || '',
    };
  }

  const executable = capability.settings.executable;
  const sessionName = capability.settings.sessionName;
  const studioEditUrl = capability.studioEditUrl || buildStudioEditUrl(publication.external_id);
  const openArgs = [
    '-s', sessionName,
    'open',
    studioEditUrl,
    '--browser', capability.settings.browser,
    '--persistent',
    '--profile', capability.settings.profileDir,
    '--json',
  ];
  if (capability.settings.headed) {
    openArgs.splice(openArgs.length - 1, 0, '--headed');
  }

  const closeSession = () => {
    cliRunner(executable, ['-s', sessionName, 'close'], {
      cwd,
      env,
      timeoutMs: 15_000,
    });
  };

  try {
    const opened = cliRunner(executable, openArgs, {
      cwd,
      env,
      timeoutMs: 90_000,
    });
    if (!opened.ok) {
      return {
        capability: {
          ...capability,
          status: 'playwright_open_failed',
          canAttempt: false,
          reason: opened.stderr || opened.stdout || opened.error || 'Could not open YouTube Studio.',
        },
        applyStatus: 'failed',
        appliedAt: '',
        lastAttemptedAt: new Date(asOf).toISOString(),
        lastError: opened.stderr || opened.stdout || opened.error || 'Could not open YouTube Studio.',
        studioEditUrl,
      };
    }

    const runCode = buildYoutubeRelatedVideoRunCode({
      targetTitle: relatedVideo?.target_title || '',
      targetExternalId,
      targetUrl: relatedVideo?.target_url || '',
    });
    const applied = cliRunner(executable, [
      '-s', sessionName,
      'run-code',
      runCode,
      '--json',
    ], {
      cwd,
      env,
      timeoutMs: 120_000,
    });

    if (!applied.ok) {
      return {
        capability: {
          ...capability,
          status: 'playwright_run_failed',
          canAttempt: false,
          reason: applied.stderr || applied.stdout || applied.error || 'Related-video automation failed inside Playwright.',
        },
        applyStatus: 'failed',
        appliedAt: '',
        lastAttemptedAt: new Date(asOf).toISOString(),
        lastError: applied.stderr || applied.stdout || applied.error || 'Related-video automation failed inside Playwright.',
        studioEditUrl,
      };
    }

    const payload = parseJsonPayload(applied.stdout) || {};
    const scriptStatus = normalizeToken(payload.status || 'unknown');
    const loginRequired = scriptStatus === 'login_required';
    const appliedState = scriptStatus === 'applied'
      ? 'applied'
      : scriptStatus === 'manual_action_required'
        ? 'manual_action_required'
        : scriptStatus === 'feature_unavailable'
          ? 'feature_unavailable'
          : scriptStatus === 'search_not_found' || scriptStatus === 'target_not_found' || scriptStatus === 'save_not_found'
            ? 'manual_action_required'
            : scriptStatus || 'failed';

    return {
      capability: {
        ...capability,
        status: loginRequired ? 'login_required' : capability.status,
        canAttempt: !loginRequired,
        reason: loginRequired
          ? 'The configured YouTube Studio profile is not logged in.'
          : capability.reason,
      },
      applyStatus: appliedState,
      appliedAt: appliedState === 'applied' ? new Date(asOf).toISOString() : '',
      lastAttemptedAt: new Date(asOf).toISOString(),
      lastError: appliedState === 'applied'
        ? ''
        : String(payload.body || payload.url || scriptStatus || 'Related-video automation did not complete.').trim(),
      studioEditUrl,
      details: payload,
    };
  } finally {
    closeSession();
  }
}

export {
  buildStudioEditUrl,
};
