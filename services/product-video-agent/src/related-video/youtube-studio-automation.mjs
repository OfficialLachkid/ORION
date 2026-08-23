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

  // Playwright-driven Chrome triggers YouTube's "unsupported browser" splash
  // every session (per-session, not dismissible with a preference) — same
  // profile in a normal Chrome window doesn't see it. Splash has one link:
  // "SKIP TO YOUTUBE STUDIO", which takes us to the video edit page we
  // actually want. Before 2026-08-05 the automation ran its show-more +
  // related-video selectors against the splash body and silently returned
  // feature_unavailable on every publication; verified end-to-end that
  // clicking skip lands on the real edit page where the picker is reachable.
  const skipToStudio = await firstVisible([
    page.getByRole('link', { name: /skip to youtube studio/i }),
    page.getByRole('button', { name: /skip to youtube studio/i }),
    page.locator('a, button, [role="link"]').filter({ hasText: /skip to youtube studio/i }),
  ]);
  if (skipToStudio) {
    await skipToStudio.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
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

  // Wait for the picker dialog itself to render. Without this the search-input
  // lookup below can race against Studio's picker-open animation and settle on
  // a stale search box elsewhere on the page (observed 2026-08-23: card
  // selection silently no-ops because clicks landed on the wrong pane).
  const pickerVisible = await page
    .locator('ytcp-video-pick-dialog')
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!pickerVisible) {
    return {
      status: 'feature_unavailable',
      url: page.url(),
      body: (await bodyText()).slice(0, 800),
    };
  }
  await page.waitForTimeout(600);

  // Scope search-input lookup to the picker dialog. The picker's own search
  // input is <input placeholder="Search your videos"> — earlier lookups by
  // /search/i also matched Studio's global channel search box, which does not
  // filter picker candidates. Confirmed 2026-08-23 during playwright-cli
  // instrumentation on video AJ2ucVUkz7w.
  const searchBox = await firstVisible([
    page.locator('ytcp-video-pick-dialog input[placeholder*="Search your videos" i]'),
    page.locator('ytcp-video-pick-dialog input[placeholder*="Search" i], ytcp-video-pick-dialog input[aria-label*="Search" i]'),
    page.locator('ytcp-video-pick-dialog input[type="text"], ytcp-video-pick-dialog textarea'),
  ]);

  if (!searchBox) {
    return {
      status: 'search_not_found',
      url: page.url(),
    };
  }

  // Use trusted keyboard events (click-to-focus + keyboard.type) instead of
  // input.fill(). fill() sets the value and dispatches synthetic input events;
  // Studio's Polymer input pipeline sometimes rejects those as untrusted and
  // does not fire the debounced filter. keyboard.type sends real key events
  // via the CDP Input.dispatchKeyEvent path.
  await searchBox.click({ timeout: 3000 }).catch(() => {});
  await searchBox.fill('').catch(() => {});
  await page.keyboard.type(target.title || target.externalId || target.url, { delay: 25 });
  await page.waitForTimeout(1500);

  // Look up the target card by aria-label prefix inside the picker dialog.
  // Cards render with aria-label "<title>, Not selected" or "<title>, Selected"
  // — we key selection state off that suffix so we know for certain whether an
  // interaction actually toggled the card.
  const readTargetState = async () => {
    return page.evaluate((titlePrefix) => {
      const cards = Array.from(document.querySelectorAll('ytcp-video-pick-dialog ytcp-entity-card'));
      const match = cards.find((card) => {
        const label = card.getAttribute('aria-label') || '';
        return label.trim().toLowerCase().startsWith(String(titlePrefix || '').trim().toLowerCase());
      });
      if (!match) {
        return { found: false, aria: null, selected: false };
      }
      const aria = match.getAttribute('aria-label') || '';
      const suffix = aria.split(',').map((part) => part.trim()).pop() || '';
      const selected = /^selected$/i.test(suffix);
      return { found: true, aria, selected };
    }, target.title || target.externalId || '');
  };

  let state = await readTargetState();
  if (!state.found) {
    return {
      status: 'target_not_found',
      query: target.title || target.externalId || target.url,
      url: page.url(),
    };
  }

  // Attempt keyboard selection first: Tab out of the search input into the
  // results grid, then Enter/Space to select. Studio's grid honors keyboard
  // navigation via arrow keys once focus is inside it. Mouse-based selection
  // has been observed to no-op silently — Polymer's synthetic-click filter
  // appears more permissive with keyboard events (2026-08-23 investigation).
  const attemptedInteractions = [];
  const maxKeyboardAttempts = 4;
  for (let attempt = 0; attempt < maxKeyboardAttempts && !state.selected; attempt += 1) {
    if (attempt === 0) {
      await page.keyboard.press('Tab').catch(() => {});
      await page.waitForTimeout(200);
    } else {
      await page.keyboard.press('ArrowDown').catch(() => {});
      await page.waitForTimeout(150);
    }
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(400);
    state = await readTargetState();
    attemptedInteractions.push({ attempt, key: attempt === 0 ? 'Tab+Enter' : 'ArrowDown+Enter', selected: state.selected });
    if (state.selected) break;
    await page.keyboard.press('Space').catch(() => {});
    await page.waitForTimeout(400);
    state = await readTargetState();
    attemptedInteractions.push({ attempt, key: 'Space', selected: state.selected });
  }

  // Fallback: direct programmatic click on the card element. After search has
  // filtered the grid down to a small candidate set, the target card is much
  // more likely to be laid out with real dimensions, so a scroll + click has a
  // reasonable chance of landing.
  if (!state.selected) {
    await page.evaluate((titlePrefix) => {
      const cards = Array.from(document.querySelectorAll('ytcp-video-pick-dialog ytcp-entity-card'));
      const match = cards.find((card) => {
        const label = card.getAttribute('aria-label') || '';
        return label.trim().toLowerCase().startsWith(String(titlePrefix || '').trim().toLowerCase());
      });
      if (match) {
        try { match.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }
      }
    }, target.title || target.externalId || '');
    await page.waitForTimeout(400);

    const clicked = await page.evaluate((titlePrefix) => {
      const cards = Array.from(document.querySelectorAll('ytcp-video-pick-dialog ytcp-entity-card'));
      const match = cards.find((card) => {
        const label = card.getAttribute('aria-label') || '';
        return label.trim().toLowerCase().startsWith(String(titlePrefix || '').trim().toLowerCase());
      });
      if (!match) return false;
      try { match.click(); return true; } catch { return false; }
    }, target.title || target.externalId || '');
    attemptedInteractions.push({ attempt: 'fallback', key: 'programmatic_click', clicked });
    await page.waitForTimeout(700);
    state = await readTargetState();
  }

  if (!state.selected) {
    return {
      status: 'selection_not_confirmed',
      aria: state.aria,
      attempts: attemptedInteractions,
      url: page.url(),
    };
  }

  await page.waitForTimeout(400);

  // Confirm the picker (Done/Select button inside the dialog). Scope to the
  // dialog so we don't accidentally click a same-named button elsewhere.
  await clickFirstVisible([
    page.locator('ytcp-video-pick-dialog').getByRole('button', { name: /^(done|select)$/i }),
    page.locator('ytcp-video-pick-dialog').locator('button, [role="button"]').filter({ hasText: /^(done|select)$/i }),
  ]);
  await page.waitForTimeout(600);

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

    // playwright-cli's `run-code --json` wraps the returned value as
    // {"result": "<JSON string>"}. Without unwrapping, `payload.status` was
    // always undefined and every automation run got misclassified as
    // 'unknown' — including the login_required and *_not_found diagnostics
    // that would otherwise have made the auth blocker visible from day one
    // (root cause of the silent-failure loop observed 2026-08-05). Fallback
    // to the outer object handles older playwright-cli releases that
    // returned the flat shape directly.
    const rawPayload = parseJsonPayload(applied.stdout) || {};
    const payload = typeof rawPayload.result === 'string'
      ? (parseJsonPayload(rawPayload.result) || {})
      : rawPayload;
    const scriptStatus = normalizeToken(payload.status || 'unknown');
    const loginRequired = scriptStatus === 'login_required';
    const appliedState = scriptStatus === 'applied'
      ? 'applied'
      : scriptStatus === 'manual_action_required'
        ? 'manual_action_required'
        : scriptStatus === 'feature_unavailable'
          ? 'feature_unavailable'
          : scriptStatus === 'search_not_found'
              || scriptStatus === 'target_not_found'
              || scriptStatus === 'save_not_found'
              || scriptStatus === 'selection_not_confirmed'
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
