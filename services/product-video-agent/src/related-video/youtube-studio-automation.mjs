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

  // Diagnostic: enumerate what dialogs / cards actually exist so we can debug
  // when interactions silently no-op. Keyed off text content ("Choose specific
  // video" heading, target title in card labels) rather than element tags, so
  // we're robust to Studio using ytcp-video-pick-dialog vs ytcp-video-picker
  // vs bare tp-yt-paper-dialog. Runs at three checkpoints:
  //   pre_search  — after picker opens
  //   post_search — after typing + filter settle
  //   post_select — after keyboard + click fallback attempts
  const captureDiagnostic = async (label) => {
    const snapshot = await page.evaluate((titleHint) => {
      const norm = (s) => String(s || '').trim().toLowerCase();
      const hint = norm(titleHint);
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      // Enumerate anything dialog-shaped that is visible right now
      const dialogTags = ['ytcp-video-pick-dialog', 'ytcp-video-picker', 'ytcp-dialog', 'tp-yt-paper-dialog', 'dialog', 'ytcp-select-dialog'];
      const dialogs = [];
      for (const tag of dialogTags) {
        for (const el of Array.from(document.querySelectorAll(tag))) {
          if (!visible(el)) continue;
          const heading = el.querySelector('h1, h2, [role="heading"], .header, .headline');
          dialogs.push({
            tag: el.tagName,
            heading: (heading?.textContent || '').trim().slice(0, 80),
            ariaLabel: el.getAttribute('aria-label'),
            rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
            childCounts: {
              inputs: el.querySelectorAll('input, textarea').length,
              buttons: el.querySelectorAll('button, [role="button"]').length,
              options: el.querySelectorAll('[role="option"]').length,
              entityCards: el.querySelectorAll('ytcp-entity-card').length,
              videoRows: el.querySelectorAll('ytcp-video-row').length,
            },
          });
        }
      }

      // Enumerate all "clickable card-like things" that contain the target
      // title text, regardless of element type. Report container element so
      // we know what to click / query in future runs.
      const cardTags = ['ytcp-entity-card', 'ytcp-video-row', 'ytcp-video-card', 'ytcp-select-item', 'tp-yt-paper-item'];
      const cardCandidates = [];
      const seen = new Set();
      for (const tag of cardTags) {
        for (const el of Array.from(document.querySelectorAll(tag))) {
          if (seen.has(el)) continue;
          const label = el.getAttribute('aria-label') || el.textContent || '';
          const labelNorm = norm(label);
          if (hint && !labelNorm.includes(hint)) continue;
          seen.add(el);
          const r = el.getBoundingClientRect();
          cardCandidates.push({
            tag: el.tagName,
            role: el.getAttribute('role'),
            ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 120),
            text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
            selectionStyle: el.getAttribute('selection-style'),
            hasSelectedIcon: !!el.querySelector('#selected-icon:not([hidden])'),
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          });
        }
      }

      // Also fallback: anything with role=option containing the title text
      const roleOptions = [];
      for (const el of Array.from(document.querySelectorAll('[role="option"]'))) {
        const label = el.getAttribute('aria-label') || el.textContent || '';
        if (hint && !norm(label).includes(hint)) continue;
        if (seen.has(el)) continue;
        const r = el.getBoundingClientRect();
        roleOptions.push({
          tag: el.tagName,
          ariaLabel: (el.getAttribute('aria-label') || '').slice(0, 120),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      }

      // What has focus right now — useful for keyboard-nav debug
      const focused = document.activeElement;
      const focusedInfo = focused ? {
        tag: focused.tagName,
        id: focused.id,
        classes: (focused.className || '').toString().slice(0, 80),
        ariaLabel: focused.getAttribute?.('aria-label'),
        placeholder: focused.getAttribute?.('placeholder'),
      } : null;

      return { dialogs, cardCandidates, roleOptions, focused: focusedInfo, url: location.href };
    }, target.title || target.externalId || '');

    let screenshotPath = null;
    try {
      screenshotPath = '/tmp/orion-related-video-' + Date.now() + '-' + label + '.png';
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch { /* ignore */ }

    return { label, ...snapshot, screenshotPath };
  };

  const diagnostics = [];
  diagnostics.push(await captureDiagnostic('pre_search'));

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
  diagnostics.push(await captureDiagnostic('post_search'));

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
      diagnostics,
    };
  }

  // Click the filtered card directly with Playwright's actionable-click.
  // Earlier keyboard-nav attempts (Tab+Enter/Space) moved focus out of the
  // search input and hit the search-clear "×" button, resetting the picker
  // — confirmed 2026-08-23 by diagnostic capture showing 4 buttons post-
  // search (search-clear appears when input has text) and focus escaping to
  // YTCP-DROPDOWN-TRIGGER on the underlying page after keyboard sequence.
  // Cards render with role="option", which is Playwright's most reliable
  // handle. Use the accessibility name (title + ", Not selected" suffix
  // matches on partial before selection; after selection Studio replaces the
  // whole label).
  const attemptedInteractions = [];
  const titleQuery = target.title || target.externalId || target.url || '';
  // Disambiguation for same-title videos: after Studio's search filters the
  // grid, multiple cards may match the target title (channels commonly ship
  // 50+ videos with titles like "Guess the typing!"). Each card carries a
  // thumbnail whose src contains the video's external_id, so we can pick
  // the right one deterministically. If we can find it by external_id, do
  // that; otherwise fall back to the first title match. Confirmed
  // 2026-08-25: without this, the poke-guess Aug 13 "Guess the Type Before
  // the Reveal" run clicked the wrong same-titled card and Studio's
  // Related video trigger never updated for the intended target.
  const clickedByThumbnail = await page.evaluate((wantedExternalId) => {
    if (!wantedExternalId) return { ok: false, reason: 'no-target-id' };
    const cards = Array.from(document.querySelectorAll('ytcp-video-pick-dialog [role="option"], ytcp-video-pick-dialog ytcp-entity-card'));
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const imgs = Array.from(card.querySelectorAll('img'));
      const matched = imgs.some((img) => String(img.src || '').includes(wantedExternalId));
      if (matched) {
        try { card.click(); return { ok: true, reason: 'thumbnail_match' }; } catch { /* fall through */ }
      }
    }
    return { ok: false, reason: 'no-thumbnail-match' };
  }, target.externalId || '');

  let clickError = null;
  if (clickedByThumbnail?.ok) {
    attemptedInteractions.push({ attempt: 0, key: 'thumbnail_id_click', clicked: true });
  } else {
    try {
      // Fallback: filter({ hasText: string }) does substring match — no
      // regex escaping needed. This picks the first card with matching
      // title text, which is right when only one video shares the title
      // (or when the target is the newest video of that title).
      await page.getByRole('option').filter({ hasText: titleQuery }).first().click({ timeout: 5000 });
      attemptedInteractions.push({ attempt: 0, key: 'role_option_click', clicked: true, disambiguation: clickedByThumbnail?.reason || 'unknown' });
    } catch (err) {
      clickError = String(err && err.message ? err.message : err).split('\\n')[0].slice(0, 200);
      attemptedInteractions.push({ attempt: 0, key: 'role_option_click', clicked: false, error: clickError });
    }
  }
  await page.waitForTimeout(1200);
  state = await readTargetState();

  diagnostics.push(await captureDiagnostic('post_select'));

  // Verify selection two ways: (1) the card's aria-label flipped to
  // "Selected", or (2) the picker closed and the SPECIFIC Related-video
  // trigger on the main page now shows the target title.
  //
  // The previous check enumerated ALL ytcp-dropdown-trigger elements on the
  // page and matched target-title substring against any of them, which was
  // way too loose — Studio's edit page has ~a dozen dropdowns (Category,
  // Playlist, License, Comments, Age restriction, etc.) and any one that
  // happened to contain a substring of the target title produced a false-
  // positive "applied" verdict. Confirmed 2026-08-25: 49/49 poke-guess
  // publications were marked apply_status='applied' after the backfill,
  // but headed inspection of the Aug 13 video (ghdPSbKevn4) showed the
  // Related video trigger literally said "None" — nothing was actually
  // set in Studio.
  //
  // Fix: locate the "Related video" text label, walk up to its containing
  // dropdown-trigger element, and check ONLY that trigger's text for the
  // target title. If it says "None" (never set) the check correctly
  // returns null → selection_not_confirmed instead of a false applied.
  let mainPageConfirmedTitle = null;
  if (!state.selected) {
    mainPageConfirmedTitle = await page.evaluate((titleHint) => {
      const norm = (s) => String(s || '').trim().toLowerCase();
      const hint = norm(titleHint);
      if (!hint) return null;
      const trigger = (() => {
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const text = (el.textContent || '').trim();
          if (text !== 'Related video' || el.children.length > 1) continue;
          let cur = el;
          for (let i = 0; i < 10 && cur; i += 1) {
            if (cur.tagName === 'YTCP-DROPDOWN-TRIGGER' || cur.tagName === 'YTCP-TEXT-DROPDOWN-TRIGGER') {
              return cur;
            }
            cur = cur.parentElement;
          }
        }
        return null;
      })();
      if (!trigger) return null;
      const combined = norm((trigger.textContent || '') + ' ' + (trigger.getAttribute('aria-label') || ''));
      // Explicitly reject the "None" placeholder Studio shows before any
      // related video has been picked — otherwise a target title of "None"
      // or similar could ambiguously match.
      if (/\\bnone\\b/.test(combined) && !combined.includes(hint)) return null;
      return combined.includes(hint) ? (trigger.textContent || '').trim().slice(0, 200) : null;
    }, target.title || target.externalId || '');
  }

  if (!state.selected && !mainPageConfirmedTitle) {
    return {
      status: 'selection_not_confirmed',
      aria: state.aria,
      attempts: attemptedInteractions,
      url: page.url(),
      diagnostics,
    };
  }

  await page.waitForTimeout(400);

  // Confirm the picker (Done/Select button inside the dialog). Scope to the
  // dialog so we don't accidentally click a same-named button elsewhere.
  // May be a no-op if the picker already auto-closed after selection.
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
      diagnostics,
    };
  }

  // Wait for Save to become enabled — Studio's Polymer takes a beat after the
  // picker closes to acknowledge the dirty state and enable the button. Prior
  // to this wait, we'd check-and-skip when Save was still disabled, silently
  // return "applied" without persisting, and Studio's Undo-changes stayed
  // pending until the operator manually clicked Save. Confirmed 2026-08-25:
  // one poke-quizz backfill run left "Related video → Psychic/Water Type Quiz"
  // set on the trigger with Save DISABLED, so nothing persisted despite
  // apply_status='applied'. Poll for up to 6s.
  let saveDisabled = true;
  const saveEnableDeadlineMs = Date.now() + 6000;
  while (Date.now() < saveEnableDeadlineMs) {
    saveDisabled = await saveButton.isDisabled().catch(() => true);
    if (!saveDisabled) break;
    await page.waitForTimeout(300);
  }

  if (saveDisabled) {
    return {
      status: 'save_never_enabled',
      url: page.url(),
      diagnostics,
    };
  }

  await saveButton.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const confirmationText = await bodyText();
  return {
    status: 'applied',
    url: page.url(),
    saveDisabled,
    body: confirmationText.slice(0, 800),
    diagnostics,
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
              || scriptStatus === 'save_never_enabled'
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
