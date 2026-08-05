import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyYoutubeRelatedVideoSelection,
  buildStudioEditUrl,
  buildYoutubeRelatedVideoRunCode,
  probeYoutubeRelatedVideoCapability,
  resolveYoutubeRelatedVideoAutomationSettings,
} from '../../src/related-video/youtube-studio-automation.mjs';

const channelProfile = {
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  youtube: {
    channel_id: 'UC-POKE-QUIZZ',
  },
  metadata: {
    related_video: {
      enabled: true,
      provider: 'youtube_studio',
      browser: 'chrome',
      profile_dir: '/Users/Agent/.orion/playwright-profile',
      session_name: 'yt-related-poke-quizz',
    },
  },
};

const publication = {
  external_id: 'yt-target',
};

const relatedVideo = {
  selection_status: 'planned',
  target_external_id: 'yt-related',
  target_title: 'Guess the Pokemon: Bug / Ground',
  target_url: 'https://youtube.com/shorts/yt-related',
};

test('related-video automation resolves channel settings from metadata', () => {
  const settings = resolveYoutubeRelatedVideoAutomationSettings(channelProfile);

  assert.equal(settings.enabled, true);
  assert.equal(settings.provider, 'youtube_studio');
  assert.equal(settings.profileDir, '/Users/Agent/.orion/playwright-profile');
  assert.equal(settings.sessionName, 'yt-related-poke-quizz');
});

test('related-video capability probe refuses channels without a configured profile', () => {
  const capability = probeYoutubeRelatedVideoCapability({
    channelProfile: {
      ...channelProfile,
      metadata: {
        related_video: {
          ...channelProfile.metadata.related_video,
          profile_dir: '',
        },
      },
    },
    publication,
    relatedVideo,
    fsExists: () => false,
  });

  assert.equal(capability.status, 'profile_not_configured');
  assert.equal(capability.canAttempt, false);
});

test('related-video apply short-circuits cleanly when automation is disabled', async () => {
  const result = await applyYoutubeRelatedVideoSelection({
    channelProfile: {
      ...channelProfile,
      metadata: {
        related_video: {
          ...channelProfile.metadata.related_video,
          enabled: false,
        },
      },
    },
    publication,
    relatedVideo,
    fsExists: () => true,
  });

  assert.equal(result.applyStatus, 'skipped');
  assert.equal(result.capability.status, 'disabled');
  assert.match(result.lastError, /disabled/u);
});

test('related-video run-code script includes the selected target title', () => {
  const code = buildYoutubeRelatedVideoRunCode(relatedVideo);

  assert.match(code, /Guess the Pokemon: Bug \/ Ground/u);
  assert.match(code, /related video/i);
  assert.match(code, /save/i);
});

test('related-video run-code dismisses the SKIP TO YOUTUBE STUDIO splash before searching for the picker', () => {
  const code = buildYoutubeRelatedVideoRunCode(relatedVideo);

  // Regression guard: YouTube's per-session splash blocks Playwright-driven
  // Chrome. Without a skip step, the show-more + related-video selectors
  // run against the splash body and always return feature_unavailable.
  assert.match(code, /skip to youtube studio/i);
});

test('buildStudioEditUrl forces the English UI so button-name selectors match regardless of account locale', () => {
  const url = buildStudioEditUrl('yt-target');

  assert.match(url, /studio\.youtube\.com\/video\/yt-target\/edit/u);
  assert.match(url, /\?hl=en/u);
});

test('buildStudioEditUrl returns empty string for a missing external id', () => {
  assert.equal(buildStudioEditUrl(''), '');
  assert.equal(buildStudioEditUrl(null), '');
  assert.equal(buildStudioEditUrl(undefined), '');
});

// The following four tests exercise applyYoutubeRelatedVideoSelection's
// parsing of playwright-cli's `run-code --json` output. The real playwright-cli
// wraps the returned value as {"result": "<JSON string>"}; older releases
// returned the flat object directly. Both must map to the correct applyStatus.

const applyPublication = { external_id: 'yt-current' };
const applyRelatedVideo = {
  selection_status: 'planned',
  target_title: 'Guess the Pokemon: Bug / Ground',
  target_external_id: 'yt-target',
  target_url: 'https://youtube.com/shorts/yt-target',
};

function stubCliRunner(runResponses) {
  const calls = [];
  return {
    calls,
    runner(executable, args) {
      const subcommand = args[2] || '';
      calls.push({ executable, args, subcommand });
      const responseKey = subcommand === 'run-code' ? 'runCode' : subcommand;
      const spec = runResponses[responseKey] || { status: 0, stdout: '', stderr: '' };
      return { executable, args, ok: (spec.status ?? 0) === 0, exitCode: spec.status ?? 0, stdout: spec.stdout || '', stderr: spec.stderr || '', error: '' };
    },
  };
}

test('applyYoutubeRelatedVideoSelection unwraps playwright-cli run-code result wrapper and reports login_required', async () => {
  const stub = stubCliRunner({
    open: { status: 0, stdout: '{}' },
    runCode: {
      status: 0,
      // Real playwright-cli response shape observed 2026-08-05: {"result": "<JSON string>"}.
      stdout: JSON.stringify({ result: JSON.stringify({ status: 'login_required', url: 'https://accounts.google.com/v3/signin/identifier' }) }),
    },
    close: { status: 0, stdout: '' },
  });

  const result = await applyYoutubeRelatedVideoSelection({
    channelProfile,
    publication: applyPublication,
    relatedVideo: applyRelatedVideo,
    fsExists: () => true,
    cliRunner: stub.runner,
  });

  assert.equal(result.capability.status, 'login_required');
  assert.equal(result.capability.canAttempt, false);
  assert.match(result.capability.reason || '', /not logged in/i);
  assert.equal(result.applyStatus, 'login_required');
});

test('applyYoutubeRelatedVideoSelection unwraps run-code wrapper and reports applied', async () => {
  const stub = stubCliRunner({
    open: { status: 0, stdout: '{}' },
    runCode: {
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ status: 'applied', saveDisabled: false, body: 'Related video added.' }) }),
    },
    close: { status: 0, stdout: '' },
  });

  const result = await applyYoutubeRelatedVideoSelection({
    channelProfile,
    publication: applyPublication,
    relatedVideo: applyRelatedVideo,
    fsExists: () => true,
    cliRunner: stub.runner,
    asOf: '2026-08-05T12:00:00.000Z',
  });

  assert.equal(result.applyStatus, 'applied');
  assert.equal(result.appliedAt, '2026-08-05T12:00:00.000Z');
  assert.equal(result.lastError, '');
});

test('applyYoutubeRelatedVideoSelection falls back to flat payload shape (older playwright-cli releases)', async () => {
  const stub = stubCliRunner({
    open: { status: 0, stdout: '{}' },
    runCode: {
      status: 0,
      // No {"result": ...} wrapper — the flat object shape older playwright-cli releases returned.
      stdout: JSON.stringify({ status: 'applied', saveDisabled: true }),
    },
    close: { status: 0, stdout: '' },
  });

  const result = await applyYoutubeRelatedVideoSelection({
    channelProfile,
    publication: applyPublication,
    relatedVideo: applyRelatedVideo,
    fsExists: () => true,
    cliRunner: stub.runner,
  });

  assert.equal(result.applyStatus, 'applied');
});

test('applyYoutubeRelatedVideoSelection propagates feature_unavailable through the wrapper', async () => {
  const stub = stubCliRunner({
    open: { status: 0, stdout: '{}' },
    runCode: {
      status: 0,
      stdout: JSON.stringify({ result: JSON.stringify({ status: 'feature_unavailable', body: 'No related video option visible.' }) }),
    },
    close: { status: 0, stdout: '' },
  });

  const result = await applyYoutubeRelatedVideoSelection({
    channelProfile,
    publication: applyPublication,
    relatedVideo: applyRelatedVideo,
    fsExists: () => true,
    cliRunner: stub.runner,
  });

  assert.equal(result.applyStatus, 'feature_unavailable');
  assert.match(result.lastError, /No related video option visible/u);
});
